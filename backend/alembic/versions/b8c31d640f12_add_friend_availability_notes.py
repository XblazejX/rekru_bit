"""Add notes to personal friend availability slots."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8c31d640f12"
down_revision: str | Sequence[str] | None = "a72c91e4b503"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "friend_availability_slots",
        sa.Column("note", sa.String(length=500), server_default="", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("friend_availability_slots", "note")
