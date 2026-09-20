# How This AI Company Works - Operations Guide

## Roles

- CEO agent: sets direction, writes weekly founder briefing, tracks milestones
- CTO agent: breaks strategy into tasks, assigns to engineering agents
- Backend / Frontend / Fullstack / DevOps / QA / Code Review agents: build, test, deploy
- Marketing / Sales / Customer Success / HR / Finance agents: growth and operations
- Knowledge agent: answers questions from this knowledge base

## Shared state

- `company_brain` table: product name, mission, live URLs, metrics, blockers
- `task_log`: every task, its assignee, status, and result
- `episodic_events`: rolling 7-day feed of what agents did
- `briefings`: founder-facing reports, shown on the dashboard at /briefings
- `knowledge_chunks` + Vectorize index: this knowledge base

## Message bus

Agents coordinate over channels on the Worker bus: task channels per role, QA alerts, milestone broadcasts. Tasks carry acceptance criteria and estimated minutes.

## Deployment flow

1. CTO assigns a deploy task to DevOps
2. DevOps writes config, runs the Cloudflare deployer, updates `live_urls`
3. Health check runs against the live URLs; failures auto-create a rollback task and a blocker
4. First successful deploy records a `first_deployment` milestone
