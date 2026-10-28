"""助手接口：会话、消息（SSE 流式）、停止、重试、确认 / 拒绝有副作用的工具、反馈。"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import CompanyScope, current_company
from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError, RateLimitedError
from app.modules.assistant import (
    all_tools,  # noqa: F401  注册全部助手工具
    sse,
)
from app.modules.assistant.models import Conversation, Message, ToolRun
from app.modules.assistant.orchestrator import Orchestrator, request_cancel
from app.modules.assistant.tools import ToolContext, ToolError, registry

router = APIRouter(prefix="/assistant", tags=["assistant"])

MAX_CONCURRENT_TURNS = 3
# 每个企业每分钟最多发起的助手回合（防止脚本刷 LLM 用量）
MAX_TURNS_PER_MINUTE = 20
STALE_TURN = timedelta(minutes=5)
CONFIRM_TTL = timedelta(hours=24)


# ── 输出模型 ───────────────────────────────────────────────────────────


class ConversationOut(BaseModel):
    id: str
    title: str
    updated_at: str


class MessageOut(BaseModel):
    id: str
    role: str
    blocks: list[dict[str, Any]]
    state: str
    error_code: str
    feedback: str
    created_at: str


def conversation_out(c: Conversation) -> ConversationOut:
    return ConversationOut(id=str(c.id), title=c.title, updated_at=c.updated_at.isoformat())


def message_out(m: Message) -> MessageOut:
    return MessageOut(
        id=str(m.id),
        role=m.role,
        blocks=m.blocks,
        state=m.state,
        error_code=m.error_code,
        feedback=m.feedback,
        created_at=m.created_at.isoformat(),
    )


def _own_conversation(db: Session, scope: CompanyScope, conversation_id: uuid.UUID) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if (
        conversation is None
        or conversation.company_id != scope.company_id
        or conversation.user_id != scope.user.id
        or conversation.status != "active"
    ):
        raise NotFoundError("会话不存在")
    return conversation


def _own_message(db: Session, scope: CompanyScope, conversation: Conversation, message_id: uuid.UUID) -> Message:
    message = db.get(Message, message_id)
    if message is None or message.conversation_id != conversation.id:
        raise NotFoundError("消息不存在")
    return message


# ── 会话 ───────────────────────────────────────────────────────────────


class ConversationIn(BaseModel):
    title: str = Field(default="", max_length=60)


@router.post("/conversations", response_model=ConversationOut, status_code=201)
def create_conversation(
    body: ConversationIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ConversationOut:
    conversation = Conversation(company_id=scope.company_id, user_id=scope.user.id, title=body.title.strip())
    db.add(conversation)
    db.commit()
    return conversation_out(conversation)


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> list[ConversationOut]:
    rows = db.scalars(
        select(Conversation)
        .where(
            Conversation.company_id == scope.company_id,
            Conversation.user_id == scope.user.id,
            Conversation.status == "active",
        )
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    ).all()
    return [conversation_out(c) for c in rows]


class ConversationPatch(BaseModel):
    title: str = Field(min_length=1, max_length=60)


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: uuid.UUID,
    body: ConversationPatch,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> ConversationOut:
    conversation = _own_conversation(db, scope, conversation_id)
    conversation.title = body.title.strip()
    db.commit()
    return conversation_out(conversation)


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> Response:
    conversation = _own_conversation(db, scope, conversation_id)
    conversation.status = "deleted"
    db.commit()
    return Response(status_code=204)


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> list[MessageOut]:
    conversation = _own_conversation(db, scope, conversation_id)
    rows = db.scalars(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at).limit(500)
    ).all()
    return [message_out(m) for m in rows]


# ── 发送与流式回答 ─────────────────────────────────────────────────────


class SendIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


def _check_concurrency(db: Session, scope: CompanyScope) -> None:
    db.execute(
        update(Message)
        .where(
            Message.company_id == scope.company_id,
            Message.state == "thinking",
            Message.updated_at < utcnow() - STALE_TURN,
        )
        .values(state="error", error_code="timeout")
    )
    active = (
        db.scalar(
            select(func.count())
            .select_from(Message)
            .where(Message.company_id == scope.company_id, Message.state == "thinking")
        )
        or 0
    )
    from app.modules.billing.service import require_ai

    # 套餐有效且本月 AI 用量还有余量（每回合可能多次调用 LLM，按 4K token 预估）
    require_ai(db, scope.company_id, estimate_tokens=4_000)
    recent = (
        db.scalar(
            select(func.count())
            .select_from(Message)
            .where(
                Message.company_id == scope.company_id,
                Message.role == "assistant",
                Message.created_at >= utcnow() - timedelta(minutes=1),
            )
        )
        or 0
    )
    if recent >= MAX_TURNS_PER_MINUTE:
        raise RateLimitedError("发送太频繁，请稍后再试")
    if active >= MAX_CONCURRENT_TURNS:
        raise RateLimitedError("同时进行的对话太多，请稍后再试", code="too_many_turns")


def _stream(request: Request, orchestrator: Orchestrator) -> StreamingResponse:
    async def body() -> AsyncIterator[str]:
        async for item in orchestrator.run():
            if await request.is_disconnected():
                request_cancel(orchestrator.assistant.id)
            yield sse.encode(item)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/conversations/{conversation_id}/messages")
def send_message(
    conversation_id: uuid.UUID,
    body: SendIn,
    request: Request,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    conversation = _own_conversation(db, scope, conversation_id)
    _check_concurrency(db, scope)
    text = body.text.strip()
    if not text:
        raise AppError("请输入内容", code="empty_message")
    user_message = Message(
        conversation_id=conversation.id,
        company_id=scope.company_id,
        role="user",
        blocks=[{"semanticRole": "prompt", "content": text}],
        state="completed",
    )
    db.add(user_message)
    db.flush()
    assistant = Message(
        conversation_id=conversation.id,
        company_id=scope.company_id,
        role="assistant",
        parent_id=user_message.id,
        blocks=[],
        state="thinking",
    )
    db.add(assistant)
    if not conversation.title:
        conversation.title = text[:30]
    conversation.updated_at = utcnow()
    db.commit()
    return _stream(
        request,
        Orchestrator(db, scope.company, scope.user, scope.role, conversation, user_message, assistant),
    )


@router.post("/conversations/{conversation_id}/messages/{message_id}/retry")
def retry_message(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    request: Request,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """重新生成：复用原来的用户消息和上下文，覆盖这条回答（不复制历史回答）。"""
    conversation = _own_conversation(db, scope, conversation_id)
    assistant = _own_message(db, scope, conversation, message_id)
    if assistant.role != "assistant" or assistant.parent_id is None:
        raise AppError("只能重新生成助手的回答", code="not_retryable")
    if assistant.state == "thinking":
        raise ConflictError("回答正在生成中", code="turn_in_progress")
    _check_concurrency(db, scope)
    user_message = db.get(Message, assistant.parent_id)
    assert user_message is not None
    db.execute(
        update(ToolRun)
        .where(ToolRun.message_id == assistant.id, ToolRun.status == "pending_confirm")
        .values(status="expired", finished_at=utcnow())
    )
    assistant.blocks, assistant.state, assistant.error_code, assistant.feedback = [], "thinking", "", ""
    assistant.updated_at = utcnow()
    db.commit()
    return _stream(
        request,
        Orchestrator(db, scope.company, scope.user, scope.role, conversation, user_message, assistant),
    )


@router.post("/conversations/{conversation_id}/messages/{message_id}/cancel", response_model=MessageOut)
def cancel_message(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> MessageOut:
    conversation = _own_conversation(db, scope, conversation_id)
    message = _own_message(db, scope, conversation, message_id)
    if message.state == "thinking":
        message.state = "cancelled"
        message.updated_at = utcnow()
        db.commit()
    request_cancel(message.id)
    return message_out(message)


class FeedbackIn(BaseModel):
    value: Literal["like", "dislike", ""]


@router.post("/conversations/{conversation_id}/messages/{message_id}/feedback", status_code=204)
def message_feedback(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    body: FeedbackIn,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> Response:
    conversation = _own_conversation(db, scope, conversation_id)
    message = _own_message(db, scope, conversation, message_id)
    if message.role != "assistant":
        raise AppError("只能评价助手的回答", code="not_assistant")
    message.feedback = body.value
    db.commit()
    return Response(status_code=204)


# ── 有副作用工具的确认 ─────────────────────────────────────────────────


class ToolRunOut(BaseModel):
    id: str
    tool_name: str
    status: str
    summary: str
    error: str


def _own_run(db: Session, scope: CompanyScope, run_id: uuid.UUID) -> ToolRun:
    run = db.get(ToolRun, run_id, with_for_update=True)
    if run is None or run.company_id != scope.company_id:
        raise NotFoundError("操作不存在")
    if run.user_id != scope.user.id:
        raise ForbiddenError("只能确认自己发起的操作")
    if run.status != "pending_confirm":
        raise ConflictError("该操作已处理", code="tool_run_done")
    if run.started_at < utcnow() - CONFIRM_TTL:
        run.status, run.finished_at = "expired", utcnow()
        db.commit()
        raise ConflictError("确认已过期，请重新发起", code="tool_run_expired")
    return run


@router.post("/tool-runs/{run_id}/confirm", response_model=ToolRunOut)
async def confirm_tool_run(
    run_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ToolRunOut:
    run = _own_run(db, scope, run_id)
    tool = registry.get(run.tool_name)
    if tool is None or not tool.requires_confirmation:
        raise AppError("不支持的操作", code="invalid_tool")
    message = db.get(Message, run.message_id)
    assert message is not None
    ctx = ToolContext(
        db=db,
        company=scope.company,
        user=scope.user,
        role=scope.role,
        conversation_id=message.conversation_id,
        message_id=message.id,
    )
    args = registry.parse_args(tool, run.args)
    run.status = "running"
    try:
        result = await registry.execute(tool, ctx, args)
    except ToolError as exc:
        db.rollback()
        run = db.get(ToolRun, run_id)  # type: ignore[assignment]
        run.status, run.error, run.finished_at = "failed", str(exc), utcnow()
        db.commit()
        return ToolRunOut(id=str(run.id), tool_name=run.tool_name, status=run.status, summary="", error=str(exc))
    run.status, run.result, run.finished_at = "succeeded", result.data, utcnow()
    db.commit()
    return ToolRunOut(id=str(run.id), tool_name=run.tool_name, status=run.status, summary=result.summary, error="")


@router.post("/tool-runs/{run_id}/reject", response_model=ToolRunOut)
def reject_tool_run(
    run_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ToolRunOut:
    run = _own_run(db, scope, run_id)
    run.status, run.finished_at = "rejected", utcnow()
    db.commit()
    return ToolRunOut(id=str(run.id), tool_name=run.tool_name, status=run.status, summary="已取消", error="")


@router.get("/tool-runs/{run_id}", response_model=ToolRunOut)
def get_tool_run(
    run_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ToolRunOut:
    run = db.get(ToolRun, run_id)
    if run is None or run.company_id != scope.company_id:
        raise NotFoundError("操作不存在")
    return ToolRunOut(
        id=str(run.id),
        tool_name=run.tool_name,
        status=run.status,
        summary=str(run.result.get("deleted", "")) if run.result else "",
        error=run.error,
    )
