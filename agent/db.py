import os
from pathlib import Path
from threading import Lock

from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

import seed

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

STAGES = ("new", "contacted", "replied", "meeting", "won", "lost")
pool: ConnectionPool | None = None
_init_lock = Lock()
_schema_lock = 512052603


class DatabaseUnavailable(RuntimeError):
    pass


def init() -> None:
    global pool
    with _init_lock:
        if pool is not None:
            return
        dsn = os.getenv("DATABASE_URL", "").strip()
        if not dsn:
            raise DatabaseUnavailable("DATABASE_URL is required")
        candidate = ConnectionPool(
            dsn,
            min_size=1,
            max_size=5,
            open=False,
            timeout=10,
            kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
            check=ConnectionPool.check_connection,
        )
        try:
            candidate.open(wait=True, timeout=20)
            schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
            with candidate.connection() as conn, conn.transaction():
                conn.execute("SELECT pg_advisory_xact_lock(%s)", (_schema_lock,))
                conn.execute(schema, prepare=False)
                if conn.execute("SELECT NOT EXISTS (SELECT 1 FROM leads) AS empty").fetchone()["empty"]:
                    seed.run(conn)
                PostgresSaver(candidate).setup()
        except Exception:
            candidate.close()
            raise
        pool = candidate


def close() -> None:
    global pool
    with _init_lock:
        if pool is not None:
            pool.close()
            pool = None


def _get_pool() -> ConnectionPool:
    if pool is None:
        init()
    return pool


def checkpointer() -> PostgresSaver:
    return PostgresSaver(_get_pool())


def _rows(sql: str, params: tuple = ()) -> list[dict]:
    with _get_pool().connection() as conn:
        return conn.execute(sql, params).fetchall()


def _row(sql: str, params: tuple = ()) -> dict | None:
    with _get_pool().connection() as conn:
        return conn.execute(sql, params).fetchone()


def _search(value: str | None) -> str | None:
    term = (value or "").strip()
    if not term:
        return None
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def find_leads(query: str | None, industry: str | None, city: str | None, limit: int = 5) -> list[dict]:
    return _rows(
        """
        SELECT leads.*
        FROM leads
        CROSS JOIN (SELECT %s::text AS query, %s::text AS industry, %s::text AS city) AS filters
        WHERE (filters.query IS NULL OR
               concat_ws(' ', leads.company, leads.industry, leads.city, leads.notes)
                   ILIKE filters.query)
          AND (filters.industry IS NULL OR leads.industry ILIKE filters.industry)
          AND (filters.city IS NULL OR leads.city ILIKE filters.city)
        ORDER BY leads.id
        LIMIT %s
        """,
        (_search(query), _search(industry), _search(city), min(max(limit, 0), 10)),
    )


def get_lead(lead_id: int) -> dict | None:
    return _row("SELECT * FROM leads WHERE id = %s", (lead_id,))


def upsert_pipeline(user_id: str, lead_id: int, stage: str, note: str | None) -> dict:
    return _row(
        """
        INSERT INTO pipeline (user_id, lead_id, stage, note) VALUES (%s, %s, %s, %s)
        ON CONFLICT (user_id, lead_id) DO UPDATE
        SET stage = EXCLUDED.stage, note = COALESCE(EXCLUDED.note, pipeline.note), updated_at = now()
        RETURNING *
        """,
        (user_id, lead_id, stage, note),
    )


def get_pipeline(user_id: str, stage: str | None = None) -> list[dict]:
    return _rows(
        """
        SELECT p.lead_id, l.company, l.contact_name, p.stage, p.note, p.updated_at
        FROM pipeline AS p JOIN leads AS l ON l.id = p.lead_id
        WHERE p.user_id = %s AND (%s::text IS NULL OR p.stage = %s)
        ORDER BY p.updated_at DESC, p.lead_id
        """,
        (user_id, stage, stage),
    )


def save_draft(user_id: str, lead_id: int, subject: str, body: str) -> dict:
    return _row(
        """
        INSERT INTO drafts (user_id, lead_id, subject, body) VALUES (%s, %s, %s, %s)
        RETURNING *
        """,
        (user_id, lead_id, subject, body),
    )


def get_draft(user_id: str, draft_id: int) -> dict | None:
    return _row(
        """
        SELECT d.*, l.company, l.contact_email
        FROM drafts AS d JOIN leads AS l ON l.id = d.lead_id
        WHERE d.user_id = %s AND d.id = %s
        """,
        (user_id, draft_id),
    )


def list_drafts(user_id: str) -> list[dict]:
    return _rows(
        """
        SELECT d.id, d.lead_id, l.company, d.subject, d.body, d.status, d.created_at, d.sent_at
        FROM drafts AS d JOIN leads AS l ON l.id = d.lead_id
        WHERE d.user_id = %s ORDER BY d.id DESC
        """,
        (user_id,),
    )


def set_pending_send(user_id: str, draft_id: int, turn_id: str) -> None:
    with _get_pool().connection() as conn:
        conn.execute(
            """
            UPDATE drafts SET status = 'pending_send', pending_turn = %s
            WHERE user_id = %s AND id = %s AND status = 'draft'
            """,
            (turn_id, user_id, draft_id),
        )


def mark_sent(user_id: str, draft_id: int) -> dict:
    with _get_pool().connection() as conn, conn.transaction():
        draft = conn.execute(
            """
            SELECT d.*, l.contact_email
            FROM drafts AS d JOIN leads AS l ON l.id = d.lead_id
            WHERE d.user_id = %s AND d.id = %s FOR UPDATE OF d
            """,
            (user_id, draft_id),
        ).fetchone()
        if draft is None or draft["status"] == "draft":
            raise ValueError("No pending draft with that ID")
        if draft["status"] == "sent":
            return draft
        sent = conn.execute(
            """
            UPDATE drafts SET status = 'sent', pending_turn = NULL, sent_at = now()
            WHERE user_id = %s AND id = %s RETURNING *
            """,
            (user_id, draft_id),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO pipeline (user_id, lead_id, stage) VALUES (%s, %s, 'contacted')
            ON CONFLICT (user_id, lead_id) DO UPDATE SET stage = 'contacted', updated_at = now()
            """,
            (user_id, sent["lead_id"]),
        )
        return {**sent, "contact_email": draft["contact_email"]}


def add_memory(user_id: str, fact: str) -> None:
    with _get_pool().connection() as conn:
        conn.execute(
            "INSERT INTO memories (user_id, fact) VALUES (%s, %s) ON CONFLICT (user_id, fact) DO NOTHING",
            (user_id, fact),
        )


def get_memories(user_id: str, limit: int = 20) -> list[str]:
    rows = _rows(
        "SELECT fact FROM memories WHERE user_id = %s ORDER BY id DESC LIMIT %s",
        (user_id, min(max(limit, 0), 100)),
    )
    return [row["fact"] for row in rows]


def log_chat(
    user_id: str, thread_id: str, message: str, reply: str,
    tool_calls: list[dict], tokens_in: int, tokens_out: int, ms: int,
) -> None:
    with _get_pool().connection() as conn:
        conn.execute(
            """
            INSERT INTO chat_log (user_id, thread_id, message, reply, tool_calls, tokens_in, tokens_out, ms)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (user_id, thread_id, message, reply, Jsonb(tool_calls), tokens_in, tokens_out, ms),
        )


def admin_stats() -> dict:
    stats = _row(
        """
        SELECT (SELECT count(*) FROM (
                    SELECT user_id FROM chat_log UNION
                    SELECT user_id FROM pipeline UNION
                    SELECT user_id FROM drafts UNION
                    SELECT user_id FROM memories
                ) AS active_users) AS users,
               (SELECT count(*) FROM leads) AS leads,
               (SELECT count(*) FROM drafts) AS drafts,
               (SELECT count(*) FROM drafts WHERE status = 'sent') AS sent,
               (SELECT jsonb_object_agg(stage, total) FROM (
                   SELECT stage, count(*) AS total FROM pipeline GROUP BY stage
               ) AS counts) AS pipeline,
               count(*) AS chats, COALESCE(sum(tokens_in), 0) AS tokens_in,
               COALESCE(sum(tokens_out), 0) AS tokens_out,
               COALESCE(round(avg(ms)::numeric, 1), 0)::float AS avg_ms
        FROM chat_log
        """
    )
    stats["pipeline"] = {stage: (stats["pipeline"] or {}).get(stage, 0) for stage in STAGES}
    return stats


def admin_pipeline() -> list[dict]:
    return _rows(
        """
        SELECT p.user_id, p.lead_id, l.company, p.stage, p.note, p.updated_at
        FROM pipeline AS p JOIN leads AS l ON l.id = p.lead_id
        ORDER BY p.updated_at DESC, p.user_id, p.lead_id
        """
    )


def admin_outbox() -> list[dict]:
    return _rows(
        """
        SELECT d.id, d.user_id, l.company, l.contact_email, d.subject, d.body, d.sent_at
        FROM drafts AS d JOIN leads AS l ON l.id = d.lead_id
        WHERE d.status = 'sent' ORDER BY d.sent_at DESC, d.id DESC
        """
    )


def admin_chats(limit: int = 50) -> list[dict]:
    return _rows(
        """
        SELECT user_id, thread_id, message, reply, tool_calls, tokens_in, tokens_out, ms, created_at
        FROM chat_log ORDER BY id DESC LIMIT %s
        """,
        (min(max(limit, 0), 200),),
    )


def admin_leads() -> list[dict]:
    return _rows("SELECT * FROM leads ORDER BY id")


def admin_add_lead(data: dict) -> dict:
    return _row(
        """
        INSERT INTO leads (company, industry, city, employees, website, contact_name,
                           contact_title, contact_email, notes)
        VALUES (%(company)s, %(industry)s, %(city)s, %(employees)s, %(website)s, %(contact_name)s,
                %(contact_title)s, %(contact_email)s, %(notes)s)
        RETURNING *
        """,
        {key: data.get(key) for key in (
            "company", "industry", "city", "employees", "website",
            "contact_name", "contact_title", "contact_email", "notes",
        )},
    )
