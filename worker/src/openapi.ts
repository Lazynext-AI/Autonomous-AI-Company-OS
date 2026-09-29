/** OpenAPI 3.1 spec for the public Lazynext API + MCP endpoint. */
export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Lazynext API",
    version: "1.0.0",
    description:
      "Public API for Lazynext - The Autonomous AI Company OS. " +
      "Authenticate with an `lzk_` API key: `Authorization: Bearer lzk_...` " +
      "(or `X-API-Key` header). Keys are scoped `read`/`write`/`admin` and rate-limited per minute. " +
      "GET routes need `read`; mutations need `write`; routes that act as the company " +
      "(connector dispatch, scheduled posts, ticket replies) need `admin`. " +
      "Paths marked `x-internal` use the operator bearer token, not `lzk_` keys.",
  },
  servers: [{ url: "https://ai-company.lazynext.com" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "lzk_ API key" },
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      internalAuth: { type: "http", scheme: "bearer", description: "Operator token (env.API_TOKEN) — not an lzk_ key" },
    },
  },
  security: [{ bearerAuth: [] }, { apiKey: [] }],
  paths: {
    "/api/v1/health": {
      get: { summary: "Service health (public)", security: [], responses: { "200": { description: "ok" } } },
    },
    "/api/v1/waitlist": {
      post: {
        summary: "Join the public waitlist (no key) — enrolls as a lead and starts the email sequence",
        security: [],
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } } } },
        responses: { "200": { description: "Joined" }, "400": { description: "Invalid email" }, "429": { description: "Rate limit exceeded (5/day per IP)" } },
      },
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
    "/api/v1/crm/leads": {
      get: { summary: "List CRM leads", responses: { "200": { description: "Leads" } } },
      post: {
        summary: "Create a CRM lead (write scope)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, email: { type: "string", format: "email" }, company: { type: "string" }, status: { type: "string" }, source: { type: "string" }, notes: { type: "string" }, value_cents: { type: "integer" } } } } } },
        responses: { "201": { description: "Created" }, "400": { description: "name required" } },
      },
    },
    "/api/v1/crm/leads/{id}": {
      patch: {
        summary: "Update a CRM lead (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, notes: { type: "string" }, value_cents: { type: "integer" } } } } } },
        responses: { "200": { description: "Updated" } },
      },
      put: {
        summary: "Update a CRM lead (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, notes: { type: "string" }, value_cents: { type: "integer" } } } } } },
        responses: { "200": { description: "Updated" } },
      },
    },
    "/api/v1/support/tickets": {
      get: { summary: "List support tickets", responses: { "200": { description: "Tickets" } } },
      post: {
        summary: "Open a support ticket (write scope)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["subject"], properties: { subject: { type: "string" }, email: { type: "string", format: "email" }, body: { type: "string" }, status: { type: "string" }, priority: { type: "string" } } } } } },
        responses: { "201": { description: "Opened" }, "400": { description: "subject required" } },
      },
    },
    "/api/v1/support/tickets/{id}": {
      patch: {
        summary: "Update ticket status (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", enum: ["open", "pending", "resolved", "closed"] } } } } } },
        responses: { "200": { description: "Updated" } },
      },
      put: {
        summary: "Update ticket status (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", enum: ["open", "pending", "resolved", "closed"] } } } } } },
        responses: { "200": { description: "Updated" } },
      },
    },
    "/api/v1/support/tickets/{id}/reply": {
      post: {
        summary: "Reply to a ticket — emails the requester as the company (admin scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["body"], properties: { body: { type: "string" } } } } } },
        responses: { "200": { description: "Reply sent" }, "403": { description: "scope 'admin' required" } },
      },
    },
    "/api/v1/booking": {
      get: { summary: "List bookings", responses: { "200": { description: "Bookings" } } },
      post: {
        summary: "Create a booking (write scope)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["title", "starts_at", "ends_at"], properties: { title: { type: "string" }, guest_name: { type: "string" }, guest_email: { type: "string", format: "email" }, starts_at: { type: "string", format: "date-time" }, ends_at: { type: "string", format: "date-time" }, notes: { type: "string" } } } } } },
        responses: { "201": { description: "Booked" }, "400": { description: "title + starts_at + ends_at required" } },
      },
    },
    "/api/v1/booking/{id}": {
      patch: {
        summary: "Cancel a booking (write scope) — sets status=cancelled",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Cancelled" } },
      },
      delete: {
        summary: "Cancel a booking (write scope) — sets status=cancelled",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Cancelled" } },
      },
    },
    "/api/v1/store/products": {
      get: { summary: "List store products", responses: { "200": { description: "Products" } } },
      post: {
        summary: "Create a store product (write scope)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" }, price_cents: { type: "integer" }, currency: { type: "string" }, dodo_product_id: { type: "string" } } } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/store/orders": {
      get: { summary: "List store orders", responses: { "200": { description: "Orders" } } },
      post: {
        summary: "Create a store order (write scope)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["product_id"], properties: { product_id: { type: "integer" }, customer_email: { type: "string" }, amount_cents: { type: "integer" }, currency: { type: "string" }, dodo_session_id: { type: "string" } } } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/marketing/contacts": {
      get: { summary: "List marketing contacts (Brevo-backed)", responses: { "200": { description: "Contacts" } } },
      post: {
        summary: "Add a marketing contact (write scope) — unsubscribed addresses are not re-added",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" }, name: { type: "string" }, subscribed: { type: "boolean" }, source: { type: "string" } } } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/marketing/contacts/{id}": {
      patch: {
        summary: "Update a marketing contact (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Updated" } },
      },
      put: {
        summary: "Update a marketing contact (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Updated" } },
      },
    },
    "/api/v1/marketing/campaigns": {
      get: { summary: "List email campaigns", responses: { "200": { description: "Campaigns" } } },
      post: {
        summary: "Create an email campaign (write scope)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["name", "subject", "html"], properties: { name: { type: "string" }, subject: { type: "string" }, html: { type: "string" }, segment: { type: "string" } } } } } },
        responses: { "201": { description: "Created" }, "400": { description: "name + subject + html required" } },
      },
    },
    "/api/v1/marketing/campaigns/{id}/send": {
      post: {
        summary: "Send a campaign — suppression-checked, List-Unsubscribe headers attached (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Sent" } },
      },
    },
    "/api/v1/marketing/stats": {
      get: { summary: "Marketing funnel counters + email events", responses: { "200": { description: "Stats" } } },
    },
    "/api/v1/connectors": {
      get: {
        summary: "List connector ids with configured-credential status",
        description: "Returns every supported connector id and whether a credential exists (conn:{id} in KV). Dispatch via POST /api/v1/connectors/{id}.",
        responses: { "200": { description: "Connector status map" } },
      },
    },
    "/api/v1/connectors/{id}": {
      post: {
        summary: "Dispatch through a connector — acts as the company (admin scope)",
        description: "Body is the connector's own payload: socials take {text} (devto/hashnode/medium/wordpress also {title,draft,tags}), messaging {to,text}, brevo {to,subject,html}.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", description: "connector id from GET /api/v1/connectors" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" }, to: { type: "string" }, subject: { type: "string" }, html: { type: "string" }, title: { type: "string" } } } } } },
        responses: { "200": { description: "Dispatched" }, "403": { description: "scope 'admin' required" }, "404": { description: "unknown connector" }, "503": { description: "connector not connected" } },
      },
    },
    "/api/v1/social/posts": {
      get: { summary: "List scheduled/published posts (D1 social_posts queue)", responses: { "200": { description: "Posts" } } },
      post: {
        summary: "Schedule a post — cron-dispatched at run_at through the connector (admin scope)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["connector"], properties: { connector: { type: "string" }, text: { type: "string" }, at: { type: "string", format: "date-time", description: "ISO-8601; omit = publish now" }, image_url: { type: "string" }, to: { type: "string" }, subject: { type: "string" } } } } } },
        responses: { "201": { description: "Queued" }, "403": { description: "scope 'admin' required" } },
      },
    },
    "/api/v1/social/posts/{id}": {
      delete: {
        summary: "Cancel a queued post (admin scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Cancelled" }, "403": { description: "scope 'admin' required" } },
      },
    },
    "/api/v1/media": {
      get: { summary: "List media library items", responses: { "200": { description: "Items (id, url, meta)" } } },
      post: {
        summary: "Upload media — base64 body stored in KV, public URL minted (write scope, 5MB cap)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["type", "data_b64"], properties: { name: { type: "string" }, type: { type: "string", enum: ["png", "jpeg", "webp", "gif", "avif"] }, data_b64: { type: "string", description: "base64 payload" } } } } } },
        responses: { "201": { description: "{id, url: /media/{uuid}}" }, "400": { description: "invalid payload" }, "413": { description: "file too large (5MB max)" } },
      },
    },
    "/api/v1/media/{id}": {
      delete: {
        summary: "Delete a media item (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Deleted" } },
      },
    },
    "/media/{id}": {
      get: {
        summary: "Public media serve — social platforms fetch these URLs server-side (no key)",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Media bytes with stored content-type" }, "404": { description: "Not found" } },
      },
    },
    "/api/v1/signwell/documents": {
      get: { summary: "List SignWell documents (proxied)", responses: { "200": { description: "SignWell documents" } } },
    },
    "/api/v1/signwell/send": {
      post: {
        summary: "Send a document for signature via SignWell (write scope)",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["name", "recipients"], properties: { name: { type: "string" }, file_url: { type: "string" }, recipients: { type: "array", items: { type: "object" } } } } } } },
        responses: { "200": { description: "SignWell response" }, "503": { description: "conn:signwell credential missing" } },
      },
    },
    "/api/v1/signwell/events": {
      get: { summary: "Recent SignWell webhook events (audit trail)", responses: { "200": { description: "Events" } } },
    },
    "/api/v1/signwell/webhook/{secret}": {
      post: {
        summary: "SignWell webhook ingress — URL path IS the shared secret (public)",
        security: [],
        parameters: [{ name: "secret", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Recorded" }, "403": { description: "bad secret" } },
      },
    },
    "/api/v1/sign/requests": {
      get: { summary: "List native e-sign requests", responses: { "200": { description: "Requests" } } },
      post: {
        summary: "Create a native e-sign request (write scope) — doc snapshotted into KV at creation, signer emailed a token link",
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["title", "signer_email"], properties: { title: { type: "string" }, signer_email: { type: "string", format: "email" }, signer_name: { type: "string" }, doc_html: { type: "string" }, doc_text: { type: "string" }, doc_url: { type: "string", description: "fetched at creation; must serve text/html or text/plain" } } } } } },
        responses: { "201": { description: "{public_id, sign_url}" }, "400": { description: "title/signer_email/doc_* required" } },
      },
    },
    "/api/v1/sign/requests/{id}": {
      get: {
        summary: "Sign request detail + audit trail",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Request" }, "404": { description: "Not found" } },
      },
      delete: {
        summary: "Void a pending request (write scope) — a completed signature cannot be voided",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Voided" }, "400": { description: "signed request stands" } },
      },
    },
    "/api/v1/sign/requests/{id}/remind": {
      post: {
        summary: "Resend the signature email (write scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Reminder sent" } },
      },
    },
    "/sign/{id}": {
      get: {
        summary: "Token-gated signing page (public; ?t=token from the signer's email)",
        security: [],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "t", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "HTML signing page" }, "403": { description: "Invalid link" } },
      },
      post: {
        summary: "Submit a signature or decline (public; token in body)",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["t"], properties: { t: { type: "string" }, name: { type: "string" }, consent: { type: "boolean" }, decline: { type: "boolean" }, reason: { type: "string" } } } } } },
        responses: { "200": { description: "Signed/declined" } },
      },
    },
    "/sign/{id}/certificate": {
      get: {
        summary: "Completion certificate — exists only after signing (public, token-gated)",
        security: [],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "t", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "HTML certificate" }, "404": { description: "Not signed yet" } },
      },
    },
    "/api/v1/connect/{id}/start": {
      get: {
        summary: "Begin OAuth connect for a connector — 302 to provider authorize URL (admin scope)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "302": { description: "Redirect to provider" }, "403": { description: "scope 'admin' required" } },
      },
    },
    "/api/v1/connect/{id}/callback": {
      get: {
        summary: "OAuth callback — exchanges code, stores credential as conn:{id} (public, state-verified)",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Connected" }, "400": { description: "bad state/code" } },
      },
    },
    "/api/v1/brevo/events/{secret}": {
      post: {
        summary: "Brevo event webhook — bounces/spam suppress the address like an unsubscribe (public, path secret)",
        security: [],
        parameters: [{ name: "secret", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Processed" }, "403": { description: "bad secret" } },
      },
    },
    "/api/v1/brevo/inbound/{secret}": {
      post: {
        summary: "Brevo inbound-parse webhook — replies thread onto support tickets (public, path secret)",
        security: [],
        parameters: [{ name: "secret", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Processed" }, "403": { description: "bad secret" } },
      },
    },
    "/api/v1/billing/webhook": {
      post: {
        summary: "Dodo Payments event ingress — Standard Webhooks HMAC (public)",
        security: [],
        description: "Signs `${webhook-id}.${webhook-timestamp}.${body}`; accepts the KV-registered secret or env.DODO_WEBHOOK_SECRET. Activates licenses/subscriptions on payment.succeeded.",
        responses: { "200": { description: "Processed" }, "401": { description: "bad signature" } },
      },
    },
    "/api/v1/billing/checkout": {
      post: {
        summary: "Create a Dodo checkout session",
        "x-internal": true,
        security: [{ internalAuth: [] }],
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["product_id"], properties: { product_id: { type: "string" }, plan: { type: "string" }, trial_days: { type: "integer" } } } } } },
        responses: { "200": { description: "{checkout_url, session_id}" }, "401": { description: "unauthorized" } },
      },
    },
    "/api/v1/billing/products": {
      post: {
        summary: "Create a Dodo product",
        "x-internal": true,
        security: [{ internalAuth: [] }],
        responses: { "200": { description: "{product_id}" }, "401": { description: "unauthorized" } },
      },
    },
    "/api/v1/billing/cancel": {
      post: {
        summary: "Cancel a subscription",
        "x-internal": true,
        security: [{ internalAuth: [] }],
        responses: { "200": { description: "Cancelled" }, "401": { description: "unauthorized" } },
      },
    },
    "/api/v1/billing/subscriptions": {
      get: { summary: "List subscriptions", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Subscriptions" } } },
    },
    "/api/v1/billing/plan": {
      get: { summary: "Current plan + entitlement state", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Plan" } } },
    },
    "/api/v1/billing/funnel": {
      get: { summary: "Billing funnel counters", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Funnel" } } },
    },
    "/api/v1/billing/discounts": {
      get: { summary: "List Dodo discounts", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Discounts" } } },
      post: { summary: "Create a Dodo discount", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Created" } } },
      patch: { summary: "Update a Dodo discount", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Updated" } } },
    },
    "/api/v1/billing/webhooks": {
      get: { summary: "List registered Dodo webhooks", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Webhooks" } } },
      post: {
        summary: "Register the Dodo webhook endpoint — stores signing secret in KV",
        "x-internal": true,
        security: [{ internalAuth: [] }],
        responses: { "201": { description: "Registered" } },
      },
    },
    "/api/v1/billing/webhooks/{id}": {
      delete: {
        summary: "Delete a Dodo webhook",
        "x-internal": true,
        security: [{ internalAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deleted" } },
      },
    },
    "/api/v1/keys": {
      get: { summary: "List API keys (prefix, scopes, usage)", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Keys" } } },
      post: {
        summary: "Mint an lzk_ API key — shown once",
        "x-internal": true,
        security: [{ internalAuth: [] }],
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, scopes: { type: "string", description: "csv: read,write,admin" }, rate_limit_rpm: { type: "integer" } } } } } },
        responses: { "201": { description: "{api_key}" } },
      },
    },
    "/api/v1/keys/{id}": {
      delete: {
        summary: "Revoke an API key",
        "x-internal": true,
        security: [{ internalAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Revoked" } },
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
    "/a2a": {
      post: {
        summary: "A2A endpoint — delegate a task to the company",
        description:
          "JSON-RPC 2.0 agent-to-agent protocol. tasks/send requires an " +
          "lzk_ key with write scope (params.message.parts[0].text → queues " +
          "the task and returns {id, status.state}); tasks/get requires read " +
          "scope (params.id → real task state + result artifact).",
        responses: {
          "200": { description: "JSON-RPC response" },
          "401": { description: "missing/invalid API key" },
          "403": { description: "insufficient scope" },
        },
      },
    },
    "/.well-known/agent.json": {
      get: {
        summary: "A2A agent card (public)",
        security: [],
        responses: { "200": { description: "Agent card (name, skills, endpoints)" } },
      },
    },
    "/api/v1/widget/chat": {
      post: {
        summary: "Widget chat — ask the company a question (public)",
        security: [],
        description: "Used by /widget.js embeds. Replies synchronously via Workers AI, grounded in the product/company profile. Rate-limited per IP.",
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 500 } } },
            },
          },
        },
        responses: { "200": { description: "Reply" }, "400": { description: "text required" }, "429": { description: "rate limit exceeded" } },
      },
    },
    "/api/v1/openapi.json": {
      get: { summary: "This OpenAPI document (public)", security: [], responses: { "200": { description: "OpenAPI 3.1 JSON" } } },
    },
    "/api/v1/docs": {
      get: { summary: "Swagger UI for this API (public)", security: [], responses: { "200": { description: "HTML docs page" } } },
    },
    "/oauth/authorize": {
      get: {
        summary: "OAuth authorization endpoint (public)",
        security: [],
        responses: { "200": { description: "Authorization page / redirect" } },
      },
    },
    "/oauth/token": {
      post: {
        summary: "OAuth token endpoint (public)",
        security: [],
        responses: { "200": { description: "Token response" }, "400": { description: "Invalid grant" } },
      },
    },
    "/widget.js": {
      get: { summary: "Embeddable chat widget script (public)", security: [], responses: { "200": { description: "JavaScript bundle" } } },
    },
    "/query": {
      post: { summary: "Run a read/write SQL statement against D1", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Rows" } } },
    },
    "/batch": {
      post: { summary: "Run multiple D1 statements in one batch", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Batch results" } } },
    },
    "/bus/publish": {
      post: { summary: "Publish a message to the agent bus", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "{id}" } } },
    },
    "/bus/poll": {
      post: { summary: "Poll the agent bus for undelivered messages", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Messages" } } },
    },
    "/bus/ack": {
      post: { summary: "Acknowledge bus message ids", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "ok" } } },
    },
    "/bus/pending": {
      post: { summary: "List pending bus deliveries for a consumer", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Pending" } } },
    },
    "/bus/ensure": {
      post: { summary: "Ensure a bus consumer/subscription exists", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "ok" } } },
    },
    "/agent/tick": {
      post: { summary: "Manually run one agent-loop tick", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Tick result" } } },
    },
    "/agent/generate": {
      post: { summary: "Workers AI text generation pass-through", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "{text}" }, "503": { description: "AI binding not configured" } } },
    },
    "/email/send": {
      post: { summary: "Transactional email via Brevo (verify/reset/alerts)", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "{id}" } } },
    },
    "/leads": {
      post: { summary: "Lead intake — product workers relay signups; enrolls + starts email sequence", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Enrolled" } } },
    },
    "/unsubscribe": {
      post: { summary: "Unsubscribe mutation — KV flag + D1 opt-out + Brevo blacklist (called by product worker after signed-link verify)", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "ok" } } },
    },
    "/social/schedule": {
      post: { summary: "Fleet-facing social enqueue — same D1 queue as /api/v1/social/posts for internal-bearer callers", "x-internal": true, security: [{ internalAuth: [] }], responses: { "201": { description: "Queued" } } },
    },
    "/sign/request": {
      post: { summary: "Fleet-facing e-sign door — same request path as /api/v1/sign/requests for internal-bearer callers", "x-internal": true, security: [{ internalAuth: [] }], responses: { "201": { description: "Request created" } } },
    },
    "/kv/get": {
      post: { summary: "KV read", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "{value}" } } },
    },
    "/kv/list": {
      post: { summary: "KV key list by prefix", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "{keys}" } } },
    },
    "/kv/put": {
      post: { summary: "KV write — ttl:0 = durable; omitted gets a >=60s floor", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "ok" } } },
    },
    "/kv/delete": {
      post: { summary: "KV delete", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "ok" } } },
    },
    "/vectorize/upsert": {
      post: { summary: "Upsert vectors into the company-knowledge index", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "{count}" } } },
    },
    "/vectorize/query": {
      post: { summary: "Query the company-knowledge vector index", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Matches" } } },
    },
    "/vectorize/delete": {
      post: { summary: "Delete vectors from the index", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Result" } } },
    },
    "/websearch": {
      post: { summary: "Web search — Serper key in KV, DuckDuckGo fallback", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Results" } } },
    },
    "/scrape": {
      post: { summary: "Fetch + extract readable page content", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Content" } } },
    },
    "/render": {
      post: { summary: "Headless-browser render via Browser Rendering — full DOM, shadow roots, focus census", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Rendered page" } } },
    },
    "/pdf": {
      post: { summary: "Render a URL to PDF via Browser Rendering", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "application/pdf" } } },
    },
    "/exec": {
      post: { summary: "Run code in the exec container (CODE_EXEC binding)", "x-internal": true, security: [{ internalAuth: [] }], responses: { "200": { description: "Execution result" }, "503": { description: "container not configured" } } },
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
