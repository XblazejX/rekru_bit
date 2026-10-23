from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class UserRegister(BaseModel):
    first_name: str = Field(..., min_length=2, max_length=50)
    last_name: str = Field(..., min_length=2, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str
    notify_on_events: bool

    @model_validator(mode="after")
    def passwords_match(self) -> "UserRegister":
        self.first_name = self.first_name.strip()
        self.last_name = self.last_name.strip()
        if len(self.first_name) < 2 or len(self.last_name) < 2:
            raise ValueError("Imię i nazwisko muszą mieć co najmniej 2 znaki")
        if self.password != self.confirm_password:
            raise ValueError("Hasła muszą być identyczne")
        return self


class UserVerify(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        if not v.isdigit():
            raise ValueError("Kod weryfikacyjny musi składać się wyłącznie z 6 cyfr")
        return v


class UserResendCode(BaseModel):
    email: EmailStr


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserDelete(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


class ForgotPassword(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)
    confirm_new_password: str

    @model_validator(mode="after")
    def passwords_match(self) -> "ResetPassword":
        if self.new_password != self.confirm_new_password:
            raise ValueError("Hasła muszą być identyczne")
        return self


class UserUpdate(BaseModel):
    first_name: str | None = Field(None, min_length=2, max_length=50)
    last_name: str | None = Field(None, min_length=2, max_length=50)
    notify_on_events: bool | None = None
    email_on_friend_requests: bool | None = None
    theme: str | None = Field(None, pattern="^(dark|light)$")
    friend_code: str | None = Field(None, min_length=6, max_length=6, pattern="^[A-Za-z0-9]{6}$")
    password: str | None = Field(None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def require_at_least_one_change(self) -> "UserUpdate":
        if not self.model_fields_set:
            raise ValueError("Podaj przynajmniej jedno pole do zmiany")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Pola profilu nie mogą być puste")
        if self.friend_code is not None and self.password is None:
            raise ValueError("Potwierdź zmianę identyfikatora hasłem")
        for field in ("first_name", "last_name"):
            value = getattr(self, field)
            if value is not None:
                value = value.strip()
                if len(value) < 2:
                    raise ValueError("Imię i nazwisko muszą mieć co najmniej 2 znaki")
                setattr(self, field, value)
        if self.friend_code is not None:
            self.friend_code = self.friend_code.upper()
        return self


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    email: str
    friend_code: str
    is_active: bool
    notify_on_events: bool
    email_on_friend_requests: bool
    theme: str
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
