import { useEffect, useState } from "react";
import { updatedText } from "../github/format.ts";
import { listKey, type ItemKind } from "../github/model.ts";
import { BUILT_IN_VIEWS, CHECK_STATUSES, DEFAULT_QUERY, isValue, sameQuery, SORTS, STATE_VALUES, valuesOf, withIs, withValues } from "../github/query.ts";
import { repoLabel, repoUrl } from "../github/remote.ts";
import { send, useTab } from "./bridge.ts";
import { Label, Spinner } from "./icons.tsx";
import { PickList, Popover } from "./popover.tsx";

const KIND_WORDS: Record<ItemKind, string> = { pr: "Pull requests", issue: "Issues" };

/** Re-renders every half minute, so "Updated 2 min ago" keeps true. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function TopBar() {
  const tab = useTab();
  const { state, repo, kind } = tab;
  const now = useNow();
  const list = state.lists[listKey(kind, tab.query)];
  const loading = state.loading.includes(listKey(kind, tab.query));
  const openCount = (each: ItemKind) => state.counts[listKey(each, DEFAULT_QUERY[each])];
  const branchCanOpenPr = state.branch && state.branch !== state.meta?.defaultBranch && !state.branchPr;
  return (
    <header className="top-bar">
      <div className="kinds" role="tablist" aria-label="Show">
        {(["issue", "pr"] as const).map((each) => (
          <button key={each} type="button" role="tab" aria-selected={kind === each} className={kind === each ? "on" : ""} onClick={() => tab.setKind(each)}>
            {KIND_WORDS[each]}
            {openCount(each) !== undefined && <span className="count" data-hint={`${openCount(each)} open`}>{openCount(each)}</span>}
          </button>
        ))}
      </div>
      <Popover className="repo-button" label={<>{repoLabel(repo)} <small>{repo.host} ▾</small></>} hint="The repository this workspace is connected to">
        {(close) => (
          <div className="menu">
            <button type="button" onClick={() => (window.mirador.openLink(repoUrl(repo)), close())}>
              Open on {repo.host}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                close();
                void send({ kind: "disconnect" });
              }}
            >
              Disconnect this workspace
            </button>
          </div>
        )}
      </Popover>
      <span className="spacer" />
      <span className="freshness" aria-live="polite">
        {loading ? <Spinner /> : null}
        {list?.problem && list.fetchedAt !== null ? <span className="stale" data-hint={list.problem.message}>⚠ </span> : null}
        {loading && !list ? "Loading…" : updatedText(list?.fetchedAt ?? null, now)}
      </span>
      <button type="button" className="icon-button" aria-label="Refresh" data-hint="Refresh (r)" onClick={tab.refresh}>
        ↻
      </button>
      {kind === "issue" ? (
        <button type="button" className="button" onClick={() => tab.showSheet({ kind: "new-issue" })}>
          New issue
        </button>
      ) : branchCanOpenPr ? (
        <button type="button" className="button" data-hint={`Open a pull request for ${state.branch} on ${repo.host}`} onClick={() => window.mirador.openLink(`${repoUrl(repo)}/compare/${encodeURIComponent(state.branch!)}?expand=1`)}>
          New pull request ↗
        </button>
      ) : null}
    </header>
  );
}

export function ViewsBar() {
  const tab = useTab();
  const { state, kind, query } = tab;
  const saved = state.savedViews[kind];
  const views = [...BUILT_IN_VIEWS[kind].map((view) => ({ ...view, saved: false })), ...saved.map((view) => ({ ...view, saved: true }))];
  const current = views.find((view) => sameQuery(view.query, query));
  return (
    <nav className="views" aria-label="Views">
      {views.map((view) => {
        const count = state.counts[listKey(kind, view.query)];
        return (
          <span key={`${view.saved}:${view.name}`} className={`view ${current === view ? "on" : ""}`}>
            <button type="button" aria-pressed={current === view} onClick={() => tab.search(view.query)} data-hint={view.query}>
              {view.name}
              {count !== undefined && <b>{count}</b>}
            </button>
            {view.saved && (
              <button type="button" className="view-remove" aria-label={`Remove the view ${view.name}`} onClick={() => void send({ kind: "remove-view", item: kind, name: view.name })}>
                ×
              </button>
            )}
          </span>
        );
      })}
      {!current && query.trim() && (
        <button type="button" className="view save" onClick={() => tab.showSheet({ kind: "save-view", item: kind, query })}>
          + Save view
        </button>
      )}
    </nav>
  );
}

/** A filter chip: its qualifier's value, and a popover to change it. */
function Chip({ name, value, children }: { name: string; value: string | null; children: (close: () => void) => React.ReactNode }) {
  return (
    <Popover className={`chip ${value ? "set" : ""}`} label={<>{value ? `${name}: ${value}` : name} ▾</>}>
      {children}
    </Popover>
  );
}

const SORT_WORDS: Record<(typeof SORTS)[number], string> = {
  "updated-desc": "Recently updated",
  "created-desc": "Newest",
  "comments-desc": "Most commented",
  "updated-asc": "Least recently updated",
  "created-asc": "Oldest",
};

const STATE_WORDS: Record<string, string> = { open: "Open", closed: "Closed", merged: "Merged" };

export function FilterBar() {
  const tab = useTab();
  const { state, kind, query } = tab;
  const [typed, setTyped] = useState(query);
  useEffect(() => setTyped(query), [query]);
  const people = ["@me", ...(state.meta?.assignable ?? []).filter((login) => login !== state.meta?.viewer)];
  const personOptions = people.map((login) => ({ value: login, text: login === "@me" ? `Me (${state.meta?.viewer ?? "you"})` : login }));
  const labels = state.meta?.labels ?? [];
  const change = (next: string) => tab.search(next);
  const stateValue = isValue(query, STATE_VALUES[kind]);
  const sort = valuesOf(query, "sort")[0] as (typeof SORTS)[number] | undefined;
  const checkStatus = valuesOf(query, "status")[0];
  const draft = valuesOf(query, "draft")[0];
  const one = (key: string) => valuesOf(query, key)[0] ?? null;

  return (
    <div className="filters">
      <div className="search">
        <span className="search-icon" aria-hidden>
          ⌕
        </span>
        <input
          id="github-search"
          aria-label="Search"
          placeholder={`Search ${kind === "pr" ? "pull requests" : "issues"}, or is:open label:bug…`}
          value={typed}
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") change(typed);
            if (event.key === "Escape") {
              setTyped(query);
              event.currentTarget.blur();
            }
          }}
        />
        {typed !== query && <span className="enter-hint">↵</span>}
      </div>
      <Chip name="State" value={stateValue ? STATE_WORDS[stateValue]! : null}>
        {(close) => (
          <PickList
            options={STATE_VALUES[kind].map((value) => ({ value, text: STATE_WORDS[value]! }))}
            chosen={stateValue ? [stateValue] : []}
            multiple={false}
            onChange={([value]) => (change(withIs(query, STATE_VALUES[kind], value ?? null)), close())}
          />
        )}
      </Chip>
      <Chip name="Author" value={one("author")}>
        {(close) => <PickList options={personOptions} chosen={valuesOf(query, "author")} multiple={false} filterLabel="Filter people" onChange={(chosen) => (change(withValues(query, "author", chosen)), close())} />}
      </Chip>
      <Chip name="Assignee" value={one("assignee")}>
        {(close) => <PickList options={personOptions} chosen={valuesOf(query, "assignee")} multiple={false} filterLabel="Filter people" onChange={(chosen) => (change(withValues(query, "assignee", chosen)), close())} />}
      </Chip>
      {kind === "pr" && (
        <Chip name="Review requested" value={one("review-requested")}>
          {(close) => (
            <PickList options={personOptions} chosen={valuesOf(query, "review-requested")} multiple={false} filterLabel="Filter people" onChange={(chosen) => (change(withValues(query, "review-requested", chosen)), close())} />
          )}
        </Chip>
      )}
      <Chip name="Label" value={valuesOf(query, "label").join(", ") || null}>
        {() => (
          <PickList
            options={labels.map(({ name }) => ({ value: name, text: name }))}
            chosen={valuesOf(query, "label")}
            multiple
            filterLabel="Filter labels"
            render={(name) => <Label label={labels.find((label) => label.name === name)!} />}
            onChange={(chosen) => change(withValues(query, "label", chosen))}
          />
        )}
      </Chip>
      {kind === "pr" && (
        <>
          <Chip name="Checks" value={checkStatus ? { success: "Passing", failure: "Failing", pending: "Running" }[checkStatus] ?? checkStatus : null}>
            {(close) => (
              <PickList
                options={CHECK_STATUSES.map((value) => ({ value, text: { success: "Passing", failure: "Failing", pending: "Running" }[value] }))}
                chosen={checkStatus ? [checkStatus as (typeof CHECK_STATUSES)[number]] : []}
                multiple={false}
                onChange={(chosen) => (change(withValues(query, "status", chosen)), close())}
              />
            )}
          </Chip>
          <Chip name="Draft" value={draft === "true" ? "Only drafts" : draft === "false" ? "No drafts" : null}>
            {(close) => (
              <PickList
                options={[
                  { value: "true", text: "Only drafts" },
                  { value: "false", text: "No drafts" },
                ]}
                chosen={draft ? [draft as "true"] : []}
                multiple={false}
                onChange={(chosen) => (change(withValues(query, "draft", chosen)), close())}
              />
            )}
          </Chip>
        </>
      )}
      <Chip name="Sort" value={sort ? SORT_WORDS[sort] : null}>
        {(close) => (
          <PickList options={SORTS.map((value) => ({ value, text: SORT_WORDS[value] }))} chosen={sort ? [sort] : []} multiple={false} onChange={(chosen) => (change(withValues(query, "sort", chosen)), close())} />
        )}
      </Chip>
    </div>
  );
}
