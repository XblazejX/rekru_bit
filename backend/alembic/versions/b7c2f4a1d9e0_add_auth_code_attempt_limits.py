"""add_auth_code_attempt_limits

Revision ID: b7c2f4a1d9e0
Revises: c9aa66e9aaa2
Create Date: 2026-10-19

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b7c2f4a1d9e0"
down_revision: str | Sequence[str] | None = "c9aa66e9aaa2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("verification_attempts", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("reset_password_attempts", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "reset_password_attempts")
    op.drop_column("users", "verification_attempts")
