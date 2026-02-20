#!/bin/bash
set -e

echo "=== Autonomous AI Company OS - Setup ==="

# Check macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "Warning: This script is optimized for macOS. Proceeding anyway..."
fi

# Check Apple Silicon
if [[ "$(uname -m)" == "arm64" ]]; then
    echo "Detected Apple Silicon (M1/M2/M3)"
else
    echo "Detected architecture: $(uname -m)"
fi

# Install Homebrew if missing
if ! command -v brew &> /dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Install Ollama
if ! command -v ollama &> /dev/null; then
    echo "Installing Ollama..."
    brew install ollama
fi

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo "Starting Ollama (run 'ollama serve' in another terminal if needed)..."
    ollama serve &
    sleep 5
fi

# Pull required models
echo "Pulling Ollama models (qwen2.5-coder:14b, llama3.1:8b, deepseek-r1:8b)..."
ollama pull qwen2.5-coder:14b || true
ollama pull llama3.1:8b || true
ollama pull deepseek-r1:8b || true

# Install Poetry
if ! command -v poetry &> /dev/null; then
    echo "Installing Poetry..."
    curl -sSL https://install.python-poetry.org | python3 -
    export PATH="$HOME/.local/bin:$PATH"
fi

# Create .env from example if not exists
if [[ ! -f .env ]]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "Please edit .env and fill in SUPABASE_URL, SUPABASE_ANON_KEY, GITHUB_TOKEN, RESEND_API_KEY"
fi

# Install Python dependencies
echo "Installing Python dependencies..."
poetry install

# Start Docker services
echo "Starting Redis and ChromaDB..."
docker-compose up -d

# Wait for services
echo "Waiting for Redis..."
sleep 3
until docker-compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do
    sleep 1
done

echo "Waiting for ChromaDB..."
sleep 5

# Run Supabase migration if SQL file exists
if [[ -f supabase/migrations/001_initial.sql ]]; then
    echo "Supabase migration file found. Run migrations manually via Supabase dashboard or CLI."
fi

# Seed knowledge base if PDFs exist
if [[ -d knowledge_base ]] && find knowledge_base -name "*.pdf" | read; then
    echo "Seeding knowledge base..."
    poetry run python scripts/seed_knowledge.py || true
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit .env with your Supabase, GitHub, and Resend credentials"
echo "2. Run 'make models' to ensure all Ollama models are pulled"
echo "3. Run 'make seed' to ingest knowledge base PDFs"
echo "4. Run 'make dev' to start all agents"
echo "5. Run 'make dashboard' to start the Founder dashboard"
echo ""
