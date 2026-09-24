import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App, SAMPLE } from "../src/ui/App";
import { load, save } from "../src/ui/storage";
import { FakeEngine } from "./fakes";

beforeEach(() => localStorage.clear());

describe("App", () => {
  it("renders the text as words and plays with highlighting", async () => {
    const engine = new FakeEngine();
    const user = userEvent.setup();
    render(<App engine={engine} />);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    act(() => {
      engine.current.onStart();
      engine.current.onBoundary(engine.current.text.indexOf("while"));
    });
    const current = document.querySelector("[aria-current='true']");
    expect(current).toHaveTextContent("while");
    expect(current?.closest(".sentence")).toHaveClass("active");
  });

  it("starts reading from a clicked word", async () => {
    const engine = new FakeEngine();
    const user = userEvent.setup();
    render(<App engine={engine} />);
    await user.click(screen.getByText("Paste"));
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(engine.current.text.startsWith("Paste any article")).toBe(true);
  });

  it("supports keyboard control", async () => {
    const engine = new FakeEngine();
    const user = userEvent.setup();
    render(<App engine={engine} />);
    await user.keyboard("{ArrowRight}");
    expect(document.querySelector("[aria-current='true']")).toHaveTextContent("Paste");
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("only lists English voices", () => {
    render(<App engine={new FakeEngine()} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["System default", "Leah (en-ZA)"]);
  });

  it("lets the user replace the text", async () => {
    const user = userEvent.setup();
    render(<App engine={new FakeEngine()} />);
    await user.click(screen.getByRole("button", { name: "Edit text" }));
    const box = screen.getByRole("textbox", { name: "Text to read" });
    await user.clear(box);
    await user.type(box, "Brand new words.");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Brand")).toBeInTheDocument();
    expect(load()?.text).toBe("Brand new words.");
  });

  it("remembers position and speed between visits", () => {
    save({ text: SAMPLE, word: 12, rate: 1.5, voiceURI: null });
    render(<App engine={new FakeEngine()} />);
    expect(screen.getByText("1.50×")).toBeInTheDocument();
    expect(document.querySelector("[aria-current='true']")?.getAttribute("data-word")).toBe("12");
  });

  it("explains when the browser has no speech support", () => {
    const original = window.speechSynthesis;
    // jsdom has no speechSynthesis, which is exactly the unsupported case.
    expect(original).toBeUndefined();
    render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent("doesn’t support speech synthesis");
  });
});

describe("storage", () => {
  it("survives storage that throws", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } } as unknown as Storage;
    expect(load(broken)).toBeNull();
    expect(() => save({ text: "x", word: 0, rate: 1, voiceURI: null }, broken)).not.toThrow();
  });

  it("ignores corrupt saved data", () => {
    localStorage.setItem("read-along:v1", "{not json");
    expect(load()).toBeNull();
    localStorage.setItem("read-along:v1", JSON.stringify({ text: 42 }));
    expect(load()).toBeNull();
  });
});
