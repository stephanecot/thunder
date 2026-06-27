from dataclasses import dataclass, field
from decimal import Decimal


@dataclass
class Order:
    id: int
    user_id: int
    amount: Decimal
    status: str = "NEW"
    lines: list = field(default_factory=list)
