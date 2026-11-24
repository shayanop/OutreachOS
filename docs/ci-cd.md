# CI and production releases

GitHub Actions runs on pushes, pull requests and manual runs. The frontend job checks the static assets, script syntax, punctuation and API configuration. The backend job runs the real FastAPI and LangGraph code against a disposable Postgres database, with a deterministic replacement for the model, and builds the Render Docker image. The CI suite uses no production credentials.

Only `Main` can release to production, after both jobs pass. The release job builds the tested commit on Render, checks its revision and database access, then deploys that same commit's `web/` assets to the existing Vercel project. A release marker verifies the public Vercel domain is actually serving the new commit. The live checks use GET requests. They verify the response contract, CORS, admin rejection, frontend pages and Render URL without calling Claude.

## One-time setup

Use Settings > Environments on the GitHub repository and configure the `production` environment. Restrict deployment branches to `Main`. The repository owner or an administrator with access to the hosting projects should set these values:

| Name | Type | Where to get it |
|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | Secret | The **Deploy Hook** for the existing `growthpilot-api` Render service, under Settings |
| `VERCEL_TOKEN` | Secret | A Vercel access token scoped to the OutreachOS workspace |
| `VERCEL_ORG_ID` | Variable | The **Team ID** for the OutreachOS Vercel workspace |
| `VERCEL_PROJECT_ID` | Variable | The **Project ID** for `outreachos-web`, under Settings > General |

Use the existing [Render service](https://dashboard.render.com/web/srv-dc22ignf3r2c73e56nfg) and [Vercel project](https://vercel.com/outreach-os1/outreachos-web) so the public URLs stay the same. The deploy hook builds the requested commit from the linked GitHub repository and disables Render's independent Git auto-deploy when called with a commit reference. Keep deployments on the Actions path so the tests gate releases.

Leave the Claude and Neon credentials in Render. The two CI deployment secrets grant access to their respective hosting services and belong in GitHub's secret settings. The pipeline uses Vercel CLI deployment, so the Vercel project does not need a direct Git link.

After saving the settings, open Actions > **OutreachOS CI/CD** > **Run workflow**, select `Main`, and wait for all three jobs. Subsequent pushes to `Main` run the same release automatically. Missing credentials stop the release job before it changes either service.

## Local checks

Run `node --test tests/test_frontend.mjs`. For backend tests set `TEST_DATABASE_URL` to a disposable, localhost-only Postgres 16 instance and run `python -m unittest discover -s tests -p "test_backend.py" -v` with the backend dependencies installed.

If a production check fails, inspect the failed step and the hosting dashboard. Restore the prior verified release through the Render or Vercel deployment history if needed. Revert or fix the Git commit before rerunning CI/CD.
