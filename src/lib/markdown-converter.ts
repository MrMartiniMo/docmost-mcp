/**
 * Convert ProseMirror/TipTap JSON content to Markdown
 * Supports all Docmost-specific node types and extensions
 */
/**
 * Escapes text that must stay TEXT so the parser does not read it as emphasis.
 *
 * The converter emits mark delimiters unescaped, so asterisks and tildes that
 * are content get mixed up with them. Three real cases from our wiki:
 *
 * - `~5.000 -> ~700`: marked accepts a SINGLE tilde as strikethrough, so the
 *   stretch between the two tildes came back struck through and without them.
 * - a literal `*` next to an italic run fused with its delimiter and shifted the
 *   emphasis of the whole paragraph.
 * - marked does not look for emphasis inside anything that looks like an HTML
 *   tag, and to marked that is any `<` not followed by a space, up to the next
 *   `>` in the paragraph. In `warn if <90 **or** bounce >5%` the bold sits inside
 *   that stretch and comes back as literal asterisks, even though CommonMark
 *   says it is valid emphasis. As a side effect a literal `<id>` in prose stops
 *   vanishing as an HTML tag.
 *
 * Only a `<` followed by a non-space is escaped: `a < b` never opens anything.
 * A backslash already in front of one of these characters is escaped too,
 * otherwise `\*` in the text would come out as a bare asterisk.
 */
function escapeLiteralText(text: string): string {
  return text
    .replace(/\\(?=[*~<])/g, "\\\\")
    .replace(/[*~]/g, "\\$&")
    .replace(/<(?=\S)/g, "\\<");
}

/**
 * The emphasis delimiter wrapping a serialized text node on the OUTSIDE, or
 * null when the outermost wrapper is something else (a link, code, an HTML tag).
 * Marks are applied in order, so the LAST wrapping mark wins.
 */
const MARK_DELIMITER: Record<string, string> = { bold: "**", italic: "*", strike: "~~" };
const WRAPPING_MARKS = new Set(["code", "link", "underline", "subscript", "superscript", "highlight"]);

function outerDelimiter(node: any): string | null {
  if (node?.type !== "text" || !node.marks) return null;
  let outer: string | null = null;
  for (const mark of node.marks) {
    if (MARK_DELIMITER[mark.type]) outer = MARK_DELIMITER[mark.type];
    else if (WRAPPING_MARKS.has(mark.type)) outer = null;
    else if (mark.type === "textStyle" && mark.attrs?.color) outer = null;
  }
  return outer;
}

/**
 * Joins the inline children of a block, MERGING emphasis that carries on from
 * one node to the next.
 *
 * Each node is serialized on its own, so two consecutive bold nodes came out as
 * `**[PDF](url)****,**`: four asterisks that neither open nor close anything and
 * come back as text. It happens as soon as a bold run holds one more mark inside
 * (a link, mostly): TipTap splits it into nodes with different mark sets and each
 * one opened and closed its own bold.
 *
 * When one node closes with the same outer delimiter the next one opens with,
 * the pair is dropped: `**[PDF](url),**`, which is what a person would write.
 */
function joinInline(nodes: any[], process: (n: any) => string): string {
  const parts = nodes.map((n: any) => process(n));
  // Edges are computed BEFORE merging anything: in a chain of three nodes the
  // middle one loses its opener when merged with the first, and its closer still
  // has to count for the third.
  const outers = nodes.map((n: any) => outerDelimiter(n));
  const closes = parts.map((s: string, i: number) => {
    const d = outers[i];
    return !!d && s.length > 2 * d.length && s.endsWith(d);
  });
  const opens = parts.map((s: string, i: number) => {
    const d = outers[i];
    return !!d && s.length > 2 * d.length && s.startsWith(d);
  });
  for (let i = 0; i + 1 < parts.length; i++) {
    const d = outers[i];
    if (d && d === outers[i + 1] && closes[i] && opens[i + 1]) {
      parts[i] = parts[i].slice(0, -d.length);
      parts[i + 1] = parts[i + 1].slice(d.length);
    }
  }
  return parts.join("");
}

export function convertProseMirrorToMarkdown(content: any): string {
  if (!content || !content.content) return "";

  // `options` is an OBJECT on purpose: several call sites do
  // `nodeContent.map(processNode)`, and `map` passes the INDEX as the second
  // argument. A number has no `.noEscape`, so that is harmless here.
  const processNode = (node: any, options?: any): string => {
    const type = node.type;
    const nodeContent = node.content || [];

    switch (type) {
      case "doc":
        return nodeContent.map(processNode).join("\n\n");

      case "paragraph":
        const align = node.attrs?.textAlign;
        if (align && align !== "left") {
          // Inside an HTML block markdown is not interpreted, so an escaping
          // backslash would be printed: no escaping here.
          const inHtml = nodeContent.map((n: any) => processNode(n, { noEscape: true })).join("");
          return `<div align="${align}">${inHtml}</div>`;
        }
        const text = joinInline(nodeContent, processNode);
        return text || "";

      case "heading":
        const level = node.attrs?.level || 1;
        const headingText = joinInline(nodeContent, processNode);
        return "#".repeat(level) + " " + headingText;

      case "text":
        let textContent = node.text || "";
        // Code (inline or block) is literal and takes no escapes.
        const isCode = (node.marks || []).some((m: any) => m.type === "code");
        if (!isCode && !options?.noEscape) textContent = escapeLiteralText(textContent);
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
        const code = nodeContent.map((n: any) => processNode(n, { noEscape: true })).join("");
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
