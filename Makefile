.PHONY: setup models dev dashboard test seed agents validate-env worker-resources worker-deploy worker-migrate

PY := $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)

validate-env:
	@echo "Validating .env and API keys..."
	PYTHONPATH=. $(PY) scripts/validate_env.py

setup:
	@bash scripts/setup.sh

models:
	@echo "Using Atlas Cloud API - point ATLAS_BASE_URL at api.atlascloud.ai/v1."
	@echo "Add ATLASCLOUD_API_KEY to .env (get at atlascloud.ai)"
	@echo "Model tiers: DeepSeek V3.1 Terminus (coding), DeepSeek V4 Flash (simple tasks)"
	@echo ""
	@echo "Embeddings: Free local sentence-transformers (no API key)"
	@echo "Model downloads automatically on first use (~90MB)"

# Cloudflare resource management (uses CLOUDFLARE_DEPLOY_TOKEN, or API_KEY+EMAIL)
worker-resources:
	@bash -lc 'set -a; . ./.env; set +a; \
		[ -n "$$CLOUDFLARE_DEPLOY_TOKEN" ] && export CLOUDFLARE_API_TOKEN=$$CLOUDFLARE_DEPLOY_TOKEN; \
		cd worker && \
		npx wrangler d1 create ai-company-db && \
		npx wrangler kv namespace create EPHEMERAL && \
		npx wrangler vectorize create company-knowledge --dimensions=384 --metric=cosine && \
		echo "Copy the printed IDs into worker/wrangler.toml"'

worker-migrate:
	@bash -lc 'set -a; . ./.env; set +a; \
		[ -n "$$CLOUDFLARE_DEPLOY_TOKEN" ] && export CLOUDFLARE_API_TOKEN=$$CLOUDFLARE_DEPLOY_TOKEN; \
		cd worker && for f in ../db/migrations/*.sql; do npx wrangler d1 execute ai-company-db --remote --file "$$f"; done'

worker-deploy:
	@bash -lc 'set -a; . ./.env; set +a; \
		[ -n "$$CLOUDFLARE_DEPLOY_TOKEN" ] && export CLOUDFLARE_API_TOKEN=$$CLOUDFLARE_DEPLOY_TOKEN; \
		cd worker && npx wrangler deploy'

dev:
	PYTHONPATH=. $(PY) scripts/run_agents.py

dashboard:
	cd dashboard && npm run dev

test:
	PYTHONPATH=. $(PY) -m pytest tests/ -v

seed:
	PYTHONPATH=. $(PY) scripts/seed_knowledge.py

agents:
	PYTHONPATH=. $(PY) scripts/run_agents.py
