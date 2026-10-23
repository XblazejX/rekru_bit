"""Add unique friend codes to user profiles."""

import secrets
import string
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a72c91e4b503"
down_revision: str | Sequence[str] | None = "f3a2d95c7b11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("friend_code", sa.String(length=6), nullable=True))
    connection = op.get_bind()
    user_ids = connection.execute(sa.text("SELECT id FROM users ORDER BY id")).scalars().all()
    alphabet = string.ascii_uppercase.replace("I", "").replace("O", "") + "23456789"
    used: set[str] = set()
    for user_id in user_ids:
        while True:
            code = "".join(secrets.choice(alphabet) for _ in range(6))
            if code not in used:
                used.add(code)
                break
        connection.execute(
            sa.text("UPDATE users SET friend_code = :code WHERE id = :user_id"),
            {"code": code, "user_id": user_id},
        )
    op.alter_column("users", "friend_code", nullable=False)
    op.create_index("ix_users_friend_code", "users", ["friend_code"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_friend_code", table_name="users")
    op.drop_column("users", "friend_code")
