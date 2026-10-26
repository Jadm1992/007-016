# Start the API (8787) and the React dev server
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    root="$(pwd)"
    (cd "$root/server" && bun run src/api.ts) &
    api_pid=$!
    trap 'kill $api_pid 2>/dev/null || true' EXIT
    cd "$root"
    bun run dev

# Start only the API
api:
    cd server && bun run src/api.ts

# Start only the UI
ui:
    bun run dev

# Build the frontend into public/
build:
    bun run build

# Server tests
test:
    cd server && bun test

# Typecheck the server
typecheck:
    cd server && bunx tsc --noEmit
