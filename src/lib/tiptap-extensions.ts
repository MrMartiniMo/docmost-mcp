import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Node, mergeAttributes } from "@tiptap/core";

// Define extensions compatible with standard Markdown features
// We use the default Tiptap extensions to handle basic content
/**
 * Docmost's maths nodes, registered so that `generateJSON` can rebuild them when
 * a page is rewritten.
 *
 * Without a schema entry the node simply disappears, and that is not theoretical:
 * pages produced by importing a word processor document use `mathInline` as
 * variable PLACEHOLDERS, so every write turned them into loose dollar-wrapped
 * text. Same failure mode as tables before they were registered -- a missing
 * extension, not a converter bug.
 *
 * A real maths extension is deliberately not used: nothing has to be RENDERED
 * here, the node and its `text` only have to survive intact so they can be handed
 * back to Docmost, which does know how to render them. The text travels in
 * `data-text` rather than as element content because it usually ends in a
 * newline, which survives inside an attribute.
 */
const MathInline = Node.create({
  name: "mathInline",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { text: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="mathInline"]',
        getAttrs: (el: any) => ({ text: el.getAttribute("data-text") ?? "" }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "span",
      mergeAttributes({ "data-type": "mathInline", "data-text": node.attrs.text }),
    ];
  },
});

const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { text: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="mathBlock"]',
        getAttrs: (el: any) => ({ text: el.getAttribute("data-text") ?? "" }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "div",
      mergeAttributes({ "data-type": "mathBlock", "data-text": node.attrs.text }),
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
  MathInline,
  MathBlock,
];
