import FormData from "form-data";
import axios, { AxiosInstance } from "axios";
import {
  filterWorkspace,
  filterSpace,
  filterGroup,
  filterPage,
  filterSearchResult,
} from "./lib/filters.js";
import { convertProseMirrorToMarkdown } from "./lib/markdown-converter.js";
import {
  updatePageContentRealtime,
  replacePageContent,
} from "./lib/collaboration.js";
import { applyTextEdits, TextEdit } from "./lib/json-edit.js";
import { getCollabToken, performLogin } from "./lib/auth-utils.js";

export class DocmostClient {
  private client: AxiosInstance;
  private token: string | null = null;
  private apiUrl: string;
  private email: string;
  private password: string;

  constructor(baseURL: string, email: string, password: string) {
    this.apiUrl = baseURL;
    this.email = email;
    this.password = password;
    this.client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /** Application base URL (API URL without the /api suffix). */
  get appUrl(): string {
    return this.apiUrl.replace(/\/api\/?$/, "");
  }

  async login() {
    this.token = await performLogin(this.apiUrl, this.email, this.password);
    this.client.defaults.headers.common["Authorization"] =
      `Bearer ${this.token}`;
  }

  async ensureAuthenticated() {
    if (!this.token) {
      await this.login();
    }
  }

  /**
   * Generic pagination handler for Docmost API endpoints
   */
  async paginateAll<T = any>(
    endpoint: string,
    basePayload: Record<string, any> = {},
    limit: number = 100,
  ): Promise<T[]> {
    await this.ensureAuthenticated();

    const clampedLimit = Math.max(1, Math.min(100, limit));

    let page = 1;
    let allItems: T[] = [];
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await this.client.post(endpoint, {
        ...basePayload,
        limit: clampedLimit,
        page,
      });

      const data = response.data;
      const items = data.data?.items || data.items || [];
      const meta = data.data?.meta || data.meta;

      allItems = allItems.concat(items);
      hasNextPage = meta?.hasNextPage || false;
      page++;
    }

    return allItems;
  }

  async getWorkspace() {
    await this.ensureAuthenticated();
    const response = await this.client.post("/workspace/info", {});
    return {
      data: filterWorkspace(response.data.data),
      success: response.data.success,
    };
  }

  async getSpaces() {
    const spaces = await this.paginateAll("/spaces", {});
    return spaces.map((space) => filterSpace(space));
  }

  async getGroups() {
    const groups = await this.paginateAll("/groups", {});
    return groups.map((group) => filterGroup(group));
  }

  async listPages(spaceId?: string) {
    const payload = spaceId ? { spaceId } : {};
    const pages = await this.paginateAll("/pages/recent", payload);
    return pages.map((page) => filterPage(page));
  }

  async listSidebarPages(spaceId: string, pageId: string) {
    await this.ensureAuthenticated();
    const response = await this.client.post("/pages/sidebar-pages", {
      spaceId,
      pageId,
      page: 1,
    });
    return response.data?.data?.items || [];
  }

  /** Raw page info including the ProseMirror JSON content and slugId. */
  async getPageRaw(pageId: string) {
    await this.ensureAuthenticated();
    const response = await this.client.post("/pages/info", { pageId });
    return response.data.data;
  }

  async getPage(pageId: string) {
    await this.ensureAuthenticated();
    const resultData = await this.getPageRaw(pageId);

    let content = resultData.content
      ? convertProseMirrorToMarkdown(resultData.content)
      : "";

    // Always fetch subpages to provide context to the agent
    let subpages: any[] = [];
    try {
      subpages = await this.listSidebarPages(resultData.spaceId, pageId);
    } catch (e: any) {
      console.warn("Failed to fetch subpages:", e);
    }

    // Resolve subpages if the placeholder exists
    if (content && content.includes("{{SUBPAGES}}")) {
      if (subpages && subpages.length > 0) {
        const list = subpages
          .map((p: any) => `- [${p.title}](page:${p.id})`)
          .join("\n");
        content = content.replace("{{SUBPAGES}}", `### Subpages\n${list}`);
      } else {
        content = content.replace("{{SUBPAGES}}", "");
      }
    }

    return {
      data: filterPage(resultData, content, subpages),
      success: true,
    };
  }

  /** Page info + raw ProseMirror JSON content (lossless representation). */
  async getPageJson(pageId: string) {
    const data = await this.getPageRaw(pageId);
    return {
      id: data.id,
      slugId: data.slugId,
      title: data.title,
      parentPageId: data.parentPageId,
      spaceId: data.spaceId,
      updatedAt: data.updatedAt,
      content: data.content || { type: "doc", content: [] },
    };
  }

  /**
   * Create a new page with title and content.
   * Uses the /pages/import workaround (the only endpoint accepting content),
   * then moves the page and restores the exact title: the import endpoint
   * derives the title from the FILENAME and replaces spaces with
   * underscores, so we explicitly re-set it via /pages/update afterwards.
   */
  async createPage(
    title: string,
    content: string,
    spaceId: string,
    parentPageId?: string,
  ) {
    await this.ensureAuthenticated();

    if (parentPageId) {
      try {
        await this.getPage(parentPageId);
      } catch (e) {
        throw new Error(`Parent page with ID ${parentPageId} not found.`);
      }
    }

    // 1. Create content via Import (using multipart/form-data)
    const form = new FormData();
    form.append("spaceId", spaceId);

    const fileContent = Buffer.from(content, "utf-8");
    form.append("file", fileContent, {
      filename: `${title || "import"}.md`,
      contentType: "text/markdown",
    });

    const headers = {
      ...form.getHeaders(),
      Authorization: `Bearer ${this.token}`,
    };

    const response = await axios.post(`${this.apiUrl}/pages/import`, form, {
      headers,
    });
    const newPageId = response.data.data.id;

    // 2. Move to parent if needed
    if (parentPageId) {
      await this.movePage(newPageId, parentPageId);
    }

    // 3. Restore the exact title (import mangles spaces into underscores)
    if (title) {
      await this.client.post("/pages/update", { pageId: newPageId, title });
    }

    return this.getPage(newPageId);
  }

  /**
   * Update a page's content from markdown and optionally its title.
   * NOTE: full re-import — block ids regenerate. For surgical changes
   * use editPageText / updatePageJson instead.
   */
  async updatePage(pageId: string, content: string, title?: string) {
    await this.ensureAuthenticated();

    if (title) {
      await this.client.post("/pages/update", { pageId, title });
    }

    let collabToken = "";
    try {
      collabToken = await getCollabToken(this.apiUrl, this.token!);
      await updatePageContentRealtime(pageId, content, collabToken, this.apiUrl);
    } catch (error: any) {
      console.error(
        "Failed to update page content via realtime collaboration:",
        error,
      );
      const tokenPreview = collabToken
        ? collabToken.substring(0, 15) + "..."
        : "null";
      throw new Error(
        `Failed to update page content: ${error.message} (Token: ${tokenPreview})`,
      );
    }

    return {
      success: true,
      modified: true,
      message: "Page updated successfully.",
      pageId: pageId,
    };
  }

  /** Replace page content with a raw ProseMirror JSON document (lossless). */
  async updatePageJson(pageId: string, doc: any, title?: string) {
    await this.ensureAuthenticated();

    if (!doc || doc.type !== "doc") {
      throw new Error('content must be a ProseMirror document ({"type":"doc",...})');
    }

    if (title) {
      await this.client.post("/pages/update", { pageId, title });
    }

    const collabToken = await getCollabToken(this.apiUrl, this.token!);
    await replacePageContent(pageId, doc, collabToken, this.apiUrl);

    return {
      success: true,
      modified: true,
      message: "Page content replaced from ProseMirror JSON.",
      pageId,
    };
  }

  /**
   * Surgical text edits: find/replace inside text nodes of the live
   * document. Preserves all block ids, marks, callouts and tables.
   */
  async editPageText(pageId: string, edits: TextEdit[]) {
    await this.ensureAuthenticated();

    const data = await this.getPageRaw(pageId);
    if (!data.content) {
      throw new Error("Page has no content to edit.");
    }

    const { doc, results } = applyTextEdits(data.content, edits);

    const collabToken = await getCollabToken(this.apiUrl, this.token!);
    await replacePageContent(pageId, doc, collabToken, this.apiUrl);

    return {
      success: true,
      pageId,
      edits: results,
      message: "Text edits applied (node ids and formatting preserved).",
    };
  }

  /** Build the public share URL for a page. */
  private shareUrl(shareKey: string, slugId: string): string {
    return `${this.appUrl}/share/${shareKey}/p/${slugId}`;
  }

  /** Share a page publicly (idempotent) and return the public URL. */
  async sharePage(pageId: string, searchIndexing: boolean = true) {
    await this.ensureAuthenticated();
    const response = await this.client.post("/shares/create", {
      pageId,
      includeSubPages: false,
      searchIndexing,
    });
    const share = response.data.data;
    const slugId = share.page?.slugId || (await this.getPageRaw(pageId)).slugId;
    return {
      shareId: share.id,
      key: share.key,
      pageId: share.pageId,
      publicUrl: this.shareUrl(share.key, slugId),
      searchIndexing: share.searchIndexing,
    };
  }

  /** List all public shares in the workspace with their URLs. */
  async listShares() {
    const shares = await this.paginateAll("/shares", {});
    return shares.map((s: any) => ({
      shareId: s.id,
      key: s.key,
      pageId: s.pageId,
      pageTitle: s.page?.title,
      publicUrl: s.page?.slugId ? this.shareUrl(s.key, s.page.slugId) : null,
      searchIndexing: s.searchIndexing,
      createdAt: s.createdAt,
    }));
  }

  /** Remove the public share of a page. */
  async unsharePage(pageId: string) {
    await this.ensureAuthenticated();
    const shares = await this.listShares();
    const share = shares.find((s: any) => s.pageId === pageId);
    if (!share) {
      throw new Error(`Page ${pageId} is not shared.`);
    }
    await this.client.post("/shares/delete", { shareId: share.shareId });
    return { success: true, removedShareId: share.shareId, pageId };
  }

  async search(query: string, spaceId?: string) {
    await this.ensureAuthenticated();
    const response = await this.client.post("/search", {
      query,
      spaceId,
    });

    const items = response.data?.data || [];
    const filteredItems = items.map((item: any) => filterSearchResult(item));

    return {
      items: filteredItems,
      success: response.data?.success || false,
    };
  }

  async movePage(
    pageId: string,
    parentPageId: string | null,
    position?: string,
  ) {
    await this.ensureAuthenticated();
    // Docmost requires position >= 5 chars.
    const validPosition = position || "a00000";

    return this.client
      .post("/pages/move", {
        pageId,
        parentPageId,
        position: validPosition,
      })
      .then((res) => res.data);
  }

  async deletePage(pageId: string) {
    await this.ensureAuthenticated();
    return this.client
      .post("/pages/delete", { pageId })
      .then((res) => res.data);
  }

  async deletePages(pageIds: string[]) {
    await this.ensureAuthenticated();
    const promises = pageIds.map((id) =>
      this.client
        .post("/pages/delete", { pageId: id })
        .then(() => ({ id, success: true }))
        .catch((err: any) => ({ id, success: false, error: err.message })),
    );
    return Promise.all(promises);
  }
}
