"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const STEPS = [
  { label: "Fund Atlas Cloud", detail: "Add credits — the brain needs a working LLM", done: false },
  { label: "Run make dev", detail: "Boot the local agent runtime", done: false },
  { label: "Agents register", detail: "Crew shows up in Agents + starts working", done: false },
  { label: "First briefing", detail: "Weekly founder report lands in email + here", done: false },
];

export default function SetupChecklist({ agentsActive }: { agentsActive: number }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem("lz_setup_dismissed") === "1");
  }, []);

  if (dismissed || agentsActive > 0) return null;

  return (
    <div className="bg-accentBg border border-accent/30 rounded-[14px] p-5 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-zinc-50">Set up your company</h2>
          <p className="text-xs text-muted mt-0.5">4 steps to a running company</p>
        </div>
        <button
          onClick={() => {
            localStorage.setItem("lz_setup_dismissed", "1");
            setDismissed(true);
          }}
          className="text-muted hover:text-zinc-50"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-2.5">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-accent/40 flex items-center justify-center text-[10px] font-bold text-accentSoft shrink-0 mt-0.5">
              {i + 1}
            </div>
            <div>
              <div className="text-sm font-medium text-zinc-50">{s.label}</div>
              <div className="text-xs text-muted">{s.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
