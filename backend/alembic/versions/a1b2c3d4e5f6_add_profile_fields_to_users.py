"""add profile fields to users

Revision ID: a1b2c3d4e5f6
Revises: 666afd7ba97d
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '666afd7ba97d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('phone', sa.String(), nullable=True))
    op.add_column('users', sa.Column('linkedin', sa.String(), nullable=True))
    op.add_column('users', sa.Column('street_address', sa.String(), nullable=True))
    op.add_column('users', sa.Column('city', sa.String(), nullable=True))
    op.add_column('users', sa.Column('state', sa.String(), nullable=True))
    op.add_column('users', sa.Column('country', sa.String(), nullable=True))
    op.add_column('users', sa.Column('postal_code', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'postal_code')
    op.drop_column('users', 'country')
    op.drop_column('users', 'state')
    op.drop_column('users', 'city')
    op.drop_column('users', 'street_address')
    op.drop_column('users', 'linkedin')
    op.drop_column('users', 'phone')
