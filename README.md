# Lazynext - The Autonomous AI Company OS

A production-grade, self-running organization of AI agents that autonomously builds, deploys, markets, and grows software products with zero human intervention after initial setup. The system operates as a complete virtual company with strategic leadership, engineering teams, growth functions, and infrastructure agents, all coordinated through an event-driven message bus architecture.

The entire backend runs on Cloudflare's serverless platform (D1, Workers KV, Vectorize, Workers) and Atlas Cloud for LLM inference — no local services required.

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Agent Types and Roles](#agent-types-and-roles)
4. [Workflow and Message Flow](#workflow-and-message-flow)
5. [Reward and Performance System](#reward-and-performance-system)
6. [Technical Stack](#technical-stack)
7. [Installation](#installation)
8. [Configuration](#configuration)
9. [Running the System](#running-the-system)
10. [Project Structure](#project-structure)
11. [Performance and Scaling](#performance-and-scaling)
12. [Production Deployment](#production-deployment)

## Overview

The Autonomous AI Company OS is an enterprise-grade multi-agent system that simulates a complete startup organization. The system consists of specialized AI agents that collaborate to build software products autonomously. Each agent has a specific role, capabilities, and responsibilities, working together through a sophisticated event-driven architecture.

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

- **Separation of Concerns**: Product code is built in a separate repository (`./product/`) isolated from the agent system
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
- **A2A**: `GET /.well-known/agent.json` (agent card) + `POST /a2a` (`tasks/send`/`tasks/get`) — other AI agents can delegate work
- **OAuth 2.0**: `POST /oauth/token` (client_credentials + authorization_code) + `POST /oauth/authorize` (admin-mints scoped `lzk_` keys)
- **Embeddable widget**: `<script src="https://ai-company.lazynext.com/widget.js"></script>` + `<div data-lazynext="status|chat">` — live status card / chat box on any site
- **Chat integrations**: webhook endpoints auto-detect Slack/Discord/Telegram URLs and format messages natively — connect in Settings → Chat integrations
- **Browser extension**: `extension/` — manifest v3, popup shows live status + tasks + queue box (load unpacked → Settings → paste `lzk_` key)
- **Copilot**: `copilot` channel in Conversations — real AI replies via Workers AI

The dashboard is also an installable PWA (manifest + icons) — "Add to Home Screen" / browser install works on mobile and desktop.

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
- **Model**: DeepSeek V3.1 Terminus (via Atlas Cloud)
- **Responsibilities**: Strategic direction, market analysis, goal setting
- **Output**: Strategic directives with priorities and deadlines
- **Frequency**: Runs every 5 minutes (configurable)
- **Channels**: Publishes to `ceo.directives`

#### CTO Agent
- **Model**: DeepSeek V3.1 Terminus (cost-optimized)
- **Responsibilities**: Technical orchestration, task decomposition, routing
- **Output**: 5-10 executable tasks per directive with acceptance criteria
- **Frequency**: Runs every 2 minutes (configurable)
- **Channels**: Consumes `ceo.directives`, publishes to role-specific task channels

### Engineering Agents

#### Backend Agent
- **Model**: DeepSeek V3.1 Terminus
- **Responsibilities**: FastAPI endpoints, database schemas, server logic
- **Capabilities**: Code generation, local sandboxed test execution, file writing, git commits
- **Channels**: Subscribes to `cto.tasks.backend`
- **Output**: Python/FastAPI code with validation and testing

#### Frontend Agent
- **Model**: DeepSeek V3.1 Terminus
- **Responsibilities**: Next.js pages, React components, UI implementation
- **Capabilities**: TypeScript/React code generation, file writing
- **Channels**: Subscribes to `cto.tasks.frontend`
- **Output**: TypeScript/React/Next.js code

#### DevOps Agent
- **Model**: DeepSeek V3.1 Terminus
- **Responsibilities**: CI/CD pipelines, deployments, infrastructure
- **Capabilities**: Cloudflare Pages/Workers deployments, deployment verification, live-URL health monitoring
- **Channels**: Subscribes to `cto.tasks.devops`
- **Output**: wrangler configs, deployment records

#### QA Agent
- **Model**: DeepSeek V3.1 Terminus
- **Responsibilities**: Continuous testing, health monitoring, bug detection
- **Frequency**: Runs health suite every 15 minutes
- **Channels**: Publishes to `qa.alerts`
- **Output**: Test results, health reports, incident alerts

### Growth Agents

#### Marketing Agent
- **Model**: DeepSeek V4 Flash
- **Responsibilities**: Content creation, SEO, campaigns, messaging
- **Channels**: Subscribes to `cto.tasks.marketing`
- **Output**: Marketing content, campaign strategies

#### Sales Agent
- **Model**: DeepSeek V4 Flash
- **Responsibilities**: Outreach, demos, pipeline management
- **Channels**: Subscribes to `cto.tasks.sales`
- **Output**: Sales outreach templates, demo scripts

#### Customer Success Agent
- **Model**: DeepSeek V4 Flash
- **Responsibilities**: Support, onboarding, feedback processing
- **Channels**: Subscribes to `cto.tasks.customer_success`
- **Output**: Support responses, onboarding guides

### Infrastructure Agents

#### Knowledge Agent
- **Model**: DeepSeek V4 Flash
- **Responsibilities**: RAG queries, document ingestion, knowledge retrieval
- **Channels**: Subscribes to `knowledge.requests`
- **Output**: Answers to knowledge queries, document summaries

#### HR Agent
- **Model**: DeepSeek V4 Flash
- **Responsibilities**: Agent scaling, resource allocation, team management
- **Channels**: Subscribes to `hr.requests`
- **Output**: Scaling recommendations, resource allocation plans

#### Finance Agent
- **Model**: DeepSeek V4 Flash
- **Responsibilities**: Financial reporting, metrics analysis, budget tracking
- **Frequency**: Generates weekly finance reports
- **Output**: Financial reports, revenue analysis

## Workflow and Message Flow

### Complete Task Lifecycle

1. **Strategic Planning Phase**
   - CEO agent reads company brain state
   - Performs market research via DuckDuckGo search
   - Generates strategic directive with goals, priorities, and deadline
   - Publishes directive to `ceo.directives` channel

2. **Task Decomposition Phase**
   - CTO agent consumes directive from `ceo.directives`
   - Uses DeepSeek V3.1 Terminus to decompose into 5-10 technical tasks
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
| LLM Provider | Atlas Cloud (OpenAI-compatible) | Language model for all agents |
| Database | Cloudflare D1 (SQLite) | Persistent company state and task logs |
| Cache | Cloudflare Workers KV | Company brain cache (60s TTL) |
| Message Bus | Cloudflare D1 via Worker | Streams + consumer-group emulation |
| Vector Store | Cloudflare Vectorize | Knowledge base embeddings |
| Chunk Store | Cloudflare D1 | Knowledge chunk text |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 | Free local embeddings (384 dimensions) |

### LLM Model Selection (Tiered Strategy)

| Agent Role | Model | Approx. Cost (per 1M tokens) | Rationale |
|------------|-------|------------------------------|-----------|
| Backend, Frontend, Fullstack | DeepSeek V3.1 Terminus | $0.30 / $0.95 | Code generation |
| CTO | DeepSeek V3.1 Terminus | $0.30 / $0.95 | Task decomposition |
| CEO, DevOps, QA, Code Review | DeepSeek V3.1 Terminus | $0.30 / $0.95 | Strategic thinking and infrastructure automation |
| Marketing, Sales, Support, HR, Finance, Knowledge | DeepSeek V4 Flash | $0.14 / $0.28 | Simple tasks optimized for cost efficiency |

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
| Atlas Cloud API | LLM provider | Yes |
| Cloudflare (Worker + D1 + KV + Vectorize + Pages + Containers) | All persistent state and deployments | Yes |
| GitHub | Remote repos, push triggers, Actions CI monitoring | Optional |
| Resend | Weekly founder briefing emails (also on dashboard) | Optional |
| E2B | Code execution sandbox | Optional |

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

2. **Atlas Cloud API Key**: Get from [atlascloud.ai](https://www.atlascloud.ai)
   - Required for all agent operations

### Installation Steps

```bash
# Clone repository
git clone https://github.com/ujjwalredd/Autonomous-AI-Company-Operating-System.git
cd autonomous-ai-company

# Copy environment template
cp .env.example .env

# Edit .env: ATLASCLOUD_API_KEY, CF_ACCOUNT_ID, CF_API_TOKEN

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
| `CLOUDFLARE_API_TOKEN` | Shared Worker secret | any long random string |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | `abc123...` |
| `CLOUDFLARE_API_KEY` | Cloudflare Global API Key (wrangler + deploys) | `cfk_...` |
| `CLOUDFLARE_EMAIL` | Cloudflare account email (global-key auth) | `you@example.com` |
| `ATLASCLOUD_API_KEY` | Atlas Cloud API key | `apikey-...` |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ATLAS_BASE_URL` | Atlas Cloud base URL | `https://api.atlascloud.ai/v1` |
| `ATLAS_MODEL` | Default model | `deepseek-ai/DeepSeek-V3.1-Terminus` |
| `PRODUCTS_BASE_DIR` | Base directory for product repos | `./products` |
| `KNOWLEDGE_BASE_DIR` | Knowledge base PDF directory | `./knowledge_base` |
| `CEO_LOOP_INTERVAL` | CEO strategic loop interval (seconds) | `300` |
| `CTO_LOOP_INTERVAL` | CTO orchestration loop interval (seconds) | `120` |
No optional service keys needed - everything runs on Cloudflare + Atlas Cloud + local git.

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
# or: PYTHONPATH=. python3 scripts/run_agents.py

# In separate terminal, start dashboard
make dashboard
# or: cd dashboard && npm run dev
```

The system runs in foreground. Press `Ctrl+C` to stop.

### Initialization

1. **Deploy Worker**: `make worker-deploy` (after `worker-resources` + `worker-migrate`)
2. **Set Mission**: Update `company_brain` via the Worker or D1 console:
   ```sql
   UPDATE company_brain 
   SET product_name = 'Your Product Name', 
       mission = 'Your mission statement';
   ```
3. **Agents Begin**: CEO agent picks up mission and starts strategic loop
4. **Monitor**: Check dashboard at http://localhost:3000 or the D1 console

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
│   ├── llm/                  Atlas Cloud client, local embeddings
│   ├── memory/               Company brain, agent memory, episodic memory
│   ├── messaging/            D1-backed bus, channels, message schemas
│   ├── knowledge/            RAG engine (Vectorize), document ingestion
│   ├── operations/           Task tracker, task log persistence
│   ├── evaluation/           Performance scorer, reward engine
│   ├── tools/                Code writer, validator, file manager, git manager, deployment
│   └── watchdog/             Deadlock detector, health monitoring
├── worker/                    Cloudflare Worker API layer (D1 + KV + Vectorize)
├── db/                        D1 migrations
├── dashboard/                 Next.js Founder control panel
├── scripts/                   run_agents, validate_env, seed_knowledge
├── tests/                     Unit and integration tests
└── products/                  Product repos (one per product_name, gitignored)
    └── <slug>/                e.g. my-cool-app/
        ├── .git/              Separate git repository per product
        ├── app/               Generated application code
        ├── migrations/        Database migrations
        └── ...
```

## Performance and Scaling

### Optimization Strategies

**Model Selection**: Cost-optimized tiered model usage. DeepSeek V3.1 Terminus for code generation, DeepSeek V4 Flash for simple tasks.

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

Atlas Cloud client includes automatic retry logic for 429 (rate limit) errors:

- **Backoff Strategy**: Exponential backoff (15s → 30s → 60s → 90s → 120s)
- **Retry Count**: Up to 5 retries before failure
- **Error Handling**: Graceful degradation with error logging

### Cost Optimization

**Estimated Monthly Costs** (1000 tasks/day):

- DeepSeek V3.1 Terminus (coding/strategy): ~$20-50/month
- DeepSeek V4 Flash (simple tasks): ~$5-15/month
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
