from langgraph.checkpoint.postgres import PostgresSaver
from psycopg_pool import ConnectionPool

pool: ConnectionPool


def init() -> None:
    raise NotImplementedError


def checkpointer() -> PostgresSaver:
    raise NotImplementedError


def find_leads(query: str | None, industry: str | None, city: str | None, limit: int = 5) -> list[dict]:
    raise NotImplementedError


def get_lead(lead_id: int) -> dict | None:
    raise NotImplementedError


def upsert_pipeline(user_id: str, lead_id: int, stage: str, note: str | None) -> dict:
    raise NotImplementedError


def get_pipeline(user_id: str, stage: str | None = None) -> list[dict]:
    raise NotImplementedError


def save_draft(user_id: str, lead_id: int, subject: str, body: str) -> dict:
    raise NotImplementedError


def get_draft(user_id: str, draft_id: int) -> dict | None:
    raise NotImplementedError


def list_drafts(user_id: str) -> list[dict]:
    raise NotImplementedError


def set_pending_send(user_id: str, draft_id: int, turn_id: str) -> None:
    raise NotImplementedError


def mark_sent(user_id: str, draft_id: int) -> dict:
    raise NotImplementedError


def add_memory(user_id: str, fact: str) -> None:
    raise NotImplementedError


def get_memories(user_id: str, limit: int = 20) -> list[str]:
    raise NotImplementedError


def log_chat(user_id, thread_id, message, reply, tool_calls, tokens_in, tokens_out, ms) -> None:
    raise NotImplementedError


def admin_stats() -> dict:
    raise NotImplementedError


def admin_pipeline() -> list[dict]:
    raise NotImplementedError


def admin_outbox() -> list[dict]:
    raise NotImplementedError


def admin_chats(limit: int = 50) -> list[dict]:
    raise NotImplementedError


def admin_leads() -> list[dict]:
    raise NotImplementedError


def admin_add_lead(data: dict) -> dict:
    raise NotImplementedError
