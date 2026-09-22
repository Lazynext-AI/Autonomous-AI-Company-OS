import Link from "next/link";

export default function RateLimitedPage() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <div className="text-7xl font-bold text-accentSoft mb-4">429</div>
      <h1 className="text-xl font-bold text-fg mb-2">Too many requests</h1>
      <p className="text-sm text-muted max-w-sm mb-8">
        You've hit the rate limit. Take a breath — the company keeps working while you wait a few seconds.
      </p>
      <Link
        href="/"
        className="bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition"
      >
        Back to overview
      </Link>
    </div>
  );
}
