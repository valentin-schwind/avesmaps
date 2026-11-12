import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { AVENTURIA } from "@avesmaps3d/shared";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MigrationAborted } from "./places.ts";
import { importSprachen, type SprachenImportBericht } from "./sprachen-import.ts";
import { SPRACHEN_TAFEL } from "./sprachen-karte.ts";

/**
 * Spielt die Sprachenkarte ein (WI-0261 S6): die elf Sprachen der Farbtafel, ihre Flächen aus `sprachen-s1.geojson` (Werkzeug
 * `tools/sprachenkarte/`), die Zuordnung der Wiki-Artikel und danach den Auftrag, der die Treffer neu rechnet. Die Datei ist ein
 * Ergebnis außerhalb des Repositoriums; dieses Werkzeug holt nichts und ruft keinen Endpunkt.
 *
 * 🔴 Eine Kartendatenübernahme (Map Mutation Guard): nur mit dem Zuruf des Betreibers für genau diese Datenbank. OHNE `--operator-said`
 * rechnet das Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das Journal und den Auftrag. `--dry-run` rechnet
 * auch MIT Zitat nur. Stage und Production laufen über Claudio mit der Freigabe der jeweiligen Umgebung, nie von hier. Eine Freigabe aus der
 * Verwaltung (`--auftrag`) gibt es hier bewusst nicht.
 *
 * Beispiele (aus der Wurzel des Repositoriums):
 *   npm run migrate:sprachen -- --source C:\avesmaps3d-data\work\sprachen-20261030\ergebnis\sprachen-s1.geojson
 *   npm run migrate:sprachen -- --source <datei> --json
 *   npm run migrate:sprachen -- --source <datei> --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        domain: { type: "string" },
        "operator-said": { type: "string" },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
    },
});

if (!values.source) {
    console.error(
        'usage: --source <sprachen-s1.geojson> [--domain <kartendomaene>] [--operator-said "<Zitat>"] [--dry-run] [--json]',
    );
    process.exit(1);
}

// Eine Freigabe: der Zuruf des Betreibers (`abgleiche/freigabe.ts`); `--auftrag` gibt es für dieses Werkzeug nicht.
const freigabe = freigabeOderEnde({ "operator-said": values["operator-said"] });
const dryRun = values["dry-run"] || !freigabe.apply;
const mapDomainId = values.domain ?? AVENTURIA.mapDomain;
let quelle: Buffer;
try {
    quelle = await readFile(values.source);
} catch (error) {
    console.error(`--source ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

/** Der Bericht als Text: eine Zeile je Gruppe, Zahlen links. */
function textBericht(bericht: SprachenImportBericht): string[] {
    const zeilen: string[] = [];
    zeilen.push(`run        ${bericht.runId}${bericht.dryRun ? " (verworfen)" : ""}`);
    zeilen.push(`quelle     ${bericht.sourceRef}`);
    zeilen.push(`domäne     ${bericht.mapDomainId}`);
    const eintraege = bericht.eintraege;
    zeilen.push(
        `einträge   angelegt ${String(eintraege.angelegt)}, vorhanden ${String(eintraege.vorhanden)}, abweichend ${String(eintraege.abweichend.length)}`,
    );
    for (const abweichung of eintraege.abweichend) {
        zeilen.push(
            `  abweichend ${abweichung.schluessel}: ${abweichung.felder.map((feld) => `${feld.feld} ${feld.vorhanden} (Tafel ${feld.tafel})`).join(", ")}`,
        );
    }
    const flaechen = bericht.flaechen;
    zeilen.push(
        `flächen    angelegt ${String(flaechen.angelegt)}, stillgelegt ${String(flaechen.stillgelegt)}, unverändert ${String(flaechen.unveraendert)}; ` +
            `bisher aktiv ${String(flaechen.bisherAktiv)}, Flächen der Redaktion unberührt ${String(flaechen.redaktionUnberuehrt)}; ` +
            `Stützpunkte der Datei ${String(flaechen.stuetzpunkte)}`,
    );
    if (flaechen.dateiSchonEingespielt) {
        zeilen.push(
            `  die Datei ist schon eingespielt (Revision ${bericht.quelleRevision.slice(0, 12)}…): an den Flächen ändert der Lauf nichts`,
        );
    }
    zeilen.push(`${"sprache".padEnd(12)} teile  fläche E²  stützpunkte  löcher`);
    for (const tafel of SPRACHEN_TAFEL) {
        const zahlen = flaechen.jeSprache[tafel.schluessel];
        if (zahlen === undefined) {
            zeilen.push(`${tafel.schluessel.padEnd(12)} (keine Fläche in der Datei)`);
            continue;
        }
        zeilen.push(
            `${tafel.schluessel.padEnd(12)} ${String(zahlen.teile).padStart(5)} ${zahlen.flaecheE2.toFixed(1).padStart(10)} ${String(zahlen.stuetzpunkte).padStart(11)} ${String(zahlen.loecher).padStart(7)}`,
        );
    }
    const wiki = bericht.wiki;
    zeilen.push(
        wiki.stand
            ? `wiki       Stand: ${String(wiki.aktiveArtikel)} aktive Artikel; zugeordnet ${String(wiki.angelegt)}, schon vorhanden ${String(wiki.vorhanden)}, ` +
                  `anderswo ${String(wiki.anderswo.length)}, von der Redaktion gelöst ${String(wiki.vonRedaktionGeloest)}, fehlend ${String(wiki.fehlend.length)}`
            : "wiki       kein Wiki-Stand der Sprachartikel (WikiSync noch nicht gelaufen): nichts zugeordnet",
    );
    for (const titel of wiki.fehlend) zeilen.push(`  fehlt im Wiki-Stand: ${titel}`);
    zeilen.push(
        bericht.auftrag.eingereiht
            ? `auftrag    Treffer neu rechnen eingereiht: ja (${bericht.auftrag.jobId ?? "?"})${bericht.dryRun ? ", mit dem Lauf verworfen" : ""}`
            : "auftrag    Treffer neu rechnen eingereiht: nein (keine Fläche geändert)",
    );
    return zeilen;
}

const database = createDatabase(config.databaseUrl);
const started = Date.now();

try {
    if (freigabe.zeile !== null) console.warn(freigabe.zeile);
    if (dryRun) {
        console.warn(
            !freigabe.apply
                ? "PROBELAUF - ohne --operator-said wird nichts geschrieben, auch kein Journal und kein Auftrag\n"
                : "PROBELAUF (--dry-run) - nichts geschrieben, auch kein Journal und kein Auftrag\n",
        );
    }
    const bericht = await importSprachen(database, quelle, { mapDomainId, dryRun });
    if (values.json) {
        console.log(JSON.stringify(bericht, null, 2));
    } else {
        for (const zeile of textBericht(bericht)) console.log(zeile);
        for (const zeile of formatFindings(bericht.findings, 20)) console.log(zeile);
        const sekunden = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`laufzeit   ${sekunden} s`);
        console.log(bericht.changed ? "geändert   ja" : "geändert   nein (nichts zu schreiben)");
    }
} catch (error) {
    if (error instanceof MigrationAborted) {
        console.error(`abgebrochen: ${error.message}`);
        console.error(JSON.stringify(error.detail, null, 2));
        await database.end({ timeout: 5 });
        process.exit(2);
    }
    throw error;
} finally {
    await database.end({ timeout: 5 });
}
