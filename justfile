# Run test suite
test:
    cd server && bun test

# Run typescript type check
typecheck:
    cd server && bunx tsc --noEmit

# Check frontend javascript syntax
syntax:
    node --check public/app.js

# Start backend server
dev:
    cd server && bun run src/api.ts
