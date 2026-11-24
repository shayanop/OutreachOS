# GrowthPilot backend setup and deployment

## Run locally

1. Use Python 3.12 or 3.13. Create and activate a virtual environment, then install the backend dependencies.

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r agent/requirements.txt
   Copy-Item .env.example .env
   ```

2. Set `DATABASE_URL` to the direct Neon connection string for your dev branch. Add the group's `ANTHROPIC_API_KEY` and a random `ADMIN_TOKEN` in the ignored `.env`. Keep `MODEL=claude-haiku-5-5`.
3. Start the server with `python -m uvicorn --app-dir agent app:app --reload`. Startup creates the schema and LangGraph checkpoint tables, and inserts demo leads if the directory is empty. `GET http://localhost:8000/health` returns plain text `ok`. When A's `graph.py` is available, `POST /chat` invokes `graph.run_turn`.

## Neon

- In the [Neon console](https://console.neon.tech/), create a Free project named `growthpilot`. Create `dev-a`, `dev-b`, and `dev-c` from a clean parent branch, before adding real credentials or test data. Use `main` for the deployment.
- In each branch's **Connect** dialog, disable connection pooling, then copy the connection string for that branch with `sslmode=require`. If Neon supplied a pooled hostname, the backend connects to the direct endpoint for the same database. Share development connection strings privately with the corresponding teammates.
- Short-term history is in Postgres-backed LangGraph checkpoints. A's graph keys conversations by the pair of `user_id` and `thread_id`. The API rejects colons in `user_id` to keep the graph's separator unambiguous. Persistent facts, drafts and pipeline entries are scoped by `user_id` in Postgres.
- `/chat` and the customer routes accept a caller-supplied demo ID without authentication. A caller who already knows another person's ID can impersonate it. Use synthetic data and opaque random demo IDs. A production customer deployment needs authentication and server-verified identity. The admin routes require `X-Admin-Token`; keep this value private.

The seed directory contains 30 fictional businesses with reserved `example.com` contact domains, covering dental clinic, gym, real-estate agency, restaurant, e-commerce store, and SaaS startup across Lahore, Karachi, Islamabad, Dubai, and London. The outbox is simulated.

## Render

1. For a new service, create a [Render Blueprint](https://render.com/docs/infrastructure-as-code) from `Main`. The Blueprint defines a Free Docker web service with build root `agent` and health check `/health`. For the existing workshop deployment, use [the CI/CD runbook](ci-cd.md).
2. Enter the group's `ANTHROPIC_API_KEY` and the production Neon `DATABASE_URL` in Render's secret settings. Render generates the `ADMIN_TOKEN`. Use that token only in the admin sign-in form.
3. Verify that `GET /health` returns `ok` and that `POST /chat` returns the required JSON with a real lead lookup. Follow the runbook for the evaluation window: Render Free spins down after 15 minutes without traffic. Configure a temporary external monitor to request `GET /health` every 10 minutes through Wednesday, 25 November 2026 (Asia/Karachi), and then disable it.
4. Send the API base URL to A and C. For Vercel, C can import the GitHub repository, use Root Directory `web` and Framework Preset `Other`, and set the Render base URL in `web/config.js`.

## Benchmark

Once A's `tests.json` and the live agent are ready, run `python bench.py https://YOUR-SERVICE.onrender.com`. The runner checks the final reply and tool calls in each case, sums usage across its turns, and writes `docs/bench.md`. Each run uses a unique suffix for demo user IDs. A turn can be a string on the case's default thread or an object with `message` and optional `thread_id` and `user_id` overrides to test cross-thread recall and user isolation. Set `expect_no_tools: true` to require an empty final tool list. Use the shared Claude budget sparingly.
