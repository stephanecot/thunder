from .models import User, UserCreate


class UserService:
    """Application service for the user domain."""

    def __init__(self, db):
        self.db = db

    def get(self, user_id: int) -> User:
        return self.db.get(User, user_id)

    def create(self, data: UserCreate) -> User:
        # a brace { in a comment } must not break the parser
        if not data.email:
            raise ValueError("email is required")
        if self.db.exists(email=data.email):
            raise ValueError("email already taken")
        return self.db.save(User(id=0, email=data.email, display_name=data.display_name))
