/**
 * Round-trip test for hard line breaks (Shift+Enter).
 *
 * update_page rewrites a page by turning its ProseMirror content into Markdown
 * and parsing it back, so anything the converter cannot express is lost on every
 * write. hardBreak was serialized as a bare newline, which Markdown defines as a
 * SOFT break, so `marked` correctly rendered it as a space: every hard break in
 * the page disappeared, with no warning and a successful return.
 *
 * It is a hard failure to notice by eye, because the mutation preserves length:
 * "a\nb\nc" and "a b c" are both five characters, so no size check catches it,
 * and reading the page back looks fine because it is the read side that is lossy.
 *
 * The test carries a NEGATIVE CONTROL on purpose: it runs the same cycle again
 * with the old serialization and requires THAT one to lose the breaks. Without
 * it, a green result would not prove the test measures anything.
 *
 * usage:  node test/roundtrip-hardbreaks.mjs
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Line one" },
        { type: "hardBreak" },
        { type: "text", text: "Line two" },
        { type: "hardBreak" },
        { type: "text", text: "Line three" },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "Plain paragraph." }] },
  ],
};

const count = (n, acc = {}) => {
  acc[n.type] = (acc[n.type] || 0) + 1;
  for (const c of n.content || []) count(c, acc);
  return acc;
};

const textOf = (n) =>
  n.type === "text" ? n.text || "" : (n.content || []).map(textOf).join("");

const cycle = async (markdown) =>
  generateJSON(await marked.parse(markdown), tiptapExtensions);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "  ok   " : "  FAIL "} ${what}`);
  if (!ok) failures.push(what);
};

const md = convertProseMirrorToMarkdown(doc);
console.log("--- markdown emitted by the converter ---");
console.log(JSON.stringify(md));

const back = await cycle(md);
console.log("\nbefore:", JSON.stringify(count(doc)));
console.log("after :", JSON.stringify(count(back)));
console.log("\n--- checks ---");

check(
  (count(back).hardBreak || 0) === 2,
  `both hard breaks survive the round trip (got ${count(back).hardBreak || 0})`,
);

const paragraph = (back.content || []).find((n) => n.type === "paragraph");
check(
  textOf(paragraph) === "Line oneLine twoLine three",
  `the paragraph text gains no stray spaces: ${JSON.stringify(textOf(paragraph))}`,
);

// NEGATIVE CONTROL: the same cycle with the old serialization. If this does NOT
// lose the breaks, the check above is not measuring anything.
const oldMd = md.replace(/\\\n/g, "\n");
const oldBack = await cycle(oldMd);
const oldHb = count(oldBack).hardBreak || 0;
check(
  oldHb === 0,
  `negative control: the old serialization DOES lose them (got ${oldHb}, expected 0)`,
);

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("OK: all checks pass");
