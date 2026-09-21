import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Executes a command in a live sandbox via envd Connect-RPC.
// Request/response frames: [flag 1B][len 4B BE][json]
export async function POST(req: NextRequest) {
  const { id, cmd } = await req.json();
  if (!id || !cmd) return NextResponse.json({ error: "id and cmd required" }, { status: 400 });

  try {
    const body = new TextEncoder().encode(
      JSON.stringify({ process: { cmd: "/bin/bash", args: ["-lc", cmd] } })
    );
    const frame = new Uint8Array(5 + body.length);
    frame[0] = 0;
    new DataView(frame.buffer).setUint32(1, body.length, false);
    frame.set(body, 5);

    const res = await fetch(`https://49983-${id}.e2b.dev/process.Process/Start`, {
      method: "POST",
      headers: { "content-type": "application/connect+json", "Connect-Protocol-Version": "1" },
      body: frame,
      // @ts-ignore duplex required for streaming bodies
      duplex: "half",
    });

    const raw = new Uint8Array(await res.arrayBuffer());
    let stdout = "", stderr = "", status = "";
    let off = 0;
    while (off + 5 <= raw.length) {
      const len = new DataView(raw.buffer, off + 1, 4).getUint32(0, false);
      const msg = JSON.parse(new TextDecoder().decode(raw.slice(off + 5, off + 5 + len)));
      const ev = msg.event;
      if (ev?.data?.stdout) stdout += atob(ev.data.stdout);
      if (ev?.data?.stderr) stderr += atob(ev.data.stderr);
      if (ev?.end) status = ev.end.status ?? "";
      off += 5 + len;
    }
    return NextResponse.json({ stdout, stderr, status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
