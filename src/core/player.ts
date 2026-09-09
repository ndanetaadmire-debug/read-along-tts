import { buildChunks, MAX_CHUNK_CHARS, type Chunk } from "./chunks";
import { WORDS_PER_MINUTE_AT_1X, wordAt, type ReadingDocument } from "./document";
import { BENIGN_ERRORS, type SpeechEngine } from "../speech/engine";

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type Status = "idle" | "playing" | "paused" | "ended";

export interface PlayerState {
  readonly status: Status;
  /** The word being spoken, or where playback will start. */
  readonly word: number;
  readonly rate: number;
  readonly voiceURI: string | null;
  readonly error: string | null;
  /** "boundary": the voice reports word positions. "estimated": we're pacing the highlight ourselves. */
  readonly sync: "boundary" | "estimated";
}

export const RATE_LIMITS = { min: 0.5, max: 3, step: 0.25 } as const;
/** How long after an utterance starts we wait for a boundary event before estimating instead. */
export const BOUNDARY_GRACE_MS = 600;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  const stepped = Math.round(rate / RATE_LIMITS.step) * RATE_LIMITS.step;
  return Math.min(RATE_LIMITS.max, Math.max(RATE_LIMITS.min, stepped));
}

const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Read-along playback controller over a SpeechEngine.
 *
 * Browser quirks it handles:
 *  - cancel() makes the cancelled utterance fire "interrupted" and `end`.
 *    Every utterance carries the generation it was started in, so events
 *    from an older generation are ignored and a pause or seek never skips ahead.
 *  - speechSynthesis.pause() is unreliable (it does nothing on some Android
 *    builds and can wedge Chrome), so pause cancels and play restarts from
 *    the current word.
 *  - Rate and voice can't change mid-utterance, so changing either while
 *    playing restarts from the current word.
 *  - Some voices never fire boundary events. If none arrive within
 *    BOUNDARY_GRACE_MS, the highlight advances at an estimated pace, and
 *    switches back the moment real boundaries appear.
 *  - Long utterances stall in some browsers, so text goes out in chunks. The
 *    first chunk is only the current sentence, so playback starts promptly.
 */
export class Player {
  private chunks: Chunk[] = [];
  private chunkIndex = 0;
  private generation = 0;
  private timer: unknown = null;
  private readonly listeners = new Set<(s: PlayerState) => void>();
  private state: PlayerState;

  constructor(
    private doc: ReadingDocument,
    private readonly engine: SpeechEngine,
    private readonly scheduler: Scheduler = realScheduler,
    saved: { word?: number; rate?: number; voiceURI?: string | null } = {},
  ) {
    this.state = {
      status: "idle",
      word: this.clampWord(saved.word ?? 0),
      rate: clampRate(saved.rate ?? 1),
      voiceURI: saved.voiceURI ?? null,
      error: null,
      sync: "boundary",
    };
  }

  getState(): PlayerState {
    return this.state;
  }

  subscribe(listener: (s: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(doc: ReadingDocument): void {
    this.halt();
    this.doc = doc;
    this.set({ status: "idle", word: 0, error: null });
  }

  play(): void {
    if (this.doc.words.length === 0) return;
    const from = this.state.status === "ended" ? 0 : this.clampWord(this.state.word);
    this.startAt(from);
  }

  pause(): void {
    if (this.state.status !== "playing") return;
    this.halt();
    this.set({ status: "paused" });
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else this.play();
  }

  seek(word: number): void {
    const target = this.clampWord(word);
    if (this.state.status === "playing") this.startAt(target);
    else this.set({ word: target, status: this.state.status === "ended" ? "paused" : this.state.status });
  }

  /** Back goes to the start of the current sentence first, like a music player's back button. */
  skipSentence(delta: number): void {
    const { sentences, words } = this.doc;
    if (sentences.length === 0) return;
    const current = sentences[words[this.state.word]?.sentence ?? 0]!;
    const steps = delta < 0 && this.state.word > current.firstWord ? delta + 1 : delta;
    const target = Math.min(sentences.length - 1, Math.max(0, current.index + steps));
    this.seek(sentences[target]!.firstWord);
  }

  setRate(rate: number): void {
    this.set({ rate: clampRate(rate) });
    if (this.state.status === "playing") this.startAt(this.state.word);
  }

  setVoice(voiceURI: string | null): void {
    this.set({ voiceURI, sync: "boundary" });
    if (this.state.status === "playing") this.startAt(this.state.word);
  }

  dispose(): void {
    this.halt();
    this.listeners.clear();
  }

  // ---------- internals ----------

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private clampWord(word: number): number {
    return Math.min(Math.max(0, this.doc.words.length - 1), Math.max(0, Number.isInteger(word) ? word : 0));
  }

  private halt(): void {
    this.generation += 1;
    this.clearTimer();
    this.engine.cancel();
  }

  private startAt(word: number): void {
    this.halt();
    const { words, sentences } = this.doc;
    // First chunk: just the rest of the current sentence (split further if it's very long).
    const sentenceEnd = sentences[words[word]!.sentence]!.lastWord;
    const span = words[sentenceEnd - 1]!.end - words[word]!.start;
    const first = buildChunks(this.doc, word, Math.min(span, MAX_CHUNK_CHARS))[0]!;
    this.chunks = [first, ...buildChunks(this.doc, first.lastWord)];
    this.chunkIndex = 0;
    this.set({ status: "playing", word, error: null });
    this.speakCurrent();
  }

  private speakCurrent(): void {
    const chunk = this.chunks[this.chunkIndex]!;
    const gen = this.generation;
    const live = () => gen === this.generation;

    this.engine.speak({
      text: chunk.text,
      rate: this.state.rate,
      voiceURI: this.state.voiceURI,
      onStart: () => {
        if (!live()) return;
        this.clearTimer();
        this.timer = this.scheduler.setTimeout(() => {
          if (!live()) return;
          this.set({ sync: "estimated" });
          this.estimateFrom(this.state.word, chunk, gen);
        }, BOUNDARY_GRACE_MS);
      },
      onBoundary: (charIndex) => {
        if (!live()) return;
        this.clearTimer();
        const w = Math.min(chunk.lastWord - 1, Math.max(chunk.firstWord, wordAt(this.doc, chunk.offset + charIndex)));
        this.set({ sync: "boundary", ...(w > this.state.word ? { word: w } : {}) });
      },
      onEnd: () => {
        if (!live()) return; // stale: fired by cancel() during a pause or seek
        this.clearTimer();
        this.chunkIndex += 1;
        const next = this.chunks[this.chunkIndex];
        if (next) {
          this.set({ word: next.firstWord });
          this.speakCurrent();
        } else {
          this.set({ status: "ended", word: this.doc.words.length - 1 });
        }
      },
      onError: (error) => {
        if (!live() || BENIGN_ERRORS.has(error)) return;
        this.halt();
        this.set({ status: "paused", error: `Speech stopped: ${error}` });
      },
    });
  }

  /** Moves the highlight at the average speaking pace until the chunk's last word or a real boundary arrives. */
  private estimateFrom(word: number, chunk: Chunk, gen: number): void {
    const msPerWord = 60_000 / (WORDS_PER_MINUTE_AT_1X * this.state.rate);
    const step = (w: number) => {
      this.timer = this.scheduler.setTimeout(() => {
        if (gen !== this.generation || this.state.sync !== "estimated" || w >= chunk.lastWord) return;
        this.set({ word: w });
        step(w + 1);
      }, msPerWord);
    };
    step(Math.max(word + 1, chunk.firstWord));
  }

  private clearTimer(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }
}
