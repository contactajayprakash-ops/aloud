/**
 * Bayesian Knowledge Tracing — Corbett & Anderson, 1994.
 *
 * The model behind most intelligent tutoring systems, and the reason this app
 * does not just show you a score. It carries a belief about whether you know
 * each idea, updates that belief from evidence, and accounts for the two ways
 * evidence lies: you can explain something correctly by luck (guess), and you
 * can fumble something you actually know (slip).
 *
 * Four parameters, tuned for spoken explanation rather than multiple choice.
 * Talking through an idea is harder to fake than picking option C, so the
 * guess rate is low; it is also easier to trip over mid-sentence, so the slip
 * rate is a little higher than the classic 0.1.
 */

export const P_INIT = 0.14; // belief you already knew it, before any evidence
export const P_TRANSIT = 0.19; // chance the act of explaining teaches it to you
export const P_SLIP = 0.14; // knew it, still explained it badly
export const P_GUESS = 0.16; // did not know it, still said something right

/**
 * One observation. `correct` means the learner actually explained the idea,
 * not that they mentioned it.
 */
export function update(pKnown: number, correct: boolean): number {
  const prior = Math.min(0.999, Math.max(0.001, pKnown));

  const posterior = correct
    ? (prior * (1 - P_SLIP)) /
      (prior * (1 - P_SLIP) + (1 - prior) * P_GUESS)
    : (prior * P_SLIP) /
      (prior * P_SLIP + (1 - prior) * (1 - P_GUESS));

  // Learning happens during the attempt itself, so the belief gets to grow
  // even after a bad one.
  return posterior + (1 - posterior) * P_TRANSIT;
}

/**
 * How long before this idea is worth teaching again. Expanding intervals,
 * anchored to the belief rather than to a fixed ladder of boxes.
 */
export function daysUntilDue(pKnown: number): number {
  return Math.max(1, Math.round(0.55 * Math.exp(3.25 * pKnown)));
}

export function label(pKnown: number): string {
  if (pKnown >= 0.85) return "Solid";
  if (pKnown >= 0.6) return "Getting there";
  if (pKnown >= 0.35) return "Shaky";
  return "Not yet";
}
