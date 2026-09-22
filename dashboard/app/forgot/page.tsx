import Link from "next/link";
import { KeyRound } from "lucide-react";

export default function ForgotPage() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl bg-accentBg flex items-center justify-center mx-auto mb-6">
          <KeyRound className="w-6 h-6 text-accentSoft" />
        </div>
        <h1 className="text-xl font-bold text-fg mb-2">Forgot passphrase</h1>
        <p className="text-sm text-muted mb-6">
          This is a single-owner deployment — there's no email reset flow. Your passphrase lives in your
          own infrastructure:
        </p>
        <div className="bg-card border border-border rounded-xl p-4 text-left mb-6">
          <div className="text-xs text-muted mb-1">Check your env</div>
          <code className="text-xs text-accentSoft font-mono">DASHBOARD_PASSPHRASE in .env</code>
          <div className="text-xs text-muted mt-3 mb-1">Or ask your deployment</div>
          <code className="text-xs text-accentSoft font-mono">wrangler secret list</code>
        </div>
        <Link href="/login" className="text-sm text-accentSoft hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}
