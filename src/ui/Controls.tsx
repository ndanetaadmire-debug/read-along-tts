import type { PlayerState } from "../core/player";
import { RATE_LIMITS } from "../core/player";
import type { VoiceInfo } from "../speech/engine";

interface Props {
  readonly state: PlayerState;
  readonly voices: readonly VoiceInfo[];
  readonly secondsLeft: number;
  readonly progress: number;
  readonly onToggle: () => void;
  readonly onSkip: (delta: number) => void;
  readonly onRate: (rate: number) => void;
  readonly onVoice: (uri: string | null) => void;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Controls({ state, voices, secondsLeft, progress, onToggle, onSkip, onRate, onVoice }: Props) {
  const playing = state.status === "playing";
  return (
    <div className="controls" role="toolbar" aria-label="Playback">
      <button type="button" onClick={() => onSkip(-1)} aria-label="Previous sentence" title="Previous sentence (←)">
        ⏮
      </button>
      <button type="button" className="primary" onClick={onToggle} aria-label={playing ? "Pause" : "Play"} title="Play or pause (Space)">
        {playing ? "⏸" : "▶"}
      </button>
      <button type="button" onClick={() => onSkip(1)} aria-label="Next sentence" title="Next sentence (→)">
        ⏭
      </button>
      <label className="rate">
        Speed <strong>{state.rate.toFixed(2)}×</strong>
        <input
          type="range"
          min={RATE_LIMITS.min}
          max={RATE_LIMITS.max}
          step={RATE_LIMITS.step}
          value={state.rate}
          onChange={(e) => onRate(Number(e.target.value))}
        />
      </label>
      {voices.length > 0 ? (
        <label>
          Voice{" "}
          <select value={state.voiceURI ?? ""} onChange={(e) => onVoice(e.target.value || null)}>
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.uri} value={v.uri}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="time" aria-label="Time remaining">
        {formatDuration(secondsLeft)} left
      </span>
      <progress max={1} value={progress} aria-label="Progress" />
      {state.sync === "estimated" ? (
        <span className="badge" title="This voice doesn't report word positions, so highlighting follows an estimated pace.">
          estimated sync
        </span>
      ) : null}
    </div>
  );
}
