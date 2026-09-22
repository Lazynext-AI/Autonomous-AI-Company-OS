import Link from "next/link";
import { Rocket } from "lucide-react";

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl bg-accentBg flex items-center justify-center mx-auto mb-6">
          <Rocket className="w-6 h-6 text-accentSoft" />
        </div>
        <h1 className="text-xl font-bold text-fg mb-2">Single-owner deployment</h1>
        <p className="text-sm text-muted mb-6">
          Lazynext is self-hosted — one founder per company. There's no public signup; deploy your own
          instance or join the waitlist for a hosted company.
        </p>
        <a
          href="https://lazynext.com#waitlist"
          className="inline-block bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition"
        >
          Join the waitlist
        </a>
        <div className="mt-5">
          <Link href="/login" className="text-sm text-muted hover:text-fg">
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
