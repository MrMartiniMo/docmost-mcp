/**
 * Round-trip test for inline code whose content contains backticks.
 *
 * A code span was always wrapped in a single backtick, so content holding
 * backticks left the delimiter trapped inside itself and markdown could no longer
 * tell where the code ended. On one of our pages that is ~116 characters lost per
 * write: its phase diagram is ASCII art built from runs of backticks inside a node
 * carrying the `code` mark.
 *
 * CommonMark already defines the answer and it is not a design choice: the
 * delimiter must be a run LONGER than the longest run inside, padded with one
 * space on each side when needed, which the parser strips on the way back.
 *
 * A NOTE ON METHOD. This bug was first read as "two adjacent inline-code nodes",
 * reproduced in a synthetic fixture, and taken as understood. Measuring against
 * the real corpus killed it: there are ZERO pairs of adjacent text nodes with
 * identical marks across all 385 live pages -- that case does not occur, and
 * ProseMirror merges such nodes anyway. The main fixture below therefore comes
 * from the real ProseMirror, not from a hypothesis.
 *
 * NEGATIVE CONTROL: the same content is re-wrapped with a single backtick and the
 * test requires THAT to break.
 *
 * usage: node test/roundtrip-inline-code.mjs
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const TICK = String.fromCharCode(96);
const codeDoc = (t) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: t, marks: [{ type: "code" }] }] }],
});

const walk = function* (n) { yield n; for (const c of n.content || []) yield* walk(c); };
const codeTexts = (d) => [...walk(d)]
  .filter((n) => n.type === "text" && (n.marks || []).some((m) => m.type === "code"))
  .map((n) => n.text);
const text = (n) => (n.type === "text" ? n.text || "" : (n.content || []).map(text).join(""));
const roundTrip = async (md) => generateJSON(await marked.parse(md), tiptapExtensions);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// The first one is real text from the page that surfaced this.
const cases = [
  TICK + TICK + "[======Phase" + TICK + TICK + " " + TICK + TICK + "2:" + TICK + TICK + " " + TICK + TICK + "Design=]",
  "a lone " + TICK + " backtick",
  "two " + TICK + TICK + " together",
  TICK + "starts with a backtick",
  "ends with a backtick" + TICK,
  TICK + "backticks on both sides" + TICK,
  "no backticks at all",
];

for (const t of cases) {
  const doc = codeDoc(t);
  const md = convertProseMirrorToMarkdown(doc);
  const back = await roundTrip(md);
  const got = codeTexts(back)[0];
  check(got === t, `survives intact ${JSON.stringify(t.slice(0, 42))} · md ${JSON.stringify(md.slice(0, 50))}`);
  if (got !== t) console.log(`        got ${JSON.stringify(got)}`);
  check(codeTexts(back).length === 1, `and is still ONE code node (found ${codeTexts(back).length})`);
}

// KNOWN LIMITATION, and not this converter's doing: the parser behind
// generateJSON COLLAPSES consecutive spaces, in code and in ordinary text alike
// (`text  with  doubles` comes back with single spaces). marked emits the HTML
// correctly; it is lost when the tree is built, which is standard HTML behaviour.
// So that case is not round-tripped here -- what is checked is the DELIMITER.
const spaced = convertProseMirrorToMarkdown(codeDoc("code with  double spaces"));
check(
  spaced === TICK + "code with  double spaces" + TICK,
  `the markdown for code with double spaces is right, even though the parser later collapses them · ${JSON.stringify(spaced)}`,
);

// What already worked must not change: code with no backticks inside still gets a
// delimiter of ONE, not a longer one.
const simple = convertProseMirrorToMarkdown(codeDoc("no backticks at all"));
check(
  simple === TICK + "no backticks at all" + TICK,
  `ordinary code gains no extra delimiters · ${JSON.stringify(simple)}`,
);

const doc = codeDoc(cases[0]);
const md = convertProseMirrorToMarkdown(doc);
check(md === convertProseMirrorToMarkdown(await roundTrip(md)), "stable: a second pass yields the same markdown");

// NEGATIVE CONTROL.
const broken = await roundTrip(TICK + cases[0] + TICK);
check(
  codeTexts(broken)[0] !== cases[0],
  `negative control: a single-backtick delimiter DOES break it · got ${JSON.stringify((codeTexts(broken)[0] || "").slice(0, 38))}`,
);
check(text(broken) !== text(doc), "negative control: and the text changes too");

// A code span whose content ends in a BACKSLASH breaks the emphasis that comes
// AFTER it, leaving the `**` as literal text. Windows paths do this.
//
// TWO conditions are required, which is why it resists reproduction: the trailing
// backslash AND another code span further along in the SAME paragraph. With only
// one of them nothing happens, so a minimal fixture with just the backslash
// reports that all is well.
//
// Careful writing this: neither an ordinary JS string nor String.raw can END in a
// backslash -- in raw form it escapes the closing backtick too. It has to be built
// with fromCharCode or join, or the fixture passes green while testing nothing.
const BSLASH = String.fromCharCode(92);
const WINPATH = ["C:", "Users", "nico", "tts-pilot", ""].join(BSLASH);

const trailing = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "open " },
        { type: "text", text: WINPATH, marks: [{ type: "code" }] },
        { type: "text", text: " and " },
        { type: "text", text: "drag the file", marks: [{ type: "bold" }] },
        { type: "text", text: " onto " },
        { type: "text", text: "script.bat", marks: [{ type: "code" }] },
        { type: "text", text: " (done)" },
      ],
    },
  ],
};

const trailingMd = convertProseMirrorToMarkdown(trailing);
const trailingBack = await roundTrip(trailingMd);
check(
  !text(trailingBack).includes("**"),
  `a path ending in a backslash leaves no literal asterisks further along · md ${JSON.stringify(trailingMd.slice(0, 58))}`,
);
check(
  codeTexts(trailingBack)[0] === WINPATH,
  `and the path survives with its trailing backslash · ${JSON.stringify(codeTexts(trailingBack)[0])}`,
);
check(
  codeTexts(trailingBack).length === 2,
  `and both code spans are still two (found ${codeTexts(trailingBack).length})`,
);

// NEGATIVE CONTROL: strip the padding by hand and require THAT to break.
const unpadded = trailingMd.replace(TICK + " " + WINPATH + " " + TICK, TICK + WINPATH + TICK);
check(unpadded !== trailingMd, "negative control: the markdown did carry padding to strip");
check(
  text(await roundTrip(unpadded)).includes("**"),
  "negative control: without the padding the bold DOES come back as literal text",
);

// And what must not change: a backslash in the MIDDLE triggers nothing.
const midway = convertProseMirrorToMarkdown(codeDoc("C:" + BSLASH + "dir" + BSLASH + "file"));
check(
  midway === TICK + "C:" + BSLASH + "dir" + BSLASH + "file" + TICK,
  `a backslash in the middle adds no padding · ${JSON.stringify(midway)}`,
);

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("PASSED: all checks");
