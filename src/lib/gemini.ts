import "server-only";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Map building and grading want judgement, so they get the bigger model. */
export const CHAT_MODEL = "gemini-3.5-flash";
/** The classmate has to interrupt you before you have moved on, so it gets the fast one. */
export const QUICK_MODEL = "gemini-3.5-flash-lite";
export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMS = 768;

/**
 * Free-tier quota is tracked per model, so when one model's bucket runs dry
 * the request walks down a chain of equivalents instead of failing the user.
 */
const FALLBACKS: Record<string, string[]> = {
  [CHAT_MODEL]: ["gemini-flash-latest", "gemini-3.5-flash-lite"],
  [QUICK_MODEL]: ["gemini-flash-lite-latest", "gemini-flash-latest"],
};

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY is not set on the server.");
  return k;
}

type JsonSchema = Record<string, unknown>;

async function once(path: string, body: unknown, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text();
      const err = new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
      (err as Error & { status: number }).status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A 503 is momentary load and worth one more go on the same model. A 429 is
 * quota and retrying the same bucket is pointless, so it goes straight back to
 * the caller (which may have fallback models to walk).
 */
async function post(path: string, body: unknown, timeoutMs = 45_000) {
  try {
    return await once(path, body, timeoutMs);
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status !== 503) throw err;
    await new Promise((r) => setTimeout(r, 1200));
    return once(path, body, timeoutMs);
  }
}

/** Ask Gemini for a JSON object matching `schema`. */
export async function generateJson<T>(
  prompt: string,
  schema: JsonSchema,
  opts: { temperature?: number; system?: string; model?: string } = {},
): Promise<T> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: opts.temperature ?? 0.4,
    },
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  const primary = opts.model ?? CHAT_MODEL;
  const chain = [primary, ...(FALLBACKS[primary] ?? [])];
  let lastErr: unknown = null;

  for (const model of chain) {
    try {
      const data = await post(`models/${model}:generateContent`, body);
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .map((p: { text?: string }) => p.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error("Gemini returned an empty response.");
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
      const status = (err as Error & { status?: number }).status;
      // Quota gone, model overloaded, or model retired — the next bucket may
      // still be fine. Anything else is a real bug and should surface.
      if (status !== 429 && status !== 503 && status !== 404) throw err;
    }
  }
  throw lastErr;
}

function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

/**
 * Embed a batch of strings. Gemini's embedding endpoint only returns unit
 * vectors at full width, so anything truncated gets normalized here — cosine
 * similarity downstream assumes unit length.
 */
export async function embedAll(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const data = await post(`models/${EMBED_MODEL}:batchEmbedContents`, {
    requests: texts.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: EMBED_DIMS,
    })),
  });
  const out = (data?.embeddings ?? []) as Array<{ values: number[] }>;
  if (out.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${out.length}.`);
  }
  return out.map((e) => l2normalize(e.values));
}
