import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Minimal Tiptap node definitions for Docmost's math nodes so that:
 *   - generateJSON() can parse math HTML into `{type, attrs:{text}}`
 *   - TiptapTransformer.toYdoc() can serialise them back to the Yjs doc
 *
 * Docmost stores the raw LaTeX in `attrs.text`. We carry the LaTeX through the
 * pipeline in a `data-katex-text` HTML attribute (NOT as element text), because
 * attribute values are decoded losslessly by the DOM parser — this is what avoids
 * the `&`->`&amp;`, `<`->`&lt;`, `\\`->`\` corruption that Docmost's server-side
 * markdown import applies to math written as element text.
 */
export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-katex-text") || el.textContent || "",
        renderHTML: (attrs) => ({ "data-katex-text": attrs.text }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mathInline"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-type": "mathInline" }, HTMLAttributes)];
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-katex-text") || el.textContent || "",
        renderHTML: (attrs) => ({ "data-katex-text": attrs.text }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mathBlock"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "mathBlock" }, HTMLAttributes)];
  },
});
