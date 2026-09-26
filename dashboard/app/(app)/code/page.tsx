"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { Github, GitFork, Star, ExternalLink } from "lucide-react";

interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  updated_at: string;
  stargazers_count: number;
  forks_count: number;
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178C6", JavaScript: "#F1E05A", Python: "#3572A5",
  HTML: "#E34C26", CSS: "#563D7C", Shell: "#89E051",
};

export default function CodePage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("https://api.github.com/users/Lazynext-AI/repos?sort=updated&per_page=30")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setRepos(d); setLoading(false); })
      .catch(() => { setErr(true); setLoading(false); });
  }, []);

  return (
    <>
      <PageHeader title="Code" subtitle="Everything the company has pushed to GitHub." />

      {repos.length === 0 && !loading ? (
        <Empty
          title={err ? "Couldn't reach GitHub" : "No repos yet"}
          hint="Agents create repos here as they ship products."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-5xl">
          {repos.map((r) => (
            <Link key={r.name} href={`/code/${r.name}`} className="block">
              <Card className="hover:border-accent transition h-full">
                <div className="flex items-center gap-2.5 mb-2">
                  <Github className="w-4 h-4 text-muted" />
                  <span className="text-sm font-semibold text-accentSoft truncate">{r.name}</span>
                  <ExternalLink className="w-3 h-3 text-muted ml-auto shrink-0" />
                </div>
                <p className="text-xs text-muted line-clamp-2 min-h-[2rem]">
                  {r.description || "No description"}
                </p>
                <div className="flex items-center gap-4 mt-4 text-xs text-muted">
                  {r.language && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: LANG_COLORS[r.language] || "#9C9CAA" }} />
                      {r.language}
                    </span>
                  )}
                  <span className="flex items-center gap-1"><Star className="w-3 h-3" />{r.stargazers_count}</span>
                  <span className="flex items-center gap-1"><GitFork className="w-3 h-3" />{r.forks_count}</span>
                  <span className="ml-auto">{timeAgo(r.updated_at)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
