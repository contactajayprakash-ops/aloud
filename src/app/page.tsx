"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConstellationMap } from "@/components/ConstellationMap";
import { SessionResults } from "@/components/SessionResults";
import { place, type Placed } from "@/lib/layout";
import { useSpeech } from "@/lib/speech";
import { accumulate, cosine, creditsFor, isSubstantive } from "@/lib/vector";
import { applySession, clearEverything, loadMastery, loadSessions, saveSession } from "@/lib/store";
import { label as masteryLabel } from "@/lib/bkt";
import type { Concept, ConceptGrade, Verdict } from "@/lib/types";

type Screen = "home" | "building" | "teach" | "grading" | "results";

type MapData = {
  id: string;
  topic: string;
  summary: string;
  concepts: Concept[];
  vectors: number[][];
};

const STARTERS = [
  "How photosynthesis works",
  "Causes of World War I",
  "Supply and demand",
  "How neurons fire",
  "The water cycle",
  "Newton's three laws",
];

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [topic, setTopic] = useState("");
  const [map, setMap] = useState<MapData | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [oops, setOops] = useState<string | null>(null);

  // live session state
  const [coverage, setCoverage] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<string[]>([]);
  const [justLit, setJustLit] = useState<string | null>(null);
  const [question, setQuestion] = useState<{ text: string; target: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(false);
  const [startedAt, setStartedAt] = useState(0);

  // results state
  const [grades, setGrades] = useState<ConceptGrade[]>([]);
  const [headline, setHeadline] = useState("");
  const [deltas, setDeltas] = useState<Record<string, { before: number; after: number }>>({});

  const coverageRef = useRef(coverage);
  coverageRef.current = coverage;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const pending = useRef<string[]>([]);
  const scoring = useRef(false);
  const asking = useRef(false);
  const lastAsk = useRef(0);
  /** Bumped on every new map or reset, so late responses from an old session cannot touch a new one. */
  const sessionId = useRef(0);
  const litTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------- live scoring ---------------- */

  const scoreQueue = useCallback(async () => {
    if (scoring.current || pending.current.length === 0 || !map) return;
    scoring.current = true;
    const session = sessionId.current;
    const batch = pending.current.splice(0, pending.current.length);
    try {
      const res = await fetch("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: batch }),
      });
      const { vectors } = (await res.json()) as { vectors?: number[][] };
      if (!vectors || sessionId.current !== session) return;
      let lit: string | null = null;
      setCoverage((prev) => {
        const next = { ...prev };
        for (const vec of vectors) {
          const sims = map.concepts.map((_, i) => cosine(vec, map.vectors[i]));
          for (const { index, weight } of creditsFor(sims)) {
            const id = map.concepts[index].id;
            const was = next[id] ?? 0;
            next[id] = accumulate(was, weight);
            if (next[id] - was > 0.15) lit = id;
          }
        }
        return next;
      });
      if (lit) {
        setJustLit(lit);
        if (litTimer.current) clearTimeout(litTimer.current);
        litTimer.current = setTimeout(() => setJustLit(null), 2600);
      }
    } catch {
      /* one lost batch is fine; the final grade re-reads the whole transcript */
    } finally {
      scoring.current = false;
      if (pending.current.length > 0) void scoreQueue();
    }
  }, [map]);

  const takeUtterance = useCallback(
    (text: string) => {
      setLines((prev) => [...prev, text]);
      if (isSubstantive(text)) {
        pending.current.push(text);
        void scoreQueue();
      }
    },
    [scoreQueue],
  );

  const speech = useSpeech(takeUtterance);

  /* ---------------- the classmate ---------------- */

  const askClassmate = useCallback(async () => {
    if (!map || asking.current) return;
    const now = Date.now();
    if (now - lastAsk.current < 25_000) return; // one interruption at a time, well spaced
    const cov = coverageRef.current;
    const spoken = linesRef.current.join(" ");
    if (spoken.split(/\s+/).length < 40) return; // let them warm up first

    // Darkest node whose prerequisites are at least half lit — the gap they
    // are ready to be asked about, not just the furthest one.
    const ready = map.concepts.filter((c) =>
      c.requires.every((r) => (cov[r] ?? 0) > 0.35),
    );
    const target = [...ready].sort((a, b) => (cov[a.id] ?? 0) - (cov[b.id] ?? 0))[0];
    if (!target || (cov[target.id] ?? 0) > 0.55) return;

    asking.current = true;
    lastAsk.current = now;
    try {
      const res = await fetch("/api/classmate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: map.topic, target, transcript: spoken.slice(-4000) }),
      });
      const data = (await res.json()) as { question?: string };
      if (data.question) setQuestion({ text: data.question, target: target.id });
    } catch {
      /* the classmate can sit one out */
    } finally {
      asking.current = false;
    }
  }, [map]);

  useEffect(() => {
    if (screen !== "teach") return;
    const t = setInterval(() => void askClassmate(), 9_000);
    return () => clearInterval(t);
  }, [screen, askClassmate]);

  /* ---------------- screen transitions ---------------- */

  const build = useCallback(async (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    setTopic(clean);
    setOops(null);
    sessionId.current += 1;
    pending.current = [];
    setScreen("building");
    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: clean }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went sideways.");
      setMap(data);
      setPlaced(place(data.concepts));
      setCoverage({});
      setLines([]);
      setGrades([]);
      setQuestion(null);
      setHeadline("");
      setStartedAt(Date.now());
      setScreen("teach");
    } catch (e) {
      setOops(e instanceof Error ? e.message : "Something went sideways.");
      setScreen("home");
    }
  }, []);

  const finish = useCallback(async () => {
    if (!map) return;
    // Whatever is still mid-recognition when they click is part of what they
    // said; losing the last sentence to mic latency would be a rotten deal.
    const tail = speech.interimRef.current.trim();
    speech.stop();
    setQuestion(null);
    const transcript = [...linesRef.current, tail].filter(Boolean).join("\n");
    if (tail) setLines((prev) => [...prev, tail]);
    setScreen("grading");
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: map.topic, concepts: map.concepts, transcript }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Grading failed.");
      const gs = data.grades as ConceptGrade[];
      setGrades(gs);
      setHeadline(data.headline ?? "");

      // "Never came up" is the absence of evidence, not a failed attempt —
      // only concepts that were actually engaged with move the belief.
      const observations = gs
        .filter((g) => g.verdict !== "missing")
        .map((g) => ({
          label: map.concepts.find((c) => c.id === g.id)?.label ?? g.id,
          correct: g.verdict === "explained",
        }));
      const ds = applySession(map.topic, observations);
      setDeltas(ds);
      saveSession({
        mapId: map.id,
        topic: map.topic,
        finishedAt: Date.now(),
        wordCount: transcript.split(/\s+/).filter(Boolean).length,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        grades: gs,
        deltas: Object.fromEntries(
          Object.entries(ds).map(([k, v]) => [k, v]),
        ),
      });
      setScreen("results");
    } catch (e) {
      setOops(e instanceof Error ? e.message : "Grading failed.");
      setScreen("teach");
    }
  }, [map, speech, startedAt]);

  const reset = useCallback(
    (keepTopic: boolean) => {
      speech.stop();
      sessionId.current += 1;
      pending.current = [];
      setCoverage({});
      setLines([]);
      setQuestion(null);
      setGrades([]);
      setOops(null);
      if (keepTopic && map) {
        setStartedAt(Date.now());
        setScreen("teach");
      } else {
        setMap(null);
        setTopic("");
        setScreen("home");
      }
    },
    [map, speech],
  );

  /* ---------------- render ---------------- */

  const verdictById = useMemo(
    () => Object.fromEntries(grades.map((g) => [g.id, g.verdict])) as Record<string, Verdict>,
    [grades],
  );

  return (
    <main className="relative z-10 min-h-dvh">
      {screen === "home" && (
        <HomeScreen topic={topic} setTopic={setTopic} onGo={build} oops={oops} />
      )}

      {screen === "building" && <BuildingScreen topic={topic} />}

      {(screen === "teach" || screen === "grading") && map && (
        <TeachScreen
          map={map}
          placed={placed}
          coverage={coverage}
          justLit={justLit}
          question={question}
          dismissQuestion={() => setQuestion(null)}
          lines={lines}
          interim={speech.interim}
          listening={speech.listening}
          micSupported={speech.supported}
          micError={speech.error}
          onMic={() => (speech.listening ? speech.stop() : speech.start())}
          typing={typing}
          setTyping={setTyping}
          typed={typed}
          setTyped={setTyped}
          onTypedSubmit={() => {
            const t = typed.trim();
            if (!t) return;
            takeUtterance(t);
            setTyped("");
          }}
          grading={screen === "grading"}
          onFinish={finish}
          oops={oops}
        />
      )}

      {screen === "results" && map && (
        <div className="pt-14">
          <div className="mx-auto mb-6 h-105 w-full max-w-2xl px-6">
            <ConstellationMap
              nodes={placed}
              coverage={coverage}
              verdicts={verdictById}
              justLit={null}
            />
          </div>
          <SessionResults
            topic={map.topic}
            headline={headline}
            concepts={map.concepts}
            grades={grades}
            deltas={deltas}
            onAgain={() => reset(true)}
            onNewTopic={() => reset(false)}
          />
        </div>
      )}
    </main>
  );
}

/* ================= home ================= */

function HomeScreen({
  topic,
  setTopic,
  onGo,
  oops,
}: {
  topic: string;
  setTopic: (t: string) => void;
  onGo: (t: string) => void;
  oops: string | null;
}) {
  const [shelf, setShelf] = useState<
    Array<{ topic: string; avg: number; weakest: string; dueNow: number; nextDue: number }>
  >([]);
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    const book = loadMastery();
    const sessions = loadSessions();
    setSessionCount(sessions.length);
    const now = Date.now();

    const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const nameOf = new Map<string, string>();
    for (const sess of sessions) nameOf.set(slug(sess.topic), sess.topic);

    const groups = new Map<string, { ps: number[]; weakest: string; weakestP: number; dueNow: number; nextDue: number }>();
    for (const [key, m] of Object.entries(book)) {
      const [topicSlug, labelSlug] = key.split("/");
      const g = groups.get(topicSlug) ?? { ps: [], weakest: "", weakestP: 2, dueNow: 0, nextDue: Infinity };
      g.ps.push(m.pKnown);
      if (m.pKnown < g.weakestP) {
        g.weakestP = m.pKnown;
        g.weakest = labelSlug.replace(/-/g, " ");
      }
      if (m.dueAt <= now) g.dueNow += 1;
      g.nextDue = Math.min(g.nextDue, m.dueAt);
      groups.set(topicSlug, g);
    }

    const items = [...groups.entries()]
      .map(([topicSlug, g]) => ({
        topic: nameOf.get(topicSlug) ?? topicSlug.replace(/-/g, " "),
        avg: g.ps.reduce((a, b) => a + b, 0) / g.ps.length,
        weakest: g.weakest,
        dueNow: g.dueNow,
        nextDue: g.nextDue,
      }))
      .sort((a, b) => b.dueNow - a.dueNow || a.avg - b.avg)
      .slice(0, 5);
    setShelf(items);
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-16">
      <div className="rise">
        <p className="text-xs tracking-[0.28em] uppercase text-ink-faint">Aloud</p>
        <h1
          className="mt-4 text-5xl leading-[1.08] sm:text-6xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          If you can’t explain it,
          <br />
          <span className="text-lit">you don’t know it yet.</span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft">
          Pick something you’re studying. Aloud maps every idea a real explanation would need,
          then you teach it — out loud, from memory. The map lights up where your explanation
          holds and stays dark where it doesn’t.
        </p>
      </div>

      <form
        className="rise mt-10"
        style={{ animationDelay: "0.1s" }}
        onSubmit={(e) => {
          e.preventDefault();
          onGo(topic);
        }}
      >
        <div className="hairline flex items-center gap-2 rounded-2xl border bg-panel p-2 focus-within:border-lit/50">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What are you studying? e.g. the Krebs cycle"
            maxLength={160}
            className="w-full bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-ink-faint"
            aria-label="Topic to teach"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-lit px-5 py-2.5 text-sm font-semibold text-pitch transition hover:bg-lit-bright"
          >
            Map it
          </button>
        </div>
        {oops && <p className="mt-3 text-sm text-wrong">{oops}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onGo(s)}
              className="hairline rounded-full border px-3.5 py-1.5 text-xs text-ink-soft transition hover:border-lit/40 hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      {shelf.length > 0 && (
        <div className="rise mt-12" style={{ animationDelay: "0.18s" }}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-ink-soft">What you’ve been teaching</h2>
            <button
              onClick={() => {
                clearEverything();
                setShelf([]);
                setSessionCount(0);
              }}
              className="text-xs text-ink-faint transition hover:text-wrong"
            >
              clear history
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {shelf.map((d) => (
              <button
                key={d.topic}
                onClick={() => onGo(d.topic)}
                className="hairline group flex w-full items-center justify-between gap-4 rounded-xl border bg-panel px-4 py-3 text-left transition hover:border-lit/40"
              >
                <div className="min-w-0">
                  <span className="text-sm text-ink">{d.topic}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">
                    weakest: <span className="capitalize">{d.weakest}</span>
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-xs text-ink-soft">
                    {masteryLabel(d.avg)} · {Math.round(d.avg * 100)}%
                  </span>
                  <span className={`block text-xs ${d.dueNow > 0 ? "text-lit" : "text-ink-faint"}`}>
                    {d.dueNow > 0
                      ? `${d.dueNow} idea${d.dueNow === 1 ? "" : "s"} due now`
                      : `next due ${new Date(d.nextDue).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            {sessionCount} session{sessionCount === 1 ? "" : "s"} so far. Everything stays in your
            browser — nothing is uploaded anywhere.
          </p>
        </div>
      )}
    </div>
  );
}

/* ================= building ================= */

const BUILD_LINES = [
  "Working out what a full explanation needs…",
  "Splitting it into ideas you can actually say…",
  "Wiring up which ideas lean on which…",
  "Placing the constellation…",
];

function BuildingScreen({ topic }: { topic: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, BUILD_LINES.length - 1)), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="breathe h-3 w-3 rounded-full bg-lit" />
      <p className="mt-6 text-lg text-ink-soft">{BUILD_LINES[i]}</p>
      <p className="mt-2 text-sm text-ink-faint">{topic}</p>
    </div>
  );
}

/* ================= teach ================= */

function TeachScreen(props: {
  map: MapData;
  placed: Placed[];
  coverage: Record<string, number>;
  justLit: string | null;
  question: { text: string; target: string } | null;
  dismissQuestion: () => void;
  lines: string[];
  interim: string;
  listening: boolean;
  micSupported: boolean;
  micError: string | null;
  onMic: () => void;
  typing: boolean;
  setTyping: (b: boolean) => void;
  typed: string;
  setTyped: (s: string) => void;
  onTypedSubmit: () => void;
  grading: boolean;
  onFinish: () => void;
  oops: string | null;
}) {
  const {
    map, placed, coverage, justLit, question, dismissQuestion, lines, interim,
    listening, micSupported, micError, onMic, typing, setTyping, typed, setTyped,
    onTypedSubmit, grading, onFinish, oops,
  } = props;

  const litCount = map.concepts.filter((c) => (coverage[c.id] ?? 0) > 0.5).length;
  const wordCount = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, interim]);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:flex-row lg:overflow-hidden">
      {/* -------- map side -------- */}
      <div className="relative flex-1 lg:h-full">
        <div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between px-6 pt-5">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-ink-faint">Teaching</p>
            <p className="mt-1 text-lg" style={{ fontFamily: "var(--font-display)" }}>
              {map.topic}
            </p>
          </div>
          <p className="text-right text-xs text-ink-faint">
            {litCount} of {map.concepts.length} lit
            <br />
            {wordCount} words
          </p>
        </div>
        <div className="mx-auto h-[42vh] max-w-175 pt-14 sm:h-[56vh] lg:h-full lg:pt-8">
          <ConstellationMap
            nodes={placed}
            coverage={coverage}
            probing={question?.target ?? null}
            justLit={justLit}
            dimmed={grading}
          />
        </div>

        {question && (
          <div className="slide-in absolute right-4 bottom-4 left-4 z-20 mx-auto max-w-md">
            <div className="rounded-2xl border border-lit/30 bg-panel-lift p-4 shadow-2xl shadow-black/50">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lit/15 text-sm">
                  🙋
                </div>
                <div className="min-w-0">
                  <p className="text-xs tracking-wide text-ink-faint uppercase">
                    Your classmate is confused
                  </p>
                  <p className="mt-1 text-[15px] leading-snug text-ink">{question.text}</p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={dismissQuestion}
                  className="rounded-full px-3 py-1 text-xs text-ink-faint transition hover:text-ink"
                >
                  Keep talking — I’ll answer it
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* -------- talk side -------- */}
      <div className="hairline flex w-full flex-col border-t bg-slate-deep lg:h-full lg:w-95 lg:border-t-0 lg:border-l">
        <div
          ref={feedRef}
          className="thin-scroll max-h-56 min-h-32 flex-1 space-y-3 overflow-y-auto p-5 lg:max-h-none"
        >
          {lines.length === 0 && !interim && (
            <div className="pt-4 text-sm leading-relaxed text-ink-faint">
              <p>Teach it like you’re explaining to a friend who missed class.</p>
              <p className="mt-3">
                Start anywhere. Say <em>why</em> things happen, not just their names — the map can
                tell the difference.
              </p>
            </div>
          )}
          {lines.map((l, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink-soft">
              {l}
            </p>
          ))}
          {interim && <p className="text-sm leading-relaxed text-ink-faint italic">{interim}…</p>}
        </div>

        {(micError || oops) && (
          <p className="px-5 pb-2 text-xs text-wrong">{micError ?? oops}</p>
        )}

        <div className="hairline border-t p-4">
          {typing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onTypedSubmit();
              }}
              className="space-y-2"
            >
              <textarea
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onTypedSubmit();
                  }
                }}
                placeholder="Type your explanation, a thought at a time…"
                rows={3}
                autoFocus
                className="hairline thin-scroll w-full resize-none rounded-xl border bg-panel p-3 text-sm outline-none focus:border-lit/50"
              />
              <div className="flex items-center justify-between gap-2">
                {micSupported ? (
                  <button
                    type="button"
                    onClick={() => setTyping(false)}
                    className="text-xs text-ink-faint transition hover:text-ink"
                  >
                    ← back to voice
                  </button>
                ) : (
                  <span className="text-xs text-ink-faint">no mic in this browser</span>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="rounded-full bg-lit px-4 py-1.5 text-xs font-semibold text-pitch hover:bg-lit-bright"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={onFinish}
                    disabled={grading || wordCount < 12}
                    title={wordCount < 12 ? "Say a bit more first" : undefined}
                    className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-pitch transition hover:bg-lit disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {grading ? "Grading…" : "I’m done"}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={onMic}
                disabled={!micSupported}
                className={`relative flex h-13 w-13 shrink-0 items-center justify-center rounded-full transition ${
                  listening
                    ? "bg-lit text-pitch"
                    : "hairline border bg-panel text-ink-soft hover:text-ink"
                } ${!micSupported ? "cursor-not-allowed opacity-40" : ""}`}
                aria-label={listening ? "Stop the microphone" : "Start the microphone"}
              >
                {listening && (
                  <span className="breathe absolute inset-0 rounded-full border-2 border-lit" />
                )}
                <MicIcon />
              </button>
              <div className="min-w-0 flex-1 text-xs leading-snug text-ink-faint">
                {listening ? (
                  <span className="text-ink-soft">Listening. Take your time.</span>
                ) : micSupported ? (
                  "Tap the mic and start teaching."
                ) : (
                  "This browser has no speech recognition — Chrome and Edge do."
                )}
                <button
                  onClick={() => setTyping(true)}
                  className="mt-0.5 block text-left text-xs text-ink-faint underline decoration-hairline underline-offset-2 transition hover:text-ink"
                >
                  or type instead
                </button>
              </div>
              <button
                onClick={onFinish}
                disabled={grading || wordCount < 12}
                title={wordCount < 12 ? "Say a bit more first" : undefined}
                className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-pitch transition hover:bg-lit disabled:cursor-not-allowed disabled:opacity-30"
              >
                {grading ? "Grading…" : "I’m done"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}
