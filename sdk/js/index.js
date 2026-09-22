// Lazynext API client — mirrors the Python SDK surface.
// Works in Node 18+ and browsers (global fetch).

const DEFAULT_BASE = "https://ai-company.lazynext.com";

export class Lazynext {
  constructor({ apiKey = "", baseUrl = DEFAULT_BASE } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async _get(path, params = {}) {
    const url = new URL(this.baseUrl + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await fetch(url, { headers: this._headers() });
    if (!r.ok) throw new Error(`lazynext ${r.status}: ${await r.text()}`);
    return r.json();
  }

  async _post(path, body) {
    const r = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...this._headers() },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`lazynext ${r.status}: ${await r.text()}`);
    return r.json();
  }

  _headers() {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  status() { return this._get("/api/v1/status"); }
  health() { return this._get("/api/v1/health"); }
  joinWaitlist(email) { return this._post("/api/v1/waitlist", { email }); }
  listBriefings(limit = 20) { return this._get("/api/v1/briefings", { limit }).then((d) => d.briefings); }
  getBriefing(id) { return this._get(`/api/v1/briefings/${id}`).then((d) => d.briefing); }
  listTasks(limit = 50) { return this._get("/api/v1/tasks", { limit }).then((d) => d.tasks); }
  createTask(description, { channel = "cto.tasks", priority = 0 } = {}) {
    return this._post("/api/v1/tasks", { description, channel, priority });
  }
  searchKnowledge(query, topK = 5) { return this._post("/api/v1/knowledge/search", { query, topK }); }
  listAgents() { return this._get("/api/v1/agents").then((d) => d.agents); }
  mcpTools() { return this._post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }).then((d) => d.result?.tools); }
  mcpCall(name, args = {}) {
    return this._post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  }
}

export default Lazynext;
