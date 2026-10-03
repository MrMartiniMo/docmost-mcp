/**
 * Round-trip test for emphasis that comes back as LITERAL asterisks (or loses
 * its tildes) after a read-modify-write. Three independent generators, all
 * found on a real wiki of ~480 pages:
 *
 * 1. Emphasis that CARRIES ON from one node to the next. A bold run with a link
 *    inside is stored split into nodes (bold / link+bold / bold) and each one
 *    opened and closed its own bold: `**[PDF](u)****,**`. The four asterisks came
 *    back as text.
 *
 * 2. Emphasis between a `<` and a `>` in the same paragraph. marked treats that
 *    stretch as if it were an HTML tag and does not look for emphasis inside it:
 *    `warn if <90 **or** bounce >5%` comes back with literal asterisks.
 *
 * 3. `*` and `~` that are TEXT. marked reads a single tilde as strikethrough, so
 *    `~5.000→~700` came back struck through and without its tildes.
 *
 * And what the fix must NOT touch: `<` inside code (inline and block) and inside
 * an aligned paragraph, which is emitted as an HTML block.
 *
 * NEGATIVE CONTROL: the markdown the converter used to emit for the first two
 * cases goes through the same cycle and the test requires THAT to leave literal
 * asterisks. If it does not, this test measures nothing.
 *
 * usage: node test/roundtrip-emphasis-literals.mjs
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const link = (href) => ({ type: "link", attrs: { href } });
const t = (text, ...marks) => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const p = (...content) => ({ type: "paragraph", content });
const doc = (...content) => ({ type: "doc", content });

const text = (n) => (n.type === "text" ? n.text || "" : (n.content || []).map(text).join(""));
const walk = function* (n) { yield n; for (const c of n.content || []) yield* walk(c); };
const withMark = (d, type) =>
  [...walk(d)].filter((n) => n.type === "text" && (n.marks || []).some((m) => m.type === type)).map((n) => n.text).join("|");
const cycle = async (md) => generateJSON(await marked.parse(md), tiptapExtensions);

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " :: " + detail}`);
  if (!ok) failures.push(name);
};

const cases = [
  {
    name: "bold split by links (bold / link+bold / bold)",
    d: doc(p(t("Formats:", "bold"), t(" "), t("PDF", link("https://x.org/a"), "bold"), t(",", "bold"), t(" "),
      t("Google Docs", link("https://x.org/b"), "bold"), t(".", "bold"))),
    bold: "Formats:|PDF|,|Google Docs|.",
  },
  {
    name: "same with the marks in the other order (bold, link)",
    d: doc(p(t("mail@x.org", "bold", link("mailto:mail@x.org")), t(")", "bold"), t(", answers well."))),
    bold: "mail@x.org|)",
  },
  {
    name: "italic carrying on from node to node",
    d: doc(p(t("note", "italic"), t("linked", link("https://x.org"), "italic"), t("on", "italic"))),
    italic: "note|linked|on",
  },
  {
    name: "bold between < and > in the same paragraph",
    d: doc(p(t("warn if reputation <90 "), t("or", "bold"), t(" bounce >5%; alert if <80 "), t("or", "bold"), t(" >10%"))),
    bold: "or|or",
  },
  {
    name: "text that looks like a tag does not vanish",
    d: doc(p(t("use <id> and then <b>this</b> and "), t("bold", "bold"))),
    bold: "bold",
  },
  {
    name: "approximation tildes do not become strikethrough",
    d: doc(p(t("rates (~5.000→~700 in print only; "), t("note", "bold"), t(")"))),
    bold: "note",
  },
  {
    name: "literal asterisk next to an italic",
    d: doc(p(t("*"), t("Fix (born in our fork,", "italic"), t(" "), t("#1176", link("https://x.org/1176"), "bold", "italic"),
      t("):", "italic"), t("*"), t(" validate "), t("127 in ALL THREE", "bold"))),
    bold: "#1176|127 in ALL THREE",
    italic: "Fix (born in our fork,|#1176|):",
  },
  {
    name: "literal backslash before an asterisk",
    d: doc(p(t("path C:\\x\\*.txt and "), t("end", "bold"))),
    bold: "end",
  },
  {
    name: "inline code with < stays literal",
    d: doc(p(t("route "), t("device=<id>", "code"), t(" and "), t("end", "bold"))),
    bold: "end",
  },
  {
    name: "code block with < stays literal",
    d: doc({ type: "codeBlock", attrs: { language: "html" }, content: [t("<div>\n  <b>x</b>\n</div>")] }),
  },
  {
    name: "a < b with a space after is left alone",
    d: doc(p(t("if a < b then "), t("fine", "bold"))),
    bold: "fine",
  },
];

for (const c of cases) {
  const md = convertProseMirrorToMarkdown(c.d);
  const back = await cycle(md);
  // trimEnd: a code block gains a trailing newline in the cycle; that is older
  // than this fix and out of its scope.
  const tA = text(c.d).trimEnd(), tB = text(back).trimEnd();
  check(`${c.name} · same text`, tA === tB, `${JSON.stringify(tA)} -> ${JSON.stringify(tB)} (md: ${JSON.stringify(md)})`);
  if (c.bold !== undefined) {
    const n = withMark(back, "bold");
    check(`${c.name} · bold`, n.replace(/\s+/g, "") === c.bold.replace(/\s+/g, ""), `${JSON.stringify(n)} (md: ${JSON.stringify(md)})`);
  }
  if (c.italic !== undefined) {
    const n = withMark(back, "italic");
    check(`${c.name} · italic`, n.replace(/\s+/g, "") === c.italic.replace(/\s+/g, ""), `${JSON.stringify(n)} (md: ${JSON.stringify(md)})`);
  }
  // Stable: a second cycle keeps text and marks. The TREE is compared, not the
  // markdown, because the parser may return marks in another order (link, bold
  // instead of bold, link), which changes the markdown without changing anything.
  const back2 = await cycle(convertProseMirrorToMarkdown(back));
  const sig = (d) => [text(d).trimEnd(), withMark(d, "bold"), withMark(d, "italic")].join("#");
  check(`${c.name} · stable cycle`, sig(back2) === sig(back), `${sig(back)} != ${sig(back2)}`);
}

// Aligned paragraph: it goes inside an HTML block, where a backslash would print.
{
  const d = doc({ type: "paragraph", attrs: { textAlign: "center" }, content: [t("a <90 b")] });
  const md = convertProseMirrorToMarkdown(d);
  check("aligned paragraph gets no backslash", !md.includes("\\"), JSON.stringify(md));
}

// NEGATIVE CONTROL: what the converter used to emit.
const old = [
  "**Formats:** **[PDF](https://x.org/a)****,** **[Google Docs](https://x.org/b)****.**",
  "warn if reputation <90 **or** bounce >5%; alert if <80 **or** >10%",
];
for (const md of old) {
  const tB = text(await cycle(md));
  check(`negative control leaves asterisks: ${md.slice(0, 40)}`, tB.includes("**"), `no asterisks: ${JSON.stringify(tB)}`);
}

if (failures.length) {
  console.log(`\n${failures.length} checks FAIL`);
  process.exit(1);
}
console.log("\nOK: all checks pass");
