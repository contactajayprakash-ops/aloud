"use client";

import type { Concept, ConceptGrade, Verdict } from "@/lib/types";
import { label as masteryLabel } from "@/lib/bkt";

const VERDICT_META: Record<Verdict, { name: string; tone: string; dot: string }> = {
  explained: { name: "Explained", tone: "text-lit-bright", dot: "bg-lit" },
  named: { name: "Mentioned, not explained", tone: "text-named", dot: "bg-named" },
  missing: { name: "Never came up", tone: "text-ink-faint", dot: "bg-hairline" },
  misconceived: { name: "Got it wrong", tone: "text-wrong", dot: "bg-wrong" },
};

const ORDER: Verdict[] = ["misconceived", "missing", "named", "explained"];

type Props = {
  topic: string;
  headline: string;
  concepts: Concept[];
  grades: ConceptGrade[];
  deltas: Record<string, { before: number; after: number }>;
  onAgain: () => void;
  onNewTopic: () => void;
};

export function SessionResults({ topic, headline, concepts, grades, deltas, onAgain, onNewTopic }: Props) {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const sorted = [...grades].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
  const explained = grades.filter((g) => g.verdict === "explained").length;

  return (
    <div className="rise mx-auto w-full max-w-2xl px-6 pb-24">
      <p className="text-xs tracking-[0.2em] uppercase text-ink-faint">After teaching · {topic}</p>
      <h2 className="mt-3 text-3xl leading-snug" style={{ fontFamily: "var(--font-display)" }}>
        {headline || `You explained ${explained} of ${concepts.length} ideas.`}
      </h2>

      <div className="mt-8 space-y-3">
        {sorted.map((g) => {
          const c = byId.get(g.id);
          if (!c) return null;
          const meta = VERDICT_META[g.verdict];
          const d = deltas[c.label];
          return (
            <div key={g.id} className="hairline rounded-xl border bg-panel p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                  <span className="font-medium text-ink">{c.label}</span>
                </div>
                <span className={`shrink-0 text-xs ${meta.tone}`}>{meta.name}</span>
              </div>
              {g.evidence && (
                <p className="mt-2 border-l-2 border-hairline pl-3 text-sm text-ink-soft italic">
                  “{g.evidence}”
                </p>
              )}
              <p className="mt-2 text-sm text-ink-soft">{g.note}</p>
              {d && (
                <div className="mt-3 flex items-center gap-3">
                  <MasteryBar before={d.before} after={d.after} />
                  <span className="text-xs whitespace-nowrap text-ink-faint">
                    {masteryLabel(d.after)} · {Math.round(d.after * 100)}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <button
          onClick={onAgain}
          className="rounded-full bg-lit px-6 py-3 text-sm font-semibold text-pitch transition hover:bg-lit-bright"
        >
          Teach it again
        </button>
        <button
          onClick={onNewTopic}
          className="hairline rounded-full border px-6 py-3 text-sm text-ink-soft transition hover:text-ink"
        >
          Different topic
        </button>
      </div>
      <p className="mt-4 text-xs text-ink-faint">
        Re-teaching after a gap is where the memory forms — the tracker on the home page tells you
        when each idea is due.
      </p>
    </div>
  );
}

/** Belief before the session (notch) versus after (fill). */
function MasteryBar({ before, after }: { before: number; after: number }) {
  return (
    <div className="relative h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-panel-lift">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-lit transition-all duration-1000"
        style={{ width: `${after * 100}%` }}
      />
      <div
        className="absolute inset-y-0 w-px bg-ink-soft/70"
        style={{ left: `${before * 100}%` }}
        title={`was ${Math.round(before * 100)}%`}
      />
    </div>
  );
}
