import type { Check, Detail, ListItem } from "./model.ts";
import { checkValues, fillTemplate, itemValues, NO_OVERRIDES, templateFor, workKind, type PromptOverrides } from "./prompts.ts";
import { repoLabel, type RepoRef } from "./remote.ts";

/** The agent's first message about an issue or PR: what it is, where it is, its state, and how to read more with gh. */
export const workText = (repo: RepoRef, item: ListItem, detail: Detail | null, overrides: PromptOverrides = NO_OVERRIDES) =>
  fillTemplate(templateFor(workKind(item), overrides), itemValues(repo, item, detail));

/** What goes in the composer: the item named the way GitHub links it, with its title. */
export const mentionText = (repo: RepoRef, item: ListItem) => `${repoLabel(repo)}#${item.number} ("${item.title}")`;

export const reviewText = (repo: RepoRef, item: ListItem, detail: Detail | null = null, overrides: PromptOverrides = NO_OVERRIDES) =>
  fillTemplate(templateFor("review", overrides), itemValues(repo, item, detail));

export const fixCheckText = (repo: RepoRef, item: ListItem, check: Check, overrides: PromptOverrides = NO_OVERRIDES) => fillTemplate(templateFor("fix-check", overrides), checkValues(repo, item, check));
