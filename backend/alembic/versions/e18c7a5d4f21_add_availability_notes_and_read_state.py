"""Add notes to availability slots and per-member message read state.

Revision ID: e18c7a5d4f21
Revises: d4a09c7b13ef
Create Date: 2026-10-21
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e18c7a5d4f21"
down_revision: str | Sequence[str] | None = "d4a09c7b13ef"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("events", "final_slot_end")
    op.drop_column("events", "final_slot_start")
    op.add_column(
        "availability_slots",
        sa.Column("note", sa.Text(), server_default="", nullable=False),
    )
    op.add_column(
        "event_participants",
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("event_participants", "last_read_at")
    op.drop_column("availability_slots", "note")
    op.add_column("events", sa.Column("final_slot_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("events", sa.Column("final_slot_end", sa.DateTime(timezone=True), nullable=True))
