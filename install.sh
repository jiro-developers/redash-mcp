#!/usr/bin/env bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log_info()    { echo -e "  ${BLUE}ℹ${NC}  $1"; }
log_success() { echo -e "  ${GREEN}✓${NC}  $1"; }
log_warn()    { echo -e "  ${YELLOW}⚠${NC}  $1"; }
log_error()   { echo -e "  ${RED}✗${NC}  $1"; }
log_step()    { echo -e "\n${BOLD}▶ $1${NC}"; }
ask()         { printf "  $1 [y/N] "; read -r REPLY </dev/tty; echo "$REPLY"; }

echo ""
echo -e "  ${BOLD}redash-mcp 설치 마법사${NC}"
echo ""

OS="$(uname -s)"

# Homebrew가 non-interactive shell에서도 인식되도록 PATH에 추가
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# ── STEP 1: Node.js ───────────────────────────────────────────────────────────
log_step "Node.js 확인 중..."

if command -v node &>/dev/null; then
  log_success "Node.js $(node --version) 이미 설치되어 있습니다."
else
  log_warn "Node.js가 설치되어 있지 않습니다."

  NODE_INSTALLED=false

  if [ "$OS" = "Darwin" ]; then
    if command -v brew &>/dev/null; then
      log_info "Homebrew로 Node.js 설치 중..."
      if brew install node; then
        NODE_INSTALLED=true
      fi
    else
      log_error "Homebrew를 찾을 수 없습니다."
      echo ""
      echo "  → https://nodejs.org 에서 Node.js를 설치한 후 다시 실행해주세요."
      exit 1
    fi
  else
    # Linux: 패키지 매니저 순서대로 시도
    if command -v apt-get &>/dev/null; then
      log_info "apt로 Node.js 설치 중..."
      sudo apt-get install -y nodejs && NODE_INSTALLED=true
    elif command -v dnf &>/dev/null; then
      log_info "dnf로 Node.js 설치 중..."
      sudo dnf install -y nodejs && NODE_INSTALLED=true
    elif command -v yum &>/dev/null; then
      log_info "yum으로 Node.js 설치 중..."
      sudo yum install -y nodejs && NODE_INSTALLED=true
    else
      log_error "패키지 매니저를 찾을 수 없습니다."
      echo ""
      echo "  → https://nodejs.org 에서 Node.js를 설치한 후 다시 실행해주세요."
      exit 1
    fi
  fi

  if [ "$NODE_INSTALLED" = true ]; then
    log_success "Node.js 설치 완료"
    # 설치 후 PATH 갱신
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  else
    log_error "Node.js 설치에 실패했습니다."
    echo ""
    echo "  → https://nodejs.org 에서 직접 설치해주세요."
    exit 1
  fi
fi

# ── STEP 2: Claude Desktop ────────────────────────────────────────────────────
log_step "Claude Desktop 확인 중..."

if [ "$OS" = "Darwin" ]; then
  if [ -d "/Applications/Claude.app" ] || [ -d "$HOME/Applications/Claude.app" ]; then
    log_success "Claude Desktop이 이미 설치되어 있습니다."
  else
    log_warn "Claude Desktop이 설치되어 있지 않습니다."
    REPLY=$(ask "자동으로 설치할까요?")
    if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
      if command -v brew &>/dev/null; then
        log_info "Homebrew로 Claude Desktop 설치 중... (관리자 권한이 필요할 수 있습니다)"
        if brew install --cask claude; then
          log_success "Claude Desktop 설치 완료"
        else
          log_error "Claude Desktop 설치 실패"
          echo "  → https://claude.ai/download 에서 직접 설치해주세요."
        fi
      else
        echo "  → https://claude.ai/download 에서 직접 설치해주세요."
      fi
    else
      log_info "건너뜁니다. 나중에 https://claude.ai/download 에서 설치해주세요."
    fi
  fi
else
  log_warn "Linux는 Claude Desktop을 공식 지원하지 않습니다. 이 단계를 건너뜁니다."
fi

# ── STEP 3: redash-mcp 다운로드 ───────────────────────────────────────────────
log_step "redash-mcp 다운로드 중..."

MCP_DIR="$HOME/.redash-mcp"
MCP_BIN="$MCP_DIR/index.js"
mkdir -p "$MCP_DIR"

if curl -fsSL "https://raw.githubusercontent.com/jiro-developers/redash-mcp/main/dist/index.js" -o "$MCP_BIN"; then
  echo '{"type":"module"}' > "$MCP_DIR/package.json"
  log_success "다운로드 완료: $MCP_BIN"
else
  log_error "다운로드 실패. 네트워크 연결을 확인해주세요."
  exit 1
fi

# ── STEP 4: MCP 설정 ──────────────────────────────────────────────────────────
log_step "MCP 서버 설정을 시작합니다."
echo ""

# 설치 대상 선택
echo "  설치 대상을 선택하세요:"
echo "    1) Claude Desktop + Claude Code (CLI) 모두"
echo "    2) Claude Desktop만"
echo "    3) Claude Code (CLI)만"
printf "  선택 [1]: "
read -r TARGET_CHOICE </dev/tty
TARGET_CHOICE="${TARGET_CHOICE:-1}"

case "$TARGET_CHOICE" in
  2) INSTALL_DESKTOP=true;  INSTALL_CLI=false ;;
  3) INSTALL_DESKTOP=false; INSTALL_CLI=true  ;;
  *) INSTALL_DESKTOP=true;  INSTALL_CLI=true  ;;
esac

# Redash URL
while true; do
  printf "  Redash URL을 입력하세요 (예: https://redash.example.com): "
  read -r REDASH_URL </dev/tty
  if [ -z "$REDASH_URL" ]; then
    log_warn "URL을 입력해주세요."
  elif [[ "$REDASH_URL" != http://* ]] && [[ "$REDASH_URL" != https://* ]]; then
    log_warn "http:// 또는 https://로 시작해야 합니다."
  else
    REDASH_URL="${REDASH_URL%/}"
    break
  fi
done

# API Key
while true; do
  printf "  Redash API 키를 입력하세요: "
  read -r REDASH_API_KEY </dev/tty
  if [ -z "$REDASH_API_KEY" ]; then
    log_warn "API 키를 입력해주세요."
  else
    break
  fi
done

# JSON config 작성 (node 사용 - 이미 설치됨)
write_mcp_config() {
  local config_path="$1"
  mkdir -p "$(dirname "$config_path")"
  REDASH_URL="$REDASH_URL" REDASH_API_KEY="$REDASH_API_KEY" CONFIG_PATH="$config_path" MCP_BIN="$MCP_BIN" \
    node -e "
const fs = require('fs');
const configPath = process.env.CONFIG_PATH;
let config = {};
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
}
config.mcpServers = config.mcpServers || {};
config.mcpServers['redash-mcp'] = {
  command: 'node',
  args: [process.env.MCP_BIN],
  env: {
    REDASH_URL: process.env.REDASH_URL,
    REDASH_API_KEY: process.env.REDASH_API_KEY
  }
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
"
}

if [ "$INSTALL_DESKTOP" = true ]; then
  if [ "$OS" = "Darwin" ]; then
    DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
  else
    DESKTOP_CONFIG="$HOME/.config/Claude/claude_desktop_config.json"
  fi
  log_info "Claude Desktop 설정 중..."
  write_mcp_config "$DESKTOP_CONFIG"
  log_success "Claude Desktop 설정 완료"
fi

if [ "$INSTALL_CLI" = true ]; then
  log_info "Claude Code (CLI) 설정 중..."
  write_mcp_config "$HOME/.claude/settings.json"
  log_success "Claude Code (CLI) 설정 완료"
fi

echo ""
log_success "설치가 완료되었습니다. Claude를 재시작하면 redash-mcp를 사용할 수 있습니다."
echo ""
