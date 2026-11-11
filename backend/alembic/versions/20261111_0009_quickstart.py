"""service quickstart: 客户业务描述与快速开始找买家状态

Revision ID: 0009_quickstart
Revises: 0008_service
Create Date: 2026-11-11 20:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_quickstart"
down_revision: str | None = "0008_service"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("service_profiles", sa.Column("business", sa.Text(), nullable=False, server_default=""))
    op.add_column(
        "service_profiles", sa.Column("target_markets", sa.String(length=300), nullable=False, server_default="")
    )
    op.add_column(
        "service_profiles", sa.Column("quickstart_status", sa.String(length=12), nullable=False, server_default="")
    )
    op.add_column(
        "service_profiles", sa.Column("quickstart_error", sa.String(length=200), nullable=False, server_default="")
    )


def downgrade() -> None:
    for col in ("quickstart_error", "quickstart_status", "target_markets", "business"):
        op.drop_column("service_profiles", col)
