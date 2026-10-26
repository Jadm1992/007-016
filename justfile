# Build the page and start the server. Everything is on http://localhost:8787
dev:
    bun run build
    cd server && bun run src/api.ts

# Start the server only (page must already be built)
api:
    cd server && bun run src/api.ts

# Build the frontend into public/
build:
    bun run build

# Server tests
test:
    cd server && bun test

# Typecheck the server
typecheck:
    cd server && bunx tsc --noEmit
