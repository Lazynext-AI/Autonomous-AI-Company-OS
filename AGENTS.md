# Lazynext — Agent Operating Notes

Autonomous AI company platform. Cloudflare-first: Workers AI brain, Workers +
D1 + KV (`EPHEMERAL`) + Vectorize (`VECTORS`, index `company-knowledge`, 384d)
+ Browser Rendering (`/render`) + Containers (`CODE_EXEC`) + Cron (`*/10`).

## Live surfaces

- Platform worker: `https://ai-company-os.dry-hall-6a50.workers.dev`
- Product worker: `https://accessibility-checker.dry-hall-6a50.workers.dev` — this is what `index.html` calls. A second script `accessibility-checker-api` mirrors the same code (recreated after it was found deleted — error 1042 means "no worker on that route"; keep both in sync when deploying).
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
- **Plan state model** — `subs:active` (KV) tracks active subscriptions by `subscription_id`; the global `plan` is *derived* from that set (any active → its plan, none → Founder). One cancellation can no longer clobber the global while other subs stay active. `GET /api/v1/billing/subscriptions` (admin token) lists Dodo's active subs for reconciliation.
- **14-day free trial is live** — `/billing/products` + `/billing/checkout` accept `trial_days` (→ `price.trial_period_days` / `subscription_data.trial_period_days`); product `/checkout` sends `trial_days:14`. `metadata.trial=1` stamps `trial:<email>` on `subscription.active`; any later billing event clears it; the daily sweep sends one 3-day reminder at day 11 (`trial:<email>:reminded`).
- **`/query` endpoint rejects bare Python `urllib`** (403) — send a `User-Agent` header; also avoid inlined literal-heavy SQL, prefer `?` params.
- **`/kv/put` expires writes in 60s by default** — `expirationTtl: Math.max(ttl ?? 60, 60)`. Any ops write without a ttl silently vanishes a minute later. Pass `"ttl": 0` (JSON number, not `"0"` string — `"0" === 0` fails and gets the 60s floor) for a persistent write. Webhook/`billing.ts` writes use explicit TTLs and are unaffected.
- **KV verification trap:** `env.EPHEMERAL.get` reads can serve from a ~60s edge cache — a "key persisted past 60s" check at +60-70s can be a cached false positive on a key that already expired. Verify durability at ≥120s, ideally re-read later too.
- **Git remotes:** push to `lazynext` (embedded token, `github.com/Lazynext-Platform/...`) — `origin` points at the `ujjwalredd` fork source and rejects pushes. `pgrep -f run_agents.py` can report 2 (a stale wrapper shell matching its own `pkill` text); confirm with `ps` — only the `.venv/bin/python scripts/run_agents.py` row is the real fleet.
- **Brevo is the only email provider** — Resend is fully removed (code, config, secrets). Do not reintroduce.
- **Email sequence** — lead capture → email 1 immediately, sweeps send 2/3 at +3d/+7d (`seq:last_run` in KV).
- **Launchdeck** is a live empty product scaffold (404 root) — awaiting a build.
- **`wcag-2.1.2`** trap detector is conservative; a one-link page can trip it — intentional warn-over-miss.
- All stale `agent-*` remote branches were deleted (2026-09, user-confirmed) — closed/merged PR leftovers. New agent branches are created fresh per task and may accumulate again.
- **Site scan + monitoring wiring** — `POST /scan {"url":…, "site":true}` runs `crawlSite` (3 pages free / 10 Pro, HTML ruleset per page — no rendered contrast/facts/focus on crawled pages) and reports the **mean** of page scores, never the flat-issue score. `mon:` records live in KV; the platform's daily sweep iterates `mon:*` → rescans via the **`A11Y` service binding** (same-account `workers.dev` fetches are refused — 404s, not errors) → Brevo alert on ≥10-pt drop. Sweep writes a `mon:last_sweep` breadcrumb (`{at, scanned, errors[]}`) — check it before assuming the loop ran. `GET/DELETE /monitor` use the internal `/kv/list` route (internal token). Both features are reachable in the Pages UI (`#siteScan`, `#monitor` controls).
- **Score formula** — `100·e^(−n/15)` (0 issues = 100, 10 ≈ 51, 30 ≈ 14). Was `100−10n`, which pinned at 0 for any site with 10+ findings and deadened drop alerts.
- **Product worker names** — `accessibility-checker` (called by the Pages UI) and `accessibility-checker-api` (legacy mirror) are **distinct scripts**; deploy changes to both or the mirror drifts.

## Product worker deploys

`accessibility-checker` has no wrangler.toml — it deploys via the Cloudflare scripts Upload API (multipart). Two traps, both hit and verified:

- `bindings` omitted from upload metadata **silently drops them at runtime** — the settings API still lists them but `env.PLATFORM` is undefined (error 1101). Always re-send the full binding set.
- `secret_text` bindings must include `text` in the re-sent metadata or upload fails 10021. `PLATFORM_TOKEN` = the worker bearer = `.env`'s `CLOUDFLARE_API_TOKEN`.
- Multipart part `filename=` is the module path — `-F "src/scanner.js=@src/scanner.js;filename=src/scanner.js"`.

## Failure classes already fixed (don't regress)

Core-file regen → protected sets. Broken tests shipping → mandatory exec verdicts. `.mjs` unverified → mapped. Mega-PRs → branch-per-task. Paraphrase regen → content-word dedup. Workflow-fix floods → run-id dedup + branch guard. Review self-failure → findings are the deliverable (`success=True`). Orphan poisoning → `_revert_files`. Fleet multiplication → `pkill -f`. Stack divergence → prompts defer to `company_brain.tech_stack`. httpx `ReadTimeout` logs `error=` blank → log `type(e).__name__`. Fully-skipped deliverables "completing" → `post_task_hook` runs before `mark_completed`, protected-only writes veto to retry. MCP `create_task` dropped as BaseMessage → `_type: "TaskMessage"` required in bus payloads. Stale task resurrection → `agentTick` requeues `failed` tasks (attempts<3); retire obsolete ones with `attempts=3`. Orphaned `in_progress` claims (fleet killed mid-task wedge forever) → `agentTick` sweeps claims older than 1h to `failed`. Scope-creep task generation (multi-gateway, mobile apps invented) → `operate()` prompt bounds scope: Dodo-only billing, Brevo-only email, no native apps, no architecture rewrites. Retiring a task that is already claimed races the claim — `mark_completed` can overwrite a `failed` UPDATE; retire early or re-apply. Gate-rejected deliverables still "completing" → `write_code` cleared `files_written` after `_revert_files` but callers read non-empty as shipped; now returns `reverted` + empty `files_written`, and all three write-path agents veto on `skipped_protected`/`reverted`/`tests_failed`/`fitness_failed`. Escalation→QA-alert→doomed-remediation recursion → `handle_qa_alert` skips alerts whose error details contain `deliverable` (covers `Deliverable blocked:` protected-path vetoes and `Deliverable rejected:` test/task-fit vetoes — infeasible-task escalations end at escalation instead of spawning fix-tasks that hit the same gates). Dashboard authz hole → middleware accepted any non-empty `lz_user_session` cookie and every `/api/*` route proxied with the internal bearer, so a forged cookie got arbitrary SQL on prod D1; now `/api/*` requires the owner `lazynext_session` (401 otherwise — `/api/logout` excepted, members allowed since it only clears their own cookies), and `lz_user_session` is HMAC-signed (`token.sig`, key = `DASHBOARD_SESSION_TOKEN`) so middleware verifies it cryptographically; signed member cookies pass pages only (no member data surface exists yet — all data routes are owner-level). Residual: signed member cookies aren't revoked-checked in middleware (KV lookup per request was rejected as too costly) — a logged-out member keeps shell access until cookie expiry, but all data stays owner-only.

Stored XSS on shareable reports → `worker.js` escaped every interpolated value with `esc()` (url/rule/message + email subject slice) — scanned-page text (aria-labels, headings) was reaching report HTML raw; verify with a markup-carrying scan payload. Auth endpoints had no rate limiting → `rateLimited()` in `lib/auth.ts` (KV counter `rl:<scope>:<ip>`, cf-connecting-ip, fail-open); `/api/auth` blanket 20/10min + login 10/10min, `/api/login` owner 10/10min — verified: 16×200 then 429s.

License-key authz weakness → `license:<email>` uses the buyer's email as the bearer, which is guessable, so `POST /cancel` and `/monitor` POST/DELETE let anyone who knows a customer's email cancel their sub or manage monitors. Now all license mutations are two-step: POST creates `pending:<token>` (15min TTL) + Brevo confirmation email, `GET /confirm?token=` executes once (token deleted on use); confirmed pages carry CSP `default-src 'none'`. Verified live: POST returns `{confirm:"email"}` without acting, license stays `pro` until confirm, replay → "Link expired", Brevo log shows all three confirm emails. Residual: `GET /monitor` listing stays email-keyed (read-only, low severity). `body.html` now capped at 512KB (413). Dodo test-mode webhooks can lag or drop (observed: cancel PATCH landed but `subscription.cancelled` never arrived, and an `subscription.active` was ~20min late) → `/billing/cancel` now applies the downgrade synchronously after a successful PATCH (webhook repeat is idempotent), and the daily sweep runs `reconcileBilling()` which diffs Dodo's live active-subs list against `subs:active`/`license:*`/`trial:*` and repairs both directions — verified live repairing real drift (stamped missing license+trial, downgraded 3 stale licenses). Breadcrumb: `billing:last_reconcile`. Task-generator blind spot → `operate()` fed back only failed/completed tasks (escalated ones were invisible to the do-not-repeat list, so dead work respawned under new wording — 48-escalation spike) and never named the managed files, so `Enhance src/scanner.js`-class tasks generated into guaranteed vetoes; prompt now lists the managed set (`worker.js`, `index.html`, `src/scanner.js`, `package.json`, `test/scanner.test.mjs` → propose NEW modules/docs) and the recent-task context includes `escalated`. Phantom imports through LLM review → `scanner_dynamic.js` committed with every named import wrong (`crawl` vs `crawlSite`) — a load-time SyntaxError island; exec's import() check catches it only when the container runs, and the LLM fallback was told cross-module refs were 'fine' with no repo context. Review prompt now carries a digest of each repo file's real export names and rejects imports of non-exported names.
