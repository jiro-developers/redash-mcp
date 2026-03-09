# SQL Safety Guard — 설계 문서

## 개요

`redash-mcp`에 SQL 안전 가드 레이어를 추가하여 MCP를 통해 실행되는 쿼리로 인한
비용 발생, 데이터 손실, 개인정보 노출을 사전에 방지한다.

---

## 배경 및 목적

- Redash를 MCP로 연결하면 AI가 자동으로 쿼리를 생성·실행하는 환경이 된다
- 사용자가 SQL을 직접 검토하지 않는 경우가 많아 위험 쿼리가 그대로 실행될 수 있음
- BigQuery는 스캔한 데이터 용량 기준으로 과금되어 예상치 못한 비용 발생 가능
- AI가 생성한 쿼리에 DROP, DELETE 등이 포함될 경우 데이터 손실 위험

---

## 아키텍처

### 위치

```
AI (Claude)
    ↓ tool call
run_query (MCP 도구)
    ↓
[SQL Safety Guard]  ← 여기에 삽입
    ↓ 통과 시
Redash API
    ↓
BigQuery
```

### 패턴

미들웨어/인터셉터 패턴. `run_query` 핸들러 내부에서 Redash API 호출 전에 실행.

```typescript
// src/sql-guard.ts
export function analyzeQuery(sql: string, mode: SafetyMode): SafetyResult

// src/index.ts (run_query 핸들러)
const result = analyzeQuery(query, safetyMode);
if (result.blocked) {
  return { content: [{ type: "text", text: result.message }] };
}
// ... Redash API 호출
```

---

## 감지 규칙

### Category 1: 데이터 파괴 (Destructive) — 기본: 차단

| 규칙 | 패턴 예시 | 기본 동작 |
|---|---|---|
| DDL 변경 | `DROP TABLE`, `TRUNCATE`, `ALTER TABLE` | 차단 |
| 조건 없는 삭제 | `DELETE FROM table` (WHERE 없음) | 차단 |
| 조건 없는 수정 | `UPDATE table SET ...` (WHERE 없음) | 차단 |
| 권한 변경 | `GRANT`, `REVOKE` | 차단 |

### Category 2: 비용 위험 (Cost) — 기본: 경고

| 규칙 | 패턴 예시 | 기본 동작 |
|---|---|---|
| WHERE 없는 SELECT | `SELECT ... FROM table` (WHERE 없음) | 경고 |
| SELECT * | `SELECT * FROM ...` | 경고 |
| 집계 없는 대량 조회 | 조건 없이 raw 데이터 전체 조회 | 경고 |

### Category 3: 개인정보 (PII) — 기본: 경고

| 규칙 | 감지 컬럼명 키워드 | 기본 동작 |
|---|---|---|
| 민감 컬럼 SELECT | `email`, `phone`, `password`, `ssn`, `social`, `주민`, `휴대폰`, `핸드폰` | 경고 |

> PII 규칙은 컬럼명 기반 휴리스틱이며 오탐이 발생할 수 있다.
> 환경변수로 비활성화 가능.

---

## 동작 모드

```
REDASH_SAFETY_MODE=off|warn|strict
```

| 모드 | Destructive | Cost | PII |
|---|---|---|---|
| `off` | 통과 | 통과 | 통과 |
| `warn` (기본) | **차단** | 경고 후 실행 | 경고 후 실행 |
| `strict` | **차단** | **차단** | **차단** |

- Destructive는 모든 모드에서 `warn` 이상이면 차단 (데이터 손실은 되돌릴 수 없음)
- `off`는 완전히 비활성화가 필요한 경우를 위해 제공 (내부 관리자용 등)

---

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `REDASH_SAFETY_MODE` | `warn` | 전체 안전 모드 |
| `REDASH_SAFETY_DISABLE_PII` | `false` | PII 감지 비활성화 |
| `REDASH_SAFETY_DISABLE_COST` | `false` | 비용 경고 비활성화 |

---

## 응답 포맷

### 차단 시

```
🚫 쿼리가 차단되었습니다.

사유: WHERE 조건 없이 전체 테이블을 수정하는 쿼리는 실행할 수 없습니다.
규칙: DESTRUCTIVE / UPDATE_WITHOUT_WHERE

안전한 쿼리 예시:
  UPDATE orders SET status = 'cancelled' WHERE created_at < '2024-01-01'

안전 모드 해제가 필요하다면 REDASH_SAFETY_MODE=off 로 설정하세요.
```

### 경고 시 (warn 모드)

```
⚠️ 안전 경고 (쿼리는 실행됩니다)

[COST] SELECT *를 사용하고 있습니다. 필요한 컬럼만 명시하면 비용을 줄일 수 있습니다.
[COST] WHERE 조건이 없습니다. 날짜 또는 조건 필터를 추가하는 것을 권장합니다.

---
(쿼리 결과)
```

---

## 파일 구조

```
src/
  index.ts          # 기존 — run_query에 가드 연결
  sql-guard.ts      # 신규 — 안전 가드 핵심 로직
  setup.ts          # 기존 — 설치 마법사에 SAFETY_MODE 설정 추가
```

---

## setup 마법사 변경

```
? BigQuery 안전 모드를 선택하세요
  ○ off    — 제한 없음 (관리자 전용)
  ● warn   — 위험 패턴 경고 후 실행 (권장)
  ○ strict — 위험 쿼리 차단

? 개인정보(PII) 컬럼 감지를 활성화하시겠습니까?
  ● 예 / ○ 아니오
```

---

## 구현 범위 (v2.2.0)

### 포함
- [x] Destructive 쿼리 차단 (DDL, DELETE/UPDATE without WHERE)
- [x] Cost 경고/차단 (WHERE 없는 SELECT, SELECT *)
- [x] PII 컬럼 경고 (컬럼명 기반)
- [x] `REDASH_SAFETY_MODE` 환경변수
- [x] setup 마법사 안전 모드 설정 추가
- [x] 단위 테스트 (vitest)

### 제외 (추후 검토)
- Cartesian JOIN 감지 (SQL 파서 필요, 복잡도 높음)
- 쿼리 실행 횟수 기반 Rate limiting (상태 관리 필요)
- 실제 BQ 스캔 바이트 추정 (BQ 직접 접근 불가)

---

## 공식 플러그인 등록

### MCP 공식 레지스트리
- `modelcontextprotocol/servers` GitHub 레포에 PR 제출
- 요건: npm 패키지, README, 설치 가이드

### Claude Desktop
- 현재 Claude Desktop 플러그인 = MCP 서버
- 공식 디렉토리 등록은 Anthropic 신청 필요 (초대제 운영 중)
- 단기적으로는 MCP 커뮤니티 레지스트리 등록으로 대응

### 등록 준비 체크리스트
- [ ] README 영문화 (설치, 환경변수, 도구 목록)
- [ ] 라이선스 명시 (MIT)
- [ ] 버전 관리 전략 (semver)
- [ ] CHANGELOG 작성
