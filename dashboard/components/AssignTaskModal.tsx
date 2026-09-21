"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { toast } from "@/components/Toast";

const ROLES = [
  "ceo_agent", "product_manager_agent", "market_researcher_agent",
  "builder_agent", "code_review_agent", "devops_agent",
  "knowledge_agent", "marketing_agent", "finance_agent",
];

export default function AssignTaskModal({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "tasks",
        payload: {
          type: "assign_task",
          agent_id: role,
          description: desc,
          from: "dashboard",
        },
      }),
    });
    setBusy(false);
    if (r.ok) {
      toast("Task assigned");
      setOpen(false);
      setDesc("");
      onDone();
    } else {
      toast("Failed to assign");
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
      >
        <Plus className="w-4 h-4" /> Assign task
      </button>

      {open && (
        <div className="fixed inset-0 z-[150] bg-bg/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setOpen(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="w-full max-w-md bg-card border border-border rounded-[14px] p-6 relative"
          >
            <button type="button" onClick={() => setOpen(false)} className="absolute top-4 right-4 text-muted hover:text-fg" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
            <h2 className="text-lg font-bold text-fg mb-1">Assign task</h2>
            <p className="text-xs text-muted mb-5">Publishes to the bus — an agent picks it up on next tick.</p>

            <label className="text-xs text-muted">Agent</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1.5 mb-4 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
              ))}
            </select>

            <label className="text-xs text-muted">Task</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              required
              placeholder="e.g. Research the top 5 competitors in devtools"
              className="mt-1.5 mb-5 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent resize-none"
            />

            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-fg px-4 py-2.5">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !desc.trim()}
                className="bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
              >
                {busy ? "Assigning…" : "Assign"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
