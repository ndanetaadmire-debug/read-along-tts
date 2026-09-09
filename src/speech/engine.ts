/** What the reader needs from a speech engine. The browser adapter and the test fake both implement it. */
export interface UtteranceRequest {
  readonly text: string;
  readonly rate: number;
  readonly voiceURI: string | null;
  readonly onStart: () => void;
  /** charIndex is relative to `text`. */
  readonly onBoundary: (charIndex: number) => void;
  readonly onEnd: () => void;
  readonly onError: (error: string) => void;
}

export interface VoiceInfo {
  readonly uri: string;
  readonly name: string;
  readonly lang: string;
  readonly isDefault: boolean;
}

export interface SpeechEngine {
  speak(request: UtteranceRequest): void;
  cancel(): void;
  voices(): VoiceInfo[];
  /** Voices load asynchronously in most browsers. Returns an unsubscribe function. */
  onVoicesChanged(listener: () => void): () => void;
}

/** Errors the browser reports when *we* cancel an utterance. Not real failures. */
export const BENIGN_ERRORS = new Set(["interrupted", "canceled"]);

export function createWebSpeechEngine(synth: SpeechSynthesis = window.speechSynthesis): SpeechEngine {
  return {
    speak(req) {
      const u = new SpeechSynthesisUtterance(req.text);
      u.rate = req.rate;
      const voice = req.voiceURI ? synth.getVoices().find((v) => v.voiceURI === req.voiceURI) : undefined;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.onstart = () => req.onStart();
      u.onboundary = (e) => {
        if (e.name === "word" || e.name === undefined) req.onBoundary(e.charIndex);
      };
      u.onend = () => req.onEnd();
      u.onerror = (e) => req.onError(e.error);
      synth.speak(u);
    },
    cancel() {
      synth.cancel();
    },
    voices() {
      return synth.getVoices().map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang, isDefault: v.default }));
    },
    onVoicesChanged(listener) {
      synth.addEventListener("voiceschanged", listener);
      return () => synth.removeEventListener("voiceschanged", listener);
    },
  };
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}
