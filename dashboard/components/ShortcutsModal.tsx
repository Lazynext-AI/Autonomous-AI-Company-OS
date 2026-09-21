"use client";

import { useEffect, useState } from "react";
import { X, Keyboard } from "lucide-react";

const SHORTCUTS = [
  { keys: ["⌘", "K"], desc: "Command palette" },
  { keys: ["?"], desc: "This help" },
  { keys: ["Esc"], desc: "Close modal / palette" },
];

export default function ShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "?") setOpen((o) => !o);
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[160] bg-bg/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-card border border-border rounded-[14px] p-6 relative">
        <button onClick={() => setOpen(false)} className="absolute top-4 right-4 text-muted hover:text-fg" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2.5 mb-5">
          <Keyboard className="w-5 h-5 text-accentSoft" />
          <h2 className="text-lg font-bold text-fg">Shortcuts</h2>
        </div>
        <div className="space-y-2.5">
          {SHORTCUTS.map((s) => (
            <div key={s.desc} className="flex items-center justify-between">
              <span className="text-sm text-muted">{s.desc}</span>
              <div className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="bg-input border border-border rounded-md px-2 py-1 text-xs font-mono text-fg">
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
