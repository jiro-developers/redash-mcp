export type SafetyMode = "off" | "warn" | "strict";

export interface SafetyResult {
  blocked: boolean;
  warnings: string[];
  message: string;
  modifiedQuery?: string;
}

interface GuardConfig {
  mode: SafetyMode;
  disablePii: boolean;
  disableCost: boolean;
  autoLimit: number;
}

function getConfig(): GuardConfig {
  const raw = process.env.REDASH_SAFETY_MODE ?? "warn";
  const mode: SafetyMode = ["off", "warn", "strict"].includes(raw) ? (raw as SafetyMode) : "warn";
  return {
    mode,
    disablePii: process.env.REDASH_SAFETY_DISABLE_PII === "true",
    disableCost: process.env.REDASH_SAFETY_DISABLE_COST === "true",
    autoLimit: parseInt(process.env.REDASH_AUTO_LIMIT ?? "0", 10) || 0,
  };
}

function normalizeForAnalysis(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function hasWhere(sql: string): boolean {
  return /\bWHERE\b/.test(sql);
}

function hasLimit(sql: string): boolean {
  return /\bLIMIT\b/.test(sql);
}

function isSelect(sql: string): boolean {
  return /^\s*(SELECT|WITH)\b/i.test(sql);
}

function injectLimit(sql: string, limit: number): string {
  if (/\bLIMIT\b/i.test(sql)) return sql;
  if (!isSelect(sql)) return sql;
  return `${sql.trimEnd()} LIMIT ${limit}`;
}

export function analyzeQuery(sql: string): SafetyResult {
  const config = getConfig();

  if (config.mode === "off") {
    return { blocked: false, warnings: [], message: "" };
  }

  const upper = normalizeForAnalysis(sql);
  const warnings: string[] = [];
  let modifiedQuery: string | undefined;

  // ── Destructive (차단: warn/strict 모두) ────────────────────────────────────

  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX|FUNCTION)\b/.test(upper)) {
    return {
      blocked: true,
      warnings: [],
      message:
        "🚫 쿼리가 차단되었습니다.\n\n사유: DROP 문은 데이터/스키마를 영구 삭제합니다.\n규칙: DESTRUCTIVE / DROP\n\n해제가 필요하다면 REDASH_SAFETY_MODE=off 로 설정하세요.",
    };
  }

  if (/\bTRUNCATE\b/.test(upper)) {
    return {
      blocked: true,
      warnings: [],
      message:
        "🚫 쿼리가 차단되었습니다.\n\n사유: TRUNCATE 문은 전체 테이블 데이터를 삭제합니다.\n규칙: DESTRUCTIVE / TRUNCATE",
    };
  }

  if (/\bALTER\s+TABLE\b/.test(upper)) {
    return {
      blocked: true,
      warnings: [],
      message:
        "🚫 쿼리가 차단되었습니다.\n\n사유: ALTER TABLE은 스키마 변경으로 사전 협의가 필요합니다.\n규칙: DESTRUCTIVE / ALTER_TABLE",
    };
  }

  if (/\b(GRANT|REVOKE)\b/.test(upper)) {
    return {
      blocked: true,
      warnings: [],
      message:
        "🚫 쿼리가 차단되었습니다.\n\n사유: GRANT/REVOKE는 권한 변경으로 허용되지 않습니다.\n규칙: DESTRUCTIVE / PRIVILEGE_CHANGE",
    };
  }

  if (/\bDELETE\s+FROM\b/.test(upper) && !hasWhere(upper)) {
    return {
      blocked: true,
      warnings: [],
      message:
        "🚫 쿼리가 차단되었습니다.\n\n사유: WHERE 조건 없는 DELETE는 전체 데이터를 삭제합니다.\n규칙: DESTRUCTIVE / DELETE_WITHOUT_WHERE\n\n안전한 예시:\n  DELETE FROM orders WHERE created_at < '2024-01-01'",
    };
  }

  if (/\bUPDATE\b/.test(upper) && /\bSET\b/.test(upper) && !hasWhere(upper)) {
    return {
      blocked: true,
      warnings: [],
      message:
        "🚫 쿼리가 차단되었습니다.\n\n사유: WHERE 조건 없는 UPDATE는 전체 데이터를 수정합니다.\n규칙: DESTRUCTIVE / UPDATE_WITHOUT_WHERE\n\n안전한 예시:\n  UPDATE orders SET status = 'cancelled' WHERE created_at < '2024-01-01'",
    };
  }

  // DELETE/UPDATE with WHERE — 경고만
  if (/\bDELETE\s+FROM\b/.test(upper)) {
    warnings.push("[DESTRUCTIVE] DELETE 쿼리입니다. WHERE 조건을 다시 확인하세요.");
  }
  if (/\bUPDATE\b/.test(upper) && /\bSET\b/.test(upper)) {
    warnings.push("[DESTRUCTIVE] UPDATE 쿼리입니다. WHERE 조건을 다시 확인하세요.");
  }

  // ── Cost (warn: 경고 후 실행, strict: 차단) ────────────────────────────────
  if (!config.disableCost && isSelect(sql)) {
    const hasSelectStar = /SELECT\s+\*/.test(upper) || /SELECT\s+[\w.]+\.\*/.test(upper);
    const noWhere = !hasWhere(upper);
    const noLimit = !hasLimit(upper);

    if (hasSelectStar) {
      warnings.push(
        "[COST] SELECT *를 사용하고 있습니다. 필요한 컬럼만 명시하면 BigQuery 스캔 비용을 줄일 수 있습니다."
      );
    }
    if (noWhere) {
      warnings.push(
        "[COST] WHERE 조건이 없습니다. 날짜 또는 조건 필터를 추가하는 것을 권장합니다."
      );
    }
    if (noLimit) {
      if (config.autoLimit > 0) {
        modifiedQuery = injectLimit(sql, config.autoLimit);
        warnings.push(
          `[COST] LIMIT이 없어 자동으로 LIMIT ${config.autoLimit}을 추가했습니다. 전체 조회가 필요하면 명시적으로 LIMIT을 지정하세요.`
        );
      } else {
        warnings.push(
          "[COST] LIMIT이 없습니다. 대용량 테이블에서는 전체 데이터가 반환되어 비용이 발생할 수 있습니다."
        );
      }
    }

    if (config.mode === "strict") {
      const costWarnings = warnings.filter((w) => w.startsWith("[COST]"));
      if (costWarnings.length > 0) {
        return {
          blocked: true,
          warnings: [],
          message: `🚫 쿼리가 차단되었습니다 (strict 모드).\n\n${costWarnings.join("\n")}\n\nwarn 모드로 변경하려면 REDASH_SAFETY_MODE=warn 으로 설정하세요.`,
        };
      }
    }
  }

  // ── PII (warn: 경고 후 실행, strict: 차단) ────────────────────────────────
  if (!config.disablePii) {
    const piiPatterns = [
      "EMAIL",
      "PHONE",
      "PASSWORD",
      "PASSWD",
      "SSN",
      "SOCIAL_SECURITY",
      "CREDIT_CARD",
      "CARD_NUMBER",
      "주민",
      "휴대폰",
      "핸드폰",
      "생년월일",
    ];
    const matched = piiPatterns.filter((k) => upper.includes(k));
    if (matched.length > 0) {
      warnings.push(
        `[PII] 민감 정보 관련 컬럼이 감지되었습니다: ${matched.join(", ")}. 개인정보 처리 규정을 확인하세요.`
      );
    }

    if (config.mode === "strict") {
      const piiWarnings = warnings.filter((w) => w.startsWith("[PII]"));
      if (piiWarnings.length > 0) {
        return {
          blocked: true,
          warnings: [],
          message: `🚫 쿼리가 차단되었습니다 (strict 모드).\n\n${piiWarnings.join("\n")}\n\nwarn 모드로 변경하려면 REDASH_SAFETY_MODE=warn 으로 설정하세요.`,
        };
      }
    }
  }

  const message =
    warnings.length > 0
      ? `⚠️ 안전 경고 (쿼리는 실행됩니다)\n\n${warnings.join("\n")}\n\n---`
      : "";

  return { blocked: false, warnings, message, modifiedQuery };
}
