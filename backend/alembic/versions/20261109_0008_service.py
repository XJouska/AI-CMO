"""service: 代运营服务（开通信息、服务任务）、官网风格、话术中文对照

Revision ID: 0008_service
Revises: 0007_ops_billing
Create Date: 2026-11-09 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_service"
down_revision: str | None = "0007_ops_billing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "service_profiles",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("style_choice", sa.String(length=24), nullable=False, server_default=""),
        sa.Column("existing_links", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("buyers_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_service_profiles_company_id_companies"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("company_id", name=op.f("pk_service_profiles")),
    )
    op.create_table(
        "service_tasks",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("asset_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("assignee_id", sa.Uuid(), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detail", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_service_tasks_company_id_companies"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_service_tasks_created_by_users"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["assignee_id"], ["users.id"], name=op.f("fk_service_tasks_assignee_id_users"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_service_tasks")),
    )
    op.create_index(op.f("ix_service_tasks_company_id"), "service_tasks", ["company_id"], unique=False)
    op.create_index("ix_service_tasks_status_created", "service_tasks", ["status", "created_at"], unique=False)
    op.add_column(
        "sites", sa.Column("style", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}")
    )
    op.add_column("outreach_drafts", sa.Column("subject_zh", sa.String(length=200), nullable=False, server_default=""))
    op.add_column("outreach_drafts", sa.Column("body_zh", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("outreach_drafts", "body_zh")
    op.drop_column("outreach_drafts", "subject_zh")
    op.drop_column("sites", "style")
    op.drop_index("ix_service_tasks_status_created", table_name="service_tasks")
    op.drop_index(op.f("ix_service_tasks_company_id"), table_name="service_tasks")
    op.drop_table("service_tasks")
    op.drop_table("service_profiles")
