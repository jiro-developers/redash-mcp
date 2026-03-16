# redash-mcp

MCP server that connects [Redash](https://redash.io) to Claude AI — query data, manage dashboards, and run SQL with natural language.

**[한국어 문서](README.md)**

---

## Features

### Tools

| Category | Tool | Description |
|---|---|---|
| Data Sources | `list_data_sources` | List connected data sources |
| Schema | `list_tables` | List tables (supports keyword search) |
| Schema | `get_table_columns` | Get column names and types |
| Query | `run_query` | Execute SQL and return results |
| Saved Queries | `list_queries` | List saved queries |
| Saved Queries | `get_query` | Get query details (SQL, visualizations) |
| Saved Queries | `get_query_result` | Run a saved query and get results |
| Saved Queries | `create_query` | Save a new query |
| Saved Queries | `update_query` | Update a saved query |
| Saved Queries | `fork_query` | Fork a saved query |
| Saved Queries | `archive_query` | Archive (delete) a query |
| Dashboards | `list_dashboards` | List dashboards |
| Dashboards | `get_dashboard` | Get dashboard details and widgets |
| Dashboards | `create_dashboard` | Create a new dashboard |
| Dashboards | `add_widget` | Add a visualization widget to a dashboard |
| Alerts | `list_alerts` | List alerts |
| Alerts | `get_alert` | Get alert details |
| Alerts | `create_alert` | Create a new alert |

### SQL Safety Guard

Protects your database from dangerous queries:

- **Blocked always**: `DROP`, `TRUNCATE`, `ALTER TABLE`, `GRANT/REVOKE`, `DELETE/UPDATE` without `WHERE`
- **Warned (warn mode)** / **Blocked (strict mode)**: `SELECT *`, queries without `WHERE` or `LIMIT`, PII column access
- **Auto-LIMIT**: Automatically appends `LIMIT N` when `REDASH_AUTO_LIMIT` is set

### Query Cache

Results are cached in-memory to reduce redundant API calls:

- TTL: configurable via `REDASH_MCP_CACHE_TTL` (default: 300s)
- Max memory: configurable via `REDASH_MCP_CACHE_MAX_MB` (default: 50MB)

---

## Installation

### Auto Setup (Recommended)

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/jiro-developers/redash-mcp/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/jiro-developers/redash-mcp/main/install.ps1 | iex
```

The installer will set up Node.js and Claude Desktop if needed, then configure the MCP server.

### Manual Setup

#### 1. Get your Redash API Key

Go to Redash → Profile (top right) → **Edit Profile** → Copy **API Key**

#### 2-A. Claude Desktop

Open the config file below and add the `mcpServers` entry. Create the file if it doesn't exist.

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

Fully quit and restart Claude Desktop after saving.

> `~/.redash-mcp/index.js` is an example. Use the actual absolute path. (e.g. `/Users/username/.redash-mcp/index.js`)
> On Windows, use `C:\Users\username\.redash-mcp\index.js` format.

#### 2-B. Claude Code (CLI)

Open the config file below and add the `mcpServers` entry.

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

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `REDASH_URL` | Redash instance URL (e.g. `https://redash.example.com`) |
| `REDASH_API_KEY` | Redash user API key |

### Optional

| Variable | Default | Description |
|---|---|---|
| `REDASH_SAFETY_MODE` | `warn` | SQL safety level: `off` / `warn` / `strict` |
| `REDASH_SAFETY_DISABLE_PII` | `false` | Disable PII detection |
| `REDASH_SAFETY_DISABLE_COST` | `false` | Disable cost warnings |
| `REDASH_AUTO_LIMIT` | `0` | Auto-append `LIMIT N` to queries without one (0 = disabled) |
| `REDASH_DEFAULT_MAX_AGE` | `0` | Redash cache TTL in seconds |
| `REDASH_MCP_CACHE_TTL` | `300` | MCP query cache TTL in seconds (0 = disabled) |
| `REDASH_MCP_CACHE_MAX_MB` | `50` | Max memory for MCP query cache in MB |

---

## Usage Examples

Just ask Claude in natural language:

- "Show me the columns in the users table"
- "Run a query to get order counts for the last 7 days"
- "List all saved queries"
- "Show widgets in the revenue dashboard"
- "Create an alert when daily signups drop below 100"
