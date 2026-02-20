# Autonomous AI Company Operating System

A production-grade, self-running organization of AI agents that autonomously builds, deploys, markets, and grows software products with zero human intervention after initial setup. The system operates as a complete virtual company with strategic leadership, engineering teams, growth functions, and infrastructure agents, all coordinated through an event-driven message bus architecture.

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
- **Automatic Deployment**: DevOps agents trigger deployments via Railway/Vercel with verification
- **Quality Assurance**: Continuous testing and health monitoring with automatic remediation
- **Performance Tracking**: Comprehensive scoring and reward system for agent improvement
- **Knowledge Management**: RAG-powered knowledge base for context-aware decision making

### Core Principles

- **Separation of Concerns**: Product code is built in a separate repository (`./product/`) isolated from the agent system
- **Event-Driven Architecture**: Redis Streams ensure reliable, exactly-once message delivery
- **Tiered Model Selection**: Cost-optimized LLM usage based on task importance
- **Fail-Safe Operations**: Automatic retries, rollbacks, and escalation protocols
- **Production-Ready**: Code validation, file backups, conflict detection, and git branch management

## System Architecture

### Message Bus (Redis Streams)

The system uses Redis Streams as the backbone for inter-agent communication. Each channel represents a specific message type or routing destination:

- **Channels**: `ceo.directives`, `cto.tasks.backend`, `cto.tasks.frontend`, `agent.reports`, `qa.alerts`, etc.
- **Consumer Groups**: Agents consume messages using Redis consumer groups for exactly-once delivery
- **Role-Based Routing**: CTO publishes tasks to role-specific channels ensuring correct agent assignment
- **Blocking Reads**: Agents poll channels with 3-second block time for responsive task processing

### Company Brain (Supabase)

Persistent shared state stored in PostgreSQL via Supabase:

- **Product State**: Product name, description, mission, tech stack
- **Metrics**: Users, revenue, MRR, uptime, error rates, deployment counts
- **Features**: Shipped features, open bugs, user feedback
- **Blockers**: Technical blockers preventing progress
- **Agent Statuses**: Current status and activity of all agents

**Caching**: Redis cache with 60-second TTL reduces database load for frequent reads.

### Episodic Memory (Redis)

Short-term event storage per agent:

- **Recent Events**: Task started, completed, failed events
- **Context Window**: Last 24 hours of activity
- **Purpose**: Provides context for LLM calls and decision-making
- **Expiration**: Events automatically expire after 24 hours

### Knowledge Base (ChromaDB + LlamaIndex)

RAG-powered knowledge retrieval system:

- **Vector Store**: ChromaDB for semantic search
- **Embeddings**: Free local `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions)
- **Ingestion**: PDF documents ingested and chunked for retrieval
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
- **Model**: Claude Sonnet 4.5
- **Responsibilities**: Strategic direction, market analysis, goal setting
- **Output**: Strategic directives with priorities and deadlines
- **Frequency**: Runs every 5 minutes (configurable)
- **Channels**: Publishes to `ceo.directives`

#### CTO Agent
- **Model**: Claude Sonnet 4.5 (cost-optimized)
- **Responsibilities**: Technical orchestration, task decomposition, routing
- **Output**: 5-10 executable tasks per directive with acceptance criteria
- **Frequency**: Runs every 2 minutes (configurable)
- **Channels**: Consumes `ceo.directives`, publishes to role-specific task channels

### Engineering Agents

#### Backend Agent
- **Model**: Claude Sonnet 4.5 (cost-optimized)
- **Responsibilities**: FastAPI endpoints, database schemas, server logic
- **Capabilities**: Code generation, E2B testing, file writing, git commits
- **Channels**: Subscribes to `cto.tasks.backend`
- **Output**: Python/FastAPI code with validation and testing

#### Frontend Agent
- **Model**: Claude Sonnet 4.5 (cost-optimized)
- **Responsibilities**: Next.js pages, React components, UI implementation
- **Capabilities**: TypeScript/React code generation, file writing
- **Channels**: Subscribes to `cto.tasks.frontend`
- **Output**: TypeScript/React/Next.js code

#### DevOps Agent
- **Model**: Claude Sonnet 4.5
- **Responsibilities**: CI/CD pipelines, deployments, infrastructure
- **Capabilities**: Railway/Vercel deployments, git hooks setup, deployment verification
- **Channels**: Subscribes to `cto.tasks.devops`
- **Output**: Deployment configurations, GitHub Actions workflows

#### QA Agent
- **Model**: Claude Sonnet 4.5
- **Responsibilities**: Continuous testing, health monitoring, bug detection
- **Frequency**: Runs health suite every 15 minutes
- **Channels**: Publishes to `qa.alerts`
- **Output**: Test results, health reports, incident alerts

### Growth Agents

#### Marketing Agent
- **Model**: Claude Haiku 4.5
- **Responsibilities**: Content creation, SEO, campaigns, messaging
- **Channels**: Subscribes to `cto.tasks.marketing`
- **Output**: Marketing content, campaign strategies

#### Sales Agent
- **Model**: Claude Haiku 4.5
- **Responsibilities**: Outreach, demos, pipeline management
- **Channels**: Subscribes to `cto.tasks.sales`
- **Output**: Sales outreach templates, demo scripts

#### Customer Success Agent
- **Model**: Claude Haiku 4.5
- **Responsibilities**: Support, onboarding, feedback processing
- **Channels**: Subscribes to `cto.tasks.customer_success`
- **Output**: Support responses, onboarding guides

### Infrastructure Agents

#### Knowledge Agent
- **Model**: Claude Haiku 4.5
- **Responsibilities**: RAG queries, document ingestion, knowledge retrieval
- **Channels**: Subscribes to `knowledge.requests`
- **Output**: Answers to knowledge queries, document summaries

#### HR Agent
- **Model**: Claude Haiku 4.5
- **Responsibilities**: Agent scaling, resource allocation, team management
- **Channels**: Subscribes to `hr.requests`
- **Output**: Scaling recommendations, resource allocation plans

#### Finance Agent
- **Model**: Claude Haiku 4.5
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
   - Uses Claude Sonnet 4.5 to decompose into 5-10 technical tasks
   - Each task includes: description, acceptance criteria, estimated minutes, assign_to field
   - Publishes tasks to role-specific channels (e.g., `cto.tasks.backend`)

3. **Task Execution Phase**
   - Worker agent (e.g., Backend Agent) consumes task from subscribed channel
   - Updates task status to `in_progress` in `task_log`
   - Builds context: company brain, episodic memory, knowledge base queries
   - Executes task via LLM call with role-specific system prompt
   - Validates generated code syntax (Python, TypeScript, YAML, etc.)
   - Tests code with E2B sandbox (if available, skips dependency-heavy code)
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
   - Triggers Railway deployment (backend) or Vercel deployment (frontend)
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

- **Reward History**: JSONB array of positive feedback prompts
- **Correction History**: JSONB array of improvement guidance
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
| LLM Provider | Anthropic Claude API | Language model for all agents |
| Database | Supabase (PostgreSQL) | Persistent company state and task logs |
| Cache & Messaging | Redis 5.x | Message bus and episodic memory |
| Vector Store | ChromaDB | Knowledge base embeddings |
| RAG Framework | LlamaIndex | Retrieval augmented generation |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 | Free local embeddings (384 dimensions) |

### LLM Model Selection (Tiered Strategy)

| Agent Role | Model | Cost (Input/Output per 1M tokens) | Rationale |
|------------|-------|----------------------------------|-----------|
| Backend, Frontend, Fullstack | Claude Sonnet 4.5 | $3 / $15 | Code generation (cost-optimized from Opus) |
| CTO | Claude Sonnet 4.5 | $3 / $15 | Task decomposition (cost-optimized from Opus) |
| CEO, DevOps, QA | Claude Sonnet 4.5 | $3 / $15 | Strategic thinking and infrastructure automation |
| Marketing, Sales, Support, HR, Finance, Knowledge | Claude Haiku 4.5 | $1 / $5 | Simple tasks optimized for cost efficiency |

### Development Tools

| Tool | Purpose |
|------|---------|
| FastAPI | Web framework for API endpoints |
| Next.js | Frontend dashboard framework |
| Docker Compose | Local service orchestration (Redis, ChromaDB) |
| Poetry | Python dependency management |
| Structlog | Structured logging |
| Pydantic | Data validation and settings |

### External Integrations

| Service | Purpose | Required |
|---------|---------|----------|
| Anthropic Claude API | LLM provider | Yes |
| Supabase | Database and storage | Yes |
| Redis | Message bus and caching | Yes |
| ChromaDB | Vector store | Yes |
| GitHub | Version control and CI/CD | Optional |
| Vercel | Frontend deployment | Optional |
| Railway | Backend deployment | Optional |
| E2B | Code execution sandbox | Optional |
| Resend | Email notifications | Optional |

## Installation

### Prerequisites

- **Operating System**: macOS or Linux
- **Python**: 3.11 or higher
- **Node.js**: 18 or higher (for dashboard)
- **Docker**: For Redis and ChromaDB services
- **Git**: For version control

### Required Services

1. **Supabase Project**: Create at [supabase.com](https://supabase.com)
   - Get `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
   - Run migration: `supabase/migrations/001_initial.sql`

2. **Anthropic Claude API Key**: Get from [console.anthropic.com](https://console.anthropic.com)
   - Required for all agent operations

3. **Redis Instance**: Local via Docker or cloud provider
   - Default: `redis://localhost:6379`

### Installation Steps

```bash
# Clone repository
git clone https://github.com/ujjwalredd/Autonomous-AI-Company-Operating-System.git
cd autonomous-ai-company

# Copy environment template
cp .env.example .env

# Edit .env with your API keys and configuration
# Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

# Install Python dependencies
make setup
# or: poetry install

# Install sentence-transformers for free embeddings
pip install sentence-transformers

# Validate configuration
make validate-env

# Run database migration
# Execute supabase/migrations/001_initial.sql in Supabase SQL Editor
```

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | `eyJhbGci...` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | `eyJhbGci...` |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | `sk-ant-...` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_MODEL` | Default Claude model | `claude-sonnet-4-5` |
| `CHROMA_PERSIST_DIR` | ChromaDB storage path | `./chroma_db` |
| `PRODUCTS_BASE_DIR` | Base directory for product repos (one per product_name) | `./products` |
| `KNOWLEDGE_BASE_DIR` | Knowledge base PDF directory | `./knowledge_base` |
| `CEO_LOOP_INTERVAL` | CEO strategic loop interval (seconds) | `300` |
| `CTO_LOOP_INTERVAL` | CTO orchestration loop interval (seconds) | `120` |
| `FOUNDER_EMAIL` | Email for founder briefings | - |
| `GITHUB_TOKEN` | GitHub API token | - |
| `VERCEL_TOKEN` | Vercel deployment token | - |
| `VERCEL_DEPLOY_HOOK_URL` | Vercel deploy hook URL | - |
| `RAILWAY_TOKEN` | Railway deployment token | - |
| `RAILWAY_DEPLOY_HOOK_URL` | Railway deploy hook URL | - |
| `E2B_API_KEY` | E2B sandbox API key | - |
| `RESEND_API_KEY` | Resend email API key | - |

### Database Schema

Run the migration script in Supabase SQL Editor:

```sql
-- Creates tables:
-- - company_brain: Single row with full company state
-- - agent_memories: Per-agent performance and memory
-- - task_log: All tasks with status and results
-- - milestone_log: Achieved milestones
```

See `supabase/migrations/001_initial.sql` for complete schema.

## Running the System

### Development Mode

```bash
# Start Redis and ChromaDB services
make dev
# or: docker-compose up -d && python scripts/run_agents.py

# In separate terminal, start dashboard
make dashboard
# or: cd dashboard && npm run dev
```

The system runs in foreground. Press `Ctrl+C` to stop.

### Initialization

1. **Start Services**: `make dev` starts Redis and ChromaDB
2. **Set Mission**: Update `company_brain` table in Supabase:
   ```sql
   UPDATE company_brain 
   SET product_name = 'Your Product Name', 
       mission = 'Your mission statement'
   WHERE id = (SELECT id FROM company_brain LIMIT 1);
   ```
3. **Agents Begin**: CEO agent picks up mission and starts strategic loop
4. **Monitor**: Check dashboard at http://localhost:3000 or Supabase tables

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
│   ├── llm/                  Claude client, local embeddings
│   ├── memory/                Company brain, agent memory, episodic memory
│   ├── messaging/             Redis bus, channels, message schemas
│   ├── knowledge/             RAG engine, document ingestion
│   ├── operations/           Task tracker, task log persistence
│   ├── evaluation/            Performance scorer, reward engine
│   ├── tools/                 Code writer, validator, file manager, git manager, deployment
│   └── watchdog/               Deadlock detector, health monitoring
├── dashboard/                 Next.js Founder control panel
├── scripts/                   run_agents, validate_env, seed_knowledge
├── supabase/                  Database migrations
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

**Model Selection**: Cost-optimized tiered model usage. Sonnet 4.5 for code generation (replaced Opus 4.6), Haiku 4.5 for simple tasks. Reduces costs by ~70% compared to using Opus for all tasks.

**Caching**: 
- Company brain: 60-second Redis cache reduces Supabase reads by ~90%
- Episodic memory: In-memory Redis lists for fast access

**Message Bus**:
- 3-second block time balances responsiveness and CPU usage
- Consumer groups ensure exactly-once delivery
- Horizontal scaling via multiple consumer instances

**Status Updates**:
- Throttled to maximum once per 60 seconds per agent
- Reduces Supabase write load significantly

### Rate Limiting

Claude API client includes automatic retry logic for 429 (rate limit) errors:

- **Backoff Strategy**: Exponential backoff (15s → 30s → 60s → 90s → 120s)
- **Retry Count**: Up to 5 retries before failure
- **Error Handling**: Graceful degradation with error logging

### Cost Optimization

**Estimated Monthly Costs** (1000 tasks/day):

- Sonnet (coding): ~$15-30/month (replaced Opus for cost savings)
- Sonnet (strategy): ~$30-60/month  
- Haiku (simple tasks): ~$10-20/month
- **Total**: ~$90-180/month

**Optimization Tips**:
- Increase `CEO_LOOP_INTERVAL` and `CTO_LOOP_INTERVAL` for production
- Use Haiku for non-critical tasks
- Cache company brain reads aggressively
- Batch operations where possible

## Production Deployment

### Infrastructure Requirements

**Minimum**:
- 2 CPU cores, 4GB RAM
- Supabase project (free tier sufficient)
- Redis instance (managed or self-hosted)
- ChromaDB (local or managed)

**Recommended**:
- 4 CPU cores, 8GB RAM
- Managed Supabase (production tier)
- Managed Redis (Redis Cloud, AWS ElastiCache)
- Managed ChromaDB or persistent volume

### Deployment Steps

1. **Deploy Services**:
   ```bash
   # Redis: Use managed service (Redis Cloud, AWS ElastiCache)
   # ChromaDB: Deploy with persistent storage
   ```

2. **Deploy Agents**:
   ```bash
   # Option 1: Cloud VM (DigitalOcean, AWS EC2, etc.)
   # Option 2: Serverless (AWS Lambda, Google Cloud Functions)
   # Option 3: Kubernetes (for high availability)
   ```

3. **Configure Environment**:
   ```bash
   # Set all environment variables in deployment platform
   # Use secrets management (AWS Secrets Manager, etc.)
   ```

4. **Deploy Dashboard**:
   ```bash
   # Deploy to Vercel, Netlify, or similar
   # Configure environment variables
   ```

5. **Set Up CI/CD**:
   - GitHub Actions workflow included
   - Configure deploy hooks for Railway/Vercel
   - Set up monitoring and alerts

### Horizontal Scaling

Agents are stateless and can scale horizontally:

- Run multiple instances of same agent type
- Use distinct consumer group names per instance
- Redis Streams distributes messages across instances
- Supabase handles concurrent writes

**Example**: Run 3 Backend Agent instances for high throughput.

### Monitoring

- **Structured Logs**: All operations logged with structured data
- **Task Tracking**: All tasks logged in `task_log` table
- **Performance Metrics**: Agent performance scores tracked
- **Health Checks**: Deadlock detector monitors agent health
- **Deployment Verification**: Automatic smoke tests after deployments

## License

MIT
