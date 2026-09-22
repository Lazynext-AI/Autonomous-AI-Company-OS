import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// The copilot: user message → Workers AI → reply posted back to the bus.
export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const r = await workerFetch("/agent/generate", {
    system:
      "You are Lazynext Copilot — the voice of an autonomous AI company of 13 agents " +
      "that research, build, test and ship software. Answer the founder concisely, " +
      "in-character, and helpfully.",
    prompt: text,
    max_tokens: 512,
  });
  const d = await r.json();
  const reply = d.text ?? "The company is thinking — try again.";
  await workerFetch("/bus/publish", {
    channel: "copilot",
    payload: { from: "lazynext_copilot", text: reply },
  });
  return NextResponse.json({ reply });
}
