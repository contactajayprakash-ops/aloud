/**
 * Turning "what did they just say" into "which idea did they just cover".
 *
 * Gemini's embeddings sit in a narrow band — two sentences from unrelated
 * subjects still score around 0.67 cosine, and two sentences from the same
 * lesson score around 0.80. Absolute thresholds are useless at that spread.
 * So every utterance is scored *against the map it belongs to*: how far above
 * the average concept does this sentence reach, in standard deviations. That
 * question stays well-posed no matter how tightly the topic is clustered.
 */

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Raw cosine below which a sentence is simply not about the concept, no matter
 * how it ranks. Measured on this embedding model: off-topic chatter tops out
 * around 0.71 against a study map, contentless filler around 0.76, and real
 * on-topic statements land 0.80 and up.
 */
const FLOOR_SIM = 0.77;
/** z-score below which an utterance is not considered to be about a concept. */
const FLOOR_Z = 0.75;
/** z-score at which an utterance counts as full evidence on its own. */
const FULL_Z = 2.3;

export type Credit = { index: number; weight: number; z: number };

export function creditsFor(sims: number[]): Credit[] {
  const n = sims.length;
  if (n === 0) return [];
  const mean = sims.reduce((a, b) => a + b, 0) / n;
  const variance = sims.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  // If every sim is near-identical the sentence discriminates nothing; a tiny
  // sd would turn that flatness into huge z-scores, so it gets clamped.
  const sd = Math.max(Math.sqrt(variance), 0.008);

  const out: Credit[] = [];
  for (let i = 0; i < n; i++) {
    if (sims[i] < FLOOR_SIM) continue;
    const z = (sims[i] - mean) / sd;
    if (z < FLOOR_Z) continue;
    const weight = Math.min(1, Math.max(0, (z - FLOOR_Z) / (FULL_Z - FLOOR_Z)));
    if (weight > 0.04) out.push({ index: i, weight, z });
  }
  // A rambling sentence can graze three ideas at once; only the two it leans
  // hardest on get credit, so coverage cannot be farmed by talking in circles.
  out.sort((a, b) => b.z - a.z);
  return out.slice(0, 2);
}

/**
 * Coverage saturates: the first solid sentence about an idea moves the needle
 * a lot, the fifth barely moves it. Repeating yourself does not light a node.
 */
export function accumulate(current: number, weight: number): number {
  return 1 - (1 - current) * (1 - weight * 0.85);
}

/** Short filler ("um, so, right") should never count as evidence for anything. */
export function isSubstantive(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;
  const filler = /^(um|uh|so|okay|ok|right|like|yeah|well|and|but|hmm|erm)$/i;
  const real = words.filter((w) => !filler.test(w.replace(/[^a-z]/gi, "")));
  return real.length >= 4;
}
