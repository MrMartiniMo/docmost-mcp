import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";

// Docmost needs the attachment id on image nodes. Public shares load images
// through /api/files/public/<attachmentId>/..., not through the plain src.
const ATTACHMENT_SRC = /\/api\/files\/([0-9a-f-]{36})\//i;

const DocmostImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-attachment-id") ??
          element.getAttribute("src")?.match(ATTACHMENT_SRC)?.[1] ??
          null,
      },
    };
  },
});

// Define extensions compatible with standard Markdown features
// We use the default Tiptap extensions to handle basic content
export const tiptapExtensions = [
  StarterKit.configure({
    // Explicitly enable features that might be disabled in some contexts
    codeBlock: {},
    heading: {},
  }),
  // Docmost expects images as block nodes; inline images are dropped.
  DocmostImage.configure({
    inline: false,
  }),
  Link.configure({
    openOnClick: false,
  }),
];
