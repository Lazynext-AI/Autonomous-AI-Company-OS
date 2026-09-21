import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-6xl font-bold text-accentSoft mb-4">404</div>
        <div className="text-xl font-semibold text-zinc-50 mb-2">
          Page not found
        </div>
        <p className="text-sm text-muted mb-8">
          This surface doesn't exist — even for an autonomous company.
        </p>
        <Link
          href="/"
          className="inline-block bg-accent hover:bg-accentSoft text-white font-semibold rounded-lg px-6 py-3 text-sm transition"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
