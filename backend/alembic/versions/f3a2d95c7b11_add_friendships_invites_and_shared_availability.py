"""Add friend requests, event invitations, and shared availability."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f3a2d95c7b11"
down_revision: str | Sequence[str] | None = "e18c7a5d4f21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "friendships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_low_id", sa.Integer(), nullable=False),
        sa.Column("user_high_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("user_low_id < user_high_id", name="ck_friendship_ordered_users"),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'rejected')", name="ck_friendship_status"),
        sa.ForeignKeyConstraint(["user_low_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_high_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_low_id", "user_high_id", name="uq_friendship_pair"),
    )
    op.create_index("ix_friendships_low", "friendships", ["user_low_id"])
    op.create_index("ix_friendships_high_status", "friendships", ["user_high_id", "status"])

    op.create_table(
        "event_invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("invited_by_id", sa.Integer(), nullable=False),
        sa.Column("invited_user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'rejected')", name="ck_event_invitation_status"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("event_id", "invited_user_id", name="uq_event_invitation_recipient"),
    )
    op.create_index("ix_event_invitations_recipient_status", "event_invitations", ["invited_user_id", "status"])

    op.create_table(
        "friend_availability_slots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("slot_start", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "slot_start", name="uq_friend_availability_user_slot"),
    )
    op.create_index("ix_friend_availability_user_slot", "friend_availability_slots", ["user_id", "slot_start"])


def downgrade() -> None:
    op.drop_table("friend_availability_slots")
    op.drop_table("event_invitations")
    op.drop_table("friendships")
