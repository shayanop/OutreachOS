import logging
import os
from contextlib import asynccontextmanager
from importlib import import_module
from secrets import compare_digest
from time import perf_counter
from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field, StringConstraints

import db

logger = logging.getLogger(__name__)
UserId = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[^:\x00-\x20\x7f]+$")]
ThreadId = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[^\x00-\x20\x7f]+$")]
RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ContactEmail = Annotated[str, StringConstraints(
    strip_whitespace=True, max_length=254,
    pattern=r"(?i)^[^@\s]+@([a-z0-9-]+\.)*example\.com$",
)]


class ChatIn(BaseModel):
    user_id: UserId
    thread_id: ThreadId
    message: str = Field(min_length=1, max_length=2000)


class ToolCall(BaseModel):
    name: str
    args: dict[str, Any]


class TokenUsage(BaseModel):
    input_tokens: int = Field(alias="in", ge=0)
    out: int = Field(ge=0)


class ChatOut(BaseModel):
    reply: str
    tool_calls: list[ToolCall]
    tokens: TokenUsage


class LeadIn(BaseModel):
    company: RequiredText
    industry: RequiredText
    city: RequiredText
    employees: int | None = Field(default=None, ge=0, le=2_147_483_647)
    website: str | None = Field(default=None, max_length=500)
    contact_name: str | None = Field(default=None, max_length=200)
    contact_title: str | None = Field(default=None, max_length=200)
    contact_email: ContactEmail | None = None
    notes: str | None = Field(default=None, max_length=1000)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.getenv("DATABASE_URL", "").strip():
        db.init()
    else:
        logger.warning("DATABASE_URL is unset. Start Postgres to enable persistence.")
    try:
        yield
    finally:
        db.close()


app = FastAPI(title="GrowthPilot API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(db.DatabaseUnavailable)
async def database_unavailable(_request, _error):
    return JSONResponse({"detail": "Database is unavailable"}, status_code=503)


def require_admin(x_admin_token: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected or expected == "change-me" or not x_admin_token:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    if not compare_digest(x_admin_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid admin token")


admin = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


def empty_turn(reply: str) -> ChatOut:
    return ChatOut(reply=reply, tool_calls=[], tokens=TokenUsage(**{"in": 0, "out": 0}))


def run_agent(body: ChatIn) -> ChatOut:
    try:
        graph = import_module("graph")
    except ModuleNotFoundError as error:
        if error.name != "graph":
            raise
        return empty_turn("The GrowthPilot agent is still being connected. Please try again later.")
    return ChatOut.model_validate(graph.run_turn(body.user_id, body.thread_id, body.message))


@app.get("/health", response_class=PlainTextResponse)
def health() -> str:
    return "ok"


@app.post("/chat", response_model=ChatOut)
def chat(body: ChatIn) -> ChatOut:
    started = perf_counter()
    try:
        out = run_agent(body)
    except Exception:
        logger.exception("Agent turn failed")
        out = empty_turn("Sorry, something went wrong on my side. Please try again.")
    try:
        db.log_chat(
            body.user_id, body.thread_id, body.message, out.reply,
            [call.model_dump() for call in out.tool_calls], out.tokens.input_tokens,
            out.tokens.out, int((perf_counter() - started) * 1000),
        )
    except db.DatabaseUnavailable:
        logger.warning("Chat log skipped because the database is unavailable")
    except Exception:
        logger.exception("Chat log write failed")
    return out


@app.get("/me/pipeline")
def get_pipeline(user_id: Annotated[UserId, Query()]) -> list[dict]:
    return db.get_pipeline(user_id)


@app.get("/me/drafts")
def get_drafts(user_id: Annotated[UserId, Query()]) -> list[dict]:
    return db.list_drafts(user_id)


@admin.get("/stats")
def get_stats() -> dict:
    return db.admin_stats()


@admin.get("/pipeline")
def get_admin_pipeline() -> list[dict]:
    return db.admin_pipeline()


@admin.get("/outbox")
def get_outbox() -> list[dict]:
    return db.admin_outbox()


@admin.get("/chats")
def get_chats(limit: Annotated[int, Query(ge=1, le=200)] = 50) -> list[dict]:
    return db.admin_chats(limit)


@admin.get("/leads")
def get_leads() -> list[dict]:
    return db.admin_leads()


@admin.post("/leads")
def add_lead(body: LeadIn) -> dict:
    return db.admin_add_lead(body.model_dump())


app.include_router(admin)
