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

# Run mobile UI audit (iPhone 17 emulation with video load timing & screenshots)
mobile query="":
    ./scripts/browser-mobile.sh {{ quote(query) }}

# -----------------------------------------------------------------------------
# Repowise Intelligence
# -----------------------------------------------------------------------------

# Update the Repowise codebase index
wise-update:
    repowise update

# Show Repowise sync state and index statistics
wise-status:
    repowise status

# Launch interactive Repowise architecture visualizer in browser
wise-serve:
    repowise serve

# Check codebase health scores, complexity, and hotspots
wise-health:
    repowise health

# Detect dead and unused exports or unreferenced files
wise-dead:
    repowise dead-code

# Analyze blast radius and risk (working tree diff or target file)
wise-risk target="":
    @if [ -z "{{ target }}" ]; then repowise risk; else repowise risk {{ quote(target) }}; fi

# View architecture triage card for a file or symbol
wise-context target:
    repowise context {{ quote(target) }}

# Run any repowise command directly
repowise *args:
    repowise {{ args }}

alias wise := wise-status
