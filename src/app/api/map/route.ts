import { NextResponse } from "next/server";
import { generateJson, embedAll } from "@/lib/gemini";
import type { Concept } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = {
  type: "OBJECT",
  properties: {
    summary: {
      type: "STRING",
      description: "One plain sentence naming what the learner is about to explain.",
    },
    concepts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          label: { type: "STRING" },
          probe: { type: "STRING" },
          keyPoints: { type: "ARRAY", items: { type: "STRING" } },
          tier: { type: "INTEGER" },
          requires: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["id", "label", "probe", "keyPoints", "tier", "requires"],
      },
    },
  },
  required: ["summary", "concepts"],
};

const SYSTEM = `You break a subject into the ideas a person has to be able to say out loud before anyone would agree they understand it.

You are building the map for a high school or first-year college student.

Rules you do not break:
- Between 8 and 11 concepts. Fewer is better than padding with filler.
- Every concept is a mechanism, a relationship, or a cause — never a vocabulary word on its own. "Chlorophyll" is a bad concept. "Why chlorophyll absorbs some wavelengths and reflects green" is a good one.
- Tier 0 holds the three or four ideas that need nothing else to make sense. Tier 1 builds on tier 0. Tier 2 builds on tier 1. Never go past tier 2.
- "requires" lists ids from strictly lower tiers only. Tier 0 concepts require nothing.
- "probe" is one sentence saying what a complete spoken explanation of this idea has to contain. Write it as the bar to clear, not as the answer.
- "keyPoints" holds two or three specifics that separate someone who understands the idea from someone who has only heard the term. Be concrete — name the actual step, the actual quantity, the actual reason.
- ids are c1, c2, c3 and so on, in tier order.
- Labels are at most six words.`;

export async function POST(req: Request) {
  try {
    const { topic } = (await req.json()) as { topic?: string };
    const clean = (topic ?? "").trim().slice(0, 160);
    if (clean.length < 2) {
      return NextResponse.json({ error: "Give me a topic first." }, { status: 400 });
    }

    const result = await generateJson<{ summary: string; concepts: Concept[] }>(
      `Build the concept map for: ${clean}`,
      schema,
      { system: SYSTEM, temperature: 0.35 },
    );

    const concepts = (result.concepts ?? [])
      .slice(0, 12)
      .map((c, i) => ({
        ...c,
        id: c.id || `c${i + 1}`,
        tier: Math.max(0, Math.min(2, Number(c.tier) || 0)),
        keyPoints: (c.keyPoints ?? []).slice(0, 4),
        requires: c.requires ?? [],
      }));

    if (concepts.length < 4) {
      return NextResponse.json(
        { error: "That topic came back too thin to map. Try naming it more specifically." },
        { status: 422 },
      );
    }

    // Two concepts with the same label would collide in the mastery book, so
    // the later one gets a numeral.
    const labelCount = new Map<string, number>();
    for (const c of concepts) {
      const k = c.label.toLowerCase();
      const n = (labelCount.get(k) ?? 0) + 1;
      labelCount.set(k, n);
      if (n > 1) c.label = `${c.label} (${n})`;
    }

    // Drop dangling prerequisites so the graph never draws an edge to nowhere.
    const ids = new Set(concepts.map((c) => c.id));
    for (const c of concepts) c.requires = c.requires.filter((r) => ids.has(r) && r !== c.id);

    const vectors = await embedAll(
      concepts.map((c) => `${c.label}. ${c.probe} ${c.keyPoints.join(" ")}`),
    );

    return NextResponse.json({
      id: `m${Date.now().toString(36)}`,
      topic: clean,
      summary: result.summary ?? "",
      createdAt: Date.now(),
      concepts,
      vectors,
    });
  } catch (err) {
    console.error("map:", err);
    const msg =
      err instanceof Error && err.message.includes("GEMINI_API_KEY")
        ? "The server is missing its GEMINI_API_KEY."
        : "Could not build a map for that. Try again in a moment.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
