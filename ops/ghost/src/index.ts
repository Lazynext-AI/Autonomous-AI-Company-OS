// Ghost blog worker — one Cloudflare Container running the official
// ghost image with embedded sqlite. Zero external services; content lives
// on the container fs under /var/lib/ghost/content (persists while the
// instance sleeps; first boot seeds it). The worker just wakes + fetches.
import { Container } from "@cloudflare/containers";

interface Env {
  GHOST: DurableObjectNamespace<GhostBlog>;
}

export class GhostBlog extends Container {
  defaultPort = 2368; // ghost's own listen port
  sleepAfter = "30m";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      url: "https://ghost.lazynext.com",
      NODE_ENV: "production",
      server__host: "0.0.0.0",
      server__port: "2368",
      database__client: "sqlite3",
      database__connection__filename:
        "/var/lib/ghost/content/data/ghost.db",
      mail__transport: "Direct",
    };
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const id = env.GHOST.idFromName("singleton");
    const stub = env.GHOST.get(id);
    return stub.fetch(req);
  },
};
