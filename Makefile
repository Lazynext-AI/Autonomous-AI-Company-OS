.PHONY: setup models dev dashboard test seed agents validate-env

validate-env:
	@echo "Validating .env and API keys..."
	PYTHONPATH=. python3 scripts/validate_env.py

setup:
	@bash scripts/setup.sh

models:
	@echo "Using Anthropic Claude API - no local model download needed."
	@echo "Add ANTHROPIC_API_KEY to .env (get at console.anthropic.com)"
	@echo "Model tiers: Sonnet 4.5 (coding, cost-optimized), Haiku 4.5 (simple tasks)"
	@echo ""
	@echo "Embeddings: Free local sentence-transformers (no API key)"
	@echo "Install: pip install sentence-transformers"
	@echo "Model downloads automatically on first use (~90MB)"

dev:
	docker-compose up -d
	@echo "Starting agents..."
	PYTHONPATH=. python3 scripts/run_agents.py

dashboard:
	cd dashboard && npm run dev

test:
	poetry run pytest tests/ -v

seed:
	PYTHONPATH=. python3 scripts/seed_knowledge.py

agents:
	PYTHONPATH=. python3 scripts/run_agents.py
