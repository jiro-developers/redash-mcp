#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import * as p from "@clack/prompts";

function findNpxPath(): string {
  try {
    const result = execSync("which npx", { encoding: "utf8" }).trim();
    if (result) return result;
  } catch {}
  const candidates = [
    "/usr/local/bin/npx",
    "/opt/homebrew/bin/npx",
    "/usr/bin/npx",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "npx";
}

function getDesktopConfigPath(): string {
  const platform = os.platform();
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else if (platform === "win32") {
    return path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json");
  } else {
    return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
  }
}

function getClaudeCodeConfigPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export async function main() {
  p.intro("redash-mcp 설치 마법사");

  const targets = await p.multiselect({
    message: "설치 대상을 선택하세요 (스페이스바로 선택, 엔터로 확인)",
    options: [
      { value: "desktop", label: "Claude Desktop" },
      { value: "cli", label: "Claude Code (CLI)" },
    ],
    required: true,
  });

  if (p.isCancel(targets)) {
    p.cancel("설치가 취소되었습니다.");
    process.exit(0);
  }

  const redashUrl = await p.text({
    message: "Redash URL을 입력하세요",
    placeholder: "https://redash.example.com",
    validate(value: string | undefined) {
      if (!value) return "URL을 입력해주세요.";
      if (!value.startsWith("http://") && !value.startsWith("https://"))
        return "http:// 또는 https://로 시작해야 합니다.";
    },
  });

  if (p.isCancel(redashUrl)) {
    p.cancel("설치가 취소되었습니다.");
    process.exit(0);
  }

  const apiKey = await p.text({
    message: "Redash API 키를 입력하세요",
    validate(value: string | undefined) {
      if (!value) return "API 키를 입력해주세요.";
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel("설치가 취소되었습니다.");
    process.exit(0);
  }

  // ── 안전 모드 설정 ────────────────────────────────────────────────────────
  const safetyMode = await p.select({
    message: "SQL 안전 모드를 선택하세요",
    options: [
      { value: "warn", label: "warn   — 위험 쿼리 경고 후 실행 (권장)" },
      { value: "strict", label: "strict — 위험 쿼리 차단" },
      { value: "off", label: "off    — 제한 없음 (관리자 전용)" },
    ],
    initialValue: "warn",
  });

  if (p.isCancel(safetyMode)) {
    p.cancel("설치가 취소되었습니다.");
    process.exit(0);
  }

  const autoLimitRaw = await p.text({
    message: "자동 LIMIT 값을 입력하세요 (0 = 비활성화)",
    placeholder: "1000",
    initialValue: "1000",
    validate(value: string | undefined) {
      if (!value) return undefined;
      if (isNaN(parseInt(value, 10))) return "숫자를 입력해주세요.";
    },
  });

  if (p.isCancel(autoLimitRaw)) {
    p.cancel("설치가 취소되었습니다.");
    process.exit(0);
  }

  const defaultMaxAgeRaw = await p.text({
    message: "Redash 캐시 유지 시간을 입력하세요 (초, 0 = 항상 새로 실행)",
    placeholder: "600",
    initialValue: "600",
    validate(value: string | undefined) {
      if (!value) return undefined;
      if (isNaN(parseInt(value, 10))) return "숫자를 입력해주세요.";
    },
  });

  if (p.isCancel(defaultMaxAgeRaw)) {
    p.cancel("설치가 취소되었습니다.");
    process.exit(0);
  }

  const mcpCacheTtlRaw = await p.text({
    message: "MCP 레이어 캐시 TTL을 입력하세요 (초, 0 = 비활성화)",
    placeholder: "300",
    initialValue: "300",
    validate(value: string | undefined) {
      if (!value) return undefined;
      if (isNaN(parseInt(value, 10))) return "숫자를 입력해주세요.";
    },
  });

  if (p.isCancel(mcpCacheTtlRaw)) {
    p.cancel("설치가 취소되었습니다.");
    process.exit(0);
  }

  const url = redashUrl.replace(/\/$/, "");
  const npxPath = findNpxPath();

  const mcpEntry = {
    command: npxPath,
    args: ["-y", "redash-mcp"],
    env: {
      REDASH_URL: url,
      REDASH_API_KEY: apiKey,
      REDASH_SAFETY_MODE: String(safetyMode),
      REDASH_AUTO_LIMIT: String(autoLimitRaw || "1000"),
      REDASH_DEFAULT_MAX_AGE: String(defaultMaxAgeRaw || "600"),
      REDASH_MCP_CACHE_TTL: String(mcpCacheTtlRaw || "300"),
    },
  };

  const s = p.spinner();

  if (targets.includes("desktop")) {
    s.start("Claude Desktop 설정 중...");
    setupDesktop(mcpEntry);
    s.stop("Claude Desktop 설정 완료");
  }

  if (targets.includes("cli")) {
    s.start("Claude Code (CLI) 설정 중...");
    setupClaudeCode(mcpEntry);
    s.stop("Claude Code (CLI) 설정 완료");
  }

  p.outro("설치가 완료되었습니다. 재시작 후 사용할 수 있습니다.");
}

function setupDesktop(mcpEntry: any) {
  const configPath = getDesktopConfigPath();
  let config: any = { mcpServers: {} };

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      config.mcpServers ??= {};
    } catch {
      throw new Error(`claude_desktop_config.json 파일을 읽을 수 없습니다: ${configPath}`);
    }
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }

  config.mcpServers["redash-mcp"] = mcpEntry;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

function setupClaudeCode(mcpEntry: any) {
  const configPath = getClaudeCodeConfigPath();
  let config: any = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      throw new Error(`Claude Code settings.json 파일을 읽을 수 없습니다: ${configPath}`);
    }
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }

  config.mcpServers ??= {};
  config.mcpServers["redash-mcp"] = mcpEntry;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}
