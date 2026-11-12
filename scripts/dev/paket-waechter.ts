// Wächter des Besucherpakets (WI-0235, Optimierer). Liest einen fertigen Bau (`apps/web/dist`), zerlegt das Start-JS nach Herkunft
// (`paket-herkunft.ts`) und schlägt an, wenn es die Grenze reißt oder, sobald der Editor abgetrennt ist, Editor-Code enthält
// (`paket-grenzen.ts`).
//
//     node scripts/dev/paket-waechter.ts [apps/web/dist] [--json <datei>]
//
// Exit 0 grün, 1 rot, 2 Bau fehlt. Ein Werkzeug des Prüfwegs, keine Prüfung im Betrieb (`AGENTS.md`, „Blockierende Prüfungen im
// Betrieb“): Es hält keinen Import, keine Ableitung und keinen Release an.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { pruefePaket, type PaketMessung } from "./paket-grenzen.ts";
import { fuerJedesStueck, herkunft, KLASSEN, startDateien, type Klasse, type SourceMap } from "./paket-herkunft.ts";

const argumente = process.argv.slice(2);
const jsonStelle = argumente.indexOf("--json");
const jsonZiel = jsonStelle >= 0 ? argumente[jsonStelle + 1] : undefined;
const dist =
    argumente.find((wert, i) => !wert.startsWith("--") && (jsonStelle < 0 || i !== jsonStelle + 1)) ??
    join("apps", "web", "dist");

const indexPfad = join(dist, "index.html");
if (!existsSync(indexPfad)) {
    console.error(`paket-waechter: ${indexPfad} fehlt; erst bauen (npm run build).`);
    process.exit(2);
}
const start = startDateien(readFileSync(indexPfad, "utf8"));

const roh = new Map<Klasse, number>(KLASSEN.map((k) => [k, 0]));
const texte = new Map<Klasse, string[]>(KLASSEN.map((k) => [k, []]));
const editorQuellen = new Map<string, number>();
let jsRoh = 0;
let jsGzip = 0;
for (const datei of start.js) {
    const code = readFileSync(join(dist, datei), "utf8");
    jsRoh += Buffer.byteLength(code, "utf8");
    jsGzip += gzipSync(code).length;
    const mapPfad = join(dist, `${datei}.map`);
    const map: SourceMap = existsSync(mapPfad)
        ? (JSON.parse(readFileSync(mapPfad, "utf8")) as SourceMap)
        : { sources: [], mappings: "" };
    fuerJedesStueck(code, map, (quelle, stueck) => {
        const klasse = herkunft(quelle);
        const bytes = Buffer.byteLength(stueck, "utf8");
        roh.set(klasse, (roh.get(klasse) ?? 0) + bytes);
        texte.get(klasse)?.push(stueck);
        if (klasse === "Editor" && quelle !== undefined)
            editorQuellen.set(quelle, (editorQuellen.get(quelle) ?? 0) + bytes);
    });
}
let cssRoh = 0;
let cssGzip = 0;
for (const datei of start.css) {
    const css = readFileSync(join(dist, datei));
    cssRoh += css.length;
    cssGzip += gzipSync(css).length;
}

// gzip je Klasse ist eine Näherung: der Text jeder Klasse für sich gepackt, anteilig auf das echte gzip des Ganzen umgelegt.
const gzTeil = new Map<Klasse, number>(KLASSEN.map((k) => [k, gzipSync((texte.get(k) ?? []).join("")).length]));
const gzSumme = [...gzTeil.values()].reduce((a, b) => a + b, 0) || 1;
const messung: PaketMessung = {
    jsRoh,
    jsGzip,
    cssRoh,
    cssGzip,
    klassen: Object.fromEntries(
        KLASSEN.map((k) => [k, { roh: roh.get(k) ?? 0, gzip: Math.round(((gzTeil.get(k) ?? 0) / gzSumme) * jsGzip) }]),
    ) as PaketMessung["klassen"],
    editorQuellen: [...editorQuellen.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([quelle, bytes]) => ({ quelle, bytes })),
};
const urteil = pruefePaket(messung);

const kb = (n: number): string => `${Math.round(n / 1024).toLocaleString("de-DE")} KB`;
// Ausgabe über stdout: Der Hausstandard lässt auf der Konsole nur warn und error zu, und ein Bericht ist keine Warnung.
const sag = (zeile: string): void => {
    process.stdout.write(zeile + "\n");
};
sag(
    `Besucherpaket (${dist}): Start-JS ${String(start.js.length)} Datei(en), ${kb(jsRoh)} roh, ${kb(jsGzip)} gzip; CSS ${kb(cssRoh)} roh, ${kb(cssGzip)} gzip`,
);
for (const k of KLASSEN) {
    const { roh: r, gzip: g } = messung.klassen[k];
    if (r === 0) continue;
    const anteil = `${((100 * r) / jsRoh).toFixed(1)} %`;
    sag(`  ${k.padEnd(15)} ${kb(r).padStart(9)} ${anteil.padStart(7)}  ~${kb(g)} gzip`);
}
for (const zeile of urteil.zeilen) sag(zeile);
if (jsonZiel !== undefined) writeFileSync(jsonZiel, `${JSON.stringify({ start, messung, urteil }, null, 1)}\n`);
process.exit(urteil.gruen ? 0 : 1);
