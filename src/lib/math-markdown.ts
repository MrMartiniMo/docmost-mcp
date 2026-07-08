import { marked, type TokenizerAndRendererExtension } from "marked";

/**
 * marked extensions that turn LaTeX math into the HTML the Tiptap math nodes parse:
 *   $$ ... $$  ->  <div  data-type="mathBlock"  data-katex-text="ESCAPED_TEX"></div>
 *   $ ... $    ->  <span data-type="mathInline" data-katex-text="ESCAPED_TEX"></span>
 *
 * The raw LaTeX is placed in an ATTRIBUTE (properly escaped for HTML), so `&`, `<`,
 * `>` and `\\` survive intact — unlike Docmost's server-side markdown import which
 * corrupts them when math is written as element text.
 */
function escapeAttr(tex: string): string {
  // In an HTML attribute value only `&` and the quote delimiter must be escaped;
  // `<` and `>` are legal literally. Escaping them caused `<` to round-trip as `&lt;`.
  return tex.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const blockMath: TokenizerAndRendererExtension = {
  name: "blockMath",
  level: "block",
  start(src) {
    return src.indexOf("$$");
  },
  tokenizer(src) {
    // $$ ... $$  (may span multiple lines). Non-greedy to stop at the first closing $$.
    const rule = /^\$\$([\s\S]+?)\$\$(?:\n|$)/;
    const match = rule.exec(src);
    if (match) {
      return {
        type: "blockMath",
        raw: match[0],
        text: match[1].trim(),
      } as any;
    }
    return undefined;
  },
  renderer(token: any) {
    return `<div data-type="mathBlock" data-katex-text="${escapeAttr(token.text)}"></div>\n`;
  },
};

const inlineMath: TokenizerAndRendererExtension = {
  name: "inlineMath",
  level: "inline",
  start(src) {
    const i = src.indexOf("$");
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    // $...$ but not $$ (block) and not an empty/space-led token; no newline inside.
    const rule = /^\$(?!\$)((?:\\.|[^$\\\n])+?)\$/;
    const match = rule.exec(src);
    if (match) {
      return {
        type: "inlineMath",
        raw: match[0],
        text: match[1].trim(),
      } as any;
    }
    return undefined;
  },
  renderer(token: any) {
    return `<span data-type="mathInline" data-katex-text="${escapeAttr(token.text)}"></span>`;
  },
};

let installed = false;
export function installMathMarkdown(): void {
  if (installed) return;
  marked.use({ extensions: [blockMath, inlineMath] });
  installed = true;
}
