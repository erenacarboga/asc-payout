import { describe, expect, test } from "bun:test";
import { render } from "@inquirer/testing";
import { ask, BACK, menu, QUIT } from "../src/cli/prompts";

const items = [
  { label: "This month", value: "now", key: "t" },
  { label: "Last month", value: "last", hint: "October 2026" },
  { separator: "more" },
  { label: "History", value: "history", key: "h" },
  { label: "Locked", value: "locked", disabled: "needs a key" },
];

describe("menu", () => {
  test("arrow keys skip separators and disabled items, and wrap around", async () => {
    const { answer, events, getScreen } = await render(menu, { message: "Pick", items });
    expect(getScreen()).toContain("❯ t This month");
    events.keypress("down");
    events.keypress("down"); // over the separator to History
    expect(getScreen()).toContain("❯ h History");
    events.keypress("down"); // past "Locked" to "← Back"
    expect(getScreen()).toContain("❯   ← Back");
    events.keypress("down"); // wraps to the top
    events.keypress("enter");
    expect(await answer).toBe("now");
  });

  test("Esc and the Back entry go back", async () => {
    const esc = await render(menu, { message: "Pick", items });
    esc.events.keypress("escape");
    expect(await esc.answer).toBe(BACK);

    const entry = await render(menu, { message: "Pick", items });
    entry.events.keypress("up"); // from the first item up to "← Back"
    entry.events.keypress("enter");
    expect(await entry.answer).toBe(BACK);
  });

  test("shortcut letters pick directly; q quits only where allowed", async () => {
    const short = await render(menu, { message: "Pick", items });
    short.events.keypress("h");
    expect(await short.answer).toBe("history");

    const quit = await render(menu, { message: "Pick", items, quit: true });
    quit.events.keypress("q");
    expect(await quit.answer).toBe(QUIT);
  });

  test("starts on the given item and shows hints and help", async () => {
    const { events, answer, getScreen } = await render(menu, { message: "Pick", items, start: 1 });
    const screen = getScreen();
    expect(screen).toContain("❯   Last month");
    expect(screen).toContain("October 2026");
    expect(screen).toContain("needs a key");
    expect(screen).toContain("↑↓ move · enter select · esc back");
    events.keypress("enter");
    expect(await answer).toBe("last");
  });

  test("without back there is no Back entry and Esc does nothing", async () => {
    const { events, answer, getScreen } = await render(menu, { message: "Pick", items, back: false });
    expect(getScreen()).not.toContain("← Back");
    events.keypress("escape");
    events.keypress("enter");
    expect(await answer).toBe("now");
  });
});

describe("ask", () => {
  test("typed text, validated", async () => {
    const { answer, events, getScreen } = await render(ask, { message: "Vendor number", validate: (v: string) => (/^\d+$/.test(v) ? true : "Digits only") });
    events.type("12a");
    events.keypress("enter");
    expect(getScreen()).toContain("Digits only");
    events.keypress("backspace");
    events.keypress("enter");
    expect(await answer).toBe("12");
  });

  test("Enter on an empty line takes the default", async () => {
    const { answer, events } = await render(ask, { message: "Key ID", default: "ABCDE12345" });
    events.keypress("enter");
    expect(await answer).toBe("ABCDE12345");
  });

  test("prefilled value can be edited", async () => {
    const { answer, events } = await render(ask, { message: "Name", prefill: "Studio" });
    events.type(" X");
    events.keypress("enter");
    expect(await answer).toBe("Studio X");
  });

  test("Esc goes back", async () => {
    const { answer, events } = await render(ask, { message: "Name" });
    events.type("abc");
    events.keypress("escape");
    expect(await answer).toBe(BACK);
  });
});
