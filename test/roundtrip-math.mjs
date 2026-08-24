/**
 * Round-trip test for Docmost's maths nodes.
 *
 * Docmost stores inline maths as a `mathInline` node whose content lives in
 * `attrs.text`, not in a text node. The converter emitted `$text$` and
 * tiptapExtensions registered no maths extension at all, so generateJSON had no
 * schema to rebuild the node: it came back as literal text and the node was gone.
 *
 * NEGATIVE CONTROL: the same document is serialised the old way and the test
 * requires THAT to lose the nodes. Without it, a green result would prove nothing
 * about whether the check can fail at all.
 *
 * usage: node test/roundtrip-math.mjs
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const LF = String.fromCharCode(10);

// The trailing newline is deliberate: that is how Docmost stores these nodes on
// pages imported from a word processor, and it is the detail that goes missing
// if the value is serialised as loose text.
const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Dear " },
        { type: "mathInline", attrs: { text: "NAME" + LF } },
        { type: "text", text: ", your reference is " },
        { type: "mathInline", attrs: { text: "REF" + LF } },
        { type: "text", text: "." },
      ],
    },
    // Currency, which must NOT be mistaken for maths.
    { type: "paragraph", content: [{ type: "text", text: "It costs $5 and then $10 a month." }] },
    { type: "mathBlock", attrs: { text: "E = mc^2" } },
  ],
};

const walk = function* (n) { yield n; for (const c of n.content || []) yield* walk(c); };
const count = (d, t) => [...walk(d)].filter((n) => n.type === t).length;
const values = (d, t) => [...walk(d)].filter((n) => n.type === t).map((n) => n.attrs?.text);
const text = (n) => (n.type === "text" ? n.text || "" : (n.content || []).map(text).join(""));
const roundTrip = async (md) => generateJSON(await marked.parse(md), tiptapExtensions);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const md = convertProseMirrorToMarkdown(doc);
console.log("--- emitted markdown ---");
console.log(md);
console.log();

const back = await roundTrip(md);

check(count(back, "mathInline") === 2, `both mathInline nodes survive (found ${count(back, "mathInline")})`);
check(count(back, "mathBlock") === 1, `the mathBlock survives (found ${count(back, "mathBlock")})`);
check(
  JSON.stringify(values(back, "mathInline")) === JSON.stringify(["NAME" + LF, "REF" + LF]),
  `their text comes back intact, trailing newline included: ${JSON.stringify(values(back, "mathInline"))}`,
);
check(
  text(back).includes("It costs $5 and then $10 a month."),
  "currency amounts are NOT turned into maths",
);
check(!text(back).includes("$NAME"), "the placeholder does not come back as literal dollar-wrapped text");
check(md === convertProseMirrorToMarkdown(back), "stable: a second pass yields the same markdown");

// Characters that break a naive escaper. The parser behind generateJSON decodes
// `&amp;` and `&quot;` but NOT `&lt;` or numeric entities, so over-escaping
// corrupts the value just as silently as under-escaping.
//
// String.raw is deliberate: in an ordinary JS string the backslash is eaten, and
// the backslash is THE character of maths. Written without it this case passed
// green while testing nothing.
const awkward = [
  String.raw`a &amp; b < c > d "quotes" and \ backslash`,
  String.raw`\frac{1}{2} + \alpha_{i}`,
  String.raw`x^2 \leq 100 \% $ #`,
];
for (const t of awkward) {
  const one = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mathInline", attrs: { text: t } }] }] };
  const got = values(await roundTrip(convertProseMirrorToMarkdown(one)), "mathInline")[0];
  check(got === t, `survives intact: ${JSON.stringify(t)} (got ${JSON.stringify(got)})`);
}

// Inside a list item, twice. The value ends in a newline and list indentation is
// applied per line, so that second line lands INSIDE the attribute. If the value
// drifted it would grow a little on every write, unnoticed, because this is not a
// text node and text-based audits never look at it.
let inList = {
  type: "doc",
  content: [{ type: "bulletList", content: [{ type: "listItem", content: [{
    type: "paragraph",
    content: [
      { type: "text", text: "Contact: " },
      { type: "mathInline", attrs: { text: "NAME" + LF } },
      { type: "text", text: ", " },
      { type: "mathInline", attrs: { text: "EMAIL" + LF } },
      { type: "text", text: " (end)" },
    ],
  }] }] }],
};
const expected = JSON.stringify(values(inList, "mathInline"));
for (let i = 1; i <= 2; i++) {
  inList = await roundTrip(convertProseMirrorToMarkdown(inList));
  check(
    JSON.stringify(values(inList, "mathInline")) === expected,
    `pass ${i} inside a list item: the value does not drift (${JSON.stringify(values(inList, "mathInline"))})`,
  );
}

// NEGATIVE CONTROL: serialise the old way and require the nodes to be lost.
const oldStyle = md.replace(
  /<span data-type="mathInline" data-text="([^"]*)"><\/span>/g,
  (_m, x) => "$" + x + "$",
);
check(
  count(await roundTrip(oldStyle), "mathInline") === 0,
  "negative control: the old `$...$` serialisation DOES lose the nodes",
);

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("PASSED: all checks");
