"""工具注册框架。

每个工具声明：名称、说明、参数模型（Pydantic，禁止多余字段）、所需角色、是否需要用户确认、执行函数、卡片类型。
执行时由框架注入 ToolContext（当前企业、当前用户、数据库会话），LLM 无法指定其他企业：
参数模型里没有 company_id 字段，且 extra="forbid"，传入多余字段会校验失败。
"""

from __future__ import annotations

import inspect
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.companies.models import Company


class ToolArgs(BaseModel):
    """所有工具参数模型的基类：禁止多余字段（防止 LLM 注入 company_id 等）。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


@dataclass
class ToolContext:
    db: Session
    company: Company
    user: User
    role: str
    conversation_id: uuid.UUID
    message_id: uuid.UUID

    @property
    def company_id(self) -> uuid.UUID:
        return self.company.id


@dataclass
class ToolResult:
    """data 回传给 LLM（不可信内容需在 data 中标注）；card 推送给前端渲染；summary 用于进度展示。"""

    data: dict[str, Any]
    card: dict[str, Any] | None = None
    summary: str = ""


ToolFunc = Callable[[ToolContext, Any], ToolResult | Awaitable[ToolResult]]


@dataclass
class Tool:
    name: str
    description: str
    args_model: type[ToolArgs]
    func: ToolFunc
    label: str  # 进度条上显示的中文动作，例如「查询档案完整度」
    roles: tuple[str, ...] = ("owner", "member", "operator")
    requires_confirmation: bool = False
    # 确认卡片内容：{title, summary, confirm_label, danger}。只能使用从数据库读取的、属于当前企业的数据。
    describe_confirm: Callable[[ToolContext, Any], dict[str, Any]] | None = None

    def confirmation(self, ctx: ToolContext, args: Any) -> dict[str, Any]:
        base = {
            "title": self.label,
            "summary": "该操作会修改数据，请确认。",
            "confirm_label": "确认",
            "danger": False,
        }
        if self.describe_confirm is not None:
            base.update(self.describe_confirm(ctx, args))
        return base

    def schema(self) -> dict[str, Any]:
        params = self.args_model.model_json_schema()
        params.pop("title", None)
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": params},
        }


class ToolError(Exception):
    """工具执行失败，message 面向用户（中文）。"""


@dataclass
class ToolRegistry:
    tools: dict[str, Tool] = field(default_factory=dict)

    def register(self, tool: Tool) -> Tool:
        if tool.name in self.tools:
            raise ValueError(f"duplicate tool {tool.name}")
        if not tool.name.replace("_", "").isalnum():
            raise ValueError("tool name must match ^[a-z0-9_]+$")
        self.tools[tool.name] = tool
        return tool

    def get(self, name: str) -> Tool | None:
        return self.tools.get(name)

    def schemas(self, role: str) -> list[dict[str, Any]]:
        return [tool.schema() for tool in self.tools.values() if role in tool.roles]

    def parse_args(self, tool: Tool, raw: str | dict[str, Any]) -> ToolArgs:
        """解析并校验参数。失败抛出 ValueError（错误信息回传给 LLM，不泄露内部细节）。"""
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError as exc:
            raise ValueError("arguments must be a JSON object") from exc
        if not isinstance(data, dict):
            raise ValueError("arguments must be a JSON object")
        try:
            return tool.args_model.model_validate(data)
        except ValidationError as exc:
            fields = sorted({".".join(str(p) for p in err["loc"]) or "arguments" for err in exc.errors()})
            raise ValueError(f"invalid arguments: {', '.join(fields)}") from exc

    async def execute(self, tool: Tool, ctx: ToolContext, args: ToolArgs) -> ToolResult:
        from app.core.errors import AppError

        if ctx.role not in tool.roles:
            raise ToolError("没有权限执行此操作")
        try:
            result = tool.func(ctx, args)
            if inspect.isawaitable(result):
                result = await result
        except AppError as exc:
            # 业务错误（含套餐限额 402）作为工具失败返回给助手，由助手转述给用户
            raise ToolError(exc.message) from exc
        return result


registry = ToolRegistry()


def tool(
    name: str,
    *,
    description: str,
    args: type[ToolArgs],
    label: str,
    requires_confirmation: bool = False,
    roles: tuple[str, ...] = ("owner", "member", "operator"),
    describe_confirm: Callable[[ToolContext, Any], dict[str, Any]] | None = None,
    target: ToolRegistry | None = None,
) -> Callable[[ToolFunc], ToolFunc]:
    def decorator(func: ToolFunc) -> ToolFunc:
        (target or registry).register(
            Tool(
                name=name,
                description=description,
                args_model=args,
                func=func,
                label=label,
                roles=roles,
                requires_confirmation=requires_confirmation,
                describe_confirm=describe_confirm,
            )
        )
        return func

    return decorator
