/**
 * Round-trip test for text that merely LOOKS like markdown.
 *
 * A paragraph whose text begins with a block marker came back as that block: the
 * prose turned into structure. The converter emitted the node's text verbatim, so
 * a paragraph reading "- Rafa" became a list item on the way back.
 *
 * THIS TEST HAS TWO HALVES AND THE SECOND MATTERS MORE. Over-escaping puts
 * visible backslashes in the rendered page, which is worse and far more
 * widespread than the bug being fixed. So there are as many "this must NOT be
 * touched" cases as "this must be escaped" ones.
 *
 * NEGATIVE CONTROL: the backslashes are stripped by hand and the test requires
 * THAT to break the tree.
 *
 * usage: node test/roundtrip-escaping.mjs
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const LF = String.fromCharCode(10);
const BS = String.fromCharCode(92);

const walk = function* (n) { yield n; for (const c of n.content || []) yield* walk(c); };
const count = (d, t) => [...walk(d)].filter((n) => n.type === t).length;
const shape = (n) => n.type + (n.content ? "(" + n.content.map(shape).join(",") + ")" : "");
const text = (n) => (n.type === "text" ? n.text || "" : (n.content || []).map(text).join(""));
const roundTrip = async (md) => generateJSON(await marked.parse(md), tiptapExtensions);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// A paragraph whose text is several lines separated by hard breaks.
const withBreaks = (...lines) => ({
  type: "paragraph",
  content: lines.flatMap((t, i) =>
    i === 0 ? [{ type: "text", text: t }] : [{ type: "hardBreak" }, { type: "text", text: t }],
  ),
});
const plain = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

// ---------- HALF 1: text that looks like syntax must stay text ----------

console.log("--- must be escaped ---");

const dangerous = {
  "paragraph starting with a bullet": plain("- not a list"),
  "paragraph starting with a star": plain("* not a list"),
  "paragraph starting with a plus": plain("+ not a list"),
  "paragraph starting with a number": plain("1. not a list"),
  "paragraph starting with a hash": plain("# not a heading"),
  "paragraph starting with a quote": plain("> not a quote"),
  "paragraph starting with a fence": plain("``` not a fence"),
};

for (const [name, node] of Object.entries(dangerous)) {
  const doc = { type: "doc", content: [node] };
  const back = await roundTrip(convertProseMirrorToMarkdown(doc));
  const same = shape(doc) === shape(back);
  check(same, `${name}: stays ONE paragraph`);
  if (!same) console.log(`        ${shape(doc)}  ->  ${shape(back)}`);
  check(
    text(doc).replace(/\s+/g, "") === text(back).replace(/\s+/g, ""),
    `${name}: the text comes back intact`,
  );
}

// The case that surfaced all of this: a paragraph whose literal text is "Grupo
// motor" and then, after hard breaks, the lines "- Rafa", "- Nuria".
//
// This one asserts no phantom list and intact text rather than an identical tree,
// and the reason is worth stating: on this branch `hardBreak` is serialised as a
// bare newline, so marked reads it as a SOFT break and the hardBreak nodes do not
// survive the round trip at all. That is a separate bug with its own pull request
// (#17); asserting the full shape here would be testing that one, not this one.
const realCase = { type: "doc", content: [withBreaks("Grupo motor", "- Rafa", "- Nuria", "- Agnes")] };
const backReal = await roundTrip(convertProseMirrorToMarkdown(realCase));
check(
  count(backReal, "bulletList") === 0 && count(backReal, "listItem") === 0,
  `the real case, after hard breaks: no list is created (bulletList ${count(backReal, "bulletList")})`,
);
check(
  text(realCase).replace(/\s+/g, "") === text(backReal).replace(/\s+/g, ""),
  "the real case, after hard breaks: the text comes back intact",
);

// Inside a numbered item, which is where the real case lived.
const inItem = {
  type: "doc",
  content: [{
    type: "orderedList",
    attrs: { start: 1 },
    content: [
      { type: "listItem", content: [withBreaks("Grupo motor", "- Rafa", "- Nuria")] },
      { type: "listItem", content: [plain("Enlaces")] },
    ],
  }],
};
const backItem = await roundTrip(convertProseMirrorToMarkdown(inItem));
check(count(backItem, "bulletList") === 0, `inside a numbered item: no phantom sublist (bulletList ${count(backItem, "bulletList")})`);

// ---------- HALF 2: and NOTHING else may be escaped ----------

console.log("");
console.log("--- must NOT be touched ---");

const innocent = {
  "hyphen mid-sentence": "a hyphen - in the middle of a sentence",
  "date at the start": "2026-08-24 was the day",
  "hash without a space": "#tag at the start",
  "decimal number": "1.5 million euros",
  "number without a dot": "2026 was the year",
  "greater-than mid-line": "if a > b then c",
  "emphasis at the start": "*emphasis* at the start",
  "hyphen glued to a word": "-glued hyphen, no space",
  "subtraction": "3 - 2 = 1",
};

for (const [name, t] of Object.entries(innocent)) {
  const md = convertProseMirrorToMarkdown({ type: "doc", content: [plain(t)] });
  check(!md.includes(BS), `${name}: gains no backslash · ${JSON.stringify(md)}`);
}

// A line that opens with backticks is only a FENCE when the rest of it holds no
// backticks -- CommonMark forbids backticks in the info string after a backtick
// fence. So this line is an inline code span, not a fence, and escaping it would
// break the span rather than protect anything.
const spanNotFence = plain("``` code ``` with `` backticks `` inside");
const spanMd = convertProseMirrorToMarkdown({ type: "doc", content: [spanNotFence] });
check(!spanMd.includes(BS), `a backtick run followed by more backticks is NOT escaped as a fence · ${JSON.stringify(spanMd)}`);

// Table cells are the trap: their text sits after `| ` and never starts a line,
// so a backslash there protects nothing and PRINTS.
const table = {
  type: "doc",
  content: [{
    type: "table",
    content: [{
      type: "tableRow",
      content: [
        { type: "tableCell", content: [plain("#")] },
        { type: "tableCell", content: [plain("-")] },
        { type: "tableCell", content: [plain("1.")] },
      ],
    }],
  }],
};
const tableMd = convertProseMirrorToMarkdown(table);
check(!tableMd.includes(BS), `table cells gain no backslash · ${JSON.stringify(tableMd)}`);

// ---------- STABILITY and NEGATIVE CONTROL ----------

console.log("");
const doc = { type: "doc", content: [dangerous["paragraph starting with a bullet"]] };
const md = convertProseMirrorToMarkdown(doc);
check(md === convertProseMirrorToMarkdown(await roundTrip(md)), "stable: a second pass yields the same markdown");

const unescaped = md
  .split(LF)
  .map((l) => l.replace(new RegExp("^(" + BS + "s*)" + BS + BS), "$1"))
  .join(LF);
const broken = await roundTrip(unescaped);
check(
  shape(doc) !== shape(broken),
  `negative control: without the backslash the paragraph DOES become a list (${shape(broken)})`,
);

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("PASSED: all checks");
