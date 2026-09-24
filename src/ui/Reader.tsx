import { memo, useEffect, useRef } from "react";
import type { ReadingDocument, Sentence } from "../core/document";

interface Props {
  readonly doc: ReadingDocument;
  readonly activeWord: number;
  readonly playing: boolean;
  readonly onSeek: (word: number) => void;
}

/**
 * Renders the text as clickable words. Only the sentence containing the
 * active word re-renders as playback moves (each sentence is memoised and
 * receives -1 unless it holds the active word), so long documents stay smooth.
 */
export function Reader({ doc, activeWord, playing, onSeek }: Props) {
  const activeSentence = doc.words[activeWord]?.sentence ?? -1;
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const el = container.current?.querySelector<HTMLElement>("[aria-current='true']");
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [activeWord, playing]);

  return (
    <div ref={container} className="reader" lang="en">
      {doc.sentences.map((s, i) => (
        <SentenceView
          key={s.index}
          doc={doc}
          sentence={s}
          gapBefore={doc.text.slice(i === 0 ? 0 : doc.sentences[i - 1]!.end, s.start)}
          activeWord={s.index === activeSentence ? activeWord : -1}
          onSeek={onSeek}
        />
      ))}
      {doc.text.slice(doc.sentences.at(-1)?.end ?? 0)}
    </div>
  );
}

const SentenceView = memo(function SentenceView({
  doc,
  sentence,
  gapBefore,
  activeWord,
  onSeek,
}: {
  doc: ReadingDocument;
  sentence: Sentence;
  gapBefore: string;
  activeWord: number;
  onSeek: (word: number) => void;
}) {
  const parts: React.ReactNode[] = [];
  for (let w = sentence.firstWord; w < sentence.lastWord; w++) {
    const word = doc.words[w]!;
    if (w > sentence.firstWord) parts.push(doc.text.slice(doc.words[w - 1]!.end, word.start));
    parts.push(
      <span
        key={w}
        className="word"
        data-word={w}
        aria-current={w === activeWord ? "true" : undefined}
        onClick={() => onSeek(w)}
      >
        {word.text}
      </span>,
    );
  }
  return (
    <>
      {gapBefore}
      <span className={activeWord >= 0 ? "sentence active" : "sentence"}>{parts}</span>
    </>
  );
});
