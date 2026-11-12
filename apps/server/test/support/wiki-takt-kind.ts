import { erzeugeTaktOrt } from "../../src/wiki/transport/ort.ts";
import { erzeugeTakt } from "../../src/wiki/transport/takt.ts";

/**
 * Ein eigener Prozess für die Tests des Takts (WI-0253 B-1): nimmt `anzahl` Plätze im Takt des Ordners und gibt sie als JSON aus. Mehrere
 * davon zugleich beweisen, dass der Abstand über Prozessgrenzen gilt. Aufruf: `node wiki-takt-kind.ts <ordner> <abstandMs> <anzahl>`.
 */
const [ordner, abstand, anzahl] = process.argv.slice(2);
const takt = erzeugeTakt(erzeugeTaktOrt({ verzeichnis: ordner }), { abstandMs: Number(abstand), jitterMaxMs: 0 });
const plaetze: { platzMs: number; aufgewachtMs: number }[] = [];
for (let nummer = 0; nummer < Number(anzahl); nummer += 1) {
    const platz = await takt.nimm();
    plaetze.push({ platzMs: platz.platzMs, aufgewachtMs: Date.now() });
}
process.stdout.write(JSON.stringify(plaetze));
