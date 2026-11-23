# Person B: Backend, database and deployment

> GrowthPilot: an AI sales and outreach engine. It finds leads, writes outreach and tracks the pipeline.
> Your job is the **body**: the Postgres database, all SQL, the FastAPI server, deployment to Render and the benchmark runner.
> **You go first:** the skeleton you push in the first 30 minutes unblocks A and C.
> Master plan: `PLAN.md`. Teammates: **A** (agent brain), **C** (website/README/demo).

## Your files (only you edit these)

```
agent/app.py            FastAPI routes
agent/db.py             connection pool, checkpointer, ALL SQL
agent/schema.sql        tables
agent/seed.py           ~30 demo leads
agent/requirements.txt  (shared need, you own it)
agent/Dockerfile
render.yaml
bench.py                runs tests.json against the live API
.env.example, .gitignore
docs/deploy-notes.md
```

**Don't edit:** `agent/graph.py`, `tools.py`, `prompts.py`, `guard.py`, `tests.json` (owned by A), or anything in `web/` or `README.md` (owned by C).

## Git

- **First commit goes straight to `main`** (the skeleton). After that, use branch `b/backend`.
- Before every push: `git pull --rebase origin main`. Merge at CP1 and CP2.
- `.gitignore` is in the very first commit: `.env`, `.venv/`, `__pycache__/`, `web/mock/`.

## Timeline

| When | Task |
|---|---|
| **T+0:00–0:30** | **Skeleton to `main`:** folders, `.gitignore`, `.env.example`, `requirements.txt`, `schema.sql`, `db.py` (all signatures, bodies may `raise NotImplementedError`), `app.py` with `/health`. Tell the group |
| T+0:30–2:00 | Neon project, `db.py` bodies, `seed.py`, `/chat` wired to `graph.run_turn`, first Render deploy |
| **CP1 T+2:00** | `/health` live on Render, Neon seeded. Send the URL to A and C |
| T+2:00–3:30 | `/me/*` and admin endpoints, error handling, `bench.py` |
| **CP2 T+3:30** | Feature freeze. Everything on `main` and deployed |
| T+3:30–5:00 | Run `bench.py` on prod → `docs/bench.md` (give it to C), set up the keep-alive monitor |
| T+5:00–6:00 | `docs/deploy-notes.md` → give it to C |

---

## Contracts (frozen; you own them, so changes go through the group chat first)

### Environment (`.env.example`)
```
ANTHROPIC_API_KEY=        # group key, never commit
DATABASE_URL=             # Neon direct (non-pooler) URL, ends with ?sslmode=require
ADMIN_TOKEN=change-me     # admin dashboard password
MODEL=claude-haiku-5-5
```

### `agent/schema.sql`
```sql
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  company TEXT NOT NULL, industry TEXT NOT NULL, city TEXT NOT NULL,
  employees INT, website TEXT,
  contact_name TEXT, contact_title TEXT, contact_email TEXT,   -- MUST be @example.com
  notes TEXT
);
CREATE TABLE IF NOT EXISTS pipeline (
  user_id TEXT NOT NULL, lead_id INT NOT NULL REFERENCES leads(id),
  stage TEXT NOT NULL CHECK (stage IN ('new','contacted','replied','meeting','won','lost')),
  note TEXT, updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, lead_id)
);
CREATE TABLE IF NOT EXISTS drafts (
  id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, lead_id INT NOT NULL REFERENCES leads(id),
  subject TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_send','sent')),
  pending_turn TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), sent_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, fact TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (user_id, fact)
);
CREATE TABLE IF NOT EXISTS chat_log (
  id SERIAL PRIMARY KEY, user_id TEXT, thread_id TEXT, message TEXT, reply TEXT,
  tool_calls JSONB, tokens_in INT, tokens_out INT, ms INT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_user ON drafts(user_id);
CREATE INDEX IF NOT EXISTS memories_user ON memories(user_id);
```

### `agent/db.py` (A calls these from `tools.py` and `graph.py`)
```python
pool: ConnectionPool
def init() -> None
def checkpointer() -> PostgresSaver

def find_leads(query: str|None, industry: str|None, city: str|None, limit: int = 5) -> list[dict]
def get_lead(lead_id: int) -> dict | None

def upsert_pipeline(user_id, lead_id: int, stage: str, note: str|None) -> dict
def get_pipeline(user_id, stage: str|None = None) -> list[dict]      # join leads: company, contact_name

def save_draft(user_id, lead_id: int, subject: str, body: str) -> dict
def get_draft(user_id, draft_id: int) -> dict | None
def list_drafts(user_id) -> list[dict]                              # join leads: company
def set_pending_send(user_id, draft_id: int, turn_id: str) -> None  # status='pending_send', pending_turn=turn_id
def mark_sent(user_id, draft_id: int) -> dict                       # status='sent', sent_at=now(); upsert pipeline stage 'contacted'

def add_memory(user_id, fact: str) -> None                          # ON CONFLICT DO NOTHING
def get_memories(user_id, limit: int = 20) -> list[str]             # newest first

def log_chat(user_id, thread_id, message, reply, tool_calls, tokens_in, tokens_out, ms) -> None
def admin_stats() -> dict
def admin_pipeline() -> list[dict]
def admin_outbox() -> list[dict]
def admin_chats(limit: int = 50) -> list[dict]
def admin_leads() -> list[dict]
def admin_add_lead(data: dict) -> dict
```

### What A gives you (`agent/graph.py`)
```python
def run_turn(user_id: str, thread_id: str, message: str) -> dict
# → {"reply": str, "tool_calls": [{"name","args"}], "tokens": {"in": int, "out": int}}
```
Until A merges it, put a stub at the top of `app.py`'s `/chat` that echoes. Remove it at CP1.

### HTTP API (C consumes it; **the grader hits `/chat` and `/health`, so match this exactly**)

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /health` | none | | plain text `ok` |
| `POST /chat` | none | `{"user_id","thread_id","message"}` | `{"reply","tool_calls":[{"name","args"}],"tokens":{"in","out"}}` |
| `GET /me/pipeline?user_id=` | none | | `[{lead_id, company, contact_name, stage, note, updated_at}]` |
| `GET /me/drafts?user_id=` | none | | `[{id, lead_id, company, subject, body, status, created_at, sent_at}]` |
| `GET /admin/stats` | `X-Admin-Token` | | `{users, leads, pipeline:{stage:count}, drafts, sent, chats, tokens_in, tokens_out, avg_ms}` |
| `GET /admin/pipeline` | `X-Admin-Token` | | `[{user_id, lead_id, company, stage, note, updated_at}]` |
| `GET /admin/outbox` | `X-Admin-Token` | | `[{id, user_id, company, contact_email, subject, body, sent_at}]` |
| `GET /admin/chats` | `X-Admin-Token` | | `[{user_id, thread_id, message, reply, tool_calls, tokens_in, tokens_out, ms, created_at}]` |
| `GET /admin/leads` | `X-Admin-Token` | | all leads |
| `POST /admin/leads` | `X-Admin-Token` | lead fields | created row |

---

## Tasks

### B.1 Skeleton (T+0:30, do this first)
`agent/requirements.txt`:
```
fastapi
uvicorn[standard]
langgraph
langgraph-checkpoint-postgres
langchain-anthropic
psycopg[binary,pool]
python-dotenv
```
Once it runs locally, pin the versions with `pip freeze`. Push the skeleton and post "skeleton on main" in the group chat.

### B.2 Neon
- Create the project `growthpilot` at neon.tech. Copy the **direct** connection string (not the `-pooler` host) with `?sslmode=require`.
- Create the branches `dev-a`, `dev-b` and `dev-c` (free) so everyone tests without touching prod data, and send each person their URL **privately**.
- Prod uses the `main` branch URL.

### B.3 `db.py`
```python
pool = ConnectionPool(os.environ["DATABASE_URL"], min_size=1, max_size=5, open=True,
                      kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
                      check=ConnectionPool.check_connection)   # Neon drops idle connections
```
- `init()`: execute `schema.sql`, run `PostgresSaver(pool).setup()`, and call `seed.run()` if `SELECT count(*) FROM leads` = 0.
- **Every per-user query has `WHERE user_id = %s`** (this is the 5-mark isolation score). **Always use `%s` parameters, never f-strings in SQL.**
- `find_leads`: `ILIKE '%'||%s||'%'` across company/industry/city/notes, optional exact-ish industry/city filters, `LIMIT LEAST(%s, 10)`.
- Return plain dicts (`dict_row`), with timestamps left as-is (A uses `default=str`).

### B.4 `seed.py`
- About 30 fictional leads: 6 industries (dental clinic, gym, real-estate agency, restaurant, e-commerce store, SaaS startup) × 5 cities (Lahore, Karachi, Islamabad, Dubai, London).
- `contact_email` = `firstname@<company-slug>.example.com`, **never a real domain**.
- `notes` = one concrete pain point per lead ("no online booking, takes appointments by phone", "Instagram-only marketing, no website"). The agent uses it to personalise emails, so make them specific.
- Send A the list of industries and cities for the form answers.

### B.5 `app.py`
- `load_dotenv()`, call `db.init()` on startup, add `CORSMiddleware(allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])`.
- `class ChatIn(BaseModel): user_id: str = Field(min_length=1, max_length=64); thread_id: str = Field(min_length=1, max_length=64); message: str = Field(min_length=1, max_length=2000)`.
- `/health` → `PlainTextResponse("ok")`.
- `/chat`:
  ```python
  t = time.time()
  try: out = graph.run_turn(body.user_id, body.thread_id, body.message)
  except Exception: log traceback; out = {"reply": "Sorry, something went wrong on my side. Please try again.", "tool_calls": [], "tokens": {"in": 0, "out": 0}}
  db.log_chat(..., ms=int((time.time()-t)*1000))   # also inside try/except; logging must never break chat
  return out
  ```
  **The grader must never see a 500 from `/chat`.**
- Admin routes use a dependency that checks `request.headers.get("X-Admin-Token") == os.environ["ADMIN_TOKEN"]`, else 401.
- Use plain `def` routes (FastAPI runs them in a threadpool, and the graph is synchronous).

### B.6 Deploy on Render
`agent/Dockerfile`:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
```
`render.yaml` (repo root):
```yaml
services:
  - type: web
    name: growthpilot-api
    runtime: docker
    rootDir: agent
    plan: free
    healthCheckPath: /health
    envVars:
      - { key: ANTHROPIC_API_KEY, sync: false }
      - { key: DATABASE_URL, sync: false }
      - { key: ADMIN_TOKEN, sync: false }
      - { key: MODEL, value: claude-haiku-5-5 }
```
- Render dashboard → New → Blueprint → connect the GitHub repo, then fill in the secret env vars.
- **Cold starts:** the free tier sleeps after 15 min idle, and the first request takes ~50 s, which hurts the reliability and speed scores. Create a free **cron-job.org** (or UptimeRobot) monitor: `GET https://<render-url>/health` **every 10 min**. Keep it running until **Wed 25 Nov**.
- Verify:
  ```bash
  curl https://<render-url>/health
  curl -X POST https://<render-url>/chat -H "Content-Type: application/json" -d "{\"user_id\":\"u1\",\"thread_id\":\"t1\",\"message\":\"find gyms in Dubai\"}"
  ```

### B.7 `bench.py` (stdlib only: `urllib.request`, `json`, `time`, `sys`)
- `python bench.py https://<render-url>` loads `tests.json` (format from A below) and appends a run suffix to every `user_id` (`f"{uid}_{int(time.time())}"`) so reruns start with empty memory.
- For each case, send each of its `turns` to `/chat` in order. On the last turn check:
  - `expect_tools ⊆ {tc["name"] for tc in tool_calls}`
  - at least one of `expect_reply_any` in the reply (if the list isn't empty)
  - none of `expect_reply_none` in the reply
- Record latency, tokens in/out and pass/fail.
- Write `docs/bench.md`: a table `| # | category | expected behaviour | result | latency ms | tokens in/out |`, plus a totals line (pass rate, p50 / max latency, total tokens, estimated cost at **$0.10 / $0.50 per 1M** input/output tokens).
- **Run on prod at most 2–3 times.** It spends the group's $2 key, and the cost score reads that usage.

`tests.json` format (written by A):
```json
[{"id": 1, "category": "task", "user_id": "test_alice", "thread_id": "t1",
  "turns": ["Find me 3 dental clinics in Lahore"],
  "expected_behaviour": "...", "expect_tools": ["find_leads"],
  "expect_reply_any": ["dental"], "expect_reply_none": []}]
```

### B.8 `docs/deploy-notes.md`
Env vars, the Neon steps, the Render steps, the Vercel steps (Root Directory `web`, preset *Other*), the keep-alive monitor and how to run locally (`cd agent && uvicorn app:app --reload`). C pastes this into the README.

## Hand-offs

| You give | To | When |
|---|---|---|
| Skeleton on `main` | A, C | **T+0:30** |
| Dev `DATABASE_URL`s (private) | A, C | T+1:00 |
| Seed list (industries, cities) | A | T+1:30 |
| Render URL | A, C | CP1 T+2:00 |
| `docs/bench.md` | C | T+4:30 |
| `docs/deploy-notes.md` | C | T+5:00 |

| You need | From | When |
|---|---|---|
| `graph.run_turn` | A | CP1 T+2:00 |
| `tests.json` | A | CP2 T+3:30 |
