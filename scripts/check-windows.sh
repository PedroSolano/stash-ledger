#!/usr/bin/env bash
# Type-checks the Rust backend for Windows from WSL (catches errors in the cfg(windows) code without
# waiting for CI). Requires the target: rustup target add x86_64-pc-windows-msvc
#
# `cargo check` never links, but build scripts still run a C compiler (ring), an archiver and a
# resource compiler (tauri-winres). Stub versions that only create empty output files are enough.
set -uo pipefail
. "$HOME/.cargo/env"
FAKE="$HOME/.local/fakemsvc"
mkdir -p "$FAKE"
cat > "$FAKE/cl" <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    -Fo*|/Fo*) f="${a:3}"; mkdir -p "$(dirname "$f")"; : > "$f" ;;
    -E|/E) exit 0 ;;
  esac
done
prev=""
for a in "$@"; do [ "$prev" = "-o" ] && { mkdir -p "$(dirname "$a")"; : > "$a"; }; prev="$a"; done
exit 0
EOF
cat > "$FAKE/lib" <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do case "$a" in -out:*|/OUT:*|/out:*) f="${a#*:}"; mkdir -p "$(dirname "$f")"; : > "$f" ;; esac; done
exit 0
EOF
cat > "$FAKE/llvm-rc" <<'EOF'
#!/usr/bin/env bash
prev=""
for a in "$@"; do
  case "$prev" in /fo|-fo|/FO|-FO) mkdir -p "$(dirname "$a")"; : > "$a" ;; esac
  case "$a" in /fo?*|-fo?*) f="${a:3}"; mkdir -p "$(dirname "$f")"; : > "$f" ;; esac
  prev="$a"
done
exit 0
EOF
chmod +x "$FAKE/cl" "$FAKE/lib" "$FAKE/llvm-rc"
export PATH="$FAKE:$PATH"
export CC_x86_64_pc_windows_msvc="$FAKE/cl" AR_x86_64_pc_windows_msvc="$FAKE/lib"
cd "$(dirname "$0")/../src-tauri"
cargo check --target x86_64-pc-windows-msvc --target-dir target/wincheck 2>&1 | grep -v "^warning: ring"
exit "${PIPESTATUS[0]}"
