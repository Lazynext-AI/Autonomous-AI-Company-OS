"use client";

import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
}

export default function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("lz_install_dismissed") === "1") return;
    const onBip = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (!evt || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem("lz_install_dismissed", "1");
  };

  return (
    <div className="fixed bottom-6 left-6 z-[140] max-w-xs bg-card border border-border rounded-[14px] p-4 shadow-xl animate-[slideUp_.2s_ease]">
      <button onClick={dismiss} className="absolute top-3 right-3 text-muted hover:text-fg" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
          <Download className="w-5 h-5 text-accentSoft" />
        </div>
        <div>
          <div className="text-sm font-semibold text-fg">Install Lazynext</div>
          <p className="text-xs text-muted mt-0.5 mb-3">
            Add to your dock/home screen — launches like a native app.
          </p>
          <button
            onClick={async () => { await evt.prompt(); dismiss(); }}
            className="bg-accent hover:bg-accentSoft text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
