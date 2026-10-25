# Start the API server (port 8787)
api:
    cd server && bun run src/api.ts

# Start the React dev server (proxies /jobs and /media to the API)
ui:
    bun run dev

# Run server tests
test:
    cd server && bun test

# Typecheck the server
typecheck:
    cd server && bunx tsc --noEmit
