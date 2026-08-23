export type Concept = {
  id: string;
  label: string;
  /** One sentence describing what a complete out-loud explanation has to contain. */
  probe: string;
  /** The two or three specifics that separate "said the word" from "understands it". */
  keyPoints: string[];
  /** 0 is foundational; higher tiers build on lower ones. */
  tier: number;
  /** ids of concepts this one leans on */
  requires: string[];
};

export type ConceptMap = {
  id: string;
  topic: string;
  summary: string;
  createdAt: number;
  concepts: Concept[];
};

export type Utterance = {
  id: number;
  text: string;
  at: number;
  /** cosine similarity to every concept, in map order */
  sims: number[];
  /** concept ids this utterance counted as evidence for */
  credited: string[];
};

export type Verdict = "explained" | "named" | "missing" | "misconceived";

export type ConceptGrade = {
  id: string;
  verdict: Verdict;
  evidence: string;
  note: string;
};

export type Mastery = {
  /** BKT posterior probability that the learner knows this concept */
  pKnown: number;
  attempts: number;
  lastSeen: number;
  dueAt: number;
};

export type MasteryBook = Record<string, Mastery>;

export type SavedSession = {
  mapId: string;
  topic: string;
  finishedAt: number;
  wordCount: number;
  seconds: number;
  grades: ConceptGrade[];
  /** pKnown before and after, per concept id */
  deltas: Record<string, { before: number; after: number }>;
};
