// Postiz stack worker — a single Cloudflare Container running the fat
// all-in-one image: postgres + redis + temporal + postiz-app, all on
// 127.0.0.1 inside the container. ZERO external services: state lives in
// the container fs (survives sleep) with pg_dumpall snapshots to R2 every
// 15min (survives eviction). The worker's only job: wake + fetch.
import { Container } from "@cloudflare/containers";

interface Env {
  POSTIZ: DurableObjectNamespace<PostizStack>;
  JWT_SECRET?: string;
  POSTGRES_LOCAL_PASSWORD?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ACCESS_KEY?: string;
  CLOUDFLARE_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_BUCKETNAME?: string;
  CLOUDFLARE_BUCKET_URL?: string;
  CLOUDFLARE_REGION?: string;
}

export class PostizStack extends Container {
  defaultPort = 5000; // postiz-app bundled FE+BE port
  sleepAfter = "30m";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Worker secrets reach the container only through envVars — merge them
    // here (static config + whatever the operator set via wrangler secret).
    this.envVars = {
      MAIN_URL: "https://postiz.lazynext.com",
      FRONTEND_URL: "https://postiz.lazynext.com",
      NEXT_PUBLIC_BACKEND_URL: "https://postiz.lazynext.com/api",
      BACKEND_INTERNAL_URL: "http://127.0.0.1:3000",
      IS_GENERAL: "true",
      DISABLE_REGISTRATION: "true", // single-tenant: founder only
      RUN_CRON: "true",
      STORAGE_PROVIDER: "cloudflare",
      TEMPORAL_NAMESPACE: "default",
      R2_BUCKET: env.R2_BUCKET ?? "lazynext-media",
      ...(env.JWT_SECRET ? { JWT_SECRET: env.JWT_SECRET } : {}),
      ...(env.POSTGRES_LOCAL_PASSWORD
        ? { POSTGRES_LOCAL_PASSWORD: env.POSTGRES_LOCAL_PASSWORD }
        : {}),
      ...(env.R2_ACCESS_KEY_ID ? { R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID } : {}),
      ...(env.R2_SECRET_ACCESS_KEY
        ? { R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY }
        : {}),
      ...(env.R2_ACCOUNT_ID ? { R2_ACCOUNT_ID: env.R2_ACCOUNT_ID } : {}),
      // Postiz's own R2 uploader config (same creds, its env names)
      ...(env.CLOUDFLARE_ACCOUNT_ID ? { CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID } : {}),
      ...(env.CLOUDFLARE_ACCESS_KEY ? { CLOUDFLARE_ACCESS_KEY: env.CLOUDFLARE_ACCESS_KEY } : {}),
      ...(env.CLOUDFLARE_SECRET_ACCESS_KEY ? { CLOUDFLARE_SECRET_ACCESS_KEY: env.CLOUDFLARE_SECRET_ACCESS_KEY } : {}),
      ...(env.CLOUDFLARE_BUCKETNAME ? { CLOUDFLARE_BUCKETNAME: env.CLOUDFLARE_BUCKETNAME } : {}),
      ...(env.CLOUDFLARE_BUCKET_URL ? { CLOUDFLARE_BUCKET_URL: env.CLOUDFLARE_BUCKET_URL } : {}),
      ...(env.CLOUDFLARE_REGION ? { CLOUDFLARE_REGION: env.CLOUDFLARE_REGION } : {}),
    };
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // One instance is enough — single-tenant scheduler, not a fleet.
    const id = env.POSTIZ.idFromName("singleton");
    const stub = env.POSTIZ.get(id);
    return stub.fetch(req);
  },
};
