import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { listKey, type ItemKind, type ListItem, type Prefs, type TabState } from "../github/model.ts";
import { DEFAULT_QUERY } from "../github/query.ts";
import { FilterBar, TopBar, ViewsBar } from "./bar.tsx";
import { send, TabContext, type Sheet, type Tab } from "./bridge.ts";
import { Connect, Problem } from "./connect.tsx";
import { Detail } from "./detail.tsx";
import { Spinner } from "./icons.tsx";
import { List, shownRows } from "./list.tsx";
import { SheetView } from "./sheets.tsx";
import viewStyles from "./view.css" with { type: "text" };

const REFRESH_EVERY_MS = 2 * 60_000;
const NARROW_PX = 640;
const TOAST_MS = 3500;

function useTabState() {
  const [state, setState] = useState<TabState | null>(null);
  useEffect(() => window.mirador.onState(setState), []);
  return state;
}

function useNarrow(root: React.RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? NARROW_PX) < NARROW_PX));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [root.current]);
  return narrow;
}

/** While the tab shows, its list comes fresh: now, every two minutes while the page is visible, and when it comes back into view. */
function useFreshList(connected: boolean, kind: ItemKind, query: string) {
  const refresh = useCallback(() => {
    if (connected) void send({ kind: "refresh", list: { kind, query }, counts: kind }).catch(() => {});
  }, [connected, kind, query]);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), REFRESH_EVERY_MS);
    const cameBack = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", cameBack);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", cameBack);
    };
  }, [refresh]);
  return refresh;
}

/** Keys while the tab has the focus and no box takes them: j and k move, Enter opens, / searches, and a letter per action. */
function useKeys(tab: Tab | null, rows: ListItem[]) {
  useEffect(() => {
    if (!tab) return;
    const pressed = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, [role=dialog]")) return;
      const at = rows.findIndex((row) => row.kind === tab.selected?.kind && row.number === tab.selected.number);
      const move = (by: number) => {
        const next = rows[Math.min(rows.length - 1, Math.max(0, at + by))];
        if (next) tab.select(next);
        requestAnimationFrame(() => document.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" }));
      };
      const actions: Record<string, () => void> = {
        j: () => move(1),
        ArrowDown: () => move(1),
        k: () => move(-1),
        ArrowUp: () => move(-1),
        "/": () => document.getElementById("github-search")?.focus(),
        r: tab.refresh,
        Escape: () => tab.select(null),
        ...(tab.selected && {
          o: () => window.mirador.openLink(tab.selected!.url),
          c: () => tab.showSheet({ kind: "comment", item: tab.selected! }),
          w: () => document.getElementById("work-on-this")?.click(),
        }),
      };
      const act = actions[event.key];
      if (!act) return;
      event.preventDefault();
      act();
    };
    addEventListener("keydown", pressed);
    return () => removeEventListener("keydown", pressed);
  }, [tab, rows]);
}

function Toast({ toast }: { toast: { text: string; failed: boolean } | null }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.failed ? "failed" : ""}`} role="status">
      {toast.text}
    </div>
  );
}

function App() {
  const state = useTabState();
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const [kind, setKindHere] = useState<ItemKind | null>(null);
  const [queries, setQueries] = useState<Record<ItemKind, string> | null>(null);
  const [selected, setSelected] = useState<ListItem | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<{ text: string; failed: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!state?.prefs || kind !== null) return;
    setKindHere(state.prefs.kind);
    setQueries(state.prefs.query);
  }, [state?.prefs]);

  const shownKind = kind ?? state?.prefs.kind ?? "pr";
  const shownQueries = queries ?? state?.prefs.query ?? DEFAULT_QUERY;
  const query = shownQueries[shownKind];
  const connected = !!state?.connection;
  const refresh = useFreshList(connected, shownKind, query);

  useEffect(() => {
    if (connected) void send({ kind: "refresh", list: null, counts: shownKind === "pr" ? "issue" : "pr" }).catch(() => {});
  }, [connected]);

  const savePrefs = (prefs: Prefs) => void send({ kind: "prefs", prefs }).catch(() => {});

  const tab = useMemo<Tab | null>(() => {
    if (!state?.connection) return null;
    return {
      state,
      repo: state.connection,
      kind: shownKind,
      query,
      narrow,
      setKind(next) {
        setKindHere(next);
        setSelected(null);
        savePrefs({ kind: next, query: shownQueries });
      },
      search(next) {
        const nextQueries = { ...shownQueries, [shownKind]: next.trim() };
        setQueries(nextQueries);
        savePrefs({ kind: shownKind, query: nextQueries });
      },
      selected,
      select(item) {
        setSelected(item);
        if (item) void send({ kind: "open", item: item.kind, number: item.number }).catch(() => {});
      },
      openNumber(itemKind, number) {
        const known = Object.values(state.lists)
          .flatMap(({ items }) => items)
          .find((item) => item.kind === itemKind && item.number === number);
        if (itemKind !== shownKind) setKindHere(itemKind);
        const stub: ListItem = known ?? { kind: itemKind, number, title: `#${number}`, state: "open", stateReason: null, author: "", labels: [], assignees: [], comments: 0, createdAt: "", updatedAt: "", url: `https://${state.connection!.host}/${state.connection!.owner}/${state.connection!.name}/${itemKind === "pr" ? "pull" : "issues"}/${number}` };
        this.select(stub);
      },
      showSheet: setSheet,
      toast(text, failed = false) {
        clearTimeout(toastTimer.current);
        setToast({ text, failed });
        toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
      },
      refresh() {
        refresh();
        if (selected) void send({ kind: "open", item: selected.kind, number: selected.number }).catch(() => {});
      },
    };
  }, [state, shownKind, query, selected, narrow, refresh]);

  const result = state?.lists[listKey(shownKind, query)];
  const { pinned, rows } = shownRows(result?.items ?? [], state?.branchPr ?? null, shownKind);
  useKeys(tab, pinned ? [pinned, ...rows] : rows);

  return (
    <div className={`app ${narrow ? "narrow" : "wide"}`} ref={root}>
      {!state && (
        <div className="center">
          <Spinner />
        </div>
      )}
      {state && state.problem && <Problem problem={state.problem} onRetry={refresh} />}
      {state && !state.problem && !state.connection && <Connect state={state} />}
      {tab && !state?.problem && (
        <TabContext.Provider value={tab}>
          <TopBar />
          <ViewsBar />
          <FilterBar />
          <main className={`body ${selected ? "has-detail" : ""}`}>
            {(!narrow || !selected) && <List />}
            {selected ? <Detail item={selected} /> : !narrow && <Hint />}
          </main>
          {sheet && <SheetView sheet={sheet} />}
          <Toast toast={toast} />
        </TabContext.Provider>
      )}
    </div>
  );
}

function Hint() {
  return (
    <section className="detail empty-detail">
      <p>Pick an issue or pull request to see it here.</p>
      <p className="muted small">
        <kbd>j</kbd> <kbd>k</kbd> move · <kbd>/</kbd> search · <kbd>r</kbd> refresh · <kbd>w</kbd> work on it · <kbd>c</kbd> comment · <kbd>o</kbd> open on GitHub
      </p>
    </section>
  );
}

const style = document.createElement("style");
style.textContent = viewStyles;
document.head.append(style);
document.body.innerHTML = '<div id="root"></div>';
createRoot(document.getElementById("root")!).render(<App />);
