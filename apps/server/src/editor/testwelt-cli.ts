import { parseArgs } from "node:util";
import { AVENTURIA } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { DeriveBusyError } from "../derive/derive-lock.ts";
import { testweltOffen, testweltZuruecksetzen } from "./testwelt.ts";

/**
 * Die Testwelt von der Kommandozeile (WI-0128 E14, EDIT-0001 N3):
 *
 *   npm run testwelt:offen                         Exit 0: nichts bearbeitet seit dem letzten Zurücksetzen; 10: es gibt Operationen
 *   npm run testwelt:zuruecksetzen                 Probelauf: rechnet und rollt zurück
 *   npm run testwelt:zuruecksetzen -- --schreiben  setzt zurück (vor dem Import des Zugs); nur wo \`MAP_EDITING=testwelt\` gilt
 *
 * 🔴 Kartendaten: Der Schritt legt neue Orte still und leert das Protokoll der Testwelt. Er läuft im täglichen Zug (D4: die Testwelt
 * setzt der Zug zurück), nie in Production; ohne \`MAP_EDITING=testwelt\` verweigert er das Schreiben. 🔴 Seit Production selbst
 * \`testwelt\` darf (Betreiber 2026-10-15, \`config.ts\`), prüft er Production ausdrücklich: Dort legte er die Arbeit der Editoren an
 * echten Orten still, und das ist kein Zurücksetzen einer Testwelt. Agenten fahren ihn nie gegen eine geteilte Datenbank (W15).
 * Andere Fehler enden mit 1, eine belegte Sperre der Domäne (Import läuft) mit 75.
 */
const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { schreiben: { type: "boolean", default: false }, domain: { type: "string" } },
});
const befehl = positionals[0];
if (befehl !== "offen" && befehl !== "zuruecksetzen") {
    console.error("usage: testwelt offen | zuruecksetzen [--schreiben] [--domain <id>]");
    process.exit(2);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const domain = values.domain ?? AVENTURIA.mapDomain;
const database = createDatabase(config.databaseUrl, { max: 2 });
let code = 0;
try {
    if (befehl === "offen") {
        const stand = await testweltOffen(database, domain);
        console.log(
            JSON.stringify({
                offen: stand.offen,
                seit: stand.seit?.toISOString() ?? null,
                zuletzt: stand.zuletzt?.toISOString() ?? null,
            }),
        );
        code = stand.offen > 0 ? 10 : 0;
    } else {
        if (values.schreiben && config.mapEditing !== "testwelt") {
            console.error("Zurücksetzen schreibt nur, wo MAP_EDITING=testwelt gilt (nie in Production).");
            code = 1;
        } else if (values.schreiben && process.env["AVESMAPS_ENV"] === "production") {
            console.error("Zurücksetzen schreibt nie in Production, auch nicht mit MAP_EDITING=testwelt.");
            code = 1;
        } else {
            const bericht = await testweltZuruecksetzen(database, {
                mapDomainId: domain,
                environment: config.auth?.environment ?? "development",
                schreiben: values.schreiben,
            });
            console.log(JSON.stringify(bericht));
        }
    }
} catch (error) {
    if (error instanceof DeriveBusyError) {
        console.error(`Die Domäne ist belegt (ein Import oder eine Ableitung läuft): ${error.message}`);
        code = 75;
    } else {
        console.error(error instanceof Error ? error.message : error);
        code = 1;
    }
} finally {
    await database.end({ timeout: 5 });
}
process.exit(code);
