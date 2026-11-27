import { describe, expect, test } from "bun:test";
import { afterBack, isNarrow, NARROW_PX, panesFor } from "../view/layout.ts";

describe("the width that switches to one pane at a time", () => {
  test("phone widths are narrow, and side by side starts at 640 px", () => {
    expect([360, 390, 430, 639].map(isNarrow)).toEqual([true, true, true, true]);
    expect([640, 800, 1600].map(isNarrow)).toEqual([false, false, false]);
    expect(NARROW_PX).toBe(640);
  });
});

describe("which pane shows", () => {
  test("wide: the list beside the detail, or the hint when nothing is open", () => {
    expect(panesFor({ narrow: false, selected: false, open: false })).toEqual({ list: "shown", second: "hint" });
    expect(panesFor({ narrow: false, selected: true, open: true })).toEqual({ list: "shown", second: "detail" });
  });

  test("wide: an item is shown whether or not the detail was closed at narrow width, so widening never hides it", () => {
    expect(panesFor({ narrow: false, selected: true, open: false })).toEqual({ list: "shown", second: "detail" });
  });

  test("narrow with nothing selected: the list alone, with no hint", () => {
    expect(panesFor({ narrow: true, selected: false, open: false })).toEqual({ list: "shown", second: "none" });
  });

  test("narrow with an item highlighted but its detail closed: the list, still showing the highlight", () => {
    expect(panesFor({ narrow: true, selected: true, open: false })).toEqual({ list: "shown", second: "none" });
  });

  test("narrow with the detail open: the detail, and the list kept mounted but hidden", () => {
    expect(panesFor({ narrow: true, selected: true, open: true })).toEqual({ list: "hidden", second: "detail" });
  });
});

describe("back", () => {
  test("narrow: Back returns to the list and keeps the item highlighted", () => {
    expect(afterBack(true)).toBe("keep-highlight");
    expect(panesFor({ narrow: true, selected: true, open: false })).toEqual({ list: "shown", second: "none" });
  });

  test("wide: there is no list to return to, so the item is let go and the hint shows", () => {
    expect(afterBack(false)).toBe("deselect");
    expect(panesFor({ narrow: false, selected: false, open: false })).toEqual({ list: "shown", second: "hint" });
  });
});
