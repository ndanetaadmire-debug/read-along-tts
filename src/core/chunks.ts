import type { ReadingDocument } from "./document";

/**
 * A piece of text handed to the speech engine in one utterance.
 * Browsers misbehave with long utterances (Chrome has been known to stop
 * after roughly 15 seconds, and some engines drop boundary events), so the
 * document is spoken in sentence-aligned chunks of bounded length.
 */
export interface Chunk {
  readonly text: string;
  /** Offset of `text` in the document, used to map boundary charIndex back. */
  readonly offset: number;
  readonly firstWord: number;
  /** Exclusive. */
  readonly lastWord: number;
}

export const MAX_CHUNK_CHARS = 220;

/**
 * Builds chunks starting at `fromWord`. The first chunk starts mid-sentence
 * if needed (resume or seek); later chunks start on sentence boundaries.
 * A single sentence longer than the limit is split at word boundaries.
 */
export function buildChunks(doc: ReadingDocument, fromWord = 0, maxChars = MAX_CHUNK_CHARS): Chunk[] {
  const chunks: Chunk[] = [];
  const { words, text } = doc;
  let i = Math.max(0, fromWord);
  while (i < words.length) {
    const startWord = i;
    const startChar = words[i]!.start;
    // Take whole sentences (the first may be partial when resuming mid-sentence) while they fit.
    let endWord = startWord;
    while (endWord < words.length) {
      const sentenceEnd = doc.sentences[words[endWord]!.sentence]!.lastWord;
      if (words[sentenceEnd - 1]!.end - startChar > maxChars) break;
      endWord = sentenceEnd;
    }
    // A sentence longer than the limit on its own: take as many of its words as fit.
    if (endWord === startWord) {
      endWord = startWord + 1;
      while (
        endWord < words.length &&
        words[endWord]!.sentence === words[startWord]!.sentence &&
        words[endWord]!.end - startChar <= maxChars
      ) {
        endWord += 1;
      }
    }
    const endChar = words[endWord - 1]!.end;
    // Include trailing punctuation so the voice gets the right intonation.
    const tail = text.slice(endChar).match(/^[.!?…,;:"'”’)\]]*/)?.[0] ?? "";
    chunks.push({ text: text.slice(startChar, endChar + tail.length), offset: startChar, firstWord: startWord, lastWord: endWord });
    i = endWord;
  }
  return chunks;
}
