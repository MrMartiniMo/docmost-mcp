import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";

// Define extensions compatible with standard Markdown features
// We use the default Tiptap extensions to handle basic content
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
  // Table support. Without these, generateJSON() has no schema for the
  // <table> elements that `marked` produces from GFM tables, so it drops
  // the table structure and collapses every cell into run-on text. These
  // emit the standard table/tableRow/tableHeader/tableCell nodes that
  // Docmost's editor schema expects.
  Table.configure({
    resizable: false,
  }),
  TableRow,
  TableHeader,
  TableCell,
];
