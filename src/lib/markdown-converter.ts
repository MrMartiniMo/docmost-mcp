/**
 * Convert ProseMirror/TipTap JSON content to Markdown
 * Supports all Docmost-specific node types and extensions
 */
/**
 * Escapes, AT LINE START, whatever markdown would read as the opening of a block.
 *
 * The converter emitted a node's text verbatim, so a paragraph whose text begins
 * with a block marker came back as that block: prose turned into structure. The
 * case that surfaced it is a paragraph reading "Grupo motor" followed by hard
 * breaks and the literal lines "- Rafa", "- Nuria" -- which came back as a nested
 * list nobody wrote.
 *
 * THE RISK HERE IS OVER-\\APING, not under-escaping: stray backslashes are
 * visible in the rendered page, and that damage is both worse and far more
 * widespread than the bug being fixed. Hence three decisions:
 *
 * - Markers require the space CommonMark requires. `#tag` is not a heading and
 *   `1.5 million` is not a list, so neither is touched.
 * - Line starts only. A hyphen mid-sentence, a subtraction and a date are not
 *   syntax and are left alone.
 * - Thematic breaks (`---`, `___`, `***`) are NOT escaped: they were measured to
 *   survive the round trip already, and adding a backslash where none is needed
 *   is exactly the harm this is trying to avoid.
 *
 * Code fences are escaped whole rather than just their first character: leaving
 * two bare backticks would open an inline code span, trading one bug for another.
 */
const BLOCK_OPENERS: Array<[RegExp, string]> = [
  [/^( {0,3})([-+*])(\s|$)/, "$1\\$2$3"],
  [/^( {0,3})(\d{1,9})([.)])(\s|$)/, "$1$2\\$3$4"],
  [/^( {0,3})(#{1,6})(\s|$)/, "$1\\$2$3"],
  [/^( {0,3})(>)/, "$1\\$2"],
];

function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map((line: string) => {
      // A backtick fence is only a fence when the rest of the line holds NO
      // backticks: CommonMark forbids backticks in the info string after a
      // backtick fence. Without this condition, a code span long enough to need a
      // three-backtick delimiter gets its delimiter escaped when it opens a
      // paragraph, which breaks the span. Tilde fences carry no such restriction,
      // so they are handled separately.
      const fence = /^( {0,3})(`{3,}|~{3,})/.exec(line);
      const isReallyAFence =
        fence && (fence[2][0] === "~" || !line.slice(fence[0].length).includes("`"));
      if (fence && isReallyAFence) {
        const escaped = fence[2]
          .split("")
          .map((c: string) => "\\" + c)
          .join("");
        return fence[1] + escaped + line.slice(fence[0].length);
      }
      for (const [pattern, replacement] of BLOCK_OPENERS) {
        if (pattern.test(line)) return line.replace(pattern, replacement);
      }
      return line;
    })
    .join("\n");
}

export function convertProseMirrorToMarkdown(content: any): string {
  if (!content || !content.content) return "";

  // The second parameter is an OBJECT rather than a boolean on purpose: half a
  // dozen call sites do `nodeContent.map(processNode)`, and `map` passes the
  // INDEX as the second argument. A boolean would silently be false for the
  // first child and true for every other one. A number has no `.inTableCell`.
  const processNode = (node: any, options?: any): string => {
    const type = node.type;
    const nodeContent = node.content || [];

    switch (type) {
      case "doc":
        return nodeContent.map(processNode).join("\n\n");

      case "paragraph":
        const text = nodeContent.map(processNode).join("");
        const align = node.attrs?.textAlign;
        if (align && align !== "left") {
          // Not escaped on purpose: the content sits inside an HTML block,
          // where markdown is not interpreted, so a backslash here would only
          // manage to get itself printed.
          return `<div align="${align}">${text}</div>`;
        }
        // The paragraph is the right place to escape: it is where the LINE
        // structure is known and everything inside is text, never syntax we
        // emitted ourselves.
        //
        // Except inside a table CELL, where the text sits after `| ` and never
        // starts a line: a backslash there protects nothing and PRINTS. Without
        // this exception, 13 live pages on our instance gained 40 visible
        // backslashes, almost all in cells whose entire content was `#`, `-` or
        // `1.` -- while every unit test stayed green.
        return options?.inTableCell ? text || "" : escapeLineStarts(text || "");

      case "heading":
        const level = node.attrs?.level || 1;
        const headingText = nodeContent.map(processNode).join("");
        return "#".repeat(level) + " " + headingText;

      case "text":
        let textContent = node.text || "";
        // Apply marks (bold, italic, code, etc.)
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case "bold":
                textContent = `**${textContent}**`;
                break;
              case "italic":
                textContent = `*${textContent}*`;
                break;
              case "code":
                textContent = `\`${textContent}\``;
                break;
              case "link":
                textContent = `[${textContent}](${mark.attrs?.href || ""})`;
                break;
              case "strike":
                textContent = `~~${textContent}~~`;
                break;
              case "underline":
                textContent = `<u>${textContent}</u>`;
                break;
              case "subscript":
                textContent = `<sub>${textContent}</sub>`;
                break;
              case "superscript":
                textContent = `<sup>${textContent}</sup>`;
                break;
              case "highlight":
                const color = mark.attrs?.color || "yellow";
                textContent = `<mark style="background-color: ${color}">${textContent}</mark>`;
                break;
              case "textStyle":
                if (mark.attrs?.color) {
                  textContent = `<span style="color: ${mark.attrs.color}">${textContent}</span>`;
                }
                break;
            }
          }
        }
        return textContent;

      case "codeBlock":
        const language = node.attrs?.language || "";
        const code = nodeContent.map(processNode).join("");
        return "```" + language + "\n" + code + "\n```";

      case "bulletList":
        return nodeContent
          .map((item: any) => processListItem(item, "-"))
          .join("\n");

      case "orderedList":
        return nodeContent
          .map((item: any, index: number) =>
            processListItem(item, `${index + 1}.`),
          )
          .join("\n");

      case "taskList":
        return nodeContent.map((item: any) => processTaskItem(item)).join("\n");

      case "taskItem":
        const checked = node.attrs?.checked || false;
        const checkbox = checked ? "[x]" : "[ ]";
        return `- ${checkbox} ${nodeContent.map(processNode).join("\n")}`;

      case "listItem":
        return nodeContent.map(processNode).join("\n");

      case "blockquote":
        return nodeContent.map((n: any) => "> " + processNode(n)).join("\n");

      case "horizontalRule":
        return "---";

      case "hardBreak":
        return "\n";

      case "image":
        const imgAlt = node.attrs?.alt || "";
        const imgSrc = node.attrs?.src || "";
        const imgCaption = node.attrs?.caption || "";
        return `![${imgAlt}](${imgSrc})${imgCaption ? `\n*${imgCaption}*` : ""}`;

      case "video":
        const videoSrc = node.attrs?.src || "";
        return `🎥 [Video](${videoSrc})`;

      case "youtube":
        const youtubeUrl = node.attrs?.src || "";
        return `📺 [YouTube Video](${youtubeUrl})`;

      case "table":
        return nodeContent.map(processNode).join("\n");

      case "tableRow":
        return "| " + nodeContent.map(processNode).join(" | ") + " |";

      case "tableCell":
      case "tableHeader":
        return nodeContent
          .map((n: any) => processNode(n, { inTableCell: true }))
          .join("");

      case "callout":
        const calloutType = node.attrs?.type || "info";
        const calloutContent = nodeContent.map(processNode).join("\n");
        return `:::${calloutType.toLowerCase()}\n${calloutContent}\n:::`;

      case "details":
        return nodeContent.map(processNode).join("\n");

      case "detailsSummary":
        const summaryText = nodeContent.map(processNode).join("");
        return `<details>\n<summary>${summaryText}</summary>\n`;

      case "detailsContent":
        const detailsText = nodeContent.map(processNode).join("\n");
        return `${detailsText}\n</details>`;

      case "mathInline":
        const inlineMath = node.attrs?.text || "";
        return `$${inlineMath}$`;

      case "mathBlock":
        const blockMath = node.attrs?.text || "";
        return `$$\n${blockMath}\n$$`;

      case "mention":
        const mentionLabel = node.attrs?.label || node.attrs?.id || "";
        return `@${mentionLabel}`;

      case "attachment":
        const attachmentName = node.attrs?.fileName || "attachment";
        const attachmentUrl = node.attrs?.src || "";
        return `📎 [${attachmentName}](${attachmentUrl})`;

      case "drawio":
        return `📊 [Draw.io Diagram]`;

      case "excalidraw":
        return `✏️ [Excalidraw Drawing]`;

      case "embed":
        const embedUrl = node.attrs?.src || "";
        return `🔗 [Embedded Content](${embedUrl})`;

      case "subpages":
        return "{{SUBPAGES}}";

      default:
        // Fallback: process children
        return nodeContent.map(processNode).join("");
    }
  };

  const processListItem = (item: any, prefix: string): string => {
    const itemContent = item.content || [];
    const lines = itemContent.map(processNode);
    return lines
      .map((line: string, i: number) =>
        i === 0 ? `${prefix} ${line}` : `  ${line}`,
      )
      .join("\n");
  };

  const processTaskItem = (item: any): string => {
    const checked = item.attrs?.checked || false;
    const checkbox = checked ? "[x]" : "[ ]";
    const itemContent = item.content || [];
    const text = itemContent.map(processNode).join("");
    return `- ${checkbox} ${text}`;
  };

  return processNode(content).trim();
}
