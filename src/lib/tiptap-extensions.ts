import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { MathInline, MathBlock } from "./math-nodes.js";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

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
  // Docmost math nodes so generateJSON/toYdoc can round-trip $..$ and $$..$$.
  MathInline,
  MathBlock,
  // Tables (StarterKit omits them) so complexity/comparison tables survive round-trips.
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];
