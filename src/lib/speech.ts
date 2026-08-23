"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
};

type Ctor = new () => SpeechRecognitionLike;

function ctor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Speech in, sentences out.
 *
 * Chrome ends a recognition session on its own after a stretch of quiet, which
 * would otherwise cut someone off mid-thought. The `wanted` ref is the source
 * of truth for whether the mic should be open, and `onend` restarts against it,
 * so the pause a person takes to think never ends their turn.
 */
export function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wanted = useRef(false);
  const lastFinal = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const interimRef = useRef("");
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => {
    const C = ctor();
    if (!C) return;
    setSupported(true);

    const rec = new C();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) {
          const trimmed = text.trim();
          // Some mobile engines re-deliver the same final result; an identical
          // sentence inside a couple of seconds is an echo, not a repeat.
          const now = Date.now();
          const echo =
            trimmed === lastFinal.current.text && now - lastFinal.current.at < 2500;
          if (trimmed && !echo) {
            lastFinal.current = { text: trimmed, at: now };
            finalRef.current(trimmed);
          }
        } else {
          live += text;
        }
      }
      interimRef.current = live;
      setInterim(live);
    };

    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wanted.current = false;
        setListening(false);
        setError("The browser blocked the microphone. Allow it, or switch to typing.");
        return;
      }
      setError("The microphone dropped out. Try again, or switch to typing.");
    };

    rec.onend = () => {
      interimRef.current = "";
      setInterim("");
      if (!wanted.current) {
        setListening(false);
        return;
      }
      try {
        rec.start();
      } catch {
        setListening(false);
        wanted.current = false;
      }
    };

    recRef.current = rec;
    return () => {
      wanted.current = false;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* already torn down */
      }
    };
  }, []);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec || wanted.current) return;
    setError(null);
    wanted.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      // Restarting while the old session is still winding down throws; the
      // pending onend sees `wanted` and brings the mic back up itself.
      setListening(true);
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    wanted.current = false;
    setListening(false);
    interimRef.current = "";
    setInterim("");
    try {
      rec?.stop();
    } catch {
      /* nothing open */
    }
  }, []);

  return { supported, listening, interim, interimRef, error, start, stop };
}
