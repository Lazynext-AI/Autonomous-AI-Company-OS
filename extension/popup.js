const BASE = "https://ai-company.lazynext.com";

async function key() {
  const { lazynext_key } = await chrome.storage.sync.get("lazynext_key");
  return lazynext_key || "";
}

async function api(path, opts = {}) {
  const k = await key();
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "content-type": "application/json", authorization: `Bearer ${k}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function load() {
  try {
    const s = await api("/api/v1/status");
    document.getElementById("stats").innerHTML = Object.entries(s)
      .slice(0, 4)
      .map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`)
      .join("");
    const { tasks } = await api("/api/v1/tasks?limit=4");
    document.getElementById("tasks").innerHTML = (tasks || [])
      .map((t) => `<div class="task">[${t.status}] ${t.description?.slice(0, 50) || ""}</div>`)
      .join("");
  } catch (e) {
    document.getElementById("stats").innerHTML =
      '<div class="stat">Set your <b>lzk_</b> key in Settings</div>';
  }
}

document.getElementById("queue").onclick = async () => {
  const input = document.getElementById("task");
  const text = input.value.trim();
  if (!text) return;
  try {
    await api("/api/v1/tasks", { method: "POST", body: JSON.stringify({ description: text }) });
    document.getElementById("msg").textContent = "Queued ✓";
    input.value = "";
    load();
  } catch {
    document.getElementById("msg").textContent = "Failed — check key";
  }
};

load();
