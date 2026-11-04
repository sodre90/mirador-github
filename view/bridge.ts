import { createContext, useContext } from "react";
import type { ItemKind, ListItem, TabAction, TabState } from "../github/model.ts";
import type { RepoRef } from "../github/remote.ts";
import type { PluginViewBridge } from "../mirador/api.ts";

declare global {
  interface Window {
    mirador: PluginViewBridge<TabState>;
  }
}

export const send = (action: TabAction) => window.mirador.send(action);

/** A sheet over the tab: a write to confirm, or a form that ends in one. */
export type Sheet =
  | { kind: "comment"; item: ListItem; closeToo?: boolean }
  | { kind: "review"; item: ListItem }
  | { kind: "merge"; item: ListItem }
  | { kind: "labels"; item: ListItem }
  | { kind: "assignees"; item: ListItem }
  | { kind: "set-state"; item: ListItem; open: boolean }
  | { kind: "ready"; item: ListItem; ready: boolean }
  | { kind: "checkout"; item: ListItem }
  | { kind: "new-issue" }
  | { kind: "save-view"; item: ItemKind; query: string }
  | { kind: "prompts" }
  | { kind: "edit-message"; messages: Message[] };

/** A message to the agent, filled in, and where it can go. */
export interface Message {
  label: string;
  text: string;
  sends: ("new" | "here")[];
}

/** What every part of the tab reaches: the host's state for the workspace, and the user's place in it. */
export interface Tab {
  state: TabState;
  repo: RepoRef;
  kind: ItemKind;
  query: string;
  setKind(kind: ItemKind): void;
  /** Runs the query: the list comes for it. */
  search(query: string): void;
  selected: ListItem | null;
  select(item: ListItem | null): void;
  /** Opens an item by its number, as a link to it does, even one in no list. */
  openNumber(kind: ItemKind, number: number): void;
  showSheet(sheet: Sheet | null): void;
  /** A short message at the bottom of the tab, such as what a write did. */
  toast(text: string, failed?: boolean): void;
  refresh(): void;
  narrow: boolean;
}

export const TabContext = createContext<Tab | null>(null);

export function useTab(): Tab {
  const tab = useContext(TabContext);
  if (!tab) throw new Error("useTab outside the tab");
  return tab;
}

/** An action's failure, as its message: the host words them for the user. */
export const failureText = (error: unknown) => (error instanceof Error ? error.message : String(error));
