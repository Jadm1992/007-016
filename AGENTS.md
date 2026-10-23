## 📁 FILE SAVING & OUTPUT

- Never save user files, downloads, exports, or data to `.gemini/` or internal `brain/` directories.
- Always save requested files directly to the current working directory (`pwd`) or `~/Downloads`.
- Always output the real filesystem path.

## ⚙️ MODE & RUNTIME

- Python: Use `uv run`
- JS/TS: Use `bun run`
- HTTP: Use `xh --check-status --body` (not `curl`)

## 📂 FILE SEARCH & INSPECTION

- Never use raw `cat` on files >50 lines. Use `sed -n 'START,ENDp' <file>`.
- File finding: Use `fd --no-ignore-vcs` (not `find`)
- Text search: Use `rg --line-number --no-heading` (not `grep`)
- Code structure search & verification: `ast-grep` (e.g. `ast-grep run -p`, `ast-grep scan`, `ast-grep --json`)
- Listing: `ls -1F --color=never`
- Hierarchy: `tree -J -L 3`

## 🛠️ GIT & REPO

- `git status --porcelain=v1`
- `git diff --no-color --no-ext-diff`
- `gh --json`

## 📊 DATA & PARSING

- JSON: `jq -c`
- Unix command tables: `jc`
- Disk usage: `duf --json`
- System stats: `nproc; uptime; ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -12`

## 🧪 LOCAL INFRA & QUALITY

- Tasks: `just --list --unsorted`
- GitHub Actions: `actionlint`
- Security scan: `trivy fs --format json`

## 🔍 WEB SEARCH PRIORITY

1. Querit (Default)
2. Exa (Secondary Option)
3. Tavily (Date/domain constrained)
4. Firecrawl (Scraping/extraction)
