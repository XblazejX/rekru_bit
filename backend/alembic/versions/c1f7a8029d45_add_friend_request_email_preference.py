"""Add the friend request email preference."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c1f7a8029d45"
down_revision: str | Sequence[str] | None = "b8c31d640f12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_on_friend_requests", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "email_on_friend_requests")
