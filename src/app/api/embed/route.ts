import { NextResponse } from "next/server";
import { embedAll } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Vectors for whatever the learner just said. Scoring happens on the client. */
export async function POST(req: Request) {
  try {
    const { texts } = (await req.json()) as { texts?: string[] };
    const clean = (texts ?? [])
      .filter((t) => typeof t === "string" && t.trim().length > 0)
      .slice(0, 8)
      .map((t) => t.trim().slice(0, 1200));
    if (clean.length === 0) return NextResponse.json({ vectors: [] });
    return NextResponse.json({ vectors: await embedAll(clean) });
  } catch (err) {
    console.error("embed:", err);
    return NextResponse.json({ error: "Scoring hiccup." }, { status: 500 });
  }
}
