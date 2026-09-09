import type { Scheduler } from "../src/core/player";
import type { SpeechEngine, UtteranceRequest, VoiceInfo } from "../src/speech/engine";

/**
 * Speech engine the test drives by hand. Like real browsers, cancel() makes
 * the cancelled utterance fire an "interrupted" error and then end, so the
 * tests prove stale events are ignored.
 */
export class FakeEngine implements SpeechEngine {
  readonly spoken: UtteranceRequest[] = [];
  cancels = 0;
  private live: UtteranceRequest | null = null;
  private voiceListeners = new Set<() => void>();
  voiceList: VoiceInfo[] = [
    { uri: "en-za-1", name: "Leah", lang: "en-ZA", isDefault: true },
    { uri: "fr-1", name: "Amélie", lang: "fr-FR", isDefault: false },
  ];

  speak(request: UtteranceRequest): void {
    this.spoken.push(request);
    this.live = request;
  }

  cancel(): void {
    this.cancels += 1;
    const old = this.live;
    this.live = null;
    old?.onError("interrupted");
    old?.onEnd();
  }

  voices(): VoiceInfo[] {
    return this.voiceList;
  }

  onVoicesChanged(listener: () => void): () => void {
    this.voiceListeners.add(listener);
    return () => this.voiceListeners.delete(listener);
  }

  get current(): UtteranceRequest {
    if (!this.live) throw new Error("nothing is being spoken");
    return this.live;
  }

  /** Starts the live utterance and reports a boundary for every word, like a well-behaved voice. */
  speakAllWords(): void {
    const u = this.current;
    u.onStart();
    for (const m of u.text.matchAll(/\S+/g)) u.onBoundary(m.index);
  }

  finish(): void {
    const u = this.current;
    this.live = null;
    u.onEnd();
  }
}

/** Timers the test advances explicitly. */
export class ManualScheduler implements Scheduler {
  private now = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, fn, id });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.now = next.at;
      next.fn();
    }
    this.now = end;
  }
}
