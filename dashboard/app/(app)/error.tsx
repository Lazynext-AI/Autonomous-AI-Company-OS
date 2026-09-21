"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-[14px] bg-badBg flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="w-6 h-6 text-bad" />
        </div>
        <h1 className="text-xl font-bold text-fg mb-2">Something broke</h1>
        <p className="text-sm text-muted mb-6">
          {error.message || "The page hit an unexpected error."}
        </p>
        <button
          onClick={reset}
          className="bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
