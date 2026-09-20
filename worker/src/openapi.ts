/** OpenAPI 3.1 spec for the public Lazynext API + MCP endpoint. */
export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Lazynext API",
    version: "1.0.0",
    description:
      "Public API for Lazynext - The Autonomous AI Company OS. " +
      "Authenticate with an `lzk_` API key: `Authorization: Bearer lzk_...` " +
      "(or `X-API-Key` header). Keys are scoped `read`/`write` and rate-limited per minute.",
  },
  servers: [{ url: "https://ai-company.lazynext.com" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
  },
  security: [{ bearerAuth: [] }, { apiKey: [] }],
  paths: {
    "/api/v1/health": {
      get: { summary: "Service health (public)", security: [], responses: { "200": { description: "ok" } } },
    },
    "/api/v1/status": {
      get: { summary: "Company snapshot counters", responses: { "200": { description: "Counts" } } },
    },
    "/api/v1/briefings": {
      get: {
        summary: "List briefings",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 20 } }],
        responses: { "200": { description: "Briefing list" } },
      },
    },
    "/api/v1/briefings/{id}": {
      get: {
        summary: "Get a full briefing",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Briefing" }, "404": { description: "Not found" } },
      },
    },
    "/api/v1/tasks": {
      get: {
        summary: "List task log entries",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 50 } }],
        responses: { "200": { description: "Task list" } },
      },
      post: {
        summary: "Queue a task for agents (write scope)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["description"],
                properties: {
                  description: { type: "string" },
                  channel: { type: "string", default: "cto.tasks" },
                  priority: { type: "integer" },
                  acceptance_criteria: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Task queued" } },
      },
    },
    "/api/v1/agents": {
      get: { summary: "Agent activity summary", responses: { "200": { description: "Agents" } } },
    },
    "/api/v1/knowledge/search": {
      post: {
        summary: "Search the knowledge base (text or vector)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  vector: { type: "array", items: { type: "number" } },
                  topK: { type: "integer" },
                  category: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Matching chunks" } },
      },
    },
    "/api/v1/webhooks": {
      post: {
        summary: "Register an outbound webhook (write scope)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", description: "https URL" },
                  channels: { type: "string", default: "*", description: "csv channels or *" },
                  secret: { type: "string", description: "HMAC-SHA256 signing secret" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Registered" } },
      },
      get: { summary: "List webhooks", responses: { "200": { description: "Webhooks" } } },
    },
    "/api/v1/webhooks/deliveries": {
      get: { summary: "Recent webhook deliveries", responses: { "200": { description: "Deliveries" } } },
    },
    "/api/v1/webhooks/{id}": {
      delete: {
        summary: "Deactivate a webhook",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Deactivated" } },
      },
    },
    "/mcp": {
      post: {
        summary: "MCP server endpoint (spec 2026-07-28, streamable HTTP)",
        description:
          "JSON-RPC 2.0. Methods: initialize, ping, tools/list, tools/call, " +
          "resources/list, resources/read, notifications/*. Tools: company_status, " +
          "list_briefings, get_briefing, list_tasks, list_agents, search_knowledge, " +
          "create_task (write), publish_message (write).",
        responses: { "200": { description: "JSON-RPC response" }, "202": { description: "Notification accepted" } },
      },
    },
  },
};

export const DOCS_HTML = `<!doctype html>
<html><head>
  <title>Lazynext API Docs</title>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>body{background:#0a0a0b}</style>
</head><body>
  <div id="ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: "#ui",
      theme: "dark",
      presets: [SwaggerUIBundle.presets.apis],
    });
  </script>
</body></html>`;
