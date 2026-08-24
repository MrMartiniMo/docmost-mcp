/**
 * Convert ProseMirror/TipTap JSON content to Markdown
 * Supports all Docmost-specific node types and extensions
 */
/**
 * Wrap text in an emphasis delimiter, keeping any surrounding whitespace OUTSIDE.
 *
 * Markdown does not allow whitespace hugging the inside of a delimiter: in
 * `**text **` the closing `**` is preceded by a space, so it closes nothing and
 * the asterisks are rendered as literal TEXT. Once a page is written back that
 * way the damage is permanent -- they have stopped being syntax and become
 * content, so rewriting never recovers them.
 *
 * The same change fixes the confusing output when emphasis spans inline code.
 * Because TipTap's `code` mark is EXCLUSIVE, `**A `c` B**` is stored as three
 * nodes (bold / code without bold / bold), which used to serialize as
 * `**A **`c`** B**` and now serializes as `**A** `c` **B**`.
 *
 * A node that is only whitespace is returned untouched: there is nothing to
 * emphasise, and `** **` would not be valid either.
 */
function wrapKeepingWhitespaceOutside(text: string, delimiter: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m) return `${delimiter}${text}${delimiter}`;

  const [, before, core, after] = m;
  if (!core) return text;

  return `${before}${delimiter}${core}${delimiter}${after}`;
}

export function convertProseMirrorToMarkdown(content: any): string {
  if (!content || !content.content) return "";

  const processNode = (node: any): string => {
    const type = node.type;
    const nodeContent = node.content || [];

    switch (type) {
      case "doc":
        return nodeContent.map(processNode).join("\n\n");

      case "paragraph":
        const text = nodeContent.map(processNode).join("");
        const align = node.attrs?.textAlign;
        if (align && align !== "left") {
          return `<div align="${align}">${text}</div>`;
        }
        return text || "";

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
                textContent = wrapKeepingWhitespaceOutside(textContent, "**");
                break;
              case "italic":
                textContent = wrapKeepingWhitespaceOutside(textContent, "*");
                break;
              case "code":
                textContent = `\`${textContent}\``;
                break;
              case "link":
                textContent = `[${textContent}](${mark.attrs?.href || ""})`;
                break;
              case "strike":
                textContent = wrapKeepingWhitespaceOutside(textContent, "~~");
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
        return nodeContent.map(processNode).join("");

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
