import { describe, expect, it } from "vitest";
import { buildChunks } from "../src/core/chunks";
import { parseDocument, secondsRemaining, wordAt } from "../src/core/document";
import { BOUNDARY_GRACE_MS, clampRate, Player } from "../src/core/player";
import { FakeEngine, ManualScheduler } from "./fakes";

const TEXT = "The cat sat. Dr. Who arrived at 9 a.m. on Monday! Did it work? Yes.";

describe("parseDocument", () => {
  const doc = parseDocument(TEXT);

  it("finds words with offsets that point back into the text", () => {
    for (const w of doc.words) expect(TEXT.slice(w.start, w.end)).toBe(w.text);
    expect(doc.words.slice(0, 3).map((w) => w.text)).toEqual(["The", "cat", "sat"]);
  });

  it("splits sentences without breaking on abbreviations or initials", () => {
    const sentences = doc.sentences.map((s) => TEXT.slice(s.start, s.end));
    expect(sentences).toEqual(["The cat sat", "Dr. Who arrived at 9 a.m. on Monday", "Did it work", "Yes"]);
  });

  it("treats a blank line as a sentence break even without punctuation", () => {
    expect(parseDocument("A heading\n\nBody text here.").sentences).toHaveLength(2);
  });

  it("handles empty and whitespace-only text", () => {
    expect(parseDocument("   \n ").words).toEqual([]);
    expect(parseDocument("").sentences).toEqual([]);
  });

  it("maps any character offset to a word", () => {
    expect(doc.words[wordAt(doc, 0)]!.text).toBe("The");
    expect(doc.words[wordAt(doc, 3)]!.text).toBe("cat"); // whitespace -> next word
    expect(doc.words[wordAt(doc, 5)]!.text).toBe("cat");
    expect(wordAt(parseDocument(""), 0)).toBe(-1);
  });

  it("estimates time remaining from speaking rate", () => {
    const long = parseDocument("word ".repeat(340));
    expect(secondsRemaining(long, 0, 1)).toBe(120);
    expect(secondsRemaining(long, 0, 2)).toBe(60);
    expect(secondsRemaining(long, 170, 1)).toBe(60);
  });
});

describe("buildChunks", () => {
  it("keeps whole sentences together within the length limit", () => {
    const doc = parseDocument(TEXT);
    const chunks = buildChunks(doc, 0, 40);
    expect(chunks.map((c) => c.text)).toEqual(["The cat sat.", "Dr. Who arrived at 9 a.m. on Monday!", "Did it work? Yes."]);
    for (const c of chunks) expect(doc.text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });

  it("covers every word exactly once, in order", () => {
    const doc = parseDocument(`${"Short one. ".repeat(40)}${"word ".repeat(120)}end.`);
    const chunks = buildChunks(doc, 0, 80);
    const covered = chunks.flatMap((c) => Array.from({ length: c.lastWord - c.firstWord }, (_, i) => c.firstWord + i));
    expect(covered).toEqual(doc.words.map((w) => w.index));
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(81); // + trailing punctuation
  });

  it("splits a sentence that is too long by itself at word boundaries", () => {
    const doc = parseDocument(`${"alpha ".repeat(60).trim()}.`);
    const chunks = buildChunks(doc, 0, 50);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => !/\S$/.test(c.text) || /alpha\.?$/.test(c.text))).toBe(true);
  });

  it("starts mid-sentence when resuming", () => {
    const doc = parseDocument(TEXT);
    expect(buildChunks(doc, 1, 40)[0]!.text).toBe("cat sat.");
  });
});

describe("Player", () => {
  function setup(text = TEXT) {
    const engine = new FakeEngine();
    const scheduler = new ManualScheduler();
    const doc = parseDocument(text);
    const player = new Player(doc, engine, scheduler);
    return { engine, scheduler, doc, player };
  }

  it("highlights words from boundary events and moves through chunks to the end", () => {
    const { engine, player, doc } = setup();
    const seen: number[] = [];
    player.subscribe((s) => seen.push(s.word));
    player.play();
    engine.speakAllWords();
    expect(player.getState().word).toBe(2); // "sat"
    engine.finish();
    expect(engine.spoken).toHaveLength(2);
    engine.speakAllWords();
    engine.finish();
    expect(player.getState()).toMatchObject({ status: "ended", word: doc.words.length - 1 });
    expect(seen).toEqual([...seen].sort((a, b) => a - b)); // never moved backwards
  });

  it("ignores the stale end and error events a cancelled utterance fires", () => {
    const { engine, player } = setup();
    player.play();
    engine.speakAllWords();
    player.pause(); // FakeEngine.cancel fires "interrupted" and end on the old utterance
    expect(player.getState()).toMatchObject({ status: "paused", word: 2, error: null });
    expect(engine.spoken).toHaveLength(1); // did not jump to the next chunk
  });

  it("resumes from the paused word with a fresh utterance", () => {
    const { engine, player } = setup();
    player.play();
    engine.current.onStart();
    engine.current.onBoundary(4); // "cat"
    player.pause();
    player.play();
    expect(engine.current.text.startsWith("cat sat.")).toBe(true);
  });

  it("restarts from the current word when the speed changes mid-sentence", () => {
    const { engine, player } = setup();
    player.play();
    engine.current.onStart();
    engine.current.onBoundary(4);
    player.setRate(1.8);
    expect(engine.current).toMatchObject({ rate: 1.75 });
    expect(engine.current.text.startsWith("cat")).toBe(true);
  });

  it("skips by sentence, going to the start of the current sentence first", () => {
    const { player, doc } = setup();
    player.seek(5); // inside sentence 2
    player.skipSentence(-1);
    expect(player.getState().word).toBe(doc.sentences[1]!.firstWord);
    player.skipSentence(-1);
    expect(player.getState().word).toBe(0);
    player.skipSentence(1);
    player.skipSentence(1);
    expect(player.getState().word).toBe(doc.sentences[2]!.firstWord);
    player.skipSentence(99);
    expect(player.getState().word).toBe(doc.sentences.at(-1)!.firstWord);
  });

  it("falls back to estimated highlighting when the voice sends no boundaries", () => {
    const { engine, player, scheduler } = setup("one two three four five six seven eight nine ten.");
    player.play();
    engine.current.onStart();
    scheduler.advance(BOUNDARY_GRACE_MS - 1);
    expect(player.getState().sync).toBe("boundary");
    scheduler.advance(1);
    expect(player.getState().sync).toBe("estimated");
    scheduler.advance(2_000);
    expect(player.getState().word).toBeGreaterThan(3);
  });

  it("switches back to real boundaries if they start arriving", () => {
    const { engine, player, scheduler } = setup("one two three four five six seven eight nine ten.");
    player.play();
    engine.current.onStart();
    scheduler.advance(BOUNDARY_GRACE_MS);
    engine.current.onBoundary(engine.current.text.indexOf("nine"));
    expect(player.getState()).toMatchObject({ sync: "boundary", word: 8 });
  });

  it("stops estimating when paused", () => {
    const { engine, player, scheduler } = setup("one two three four five six seven eight nine ten.");
    player.play();
    engine.current.onStart();
    scheduler.advance(BOUNDARY_GRACE_MS + 300);
    player.pause();
    const word = player.getState().word;
    scheduler.advance(10_000);
    expect(player.getState().word).toBe(word);
  });

  it("surfaces real engine errors and stays put", () => {
    const { engine, player } = setup();
    player.play();
    engine.current.onError("synthesis-failed");
    expect(player.getState()).toMatchObject({ status: "paused", error: "Speech stopped: synthesis-failed" });
  });

  it("replays from the start after finishing", () => {
    const { engine, player } = setup("Just one sentence.");
    player.play();
    engine.speakAllWords();
    engine.finish();
    expect(player.getState().status).toBe("ended");
    player.play();
    expect(engine.current.text).toBe("Just one sentence.");
  });

  it("does nothing for an empty document and clamps rate input", () => {
    const { engine, player } = setup("");
    player.play();
    expect(engine.spoken).toHaveLength(0);
    expect([clampRate(0.1), clampRate(9), clampRate(1.13), clampRate(Number.NaN)]).toEqual([0.5, 3, 1.25, 1]);
  });
});
