#!/bin/sh
set -e

PORT="${PORT:-11434}"
export OLLAMA_HOST="0.0.0.0:${PORT}"
MODEL="${OLLAMA_MODEL:-llama3.2:1b}"

echo "Starting Ollama on ${OLLAMA_HOST}..."

ollama serve &
SERVE_PID=$!

echo "Waiting for Ollama API..."
TRIES=0
until ollama list >/dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -ge 60 ]; then
    echo "Ollama failed to start within 120s"
    exit 1
  fi
  sleep 2
done

echo "Pulling ${MODEL} (first deploy may take several minutes)..."
ollama pull "${MODEL}"

echo "Ollama ready with ${MODEL}"
wait "${SERVE_PID}"
