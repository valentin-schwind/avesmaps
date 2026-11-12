import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { aehnlichkeitsBericht, holeWahrnehmungNach } from "../media-editor/aehnlich.ts";
import { MediaStore } from "../media/storage.ts";

/**
 * Ähnliche Bilder (WI-0068 D2): Wahrnehmungs-Hash für den Bestand nachholen und die Abstände zur Kalibrierung messen.
 *
 *   npm run media:aehnlich -- --nachholen [--limit <n>]            rechnet nur, schreibt nichts
 *   npm run media:aehnlich -- --nachholen --schreiben [--limit <n>] schreibt NUR die Spalte media_file.perceptual_hash
 *   npm run media:aehnlich -- --bericht [--aus <datei.json>] [--paar <id>,<id>] [--naechste <n>]   liest nur
 *
 * Kein Zusammenführen, keine Veröffentlichung, keine Bindung: Der Hash hält fest, entschieden wird erst mit der Schwelle aus dem Bericht.
 * `--nachholen` braucht den Medienspeicher (`--media-root` oder `MEDIA_ROOT`, absolut).
 */
const { values } = parseArgs({
    options: {
        nachholen: { type: "boolean", default: false },
        schreiben: { type: "boolean", default: false },
        limit: { type: "string" },
        bericht: { type: "boolean", default: false },
        aus: { type: "string" },
        paar: { type: "string", multiple: true },
        naechste: { type: "string", default: "40" },
        "media-root": { type: "string" },
    },
});

if (values.nachholen === values.bericht) {
    console.error("Genau eines: --nachholen oder --bericht");
    process.exit(2);
}
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    console.error("--limit braucht eine ganze Zahl größer als 0");
    process.exit(2);
}
const paare = (values.paar ?? []).map((paar) => paar.split(","));
if (paare.some((paar) => paar.length !== 2)) {
    console.error("--paar braucht zwei Kennungen mit Komma: <id>,<id>");
    process.exit(2);
}
const database = createDatabase(config.databaseUrl, { max: 1 });

try {
    if (values.nachholen) {
        const root = values["media-root"] ?? process.env["MEDIA_ROOT"] ?? config.mediaRoot;
        if (root === undefined || root === "" || !isAbsolute(root)) {
            console.error("--nachholen braucht den Medienspeicher: --media-root <absoluter Ordner> oder MEDIA_ROOT");
            process.exit(2);
        }
        if (!values.schreiben)
            console.log("PROBELAUF - nur gerechnet, nichts geschrieben (--schreiben schreibt die Spalte)\n");
        const bericht = await holeWahrnehmungNach(database, new MediaStore(root), {
            schreiben: values.schreiben,
            limit,
        });
        console.log(`Rezept      ${bericht.rezept}`);
        console.log(`ohne Hash   ${String(bericht.offen)} Originale angesehen`);
        console.log(`gerechnet   ${String(bericht.gerechnet)}`);
        console.log(`geschrieben ${String(bericht.geschrieben)}`);
        console.log(`Notaus      ${String(bericht.notaus)} nicht gelesen`);
        console.log(`Fehler      ${String(bericht.fehler.length)}`);
        for (const fehler of bericht.fehler.slice(0, 20)) console.log(`  ${fehler.asset}  ${fehler.grund}`);
    } else {
        const bericht = await aehnlichkeitsBericht(database, {
            naechste: Math.max(1, Number(values.naechste)),
            paare: paare.map(([a, b]) => [a!, b!] as const),
        });
        console.log(`Rezept ${bericht.rezept}; Originale ohne Hash: ${String(bericht.ohneHash)}`);
        for (const typ of bericht.typen) {
            const bis = (grenze: number): number => typ.verteilung.slice(0, grenze + 1).reduce((a, b) => a + b, 0);
            console.log(
                `\n${typ.typ}: ${String(typ.werke)} Werke, ${String(typ.dateien)} Dateien; bytegleich ${String(typ.bytegleich.gruppen)} Gruppen (größter Abstand ${String(typ.bytegleich.groessterAbstand)})`,
            );
            console.log(
                `  Paare mit Abstand ≤ 4: ${String(bis(4))} · ≤ 6: ${String(bis(6))} · ≤ 8: ${String(bis(8))} · ≤ 10: ${String(bis(10))} · ≤ 12: ${String(bis(12))}`,
            );
            for (const paar of typ.naechste.slice(0, 12)) {
                console.log(
                    `  ${String(paar.abstand).padStart(2)}  ${paar.a.titel ?? paar.a.id} (${paar.a.masse})  ~  ${paar.b.titel ?? paar.b.id} (${paar.b.masse})`,
                );
            }
        }
        for (const paar of bericht.paare) {
            console.log(`\nPaar ${paar.a} ~ ${paar.b}: ${paar.abstand === null ? "ohne Hash" : String(paar.abstand)}`);
        }
        if (values.aus !== undefined) {
            writeFileSync(values.aus, `${JSON.stringify(bericht, null, 2)}\n`);
            console.log(`\nBericht: ${values.aus}`);
        }
    }
} finally {
    await database.end({ timeout: 5 });
}
