"""代运营服务：客户开通信息、服务任务（运营待办）。

客户（工厂老板）只做两件事：上传资料、看结果。建站、找买家由运营团队在后台完成。
- ServiceProfile：开通向导中客户填写 / 选择的内容（风格、已有网站链接），以及服务进度中由运营推进的节点
- ServiceTask：运营待办（整理资料、制作网站、修改网站、设置找买家），客户的修改意见也落在这里
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin, utcnow

TASK_KINDS = {
    "organize": "整理资料",
    "build_site": "制作网站",
    "revise_site": "修改网站",
    "setup_buyers": "设置找买家",
}
TASK_STATUSES = ("open", "doing", "done", "cancelled")


class ServiceProfile(Base):
    __tablename__ = "service_profiles"

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    # 客户在向导中选的网站风格（STYLE_PRESETS 的 key；"own" 表示按工厂自己的风格）
    style_choice: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    existing_links: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 运营把网站发给客户确认的时间；客户确认上线的时间
    review_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    buyers_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class ServiceTask(IdMixin, TimestampMixin, Base):
    __tablename__ = "service_tasks"
    __table_args__ = (Index("ix_service_tasks_status_created", "status", "created_at"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="open")
    # 客户提交的说明（修改意见等），只作为纯文本展示
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    asset_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
