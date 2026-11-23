"""Agent tools. user_id / turn_id come from LangGraph config, never from the model."""
import json

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

import db

STAGES = ("new", "contacted", "replied", "meeting", "won", "lost")
LEAD_FIELDS = ("id", "company", "industry", "city", "employees", "contact_name", "contact_title", "notes")


def _ids(config: RunnableConfig) -> tuple[str, str]:
    c = config["configurable"]
    return c["user_id"], c.get("turn_id", "")


def _j(x) -> str:
    return json.dumps(x, default=str, ensure_ascii=False)


# ponytail: mirrors agent/seed.py; leads added via admin with new industries are still found by `query`
INDUSTRIES = "dental clinic, gym, real-estate agency, restaurant, e-commerce store, SaaS startup"
CITIES = "Lahore, Karachi, Islamabad, Dubai, London"


@tool
def find_leads(query: str = "", industry: str = "", city: str = "", limit: int = 5) -> str:
    """Search the prospect database. Returns up to `limit` (max 10) leads.
    industry: exactly one of: dental clinic, gym, real-estate agency, restaurant, e-commerce store, SaaS startup.
    city: one of Lahore, Karachi, Islamabad, Dubai, London.
    query: ONE optional keyword matched against company/notes (e.g. "booking"); leave empty when industry/city suffice."""
    rows = db.find_leads(query or None, industry or None, city or None, max(1, min(int(limit), 10)))
    if not rows:
        return (f"No leads found. Use exact values. Industries: {INDUSTRIES}. Cities: {CITIES}. "
                "Retry with industry and/or city only, without query.")
    return _j([{k: r.get(k) for k in LEAD_FIELDS} for r in rows])


@tool
def get_lead(lead_id: int) -> str:
    """Get full details of one lead (contact, email, notes/pain points) to personalise outreach."""
    lead = db.get_lead(int(lead_id))
    return _j(lead) if lead else f"ERROR: no lead with id {lead_id}"


@tool
def save_draft(lead_id: int, subject: str, body: str, config: RunnableConfig) -> str:
    """Save an outreach email for a lead as a draft. Returns the draft id."""
    user_id, _ = _ids(config)
    if not db.get_lead(int(lead_id)):
        return f"ERROR: no lead with id {lead_id}"
    if not subject.strip() or not body.strip():
        return "ERROR: subject and body are required"
    d = db.save_draft(user_id, int(lead_id), subject.strip(), body.strip())
    return f"Draft saved with id {d['id']}. It is NOT sent."


@tool
def send_email(draft_id: int, config: RunnableConfig) -> str:
    """Send a saved draft. Risky: the first call only requests confirmation; it sends only after the user confirms in a later message."""
    user_id, turn_id = _ids(config)
    d = db.get_draft(user_id, int(draft_id))
    if not d:
        return f"ERROR: no draft with id {draft_id}"
    if d["status"] == "sent":
        return "Already sent."
    if d["status"] == "draft":
        db.set_pending_send(user_id, d["id"], turn_id)
        return "CONFIRMATION_REQUIRED: show the user the draft and ask them to confirm. Do not send yet."
    if d.get("pending_turn") == turn_id:
        return "CONFIRMATION_REQUIRED: the user must confirm in their next message."
    db.mark_sent(user_id, d["id"])
    lead = db.get_lead(d["lead_id"]) or {}
    return f"SENT to {lead.get('contact_email', 'the lead')}. Pipeline stage set to contacted."


@tool
def update_pipeline(lead_id: int, stage: str, config: RunnableConfig, note: str = "") -> str:
    """Add a lead to the user's pipeline or move it to a stage: new, contacted, replied, meeting, won, lost."""
    user_id, _ = _ids(config)
    stage = stage.strip().lower()
    if stage not in STAGES:
        return f"ERROR: stage must be one of {', '.join(STAGES)}"
    if not db.get_lead(int(lead_id)):
        return f"ERROR: no lead with id {lead_id}"
    return _j(db.upsert_pipeline(user_id, int(lead_id), stage, note or None))


@tool
def view_pipeline(config: RunnableConfig, stage: str = "") -> str:
    """Show the user's sales pipeline, optionally filtered by stage."""
    user_id, _ = _ids(config)
    rows = db.get_pipeline(user_id, stage.strip().lower() or None)
    return _j(rows) if rows else "Your pipeline is empty."


@tool
def remember(fact: str, config: RunnableConfig) -> str:
    """Save a lasting fact about the user (name, company, product, ideal customer, tone, signature, preference)."""
    user_id, _ = _ids(config)
    fact = fact.strip()[:300]
    if not fact:
        return "ERROR: empty fact"
    db.add_memory(user_id, fact)
    return "Remembered."


TOOLS = [find_leads, get_lead, save_draft, send_email, update_pipeline, view_pipeline, remember]
