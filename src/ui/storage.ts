/**
 * Remembers the text, position and speed between visits. Storage can be
 * unavailable (private mode, blocked cookies, quota), so every access is
 * guarded and a failure just means starting fresh.
 */
const KEY = "read-along:v1";

export interface Saved {
  readonly text: string;
  readonly word: number;
  readonly rate: number;
  readonly voiceURI: string | null;
}

export function load(storage: Storage | undefined = globalThis.localStorage): Saved | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved>;
    if (typeof v.text !== "string" || v.text.length > 200_000) return null;
    return {
      text: v.text,
      word: Number.isInteger(v.word) ? (v.word as number) : 0,
      rate: typeof v.rate === "number" ? v.rate : 1,
      voiceURI: typeof v.voiceURI === "string" ? v.voiceURI : null,
    };
  } catch {
    return null;
  }
}

export function save(value: Saved, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled: not worth interrupting the reader for.
  }
}
