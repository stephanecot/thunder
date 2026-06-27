from pydantic import BaseModel, EmailStr, Field


class User(BaseModel):
    id: int
    email: EmailStr
    display_name: str = ""
    is_active: bool = True


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str = Field(default="", max_length=80)
