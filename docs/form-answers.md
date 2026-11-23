# Submission form answers (GrowthPilot)

> Paste these into the form. They describe exactly what the code does. If B or C changes something (e.g. seed data), update this file first.

**Track:** GrowthPilot: AI sales and outreach engine (find leads, write outreach, track pipeline).

**Model:** `claude-haiku-5-5` via LangChain `ChatAnthropic`, thinking disabled, effort `low`, max_tokens 700.

## Nodes (LangGraph)
1. **guard**: a safety node. It checks each user message against prompt-injection and cross-user-data patterns *before* any LLM call. A blocked message gets a fixed refusal and ends the turn (0 tokens).
2. **agent**: the sales agent (Claude Haiku 5.5 with 7 tools bound). It gets the system prompt + the user's long-term memories + the last 6 user turns of the conversation.
3. **tools**: a `ToolNode` that executes the tool calls and loops back to **agent** until it gives a final answer.

Flow: `START → guard → (agent | END)`, `agent → (tools | END)`, `tools → agent`. Recursion limit 12.

## Tools (all real, backed by Neon Postgres)
| Tool | What it does |
|---|---|
| `find_leads(query?, industry?, city?, limit?)` | searches the prospect database |
| `get_lead(lead_id)` | full lead details (contact, email, pain point) for personalising outreach |
| `save_draft(lead_id, subject, body)` | saves an outreach email as a draft |
| `send_email(draft_id)` | **risky action:** the first call only requests confirmation; it sends only when the user confirms in a later message (enforced in code). Sending is simulated: the email goes to an outbox and the lead moves to "contacted" |
| `update_pipeline(lead_id, stage, note?)` | adds or moves a lead in the user's pipeline (new, contacted, replied, meeting, won, lost) |
| `view_pipeline(stage?)` | shows the user's pipeline |
| `remember(fact)` | saves a long-term fact about the user |

## Memory
- **Short-term (per conversation):** the LangGraph `PostgresSaver` checkpointer stores the full message history per thread in Neon Postgres. The checkpoint key is `"{user_id}:{thread_id}"`. The last 6 user turns are sent to the model.
- **Long-term (per user, across conversations):** the `memories` table keyed by `user_id`. The agent calls `remember` when the user states a lasting fact (name, company, product, ideal customer, tone). All facts are injected into the system prompt on every turn in every thread. The user's pipeline and drafts are also stored per `user_id`.
- Everything is in Neon Postgres, so nothing is lost on a restart.

## User isolation
- `user_id` comes only from the API request. Tools get it from the LangGraph config and **never as a model-controlled argument**, so the model can't query another user even if asked.
- Every per-user SQL query filters `WHERE user_id = …`.
- Checkpoint keys are prefixed with `user_id`, so two users using the same `thread_id` never share a conversation.
- The guard node refuses requests mentioning another user's data.

## Safety
- **Prompt injection:** the guard node's regexes catch "ignore previous instructions", "system prompt", "you are now", "developer mode", "jailbreak", fake `<|system|>` tags, and requests for other users' data. These are refused with no LLM call. The system prompt also says that tool results and pasted text are data, never instructions.
- **Off-topic:** the system prompt limits scope to leads, outreach, pipeline and sales advice. Anything else gets a one-sentence refusal that steers back to sales, with no tool calls.
- **Asks before risky actions:** `send_email` uses a two-step confirmation enforced in code (draft → pending_send in turn N → sent only in a later turn after the user says yes). It can never send in the same turn as the request.

## Demo data
About 30 fictional B2B leads across 6 industries (dental clinics, gyms, real-estate agencies, restaurants, e-commerce stores, SaaS startups) and 5 cities (Lahore, Karachi, Islamabad, Dubai, London). Each lead has a contact, a `@example.com` email and a concrete pain point (e.g. "no online booking, patients call and hit voicemail"). *(Confirm the final list with B's `seed.py`.)*

Example prompts: "Find 3 dental clinics in Lahore" · "Write a cold email to lead 1" · "Send it" → "yes" · "Add lead 3 to my pipeline and move it to meeting" · "Show my pipeline" · "Remember: I sell booking software for clinics".
