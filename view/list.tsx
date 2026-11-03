import { ago } from "../github/format.ts";
import { listKey, type ListItem } from "../github/model.ts";
import { useTab } from "./bridge.ts";
import { Avatar, CheckMark, Label, Spinner, StateIcon } from "./icons.tsx";

const REVIEW_WORDS = { approved: "Approved", "changes-requested": "Changes requested", "review-required": "Review required" } as const;

function ChecksBadge({ item }: { item: ListItem }) {
  const checks = item.checks;
  if (!checks || checks.total === 0) return null;
  if (checks.failed > 0) return <span className="checks failed" data-hint={`${checks.failed} of ${checks.total} checks failing`}><CheckMark state="failed" /> {checks.failed} failing</span>;
  if (checks.pending > 0) return <span className="checks pending" data-hint={`${checks.pending} of ${checks.total} checks running`}><CheckMark state="pending" /> running</span>;
  return <span className="checks passed" data-hint={`All ${checks.total} checks passed`}><CheckMark state="passed" /> {checks.passed}/{checks.total}</span>;
}

/** Why the row is the user's business: asks their review, is assigned to them, or is theirs. */
function forYou(item: ListItem, viewer: string | null) {
  if (!viewer) return null;
  if (item.reviewRequested?.includes(viewer)) return "asks your review";
  if (item.assignees.includes(viewer)) return "assigned to you";
  return null;
}

export function Row({ item, pinned = false }: { item: ListItem; pinned?: boolean }) {
  const tab = useTab();
  const selected = tab.selected?.kind === item.kind && tab.selected.number === item.number;
  const viewer = tab.state.meta?.viewer ?? null;
  const yours = forYou(item, viewer);
  return (
    <li>
      <button
        type="button"
        className={["row", selected && "selected", pinned && "pinned", item.state === "draft" && "draft"].filter(Boolean).join(" ")}
        aria-current={selected}
        data-number={item.number}
        onClick={() => tab.select(item)}
      >
        <StateIcon item={item} />
        <span className="row-main">
          <span className="row-title">
            {item.title}
            {item.labels.map((label) => (
              <Label key={label.name} label={label} />
            ))}
          </span>
          <span className="row-meta">
            #{item.number} · <Avatar login={item.author} size={14} /> {item.author} · {ago(item.updatedAt)}
            {item.kind === "pr" && item.headRef && (
              <>
                {" · "}
                <code className="branch">{item.headRef}</code>
              </>
            )}
            {pinned && <b className="here"> checked out here</b>}
            {yours && <b className="yours"> · {yours}</b>}
          </span>
        </span>
        <span className="row-side">
          <ChecksBadge item={item} />
          {item.review && <span className={`review ${item.review}`}>{REVIEW_WORDS[item.review]}</span>}
          {item.subIssues && item.subIssues.total > 0 && (
            <span className="sub-issues" data-hint="Sub-issues done">
              ↳ {item.subIssues.done}/{item.subIssues.total}
            </span>
          )}
          {item.linkedPrs && item.linkedPrs.length > 0 && <span className="linked">PR #{item.linkedPrs[0]}</span>}
          {item.comments > 0 && <span className="comments">💬 {item.comments}</span>}
          {item.assignees.length > 0 && (
            <span className="assignees">
              {item.assignees.slice(0, 3).map((login) => (
                <Avatar key={login} login={login} size={16} />
              ))}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** The rows the query finds, with the PR of the branch checked out here pinned first when it's open. */
export function shownRows(items: ListItem[], branchPr: ListItem | null, kind: ListItem["kind"]) {
  const pin = kind === "pr" && branchPr && (branchPr.state === "open" || branchPr.state === "draft") ? branchPr : null;
  return { pinned: pin, rows: pin ? items.filter(({ number }) => number !== pin.number) : items };
}

export function List() {
  const tab = useTab();
  const { state, kind, query } = tab;
  const result = state.lists[listKey(kind, query)];
  const loading = state.loading.includes(listKey(kind, query));
  const { pinned, rows } = shownRows(result?.items ?? [], state.branchPr, kind);
  return (
    <section className="list" aria-label={kind === "pr" ? "Pull requests" : "Issues"}>
      {result?.problem && <p className="list-problem">⚠ {result.problem.message}</p>}
      {!result && loading && (
        <div className="list-loading">
          <Spinner /> Loading {kind === "pr" ? "pull requests" : "issues"}…
        </div>
      )}
      <ul>
        {pinned && <Row item={pinned} pinned />}
        {rows.map((item) => (
          <Row key={item.number} item={item} />
        ))}
      </ul>
      {result && !result.problem && rows.length === 0 && !pinned && (
        <div className="empty">
          <p>Nothing matches.</p>
          <p className="muted">
            <code>{query || "(everything)"}</code>
          </p>
        </div>
      )}
      {result && result.items.length >= 50 && <p className="muted list-more">Showing the 50 most relevant. Narrow the search to see others.</p>}
    </section>
  );
}
