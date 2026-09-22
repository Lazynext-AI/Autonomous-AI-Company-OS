"use client";

import { PageHeader, Card } from "@/components/ui";
import { Palette, Type, Box, Ruler } from "lucide-react";
import tokens from "@/design-tokens.json";

const ICONS: Record<string, any> = { color: Palette, font: Type, radius: Box, space: Ruler };

export default function DesignPage() {
  const sections = Object.entries(tokens).filter(
    ([k]) => !k.startsWith("$") && typeof (tokens as any)[k] === "object"
  );

  return (
    <>
      <PageHeader
        title="Design System"
        subtitle="Live tokens — the same values the Penpot blueprint uses, rendered real."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-5xl">
        {sections.map(([key, val]) => {
          const Icon = ICONS[key] ?? Box;
          const entries = Object.entries(val as Record<string, any>).slice(0, 20);
          return (
            <Card key={key}>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-accentBg flex items-center justify-center">
                  <Icon className="w-4 h-4 text-accentSoft" />
                </div>
                <h2 className="text-sm font-semibold capitalize">{key}</h2>
              </div>
              <div className="space-y-2">
                {entries.map(([name, v]) => {
                  const value = typeof v === "object" ? (v as any).value ?? JSON.stringify(v) : String(v);
                  const isColor = key === "color" && /^#|^rgb|^hsl/.test(String(value));
                  return (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="text-muted font-mono">{name}</span>
                      <span className="flex items-center gap-2">
                        {isColor && (
                          <span
                            className="w-4 h-4 rounded border border-border inline-block"
                            style={{ background: String(value) }}
                          />
                        )}
                        <span className="text-fg font-mono">{String(value).slice(0, 28)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
