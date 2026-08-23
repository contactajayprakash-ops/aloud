"use client";

import type { MasteryBook, SavedSession } from "./types";
import { P_INIT, daysUntilDue, update } from "./bkt";

const MASTERY = "aloud.v1.mastery";
const SESSIONS = "aloud.v1.sessions";
const DAY = 86_400_000;

/** Mastery follows the idea, not the map, so a second run on the same topic builds on the first. */
export function conceptKey(topic: string, label: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(topic)}/${slug(label)}`;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing, quota, whatever — the session still works, it just won't be remembered */
  }
}

export const loadMastery = (): MasteryBook => read<MasteryBook>(MASTERY, {});
export const loadSessions = (): SavedSession[] => read<SavedSession[]>(SESSIONS, []);

export function masteryOf(book: MasteryBook, key: string): number {
  return book[key]?.pKnown ?? P_INIT;
}

/** Fold one session's verdicts into the running belief for every concept it touched. */
export function applySession(
  topic: string,
  observations: Array<{ label: string; correct: boolean }>,
): Record<string, { before: number; after: number }> {
  const book = loadMastery();
  const now = Date.now();
  const deltas: Record<string, { before: number; after: number }> = {};

  for (const { label, correct } of observations) {
    const key = conceptKey(topic, label);
    const before = book[key]?.pKnown ?? P_INIT;
    const after = update(before, correct);
    book[key] = {
      pKnown: after,
      attempts: (book[key]?.attempts ?? 0) + 1,
      lastSeen: now,
      dueAt: now + daysUntilDue(after) * DAY,
    };
    deltas[label] = { before, after };
  }

  write(MASTERY, book);
  return deltas;
}

export function saveSession(session: SavedSession) {
  const all = loadSessions();
  all.unshift(session);
  write(SESSIONS, all.slice(0, 60));
}

export function clearEverything() {
  try {
    window.localStorage.removeItem(MASTERY);
    window.localStorage.removeItem(SESSIONS);
  } catch {
    /* nothing to clear */
  }
}
