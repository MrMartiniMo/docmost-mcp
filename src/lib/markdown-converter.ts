/**
 * Convert ProseMirror/TipTap JSON content to Markdown
 * Supports all Docmost-specific node types and extensions
 */
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
        // Same fix as processListItem: the `> ` goes per LINE. Applied per child,
        // a list inside the quote fell out of it from the second item onwards.
        return nodeContent
          .map(processNode)
          .join("\n")
          .split("\n")
          .map((line: string) => (line ? `> ${line}` : ">"))
          .join("\n");

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

    // Prefix per LINE, not per child. `itemContent.map(processNode)` yields one
    // string PER CHILD, and a child can span several lines: a three-item sublist
    // is ONE child and THREE lines. Indenting only the first left the rest at
    // column zero, so from the second item onwards they came back one level up
    // and the hierarchy was gone for good.
    //
    // The continuation indent is derived from the prefix (2 for `-`, 3 for `1.`)
    // because CommonMark wants it aligned with the column where the item content
    // starts, not a fixed two spaces -- which is why the numbered case failed
    // worst, splitting the parent list in two.
    const indent = " ".repeat(prefix.length + 1);

    return itemContent
      .map(processNode)
      .join("\n")
      .split("\n")
      .map((line: string, i: number) =>
        i === 0 ? `${prefix} ${line}` : line ? `${indent}${line}` : line,
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
