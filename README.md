# Read along: text-to-speech with word highlighting

[![CI](https://github.com/ndanetaadmire-debug/speechify-assessment/actions/workflows/ci.yml/badge.svg)](https://github.com/ndanetaadmire-debug/speechify-assessment/actions/workflows/ci.yml)

Paste any text, press play, and each word is highlighted as it's spoken. Click a word to jump to it, use the arrow keys to move by sentence, change the speed while it's playing, and pick up where you left off next time.

It's built with React 19 and TypeScript on the browser's Web Speech API, with no backend and no tracking.

## The hard parts

The Web Speech API looks simple, but a reliable read-along player has to work around several browser behaviours. Each of these is handled in [`src/core/player.ts`](src/core/player.ts) and covered by a test:

| Problem | What the player does |
|---|---|
| `cancel()` fires `end` and an "interrupted" error on the utterance it cancels, so a naive player jumps ahead on every pause or seek | Every utterance carries the *generation* it was started in, and events from an older generation are ignored |
| `speechSynthesis.pause()` is unreliable: it does nothing on some Android builds and can wedge Chrome | Pause cancels; play restarts from the highlighted word |
| Rate and voice can't change mid-utterance | Changing either while playing restarts from the current word |
| Long utterances stall: Chrome's network voices have gone silent after about 15 seconds | Text is spoken in sentence-aligned chunks of at most 220 characters. The first chunk is just the current sentence, so playback starts promptly |
| Some voices never send word `boundary` events | If none arrive within 600 ms, the highlight follows an estimated pace and shows an "estimated sync" badge. It switches back the moment real boundaries arrive |
| Sentence splitting on full stops breaks on "Dr.", "e.g." and "9 a.m." | Abbreviation list, single initials and dotted initialisms; a blank line always ends a sentence |

## Features

- Word and sentence highlighting, with smooth auto-scroll while playing
- Click any word to start reading from it
- Keyboard: <kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> previous/next sentence (back restarts the current sentence first)
- Speed 0.5× to 3× in 0.25 steps, and English voice selection
- Time remaining and a progress bar
- Text, position, speed and voice remembered in `localStorage`, which is guarded so private mode or a full quota just means starting fresh
- Long documents stay smooth: each sentence is memoised, so only the active sentence re-renders as the highlight moves
- A clear message in browsers without speech synthesis

## Structure

```
src/core/
  document.ts   words and sentences with character offsets; wordAt() binary search; time remaining
  chunks.ts     sentence-aligned chunks that cover every word exactly once
  player.ts     playback state machine over a SpeechEngine port
src/speech/
  engine.ts     SpeechEngine port and the Web Speech adapter
src/ui/         App, Controls, Reader, storage, usePlayer (useSyncExternalStore)
test/           FakeEngine that behaves like real browsers on cancel(); manual scheduler for timing
```

The player depends only on the `SpeechEngine` interface and an injectable scheduler. The tests drive it with a fake engine that, like real browsers, fires "interrupted" and `end` when cancelled, and with a clock they advance by hand. So every timing behaviour is tested deterministically, without a browser or real waits.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # 30 tests: segmentation, chunking, player state machine, UI
npm run build
```

## Limits

- Voices and quality depend on the browser and operating system.
- A sentence that really does end in an initialism ("…at 9 a.m. Then…") is joined to the next one. That's the trade-off for not splitting "9 a.m. on Monday".
- Estimated sync is approximate by design. It keeps the highlight close, not exact.

## License

MIT © Admire T. Ndaneta
