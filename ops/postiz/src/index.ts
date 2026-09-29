// Postiz stack worker — a single Cloudflare Container class that runs the
// fat all-in-one image (postiz-app + redis + temporal on localhost). The
// worker's only job: wake the container and fetch it. All Postiz config
// arrives via container envVars/secrets; Postgres is external (Neon etc.)
// and media lands in R2 via Postiz's built-in STORAGE_PROVIDER=cloudflare.
import { Container } from "@cloudflare/containers";

export class PostizStack extends Container {
  defaultPort = 5000; // postiz-app bundled FE+BE port
  sleepAfter = "30m";
  envVars = {
    MAIN_URL: "https://postiz.lazynext.com",
    FRONTEND_URL: "https://postiz.lazynext.com",
    NEXT_PUBLIC_BACKEND_URL: "https://postiz.lazynext.com/api",
    BACKEND_INTERNAL_URL: "http://127.0.0.1:3000",
    REDIS_URL: "redis://127.0.0.1:6379",
    TEMPORAL_ADDRESS: "127.0.0.1:7233",
    TEMPORAL_NAMESPACE: "default",
    IS_GENERAL: "true",
    DISABLE_REGISTRATION: "true", // single-tenant: founder only
    RUN_CRON: "true",
    STORAGE_PROVIDER: "cloudflare",
    // DATABASE_URL, JWT_SECRET, CLOUDFLARE_* R2 keys → wrangler secrets
  };
}

export default {
  async fetch(req: Request, env: { POSTIZ: DurableObjectNamespace<PostizStack> }): Promise<Response> {
    // One instance is enough — single-tenant scheduler, not a fleet.
    const id = env.POSTIZ.idFromName("singleton");
    const stub = env.POSTIZ.get(id);
    return stub.fetch(req);
  },
};
