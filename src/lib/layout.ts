import type { Concept } from "./types";

export type Placed = Concept & { x: number; y: number; angle: number };

export const CANVAS = 900;
const CENTER = CANVAS / 2;
const RING = [172, 285, 392];

/**
 * Foundations sit closest to the middle and everything that depends on them
 * sits further out, so the shape of the subject is visible before a word is
 * said. Rings are phase-shifted against each other so nodes never stack up
 * along the same spoke, and each node nudges toward the average angle of the
 * things it depends on — related ideas end up neighbours instead of being
 * scattered by alphabetical accident.
 */
export function place(concepts: Concept[]): Placed[] {
  const byTier: Concept[][] = [[], [], []];
  for (const c of concepts) byTier[Math.min(2, c.tier)].push(c);

  const angles = new Map<string, number>();
  const out: Placed[] = [];

  byTier.forEach((tierConcepts, tier) => {
    const n = tierConcepts.length;
    if (n === 0) return;
    const phase = -Math.PI / 2 + tier * 0.62;

    const seats = tierConcepts.map((c, i) => {
      const even = phase + (i / n) * Math.PI * 2;
      const parents = c.requires.map((r) => angles.get(r)).filter((a): a is number => a != null);
      if (parents.length === 0) return { c, angle: even, pull: even };
      // Average the parent directions on the unit circle so the wrap at 2π
      // does not fling a node to the far side of the map.
      const mx = parents.reduce((s, a) => s + Math.cos(a), 0) / parents.length;
      const my = parents.reduce((s, a) => s + Math.sin(a), 0) / parents.length;
      return { c, angle: even, pull: Math.atan2(my, mx) };
    });

    // Keep the even spacing, but hand out the seats to whichever concept wants
    // to be nearest each one. Guarantees no two nodes ever overlap.
    const taken = new Array(n).fill(false);
    const order = [...seats].sort((a, b) => a.c.requires.length - b.c.requires.length);
    for (const seat of order) {
      let best = -1;
      let bestGap = Infinity;
      for (let i = 0; i < n; i++) {
        if (taken[i]) continue;
        const cand = phase + (i / n) * Math.PI * 2;
        const gap = Math.abs(Math.atan2(Math.sin(cand - seat.pull), Math.cos(cand - seat.pull)));
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
      taken[best] = true;
      const angle = phase + (best / n) * Math.PI * 2;
      angles.set(seat.c.id, angle);
      out.push({
        ...seat.c,
        angle,
        x: CENTER + Math.cos(angle) * RING[tier],
        y: CENTER + Math.sin(angle) * RING[tier],
      });
    }
  });

  return out.sort(
    (a, b) => concepts.findIndex((c) => c.id === a.id) - concepts.findIndex((c) => c.id === b.id),
  );
}

export const center = { x: CENTER, y: CENTER };
