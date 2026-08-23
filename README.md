# Aloud

**If you can't explain it, you don't know it yet.**

Aloud is a study tool built around the protégé effect: the fastest way to find out what you actually understand is to try teaching it. You give it a topic, it builds a map of every idea a real explanation would need, and then you talk — out loud, from memory. The map lights up where your explanation holds and stays dark where it doesn't.

Live: **https://aloud-psi.vercel.app** (Chrome or Edge for the microphone; there's a typing mode for everything else)

## What actually happens when you talk

Three separate models are working while you speak, and each one is doing a different job:

1. **The map builder.** Gemini 3.5 Flash decomposes your topic into 8–11 concepts — mechanisms and causes, never vocabulary words — arranged in prerequisite tiers. Each concept carries a "bar to clear": what a spoken explanation has to contain before it counts.

2. **The live scorer.** Every sentence you say is embedded (gemini-embedding-001, 768 dims) and compared against every concept in the map. Raw cosine similarity is nearly useless here — off-topic chatter scores ~0.71 against a study map and real explanations ~0.85, so absolute thresholds break. Instead each sentence is scored by how far it stands out from the map's own mean, in standard deviations, with an absolute floor underneath (measured empirically; the constants and the measurements are in `src/lib/vector.ts`). Coverage saturates, so repeating a sentence doesn't farm the map, and reciting pizza opinions lights nothing.

3. **The classmate.** While you talk, the app watches for your darkest concept whose prerequisites you've already covered — the gap you're *ready* to be asked about — and an AI classmate (Flash Lite, for latency) interrupts with one pointed spoken-style question about it. It never lectures and never answers itself. It just asks the question a confused friend would ask.

When you finish, the full transcript is graded per concept into four verdicts — **explained**, **named** (you said the word but nothing under it), **missing**, and **misconceived** (you said something wrong; the grader quotes your own words back and corrects them). Misconceptions turn the node red. This distinction is the whole point: every study app can tell you what you skipped, but "you mentioned this without understanding it" and "you're confidently wrong about this" are the feedback that actually moves a grade.

## The memory model

Each verdict feeds a Bayesian Knowledge Tracing model (Corbett & Anderson, 1994) implemented from scratch in `src/lib/bkt.ts` — about forty lines of actual math, no library. BKT keeps a per-concept belief that you know the idea, updated with slip and guess probabilities tuned for spoken explanation rather than multiple choice. That belief drives spaced re-teaching: strong concepts get long intervals, shaky ones come back tomorrow. Everything is stored in your browser's localStorage. There are no accounts and nothing you say leaves the grading pipeline.

## Stack

- Next.js 16 (App Router) + React 19 + Tailwind 4, deployed on Vercel
- Gemini 3.5 Flash (map building, transcript grading), Flash Lite (classmate questions), gemini-embedding-001 (live scoring)
- Web Speech API for transcription — no audio is recorded or uploaded; recognition runs in the browser
- The constellation map is hand-rolled SVG: concentric prerequisite tiers, seat-assignment layout so nodes never collide, glow as the single visual channel for understanding

## Run it yourself

```bash
npm install
echo "GEMINI_API_KEY=your-key-here" > .env.local   # aistudio.google.com/apikey
npm run dev
```

## Repo map

```
src/lib/bkt.ts        Bayesian Knowledge Tracing — the math, from scratch
src/lib/vector.ts     live scoring: z-score credit assignment over embeddings
src/lib/layout.ts     tiered radial layout for the concept constellation
src/lib/speech.ts     Web Speech wrapper that survives Chrome's silence timeouts
src/app/api/map       topic → tiered concept map (+ embeddings)
src/app/api/embed     utterance embeddings for the live scorer
src/app/api/classmate the one-question classmate
src/app/api/grade     transcript → per-concept verdicts
```

Built solo for the Prometheus August AI Challenge, August 2026.
