/**
 * The width below which the tab shows one pane at a time, and what each pane shows. At and above NARROW_PX the list and
 * the detail sit side by side, as they always have. The list column never shrinks below 280 px, so at 640 px the detail
 * keeps 360 px, the least a conversation reads well in. Every phone the tab will run on (360 to 430 px) is narrow.
 */
export const NARROW_PX = 640;

export const isNarrow = (width: number) => width < NARROW_PX;

export interface Panes {
  /** Hidden keeps the list mounted but out of sight, so its scroll position survives opening an item. */
  list: "shown" | "hidden";
  /** The detail; the wide layout's hint when nothing is open; or nothing, at narrow width, where the list stands alone. */
  second: "detail" | "hint" | "none";
}

/**
 * `selected` is whether an item is highlighted in the list. `open` is whether its detail is open at narrow width: Back
 * closes it and leaves the highlight, so the list comes back as it was.
 */
export function panesFor({ narrow, selected, open }: { narrow: boolean; selected: boolean; open: boolean }): Panes {
  const detail = selected && (!narrow || open);
  return {
    list: narrow && detail ? "hidden" : "shown",
    second: detail ? "detail" : narrow ? "none" : "hint",
  };
}

/** What Back, and Escape, do. Narrow: the list comes back with the item still highlighted. Wide: there is no list to come back to, so the item is let go. */
export const afterBack = (narrow: boolean): "keep-highlight" | "deselect" => (narrow ? "keep-highlight" : "deselect");
