"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

let push: (msg: string) => void;

export function toast(msg: string) {
  push?.(msg);
}

export default function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);

  useEffect(() => {
    push = (msg) => {
      const id = Date.now();
      setItems((i) => [...i, { id, msg }]);
      setTimeout(() => setItems((i) => i.filter((x) => x.id !== id)), 3000);
    };
    return () => {
      push = () => {};
    };
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-[200] space-y-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="bg-card border border-border rounded-[10px] px-4 py-3 flex items-center gap-2.5 shadow-xl animate-[slideUp_.2s_ease]"
        >
          <CheckCircle2 className="w-4 h-4 text-ok" />
          <span className="text-sm text-fg">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
