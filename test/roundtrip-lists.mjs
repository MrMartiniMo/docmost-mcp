/**
 * Round-trip test for nested lists and blockquotes.
 *
 * A sublist lost its indentation from the second item onwards, so those items
 * came back one level up and the hierarchy was gone for good. On a numbered list
 * it was worse: the parent list was split in two, with the sublist stranded
 * between the halves.
 *
 * It compares the SHAPE of the tree rather than node counts, and that
 * distinction is the point: this bug does not lose content, it MOVES it. A check
 * that only counts losses reports "ok" on a wrecked document.
 *
 * NEGATIVE CONTROL: the same markdown is re-flattened by hand and the test
 * requires THAT to break the tree. Without it, a green result would prove
 * nothing about whether the check can fail at all.
 *
 * usage: node test/roundtrip-lists.mjs
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const NL = String.fromCharCode(10);
const p = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const li = (...content) => ({ type: "listItem", content });
const ul = (...content) => ({ type: "bulletList", content });
const ol = (...content) => ({ type: "orderedList", attrs: { start: 1 }, content });

const cases = {
  "sublist under a bullet": ul(
    li(p("first"), ul(li(p("a")), li(p("b")), li(p("c")))),
    li(p("second")),
  ),
  "sublist under a numbered item": ol(
    li(p("one"), ul(li(p("a")), li(p("b")), li(p("c")))),
    li(p("two")),
  ),
  "two levels of nesting": ul(
    li(p("top"), ul(li(p("mid"), ul(li(p("deep one")), li(p("deep two")))), li(p("mid two")))),
  ),
  "list inside a blockquote": {
    type: "blockquote",
    content: [p("quoted intro"), ul(li(p("alpha")), li(p("beta")), li(p("gamma")))],
  },
};

const shape = (n) => n.type + (n.content ? "(" + n.content.map(shape).join(",") + ")" : "");
const text = (n) => (n.type === "text" ? n.text || "" : (n.content || []).map(text).join(""));
const roundTrip = async (md) => generateJSON(await marked.parse(md), tiptapExtensions);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

for (const [name, node] of Object.entries(cases)) {
  const doc = { type: "doc", content: [node] };
  const md = convertProseMirrorToMarkdown(doc);
  const back = await roundTrip(md);

  check(shape(doc) === shape(back), `${name}: the tree shape survives`);
  check(
    text(doc).replace(/\s+/g, "") === text(back).replace(/\s+/g, ""),
    `${name}: no text is lost`,
  );
  check(
    md === convertProseMirrorToMarkdown(back),
    `${name}: stable, a second pass yields the same markdown`,
  );

  if (shape(doc) !== shape(back)) {
    console.log(`        before: ${shape(doc)}`);
    console.log(`        after : ${shape(back)}`);
    console.log(`        markdown: ${JSON.stringify(md)}`);
  }
}

// NEGATIVE CONTROL: strip the continuation indent by hand. That is precisely
// what the bug used to produce, so the tree MUST break here.
const doc = { type: "doc", content: [cases["sublist under a bullet"]] };
const flattened = convertProseMirrorToMarkdown(doc)
  .split(NL)
  .map((line) => line.replace(/^\s+/, ""))
  .join(NL);
const broken = await roundTrip(flattened);
check(
  shape(doc) !== shape(broken),
  "negative control: without the continuation indent the hierarchy DOES break",
);

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("PASSED: all checks");
