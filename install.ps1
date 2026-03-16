# redash-mcp 설치 마법사 (Windows PowerShell)
$ErrorActionPreference = "Stop"

function Write-Step    { Write-Host "`n▶ $args" -ForegroundColor White -BackgroundColor DarkGray }
function Write-Info    { Write-Host "  ℹ  $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "  ✓  $args" -ForegroundColor Green }
function Write-Warn    { Write-Host "  ⚠  $args" -ForegroundColor Yellow }
function Write-Fail    { Write-Host "  ✗  $args" -ForegroundColor Red }

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Has-Command($cmd) {
  return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "  redash-mcp 설치 마법사" -ForegroundColor White
Write-Host ""

# ── STEP 1: Node.js ───────────────────────────────────────────────────────────
Write-Step "Node.js 확인 중..."

if (Has-Command "node") {
  $nodeVersion = node --version
  Write-Success "Node.js $nodeVersion 이미 설치되어 있습니다."
} else {
  Write-Warn "Node.js가 설치되어 있지 않습니다."

  if (Has-Command "winget") {
    Write-Info "winget으로 Node.js 설치 중..."
    winget install -e --id OpenJS.NodeJS --silent --accept-package-agreements --accept-source-agreements

    # 현재 세션 PATH 갱신 (터미널 재시작 불필요)
    Refresh-Path

    if (Has-Command "node") {
      Write-Success "Node.js 설치 완료"
    } else {
      Write-Fail "Node.js 설치 후에도 인식되지 않습니다."
      Write-Host "  → 터미널을 재시작한 후 다시 실행해주세요."
      exit 1
    }
  } else {
    Write-Fail "winget을 찾을 수 없습니다."
    Write-Host "  → https://nodejs.org 에서 Node.js를 설치한 후 다시 실행해주세요."
    exit 1
  }
}

# ── STEP 2: Claude Desktop ────────────────────────────────────────────────────
Write-Step "Claude Desktop 확인 중..."

$claudePath = Join-Path $env:LOCALAPPDATA "AnthropicClaude"

if (Test-Path $claudePath) {
  Write-Success "Claude Desktop이 이미 설치되어 있습니다."
} else {
  Write-Warn "Claude Desktop이 설치되어 있지 않습니다."
  $answer = Read-Host "  자동으로 설치할까요? [y/N]"

  if ($answer -eq "y" -or $answer -eq "Y") {
    if (Has-Command "winget") {
      Write-Info "winget으로 Claude Desktop 설치 중..."
      try {
        winget install -e --id Anthropic.Claude --silent --accept-package-agreements --accept-source-agreements
        Write-Success "Claude Desktop 설치 완료"
      } catch {
        Write-Fail "Claude Desktop 설치 실패"
        Write-Host "  → https://claude.ai/download 에서 직접 설치해주세요."
      }
    } else {
      Write-Host "  → https://claude.ai/download 에서 직접 설치해주세요."
    }
  } else {
    Write-Info "건너뜁니다. 나중에 https://claude.ai/download 에서 설치해주세요."
  }
}

# ── STEP 3: MCP 설정 ──────────────────────────────────────────────────────────
Write-Step "MCP 서버 설정을 시작합니다."
Write-Host ""

# 설치 대상 선택
Write-Host "  설치 대상을 선택하세요:"
Write-Host "    1) Claude Desktop + Claude Code (CLI) 모두"
Write-Host "    2) Claude Desktop만"
Write-Host "    3) Claude Code (CLI)만"
$targetChoice = Read-Host "  선택 [1]"
if ([string]::IsNullOrWhiteSpace($targetChoice)) { $targetChoice = "1" }

$installDesktop = $true
$installCli     = $true
switch ($targetChoice) {
  "2" { $installDesktop = $true;  $installCli = $false }
  "3" { $installDesktop = $false; $installCli = $true  }
}

# Redash URL
do {
  $redashUrl = Read-Host "  Redash URL을 입력하세요 (예: https://redash.example.com)"
  if ([string]::IsNullOrWhiteSpace($redashUrl)) {
    Write-Warn "URL을 입력해주세요."
    $validUrl = $false
  } elseif ($redashUrl -notmatch "^https?://") {
    Write-Warn "http:// 또는 https://로 시작해야 합니다."
    $validUrl = $false
  } else {
    $redashUrl = $redashUrl.TrimEnd('/')
    $validUrl  = $true
  }
} while (-not $validUrl)

# API Key
do {
  $apiKey = Read-Host "  Redash API 키를 입력하세요"
  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Warn "API 키를 입력해주세요."
    $validKey = $false
  } else {
    $validKey = $true
  }
} while (-not $validKey)

# JSON config 작성 함수 (node 사용 - 이미 설치됨)
function Write-McpConfig($configPath) {
  $dir = Split-Path $configPath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

  $env:REDASH_URL     = $redashUrl
  $env:REDASH_API_KEY = $apiKey
  $env:CONFIG_PATH    = $configPath

  node -e @"
const fs = require('fs');
const configPath = process.env.CONFIG_PATH;
let config = {};
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
}
config.mcpServers = config.mcpServers || {};
config.mcpServers['redash-mcp'] = {
  command: 'npx',
  args: ['-y', 'redash-mcp'],
  env: {
    REDASH_URL: process.env.REDASH_URL,
    REDASH_API_KEY: process.env.REDASH_API_KEY
  }
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
"@
}

if ($installDesktop) {
  $desktopConfig = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"
  Write-Info "Claude Desktop 설정 중..."
  Write-McpConfig $desktopConfig
  Write-Success "Claude Desktop 설정 완료"
}

if ($installCli) {
  $cliConfig = Join-Path $env:USERPROFILE ".claude\settings.json"
  Write-Info "Claude Code (CLI) 설정 중..."
  Write-McpConfig $cliConfig
  Write-Success "Claude Code (CLI) 설정 완료"
}

Write-Host ""
Write-Success "설치가 완료되었습니다. Claude를 재시작하면 redash-mcp를 사용할 수 있습니다."
Write-Host ""
