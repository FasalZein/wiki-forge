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

# 3. Link CLI globally
bun link --silent 2>/dev/null || true
echo "[ok] wiki CLI linked globally"

# 4. Set up vault
read -rp "Vault path [$VAULT_DEFAULT]: " vault_input
VAULT="${vault_input:-$VAULT_DEFAULT}"
mkdir -p "$VAULT"

# 5. Set KNOWLEDGE_VAULT_ROOT in shell config
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

# 6. Install skills (if npx skills is available)
if command -v npx &>/dev/null; then
  echo ""
  echo "Installing skills..."
  echo "You'll be prompted to choose which agents to install for."
  echo ""
  npx skills add "$REPO_DIR/skills/forge" -g 2>/dev/null || echo "[skip] forge skill (npx skills not configured)"
  npx skills add "$REPO_DIR/skills/wiki" -g 2>/dev/null || echo "[skip] wiki skill"
  npx skills add "$REPO_DIR/skills/prd-to-slices" -g 2>/dev/null || echo "[skip] prd-to-slices skill"
else
  echo ""
  echo "[skip] npx not found — install skills manually:"
  echo "  npx skills add ./skills/forge -g"
  echo "  npx skills add ./skills/wiki -g"
  echo "  npx skills add ./skills/prd-to-slices -g"
fi

echo ""
echo "=== setup complete ==="
echo ""
echo "Next steps:"
echo "  source $(basename "${RC_FILE:-your-shell-config}")"
echo "  wiki help"
echo ""
echo "Obsidian users: enable the Obsidian CLI in Settings → General → CLI."
echo "See SETUP.md for full details."
