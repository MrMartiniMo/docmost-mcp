import { HocuspocusProvider } from "@hocuspocus/provider";
import { TiptapTransformer } from "@hocuspocus/transformer";
import * as Y from "yjs";
import WebSocket from "ws";
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { JSDOM } from "jsdom";
import { docmostExtensions } from "./docmost-schema.js";

// Setup DOM environment for Tiptap HTML parsing in Node.js
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
global.window = dom.window as any;
global.document = dom.window.document;
// @ts-ignore
global.Element = dom.window.Element;
// @ts-ignore
global.WebSocket = WebSocket;
// Navigator is read-only in newer Node versions and already exists
// global.navigator = dom.window.navigator;

/**
 * Pre-process Docmost-flavoured markdown: convert `:::type ... :::`
 * callout blocks (the syntax our markdown export produces) into HTML
 * divs that the callout extension parses. The inner content is rendered
 * through marked as regular markdown.
 */
async function preprocessCallouts(markdown: string): Promise<string> {
  const calloutRe = /^:::\s*(\w+)\s*\n([\s\S]*?)\n:::\s*$/gm;
  const pieces: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = calloutRe.exec(markdown)) !== null) {
    pieces.push(markdown.slice(lastIndex, match.index));
    const type = match[1].toLowerCase();
    const inner = await marked.parse(match[2]);
    pieces.push(
      `\n<div data-type="callout" data-callout-type="${type}">${inner}</div>\n`,
    );
    lastIndex = match.index + match[0].length;
  }
  pieces.push(markdown.slice(lastIndex));
  return pieces.join("");
}

/** Convert markdown to a ProseMirror doc using the full Docmost schema. */
export async function markdownToProseMirror(
  markdownContent: string,
): Promise<any> {
  const withCallouts = await preprocessCallouts(markdownContent);
  const html = await marked.parse(withCallouts);
  return generateJSON(html, docmostExtensions);
}

/**
 * Replace the live content of a page over the collaboration websocket.
 * Accepts a ready ProseMirror JSON document; the caller controls whether
 * it was produced from markdown (ids regenerate) or edited in place
 * (existing block ids preserved).
 */
export async function replacePageContent(
  pageId: string,
  prosemirrorDoc: any,
  collabToken: string,
  baseUrl: string,
): Promise<void> {
  console.error(`Starting realtime content replace for page ${pageId}`);
  console.error(
    `Token prefix: ${collabToken ? collabToken.substring(0, 5) : "NONE"}...`,
  );

  const ydoc = new Y.Doc();

  // Construct WebSocket URL: strip /api suffix, websocket is mounted on /collab
  let wsUrl = baseUrl.replace(/^http/, "ws");
  try {
    const urlObj = new URL(wsUrl);
    if (urlObj.pathname.endsWith("/api") || urlObj.pathname.endsWith("/api/")) {
      urlObj.pathname = urlObj.pathname.replace(/\/api\/?$/, "");
    }
    urlObj.pathname = urlObj.pathname.replace(/\/$/, "") + "/collab";
    wsUrl = urlObj.toString();
  } catch (e) {
    // Fallback if URL parsing fails
    if (!wsUrl.endsWith("/collab")) {
      wsUrl = wsUrl.replace(/\/$/, "") + "/collab";
    }
  }

  console.error(`Connecting to WebSocket: ${wsUrl}`);

  return new Promise((resolve, reject) => {
    // Safety timeout
    const timer = setTimeout(() => {
      if (provider) provider.destroy();
      reject(new Error("Connection timeout to collaboration server"));
    }, 25000);

    const provider = new HocuspocusProvider({
      url: wsUrl,
      name: `page.${pageId}`,
      document: ydoc,
      token: collabToken,
      // @ts-ignore - Required for Node.js environment
      WebSocketPolyfill: WebSocket,
      onConnect: () => console.error("WS Connect"),
      onDisconnect: () => console.error("WS Disconnect"),
      onClose: () => console.error("WS Close"),
      onSynced: () => {
        console.error("Connected and synced!");
        try {
          // Prepare the new content in a separate doc
          const tempDoc = TiptapTransformer.toYdoc(
            prosemirrorDoc,
            "default",
            docmostExtensions,
          );

          // Apply update
          ydoc.transact(() => {
            const fragment = ydoc.getXmlFragment("default");
            // 1. Clear existing content
            if (fragment.length > 0) {
              fragment.delete(0, fragment.length);
            }
            // 2. Apply new content from tempDoc
            const update = Y.encodeStateAsUpdate(tempDoc);
            Y.applyUpdate(ydoc, update);
          });

          console.error(
            "Content replaced. Returning success to user immediately (Background persistence)...",
          );
          clearTimeout(timer);
          resolve();

          // Keep connection open in background for save/sync (Docmost has 10s debounce)
          setTimeout(() => {
            try {
              console.error(`Closing background connection for page ${pageId}`);
              provider.destroy();
            } catch (err) {}
          }, 15000);
        } catch (e) {
          clearTimeout(timer);
          provider.destroy();
          reject(e);
        }
      },
      onAuthenticationFailed: () => {
        clearTimeout(timer);
        provider.destroy();
        reject(new Error("Authentication failed for collaboration connection"));
      },
    });
  });
}

/**
 * Markdown update path (kept for backwards compatibility).
 * NOTE: this re-imports the whole document — block ids are regenerated.
 * Tables and :::callout::: blocks survive thanks to the full schema.
 */
export async function updatePageContentRealtime(
  pageId: string,
  markdownContent: string,
  collabToken: string,
  baseUrl: string,
): Promise<void> {
  const tiptapJson = await markdownToProseMirror(markdownContent);
  return replacePageContent(pageId, tiptapJson, collabToken, baseUrl);
}
