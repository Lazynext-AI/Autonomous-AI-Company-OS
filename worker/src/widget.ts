// Embeddable widget — any website can <script> this in and get a live
// Lazynext status card or a chat widget that posts to the company bus.
import { Env, json } from "./gateway";

const WIDGET_JS = `(function(){
  var API = "https://ai-company.lazynext.com/api/v1";
  document.querySelectorAll("[data-lazynext]").forEach(function(el){
    var type = el.getAttribute("data-lazynext") || "status";
    var card = document.createElement("div");
    card.style.cssText = "font-family:system-ui;background:#141419;border:1px solid #26262E;border-radius:14px;padding:16px;color:#FAFAFA;max-width:340px;font-size:13px";

    if (type === "status") {
      card.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-weight:700"><span style="color:#A78BFA">◆</span> Lazynext</div><div id="lz-w-status" style="color:#9C9CAA;font-size:12px;margin-top:8px">Checking…</div>';
      el.appendChild(card);
      fetch(API + "/health").then(function(r){return r.json()}).then(function(d){
        var dot = d.ok ? "#22C55E" : "#EF4444";
        var txt = d.ok ? "All systems operational" : "Degraded";
        card.querySelector("#lz-w-status").innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+dot+';margin-right:6px"></span>' + txt;
      }).catch(function(){ card.querySelector("#lz-w-status").textContent = "Unreachable"; });
    }

    if (type === "chat") {
      card.innerHTML = '<div style="font-weight:700;margin-bottom:8px"><span style="color:#A78BFA">◆</span> Talk to the company</div>' +
        '<div id="lz-w-log" style="max-height:160px;overflow:auto;font-size:12px;color:#9C9CAA;margin-bottom:8px"></div>' +
        '<input id="lz-w-in" placeholder="Ask the agents…" style="width:100%;background:#0E0E13;border:1px solid #26262E;border-radius:8px;padding:8px 10px;color:#FAFAFA;font-size:12px;outline:none"/>';
      el.appendChild(card);
      var input = card.querySelector("#lz-w-in");
      var log = card.querySelector("#lz-w-log");
      input.addEventListener("keydown", function(e){
        if (e.key === "Enter" && input.value.trim()) {
          var msg = input.value.trim(); input.value = "";
          log.innerHTML += '<div style="margin-bottom:4px"><b style="color:#A78BFA">You:</b> ' + msg + "</div>";
          log.scrollTop = log.scrollHeight;
          fetch(API + "/widget/chat", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ text: msg }) })
            .then(function(r){return r.json()}).then(function(d){
              log.innerHTML += '<div style="margin-bottom:4px"><b style="color:#22C55E">Lazynext:</b> ' + (d.reply || "received") + "</div>";
              log.scrollTop = log.scrollHeight;
            }).catch(function(){ log.innerHTML += '<div style="color:#EF4444">offline</div>'; });
        }
      });
    }
  });
})();`;

export async function handleWidget(
  req: Request,
  env: Env,
  path: string,
): Promise<Response> {
  // Serve the embed script — public, CORS-open.
  if (path === "/widget.js") {
    return new Response(WIDGET_JS, {
      headers: {
        "content-type": "application/javascript",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300",
      },
    });
  }

  // Widget chat → a lightweight reply + posts to the bus so agents see it.
  if (req.method === "POST" && path === "/api/v1/widget/chat") {
    const b = (await req.json()) as { text?: string };
    const text = (b.text ?? "").slice(0, 500);
    if (!text) return json({ error: "text required" }, 400);
    await env.DB.prepare(
      "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('widget.chat', ?, datetime('now'))",
    ).bind(JSON.stringify({ text, source: "widget" })).run();
    return json({ reply: "The company received your message — an agent will pick it up." });
  }

  return json({ error: "not found" }, 404);
}
