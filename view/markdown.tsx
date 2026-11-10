import { gemoji } from "gemoji";
import type { Root, RootContent } from "hast";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const emojiByShortcode = new Map(gemoji.flatMap(({ emoji, names }) => names.map((name) => [name.toLowerCase(), emoji] as const)));

const shortcodePattern = /:([a-z0-9_+-]+):/gi;

const withEmoji = (value: string) => value.replace(shortcodePattern, (match, name: string) => emojiByShortcode.get(name.toLowerCase()) ?? match);

const codeTags = new Set(["code", "pre"]);

const replaceShortcodes = (node: RootContent) => {
  if (node.type === "text") node.value = withEmoji(node.value);
  else if (node.type === "element" && !codeTags.has(node.tagName)) node.children.forEach(replaceShortcodes);
};

/** Shortcodes in the HTML a comment holds are text only after it is parsed, so they are replaced there, not in the Markdown. */
const rehypeEmojiShortcodes = () => (tree: Root) => tree.children.forEach(replaceShortcodes);

const openOutside = (href: string | undefined) => (event: React.MouseEvent) => {
  event.preventDefault();
  if (href && /^https?:/i.test(href)) window.mirador.openLink(href);
};

/**
 * GitHub's Markdown, with the HTML it may hold kept and sanitised as GitHub sanitises it, and its emoji shortcodes
 * shown as emoji; links open in the browser, and pictures, which the sandboxed frame can't load, stay links to them.
 */
export function MarkdownText({ text }: { text: string }) {
  if (!text.trim()) return <p className="muted">No description.</p>;
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeEmojiShortcodes, rehypeSanitize]}
        components={{
          a: ({ href, children }) => (
            <a href={href} onClick={openOutside(href)}>
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <a className="picture-link" href={typeof src === "string" ? src : undefined} onClick={openOutside(typeof src === "string" ? src : undefined)}>
              🖼 {alt || "Picture"}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
