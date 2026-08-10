/**
 * Prueba del ciclo LEER -> REESCRIBIR (get_page -> update_page) sobre una pagina real.
 *
 * Es la prueba que el fallo de las tablas exigia y que nadie habia hecho: hasta
 * marea-3, `convertProseMirrorToMarkdown` no emitia la fila separadora `| --- |`,
 * asi que reescribir una pagina desde su propio read-back convertia todas sus
 * tablas en parrafos, y el read-back siguiente salia identico al bueno. Vikunja id 1351.
 *
 * Lleva CONTROL NEGATIVO a proposito: si la variante sin separador NO destruye las
 * tablas, es que la prueba no esta midiendo nada y su verde no vale.
 *
 * uso:  node test/roundtrip-tables.mjs <pagina.json>
 * donde <pagina.json> es el ProseMirror JSON de una pagina con tablas, p.ej.
 *   docker exec marea-docmost-db psql -U docmost -d docmost -tAc \
 *     "SELECT content::text FROM pages WHERE id = '<uuid>'" > pagina.json
 */
import fs from "node:fs";
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { convertProseMirrorToMarkdown } from "../build/lib/markdown-converter.js";
import { ensureTableSeparators } from "../build/lib/collaboration.js";
import { tiptapExtensions } from "../build/lib/tiptap-extensions.js";

const doc = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));

function cuenta(n, acc = {}) {
  acc[n.type] = (acc[n.type] || 0) + 1;
  for (const c of n.content || []) cuenta(c, acc);
  return acc;
}
const texto = (n) => (n.type === "text" ? n.text || "" : (n.content || []).map(texto).join(""));
// se ignoran barras, escapes, asteriscos y espacios: comparamos CONTENIDO, no sintaxis
const norm = (s) => s.replace(/[|\\*\s]/g, "");

function* walk(n) {
  yield n;
  for (const c of n.content || []) yield* walk(c);
}

const orig = cuenta(doc);
console.log(`ORIGINAL                      tablas=${orig.table || 0} filas=${orig.tableRow || 0}`);

// --- 1. lectura, tal como la hace get_page ---
const md = convertProseMirrorToMarkdown(doc);
const separadores = (md.match(/^\|(?: --- \|)+$/gm) || []).length;
console.log(`markdown de get_page          ${md.length} ch · filas separadoras = ${separadores}`);

// --- 2. escritura, tal como la hace update_page ---
const rt = generateJSON(await marked.parse(ensureTableSeparators(md)), tiptapExtensions);
const c1 = cuenta(rt);
console.log(`TRAS REESCRIBIR               tablas=${c1.table || 0} filas=${c1.tableRow || 0}`);

// --- 3. CONTROL NEGATIVO: el comportamiento anterior a marea-3 ---
const mdViejo = md.replace(/^\|(?: --- \|)+$\n/gm, "");
const c2 = cuenta(generateJSON(await marked.parse(mdViejo), tiptapExtensions));
console.log(`control sin separador (viejo) tablas=${c2.table || 0} filas=${c2.tableRow || 0}`);

// --- 4. la guarda del lado escritura, por si el markdown llega sin separador ---
const c3 = cuenta(generateJSON(await marked.parse(ensureTableSeparators(mdViejo)), tiptapExtensions));
console.log(`guarda de escritura           tablas=${c3.table || 0} filas=${c3.tableRow || 0}`);

const okTablas = (c1.table || 0) === (orig.table || 0) && (c1.tableRow || 0) === (orig.tableRow || 0);
const okTexto = norm(texto(doc)) === norm(texto(rt));
const okControl = (c2.table || 0) === 0;
const okGuarda = (c3.table || 0) === (orig.table || 0);

// limitacion conocida, NO la arregla este parche: un run en negrita cuyo texto
// empieza o acaba con espacio produce `**texto **`, que no es enfasis valido en
// markdown y vuelve como asteriscos literales. Se avisa para que no se lea como
// «el ciclo es byte a byte».
const bordes = [...walk(doc)].filter(
  (n) => n.type === "text" && (n.marks || []).some((m) => m.type === "bold") && n.text !== n.text.trim(),
);

console.log();
console.log(`[${okTablas ? "OK " : "***"}] el ciclo conserva tablas y filas`);
console.log(`[${okTexto ? "OK " : "***"}] el ciclo conserva el contenido`);
console.log(`[${okControl ? "OK " : "***"}] CONTROL NEGATIVO: sin separador se destruian (0 tablas)`);
console.log(`[${okGuarda ? "OK " : "***"}] la guarda rescata un markdown que llega sin separador`);
if (bordes.length) {
  console.log(
    `[avi] ${bordes.length} run(s) en negrita con espacio en el borde: el ciclo por markdown les deja` +
      ` los asteriscos literales. Limitacion conocida, ajena a este parche.`,
  );
  for (const n of bordes.slice(0, 5)) console.log(`      ${JSON.stringify(n.text.slice(0, 60))}`);
}
process.exit(okTablas && okTexto && okControl && okGuarda ? 0 : 1);
