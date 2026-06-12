/**
 * Full TipTap extension set matching the real Docmost document schema.
 *
 * The default StarterKit-only schema silently destroys Docmost-specific
 * nodes (callout, table) and drops attributes it does not know about
 * (node ids, image sizing, link targets). Every code path that converts
 * to or from ProseMirror JSON must use THIS set, otherwise a round-trip
 * loses content.
 */
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Node, Extension } from "@tiptap/core";

/** Docmost callout (info/warning/danger/success banner). */
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      type: { default: "info" },
      icon: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "callout", ...HTMLAttributes }, 0];
  },
});

/** Minimal table family: enough for schema round-trips and HTML parsing. */
const Table = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  isolating: true,
  parseHTML() {
    return [{ tag: "table" }];
  },
  renderHTML() {
    return ["table", ["tbody", 0]];
  },
});

const TableRow = Node.create({
  name: "tableRow",
  content: "(tableCell | tableHeader)*",
  parseHTML() {
    return [{ tag: "tr" }];
  },
  renderHTML() {
    return ["tr", 0];
  },
});

const cellAttributes = () => ({
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
  backgroundColor: { default: null },
  backgroundColorName: { default: null },
});

const TableCell = Node.create({
  name: "tableCell",
  content: "block+",
  isolating: true,
  addAttributes: cellAttributes,
  parseHTML() {
    return [{ tag: "td" }];
  },
  renderHTML() {
    return ["td", 0];
  },
});

const TableHeader = Node.create({
  name: "tableHeader",
  content: "block+",
  isolating: true,
  addAttributes: cellAttributes,
  parseHTML() {
    return [{ tag: "th" }];
  },
  renderHTML() {
    return ["th", 0];
  },
});

/**
 * Attributes Docmost stores on standard nodes that the stock extensions
 * do not declare. Without these, Node.fromJSON silently drops them —
 * including the block ids that heading anchors rely on.
 */
const DocmostAttributes = Extension.create({
  name: "docmostAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["heading", "paragraph"],
        attributes: {
          id: { default: null },
          indent: { default: null },
          textAlign: { default: null },
        },
      },
      {
        types: ["image"],
        attributes: {
          align: { default: null },
          aspectRatio: { default: null },
          height: { default: null },
          placeholder: { default: null },
          size: { default: null },
          width: { default: null },
        },
      },
      {
        types: ["orderedList"],
        attributes: { type: { default: null } },
      },
      {
        types: ["link"],
        attributes: { internal: { default: null }, title: { default: null } },
      },
    ];
  },
});

/**
 * Full extension list. Image is block-level (matches Docmost); the
 * ProseMirror DOM parser hoists <img> found inside <p> automatically.
 * StarterKit v3 already bundles the link extension, configured here.
 */
export const docmostExtensions = [
  StarterKit.configure({
    codeBlock: {},
    heading: {},
    link: { openOnClick: false },
  }),
  Image.configure({ inline: false }),
  Callout,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  DocmostAttributes,
];
