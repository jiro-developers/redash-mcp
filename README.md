# redash-mcp

[Redash](https://redash.io)를 Claude AI에 연결하는 MCP 서버 — 자연어로 데이터를 조회하고 대시보드를 관리하세요.

**[English Documentation](README.en.md)**

---

## 기능

### 툴 목록

| 카테고리 | 툴 | 설명 |
|---|---|---|
| 데이터소스 | `list_data_sources` | 연결된 데이터소스 목록 조회 |
| 스키마 | `list_tables` | 테이블 목록 조회 (키워드 검색 가능) |
| 스키마 | `get_table_columns` | 테이블 컬럼명 및 타입 조회 |
| 쿼리 실행 | `run_query` | SQL 직접 실행 후 결과 반환 |
| 저장 쿼리 | `list_queries` | 저장된 쿼리 목록 조회 |
| 저장 쿼리 | `get_query` | 쿼리 상세 정보 (SQL, 시각화 등) 조회 |
| 저장 쿼리 | `get_query_result` | 저장된 쿼리 실행 결과 조회 |
| 저장 쿼리 | `create_query` | 새 쿼리 저장 |
| 저장 쿼리 | `update_query` | 쿼리 수정 |
| 저장 쿼리 | `fork_query` | 쿼리 복제 |
| 저장 쿼리 | `archive_query` | 쿼리 삭제 (아카이브) |
| 대시보드 | `list_dashboards` | 대시보드 목록 조회 |
| 대시보드 | `get_dashboard` | 대시보드 상세 및 위젯 목록 조회 |
| 대시보드 | `create_dashboard` | 새 대시보드 생성 |
| 대시보드 | `add_widget` | 대시보드에 시각화 위젯 추가 |
| 알림 | `list_alerts` | 알림 목록 조회 |
| 알림 | `get_alert` | 알림 상세 정보 조회 |
| 알림 | `create_alert` | 새 알림 생성 |

### SQL 안전 가드

위험한 쿼리로부터 데이터베이스를 보호합니다:

- **항상 차단**: `DROP`, `TRUNCATE`, `ALTER TABLE`, `GRANT/REVOKE`, `WHERE` 없는 `DELETE/UPDATE`
- **경고 (warn 모드)** / **차단 (strict 모드)**: `SELECT *`, `WHERE`·`LIMIT` 없는 쿼리, PII 컬럼 접근
- **자동 LIMIT**: `REDASH_AUTO_LIMIT` 설정 시 LIMIT 없는 쿼리에 자동으로 `LIMIT N` 추가

### 쿼리 캐시

중복 API 호출을 줄이기 위해 결과를 메모리에 캐싱합니다:

- TTL: `REDASH_MCP_CACHE_TTL` 환경변수로 설정 (기본값: 300초)
- 최대 메모리: `REDASH_MCP_CACHE_MAX_MB` 환경변수로 설정 (기본값: 50MB)

---

## 설치

### 자동 설치 (권장)

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/jiro-developers/redash-mcp/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/jiro-developers/redash-mcp/main/install.ps1 | iex
```

Node.js와 Claude Desktop이 없으면 자동으로 설치하고, MCP 서버를 설정합니다.

### 수동 설치

#### 1. Redash API 키 발급

Redash → 우측 상단 프로필 → **Edit Profile** → **API Key** 복사

#### 2-A. Claude Desktop 설정

아래 config 파일을 열고 `mcpServers` 항목을 추가합니다. 파일이 없으면 새로 만드세요.

**macOS**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux**
```
~/.config/Claude/claude_desktop_config.json
```

```json
{
  "mcpServers": {
    "redash-mcp": {
      "command": "node",
      "args": ["~/.redash-mcp/index.js"],
      "env": {
        "REDASH_URL": "https://your-redash-instance.com",
        "REDASH_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

저장 후 Claude Desktop을 완전히 종료했다가 다시 시작합니다.

> `~/.redash-mcp/index.js`는 예시입니다. 실제 절대 경로로 입력하세요. (예: `/Users/username/.redash-mcp/index.js`)
> Windows는 `C:\Users\username\.redash-mcp\index.js` 형식을 사용합니다.

#### 2-B. Claude Code (CLI) 설정

아래 config 파일을 열고 `mcpServers` 항목을 추가합니다.

**macOS / Linux**
```
~/.claude/settings.json
```

**Windows**
```
%USERPROFILE%\.claude\settings.json
```

```json
{
  "mcpServers": {
    "redash-mcp": {
      "command": "node",
      "args": ["~/.redash-mcp/index.js"],
      "env": {
        "REDASH_URL": "https://your-redash-instance.com",
        "REDASH_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## 환경 변수

### 필수

| 변수 | 설명 |
|---|---|
| `REDASH_URL` | Redash 인스턴스 URL (예: `https://redash.example.com`) |
| `REDASH_API_KEY` | Redash 사용자 API 키 |

### 선택

| 변수 | 기본값 | 설명 |
|---|---|---|
| `REDASH_SAFETY_MODE` | `warn` | SQL 안전 수준: `off` / `warn` / `strict` |
| `REDASH_SAFETY_DISABLE_PII` | `false` | PII 감지 비활성화 |
| `REDASH_SAFETY_DISABLE_COST` | `false` | 비용 경고 비활성화 |
| `REDASH_AUTO_LIMIT` | `0` | LIMIT 없는 쿼리에 자동으로 `LIMIT N` 추가 (0 = 비활성화) |
| `REDASH_DEFAULT_MAX_AGE` | `0` | Redash 캐시 TTL (초) |
| `REDASH_MCP_CACHE_TTL` | `300` | MCP 쿼리 캐시 TTL (초, 0 = 비활성화) |
| `REDASH_MCP_CACHE_MAX_MB` | `50` | MCP 쿼리 캐시 최대 메모리 (MB) |

---

## 사용 예시

Claude에게 자연어로 요청하면 됩니다:

- "users 테이블 컬럼 보여줘"
- "최근 7일 주문 수를 SQL로 조회해줘"
- "저장된 쿼리 목록 보여줘"
- "매출 대시보드 위젯 목록 알려줘"
- "일별 가입자 수가 100명 이하로 떨어지면 알림 만들어줘"
