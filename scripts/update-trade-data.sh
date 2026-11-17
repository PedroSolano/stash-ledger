#!/usr/bin/env bash
# Atualiza os dados de mods/bases do price check a partir do Awakened PoE Trade (MIT) e mostra o que
# mudou no código portado (src/trade/apt), para revisar à mão. Rode a cada liga nova.
set -euo pipefail
REF=~/refs/awakened-poe-trade
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -d "$REF/.git" ]; then git -C "$REF" pull -q --depth 1; else git clone -q --depth 1 https://github.com/SnosMe/awakened-poe-trade.git "$REF"; fi
OLD=$(cut -d' ' -f1 "$ROOT/src/trade/apt/UPSTREAM")
NEW=$(git -C "$REF" rev-parse HEAD)
cp "$REF"/renderer/public/data/en/{stats,items}.ndjson "$ROOT/src/renderer/public/trade-data/"
cp "$REF"/renderer/public/data/en/client_strings.js "$ROOT/src/trade/apt/assets/data/client_strings.en.js"
sed -i "s#import('../../../src/assets/data/interfaces')#import('./interfaces')#" "$ROOT/src/trade/apt/assets/data/client_strings.en.js"
git -C "$REF" log -1 --format='%H %cs' > "$ROOT/src/trade/apt/UPSTREAM"
echo "Data updated: $OLD -> $NEW"
if [ "$OLD" != "$NEW" ]; then
  git -C "$REF" fetch -q --depth 200 origin "$OLD" 2>/dev/null || true
  echo "Upstream changes in ported code (merge by hand if needed):"
  git -C "$REF" diff --stat "$OLD" "$NEW" -- renderer/src/parser renderer/src/web/price-check/filters renderer/src/web/price-check/trade renderer/src/assets/data 2>/dev/null || echo "  (history not available; compare the files manually)"
fi
