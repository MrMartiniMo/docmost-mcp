/**
 * Convert Markdown text to TipTap/ProseMirror JSON format
 * Used for creating and updating comments via Docmost API
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { JSDOM } from "jsdom";
import { tiptapExtensions } from "./tiptap-extensions.js";

// Ensure DOM environment is available (may already be set by collaboration.ts)
if (typeof global.document === "undefined") {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.window = dom.window as any;
  global.document = dom.window.document;
  // @ts-ignore
  global.Element = dom.window.Element;
}

/**
 * Convert markdown string to TipTap-compatible ProseMirror JSON
 */
export async function markdownToTiptapJson(markdown: string): Promise<any> {
  const html = await marked.parse(markdown);
  return generateJSON(html, tiptapExtensions);
}
