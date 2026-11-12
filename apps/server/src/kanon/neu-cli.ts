import { parseArgs } from "node:util";
import { KANON_OBJEKTARTEN, istKanonObjektart, type KanonObjektart } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { berechneKanonNeu } from "./neu-berechnen.ts";

/**
 * „Kanon neu berechnen“ für die Umgebung dieser Datenbank (WI-0253 B-2): Rang 1 bis 3 der Kanon-Regel, nach der Namensraum-Tafel der Umgebung.
 *
 * 🔴 Das Werkzeug rechnet und zählt; GESCHRIEBEN wird nur mit dem Zuruf des Betreibers (`--operator-said`, Map Mutation Guard), je Umgebung und
 * Lauf gesondert. Seit OPS-000066 (Vali 2026-10-30: „OPS-066 A aber mit production und stage oder?“) auch auf Stage und Production, dort fährt es
 * Claudio. Es gibt keinen Weg über die Verwaltung. Der Legacy-Zug (Schritt I18) rechnet danach nach derselben Regel (`migration/sources-import.ts`).
 *
 * Beispiele:
 *   npm run kanon:neu                                   (rechnet und zählt)
 *   npm run kanon:neu -- --regelstand legacy            (Legacys Regelstand bis 2026-10-25, der Maßstab des Orakels)
 *   npm run kanon:neu -- --arten place,path --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        "operator-said": { type: "string" },
        regelstand: { type: "string", default: "avesmaps" },
        arten: { type: "string" },
    },
});

if (values.regelstand !== "avesmaps" && values.regelstand !== "legacy") {
    console.error("--regelstand ist avesmaps oder legacy");
    process.exit(2);
}
const arten = values.arten === undefined ? undefined : values.arten.split(",").map((art) => art.trim());
if (arten !== undefined && !arten.every((art) => istKanonObjektart(art))) {
    console.error(`--arten nennt Arten aus ${KANON_OBJEKTARTEN.join(", ")}`);
    process.exit(2);
}
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const schreiben = values["operator-said"] !== undefined;
    if (schreiben) console.log(`Freigabe (Betreiberzitat): „${values["operator-said"]}“`);
    else console.log("PROBELAUF - ohne --operator-said wird nichts geschrieben");
    const bericht = await berechneKanonNeu(database, {
        schreiben,
        regelstand: values.regelstand,
        ...(arten === undefined ? {} : { arten: arten as KanonObjektart[] }),
    });
    console.log(
        `regelstand ${bericht.regelstand}, Tafel-Revision ${String(bericht.tafelRevision)}${bericht.runId === null ? "" : `, run ${bericht.runId}`}`,
    );
    console.log("art        träger  mit Etikett  neu  geändert  herkunft  entfernt  unverändert");
    for (const [art, zahlen] of Object.entries(bericht.jeArt)) {
        if (zahlen.traeger === 0) continue;
        console.log(
            `${art.padEnd(10)} ${String(zahlen.traeger).padStart(6)} ${String(zahlen.mitEtikett).padStart(12)} ${String(zahlen.neu).padStart(4)} ${String(zahlen.geaendert).padStart(9)} ${String(zahlen.herkunftNeu).padStart(9)} ${String(zahlen.entfernt).padStart(9)} ${String(zahlen.unveraendert).padStart(12)}`,
        );
    }
} finally {
    await database.end({ timeout: 5 });
}
