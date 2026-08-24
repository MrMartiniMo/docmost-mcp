/**
 * Round-trip test for emphasis marks whose text starts or ends with whitespace.
 *
 * A bold run whose text ends in a space was serialized as `**text **`. That is
 * not valid emphasis -- a closing `**` preceded by whitespace does not close
 * anything -- so marked leaves the asterisks as TEXT. From that point the damage
 * is permanent: they have stopped being syntax and become content, and rewriting
 * the page never recovers them.
 *
 * The same bug produces confusing output whenever emphasis spans inline code.
 * Because TipTap's `code` mark is EXCLUSIVE, `**A `c` B**` is stored as three
 * nodes (bold / code without bold / bold), and the serializer emitted
 * `**A **`c`** B**`. It now emits `**A** `c` **B**`.
 *
 * The test carries a NEGATIVE CONTROL: it re-runs the cycle with the whitespace
 * put back inside the delimiters and requires THAT one to lose the marks, so a
 * green result cannot be vacuous.
 *
 * usage:  node test/roundtrip-marks.mjs
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const t = (text, ...marks) => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}),
});
const p = (...content) => ({ type: "paragraph", content });

const doc = {
  type: "doc",
  content: [
    p(t("FIRST.- ", "bold"), t("the clause continues here.")),
    p(t("text and"), t(" SECOND", "bold"), t(" more text.")),
    p(t("note: ", "italic"), t("the rest is roman.")),
    p(t("RULE: ", "bold"), t("update_page", "code"), t(" is the last resort", "bold")),
    p(t("clean bold", "bold"), t(" and normal text.")),
  ],
};

const count = (n, acc = {}) => {
  if (n.type === "text") {
    for (const m of n.marks || []) acc[m.type] = (acc[m.type] || 0) + 1;
  }
  for (const c of n.content || []) count(c, acc);
  return acc;
};

const cycle = async (md) => generateJSON(await marked.parse(md), tiptapExtensions);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "  ok   " : "  FAIL "} ${what}`);
  if (!ok) failures.push(what);
};

const md = convertProseMirrorToMarkdown(doc);
console.log("--- markdown emitted ---");
md.split("\n").forEach((l, i) => console.log(`${String(i + 1).padStart(3)}| ${l}`));

const back = await cycle(md);
const before = count(doc);
const after = count(back);
console.log("\nmarks before:", JSON.stringify(before));
console.log("marks after :", JSON.stringify(after));
console.log("\n--- checks ---");

check((after.bold || 0) === (before.bold || 0),
  `all ${before.bold} bold runs survive (got ${after.bold || 0})`);
check((after.italic || 0) === (before.italic || 0),
  `the italic run survives (got ${after.italic || 0} of ${before.italic})`);
check((after.code || 0) === (before.code || 0),
  `the inline code survives (got ${after.code || 0} of ${before.code})`);

const literal = [];
const walk = (n) => {
  if (n.type === "text" && !(n.marks || []).some((m) => m.type === "code")) {
    if ((n.text || "").includes("*")) literal.push(n.text);
  }
  for (const c of n.content || []) walk(c);
};
walk(back);
check(literal.length === 0,
  `no asterisk is left as literal text (${literal.length ? JSON.stringify(literal) : "none"})`);

const md2 = convertProseMirrorToMarkdown(back);
check(md === md2, "the cycle is stable: reading and rewriting gives the same thing");

// NEGATIVE CONTROL: whitespace back inside the delimiters.
const oldMd = md
  .replace(/\*\*(\S[^*]*?)\*\* /g, "**$1 **")
  .replace(/ \*\*([^*]*?\S)\*\*/g, "** $1**");
const oldBack = await cycle(oldMd);
const oldLiteral = [];
const walk2 = (n) => {
  if (n.type === "text" && !(n.marks || []).some((m) => m.type === "code")) {
    if ((n.text || "").includes("**")) oldLiteral.push(n.text);
  }
  for (const c of n.content || []) walk2(c);
};
walk2(oldBack);
check(oldLiteral.length > 0,
  `negative control: with the whitespace inside, asterisks DO turn literal (${oldLiteral.length})`);

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("OK: all checks pass");
