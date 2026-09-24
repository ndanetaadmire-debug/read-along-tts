import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDocument, secondsRemaining } from "../core/document";
import { Player } from "../core/player";
import { createWebSpeechEngine, speechSupported, type SpeechEngine, type VoiceInfo } from "../speech/engine";
import { Controls } from "./Controls";
import { Reader } from "./Reader";
import { load, save } from "./storage";
import { usePlayerState } from "./usePlayer";

export const SAMPLE = `Listening while you read helps many people stay focused. Paste any article, email or chapter, press play, and each word is highlighted as it's spoken.

Click a word to jump there. Use the arrow keys to move between sentences, and the space bar to pause. Dr. Smith's notes, e.g. abbreviations like these, stay in one sentence.

Speed goes from half speed to three times normal, and your place is remembered next time you open the page.`;

export function App({ engine }: { engine?: SpeechEngine }) {
  const supported = engine !== undefined || speechSupported();
  const saved = useMemo(() => load(), []);
  const [text, setText] = useState(saved?.text ?? SAMPLE);
  const [editing, setEditing] = useState(false);
  const doc = useMemo(() => parseDocument(text), [text]);
  const [player] = useState(() =>
    supported
      ? new Player(parseDocument(saved?.text ?? SAMPLE), engine ?? createWebSpeechEngine(), undefined, saved ?? {})
      : null,
  );

  if (!player) {
    return (
      <main className="app">
        <h1>Read along</h1>
        <p role="alert">This browser doesn’t support speech synthesis. Try a recent Chrome, Edge, Safari or Firefox.</p>
      </main>
    );
  }
  return <Ready player={player} engine={engine} doc={doc} text={text} setText={setText} editing={editing} setEditing={setEditing} />;
}

function Ready({
  player,
  engine,
  doc,
  text,
  setText,
  editing,
  setEditing,
}: {
  player: Player;
  engine: SpeechEngine | undefined;
  doc: ReturnType<typeof parseDocument>;
  text: string;
  setText: (t: string) => void;
  editing: boolean;
  setEditing: (e: boolean) => void;
}) {
  const state = usePlayerState(player);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);

  useEffect(() => {
    const source = engine ?? createWebSpeechEngine();
    const refresh = () => setVoices(source.voices().filter((v) => v.lang.toLowerCase().startsWith("en")));
    refresh();
    return source.onVoicesChanged(refresh);
  }, [engine]);

  useEffect(() => () => player.dispose(), [player]);

  useEffect(() => {
    save({ text, word: state.word, rate: state.rate, voiceURI: state.voiceURI });
  }, [text, state.word, state.rate, state.voiceURI]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement | null)?.closest("input, select, textarea, button")) return;
      if (e.key === " ") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowRight") player.skipSentence(1);
      else if (e.key === "ArrowLeft") player.skipSentence(-1);
    },
    [editing, player],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const finishEditing = () => {
    player.load(parseDocument(text));
    setEditing(false);
  };

  return (
    <main className="app">
      <header>
        <h1>Read along</h1>
        <button type="button" onClick={() => (editing ? finishEditing() : (player.pause(), setEditing(true)))}>
          {editing ? "Done" : "Edit text"}
        </button>
      </header>
      {state.error ? <p role="alert" className="error">{state.error}</p> : null}
      {editing ? (
        <textarea aria-label="Text to read" value={text} onChange={(e) => setText(e.target.value)} rows={14} maxLength={200_000} />
      ) : doc.words.length === 0 ? (
        <p>Nothing to read yet. Choose “Edit text” and paste something.</p>
      ) : (
        <>
          <Controls
            state={state}
            voices={voices}
            secondsLeft={secondsRemaining(doc, state.word, state.rate)}
            progress={doc.words.length ? (state.word + 1) / doc.words.length : 0}
            onToggle={() => player.toggle()}
            onSkip={(d) => player.skipSentence(d)}
            onRate={(r) => player.setRate(r)}
            onVoice={(v) => player.setVoice(v)}
          />
          <Reader doc={doc} activeWord={state.word} playing={state.status === "playing"} onSeek={(w) => player.seek(w)} />
        </>
      )}
    </main>
  );
}
