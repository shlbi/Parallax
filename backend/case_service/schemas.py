from __future__ import annotations

from datetime import date
from typing import Literal
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class Login(Input):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=1, max_length=1024)
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class CaseCreate(Input):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    kind: Literal["self", "participant", "fictional"] = "self"


class CasePatch(Input):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    state: Literal["active", "archived"] | None = None


class MemberInput(Input):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    role: Literal["editor", "viewer"]


Action = Literal["case_records", "document_analysis", "image_review"]


class GrantInput(Input):
    participant_reference: str = Field(min_length=1, max_length=160)
    purpose: str = Field(min_length=1, max_length=2000)
    source_scope: list[str] = Field(min_length=1, max_length=20)
    actions: list[Action] = Field(min_length=1, max_length=3)
    signed_on: date | None = None
    expires_at: AwareDatetime | None = None

    @field_validator("source_scope")
    @classmethod
    def validate_scope(cls, values):
        values = [v.strip() for v in values]
        if any(not v or len(v) > 200 for v in values):
            raise ValueError("Source references must contain 1 to 200 characters.")
        return list(dict.fromkeys(values))

    @field_validator("actions")
    @classmethod
    def unique_actions(cls, values):
        return list(dict.fromkeys(values))


class RevokeInput(Input):
    reason: str = Field(min_length=1, max_length=500)
