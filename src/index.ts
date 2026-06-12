import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { DocmostClient } from "./client.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8"),
);
const VERSION = packageJson.version;

const API_URL = process.env.DOCMOST_API_URL;
const EMAIL = process.env.DOCMOST_EMAIL;
const PASSWORD = process.env.DOCMOST_PASSWORD;

if (!API_URL || !EMAIL || !PASSWORD) {
  console.error(
    "Error: DOCMOST_API_URL, DOCMOST_EMAIL, and DOCMOST_PASSWORD environment variables are required.",
  );
  process.exit(1);
}

const docmostClient = new DocmostClient(API_URL, EMAIL, PASSWORD);

// --- Modern McpServer Implementation ---

const server = new McpServer({
  name: "docmost-mcp",
  version: VERSION,
});

// Helper to format JSON responses
const jsonContent = (data: any) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// Tool: get_workspace
server.registerTool(
  "get_workspace",
  {
    description: "Get the current Docmost workspace",
  },
  async () => {
    const workspace = await docmostClient.getWorkspace();
    return jsonContent(workspace);
  },
);

// Tool: list_spaces
server.registerTool(
  "list_spaces",
  {
    description: "List all available spaces in Docmost",
  },
  async () => {
    const spaces = await docmostClient.getSpaces();
    return jsonContent(spaces);
  },
);

// Tool: list_groups
server.registerTool(
  "list_groups",
  {
    description: "List all available groups in Docmost",
  },
  async () => {
    const groups = await docmostClient.getGroups();
    return jsonContent(groups);
  },
);

// Tool: list_pages
server.registerTool(
  "list_pages",
  {
    description: "List pages in a space ordered by updatedAt (descending).",
    inputSchema: {
      spaceId: z.string().optional(),
    },
  },
  async ({ spaceId }) => {
    const result = await docmostClient.listPages(spaceId);
    return jsonContent(result);
  },
);

// Tool: get_page
server.registerTool(
  "get_page",
  {
    description:
      "Get page details with content converted to Markdown. The conversion is " +
      "LOSSY (block ids, exact table/callout structure are approximated); for a " +
      "lossless representation use get_page_json.",
    inputSchema: {
      pageId: z.string(),
    },
  },
  async ({ pageId }) => {
    const page = await docmostClient.getPage(pageId);
    return jsonContent(page);
  },
);

// Tool: get_page_json
server.registerTool(
  "get_page_json",
  {
    description:
      "Get page details with the raw ProseMirror JSON content (lossless: " +
      "includes block ids, callouts, tables, link/image attributes) plus the " +
      "slugId used in URLs. Use together with update_page_json for precise " +
      "structural edits, or edit_page_text for simple text fixes.",
    inputSchema: {
      pageId: z.string(),
    },
  },
  async ({ pageId }) => {
    const page = await docmostClient.getPageJson(pageId);
    return jsonContent(page);
  },
);

// Tool: create_page
server.registerTool(
  "create_page",
  {
    description:
      "Create a new page with content (automatically moves it to the correct hierarchy).",
    inputSchema: {
      title: z.string().describe("Title of the page"),
      content: z.string().describe("Markdown content"),
      spaceId: z.string(),
      parentPageId: z
        .string()
        .optional()
        .describe("Optional parent page ID to nest under"),
    },
  },
  async ({ title, content, spaceId, parentPageId }) => {
    const result = await docmostClient.createPage(
      title,
      content,
      spaceId,
      parentPageId,
    );
    return jsonContent(result);
  },
);

// Tool: update_page
server.registerTool(
  "update_page",
  {
    description:
      "Replace a page's content from Markdown (and/or set a new title). " +
      "Re-imports the WHOLE document: block ids regenerate and only " +
      "markdown-expressible structure survives (tables and :::type callout " +
      "blocks are supported). For small wording fixes prefer edit_page_text; " +
      "for precise structural edits use get_page_json + update_page_json.",
    inputSchema: {
      pageId: z.string().describe("ID of the page to update"),
      content: z.string().describe("New Markdown content"),
      title: z.string().optional().describe("Optional new title"),
    },
  },
  async ({ pageId, content, title }) => {
    const result = await docmostClient.updatePage(pageId, content, title);
    return jsonContent(result);
  },
);

// Tool: update_page_json
server.registerTool(
  "update_page_json",
  {
    description:
      "Replace a page's content with a raw ProseMirror JSON document " +
      "(lossless write: preserves the block ids, callouts, tables and " +
      "attributes you pass in). Typical flow: get_page_json -> modify the " +
      "JSON -> update_page_json. Keep existing node ids intact so heading " +
      "anchors and history stay stable.",
    inputSchema: {
      pageId: z.string().describe("ID of the page to update"),
      content: z
        .any()
        .describe('ProseMirror document: {"type":"doc","content":[...]}'),
      title: z.string().optional().describe("Optional new title"),
    },
  },
  async ({ pageId, content, title }) => {
    const doc =
      typeof content === "string" ? JSON.parse(content) : content;
    const result = await docmostClient.updatePageJson(pageId, doc, title);
    return jsonContent(result);
  },
);

// Tool: edit_page_text
server.registerTool(
  "edit_page_text",
  {
    description:
      "Surgical find/replace inside a page's text. Preserves ALL structure: " +
      "block ids, marks, links, callouts, tables. Each `find` must match " +
      "exactly once (or set replaceAll). A match must lie inside one " +
      "formatting run; if the target text crosses bold/link boundaries the " +
      "tool reports it — use a shorter fragment or update_page_json then. " +
      "This is the preferred tool for fixing wording, typos, numbers, names.",
    inputSchema: {
      pageId: z.string().describe("ID of the page to edit"),
      edits: z
        .array(
          z.object({
            find: z.string().describe("Exact text to find"),
            replace: z.string().describe("Replacement text (may be empty)"),
            replaceAll: z
              .boolean()
              .optional()
              .describe("Replace every occurrence (default: must match once)"),
          }),
        )
        .min(1)
        .describe("List of find/replace operations, applied in order"),
    },
  },
  async ({ pageId, edits }) => {
    const result = await docmostClient.editPageText(pageId, edits);
    return jsonContent(result);
  },
);

// Tool: share_page
server.registerTool(
  "share_page",
  {
    description:
      "Make a page publicly accessible (idempotent) and return its public " +
      "URL. The URL format is <app>/share/<key>/p/<slugId>.",
    inputSchema: {
      pageId: z.string().describe("ID of the page to share"),
      searchIndexing: z
        .boolean()
        .optional()
        .describe("Allow search engines to index the page (default true)"),
    },
  },
  async ({ pageId, searchIndexing }) => {
    const result = await docmostClient.sharePage(pageId, searchIndexing ?? true);
    return jsonContent(result);
  },
);

// Tool: unshare_page
server.registerTool(
  "unshare_page",
  {
    description: "Remove the public share of a page (revokes the public URL).",
    inputSchema: {
      pageId: z.string().describe("ID of the page to unshare"),
    },
  },
  async ({ pageId }) => {
    const result = await docmostClient.unsharePage(pageId);
    return jsonContent(result);
  },
);

// Tool: list_shares
server.registerTool(
  "list_shares",
  {
    description:
      "List all public shares in the workspace with page titles and public URLs.",
  },
  async () => {
    const result = await docmostClient.listShares();
    return jsonContent(result);
  },
);

// Tool: move_page
server.registerTool(
  "move_page",
  {
    description:
      "Move a page to a new parent (nesting) or root. Essential for organizing pages created via 'import_page'.",
    inputSchema: {
      pageId: z.string(),
      parentPageId: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Target parent page ID. Pass 'null' or empty string to move to root.",
        ),
      position: z
        .string()
        .optional()
        .describe(
          "Optional position string (5-12 chars). Defaults to 'a00000' (end) if omitted.",
        ),
    },
  },
  async ({ pageId, parentPageId, position }) => {
    const finalParentId =
      parentPageId === "" || parentPageId === "null" ? null : parentPageId;

    await docmostClient.movePage(pageId, finalParentId || null, position);
    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully moved page ${pageId} to parent ${finalParentId || "root"}`,
        },
      ],
    };
  },
);

// Tool: delete_page
server.registerTool(
  "delete_page",
  {
    description: "Delete a single page by ID.",
    inputSchema: {
      pageId: z.string(),
    },
  },
  async ({ pageId }) => {
    await docmostClient.deletePage(pageId);
    return {
      content: [
        { type: "text" as const, text: `Successfully deleted page ${pageId}` },
      ],
    };
  },
);

// Tool: delete_pages
server.registerTool(
  "delete_pages",
  {
    description: "Delete multiple pages at once. Useful for cleanup.",
    inputSchema: {
      pageIds: z.array(z.string()),
    },
  },
  async ({ pageIds }) => {
    const results = await docmostClient.deletePages(pageIds);
    return jsonContent(results);
  },
);

// Tool: search
server.registerTool(
  "search",
  {
    description: "Search for pages and content.",
    inputSchema: {
      query: z.string().describe("Search query"),
      spaceId: z.string().optional().describe("Optional space ID to filter by"),
    },
  },
  async ({ query, spaceId }) => {
    const result = await docmostClient.search(query, spaceId);
    return jsonContent(result);
  },
);

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
