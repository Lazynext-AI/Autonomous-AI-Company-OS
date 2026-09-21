"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { Github, Star, GitFork, GitCommit, ExternalLink, ArrowLeft } from "lucide-react";

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178C6", JavaScript: "#F1E05A", Python: "#3572A5",
  HTML: "#E34C26", CSS: "#563D7C", Shell: "#89E051",
};

export default function RepoPage() {
  const { name } = useParams<{ name: string }>();
  const [repo, setRepo] = useState<any>(null);
  const [readme, setReadme] = useState("");
  const [commits, setCommits] = useState<any[]>([]);
  const [langs, setLangs] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = `https://api.github.com/repos/Lazynext-Platform/${name}`;
    Promise.all([
      fetch(base).then((r) => r.json()),
      fetch(`${base}/readme`, { headers: { Accept: "application/vnd.github.raw" } }).then((r) =>
        r.ok ? r.text() : ""
      ),
      fetch(`${base}/commits?per_page=10`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${base}/languages`).then((r) => (r.ok ? r.json() : {})),
    ])
      .then(([repo, readme, commits, langs]) => {
        setRepo(repo);
        setReadme(readme.slice(0, 4000));
        setCommits(commits);
        setLangs(langs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [name]);

  if (!repo && !loading) return <Empty title="Repo not found" hint="It may be private or deleted." />;

  const total = Object.values(langs).reduce((a, b) => a + b, 0) || 1;

  return (
    <>
      <Link href="/code" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> All repos
      </Link>

      <PageHeader title={repo?.name || "…"} subtitle={repo?.description || ""}>
        <a
          href={repo?.html_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 bg-card hover:bg-cardHover border border-border text-sm font-medium px-4 py-2.5 rounded-lg transition"
        >
          <Github className="w-4 h-4" /> Open on GitHub
        </a>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 max-w-6xl">
        <Card className="lg:col-span-2 p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">README</div>
          <pre className="px-5 py-4 text-xs text-muted whitespace-pre-wrap font-mono leading-relaxed max-h-[60vh] overflow-y-auto">
            {readme || "No README"}
          </pre>
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold mb-3">Stats</h2>
            <div className="flex items-center gap-4 text-xs text-muted mb-4">
              <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" />{repo?.stargazers_count ?? 0}</span>
              <span className="flex items-center gap-1"><GitFork className="w-3.5 h-3.5" />{repo?.forks_count ?? 0}</span>
              <span className="ml-auto">updated {timeAgo(repo?.updated_at)}</span>
            </div>
            {/* language bar */}
            <div className="h-2 rounded-full overflow-hidden flex bg-input">
              {Object.entries(langs).map(([l, n]) => (
                <div
                  key={l}
                  style={{ width: `${(n / total) * 100}%`, background: LANG_COLORS[l] || "#9C9CAA" }}
                  title={l}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {Object.entries(langs).map(([l, n]) => (
                <span key={l} className="text-[11px] text-muted flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: LANG_COLORS[l] || "#9C9CAA" }} />
                  {l} {Math.round((n / total) * 100)}%
                </span>
              ))}
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-border text-sm font-semibold flex items-center gap-2">
              <GitCommit className="w-4 h-4 text-accentSoft" /> Recent commits
            </div>
            {commits.map((c) => (
              <a
                key={c.sha}
                href={c.html_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-3 px-5 py-3 border-b border-border last:border-0 hover:bg-cardHover transition"
              >
                <code className="text-[11px] text-accentSoft font-mono shrink-0 mt-0.5">
                  {c.sha.slice(0, 7)}
                </code>
                <div className="min-w-0">
                  <div className="text-xs text-fg truncate">{c.commit.message.split("\n")[0]}</div>
                  <div className="text-[11px] text-muted">
                    {c.commit.author.name} · {timeAgo(c.commit.author.date)}
                  </div>
                </div>
                <ExternalLink className="w-3 h-3 text-muted ml-auto shrink-0 mt-1" />
              </a>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
