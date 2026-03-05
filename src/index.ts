import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const REDASH_URL = process.env.REDASH_URL?.replace(/\/$/, "");
const REDASH_API_KEY = process.env.REDASH_API_KEY;

if (!REDASH_URL || !REDASH_API_KEY) {
  console.error("REDASH_URL and REDASH_API_KEY environment variables are required");
  process.exit(1);
}

async function redashFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${REDASH_URL}/api${path}`, {
    ...options,
    headers: {
      "Authorization": `Key ${REDASH_API_KEY}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Redash API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function pollQueryResult(jobId: string): Promise<any> {
  for (let i = 0; i < 30; i++) {
    const job = await redashFetch(`/jobs/${jobId}`);
    if (job.job.status === 3) {
      return await redashFetch(`/query_results/${job.job.query_result_id}`);
    }
    if (job.job.status === 4) {
      throw new Error(`Query failed: ${job.job.error}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Query timed out");
}

// Schema cache: data_source_id → { schema, timestamp }
const schemaCache = new Map<number, { schema: any[]; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분

async function fetchSchema(dataSourceId: number): Promise<any[]> {
  const cached = schemaCache.get(dataSourceId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.schema;
  }
  const result = await redashFetch(`/data_sources/${dataSourceId}/schema`);
  const schema = result.schema ?? [];
  schemaCache.set(dataSourceId, { schema, ts: Date.now() });
  return schema;
}

const server = new McpServer({
  name: "redash-mcp",
  version: "2.0.0",
});

// Tool: list data sources
server.tool(
  "list_data_sources",
  "Redash에 연결된 데이터소스 목록(id, name, type)을 반환합니다. 항상 이 툴을 먼저 호출해 data_source_id를 확인하세요.",
  {},
  async () => {
    const data = await redashFetch("/data_sources");
    const sources = data.map((ds: any) => ({
      id: ds.id,
      name: ds.name,
      type: ds.type,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(sources, null, 2) }],
    };
  }
);

// Tool: list tables
server.tool(
  "list_tables",
  "데이터소스의 테이블 목록을 반환합니다. keyword로 관련 테이블을 검색할 수 있습니다. SQL 작성 전 반드시 이 툴로 테이블명을 확인하고, get_table_columns로 컬럼을 확인하세요.",
  {
    data_source_id: z.number().describe("list_data_sources로 확인한 데이터소스 ID"),
    keyword: z.string().optional().describe("테이블명 검색 키워드 (예: 'user', 'order')"),
  },
  async ({ data_source_id, keyword }) => {
    const schema = await fetchSchema(data_source_id);
    let tables = schema.map((t: any) => t.name);
    if (keyword) {
      tables = tables.filter((name: string) => name.toLowerCase().includes(keyword.toLowerCase()));
    }
    const summary = `총 ${tables.length}개 테이블${keyword ? ` ('${keyword}' 포함)` : ""}\n\n${tables.join("\n")}`;
    return {
      content: [{ type: "text", text: summary }],
    };
  }
);

// Tool: get table columns
server.tool(
  "get_table_columns",
  "특정 테이블의 컬럼명과 타입을 반환합니다. SQL 작성 전 실제 컬럼명을 반드시 확인하세요. 확인 후 run_query로 SQL을 실행하세요.",
  {
    data_source_id: z.number().describe("list_data_sources로 확인한 데이터소스 ID"),
    table_name: z.string().describe("list_tables로 확인한 테이블명"),
  },
  async ({ data_source_id, table_name }) => {
    const schema = await fetchSchema(data_source_id);
    let table = schema.find((t: any) => t.name.toLowerCase() === table_name.toLowerCase());
    if (!table) {
      table = schema.find((t: any) => t.name.toLowerCase().includes(table_name.toLowerCase()));
    }
    if (!table) {
      return {
        content: [{ type: "text", text: `테이블 '${table_name}'을 찾을 수 없습니다. list_tables로 정확한 테이블명을 확인하세요.` }],
      };
    }
    const cols = (table.columns ?? []).map((c: any) => `${c.name} (${c.type ?? "unknown"})`).join("\n");
    return {
      content: [{ type: "text", text: `[${table.name}]\n${cols}` }],
    };
  }
);

// Tool: run query
server.tool(
  "run_query",
  "SQL을 데이터소스에 직접 실행하고 결과를 반환합니다. SQL 작성 전 list_tables → get_table_columns로 스키마를 먼저 확인하세요.",
  {
    data_source_id: z.number().describe("list_data_sources로 확인한 데이터소스 ID"),
    query: z.string().describe("실행할 SQL 쿼리"),
    max_age: z.number().optional().default(0).describe("캐시 유지 시간(초), 0이면 항상 새로 실행"),
  },
  async ({ data_source_id, query, max_age }) => {
    const res = await redashFetch("/query_results", {
      method: "POST",
      body: JSON.stringify({ data_source_id, query, max_age }),
    });

    let result;
    if (res.job) {
      result = await pollQueryResult(res.job.id);
    } else {
      result = res;
    }

    const qr = result.query_result;
    const rows = qr.data.rows;
    const columns = qr.data.columns.map((c: any) => c.name);

    return {
      content: [
        {
          type: "text",
          text: `총 ${rows.length}행\n컬럼: ${columns.join(", ")}\n\n${JSON.stringify(rows, null, 2)}`,
        },
      ],
    };
  }
);

// Tool: list saved queries
server.tool(
  "list_queries",
  "Redash에 저장된 쿼리 목록을 조회합니다.",
  {
    search: z.string().optional().describe("검색어"),
    page: z.number().optional().default(1),
    page_size: z.number().optional().default(20),
  },
  async ({ search, page, page_size }) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(page_size),
      ...(search ? { q: search } : {}),
    });
    const data = await redashFetch(`/queries?${params}`);
    const queries = data.results.map((q: any) => ({
      id: q.id,
      name: q.name,
      description: q.description,
      data_source_id: q.data_source_id,
      updated_at: q.updated_at,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(queries, null, 2) }],
    };
  }
);

// Tool: get saved query result
server.tool(
  "get_query_result",
  "저장된 Redash 쿼리를 ID로 실행하고 결과를 반환합니다.",
  {
    query_id: z.number().describe("저장된 쿼리 ID (list_queries로 확인)"),
  },
  async ({ query_id }) => {
    const res = await redashFetch(`/queries/${query_id}/results`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    let result;
    if (res.job) {
      result = await pollQueryResult(res.job.id);
    } else {
      result = res;
    }

    const qr = result.query_result;
    const rows = qr.data.rows;
    const columns = qr.data.columns.map((c: any) => c.name);

    return {
      content: [
        {
          type: "text",
          text: `쿼리 ID: ${query_id}\n총 ${rows.length}행\n컬럼: ${columns.join(", ")}\n\n${JSON.stringify(rows, null, 2)}`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
