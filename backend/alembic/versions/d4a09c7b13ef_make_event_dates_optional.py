"""Make event planning days participant-defined.

Revision ID: d4a09c7b13ef
Revises: b7c2f4a1d9e0
Create Date: 2026-10-20
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4a09c7b13ef"
down_revision: str | Sequence[str] | None = "b7c2f4a1d9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("events", "start_date", existing_type=sa.Date(), nullable=True)
    op.alter_column("events", "end_date", existing_type=sa.Date(), nullable=True)


def downgrade() -> None:
    op.alter_column("events", "start_date", existing_type=sa.Date(), nullable=False)
    op.alter_column("events", "end_date", existing_type=sa.Date(), nullable=False)
