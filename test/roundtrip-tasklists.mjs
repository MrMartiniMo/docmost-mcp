/**
 * Round-trip test for task lists.
 *
 * The converter already emitted `- [ ]` and `- [x]` correctly, but nothing
 * registered taskList or taskItem in the schema, so generateJSON had no node to
 * rebuild them into and returned bulletList/listItem instead. A markable
 * checkbox became a dead bullet, and the checked state went with it.
 *
 * The hard part is not recognising checkboxes, it is NOT turning ordinary
 * bullets into them: marked emits both as `<ul>` and only the
 * `<input type=checkbox>` inside tells them apart. So both lists live in the
 * SAME document here on purpose.
 *
 * NEGATIVE CONTROL: the same markdown is parsed with the two extensions removed
 * and the test requires THAT to decay. It also asserts it removed exactly two,
 * so it cannot pass by filtering nothing.
 *
 * usage: node test/roundtrip-tasklists.mjs
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const LF = String.fromCharCode(10);
const p = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

const doc = {
  type: "doc",
  content: [
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: false }, content: [p("unchecked")] },
        { type: "taskItem", attrs: { checked: true }, content: [p("checked")] },
        { type: "taskItem", attrs: { checked: false }, content: [p("another unchecked")] },
      ],
    },
    p("And separately, an ordinary bullet list:"),
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [p("bullet one")] }, { type: "listItem", content: [p("bullet two")] }],
    },
  ],
};

// Task list and bullet list as direct siblings, which is where adjacent lists
// silently merge into one.
const adjacent = {
  type: "doc",
  content: [
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [p("task A")] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [p("bullet B")] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p("task C")] }] },
  ],
};

const walk = function* (n) { yield n; for (const c of n.content || []) yield* walk(c); };
const count = (d, t) => [...walk(d)].filter((n) => n.type === t).length;
const states = (d) => [...walk(d)].filter((n) => n.type === "taskItem").map((n) => !!n.attrs?.checked);
const text = (n) => (n.type === "text" ? n.text || "" : (n.content || []).map(text).join(""));
const roundTrip = async (md, exts = tiptapExtensions) => generateJSON(await marked.parse(md), exts);

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

check(count(back, "taskList") === 1, `the task list survives (found ${count(back, "taskList")})`);
check(count(back, "taskItem") === 3, `all three checkboxes survive (found ${count(back, "taskItem")})`);
check(
  JSON.stringify(states(back)) === JSON.stringify([false, true, false]),
  `checked state is preserved: ${JSON.stringify(states(back))}`,
);
check(
  count(back, "bulletList") === 1 && count(back, "listItem") === 2,
  `the ordinary bullet list is NOT turned into a task list (bulletList ${count(back, "bulletList")}, listItem ${count(back, "listItem")})`,
);
check(
  text(back).includes("bullet one") && text(back).includes("unchecked") && text(back).includes("checked"),
  "no text is lost from either list",
);
check(md === convertProseMirrorToMarkdown(back), "stable: a second pass yields the same markdown");

// Adjacent sibling lists. Two lists in a row do not exist in markdown: they
// merge into one, blank line or not -- and a mixed list is no longer a task
// list, so the checkboxes go too.
const backAdj = await roundTrip(convertProseMirrorToMarkdown(adjacent));
check(
  count(backAdj, "taskList") === 2 && count(backAdj, "bulletList") === 1,
  `adjacent sibling lists stay separate (taskList ${count(backAdj, "taskList")}, bulletList ${count(backAdj, "bulletList")})`,
);
check(
  JSON.stringify(states(backAdj)) === JSON.stringify([false, true]),
  `and keep their checked state: ${JSON.stringify(states(backAdj))}`,
);
check(
  ["task A", "bullet B", "task C"].every((t) => text(backAdj).includes(t)),
  "no text is lost across the adjacent lists",
);

// A MIXED list (some items with a checkbox, some without). Docmost cannot create
// one, so it can only arrive from hand-written markdown, but it is worth pinning
// down WHAT it does: taskList accepts only taskItem, so forcing it would risk
// content being dropped in the coercion. It stays a bullet list and loses the
// markers -- which is exactly what every list did before this change. It
// degrades, it does not destroy.
const mixed = await roundTrip(
  ["- [ ] with a box", "- without one", "- [x] with a box again", ""].join(LF),
);
check(
  count(mixed, "taskList") === 0 && count(mixed, "bulletList") === 1 && count(mixed, "listItem") === 3,
  `a mixed list stays a bullet list rather than forcing the tree (taskList ${count(mixed, "taskList")}, listItem ${count(mixed, "listItem")})`,
);
check(
  ["with a box", "without one", "with a box again"].every((t) => text(mixed).includes(t)),
  "and still loses none of its item text",
);

// NEGATIVE CONTROL.
const withoutTasks = tiptapExtensions.filter((e) => e.name !== "taskList" && e.name !== "taskItem");
check(
  withoutTasks.length === tiptapExtensions.length - 2,
  `the negative control really removes two extensions (${tiptapExtensions.length} -> ${withoutTasks.length})`,
);
const decayed = await roundTrip(md, withoutTasks);
check(
  count(decayed, "taskItem") === 0 && count(decayed, "listItem") === 5,
  `negative control: without the extensions they DO decay into bullets (taskItem ${count(decayed, "taskItem")}, listItem ${count(decayed, "listItem")})`,
);

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("PASSED: all checks");
