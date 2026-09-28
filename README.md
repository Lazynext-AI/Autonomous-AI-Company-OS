# Lazynext — The Autonomous AI Company OS

A production, self-running organization of AI agents that builds, deploys, markets, sells, and supports a real software product with zero human intervention after setup. The fleet currently operates the **Accessibility Checker** — a live WCAG scanning product at [checker.lazynext.com](https://checker.lazynext.com) — handling the full lifecycle from free scans through reports, upgrade checkout, billing, email sequences, and support.

The entire backend runs on Cloudflare's serverless platform (Workers, D1, Workers KV, Vectorize, Pages, Containers, Cron) and Cloudflare Workers AI for LLM inference — no local services required beyond the agent runner.

## Live platform

| Surface | URL | What it is |
|---------|-----|------------|
| Marketing site | [lazynext.com](https://lazynext.com) | Company site + status page |
| Product app | [checker.lazynext.com](https://checker.lazynext.com) | Accessibility Checker — scan UI, reports, checkout (installable PWA) |
| Product API | [api.lazynext.com](https://api.lazynext.com) | Scan/report/badge/checkout API + `/mcp` + `/a2a` + `widget.js` |
| Founder dashboard | [dashboard.lazynext.com](https://dashboard.lazynext.com) | Next.js ops console (passphrase + optional TOTP; installable PWA) |
| Platform worker | `ai-company-os.dry-hall-6a50.workers.dev` | Internal state API — token-gated (returns 401 unauthenticated) |
| Status | [status.lazynext.com](https://status.lazynext.com) | Redirects to lazynext.com/status |

## The product — Accessibility Checker

The company's first product is a WCAG accessibility scanner (`products/accessibility-checker/`, mirrored at [github.com/Lazynext-AI/accessibility-checker](https://github.com/Lazynext-AI/accessibility-checker)):

- **Scan → report → upgrade loop**: free tier 3 scans/day per site; full reports with per-rule findings; report pages carry the upgrade CTA into checkout
- **75-rule manifest** (`GET /rules`): WCAG 2.x criteria + best-practice checks, including *interactive* rendered-scan checks — real Tab/Shift+Tab keyboard-trap traces, Escape probes, click-opened dialog traps, target-size, focus-obscured, and non-text-contrast detection
- **Billing**: Dodo Payments (test mode pending incorporation) — Pro subscription, 14-day trial (extendable via `config:trial_offer`), `WELCOME20` discount, webhook-verified entitlement, SignWell legal signing on activation
- **Agent surfaces**: `POST /mcp` (JSON-RPC tools `scan_url`/`scan_html`/`get_report`/`list_rules`), `POST /a2a` (`tasks/send`/`tasks/get`), `GET /.well-known/agent.json`, `GET /widget.js` (Shadow-DOM embed) — all sharing the same quota-enforced scan pipeline
- **SDKs**: `sdk/js` (`@lazynext/accessibility-checker`), `sdk/go`, `sdk/python` (with `python -m` CLI: scan/site/report/csv/rules/badge/card)
- **Email**: Brevo sequences + waitlist confirms (HMAC-verified unsubscribe) + engagement tracking feeding CRM campaigns

## Table of Contents

1. [Live platform](#live-platform)
2. [The product — Accessibility Checker](#the-product--accessibility-checker)
3. [Overview](#overview)
4. [System Architecture](#system-architecture)
5. [Agent Types and Roles](#agent-types-and-roles)
6. [Workflow and Message Flow](#workflow-and-message-flow)
7. [Reward and Performance System](#reward-and-performance-system)
8. [Technical Stack](#technical-stack)
9. [Installation](#installation)
10. [Configuration](#configuration)
11. [Running the System](#running-the-system)
12. [Project Structure](#project-structure)
13. [Performance and Scaling](#performance-and-scaling)
14. [Production Deployment](#production-deployment)

## Overview

Lazynext is a multi-agent system that runs a complete startup organization. Specialized AI agents — CEO, CTO, engineering, growth, and infrastructure roles — collaborate through a D1-backed event bus to operate the company's product end to end: shipping code, deploying to Cloudflare, drafting and sending campaigns, handling support, reconciling billing, and monitoring production. The fleet runs under launchd on a Mac runner with hard safety gates (protected files, test gate, fitness review, revert-on-failure, dead-corpus dedup) documented in `AGENTS.md`.

### Key Capabilities

- **Autonomous Product Development**: Agents generate, validate, test, and commit code automatically
- **Strategic Planning**: CEO agent sets strategic direction based on company state and market analysis
- **Task Orchestration**: CTO agent decomposes strategic goals into executable technical tasks
- **Code Generation**: Engineering agents write production-quality code with validation and testing
- **Automatic Deployment**: DevOps agents deploy frontends to Cloudflare Pages and JS/TS backends to Cloudflare Workers, with verification
- **Quality Assurance**: Continuous testing and health monitoring with automatic remediation
- **Performance Tracking**: Comprehensive scoring and reward system for agent improvement
- **Knowledge Management**: RAG-powered knowledge base for context-aware decision making

### Core Principles

- **Separation of Concerns**: Product code lives in a separate repository (`./products/<slug>/`, e.g. `products/accessibility-checker`) isolated from the agent system
- **Event-Driven Architecture**: D1-backed message streams ensure reliable, exactly-once message delivery
- **Tiered Model Selection**: Cost-optimized LLM usage based on task importance
- **Fail-Safe Operations**: Automatic retries, rollbacks, and escalation protocols
- **Production-Ready**: Code validation, file backups, conflict detection, and git branch management

## System Architecture

### API Layer (Cloudflare Worker)

All state access goes through a single Cloudflare Worker (`worker/`) that fronts D1, KV, and Vectorize. Agents and the dashboard authenticate with a shared bearer token (`API_TOKEN` Worker secret).

- **Endpoints**: `/query`, `/batch` (D1 SQL), `/bus/*` (message streams), `/kv/*` (cache), `/vectorize/*` (embeddings), `/health`
- **Auth**: `Authorization: Bearer <API_TOKEN>` on every request

### Public API + MCP (Gateway)

External consumers use `lzk_*` API keys (issued via `/api/v1/keys` with the admin token) — scoped (`read`/`write`), rate-limited per minute via KV, hashed in D1 (`api_keys` table, migration 003).

- **REST**: `GET /api/v1/health` (public), `GET /api/v1/status`, `GET /api/v1/briefings[/{id}]`, `GET /api/v1/tasks`, `POST /api/v1/tasks` (write), `POST /api/v1/knowledge/search`, `GET /api/v1/agents`
- **MCP**: `POST /mcp` — streamable HTTP transport, spec **2026-07-28** (negotiates older versions). Tools: `company_status`, `list_briefings`, `get_briefing`, `list_tasks`, `list_agents`, `search_knowledge`, `create_task` (write), `publish_message` (write). Resources: `lazynext://briefing/{id}`.
- **Key admin** (admin token only): `POST /api/v1/keys`, `GET /api/v1/keys`, `DELETE /api/v1/keys/{id}`
- **Webhooks**: `POST /api/v1/webhooks` registers an HTTPS endpoint subscribed to bus channels (`*` or csv); every bus publish + briefing insert fans out a signed POST (`x-lazynext-signature`), deliveries logged (`/api/v1/webhooks/deliveries`)
- **Docs**: `GET /api/v1/openapi.json` + Swagger UI at `/api/v1/docs`
- **SDKs**: `core/public_api_client.py` (Python) · `sdk/js/` (JS/TS, `npm i lazynext`) · `sdk/go/` (Go)
- **CLI**: `lazynext` command (installed at `/opt/homebrew/bin/lazynext`) — `status`, `briefings`, `tasks`, `task "…"`, `agents`, `search`, `health`, `mcp-tools`, `waitlist`
- **A2A**: `GET /.well-known/agent.json` (agent card, public) + `POST /a2a` — `tasks/send` (write scope) queues real work, `tasks/get` (read scope) reports true state from task_log
- **OAuth 2.0**: `POST /oauth/token` (client_credentials + authorization_code) + `POST /oauth/authorize` (admin-mints scoped `lzk_` keys)
- **Embeddable widget**: `<script src="https://ai-company.lazynext.com/widget.js"></script>` + `<div data-lazynext="status|chat">` — live status card / chat box on any site
- **Chat integrations**: webhook endpoints auto-detect Slack/Discord/Telegram URLs and format messages natively — connect in Settings → Chat integrations
- **Browser extension**: `extension/` — manifest v3, popup shows live status + tasks + queue box (load unpacked → Settings → paste `lzk_` key)
- **Copilot**: `copilot` channel in Conversations — real AI replies via Workers AI

The dashboard is also an installable PWA (manifest + icons) — "Add to Home Screen" / browser install works on mobile and desktop.

### Internal service families

Operational surfaces behind the admin token (not in the public OpenAPI spec — used by the dashboard, agents, and scripts):

- **CRM** — `GET|POST /api/v1/crm/leads`, `PATCH|PUT /api/v1/crm/leads/{id}` — lead capture + pipeline stage management; feeds from the product's scan/waitlist funnels
- **Support** — `GET|POST /api/v1/support/tickets`, `PATCH|PUT /api/v1/support/tickets/{id}` — ticket queue incl. the `support@lazynext.com` inbound route (Cloudflare email worker → API)
- **Booking** — `GET|POST /api/v1/booking`, `PATCH|DELETE /api/v1/booking/{id}` — sales/demo call scheduling
- **Store** — `GET|POST /api/v1/store/products`, `GET|POST /api/v1/store/orders` — internal product/order ledger
- **Marketing** — `GET|POST /api/v1/marketing/contacts[/{id}]`, `GET|POST /api/v1/marketing/campaigns`, `GET /api/v1/marketing/stats` — contacts, campaign records, and engagement rollups (`totals`/`by_tag`/`recent`) fed by the Brevo webhook (12 events incl. delivered/opened/click/suppression)
- **Signatures** — `POST /api/v1/signwell/send`, `GET /api/v1/signwell/documents`, `GET /api/v1/signwell/events`, `POST /api/v1/signwell/webhook/{token}` — SignWell document send/status/webhook; subscription activation auto-sends `config:signwell_template` when set
- **Connectors** — `GET|POST /api/v1/connectors[/{id}]` — registry + dispatch for the 44-entry connector library (41 live write paths + honest fail-fast stubs; social, chat, blog, git, telco): x, linkedin, meta, facebook, instagram, threads, bluesky, mastodon, reddit, pinterest, vk, youtube, tiktok, gmb, discord, slack, telegram, matrix, teams, mattermost, zulip, viber, line, devto, hashnode, medium, wordpress, github, gitlab, tumblr, ghost, beehiiv, lemmy, listmonk, ayrshare, postiz, buffer, twilio, whatsapp, brevo, signwell + generic `webhook`. Credentials live in KV `conn:{id}` (403-guarded over HTTP); `core/tools/connectors.py` mirrors the matrix locally

### Message Bus (D1-backed Streams)

The system uses a D1-backed message bus exposed by the Worker for inter-agent communication. Each channel represents a specific message type or routing destination:

- **Channels**: `ceo.directives`, `cto.tasks.backend`, `cto.tasks.frontend`, `agent.reports`, `qa.alerts`, etc.
- **Consumer Groups**: Emulated in D1 via `bus_offsets` + `bus_deliveries` — each (channel, group) sees every message; within a group each message is delivered to exactly one consumer until acked
- **Role-Based Routing**: CTO publishes tasks to role-specific channels ensuring correct agent assignment
- **Blocking Reads**: Agents poll `/bus/poll` with ~3s long-poll for responsive task processing

### Company Brain (Cloudflare D1)

Persistent shared state stored in D1 (serverless SQLite):

- **Product State**: Product name, description, mission, tech stack
- **Metrics**: Users, revenue, MRR, uptime, error rates, deployment counts
- **Features**: Shipped features, open bugs, user feedback
- **Blockers**: Technical blockers preventing progress
- **Agent Statuses**: Current status and activity of all agents

JSON columns are stored as TEXT and transparently encoded/decoded by `core/cloudflare_client.py`.

**Caching**: Workers KV with 60-second TTL reduces database load for frequent reads.

### Episodic Memory (D1)

Short-term event storage per agent in the `episodic_events` table:

- **Recent Events**: Task started, completed, failed events
- **Retention**: Last 7 days of activity (pruned lazily on writes)
- **Purpose**: Provides context for LLM calls and decision-making

### Knowledge Base (Vectorize + D1)

RAG-powered knowledge retrieval system:

- **Vector Store**: Cloudflare Vectorize for semantic search
- **Chunk Store**: `knowledge_chunks` D1 table holds chunk text; Vectorize metadata links chunk IDs
- **Embeddings**: Free local `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions)
- **Ingestion**: PDF documents parsed with pypdf, chunked, embedded, and stored
- **Query Interface**: Agents query knowledge base when stuck or need context
- **Categories**: Engineering, business, marketing, domain-specific knowledge

### Project Repository

Agents build products in a **separate isolated repository**:

- **Location**: `./products/<slug>/` directory (one repo per product, configurable via `PRODUCTS_BASE_DIR`)
- **Auto-Initialization**: Git repository created automatically on first use
- **Isolation**: Complete separation from agent system code
- **Git Operations**: Feature branches, commits, and pushes handled automatically

## Agent Types and Roles

### Strategic Agents

#### CEO Agent
- **Model**: Llama-3.3-70b (Cloudflare Workers AI)
- **Responsibilities**: Strategic direction, market analysis, goal setting
- **Output**: Strategic directives with priorities and deadlines
- **Frequency**: Runs every 5 minutes (configurable)
- **Channels**: Publishes to `ceo.directives`

#### CTO Agent
- **Model**: Llama-3.3-70b (Cloudflare Workers AI)
- **Responsibilities**: Technical orchestration, task decomposition, routing
- **Output**: 5-10 executable tasks per directive with acceptance criteria
- **Frequency**: Runs every 2 minutes (configurable)
- **Channels**: Consumes `ceo.directives`, publishes to role-specific task channels

### Engineering Agents

#### Backend Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: FastAPI endpoints, database schemas, server logic
- **Capabilities**: Code generation, local sandboxed test execution, file writing, git commits
- **Channels**: Subscribes to `cto.tasks.backend`
- **Output**: Python/FastAPI code with validation and testing

#### Frontend Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: Next.js pages, React components, UI implementation
- **Capabilities**: TypeScript/React code generation, file writing
- **Channels**: Subscribes to `cto.tasks.frontend`
- **Output**: TypeScript/React/Next.js code

#### DevOps Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: CI/CD pipelines, deployments, infrastructure
- **Capabilities**: Cloudflare Pages/Workers deployments, deployment verification, live-URL health monitoring
- **Channels**: Subscribes to `cto.tasks.devops`
- **Output**: wrangler configs, deployment records

#### QA Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: Continuous testing, health monitoring, bug detection
- **Frequency**: Runs health suite every 15 minutes
- **Channels**: Publishes to `qa.alerts`
- **Output**: Test results, health reports, incident alerts

### Growth Agents

#### Marketing Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: Content creation, SEO, campaigns, messaging
- **Channels**: Subscribes to `cto.tasks.marketing`
- **Output**: Marketing content, campaign strategies

#### Sales Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: Outreach, demos, pipeline management
- **Channels**: Subscribes to `cto.tasks.sales`
- **Output**: Sales outreach templates, demo scripts

#### Customer Success Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: Support, onboarding, feedback processing
- **Channels**: Subscribes to `cto.tasks.customer_success`
- **Output**: Support responses, onboarding guides

### Infrastructure Agents

#### Knowledge Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: RAG queries, document ingestion, knowledge retrieval
- **Channels**: Subscribes to `knowledge.requests`
- **Output**: Answers to knowledge queries, document summaries

#### HR Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: Agent scaling, resource allocation, team management
- **Channels**: Subscribes to `hr.requests`
- **Output**: Scaling recommendations, resource allocation plans

#### Finance Agent
- **Model**: Llama-3.3-70b
- **Responsibilities**: Financial reporting, metrics analysis, budget tracking
- **Frequency**: Generates weekly finance reports
- **Output**: Financial reports, revenue analysis

## Workflow and Message Flow

### Complete Task Lifecycle

1. **Strategic Planning Phase**
   - CEO agent reads company brain state
   - Performs market research via Serper (Google) search
   - Generates strategic directive with goals, priorities, and deadline
   - Publishes directive to `ceo.directives` channel

2. **Task Decomposition Phase**
   - CTO agent consumes directive from `ceo.directives`
   - Uses Llama-3.3-70b to decompose into 5-10 technical tasks
   - Each task includes: description, acceptance criteria, estimated minutes, assign_to field
   - Publishes tasks to role-specific channels (e.g., `cto.tasks.backend`)

3. **Task Execution Phase**
   - Worker agent (e.g., Backend Agent) consumes task from subscribed channel
   - Updates task status to `in_progress` in `task_log`
   - Builds context: company brain, episodic memory, knowledge base queries
   - Executes task via LLM call with role-specific system prompt
   - Validates generated code syntax (Python, TypeScript, YAML, etc.)
   - Tests code in a local sandboxed subprocess (timeout-guarded)
   - Writes code to files in project directory with automatic backups
   - Creates git feature branch: `agent/{task_id}/{description}`
   - Commits code with task ID and description
   - Optionally pushes to remote repository

4. **Post-Execution Phase**
   - Performance scorer evaluates task completion (0-100 score)
   - Reward engine processes score and injects reward/correction prompts
   - Task status updated to `completed` in `task_log`
   - Report published to `agent.reports` channel
   - CTO agent processes reports for orchestration decisions

5. **Deployment Phase** (if deploy task)
   - DevOps agent detects deployment keywords in task description
   - Deploys frontend to Cloudflare Pages or backend to Cloudflare Workers (Python backends run locally)
   - Verifies deployment via health checks
   - Updates deployment metrics in company brain
   - Auto-generates rollback tasks if verification fails

6. **Quality Assurance Phase**
   - QA agent runs continuous health suite every 15 minutes
   - Tests live endpoints, checks error rates, monitors uptime
   - Publishes alerts to `qa.alerts` for critical issues
   - CTO converts QA alerts into remediation tasks

### Retry and Escalation Protocol

Each agent implements a sophisticated retry mechanism:

1. **Attempt 1**: Standard execution with full context
2. **Attempt 2**: Enhanced context with RAG knowledge base query
3. **Attempt 3**: Knowledge request escalation to Knowledge Agent
4. **Attempt 4**: Task decomposition into subtasks
5. **Attempt 5**: Escalation to HR Agent for reassignment

Failed tasks are marked as `escalated` after 5 attempts and logged for review.

## Reward and Performance System

### Performance Scoring

The `PerformanceScorer` evaluates each completed task using weighted signals:

| Signal | Weight | Description |
|--------|--------|-------------|
| QA Pass Rate | 30% | Whether QA tests passed |
| Time Efficiency | 20% | Actual time vs estimated time |
| No Regressions | 20% | No breaking changes introduced |
| Code Quality | 15% | Code validation and structure |
| Attempt Count | 15% | Fewer retries = higher score |

**Scoring Formula**: `score = Σ(signal × weight) × 100`

**Score Ranges**:
- 90-100: Elite performance
- 75-89: Good performance
- 50-74: Acceptable, needs improvement
- 0-49: Poor, requires correction

### Reward Engine

The `RewardEngine` processes performance scores and injects context into agent memory:

**Elite Performance (90-100)**:
- Reward prompt: "Excellent work. Your approach was effective. Keep this momentum."
- Stored in agent's reward history
- Used as positive reinforcement in future tasks

**Good Performance (75-89)**:
- Reward prompt: "Good result. Task completed successfully. Consider optimizing approach."
- Stored in reward history
- Encourages continued improvement

**Acceptable Performance (50-74)**:
- Correction prompt: "Review: Consider alternative approaches. Improve for next time."
- Stored in correction history
- Guides agent toward better strategies

**Poor Performance (0-49)**:
- Recovery prompt: "Learning moment. What went wrong: [error]. Try: [lesson]."
- Triggers knowledge base download for learning
- Stored in correction history for pattern learning

### Agent Memory Integration

Rewards and corrections are stored in `agent_memories` table:

- **Reward History**: JSON array of positive feedback prompts
- **Correction History**: JSON array of improvement guidance
- **Performance Score**: Running average of task scores (0-100)
- **Patterns Learned**: Array of learned patterns and strategies

Agents use this memory to improve performance over time, referencing successful approaches and avoiding past mistakes.

### Milestone Rewards

When significant milestones are achieved (e.g., first deployment, 100 users, revenue milestone), the reward engine broadcasts celebration prompts to all agents, reinforcing positive behavior across the organization.

## Technical Stack

### Core Infrastructure

| Component | Technology | Purpose |
|-----------|------------|---------|
| Language | Python 3.11+ | Agent runtime and core logic |
| LLM Provider | Cloudflare Workers AI | Language model for all agents |
| Database | Cloudflare D1 (SQLite) | Persistent company state and task logs |
| Cache | Cloudflare Workers KV | Company brain cache (60s TTL) |
| Message Bus | Cloudflare D1 via Worker | Streams + consumer-group emulation |
| Vector Store | Cloudflare Vectorize | Knowledge base embeddings |
| Chunk Store | Cloudflare D1 | Knowledge chunk text |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 | Free local embeddings (384 dimensions) |

### LLM Model Selection (Tiered Strategy)

| Agent Role | Model | Approx. Cost (per 1M tokens) | Rationale |
|------------|-------|------------------------------|-----------|
| All roles | Llama-3.3-70b (Workers AI) | Free tier | All agent work |

### Development Tools

| Tool | Purpose |
|------|---------|
| FastAPI | Web framework for API endpoints |
| Next.js | Frontend dashboard framework |
| Wrangler | Cloudflare Worker deployment + resource management |
| uv / Poetry | Python dependency management |
| Structlog | Structured logging |
| Pydantic | Data validation and settings |

### External Integrations

| Service | Purpose | Required |
|---------|---------|----------|
| Cloudflare Workers AI | LLM provider | Built-in |
| Cloudflare (Worker + D1 + KV + Vectorize + Pages + Containers) | All persistent state and deployments | Yes |
| GitHub | Remote repos, push triggers, Actions CI monitoring | Optional |
| Brevo | Transactional + campaign email, product sequences, engagement tracking | Optional |
| Dodo Payments | Product subscriptions, trials, discounts, billing webhooks | Optional (test mode) |
| SignWell | Legal-grade document signing on subscription activation | Optional |
| Serper | Google search for CEO market research | Optional |
| Cloudflare Container | Code execution sandbox | Built-in |

Frontends deploy to Cloudflare Pages, backends to Workers (JS/TS) or Containers
(Python). Briefings appear on the dashboard and optionally via email.

## Installation

### Prerequisites

- **Operating System**: macOS or Linux
- **Python**: 3.11 or 3.12 (3.13+ untested with sentence-transformers)
- **Node.js**: 18 or higher (for worker + dashboard)
- **Cloudflare account**: For D1, KV, Vectorize, and Workers
- **Git**: For version control

### Required Services

1. **Cloudflare Account**: [cloudflare.com](https://cloudflare.com)
   - API token (`CF_API_TOKEN`) with edit perms for Workers Scripts, Workers KV, D1, Vectorize
   - Account ID (`CF_ACCOUNT_ID`) from the dashboard sidebar

2. **LLM brain**: Cloudflare Workers AI (Llama-3.3-70b) — runs via the company
   worker, no separate key needed. Free tier included.

### Installation Steps

```bash
# Clone repository
git clone https://github.com/Lazynext-AI/Autonomous-AI-Company-Operating-System.git
cd Autonomous-AI-Company-Operating-System

# Copy environment template
cp .env.example .env

# Edit .env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DEPLOY_TOKEN

# Install dependencies (uses uv)
make setup
# or: uv venv --python 3.12 .venv && uv pip install -e . --python .venv/bin/python

# Create Cloudflare resources (D1, KV namespace, Vectorize index)
make worker-resources
# Copy the printed resource IDs into worker/wrangler.toml

# Set the shared Worker secret
cd worker && npx wrangler secret put API_TOKEN && cd ..

# Apply the D1 schema and deploy the Worker
make worker-migrate
make worker-deploy

# Set CLOUDFLARE_API_URL + CLOUDFLARE_API_TOKEN in .env to the deployed worker URL
# and the secret you chose above

# Validate configuration
make validate-env
```

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CLOUDFLARE_API_URL` | Deployed Worker URL | `https://ai-company-os.you.workers.dev` |
| `CLOUDFLARE_API_TOKEN` | **Worker bearer token** — the secret agents/scripts send to the Worker | any long random string |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | `abc123...` |
| `CLOUDFLARE_DEPLOY_TOKEN` | Real Cloudflare REST token — wrangler/deploys only; **not** the same value as `CLOUDFLARE_API_TOKEN` | `cfut_...` |

> `CLOUDFLARE_API_TOKEN` is the bearer for *your* Worker; wrangler rejects it. `CLOUDFLARE_DEPLOY_TOKEN` authenticates to *Cloudflare*. Deploy commands map it in, e.g. `CLOUDFLARE_API_TOKEN="$CLOUDFLARE_DEPLOY_TOKEN" npx wrangler deploy`.

### Optional Environment Variables (services)

| Variable | Description |
|----------|-------------|
| `BREVO_API_KEY` | Email sequences, campaigns, engagement tracking |
| `DODO_API_KEY` / `DODO_API_BASE` / `DODO_PRODUCT_*` / `DODO_WEBHOOK_SECRET` | Billing — test-mode keys until the live flip |
| `SIGNWELL_API_KEY` | Subscription signing documents |
| `GITHUB_TOKEN` | Repo/PR access for agents |
| `SERPER_API_KEY` | Market research search |
| `DASHBOARD_PASSPHRASE` / `DASHBOARD_SESSION_TOKEN` | Founder dashboard login |
| `FOUNDER_EMAIL` | Alert/briefing recipient |
| `LAZYNEXT_API_KEY` | Enables authed public-API tests (`lzk_*` key) |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_MODEL` | Brain model (Workers AI) | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| `PRODUCTS_BASE_DIR` | Base directory for product repos | `./products` |
| `KNOWLEDGE_BASE_DIR` | Knowledge base PDF directory | `./knowledge_base` |
| `CEO_LOOP_INTERVAL` | CEO strategic loop interval (seconds) | `300` |
| `CTO_LOOP_INTERVAL` | CTO orchestration loop interval (seconds) | `120` |

### Database Schema

Apply `db/migrations/001_initial.sql` to D1 (`make worker-migrate`). Creates:

- `company_brain`: Single row with full company state
- `agent_memories`: Per-agent performance and memory
- `task_log`: All tasks with status and results
- `milestone_log`: Achieved milestones
- `bus_messages` / `bus_deliveries` / `bus_offsets`: Message bus streams + consumer groups
- `episodic_events`: Agent + company event feeds
- `knowledge_chunks`: RAG chunk text (embeddings in Vectorize)
- `download_history`: Knowledge downloader history

## Running the System

### Development Mode

```bash
# Start all agents (talks to the deployed Worker)
make dev
# or: set -a; source .env; set +a; .venv/bin/python scripts/run_agents.py

# In separate terminal, start dashboard
make dashboard
# or: cd dashboard && npm run dev
```

The system runs in foreground. Press `Ctrl+C` to stop. In production the fleet is launchd-supervised (`com.lazynext.fleet`, KeepAlive) — `pkill -f run_agents.py` is the *restart* (KeepAlive respawns exactly one; never run a manual instance alongside it). Health checks run via `com.lazynext.healthcheck` every 15 min.

### Initialization

1. **Deploy Worker**: `make worker-deploy` (after `worker-resources` + `worker-migrate`)
2. **Set Mission**: Update `company_brain` via the Worker or D1 console:
   ```sql
   UPDATE company_brain 
   SET product_name = 'Your Product Name', 
       mission = 'Your mission statement';
   ```
3. **Agents Begin**: CEO agent picks up mission and starts strategic loop
4. **Monitor**: dashboard at http://localhost:3000 (dev) or https://dashboard.lazynext.com (prod)

### Project Repository

Agents create one repo per product in `./products/<slug>/` (based on `product_name` in company brain):

- Each product gets its own git repository under `./products/<product-slug>/`
- Product code written in the resolved directory
- Separate from agent system code
- Can be deployed independently

## Project Structure

```
autonomous-ai-company/
├── agents/                    Agent implementations
│   ├── strategic/            CEO, CTO agents
│   ├── engineering/          Backend, Frontend, DevOps, QA agents
│   ├── growth/               Marketing, Sales, Customer Success agents
│   └── infrastructure/       Knowledge, HR, Finance agents
├── core/                      Core infrastructure
│   ├── llm/                  Workers AI client, local embeddings
│   ├── memory/               Company brain, agent memory, episodic memory
│   ├── messaging/            D1-backed bus, channels, message schemas
│   ├── knowledge/            RAG engine (Vectorize), document ingestion
│   ├── operations/           Task tracker, task log persistence
│   ├── evaluation/           Performance scorer, reward engine
│   ├── tools/                Code writer, validator, file manager, git manager,
│   │                         connectors.py (44-connector dispatch matrix)
│   └── watchdog/             Deadlock detector, health monitoring
├── worker/                    Cloudflare Worker API layer (D1 + KV + Vectorize)
│   └── src/billing.ts         Dodo subscriptions, trials, discounts, webhooks
├── db/                        D1 migrations
├── dashboard/                 Next.js Founder control panel (dashboard.lazynext.com)
├── extension/                 Browser extension (manifest v3)
├── marketing/                 Marketing site source (lazynext.com)
├── ops/                       Ops workers (status-redirect, launchdeck-redirect)
├── scripts/                   run_agents, validate_env, seed_knowledge
├── sdk/                       Platform SDKs — js/ (npm lazynext), go/
├── tests/                     Unit and integration tests
└── products/                  Product repos (one per product_name)
    └── accessibility-checker/ Live product — mirrored to
                               github.com/Lazynext-AI/accessibility-checker
        ├── worker.js          Product API routes
        ├── src/rules/         75-rule WCAG manifest + interactive checks
        ├── src/agent_surfaces.js  MCP / A2A / agent card / widget.js
        ├── sdk/{js,go,python} Product SDKs (+ python CLI)
        └── index.html         Scan UI (PWA)
```

## Performance and Scaling

### Optimization Strategies

**Model Selection**: Cost-optimized tiered model usage. Llama-3.3-70b for code generation, Llama-3.3-70b for simple tasks.

**Caching**: 
- Company brain: 60-second Workers KV cache reduces D1 reads by ~90%
- Episodic memory: D1 `episodic_events` table with lazy pruning

**Message Bus**:
- ~3-second long-poll balances responsiveness and request volume
- Consumer-group emulation ensures exactly-once delivery
- Horizontal scaling via multiple consumer instances

**Status Updates**:
- Throttled to maximum once per 60 seconds per agent
- Reduces D1 write load significantly

### Rate Limiting

Workers AI brain runs via the company worker /agent/generate:

- **Backoff Strategy**: Exponential backoff (15s → 30s → 60s → 90s → 120s)
- **Retry Count**: Up to 5 retries before failure
- **Error Handling**: Graceful degradation with error logging

### Cost Optimization

**Estimated Monthly Costs** (1000 tasks/day):

- Llama-3.3-70b (all agents): free Workers AI tier
- Cloudflare (D1 + KV + Vectorize + Workers): free tier covers most workloads
- **Total**: ~$25-65/month

**Optimization Tips**:
- Increase `CEO_LOOP_INTERVAL` and `CTO_LOOP_INTERVAL` for production
- Use the light model for non-critical tasks
- Cache company brain reads aggressively
- Batch operations where possible

## Production Deployment

### Infrastructure Requirements

**Minimum**:
- 2 CPU cores, 4GB RAM for the agent runner
- Cloudflare account (free tier sufficient)

**Recommended**:
- 4 CPU cores, 8GB RAM
- Cloudflare paid plan for higher D1/Workers limits

### Deployment Steps

1. **Deploy Cloudflare resources**:
   ```bash
   make worker-resources   # create D1, KV, Vectorize
   make worker-migrate     # apply schema
   make worker-deploy      # deploy Worker
   ```

2. **Deploy Agents**:
   ```bash
   # Option 1: Cloud VM (DigitalOcean, AWS EC2, etc.)
   # Option 2: Kubernetes (for high availability)
   ```

3. **Configure Environment**:
   ```bash
   # Set all environment variables in deployment platform
   # Use secrets management (AWS Secrets Manager, etc.)
   ```

4. **Deploy Dashboard**:
   ```bash
   # Deploy to Cloudflare Pages, or any static host
   # Set CLOUDFLARE_API_URL + CLOUDFLARE_API_TOKEN (server-side only)
   ```

5. **Set Up CI/CD**:
   - Products deploy via wrangler (Pages/Workers) directly from the agent runner
   - Set up monitoring and alerts

### Backups

- **D1** exports run weekly via `.github/workflows/backup.yml` (workflow
  artifact, 30-day retention). Manual: `make db-backup`.
- Restore + coverage matrix: `docs/disaster_recovery.md`.

### Horizontal Scaling

Agents are stateless and can scale horizontally:

- Run multiple instances of same agent type
- Consumer-group emulation distributes messages across instances
- D1 handles concurrent writes

**Example**: Run 3 Backend Agent instances for high throughput.

### Monitoring

- **Structured Logs**: All operations logged with structured data
- **Task Tracking**: All tasks logged in `task_log` table
- **Performance Metrics**: Agent performance scores tracked
- **Health Checks**: Deadlock detector monitors agent health
- **Deployment Verification**: Automatic smoke tests after deployments

## License

MIT
