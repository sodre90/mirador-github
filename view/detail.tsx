import { useEffect, useState } from "react";
import { ago, agoText } from "../github/format.ts";
import { fixCheckText, mentionText, reviewText, workText } from "../github/handoff.ts";
import { detailKey, type Check, type Detail as DetailData, type ListItem, type TimelineEntry } from "../github/model.ts";
import { failureText, useTab } from "./bridge.ts";
import { Avatar, CheckMark, Label, Spinner, StateIcon, stateClass, stateWord } from "./icons.tsx";
import { MarkdownText } from "./markdown.tsx";
import { Popover } from "./popover.tsx";

/** Runs a hand-off to the agent, and says how it went. */
function useHandOff() {
  const tab = useTab();
  return (doIt: () => Promise<void>, done: string) =>
    doIt().then(
      () => tab.toast(done),
      (error) => tab.toast(failureText(error), true),
    );
}

function WorkOnThis({ item, detail }: { item: ListItem; detail: DetailData | null }) {
  const tab = useTab();
  const handOff = useHandOff();
  const text = () => workText(tab.repo, item, detail);
  const start = () => handOff(() => window.mirador.startConversation(text()), "Started a conversation on it");
  return (
    <span className="split-button">
      <button type="button" className="button primary" data-hint="Start a conversation in this workspace that works on it (w)" onClick={start} id="work-on-this">
        Work on this
      </button>
      <Popover className="button primary split-arrow" label="▾" name="More ways to hand it to the agent" hint="More ways to hand it to the agent" align="left">
        {(close) => (
          <div className="menu wide">
            <button type="button" onClick={() => (close(), start())}>
              <b>Start a conversation</b>
              <small>A new conversation in this workspace works on it, with its details</small>
            </button>
            <button type="button" onClick={() => (close(), handOff(() => window.mirador.prompt(text()), "Sent to this conversation's agent"))}>
              <b>Send to this conversation</b>
              <small>The agent here gets it as your next message</small>
            </button>
            <button type="button" onClick={() => (close(), handOff(() => window.mirador.addToComposer(mentionText(tab.repo, item)), "Added to the composer"))}>
              <b>Mention in the composer</b>
              <small>Adds “{mentionText(tab.repo, item).slice(0, 48)}…” to what you're writing</small>
            </button>
            {item.kind === "pr" && (
              <button type="button" onClick={() => (close(), handOff(() => window.mirador.startConversation(reviewText(tab.repo, item)), "Started a conversation that reviews it"))}>
                <b>Review with the agent</b>
                <small>A new conversation reviews the diff and shows its review on the canvas</small>
              </button>
            )}
          </div>
        )}
      </Popover>
    </span>
  );
}

function Actions({ item, detail }: { item: ListItem; detail: DetailData | null }) {
  const tab = useTab();
  const { meta, branch } = tab.state;
  const open = item.state === "open" || item.state === "draft";
  const canPush = meta?.canPush ?? false;
  const copyLink = () => void navigator.clipboard?.writeText(item.url).then(() => tab.toast("Copied the link"), () => tab.toast("Couldn't copy the link", true));
  return (
    <div className="actions">
      <WorkOnThis item={item} detail={detail} />
      {item.kind === "pr" && open && (
        <button type="button" className="button" onClick={() => tab.showSheet({ kind: "review", item })}>
          Review…
        </button>
      )}
      <button type="button" className="button" data-hint="Comment (c)" onClick={() => tab.showSheet({ kind: "comment", item })} id="comment-button">
        Comment
      </button>
      {item.kind === "issue" && (
        <>
          <button type="button" className="button" onClick={() => tab.showSheet({ kind: "labels", item })}>
            Labels
          </button>
          <button type="button" className="button" onClick={() => tab.showSheet({ kind: "assignees", item })}>
            Assign
          </button>
        </>
      )}
      {item.kind === "pr" && open && item.headRef !== branch && (
        <button type="button" className="button" data-hint={`Switch this workspace to ${item.headRef}`} onClick={() => tab.showSheet({ kind: "checkout", item })}>
          Check out
        </button>
      )}
      {item.kind === "pr" && item.state === "open" && canPush && (
        <button type="button" className="button merge" onClick={() => tab.showSheet({ kind: "merge", item })}>
          Merge…
        </button>
      )}
      {(item.kind === "issue" || !open) && (
        <button type="button" className="button" onClick={() => tab.showSheet({ kind: "set-state", item, open: !open })}>
          {open ? "Close…" : "Reopen…"}
        </button>
      )}
      <Popover className="button icon-like" label="⋯" name="More" hint="More" align="right">
        {(close) => (
          <div className="menu">
            {item.kind === "pr" && (
              <>
                <button type="button" onClick={() => (close(), tab.showSheet({ kind: "labels", item }))}>
                  Labels…
                </button>
                <button type="button" onClick={() => (close(), tab.showSheet({ kind: "assignees", item }))}>
                  Assignees…
                </button>
                {open && (
                  <button type="button" onClick={() => (close(), tab.showSheet({ kind: "ready", item, ready: item.state === "draft" }))}>
                    {item.state === "draft" ? "Mark ready for review…" : "Convert to draft…"}
                  </button>
                )}
                {open && (
                  <button type="button" onClick={() => (close(), tab.showSheet({ kind: "set-state", item, open: false }))}>
                    Close without merging…
                  </button>
                )}
              </>
            )}
            {item.kind === "issue" && open && (
              <button type="button" onClick={() => (close(), tab.showSheet({ kind: "comment", item, closeToo: true }))}>
                Comment and close…
              </button>
            )}
            <button type="button" onClick={() => (close(), copyLink())}>
              Copy link
            </button>
          </div>
        )}
      </Popover>
      <button type="button" className="button icon-like" aria-label={`Open on ${tab.repo.host}`} data-hint={`Open on ${tab.repo.host} (o)`} onClick={() => window.mirador.openLink(item.url)}>
        ↗
      </button>
    </div>
  );
}

const VERDICT_WORDS = { approved: "approved", "changes-requested": "requested changes", commented: "reviewed", dismissed: "had a review dismissed" } as const;

function Entry({ entry }: { entry: TimelineEntry }) {
  return (
    <article className={`entry ${entry.kind} ${entry.verdict ?? ""}`}>
      <Avatar login={entry.author} size={24} />
      <div className="entry-body">
        <header>
          <b>{entry.author}</b> {entry.kind === "review" ? <span className={`verdict ${entry.verdict}`}>{VERDICT_WORDS[entry.verdict ?? "commented"]}</span> : "commented"} · {ago(entry.at)}
        </header>
        {entry.body.trim() && <MarkdownText text={entry.body} />}
      </div>
    </article>
  );
}

function Conversation({ detail }: { detail: DetailData }) {
  const tab = useTab();
  return (
    <div className="conversation">
      <article className="entry opening">
        <Avatar login={detail.author} size={24} />
        <div className="entry-body">
          <header>
            <b>{detail.author}</b> opened it · {agoText(detail.createdAt)}
          </header>
          <MarkdownText text={detail.body} />
        </div>
      </article>
      {detail.subIssueList && detail.subIssueList.length > 0 && (
        <section className="related">
          <h3>Sub-issues</h3>
          {detail.subIssueList.map((sub) => (
            <button key={sub.number} type="button" className="related-row" onClick={() => tab.openNumber("issue", sub.number)}>
              <StateIcon item={{ kind: "issue", state: sub.state, stateReason: null }} /> {sub.title} <span className="muted">#{sub.number}</span>
            </button>
          ))}
        </section>
      )}
      {(detail.linkedPrs?.length ?? 0) + (detail.closesIssues?.length ?? 0) > 0 && (
        <section className="related">
          <h3>{detail.kind === "issue" ? "Pull requests that close it" : "Closes"}</h3>
          {(detail.kind === "issue" ? detail.linkedPrs! : detail.closesIssues!).map((number) => (
            <button key={number} type="button" className="related-row" onClick={() => tab.openNumber(detail.kind === "issue" ? "pr" : "issue", number)}>
              #{number}
            </button>
          ))}
        </section>
      )}
      {detail.timeline.map((entry, index) => (
        <Entry key={`${entry.at}:${index}`} entry={entry} />
      ))}
      {detail.timeline.length === 0 && <p className="muted no-comments">No comments yet.</p>}
    </div>
  );
}

function Checks({ item, checks }: { item: ListItem; checks: Check[] }) {
  const tab = useTab();
  const handOff = useHandOff();
  if (checks.length === 0) return <p className="muted pad">No checks ran on this pull request.</p>;
  const order = { failed: 0, pending: 1, passed: 2, skipped: 3 };
  return (
    <ul className="checks-list">
      {[...checks]
        .sort((a, b) => order[a.state] - order[b.state])
        .map((check, index) => (
          <li key={`${check.name}:${index}`} className={check.state}>
            <CheckMark state={check.state} />
            <span className="check-name">
              {check.name}
              {check.workflow && <small className="muted"> · {check.workflow}</small>}
            </span>
            <span className="check-side muted">
              {check.completedAt && ago(check.completedAt)}
              {check.url && (
                <button type="button" className="link" onClick={() => window.mirador.openLink(check.url!)}>
                  Details ↗
                </button>
              )}
              {check.state === "failed" && (
                <button type="button" className="link strong" onClick={() => handOff(() => window.mirador.prompt(fixCheckText(tab.repo, item, check)), "Asked the agent to fix it")}>
                  Ask the agent to fix
                </button>
              )}
            </span>
          </li>
        ))}
    </ul>
  );
}

function Files({ detail }: { detail: DetailData }) {
  const tab = useTab();
  const handOff = useHandOff();
  const files = detail.files ?? [];
  return (
    <div className="files">
      <div className="files-head">
        <span className="muted">
          {files.length} files · {detail.commits ?? 0} commits · <span className="added">+{detail.additions}</span> <span className="removed">−{detail.deletions}</span>
        </span>
        <button type="button" className="button" onClick={() => handOff(() => window.mirador.startConversation(reviewText(tab.repo, detail)), "Started a conversation that reviews it")}>
          Review with the agent
        </button>
      </div>
      <ul>
        {files.map((file) => (
          <li key={file.path}>
            <button type="button" className="file-row" onClick={() => window.mirador.openLink(`${detail.url}/files`)} data-hint="See the diff on GitHub">
              <code>{file.path}</code>
              <span className="added">+{file.additions}</span>
              <span className="removed">−{file.deletions}</span>
              <span className="bar" aria-hidden>
                <i style={{ flexGrow: file.additions }} className="add" />
                <i style={{ flexGrow: file.deletions }} className="del" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Section = "conversation" | "checks" | "files";

export function Detail({ item }: { item: ListItem }) {
  const tab = useTab();
  const result = tab.state.details[detailKey(item.kind, item.number)];
  const loading = tab.state.loading.includes(detailKey(item.kind, item.number));
  const detail = result?.detail ?? null;
  const shown: ListItem = detail ?? item;
  const [section, setSection] = useState<Section>("conversation");
  useEffect(() => setSection("conversation"), [item.kind, item.number]);
  const failing = shown.checks?.failed ?? 0;
  return (
    <section className="detail" aria-label={`${item.kind === "pr" ? "Pull request" : "Issue"} ${item.number}`}>
      {tab.narrow && (
        <button type="button" className="back link" onClick={() => tab.select(null)}>
          ← Back to the list
        </button>
      )}
      <h1 className="detail-title">
        {shown.title} <span className="number">#{shown.number}</span>
      </h1>
      <div className="detail-meta">
        <span className={`state-badge ${stateClass(shown)}`}>
          <StateIcon item={shown} /> {stateWord(shown)}
        </span>
        {shown.kind === "pr" ? (
          <span>
            <b>{shown.author}</b> wants to merge {detail?.commits ? `${detail.commits} commits ` : ""}into <code className="branch">{shown.baseRef}</code> from <code className="branch">{shown.headRef}</code> · <span className="added">+{shown.additions}</span>{" "}
            <span className="removed">−{shown.deletions}</span>
          </span>
        ) : (
          <span>
            <b>{shown.author}</b> opened it {agoText(shown.createdAt)}
            {shown.assignees.length > 0 && <> · assigned to {shown.assignees.map((login) => <b key={login}>{login} </b>)}</>}
            {detail?.milestone && <> · milestone <b>{detail.milestone}</b></>}
          </span>
        )}
        {loading && <Spinner />}
      </div>
      {shown.labels.length > 0 && (
        <div className="detail-labels">
          {shown.labels.map((label) => (
            <Label key={label.name} label={label} />
          ))}
        </div>
      )}
      {shown.kind === "pr" && detail?.mergeable === "conflicting" && <p className="warn">⚠ This branch has conflicts that must be resolved.</p>}
      <Actions item={shown} detail={detail} />
      {result?.problem && <p className="list-problem">⚠ {result.problem.message}</p>}
      {shown.kind === "pr" && (
        <div className="sections" role="tablist">
          <button type="button" role="tab" aria-selected={section === "conversation"} className={section === "conversation" ? "on" : ""} onClick={() => setSection("conversation")}>
            Conversation <span className="count">{shown.comments}</span>
          </button>
          <button type="button" role="tab" aria-selected={section === "checks"} className={section === "checks" ? "on" : ""} onClick={() => setSection("checks")}>
            Checks {failing > 0 ? <span className="count failed">{failing} ✗</span> : <span className="count">{shown.checks?.total ?? 0}</span>}
          </button>
          <button type="button" role="tab" aria-selected={section === "files"} className={section === "files" ? "on" : ""} onClick={() => setSection("files")}>
            Files <span className="count">{shown.changedFiles ?? 0}</span>
          </button>
        </div>
      )}
      {!detail && loading && (
        <div className="list-loading">
          <Spinner /> Loading…
        </div>
      )}
      {detail && (section === "conversation" || detail.kind === "issue") && <Conversation detail={detail} />}
      {detail && detail.kind === "pr" && section === "checks" && <Checks item={detail} checks={detail.checkList ?? []} />}
      {detail && detail.kind === "pr" && section === "files" && <Files detail={detail} />}
    </section>
  );
}
