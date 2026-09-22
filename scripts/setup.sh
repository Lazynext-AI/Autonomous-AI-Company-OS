#!/bin/bash
set -e

echo "=== Autonomous AI Company OS - Setup ==="

# Check macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "Warning: This script is optimized for macOS. Proceeding anyway..."
fi

# Install uv if missing (fast Python env + deps)
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# Create .env from example if not exists
if [[ ! -f .env ]]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "Please edit .env and fill in CLOUDFLARE_API_URL, CLOUDFLARE_API_TOKEN"
fi

# Create Python 3.12 venv and install dependencies
echo "Installing Python dependencies..."
uv venv --python 3.12 .venv
uv pip install -e . --python .venv/bin/python

# Install worker dependencies
if [[ -d worker ]]; then
    echo "Installing worker dependencies..."
    (cd worker && npm install)
fi

# Install dashboard dependencies
if [[ -d dashboard ]]; then
    echo "Installing dashboard dependencies..."
    (cd dashboard && npm install)
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit .env: CF_ACCOUNT_ID, CF_API_TOKEN"
echo "2. Run 'make worker-resources' to create D1, KV, and Vectorize resources"
echo "3. Copy the printed resource IDs into worker/wrangler.toml"
echo "4. Run 'npx wrangler secret put API_TOKEN' in worker/ to set the shared secret"
echo "5. Run 'make worker-migrate' to apply the D1 schema, then 'make worker-deploy'"
echo "6. Set CLOUDFLARE_API_URL + CLOUDFLARE_API_TOKEN in .env to the deployed worker"
echo "7. Run 'make seed' to ingest knowledge base PDFs"
echo "8. Run 'make dev' to start all agents and 'make dashboard' for the dashboard"
echo ""
