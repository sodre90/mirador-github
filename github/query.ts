import type { ItemKind, SavedView } from "./model.ts";

/** A GitHub search query split into its words, quoted values kept whole. */
export function words(query: string): string[] {
  return query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

const qualifierOf = (word: string) => {
  const at = word.indexOf(":");
  return at > 0 ? { key: word.slice(0, at).toLowerCase(), value: word.slice(at + 1) } : null;
};

const unquoted = (value: string) => value.replace(/^"(.*)"$/, "$1");
const quotedIfSpaced = (value: string) => (/\s/.test(value) ? `"${value}"` : value);

/** The values the query gives a qualifier, e.g. every label:. */
export const valuesOf = (query: string, key: string): string[] =>
  words(query).flatMap((word) => {
    const qualifier = qualifierOf(word);
    return qualifier?.key === key ? [unquoted(qualifier.value)] : [];
  });

/** The query with the qualifier set to `values`, in place of what it had; the other words stay as they were, in order. */
export function withValues(query: string, key: string, values: string[]): string {
  const kept = words(query).filter((word) => qualifierOf(word)?.key !== key);
  return [...kept, ...values.map((value) => `${key}:${quotedIfSpaced(value)}`)].join(" ");
}

/** `is:` holds several things at once, open and draft say, so a chip changes only the ones it owns. */
export function withIs(query: string, owned: string[], value: string | null): string {
  const kept = words(query).filter((word) => {
    const qualifier = qualifierOf(word);
    return !(qualifier?.key === "is" && owned.includes(qualifier.value.toLowerCase()));
  });
  return [...kept, ...(value ? [`is:${value}`] : [])].join(" ");
}

export const isValue = (query: string, owned: string[]) => valuesOf(query, "is").map((value) => value.toLowerCase()).find((value) => owned.includes(value)) ?? null;

/** The words that aren't qualifiers: what the user searches the titles and bodies for. */
export const freeText = (query: string) =>
  words(query)
    .filter((word) => !qualifierOf(word))
    .join(" ");

export const STATE_VALUES: Record<ItemKind, string[]> = { pr: ["open", "closed", "merged"], issue: ["open", "closed"] };

export const SORTS = ["updated-desc", "created-desc", "comments-desc", "updated-asc", "created-asc"] as const;

export const CHECK_STATUSES = ["success", "failure", "pending"] as const;

/** The views every repository has, before any the user saved. */
export const BUILT_IN_VIEWS: Record<ItemKind, SavedView[]> = {
  pr: [
    { name: "Needs my review", query: "is:open review-requested:@me" },
    { name: "Mine", query: "is:open author:@me" },
    { name: "Assigned to me", query: "is:open assignee:@me" },
    { name: "All open", query: "is:open" },
    { name: "Failing checks", query: "is:open status:failure" },
  ],
  issue: [
    { name: "Assigned to me", query: "is:open assignee:@me" },
    { name: "Mine", query: "is:open author:@me" },
    { name: "Mentioned", query: "is:open mentions:@me" },
    { name: "All open", query: "is:open" },
    { name: "No assignee", query: "is:open no:assignee" },
  ],
};

export const DEFAULT_QUERY: Record<ItemKind, string> = { pr: "is:open", issue: "is:open" };

/** The same search, however its words were spaced or ordered. */
export const sameQuery = (a: string, b: string) => words(a).sort().join(" ").toLowerCase() === words(b).sort().join(" ").toLowerCase();
