# Engineering Conventions - Autonomous AI Company

## Product layout

Each product lives in `products/<product-slug>/` as its own git repository.

Expected structure:
- `products/<slug>/frontend/` — static or buildable web UI. Built output should land in `frontend/dist`, `frontend/out`, or `frontend/build`.
- `products/<slug>/backend/` — API server. Python backends need `requirements.txt` and expose `main:app` on port 8000. JS/TS backends need a `wrangler.toml` with a Worker entry point.

## Deployment targets

- Frontend → Cloudflare Pages via `npx wrangler pages deploy frontend --project-name <slug>-frontend --branch main`
- JS/TS backend → Cloudflare Workers via `npx wrangler deploy` inside `backend/`
- Python backend → Cloudflare Containers via the DevOps deployer (auto-generates the worker wrapper + Dockerfile if missing)

Deployment tasks are triggered by the DevOps agent and auto-deploy on push to main/master when the git hook or GitHub Actions workflow is configured.

## Code standards

- Python 3.11+, typed where practical, structlog for logging
- Every public function returns a result dict with `success` and `error` keys for tool calls
- Prefer small modules; keep agent-facing interfaces stable
- Always health-check live URLs after deployment before marking tasks complete
