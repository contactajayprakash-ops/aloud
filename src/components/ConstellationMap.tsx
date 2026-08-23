"use client";

import { memo, useMemo } from "react";
import type { Placed } from "@/lib/layout";
import { CANVAS, center } from "@/lib/layout";
import type { Verdict } from "@/lib/types";

type Props = {
  nodes: Placed[];
  coverage: Record<string, number>;
  verdicts?: Record<string, Verdict>;
  /** id of the node the classmate is currently asking about */
  probing?: string | null;
  /** id most recently credited by live scoring — gets a pulse */
  justLit?: string | null;
  onPick?: (id: string) => void;
  dimmed?: boolean;
};

/** Where a node's visual sits between unlit charcoal and full lamplight. */
function glowOf(coverage: number, verdict?: Verdict): number {
  if (verdict === "misconceived") return 0.9;
  if (verdict === "missing") return 0;
  if (verdict === "named") return 0.45;
  if (verdict === "explained") return 1;
  return coverage;
}

function nodeColor(verdict?: Verdict): { core: string; halo: string } {
  if (verdict === "misconceived") return { core: "#dd6a4f", halo: "rgba(221,106,79,0.32)" };
  if (verdict === "named") return { core: "#7a8fa6", halo: "rgba(122,143,166,0.25)" };
  return { core: "#f5b83d", halo: "rgba(245,184,61,0.3)" };
}

function wrapLabel(label: string): string[] {
  const words = label.split(" ");
  if (words.length <= 3) return [label];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/**
 * The map itself. Pure SVG — no chart library gets the glow right, and the
 * whole point of the interface is the glow.
 */
function ConstellationMapInner({
  nodes,
  coverage,
  verdicts,
  probing,
  justLit,
  onPick,
  dimmed,
}: Props) {
  const edges = useMemo(() => {
    const at = new Map(nodes.map((n) => [n.id, n]));
    const out: Array<{ from: Placed; to: Placed; lit: boolean }> = [];
    for (const n of nodes) {
      for (const r of n.requires) {
        const p = at.get(r);
        if (!p) continue;
        const fromGlow = glowOf(coverage[p.id] ?? 0, verdicts?.[p.id]);
        const toGlow = glowOf(coverage[n.id] ?? 0, verdicts?.[n.id]);
        out.push({ from: p, to: n, lit: fromGlow > 0.5 && toGlow > 0.5 });
      }
    }
    return out;
  }, [nodes, coverage, verdicts]);

  return (
    <svg
      viewBox={`-50 -25 ${CANVAS + 100} ${CANVAS + 85}`}
      className={`h-full w-full transition-opacity duration-500 ${dimmed ? "opacity-40" : ""}`}
      role="img"
      aria-label="Concept map. Ideas light up as your explanation covers them."
    >
      <defs>
        <radialGradient id="lamp" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(245,184,61,0.10)" />
          <stop offset="55%" stopColor="rgba(245,184,61,0.03)" />
          <stop offset="100%" stopColor="rgba(245,184,61,0)" />
        </radialGradient>
        <filter id="soften" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      {/* faint tier rings, so the structure reads even fully dark */}
      {[172, 285, 392].map((r) => (
        <circle
          key={r}
          cx={center.x}
          cy={center.y}
          r={r}
          fill="none"
          stroke="#332c23"
          strokeWidth="1"
          strokeDasharray="2 7"
          opacity="0.55"
        />
      ))}

      <circle cx={center.x} cy={center.y} r={CANVAS / 2} fill="url(#lamp)" />

      {edges.map(({ from, to, lit }, i) => (
        <line
          key={i}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={lit ? "rgba(245,184,61,0.5)" : "rgba(125,115,101,0.16)"}
          strokeWidth={lit ? 1.6 : 1}
          strokeDasharray={lit ? "none" : "3 5"}
          className="transition-all duration-700"
        />
      ))}

      {nodes.map((n) => {
        const verdict = verdicts?.[n.id];
        const glow = glowOf(coverage[n.id] ?? 0, verdict);
        const { core, halo } = nodeColor(verdict);
        const isProbe = probing === n.id;
        const pulse = justLit === n.id;
        const r = 9 + glow * 7;
        const lines = wrapLabel(n.label);

        return (
          <g
            key={n.id}
            className={onPick ? "cursor-pointer" : ""}
            onClick={() => onPick?.(n.id)}
            role={onPick ? "button" : undefined}
            aria-label={`${n.label}: ${verdict ?? `${Math.round(glow * 100)} percent covered`}`}
          >
            {glow > 0.05 && (
              <circle
                cx={n.x}
                cy={n.y}
                r={r + 14 + glow * 12}
                fill={halo}
                opacity={glow * 0.85}
                filter="url(#soften)"
                className={pulse ? "breathe" : "transition-all duration-700"}
              />
            )}
            {isProbe && (
              <circle
                cx={n.x}
                cy={n.y}
                r={r + 11}
                fill="none"
                stroke="#f4ece0"
                strokeWidth="1.3"
                strokeDasharray="5 6"
                className="breathe"
              />
            )}
            <circle
              cx={n.x}
              cy={n.y}
              r={r}
              fill={glow > 0.05 ? core : "#262119"}
              stroke={glow > 0.05 ? "rgba(244,236,224,0.5)" : "#43392c"}
              strokeWidth="1.2"
              opacity={0.35 + glow * 0.65}
              className="transition-all duration-700"
            />
            {verdict === "misconceived" && (
              <text
                x={n.x}
                y={n.y + 4.5}
                textAnchor="middle"
                fontSize="13"
                fill="#100e0c"
                fontWeight="700"
              >
                !
              </text>
            )}
            {lines.map((line, li) => (
              <text
                key={li}
                x={n.x}
                y={n.y + r + 15 + li * 13}
                textAnchor="middle"
                fontSize="11.5"
                fill={glow > 0.4 ? "#f4ece0" : "#7d7365"}
                className="transition-all duration-700 select-none"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export const ConstellationMap = memo(ConstellationMapInner);
