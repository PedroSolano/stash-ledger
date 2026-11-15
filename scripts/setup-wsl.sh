#!/usr/bin/env bash
# Prepara o ambiente de desenvolvimento no WSL (Ubuntu 24.04).
#   bash scripts/setup-wsl.sh --system   # bibliotecas do Tauri (pede a senha do sudo)
#   bash scripts/setup-wsl.sh            # Node (nvm), Rust (rustup) e GitHub CLI, sem sudo, no seu home
set -euo pipefail

if [ "${1:-}" = "--system" ]; then
  sudo apt-get update
  sudo apt-get install -y build-essential curl wget file pkg-config libssl-dev \
    libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev
  echo "System dependencies installed."
  exit 0
fi

cd ~
if [ ! -d "$HOME/.nvm" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash >/dev/null
fi
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install --lts >/dev/null 2>&1
nvm alias default 'lts/*' >/dev/null
grep -q 'NVM_DIR' ~/.bashrc || printf '%s\n' 'export NVM_DIR="$HOME/.nvm"' '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >> ~/.bashrc
echo "node $(node -v) / npm $(npm -v)"

if [ ! -x "$HOME/.cargo/bin/cargo" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path >/dev/null 2>&1
fi
grep -q '.cargo/env' ~/.bashrc || echo '. "$HOME/.cargo/env"' >> ~/.bashrc
. "$HOME/.cargo/env"
echo "$(rustc -V)"

mkdir -p ~/.local/bin
if [ ! -x ~/.local/bin/gh ]; then
  GH_JSON=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest)
  GH_VER=$(printf '%s' "$GH_JSON" | sed -nE 's/.*"tag_name": *"v([^"]+)".*/\1/p' | head -1)
  TMP=$(mktemp -d)
  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_linux_amd64.tar.gz" -o "$TMP/gh.tgz"
  tar -xzf "$TMP/gh.tgz" -C "$TMP"
  cp "$TMP/gh_${GH_VER}_linux_amd64/bin/gh" ~/.local/bin/gh
  rm -rf "$TMP"
fi
grep -q '.local/bin' ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
echo "$(~/.local/bin/gh --version | head -1)"
