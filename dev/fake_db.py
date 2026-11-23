"""THROWAWAY in-memory stand-in for B's agent/db.py (same signatures). Do not push."""
from datetime import datetime

from langgraph.checkpoint.memory import InMemorySaver

LEADS = [
    dict(id=1, company="Smile Dental Studio", industry="dental clinic", city="Lahore", employees=12, website="smiledental.example.com",
         contact_name="Ayesha Khan", contact_title="Owner", contact_email="ayesha@smiledental.example.com",
         notes="No online booking; patients call to book and often hit voicemail"),
    dict(id=2, company="BrightCare Dental", industry="dental clinic", city="Lahore", employees=8, website="brightcare.example.com",
         contact_name="Usman Ali", contact_title="Practice Manager", contact_email="usman@brightcare.example.com",
         notes="High no-show rate, sends reminders manually by WhatsApp"),
    dict(id=3, company="IronPeak Gym", industry="gym", city="Dubai", employees=25, website="ironpeak.example.com",
         contact_name="Omar Haddad", contact_title="General Manager", contact_email="omar@ironpeak.example.com",
         notes="Class bookings via Instagram DMs, losing track of capacity"),
    dict(id=4, company="Pulse Fitness", industry="gym", city="Dubai", employees=15, website="pulsefit.example.com",
         contact_name="Lina Saeed", contact_title="Owner", contact_email="lina@pulsefit.example.com",
         notes="Membership renewals tracked in a spreadsheet"),
    dict(id=5, company="Karachi Smiles", industry="dental clinic", city="Karachi", employees=6, website="karachismiles.example.com",
         contact_name="Bilal Ahmed", contact_title="Dentist & Owner", contact_email="bilal@karachismiles.example.com",
         notes="Website has no contact form"),
]
_pipeline, _drafts, _mem = {}, {}, {}


def checkpointer():
    return InMemorySaver()


def find_leads(query, industry, city, limit=5):
    def ok(l):
        hay = " ".join(str(v) for v in l.values()).lower()
        return ((not query or query.lower() in hay) and (not industry or industry.lower() in l["industry"])
                and (not city or city.lower() == l["city"].lower()))
    return [l for l in LEADS if ok(l)][:limit]


def get_lead(lead_id):
    return next((dict(l) for l in LEADS if l["id"] == lead_id), None)


def upsert_pipeline(user_id, lead_id, stage, note):
    row = dict(user_id=user_id, lead_id=lead_id, stage=stage, note=note, updated_at=datetime.now(),
               company=get_lead(lead_id)["company"])
    _pipeline[(user_id, lead_id)] = row
    return row


def get_pipeline(user_id, stage=None):
    return [r for (u, _), r in _pipeline.items() if u == user_id and (not stage or r["stage"] == stage)]


def save_draft(user_id, lead_id, subject, body):
    d = dict(id=len(_drafts) + 1, user_id=user_id, lead_id=lead_id, subject=subject, body=body,
             status="draft", pending_turn=None, created_at=datetime.now(), sent_at=None)
    _drafts[d["id"]] = d
    return d


def get_draft(user_id, draft_id):
    d = _drafts.get(draft_id)
    return dict(d) if d and d["user_id"] == user_id else None


def list_drafts(user_id):
    return [d for d in _drafts.values() if d["user_id"] == user_id]


def set_pending_send(user_id, draft_id, turn_id):
    if get_draft(user_id, draft_id):
        _drafts[draft_id].update(status="pending_send", pending_turn=turn_id)


def mark_sent(user_id, draft_id):
    d = _drafts[draft_id]
    assert d["user_id"] == user_id
    d.update(status="sent", sent_at=datetime.now())
    upsert_pipeline(user_id, d["lead_id"], "contacted", None)
    return d


def add_memory(user_id, fact):
    facts = _mem.setdefault(user_id, [])
    if fact not in facts:
        facts.append(fact)


def get_memories(user_id, limit=20):
    return list(reversed(_mem.get(user_id, [])))[:limit]
