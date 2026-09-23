# Lazynext — Agent Operating Notes

Autonomous AI company platform. Cloudflare-first: Workers AI brain, Workers +
D1 + KV (`EPHEMERAL`) + Vectorize (`VECTORS`, index `company-knowledge`, 384d)
+ Browser Rendering (`/render`) + Containers (`CODE_EXEC`) + Cron (`*/10`).

## Live surfaces

- Platform worker: `https://ai-company-os.dry-hall-6a50.workers.dev`
- Product worker: `https://accessibility-checker.dry-hall-6a50.workers.dev`
- Dashboard: `https://dashboard.lazynext.com` (session cookie `lazynext_session`)
- Product repo: `github.com/Lazynext-Platform/accessibility-checker` (mirrored at `products/accessibility-checker`)

## Commands

- Local fleet: `set -a; source .env; set +a; .venv/bin/python scripts/run_agents.py`
- Tests (repo): `make test` → pytest `tests/` (authed tests skip without `LAZYNEXT_API_KEY`)
- Tests (product): `node --test` inside `products/accessibility-checker` — bare invocation, `node --test test/` resolves `test/` as a module path and fails
- Validate integrations: `.venv/bin/python scripts/validate_env.py`
- Deploy worker: `cd worker && CLOUDFLARE_API_TOKEN="$CLOUDFLARE_DEPLOY_TOKEN" npx wrangler deploy`

## Credentials — read carefully

- `CLOUDFLARE_API_TOKEN` in `.env` is the **worker bearer token** (used as `Authorization: Bearer` against the platform worker). Wrangler rejects it.
- `CLOUDFLARE_DEPLOY_TOKEN` is the real Cloudflare REST token — map it into `CLOUDFLARE_API_TOKEN` for wrangler deploys only.
- GitHub/Brevo/SignWell keys live in KV as `conn:*` (credential-guarded, 403 via HTTP) with `.env` fallbacks.
- `DASHBOARD_SESSION_TOKEN` + `DASHBOARD_PASSPHRASE` in `.env`; login sets the `lazynext_session` cookie. Optional TOTP: `flag:two_factor` + `2fa:secret` in KV.
- Never print secret values; reference env vars in commands instead.

## Fleet safety gates (all proven with live catches — keep them)

1. **Protected files** — `worker.js`, `index.html`, `src/scanner.js`, `package.json`, `test/scanner.test.mjs`, and `.github/` (devops role only) are skipped in both the cloud writer (`worker/src/index.ts`) and local `core/tools/code_writer.py`.
2. **Test gate** — `node --test` runs before commit locally; cloud test artifacts require a real exec-container verdict, no LLM fallback. `.mjs` maps to the js checks.
3. **Fitness check** — LLM task-fit review in `CodeWriter._fitness_check` rejects nonexistent references / wrong hosts / off-task code. LLM outage warns and allows; tests + CI are the backstop.
4. **Revert on failure** — `_revert_files` restores tracked files (`git checkout HEAD`), deletes new files, prunes empty dirs. Without it, blocked writes poison later test runs.
5. **Branch per task** — every task forks fresh from `main` (`GitManager.create_pr_branch_and_commit`), commits as `[task_id] desc`, pushes, opens a PR, repo returns to `main`.
6. **Task dedup** — content-word overlap + substring over ALL statuses in the last 24h, in both the local generator and cloud `operate()` (`taskAlreadyTried`). Exact-match-only dedup lets paraphrases respawn forever.
7. **Workflow-fix dedup** — `find_by_description("run {id}")` across all statuses; only `main`/`master` failures create fix tasks (PR-branch failures belong to the branch author).
8. **One fleet process** — restart with `pkill -f run_agents.py` (not `pgrep | head -1`); multiple processes race the queue and defeat dedup.

## Known states

- **Dodo is test-mode.** Live requires: Dodo KYC (user action) → live `DODO_API_KEY` → `DODO_API_BASE=https://live.dodopayments.com` → recreate product + webhook in live mode. Webhook: Svix-style signature verify + `whseen:` replay dedup; `past_due` sets `pastdue:` KV + bus event, no immediate revoke.
- **Brevo is the only email provider** — Resend is fully removed (code, config, secrets). Do not reintroduce.
- **Email sequence** — lead capture → email 1 immediately, sweeps send 2/3 at +3d/+7d (`seq:last_run` in KV).
- **Launchdeck** is a live empty product scaffold (404 root) — awaiting a build.
- **`wcag-2.1.2`** trap detector is conservative; a one-link page can trip it — intentional warn-over-miss.
- Stale `agent-*` remote branches on the product repo are closed/merged PR leftovers — delete only with confirmation.

## Failure classes already fixed (don't regress)

Core-file regen → protected sets. Broken tests shipping → mandatory exec verdicts. `.mjs` unverified → mapped. Mega-PRs → branch-per-task. Paraphrase regen → content-word dedup. Workflow-fix floods → run-id dedup + branch guard. Review self-failure → findings are the deliverable (`success=True`). Orphan poisoning → `_revert_files`. Fleet multiplication → `pkill -f`. Stack divergence → prompts defer to `company_brain.tech_stack`. httpx `ReadTimeout` logs `error=` blank → log `type(e).__name__`.
