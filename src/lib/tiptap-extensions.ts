import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Node, mergeAttributes } from "@tiptap/core";

// Define extensions compatible with standard Markdown features
// We use the default Tiptap extensions to handle basic content
/**
 * Docmost's task lists, registered so that `generateJSON` can rebuild them when a
 * page is rewritten.
 *
 * The converter already emitted `- [ ]` and `- [x]`, but with no schema entry the
 * round trip decayed them into bulletList/listItem: a markable checkbox became a
 * dead bullet and the checked state went with it.
 *
 * The delicate part is not recognising checkboxes, it is NOT turning ordinary
 * bullets into them: marked emits both as `<ul>` and only the
 * `<input type=checkbox>` inside tells them apart. Both parse rules therefore
 * share one predicate, and it requires EVERY item to carry a checkbox. A mixed
 * list stays a bullet list rather than being forced into a shape the schema
 * forbids (taskList accepts only taskItem) and risking content being dropped in
 * the coercion. Docmost cannot author a mixed list, so it can only arrive from
 * hand-written markdown.
 *
 * The priority has to beat bulletList and listItem (100 by default): the first
 * matching rule wins, and both compete for the same `<ul>`.
 */
const checkboxOf = (el: any): any =>
  Array.from(el?.children ?? []).find(
    (child: any) =>
      String(child?.tagName ?? "").toUpperCase() === "INPUT" &&
      child?.getAttribute?.("type") === "checkbox",
  ) ?? null;

const isTaskList = (el: any): boolean => {
  const items = Array.from(el?.children ?? []).filter(
    (child: any) => String(child?.tagName ?? "").toUpperCase() === "LI",
  );
  return items.length > 0 && items.every((li: any) => checkboxOf(li) !== null);
};

const TaskList = Node.create({
  name: "taskList",
  group: "block list",
  content: "taskItem+",
  priority: 120,
  parseHTML() {
    return [
      { tag: 'ul[data-type="taskList"]' },
      { tag: "ul", getAttrs: (el: any) => (isTaskList(el) ? {} : false) },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ul", mergeAttributes(HTMLAttributes, { "data-type": "taskList" }), 0];
  },
});

const TaskItem = Node.create({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,
  priority: 120,
  addAttributes() {
    return { checked: { default: false } };
  },
  parseHTML() {
    return [
      {
        tag: 'li[data-type="taskItem"]',
        getAttrs: (el: any) => ({ checked: el.getAttribute("data-checked") === "true" }),
      },
      {
        tag: "li",
        getAttrs: (el: any) => {
          // Same predicate as the list, and checking the parent too: if the two
          // rules disagree you get half-matches, which is how content goes
          // missing quietly.
          if (!isTaskList(el?.parentElement)) return false;
          const box = checkboxOf(el);
          if (!box) return false;
          return { checked: box.getAttribute("checked") !== null };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(HTMLAttributes, {
        "data-type": "taskItem",
        "data-checked": node.attrs.checked ? "true" : "false",
      }),
      0,
    ];
  },
});

export const tiptapExtensions = [
  StarterKit.configure({
    // Explicitly enable features that might be disabled in some contexts
    codeBlock: {},
    heading: {},
  }),
  Image.configure({
    inline: true,
  }),
  Link.configure({
    openOnClick: false,
  }),
  TaskList,
  TaskItem,
];
