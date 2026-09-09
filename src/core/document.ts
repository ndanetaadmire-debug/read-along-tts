/**
 * A text broken into words and sentences, with character offsets back into
 * the original string. Everything else (highlighting, seeking, chunking for
 * the speech engine) is built on these offsets.
 */
export interface Word {
  readonly index: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly sentence: number;
}

export interface Sentence {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly firstWord: number;
  /** Exclusive. */
  readonly lastWord: number;
}

export interface ReadingDocument {
  readonly text: string;
  readonly words: readonly Word[];
  readonly sentences: readonly Sentence[];
}

/** Abbreviations that end in a full stop but don't end a sentence. */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "e.g", "i.e", "no", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "inc", "ltd", "co"]);

function segmentWords(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const s of segmenter.segment(text)) {
      if (s.isWordLike) out.push({ text: s.segment, start: s.index, end: s.index + s.segment.length });
    }
    return out;
  }
  for (const m of text.matchAll(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Sentence ends: . ! ? (optionally followed by closing quotes or brackets)
 * then whitespace, unless the word before is a known abbreviation or a single
 * initial ("J. R. R. Tolkien") or a dotted initialism ("9 a.m."). Blank lines always end a sentence.
 */
function sentenceBreaks(text: string): number[] {
  const breaks: number[] = [];
  const re = /([.!?…]+)(["'”’)\]]*)(\s+)|\n\s*\n/g;
  for (const m of text.matchAll(re)) {
    if (m[1] === "." ) {
      const before = text.slice(0, m.index).match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase() ?? "";
      // Known abbreviations, single initials ("J."), and dotted initialisms ("a.m.", "U.S.", "e.g.").
      if (ABBREVIATIONS.has(before) || /^(?:\p{L}\.)*\p{L}$/u.test(before)) continue;
    }
    breaks.push(m.index + m[0].length);
  }
  return breaks;
}

export function parseDocument(text: string): ReadingDocument {
  const rawWords = segmentWords(text);
  const breaks = [...sentenceBreaks(text), Number.POSITIVE_INFINITY];
  const words: Word[] = [];
  const sentences: Sentence[] = [];
  let sentence = 0;
  let sentenceStartWord = 0;
  let b = 0;

  const closeSentence = (endWord: number) => {
    if (endWord > sentenceStartWord) {
      sentences.push({
        index: sentence,
        start: words[sentenceStartWord]!.start,
        end: words[endWord - 1]!.end,
        firstWord: sentenceStartWord,
        lastWord: endWord,
      });
      sentence += 1;
      sentenceStartWord = endWord;
    }
  };

  for (const w of rawWords) {
    while (w.start >= breaks[b]!) {
      closeSentence(words.length);
      b += 1;
    }
    words.push({ index: words.length, text: w.text, start: w.start, end: w.end, sentence });
  }
  closeSentence(words.length);
  return { text, words, sentences };
}

/** The word under a character offset, or the next word if the offset is in whitespace. */
export function wordAt(doc: ReadingDocument, charIndex: number): number {
  let lo = 0;
  let hi = doc.words.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (doc.words[mid]!.end <= charIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const WORDS_PER_MINUTE_AT_1X = 170;

export function secondsRemaining(doc: ReadingDocument, fromWord: number, rate: number): number {
  const remaining = Math.max(0, doc.words.length - Math.max(0, fromWord));
  return Math.round((remaining / (WORDS_PER_MINUTE_AT_1X * rate)) * 60);
}
