#!/usr/bin/env bash
set -euo pipefail

# wiki-forge installer
# Sets up the wiki CLI, vault, shell env, and agent skills in one shot.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_DEFAULT="$HOME/Knowledge"
INSTALL_SET=""
SKILL_MODE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --wiki-only)
      INSTALL_SET="wiki-only"
      ;;
    --full)
      INSTALL_SET="full"
      ;;
    --skip-skills)
      SKILL_MODE="skip"
      ;;
    --install-skills)
      SKILL_MODE="install"
      ;;
    *)
      echo "[error] unknown option: $1"
      echo "usage: ./install.sh [--wiki-only|--full] [--install-skills|--skip-skills]"
      exit 1
      ;;
  esac
  shift
done

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

# 4. Choose install set
if [ -z "$INSTALL_SET" ]; then
  echo "Install mode:"
  echo "  1) wiki-only  - second-brain setup only (/wiki)"
  echo "  2) full       - wiki + forge SDLC workflow (/wiki + /forge stack)"
  read -rp "Choose install mode [2]: " install_choice
  case "${install_choice:-2}" in
    1) INSTALL_SET="wiki-only" ;;
    2) INSTALL_SET="full" ;;
    *)
      echo "[error] invalid install mode: ${install_choice}"
      exit 1
      ;;
  esac
fi

# 5. Choose whether to install agent skills
if [ -z "$SKILL_MODE" ]; then
  echo "Agent skills:"
  if [ "$INSTALL_SET" = "wiki-only" ]; then
    echo "  1) install /wiki skill"
    echo "  2) skip skills for now (qmd only)"
  else
    echo "  1) install full workflow skills (/wiki + /forge stack + configured external companions)"
    echo "  2) skip skills for now (qmd only)"
  fi
  read -rp "Install agent skills? [1]: " skill_choice
  case "${skill_choice:-1}" in
    1) SKILL_MODE="install" ;;
    2) SKILL_MODE="skip" ;;
    *)
      echo "[error] invalid skill choice: ${skill_choice}"
      exit 1
      ;;
  esac
fi

SYNC_ARGS=(--install-set "$INSTALL_SET")
if [ "$SKILL_MODE" = "skip" ]; then
  SYNC_ARGS+=(--skip-skills)
fi

# 6. Sync CLI, qmd, and selected skills
echo "Syncing local CLI, qmd, and skills (${INSTALL_SET}; skills=${SKILL_MODE})..."
bun run sync:local -- "${SYNC_ARGS[@]}"
echo "[ok] local sync complete"

# 7. Set up vault
read -rp "Vault path [$VAULT_DEFAULT]: " vault_input
VAULT="${vault_input:-$VAULT_DEFAULT}"
mkdir -p "$VAULT"

# 8. Set KNOWLEDGE_VAULT_ROOT in shell config
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
echo "  bun run sync:local -- --install-set ${INSTALL_SET}   # refresh CLI/qmd/repo skills and external workflow companions after local changes"
echo "  bun run sync:local -- --install-set ${INSTALL_SET} --skip-skills   # refresh only CLI/qmd"
echo ""
if [ "$INSTALL_SET" = "wiki-only" ]; then
  echo "Installed mode: wiki-only"
  echo "  - wiki remains your second-brain layer"
  if [ "$SKILL_MODE" = "skip" ]; then
    echo "  - agent skills were skipped; install /wiki later with: bun run sync:wiki"
  else
    echo "  - installed /wiki skill only"
  fi
else
  echo "Installed mode: full"
  echo "  - wiki remains your second-brain layer"
  echo "  - forge adds the SDLC workflow layer on top"
  if [ "$SKILL_MODE" = "skip" ]; then
    echo "  - agent skills were skipped; install them later with: bun run sync:full"
  else
    echo "  - installed full workflow skills and external companion skills"
  fi
fi
echo ""
echo "Obsidian users: enable the Obsidian CLI in Settings → General → CLI."
echo "On macOS, wiki-forge retrieval uses Homebrew sqlite when available for Bun qmd SDK hybrid search."
echo "[note] Restart your agent session after syncing so it reloads the updated installed skill copies."
echo "See SETUP.md for full details."
