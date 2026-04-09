#!/usr/bin/env bash
set -euo pipefail

PROJECT="${1:-wiki-cli}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/bin/wiki"

if [[ -z "${KNOWLEDGE_VAULT_ROOT:-}" ]]; then
  echo "error: set KNOWLEDGE_VAULT_ROOT to your external Knowledge vault" >&2
  exit 1
fi

"$CLI" scaffold-project "$PROJECT"
"$CLI" onboard-plan "$PROJECT" --repo "$REPO_ROOT" --write

python3 - <<'PY' "$KNOWLEDGE_VAULT_ROOT/projects/$PROJECT/_summary.md" "$REPO_ROOT"
import sys
p, repo = sys.argv[1], sys.argv[2]
s = open(p, 'r', encoding='utf-8').read()
if 'repo:' not in s:
    s = s.replace('status: scaffold', 'status: current\nrepo: ' + repo)
else:
    import re
    s = re.sub(r'^repo:\s+.*$', 'repo: ' + repo, s, flags=re.M)
open(p, 'w', encoding='utf-8').write(s)
PY

"$CLI" create-module "$PROJECT" cli --source src/index.ts src/cli-shared.ts || true
"$CLI" create-module "$PROJECT" verification --source src/commands/verification.ts src/lib/verification.ts || true
"$CLI" create-module "$PROJECT" retrieval --source src/commands/answers.ts src/commands/qmd-commands.ts src/lib/qmd.ts || true
"$CLI" create-module "$PROJECT" obsidian --source src/commands/obsidian.ts src/lib/obsidian.ts || true
"$CLI" create-module "$PROJECT" indexing --source src/commands/system.ts || true

"$CLI" update-index "$PROJECT" --write
"$CLI" maintain "$PROJECT" --repo "$REPO_ROOT" --base HEAD~1 || true

echo "bootstrapped dogfood project: $PROJECT"
echo "vault: $KNOWLEDGE_VAULT_ROOT"
echo "repo:  $REPO_ROOT"
