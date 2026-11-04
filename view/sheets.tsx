import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkoutArgs, shellText, writeArgs } from "../github/gh.ts";
import type { CheckoutReply, ListItem, MergeMethod, TabAction } from "../github/model.ts";
import { PROMPT_KINDS, PROMPTS, inheritedTemplate, templateSource, type PromptKind, type PromptScope } from "../github/prompts.ts";
import { failureText, send, useTab, type Message, type Sheet } from "./bridge.ts";
import { Avatar, Label, Spinner } from "./icons.tsx";
import { MarkdownText } from "./markdown.tsx";
import { PickList } from "./popover.tsx";

/** What the user wrote and hasn't posted, by item and box, while the tab's frame lives. */
const drafts = new Map<string, string>();

function useDraft(key: string) {
  const [text, setText] = useState(() => drafts.get(key) ?? "");
  useEffect(() => void (text ? drafts.set(key, text) : drafts.delete(key)), [key, text]);
  return [text, setText, () => drafts.delete(key)] as const;
}

const itemName = (item: ListItem) => `${item.kind === "pr" ? "pull request" : "issue"} #${item.number}`;

/** A sheet over the tab with a title, its fields, the gh command it will run, and its buttons; Escape cancels. */
function SheetFrame({ title, children, command, footer }: { title: string; children?: ReactNode; command: string[] | null; footer: ReactNode }) {
  const tab = useTab();
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") tab.showSheet(null);
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, []);
  return (
    <div className="sheet-backdrop" onPointerDown={(event) => event.target === event.currentTarget && tab.showSheet(null)}>
      <div className="sheet" role="dialog" aria-modal aria-label={title}>
        <h2>{title}</h2>
        {children}
        {command && (
          <pre className="command" data-hint="What it runs, with your gh">
            {shellText(command)}
          </pre>
        )}
        <div className="sheet-buttons">{footer}</div>
      </div>
    </div>
  );
}

/** Runs a write once the user confirms; the sheet stays, with gh's words, when GitHub refuses it. */
function useWrite(done: string) {
  const tab = useTab();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (action: TabAction, after?: (reply: unknown) => void) => {
    setBusy(true);
    setProblem(null);
    try {
      const reply = await send(action);
      tab.showSheet(null);
      tab.toast(done);
      after?.(reply);
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, run };
}

function Buttons({ busy, problem, confirm, disabled, onConfirm }: { busy: boolean; problem: string | null; confirm: string; disabled?: boolean; onConfirm(): void }) {
  const tab = useTab();
  return (
    <>
      {problem && <p className="sheet-problem">⚠ {problem}</p>}
      <span className="spacer" />
      <button type="button" className="button" onClick={() => tab.showSheet(null)}>
        Cancel
      </button>
      <button type="button" className="button primary" disabled={busy || disabled} onClick={onConfirm}>
        {busy ? <Spinner /> : null} {confirm}
      </button>
    </>
  );
}

function WriteBox({ value, onChange, label, placeholder }: { value: string; onChange(text: string): void; label: string; placeholder: string }) {
  const [preview, setPreview] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  return (
    <div className="write-box">
      <div className="write-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!preview} className={!preview ? "on" : ""} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? "on" : ""} onClick={() => setPreview(true)}>
          Preview
        </button>
      </div>
      {preview ? <div className="preview">{value.trim() ? <MarkdownText text={value} /> : <p className="muted">Nothing to preview.</p>}</div> : <textarea ref={box} aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} rows={7} />}
    </div>
  );
}

function CommentSheet({ item, closeToo = false }: { item: ListItem; closeToo?: boolean }) {
  const tab = useTab();
  const [body, setBody, forget] = useDraft(`comment:${item.kind}#${item.number}`);
  const write = useWrite(closeToo ? "Commented and closed it" : "Posted your comment");
  const action = { kind: "comment", item: item.kind, number: item.number, body, close: closeToo } as const;
  const post = () =>
    write.run(action, forget);
  return (
    <SheetFrame
      title={`Comment on ${itemName(item)}`}
      command={body.trim() ? writeArgs(tab.repo, action) : null}
      footer={<Buttons busy={write.busy} problem={write.problem} confirm={closeToo ? "Post and close on GitHub" : "Post to GitHub"} disabled={!body.trim()} onConfirm={post} />}
    >
      <p className="sheet-about">{item.title}</p>
      <WriteBox value={body} onChange={setBody} label="Comment" placeholder="Write in Markdown…" />
    </SheetFrame>
  );
}

function ReviewSheet({ item }: { item: ListItem }) {
  const tab = useTab();
  const [body, setBody, forget] = useDraft(`review:${item.number}`);
  const [verdict, setVerdict] = useState<"comment" | "approve" | "request-changes">("comment");
  const write = useWrite("Posted your review");
  const action = { kind: "review", number: item.number, verdict, body } as const;
  const needsWords = verdict !== "approve" && !body.trim();
  const own = item.author === tab.state.meta?.viewer;
  return (
    <SheetFrame
      title={`Review ${itemName(item)}`}
      command={needsWords ? null : writeArgs(tab.repo, action)}
      footer={<Buttons busy={write.busy} problem={write.problem} confirm="Submit review on GitHub" disabled={needsWords} onConfirm={() => write.run(action, forget)} />}
    >
      <p className="sheet-about">{item.title}</p>
      <WriteBox value={body} onChange={setBody} label="Review" placeholder="Leave a comment" />
      <div className="choices" role="radiogroup" aria-label="Verdict">
        {(
          [
            ["comment", "Comment", "General feedback without approving."],
            ["approve", "Approve", "Give your approval to merge."],
            ["request-changes", "Request changes", "Feedback that must be addressed before merging."],
          ] as const
        ).map(([value, text, about]) => (
          <label key={value} className={own && value !== "comment" ? "disabled" : ""}>
            <input type="radio" name="verdict" checked={verdict === value} disabled={own && value !== "comment"} onChange={() => setVerdict(value)} />
            <b>{text}</b> <span className="muted">{own && value !== "comment" ? "Not on your own pull request." : about}</span>
          </label>
        ))}
      </div>
    </SheetFrame>
  );
}

const METHOD_WORDS: Record<MergeMethod, [string, string]> = {
  squash: ["Squash and merge", "Its commits become one on the base branch."],
  merge: ["Create a merge commit", "Its commits are added through a merge commit."],
  rebase: ["Rebase and merge", "Its commits are replayed onto the base branch."],
};

function MergeSheet({ item }: { item: ListItem }) {
  const tab = useTab();
  const meta = tab.state.meta;
  const methods = meta?.mergeMethods.length ? meta.mergeMethods : (["merge"] as MergeMethod[]);
  const [method, setMethod] = useState<MergeMethod>(methods[0]!);
  const [deleteBranch, setDeleteBranch] = useState(meta?.deleteBranchOnMerge ?? true);
  const write = useWrite(`Merged #${item.number}`);
  const action = { kind: "merge", number: item.number, method, deleteBranch } as const;
  const failing = item.checks?.failed ?? 0;
  const pending = item.checks?.pending ?? 0;
  return (
    <SheetFrame
      title={`Merge #${item.number} into ${item.baseRef}?`}
      command={writeArgs(tab.repo, action)}
      footer={<Buttons busy={write.busy} problem={write.problem} confirm="Merge on GitHub" onConfirm={() => write.run(action)} />}
    >
      <p className="sheet-about">{item.title}</p>
      <div className="choices" role="radiogroup" aria-label="How to merge">
        {methods.map((each) => (
          <label key={each}>
            <input type="radio" name="method" checked={method === each} onChange={() => setMethod(each)} />
            <b>{METHOD_WORDS[each][0]}</b> <span className="muted">{METHOD_WORDS[each][1]}</span>
          </label>
        ))}
        <label>
          <input type="checkbox" checked={deleteBranch} onChange={(event) => setDeleteBranch(event.target.checked)} />
          Delete <code className="branch">{item.headRef}</code> after merging
        </label>
      </div>
      {failing > 0 && <p className="warn">⚠ {failing === 1 ? "1 check is failing" : `${failing} checks are failing`}. Branch protection may refuse the merge.</p>}
      {failing === 0 && pending > 0 && <p className="warn">⚠ {pending === 1 ? "1 check is still running" : `${pending} checks are still running`}.</p>}
      {item.review === "changes-requested" && <p className="warn">⚠ Changes were requested in a review.</p>}
    </SheetFrame>
  );
}

/** Labels or assignees: what to add and take off, picked from the repository's, as one edit. */
function PickSheet({ item, what }: { item: ListItem; what: "labels" | "assignees" }) {
  const tab = useTab();
  const meta = tab.state.meta;
  const had = what === "labels" ? item.labels.map(({ name }) => name) : item.assignees;
  const [chosen, setChosen] = useState(had);
  const write = useWrite(what === "labels" ? "Changed the labels" : "Changed who it's assigned to");
  const add = chosen.filter((value) => !had.includes(value));
  const remove = had.filter((value) => !chosen.includes(value));
  const action = { kind: what, item: item.kind, number: item.number, add, remove } as const;
  const labels = meta?.labels ?? [];
  const options =
    what === "labels"
      ? [...new Set([...labels.map(({ name }) => name), ...had])].map((name) => ({ value: name, text: name }))
      : [...new Set([...(meta?.assignable ?? []), ...had])].map((login) => ({ value: login, text: login === meta?.viewer ? `${login} (you)` : login }));
  const changed = add.length + remove.length > 0;
  return (
    <SheetFrame
      title={`${what === "labels" ? "Labels" : "Assignees"} of ${itemName(item)}`}
      command={changed ? writeArgs(tab.repo, action) : null}
      footer={<Buttons busy={write.busy} problem={write.problem} confirm="Apply on GitHub" disabled={!changed} onConfirm={() => write.run(action)} />}
    >
      <PickList
        options={options}
        chosen={chosen}
        multiple
        filterLabel={what === "labels" ? "Filter labels" : "Filter people"}
        onChange={setChosen}
        render={(value) =>
          what === "labels" ? (
            <Label label={labels.find(({ name }) => name === value) ?? { name: value, color: "888888" }} />
          ) : (
            <>
              <Avatar login={value} /> {value}
            </>
          )
        }
      />
    </SheetFrame>
  );
}

function SetStateSheet({ item, open }: { item: ListItem; open: boolean }) {
  const tab = useTab();
  const [reason, setReason] = useState<"completed" | "not planned">("completed");
  const write = useWrite(open ? "Reopened it" : "Closed it");
  const action = { kind: "set-state", item: item.kind, number: item.number, open, ...(item.kind === "issue" && !open && { reason }) } as const;
  return (
    <SheetFrame
      title={`${open ? "Reopen" : "Close"} ${itemName(item)}?`}
      command={writeArgs(tab.repo, action)}
      footer={<Buttons busy={write.busy} problem={write.problem} confirm={open ? "Reopen on GitHub" : "Close on GitHub"} onConfirm={() => write.run(action)} />}
    >
      <p className="sheet-about">{item.title}</p>
      {item.kind === "issue" && !open && (
        <div className="choices" role="radiogroup" aria-label="Why">
          <label>
            <input type="radio" name="reason" checked={reason === "completed"} onChange={() => setReason("completed")} />
            <b>Completed</b> <span className="muted">Done, closed, fixed, resolved.</span>
          </label>
          <label>
            <input type="radio" name="reason" checked={reason === "not planned"} onChange={() => setReason("not planned")} />
            <b>Not planned</b> <span className="muted">Won't fix, can't repeat, duplicate, stale.</span>
          </label>
        </div>
      )}
      {item.kind === "pr" && !open && <p className="muted">Its branch stays; you can reopen it later.</p>}
    </SheetFrame>
  );
}

function ReadySheet({ item, ready }: { item: ListItem; ready: boolean }) {
  const tab = useTab();
  const write = useWrite(ready ? "Marked it ready for review" : "Converted it to a draft");
  const action = { kind: "ready", number: item.number, ready } as const;
  return (
    <SheetFrame
      title={ready ? `Mark #${item.number} ready for review?` : `Convert #${item.number} to a draft?`}
      command={writeArgs(tab.repo, action)}
      footer={<Buttons busy={write.busy} problem={write.problem} confirm="Change on GitHub" onConfirm={() => write.run(action)} />}
    >
      <p className="sheet-about">{item.title}</p>
      <p className="muted">{ready ? "Reviewers it asks are told it's ready." : "It can't be merged while it's a draft."}</p>
    </SheetFrame>
  );
}

function CheckoutSheet({ item }: { item: ListItem }) {
  const tab = useTab();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<string[] | null>(null);
  const checkOut = async (evenIfChanged: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const reply = (await send({ kind: "checkout", number: item.number, evenIfChanged })) as CheckoutReply;
      if (!reply.checkedOut) return setChangedFiles(reply.changedFiles);
      tab.showSheet(null);
      tab.toast(`Checked out ${reply.branch ?? item.headRef}`);
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SheetFrame
      title={`Check out #${item.number} here?`}
      command={checkoutArgs(tab.repo, item.number)}
      footer={<Buttons busy={busy} problem={problem} confirm={changedFiles ? "Check out anyway" : "Check out"} onConfirm={() => checkOut(changedFiles !== null)} />}
    >
      <p className="sheet-about">
        Switches this workspace's folder to <code className="branch">{item.headRef}</code>
        {tab.state.branch && (
          <>
            {" "}
            from <code className="branch">{tab.state.branch}</code>
          </>
        )}
        . Agents working here see the switch too.
      </p>
      {changedFiles && (
        <div className="warn">
          ⚠ The working tree has uncommitted changes, which git carries over, or refuses to if they clash:
          <ul className="changed-files">
            {changedFiles.slice(0, 8).map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
            {changedFiles.length > 8 && <li className="muted">and {changedFiles.length - 8} more</li>}
          </ul>
        </div>
      )}
    </SheetFrame>
  );
}

function NewIssueSheet() {
  const tab = useTab();
  const [title, setTitle] = useDraft("new-issue:title");
  const [body, setBody, forgetBody] = useDraft("new-issue:body");
  const write = useWrite("Created the issue");
  const action = { kind: "create-issue", title: title.trim(), body } as const;
  return (
    <SheetFrame
      title={`New issue in ${tab.repo.owner}/${tab.repo.name}`}
      command={title.trim() ? writeArgs(tab.repo, action) : null}
      footer={
        <Buttons
          busy={write.busy}
          problem={write.problem}
          confirm="Create on GitHub"
          disabled={!title.trim()}
          onConfirm={() =>
            write.run(action, (reply) => {
              setTitle("");
              forgetBody();
              const created = (reply as { number?: number }).number;
              if (created) tab.openNumber("issue", created);
            })
          }
        />
      }
    >
      <input className="title-input" aria-label="Title" placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      <WriteBox value={body} onChange={setBody} label="Description" placeholder="Describe it in Markdown…" />
    </SheetFrame>
  );
}

function SaveViewSheet({ item, query }: { item: ListItem["kind"]; query: string }) {
  const tab = useTab();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = () =>
    send({ kind: "save-view", item, name, query }).then(
      () => (tab.showSheet(null), tab.toast(`Saved the view ${name.trim()}`)),
      (error) => setProblem(failureText(error)),
    );
  return (
    <SheetFrame title="Save this search as a view" command={null} footer={<Buttons busy={false} problem={problem} confirm="Save view" disabled={!name.trim()} onConfirm={save} />}>
      <p className="muted">
        <code>{query}</code>
      </p>
      <input
        className="title-input"
        aria-label="View name"
        placeholder="Name, e.g. Bugs I reported"
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && name.trim() && void save()}
      />
      <p className="muted">Kept for this workspace, with its count beside the other views.</p>
    </SheetFrame>
  );
}

const SOURCE_WORDS = { workspace: "this workspace's own text", every: "the text for every workspace", "built-in": "the built-in text" } as const;

/** The messages the tab sends the agent, as this workspace or every workspace has them, with what each placeholder stands for. */
function PromptsSheet() {
  const tab = useTab();
  const overrides = tab.state.prompts;
  const [kind, setKind] = useState<PromptKind>("review");
  const [scope, setScope] = useState<PromptScope>("workspace");
  const own = overrides[scope][kind];
  const startText = own ?? inheritedTemplate(kind, overrides, scope);
  const [text, setText] = useState(startText);
  const box = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setText(startText), [startText]);
  const save = (next: string | null, done: string) => {
    setBusy(true);
    setProblem(null);
    send({ kind: "set-prompt", scope, prompt: kind, text: next }).then(
      () => (setBusy(false), tab.toast(done)),
      (error) => (setBusy(false), setProblem(failureText(error))),
    );
  };
  const insert = (name: string) => {
    const at = box.current?.selectionStart ?? text.length;
    const placed = `{${name}}`;
    setText(text.slice(0, at) + placed + text.slice(box.current?.selectionEnd ?? at));
    requestAnimationFrame(() => box.current?.setSelectionRange(at + placed.length, at + placed.length));
  };
  const inUse = templateSource(kind, overrides);
  const shadowed = scope === "every" && overrides.workspace[kind] !== undefined;
  const fallsBackToEvery = scope === "workspace" && overrides.every[kind] !== undefined;
  return (
    <SheetFrame
      title="Prompts for the agent"
      command={null}
      footer={
        <>
          {problem && <p className="sheet-problem">⚠ {problem}</p>}
          {own !== undefined && (
            <button type="button" className="button" disabled={busy} onClick={() => save(null, fallsBackToEvery ? "This workspace uses every workspace's text again" : "Put back the built-in text")}>
              {fallsBackToEvery ? "Use every workspace's text" : "Put back the built-in"}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button" onClick={() => tab.showSheet(null)}>
            Close
          </button>
          <button type="button" className="button primary" disabled={busy || !text.trim() || text === startText} onClick={() => save(text, "Saved the prompt")}>
            {busy ? <Spinner /> : null} Save
          </button>
        </>
      }
    >
      <div className="prompt-picks">
        <select aria-label="Prompt" value={kind} onChange={(event) => setKind(event.target.value as PromptKind)}>
          {PROMPT_KINDS.map((each) => (
            <option key={each} value={each}>
              {PROMPTS[each].name}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="For">
          {(["workspace", "every"] as const).map((each) => (
            <button key={each} type="button" aria-pressed={scope === each} className={scope === each ? "on" : ""} onClick={() => setScope(each)}>
              {each === "workspace" ? "This workspace" : "Every workspace"}
            </button>
          ))}
        </div>
      </div>
      <p className="sheet-about">
        {PROMPTS[kind].sentBy} This workspace uses {SOURCE_WORDS[inUse]}.{shadowed && " This workspace has its own text, so a change here reaches it only once you take that out."}
      </p>
      <textarea ref={box} className="prompt-text" aria-label="Prompt text" value={text} onChange={(event) => setText(event.target.value)} rows={10} spellCheck={false} />
      <div className="placeholders" aria-label="Placeholders">
        {PROMPTS[kind].placeholders.map(({ name, means }) => (
          <button key={name} type="button" className="chip" data-hint={means} onClick={() => insert(name)}>
            {`{${name}}`}
          </button>
        ))}
      </div>
      <p className="muted small">A paragraph whose placeholders all come out empty is left out.</p>
    </SheetFrame>
  );
}

/** A message filled in, to change once before it goes; the saved prompt stays as it is. */
function EditMessageSheet({ messages }: { messages: Message[] }) {
  const tab = useTab();
  const [chosen, setChosen] = useState(0);
  const message = messages[chosen]!;
  const [text, setText] = useState(message.text);
  useEffect(() => setText(message.text), [message]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = (where: "new" | "here") => {
    setBusy(true);
    setProblem(null);
    const sending = where === "new" ? window.mirador.startConversation(text) : window.mirador.prompt(text);
    sending.then(
      () => (tab.showSheet(null), tab.toast(where === "new" ? "Started a conversation with your message" : "Sent to this conversation's agent")),
      (error) => (setBusy(false), setProblem(failureText(error))),
    );
  };
  return (
    <SheetFrame
      title="Edit the message first"
      command={null}
      footer={
        <>
          {problem && <p className="sheet-problem">⚠ {problem}</p>}
          <span className="spacer" />
          <button type="button" className="button" onClick={() => tab.showSheet(null)}>
            Cancel
          </button>
          {message.sends.includes("here") && (
            <button type="button" className={`button ${message.sends.includes("new") ? "" : "primary"}`} disabled={busy || !text.trim()} onClick={() => go("here")}>
              Send to this conversation
            </button>
          )}
          {message.sends.includes("new") && (
            <button type="button" className="button primary" disabled={busy || !text.trim()} onClick={() => go("new")}>
              {busy ? <Spinner /> : null} Start a conversation
            </button>
          )}
        </>
      }
    >
      {messages.length > 1 && (
        <div className="segmented" role="group" aria-label="Which message">
          {messages.map(({ label }, index) => (
            <button key={label} type="button" aria-pressed={chosen === index} className={chosen === index ? "on" : ""} onClick={() => setChosen(index)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <textarea className="prompt-text" aria-label="Message" value={text} onChange={(event) => setText(event.target.value)} rows={12} autoFocus />
      <p className="muted small">Only this message changes. Prompts for the agent, in the repository's menu, change what every one starts from.</p>
    </SheetFrame>
  );
}

export function SheetView({ sheet }: { sheet: Sheet }) {
  switch (sheet.kind) {
    case "comment":
      return <CommentSheet item={sheet.item} closeToo={sheet.closeToo} />;
    case "review":
      return <ReviewSheet item={sheet.item} />;
    case "merge":
      return <MergeSheet item={sheet.item} />;
    case "labels":
    case "assignees":
      return <PickSheet item={sheet.item} what={sheet.kind} />;
    case "set-state":
      return <SetStateSheet item={sheet.item} open={sheet.open} />;
    case "ready":
      return <ReadySheet item={sheet.item} ready={sheet.ready} />;
    case "checkout":
      return <CheckoutSheet item={sheet.item} />;
    case "new-issue":
      return <NewIssueSheet />;
    case "prompts":
      return <PromptsSheet />;
    case "edit-message":
      return <EditMessageSheet messages={sheet.messages} />;
    case "save-view":
      return <SaveViewSheet item={sheet.item} query={sheet.query} />;
  }
}
