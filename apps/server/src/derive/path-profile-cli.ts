import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { DEFAULT_CONE } from "../terrain/peak-cone.ts";
import { derivePathProfiles } from "../terrain/path-profiles.ts";
import { loadPublishedDomainSource } from "../terrain/domain/read.ts";

/**
 * Die Steigungsprofile der Wege gegen den geltenden Höhenmaster ableiten (`derive:path-profiles`, WI-0141; Claudio
 * 2026-10-13, `handovers/2026-10-13-landschaften-knopf-sperren-an-claudia.md` §2 Nr. 3).
 *
 * **Warum es diese Kommandozeile gibt:** Ein Zug der Kategorie „Wege“ schreibt `path` neu (I5) und leitet Kurve und Namen
 * ab (I6, I7), rührt aber die Geländekette nicht an — `terrain_path_profile` entsteht sonst in I11, und der gehört zu
 * „Landschaften“. Ohne diesen Aufruf bliebe jede Route über einen geänderten Weg bis zur nächsten Geländerechnung
 * steigungslos. Auf der Stage nimmt diese Arbeit die Jobart `path_profile` (WI-0128 E13), die aus der Schreibnaht des
 * Editors kommt; in Production läuft kein Worker, also braucht Claudios Läufer sie als Befehl.
 *
 * 🔴 **Dieselbe Rechnung wie I11, nicht eine zweite.** Der Kern ist `derivePathProfiles` — exakt die Funktion, die
 * `derive:terrain` und die Jobart aufrufen. Sie rechnet nur die Wege, deren Geometrie oder Höhenstand sich geändert hat
 * (`geometry_md5`, Migration 0049); alle anderen bleiben unberührt. Es gibt deshalb keine Liste von Wegen und keinen
 * Schalter dafür: Was der Zug bewegt hat, ist genau das, was nicht mehr passt.
 *
 * Ohne geltenden Master (eine frische Installation ohne Gelände) gibt es keine Profile. Dann meldet der Lauf `kein_master`
 * und endet mit **Exit 0**: Das ist kein Fehler des Zugs, sondern eine Umgebung ohne Höhenmodell, und ein Läufer soll
 * daran nicht rot werden. Jede Zeile ist Klartext, wie bei den übrigen Ableitungen (`derive:path-visuals`).
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const source = await loadPublishedDomainSource(database, AVENTURIA.mapDomain);
    if (source === null) {
        console.log("kein_master     kein geltender Hoehenmaster in dieser Datenbank, keine Profile zu rechnen");
    } else {
        const report = await derivePathProfiles(
            database,
            AVENTURIA.mapDomain,
            { domain: source, rasters: [], peaks: [], rule: DEFAULT_CONE },
            AVENTURIA_TRAVEL_MODEL,
        );
        console.log(`Wege            ${String(report.paths)}`);
        console.log(`gerechnet       ${String(report.computed)}`);
        console.log(`unveraendert    ${String(report.unchanged)}`);
        console.log(`entfernt        ${String(report.removed)}`);
        console.log(`Master          ${source.fingerprint}`);
    }
} finally {
    await database.end({ timeout: 5 });
}
