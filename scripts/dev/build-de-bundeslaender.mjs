// Erzeugt apps/web/src/besuch/de-bundeslaender.ts aus Natural Earth (WI-0138 V8, Betreiber 2026-10-13: „lizenzklare
// Geometrie beschaffen“, „die karte mit möglichst wenigen vertices“).
//
// Quelle: ne_10m_admin_1_states_provinces.geojson aus github.com/nvkelso/natural-earth-vector — Public Domain, nach
// Angabe des Projekts ausdrücklich ohne Bedingungen: keine Namensnennung, kein Share-Alike. Darum ersetzt sie Legacys
// Umrisse, deren Herkunft nie belegt war.
//
// Aufruf: node scripts/dev/build-de-bundeslaender.mjs <geojson> [<toleranzGrad>]
//   <geojson>       die heruntergeladene Datei (liegt nicht im Repository: 40 MB für sechzehn Umrisse)
//   <toleranzGrad>  Douglas-Peucker in Grad, Vorgabe 0.012 (rund 1 km) — das ist der Regler für „wenige Vertices“
import { readFileSync, writeFileSync } from "node:fs";

const quelle = process.argv[2];
const toleranz = Number(process.argv[3] ?? 0.012);
if (!quelle) {
    console.error("Aufruf: node scripts/dev/build-de-bundeslaender.mjs <geojson> [<toleranzGrad>]");
    process.exit(2);
}

const ziel = new URL("../../apps/web/src/besuch/de-bundeslaender.ts", import.meta.url);
const HOEHE = 380;
const RAND = 4;

/** Nur das, was eine Statistikkarte braucht: Umriss und Name, in der Reihenfolge der amtlichen Kennung. */
const laender = JSON.parse(readFileSync(quelle, "utf8"))
    .features.filter((f) => f.properties.iso_a2 === "DE")
    .map((f) => ({
        code: String(f.properties.iso_3166_2).replace(/^DE-/, ""),
        name: String(f.properties.name_de || f.properties.name),
        ringe: (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map(
            (poly) => poly[0],
        ),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

if (laender.length !== 16) {
    console.error(`Erwartet sind 16 Bundesländer, gefunden ${laender.length}`);
    process.exit(1);
}

/**
 * Douglas-Peucker: wirft Punkte weg, die kaum von der Verbindung ihrer Nachbarn abweichen.
 *
 * 🪤 Gerechnet wird auf Längen- und Breitengraden, nicht auf der Leinwand: Ein fester Abstand in Grad ist auf allen
 * Ländern derselbe, ein fester Abstand in Pixeln hinge an der Größe des Landes — kleine Länder verlören ihre Form.
 */
function vereinfache(punkte, toleranz) {
    if (punkte.length < 3) return punkte;
    const [start] = punkte;
    const ende = punkte.at(-1);
    let weiteste = 0;
    let abstand = 0;
    for (let i = 1; i < punkte.length - 1; i += 1) {
        const d = lot(punkte[i], start, ende);
        if (d > abstand) {
            abstand = d;
            weiteste = i;
        }
    }
    if (abstand <= toleranz) return [start, ende];
    return [
        ...vereinfache(punkte.slice(0, weiteste + 1), toleranz).slice(0, -1),
        ...vereinfache(punkte.slice(weiteste), toleranz),
    ];
}

/** Der Abstand eines Punktes von der Strecke zwischen zwei anderen. */
function lot([x, y], [x1, y1], [x2, y2]) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const laenge = dx * dx + dy * dy;
    if (laenge === 0) return Math.hypot(x - x1, y - y1);
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / laenge));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

// Deutschland liegt um 51° Nord; dort ist ein Längengrad nur noch 0,63 Breitengrade breit. Ohne diese Stauchung stünde
// das Land zu breit da (die einfachste Projektion, die für eine Statistikkarte reicht).
const MITTE = 51;
const streckung = Math.cos((MITTE * Math.PI) / 180);
const alle = laender.flatMap((land) => land.ringe.flat());
const grenzen = {
    x0: Math.min(...alle.map(([x]) => x)),
    x1: Math.max(...alle.map(([x]) => x)),
    y0: Math.min(...alle.map(([, y]) => y)),
    y1: Math.max(...alle.map(([, y]) => y)),
};
// Die Höhe gibt den Maßstab, die Breite folgt dem Land: So steht kein leerer Rand neben der Karte.
const skala = (HOEHE - 2 * RAND) / (grenzen.y1 - grenzen.y0);
const BREITE = Math.round((grenzen.x1 - grenzen.x0) * streckung * skala) + 2 * RAND;
const versatzX = RAND;
const versatzY = RAND;

const auf = ([x, y]) => [
    +(versatzX + (x - grenzen.x0) * streckung * skala).toFixed(1),
    // Der Bildschirm zählt nach unten, die Erde nach oben.
    +(versatzY + (grenzen.y1 - y) * skala).toFixed(1),
];

let punkte = 0;
const zeilen = laender.map((land) => {
    const d = land.ringe
        .map((ring) => vereinfache(ring, toleranz).map(auf))
        .filter((ring) => ring.length >= 3)
        .map((ring) => {
            punkte += ring.length;
            return `M${ring.map(([x, y]) => `${x},${y}`).join("L")}Z`;
        })
        .join("");
    return `    { code: "${land.code}", name: "${land.name}", d: "${d}" },`;
});

const kopf = `/**
 * Die Umrisse der sechzehn Bundesländer für die Herkunftskarte der Besucherstatistik (WI-0138 V8).
 *
 * Quelle: **Natural Earth** (1:10m admin-1), Public Domain — das Projekt stellt seine Daten ausdrücklich ohne
 * Bedingungen bereit, also ohne Namensnennung und ohne Share-Alike. Damit ist die Karte auslieferbar; Legacys Umrisse,
 * deren Herkunft nie belegt war, sind abgelöst (Betreiber 2026-10-13).
 *
 * \`code\` ist die Kennung nach ISO 3166-2 ohne das Länderpräfix (NW, BY, …) — die Karte färbt danach, nicht nach dem
 * Namen: Der Geodatensatz schreibt „Bavaria“ oder „Bayern“, je nach Sprache seiner Quelle, die Kennung ist immer gleich.
 *
 * Erzeugt, nicht von Hand geschrieben: \`scripts/dev/build-de-bundeslaender.mjs\` (Toleranz ${toleranz}°, ${punkte} Punkte).
 */
export interface Bundesland {
    /** ISO 3166-2 ohne „DE-“: NW, BY, BE … */
    readonly code: string;
    readonly name: string;
    readonly d: string;
}

export const DE_VIEWBOX = "0 0 ${BREITE} ${HOEHE}";

export const DE_BUNDESLAENDER: readonly Bundesland[] = [
`;

writeFileSync(ziel, `${kopf}${zeilen.join("\n")}\n];\n`, "utf8");
console.log(`${laender.length} Bundesländer, ${punkte} Punkte, Toleranz ${toleranz}° → ${ziel.pathname}`);
