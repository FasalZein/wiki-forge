#!/usr/bin/env bash
set -euo pipefail

# wiki-forge installer
# Sets up the wiki CLI, vault, shell env, and agent skills in one shot.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_DEFAULT="$HOME/Knowledge"

echo "=== wiki-forge setup ==="
echo ""

# 1. Check bun
if ! command -v bun &>/dev/null; then
  echo "bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
echo "[ok] bun $(bun --version)"

# 2. Install dependencies
cd "$REPO_DIR"
bun install --silent
echo "[ok] dependencies installed"

# 3. Install sqlite prerequisite for Bun qmd SDK on macOS
if [ "$(uname -s)" = "Darwin" ] && command -v brew &>/dev/null; then
  if [ ! -f "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib" ] && [ ! -f "/usr/local/opt/sqlite/lib/libsqlite3.dylib" ]; then
    echo "Installing Homebrew sqlite..."
    brew install sqlite >/dev/null 2>&1 || echo "[skip] Homebrew sqlite install failed"
  fi
fi

# 4. Sync CLI, qmd, and skills
echo "Syncing local CLI, qmd, and skills..."
bun run sync:local -- --with-companions
echo "[ok] local sync complete"

# 5. Set up vault
read -rp "Vault path [$VAULT_DEFAULT]: " vault_input
VAULT="${vault_input:-$VAULT_DEFAULT}"
mkdir -p "$VAULT"

# 6. Set KNOWLEDGE_VAULT_ROOT in shell config
SHELL_NAME="$(basename "${SHELL:-/bin/zsh}")"
case "$SHELL_NAME" in
  zsh)  RC_FILE="$HOME/.zshrc" ;;
  bash)
    if [ -f "$HOME/.bash_profile" ]; then
      RC_FILE="$HOME/.bash_profile"
    else
      RC_FILE="$HOME/.bashrc"
    fi
    ;;
  fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
  *)    RC_FILE="" ;;
esac

if [ -n "$RC_FILE" ]; then
  if grep -q "KNOWLEDGE_VAULT_ROOT" "$RC_FILE" 2>/dev/null; then
    echo "[ok] KNOWLEDGE_VAULT_ROOT already set in $(basename "$RC_FILE")"
  else
    echo "" >> "$RC_FILE"
    echo "# wiki-forge vault root" >> "$RC_FILE"
    echo "export KNOWLEDGE_VAULT_ROOT=\"$VAULT\"" >> "$RC_FILE"
    echo "[ok] added KNOWLEDGE_VAULT_ROOT=$VAULT to $(basename "$RC_FILE")"
  fi
else
  echo "[warn] unknown shell — manually add: export KNOWLEDGE_VAULT_ROOT=\"$VAULT\""
fi

echo ""
echo "=== setup complete ==="
echo ""
echo "Next steps:"
echo "  source $(basename "${RC_FILE:-your-shell-config}")"
echo "  wiki help"
echo "  bun run sync:local           # refresh CLI/qmd/repo skills after local changes"
echo ""
echo "Obsidian users: enable the Obsidian CLI in Settings → General → CLI."
echo "On macOS, wiki-forge retrieval uses Homebrew sqlite when available for Bun qmd SDK hybrid search."
echo "[note] /research is also required for full forge chaining. Install your agent's research skill separately if it is not already available."
echo "See SETUP.md for full details."
