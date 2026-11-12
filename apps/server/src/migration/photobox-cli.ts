import { isAbsolute } from "node:path";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { MediaStore } from "../media/storage.ts";
import { ProduktionVerweigert, legeBeispieleAn, umgebungAusEnv } from "../photobox/beispiele.ts";
import { reiheKachelnEin } from "../photobox/kacheln.ts";

/**
 * Die Werkzeuge der Reisebilder (WI-0272 S4, Aufgabe 24): zwei Befehle, ein Prozess wie `migrate:media-files` (mit der Rolle der Anwendung, sharp im Kommando, nie im Fastify-Prozess).
 *
 *   npm run photobox:beispiele   legt die acht persistenten Beispielbilder an (Stage, Release-Test, lokal); wiederholbar.
 *                                🔴 Verweigert mit Exit 2 bei AVESMAPS_ENV=production und bei einer Datenbank, deren Name „production“ enthält.
 *                                Braucht MEDIA_ROOT (absolut) und DATABASE_URL. Ohne Freigaberegel der Rolle photobox bleiben die Bilder unveröffentlicht
 *                                (Exit 0, die Zeile nennt `npm run media:regeln` als Grund).
 *   npm run photobox:kacheln     reiht den Abgleich für jedes aktive Reisebild ein, dem die Kachel fehlt (in jeder Umgebung erlaubt, wiederholbar);
 *                                gerechnet wird im Worker.
 */
const befehl = process.argv[2];
if (befehl !== "beispiele" && befehl !== "kacheln") {
    console.error("photobox-cli: Befehl fehlt oder ist unbekannt (beispiele | kacheln)");
    process.exit(2);
}

// Die Sperre vor allem anderen: Bei AVESMAPS_ENV=production wird nichts gelesen, nichts geöffnet, nichts verbunden.
if (befehl === "beispiele" && process.env["AVESMAPS_ENV"]?.trim().toLowerCase() === "production") {
    console.error(
        "photobox:beispiele läuft nie in Production (AVESMAPS_ENV ist production). Beispielbilder gibt es dort nicht.",
    );
    process.exit(2);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const database = createDatabase(config.databaseUrl, { max: 3 });
try {
    if (befehl === "kacheln") {
        const ergebnis = await reiheKachelnEin(database);
        console.log(
            `kacheln    ${String(ergebnis.eingereiht)} Abgleiche eingereiht, ${String(ergebnis.wartend)} Reisebilder hatten schon einen wartenden Abgleich`,
        );
    } else {
        const mediaRoot = process.env["MEDIA_ROOT"];
        if (mediaRoot === undefined || mediaRoot === "" || !isAbsolute(mediaRoot)) {
            console.error("MEDIA_ROOT fehlt oder ist nicht absolut");
            process.exit(1);
        }
        const ergebnis = await legeBeispieleAn(database, new MediaStore(mediaRoot), umgebungAusEnv());
        console.log(`beispiele  ${String(ergebnis.angelegt)} angelegt, ${String(ergebnis.vorhanden)} schon vorhanden`);
        if (ergebnis.ohneOrt.length > 0) {
            console.log(
                `ohne Ort   ${ergebnis.ohneOrt.join(", ")}: Diesen Ort gibt es auf dieser Karte nicht (aktiv, nicht verborgen); die Bilder dazu entstehen nicht.`,
            );
        }
        if (ergebnis.unveroeffentlicht.length > 0) {
            console.log(
                `nicht öffentlich  ${ergebnis.unveroeffentlicht.join(", ")}: Meist fehlt die Freigaberegel der Rolle photobox. Sie legt\n` +
                    `  npm run media:regeln -- --operator-said "<Zitat des Betreibers>"\n` +
                    `an; danach dieses Kommando noch einmal.`,
            );
        }
    }
} catch (fehler) {
    if (fehler instanceof ProduktionVerweigert) {
        console.error(fehler.message);
        process.exitCode = 2;
    } else {
        throw fehler;
    }
} finally {
    await database.end({ timeout: 5 });
}
