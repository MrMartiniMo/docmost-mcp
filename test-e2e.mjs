// End-to-end test of the docmost-mcp client against a live Docmost server.
// Creates a throwaway page, exercises every code path, cleans up after itself.
// Usage: DOCMOST_API_URL=... DOCMOST_EMAIL=... DOCMOST_PASSWORD=... node test-e2e.mjs
import { DocmostClient } from "./build/client.js";
import axios from "axios";

const API = process.env.DOCMOST_API_URL;
if (!API || !process.env.DOCMOST_EMAIL || !process.env.DOCMOST_PASSWORD) {
  console.error("Set DOCMOST_API_URL, DOCMOST_EMAIL and DOCMOST_PASSWORD env variables.");
  process.exit(2);
}
const APP = API.replace(/\/api\/?$/, "");
const client = new DocmostClient(API, process.env.DOCMOST_EMAIL, process.env.DOCMOST_PASSWORD);

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failed++;
};

const MD = `:::info
**Тестовый callout.** Он должен стать узлом callout, а не blockquote.
:::

Первый абзац с **жирным** и [ссылкой](https://example.com). Маркер тут [1] стоит.

## Раздел два

| Колонка А | Колонка Б |
| --- | --- |
| раз | два |
| три | четыре |

Последний абзац со словом БУКВОЕД для замены.
`;

async function main() {
  const spaces = await client.getSpaces();
  const spaceId = spaces[0].id;
  let pageId = null;

  try {
    // 1. create_page: title with spaces must survive (was: underscores bug)
    const created = await client.createPage("Тест апгрейда MCP сервера", MD, spaceId);
    pageId = created.data.id;
    check("create_page: title keeps spaces", created.data.title === "Тест апгрейда MCP сервера", created.data.title);
    check("create_page: slugId exposed", typeof created.data.slugId === "string" && created.data.slugId.length > 0, created.data.slugId);

    // 2. get_page_json: raw ProseMirror with callout + table
    const pj = await client.getPageJson(pageId);
    const types = pj.content.content.map((n) => n.type);
    check("get_page_json: callout node present", types.includes("callout"), types.join(","));
    check("get_page_json: table node present", types.includes("table"));
    check("get_page_json: slugId present", !!pj.slugId);

    // 3. edit_page_text: surgical replace, ids preserved
    const idsBefore = JSON.stringify(
      pj.content.content.filter((n) => n.attrs?.id).map((n) => n.attrs.id),
    );
    const editRes = await client.editPageText(pageId, [
      { find: "БУКВОЕД", replace: "КНИГОЛЮБ" },
      { find: "[1]", replace: "[42]" },
    ]);
    check("edit_page_text: both edits applied", editRes.edits.every((e) => e.replacements === 1));
    await new Promise((r) => setTimeout(r, 16000)); // wait for server persistence
    const pj2 = await client.getPageJson(pageId);
    const text2 = JSON.stringify(pj2.content);
    check("edit_page_text: replacement visible", text2.includes("КНИГОЛЮБ") && text2.includes("[42]"));
    check("edit_page_text: old text gone", !text2.includes("БУКВОЕД"));
    const idsAfter = JSON.stringify(
      pj2.content.content.filter((n) => n.attrs?.id).map((n) => n.attrs.id),
    );
    check("edit_page_text: block ids preserved", idsBefore === idsAfter);
    check("edit_page_text: callout survived", JSON.stringify(pj2.content).includes('"callout"'));
    check("edit_page_text: table survived", pj2.content.content.some((n) => n.type === "table"));

    // 4. error reporting: ambiguous and missing finds
    let err1 = "";
    try { await client.editPageText(pageId, [{ find: "Колонка", replace: "X" }]); } catch (e) { err1 = e.message; }
    check("edit_page_text: ambiguous match rejected", err1.includes("matches"), err1);
    let err2 = "";
    try { await client.editPageText(pageId, [{ find: "НЕСУЩЕСТВУЮЩЕЕ", replace: "X" }]); } catch (e) { err2 = e.message; }
    check("edit_page_text: missing text reported", err2.includes("not found"), err2);

    // 5. update_page (markdown): table + callout must survive the re-import
    await client.updatePage(pageId, MD + "\nДобавленный абзац.\n");
    await new Promise((r) => setTimeout(r, 16000));
    const pj3 = await client.getPageJson(pageId);
    const types3 = pj3.content.content.map((n) => n.type);
    check("update_page md: callout survives re-import", types3.includes("callout"), types3.join(","));
    check("update_page md: table survives re-import", types3.includes("table"));
    const tableNode = pj3.content.content.find((n) => n.type === "table");
    const cellText = JSON.stringify(tableNode);
    check("update_page md: table cells intact", cellText.includes("четыре") && cellText.includes("Колонка А"));

    // 6. update_page_json: lossless write round-trip
    pj3.content.content.push({
      type: "paragraph",
      attrs: { id: "testidjsonpush", indent: 0, textAlign: null },
      content: [{ type: "text", text: "Абзац, добавленный через update_page_json." }],
    });
    await client.updatePageJson(pageId, pj3.content);
    await new Promise((r) => setTimeout(r, 16000));
    const pj4 = await client.getPageJson(pageId);
    const lastNode = pj4.content.content[pj4.content.content.length - 1];
    check("update_page_json: paragraph appended", JSON.stringify(pj4.content).includes("добавленный через update_page_json"));
    check("update_page_json: custom node id preserved", lastNode.attrs?.id === "testidjsonpush", lastNode.attrs?.id);

    // 7. shares: create (idempotent), public access, list, unshare
    const share = await client.sharePage(pageId);
    check("share_page: returns public URL", share.publicUrl?.startsWith(`${APP}/share/`), share.publicUrl);
    const share2 = await client.sharePage(pageId);
    check("share_page: idempotent", share2.key === share.key);
    const anon = await axios.post(`${API}/shares/page-info`, { pageId: pj4.slugId, shareId: share.key }, { validateStatus: () => true });
    check("share_page: anonymous access works", anon.status === 200);
    const shares = await client.listShares();
    check("list_shares: contains our page", shares.some((s) => s.pageId === pageId && s.publicUrl === share.publicUrl));
    const un = await client.unsharePage(pageId);
    check("unshare_page: success", un.success === true);
    const anon2 = await axios.post(`${API}/shares/page-info`, { pageId: pj4.slugId, shareId: share.key }, { validateStatus: () => true });
    check("unshare_page: public access revoked", anon2.status !== 200, `status=${anon2.status}`);

    // 8. get_page markdown round-trip sanity (table separator present)
    const md = await client.getPage(pageId);
    check("get_page md: table separator emitted", md.data.content.includes("| --- |"), "");
    check("get_page md: callout exported as :::", md.data.content.includes(":::info"));
  } finally {
    if (pageId) {
      await client.deletePage(pageId);
      console.log("cleanup: test page deleted");
    }
  }

  console.log(failed === 0 ? "\nALL TESTS PASSED" : `\n${failed} TESTS FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
