#!/usr/bin/env bash
# talino installer — downloads and installs the latest Talino.app build for
# macOS from GitHub Releases. Requires the omp CLI agent to already be on
# your $PATH — see https://omp.sh.
#
#   curl -fsSL https://talino.raprast.asia/install | bash
#
set -euo pipefail

REPO="raka-raprast/talino"
APP_NAME="Talino"
OMP_URL="https://omp.sh"
INSTALL_DIR="${TALINO_INSTALL_DIR:-/Applications}"

# ── Output helpers ───────────────────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; RED=$'\033[0;31m'; GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; CYAN=""; NC=""
fi

log_info()    { printf '%s\xe2\x86\x92%s %s\n' "$CYAN" "$NC" "$1"; }
log_success() { printf '%s\xe2\x9c\x93%s %s\n' "$GREEN" "$NC" "$1"; }
log_warn()    { printf '%s\xe2\x9a\xa0%s %s\n' "$YELLOW" "$NC" "$1" >&2; }
log_error()   { printf '%s\xe2\x9c\x97%s %s\n' "$RED" "$NC" "$1" >&2; }

print_banner() {
  printf '\n%s%s' "$BOLD" "$CYAN"
  cat <<'EOF'
+-----------------------------------------------------------+
|                    talino installer                       |
|      a desktop IDE with an AI coding agent built in        |
+-----------------------------------------------------------+
EOF
  printf '%s\n' "$NC"
}

print_banner

if [ "$(uname -s)" != "Darwin" ]; then
  log_error "This installer is for macOS. On Windows, run:"
  log_error "  irm https://talino.raprast.asia/install.ps1 | iex"
  exit 1
fi

# ── 1. omp itself ─────────────────────────────────────────────────────────────
# Talino's chat panel drives the omp CLI agent; without it the app has
# nothing to run a conversation through, so it comes first.

if command -v omp >/dev/null 2>&1; then
  log_success "omp found: $(command -v omp)"
elif [ -x "$HOME/.local/bin/omp" ]; then
  log_success "omp found: $HOME/.local/bin/omp"
else
  log_error "omp not found. Install it first:"
  log_error "  curl -fsSL $OMP_URL/install | sh"
  log_error "then re-run this installer."
  exit 1
fi

# ── 2. Latest Talino build ────────────────────────────────────────────────────

case "$(uname -m)" in
  arm64) asset_arch="arm64" ;;
  x86_64) asset_arch="x64" ;;
  *) log_error "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

log_info "looking up the latest Talino release..."
release_json="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1")"
version="$(printf '%s' "$release_json" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
dmg_url="$(printf '%s' "$release_json" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed -E 's/.*"(https[^"]+)"/\1/' \
  | grep -i "mac-${asset_arch}\.dmg$" \
  | head -1)"

if [ -z "$dmg_url" ]; then
  log_error "Could not find a macOS ($asset_arch) build in the latest release."
  log_error "Browse https://github.com/$REPO/releases and download it by hand."
  exit 1
fi
log_success "found ${version:-latest}: $(basename "$dmg_url")"

# ── 3. Download, mount, install ───────────────────────────────────────────────

tmp_dir="$(mktemp -d)"
trap 'hdiutil detach "$tmp_dir/mount" -quiet >/dev/null 2>&1 || true; rm -rf "$tmp_dir"' EXIT

log_info "downloading..."
curl -fsSL -o "$tmp_dir/talino.dmg" "$dmg_url"

mkdir -p "$tmp_dir/mount"
log_info "mounting disk image..."
hdiutil attach "$tmp_dir/talino.dmg" -mountpoint "$tmp_dir/mount" -nobrowse -quiet

app_src="$tmp_dir/mount/$APP_NAME.app"
if [ ! -d "$app_src" ]; then
  log_error "$APP_NAME.app not found inside the downloaded disk image."
  exit 1
fi

if [ -d "$INSTALL_DIR/$APP_NAME.app" ]; then
  log_info "removing previous install at $INSTALL_DIR/$APP_NAME.app"
  rm -rf "$INSTALL_DIR/$APP_NAME.app"
fi

log_info "copying to $INSTALL_DIR..."
cp -R "$app_src" "$INSTALL_DIR/"
hdiutil detach "$tmp_dir/mount" -quiet

# Unsigned build — Gatekeeper quarantines anything downloaded over the
# network. You explicitly asked this script to install it, so clearing the
# flag here is a deliberate step, not a silent security bypass.
xattr -cr "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true

echo ""
log_success "installed: $INSTALL_DIR/$APP_NAME.app"
log_info "launch it from Applications, or: open \"$INSTALL_DIR/$APP_NAME.app\""
