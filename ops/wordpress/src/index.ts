// WordPress blog worker — one Cloudflare Container running the patched
// wordpress:apache image (sqlite dropin baked into wp-config — no MySQL).
// WP lives on the container fs; first boot seeds /var/www/html.
import { Container } from "@cloudflare/containers";

interface Env {
  WP: DurableObjectNamespace<WordpressBlog>;
  EPHEMERAL: KVNamespace;
}

export class WordpressBlog extends Container {
  defaultPort = 3000; // apache
  sleepAfter = "30m";

  override async fetch(request: Request): Promise<Response> {
    // Debug: report the URL the DO receives across the stub boundary.
    const u = new URL(request.url);
    if (u.searchParams.get("__echo") === "1") {
      return new Response(`DO sees: ${request.url}\n`);
    }
    // Bypass Container.containerFetch: the runtime's health-check follows
    // redirects and newer hosts reject the https Request carried as fetch
    // init. Start the container ourselves, poll the port with a plain
    // RequestInit (no Request object), never follow upstream redirects.
    if (!this.container.running) {
      await this.container.start();
      const p = this.container.getTcpPort(this.defaultPort);
      let up = false;
      for (let i = 0; i < 90; i++) {
        try {
          await p.fetch("http://containerstarthealthcheck/", { redirect: "manual" });
          up = true;
          break;
        } catch {
          if (this.container.running) { await new Promise(r => setTimeout(r, 1000)); continue; }
          break;
        }
      }
      if (!up) return new Response("container port never listened", { status: 503 });
    }
    const httpUrl = request.url.replace(/^https:/, "http:");
    if (u.searchParams.get("__auth") !== null) {
      return new Response(`auth-in-DO: ${request.headers.get("authorization") ?? "absent"}\n`);
    }
    const fwd = new Headers(request.headers);
    fwd.set("X-Forwarded-Proto", "https");
    const port = this.container.getTcpPort(this.defaultPort);
    const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
    return port.fetch(httpUrl, {
      method: request.method,
      headers: fwd,
      body,
      redirect: "manual",
    });
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {};
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/__beacon") {
      // boot-stage telemetry from inside the container — start.sh PUTs its
      // stage here so we can see where boot dies on cold start.
      const s = url.searchParams.get("s") || "?";
      await env.EPHEMERAL.put("wpboot:last", s, { expirationTtl: 3600 });
      await env.EPHEMERAL.put(`wpboot:${s}`, new Date().toISOString(), { expirationTtl: 3600 });
      return new Response("ok");
    }
    // Diagnostics: rewrite to http before the DO — the container tunnel
    // speaks plain HTTP and newer runtimes reject https in the fetch init.
    if (url.searchParams.get("__echo") === "1") {
      url.protocol = "http:";
      req = new Request(url.toString(), req);
    }
    const id = env.WP.idFromName("singleton");
    const stub = env.WP.get(id);
    return stub.fetch(req);
  },
};
