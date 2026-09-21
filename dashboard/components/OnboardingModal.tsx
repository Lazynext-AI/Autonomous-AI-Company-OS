"use client";

import { useEffect, useState } from "react";
import { X, Zap, Brain, Plug, Rocket } from "lucide-react";

const STEPS = [
  {
    icon: Zap,
    title: "Welcome to Lazynext",
    body: "An AI company that runs itself. 12 agents research, build, ship and market products — you watch from here.",
  },
  {
    icon: Brain,
    title: "The brain",
    body: "Every agent shares one company brain — mission, product, stack, blockers — persisted in D1, cached in KV.",
  },
  {
    icon: Plug,
    title: "Integrations",
    body: "Atlas Cloud (LLM), Cloudflare (data), GitHub (code), Resend (email), E2B (sandboxes), Firecrawl (research) — all wired.",
  },
  {
    icon: Rocket,
    title: "Launch",
    body: "Fund Atlas Cloud, then run `make dev` locally. Agents register, pick a product, and start shipping.",
  },
];

export default function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (localStorage.getItem("lz_onboarded") !== "1") {
      setOpen(true);
    }
  }, []);

  const done = () => {
    localStorage.setItem("lz_onboarded", "1");
    setOpen(false);
  };

  if (!open) return null;
  const s = STEPS[step];
  const Icon = s.icon;
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[150] bg-bg/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={done}>
      <div
        className="w-full max-w-md bg-card border border-border rounded-[14px] p-8 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={done} className="absolute top-4 right-4 text-muted hover:text-fg" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
        <div className="w-12 h-12 rounded-[12px] bg-accentBg flex items-center justify-center mb-5">
          <Icon className="w-6 h-6 text-accentSoft" />
        </div>
        <h2 className="text-xl font-bold text-fg mb-2">{s.title}</h2>
        <p className="text-sm text-muted leading-relaxed mb-8">{s.body}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-6 bg-accent" : "w-1.5 bg-border"
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => (last ? done() : setStep((x) => x + 1))}
            className="bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
          >
            {last ? "Get started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
