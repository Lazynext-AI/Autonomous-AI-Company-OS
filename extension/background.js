// Lazynext extension service worker — polls the API and shows a
// badge with the number of open tasks.
const BASE = "https://ai-company.lazynext.com";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("poll", { periodInMinutes: 5 });
});
chrome.runtime.onStartup.addListener(poll);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "poll") poll();
});

async function poll() {
  const { lazynext_key } = await chrome.storage.sync.get("lazynext_key");
  if (!lazynext_key) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  try {
    const r = await fetch(`${BASE}/api/v1/tasks?limit=50`, {
      headers: { authorization: `Bearer ${lazynext_key}` },
    });
    if (!r.ok) throw new Error(String(r.status));
    const { tasks } = await r.json();
    const open = (tasks || []).filter((t) => t.status === "queued" || t.status === "running").length;
    chrome.action.setBadgeText({ text: open ? String(open) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#8B5CF6" });
  } catch {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
  }
}
