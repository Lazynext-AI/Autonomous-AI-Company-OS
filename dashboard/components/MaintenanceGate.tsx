"use client";

import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";

export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const [maint, setMaint] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/api/kv", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "get", key: "flag:maintenance" }),
    })
      .then((r) => r.json())
      .then((d) => setMaint(d.value === "true" || d.value === true))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return null;

  if (maint) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-warnBg flex items-center justify-center mx-auto mb-6">
            <Wrench className="w-8 h-8 text-warn" />
          </div>
          <h1 className="text-2xl font-bold text-fg">Under maintenance</h1>
          <p className="text-sm text-muted mt-3">
            The company is paused while we make changes. Everything resumes the moment
            maintenance mode is switched off in Settings.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
