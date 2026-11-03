import type { ItemState, ListItem } from "../github/model.ts";
import { avatarOf, labelInk } from "../github/format.ts";
import type { Label as LabelData } from "../github/model.ts";

const STATE_WORDS: Record<ListItem["kind"], Record<ItemState, string>> = {
  pr: { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" },
  issue: { open: "Open", draft: "Open", merged: "Closed", closed: "Closed" },
};

export const stateWord = (item: Pick<ListItem, "kind" | "state" | "stateReason">) =>
  item.kind === "issue" && item.state === "closed" && item.stateReason === "not planned" ? "Not planned" : STATE_WORDS[item.kind][item.state];

/** The state's class: open, draft, merged, closed, or done for an issue closed as completed. */
export const stateClass = (item: Pick<ListItem, "kind" | "state" | "stateReason">) =>
  item.kind === "issue" && item.state === "closed" && item.stateReason !== "not planned" ? "done" : item.state;

export function StateIcon({ item }: { item: Pick<ListItem, "kind" | "state" | "stateReason"> }) {
  const className = `state-icon ${stateClass(item)}`;
  if (item.kind === "pr") {
    return (
      <svg className={className} viewBox="0 0 16 16" aria-label={stateWord(item)} role="img">
        <circle cx="4" cy="3.5" r="1.7" />
        <circle cx="4" cy="12.5" r="1.7" />
        <circle cx="12" cy="12.5" r="1.7" />
        <path d="M4 5.2v5.6" />
        {item.state === "merged" ? <path d="M4 5.2c0 3.5 3 4.6 8 5.6" /> : item.state === "closed" ? <path d="m10.3 2.3 3.4 3.4m0-3.4-3.4 3.4" /> : <path d="M12 10.8V6.5a2 2 0 0 0-2-2H8m1.4-1.6L7.8 4.5l1.6 1.6" />}
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 16 16" aria-label={stateWord(item)} role="img">
      <circle cx="8" cy="8" r="6.2" />
      {stateClass(item) === "done" ? <path d="m5.3 8.2 1.9 1.9 3.6-3.8" /> : item.state === "closed" ? <path d="m5.5 10.5 5-5" /> : <circle cx="8" cy="8" r="1.4" className="dot" />}
    </svg>
  );
}

export function Avatar({ login, size = 16 }: { login: string; size?: number }) {
  const { initial, color } = avatarOf(login);
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.55 }} title={login} aria-hidden>
      {initial}
    </span>
  );
}

export function Label({ label }: { label: LabelData }) {
  return (
    <span className="label" style={{ background: `#${label.color}`, color: labelInk(label.color) }}>
      {label.name}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" role="status" />;
}

export const CheckMark = ({ state }: { state: "passed" | "failed" | "pending" | "skipped" }) => (
  <span className={`check-mark ${state}`} aria-label={state}>
    {{ passed: "✓", failed: "✗", pending: "●", skipped: "–" }[state]}
  </span>
);
