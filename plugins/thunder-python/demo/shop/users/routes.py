from fastapi import APIRouter, Depends, HTTPException

from .models import User, UserCreate
from .service import UserService

router = APIRouter(tags=["users"])


def get_user_service() -> UserService:
    return UserService(db=None)


@router.post("/users", response_model=User, status_code=201)
def create_user(
    data: UserCreate,
    svc: UserService = Depends(get_user_service),
) -> User:
    return svc.create(data)


@router.get("/users/{id}", response_model=User)
async def get_user(
    id: int,
    svc: UserService = Depends(get_user_service),
) -> User:
    user = svc.get(id)
    if user is None:
        raise HTTPException(status_code=404, detail="not found")
    return user
