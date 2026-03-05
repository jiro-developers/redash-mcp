#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import { execSync } from "child_process";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

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
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "npx";
}

function getConfigPath(): string {
  const platform = os.platform();
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else if (platform === "win32") {
    return path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json");
  } else {
    return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
  }
}

export async function main() {
  console.log("\n🔧 redash-mcp 설치 마법사\n");

  const redashUrl = (await ask("Redash URL을 입력하세요 (예: https://redash.example.com): ")).trim().replace(/\/$/, "");
  const apiKey = (await ask("Redash API 키를 입력하세요: ")).trim();
  rl.close();

  if (!redashUrl || !apiKey) {
    console.error("\n❌ URL과 API 키를 모두 입력해야 합니다.");
    process.exit(1);
  }

  const configPath = getConfigPath();
  let config: any = { mcpServers: {} };

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      config.mcpServers ??= {};
    } catch {
      console.error("\n❌ claude_desktop_config.json 파일을 읽을 수 없습니다.");
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }

  const npxPath = findNpxPath();

  config.mcpServers["redash-mcp"] = {
    command: npxPath,
    args: ["-y", "redash-mcp"],
    env: {
      REDASH_URL: redashUrl,
      REDASH_API_KEY: apiKey,
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

  console.log("\n✅ 설치 완료!");
  console.log(`   설정 파일: ${configPath}`);
  console.log("\n👉 Claude Desktop을 완전히 종료했다가 다시 시작하면 redash-mcp가 활성화됩니다.\n");
}

