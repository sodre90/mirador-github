import { useState } from "react";
import type { GhProblem, TabState } from "../github/model.ts";
import { repoArg, repoLabel } from "../github/remote.ts";
import { failureText, send } from "./bridge.ts";
import { Spinner } from "./icons.tsx";

const ANOTHER = "another";

/** The workspace isn't connected yet: its GitHub remotes to pick from, or a repository of the user's naming. */
export function Connect({ state }: { state: TabState }) {
  const [picked, setPicked] = useState(state.candidates[0] ? repoArg(state.candidates[0].repo) : ANOTHER);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const repo = picked === ANOTHER ? typed.trim() : picked;
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await send({ kind: "connect", repo });
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center">
      <div
        className="card connect"
        onKeyDown={(event) => {
          if (event.key === "Enter" && repo && !busy) void connect();
        }}
      >
        <h2>Connect this workspace to GitHub</h2>
        <p className="muted">{state.candidates.length > 0 ? "Found in this folder's git remotes:" : "This folder's git remotes point at no GitHub repository. Name one:"}</p>
        <div className="choices" role="radiogroup" aria-label="Repository">
          {state.candidates.map(({ remote, repo: candidate }) => (
            <label key={remote}>
              <input type="radio" name="repo" checked={picked === repoArg(candidate)} onChange={() => setPicked(repoArg(candidate))} />
              <b>{repoLabel(candidate)}</b> <span className="muted">
                {remote} · {candidate.host}
              </span>
            </label>
          ))}
          <label>
            <input type="radio" name="repo" checked={picked === ANOTHER} onChange={() => setPicked(ANOTHER)} />
            <b>Another repository</b>
            <input
              className="inline-input"
              aria-label="Another repository"
              placeholder="owner/name, host/owner/name or its URL"
              value={typed}
              onFocus={() => setPicked(ANOTHER)}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
        </div>
        {problem && <p className="sheet-problem">⚠ {problem}</p>}
        <div className="sheet-buttons">
          <span className="spacer" />
          <button type="button" className="button primary" disabled={!repo || busy} onClick={() => void connect()}>
            {busy ? <Spinner /> : null} Connect
          </button>
        </div>
        <p className="muted small">Everything goes through the gh signed in on this computer. Mirador keeps no tokens.</p>
      </div>
    </div>
  );
}

const copy = (text: string) => void navigator.clipboard?.writeText(text);

/** gh can't answer at all: what's wrong, and the command that puts it right. */
export function Problem({ problem, onRetry }: { problem: GhProblem; onRetry(): void }) {
  const command = problem.code === "not-installed" ? "brew install gh" : problem.code === "not-signed-in" ? `gh auth login${problem.host && problem.host !== "github.com" ? ` --hostname ${problem.host}` : ""}` : null;
  const title = problem.code === "not-installed" ? "gh isn't installed" : problem.code === "not-signed-in" ? `gh isn't signed in to ${problem.host ?? "GitHub"}` : "gh couldn't reach GitHub";
  return (
    <div className="center">
      <div className="card problem">
        <h2>{title}</h2>
        {command ? (
          <>
            <p className="muted">Run this in a terminal on this computer, then try again:</p>
            <pre className="command">{command}</pre>
          </>
        ) : (
          <p className="muted">{problem.message}</p>
        )}
        <div className="sheet-buttons">
          <span className="spacer" />
          {command && (
            <button type="button" className="button" onClick={() => copy(command)}>
              Copy
            </button>
          )}
          <button type="button" className="button primary" onClick={onRetry}>
            Try again
          </button>
        </div>
        {problem.code === "not-installed" && <p className="muted small">On Linux and Windows, see cli.github.com for how to install it.</p>}
      </div>
    </div>
  );
}
