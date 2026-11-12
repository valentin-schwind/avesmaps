import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
    AVENTURIA,
    AVENTURIA_TRAVEL_MODEL,
    catmullRomLine,
    FREE_SEA_EDGE_PREFIX,
    travelSpeed,
    type CurvePoint,
} from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { loadLand } from "./land.ts";
import { ENDPOINT_BOX, loadRouteNetwork, type RouteLink, type RouteNetwork, type RouteNode } from "./network.ts";
import { loadRivers } from "./rivers.ts";
import { buildRouteGraph, findRoute, type RouteGraph, type RouteRequest } from "./router.ts";
import { loadSeaRoutes } from "./sea-derive.ts";
import { FreeSea } from "./sea-free.ts";
import { readRoutingRevision, seaGraphIdentity, travelModelVersion } from "./revision.ts";
import { END_SNAP } from "./topology.ts";
import { loadWater } from "./water.ts";

/**
 * Die zwei offenen Auffälligkeiten aus dem Topologievergleich nachprüfen (WI-0147, Auftrag 2026-10-14):
 * Gareth → Kaiserhain mit Faktor 1,25 gegen Legacy, und die Kehrtwenden am Hafen Port Syrdalok.
 *
 * 🔴 **Das Werkzeug ändert nichts.** Es rechnet Routen im Prozess, legt die Abschnittsfolge offen und stellt
 * Legacys Folge daneben. Die Topologie bleibt, wie sie ist; der Vergleich der Varianten steht in
 * `topologie-vergleich-cli.ts`.
 *
 * Aufruf (aus `apps/server`):
 *   node --env-file-if-exists=../../.env src/routing/routen-reste-cli.ts \
 *       --route "Gareth|Kaiserhain" [--fang 0.02] [--see frei|aus] [--legacy]
 *
 * 🪤 Es gibt auch `npm run compare:routen-reste --workspace @avesmaps3d/server -- …`, aber der senkrechte Strich in
 * `--route` geht auf Windows durch `cmd.exe`: Dort gehört das Argument in Anführungszeichen, und sicherer ist der
 * direkte Aufruf mit `node` oben.
 *
 * - `--fang`: ein anderer Fangradius zwischen Wegenden als `END_SNAP`. Damit wird messbar, WIE breit die Lücke ist,
 *   an der eine Wegkette reißt.
 * - `--see`: `frei` (Vorgabe) über den abgeleiteten Seegraphen, wie der Planer der Karte; `aus` ohne Seegraph, dann gibt es
 *   keine Seereise. Gezeichnete Seewege fährt der Router seit WI-0153 Schnitt 7e nicht mehr (Betreiber 2026-10-17).
 * - `--knoten`: die Wegenden an diesem Ort auflisten - welche Wege ihn berühren, wo sie hängen und wie weit vom Ort.
 * - `--kasten` (mit `--weg`): alle Abschnitte in einem Fenster samt Knotengrad; Grad 1 ist ein Kettenende.
 * - `--sackgassen`: die Sackgassen einer Wegart, nach dem Abstand zum nächsten Knoten gruppiert.
 * - `--legacy`: dieselben Routen mit Legacys eigenem Router gegen den Snapshot rechnen (Orakel).
 *
 * 🪤 Die Sperrzeiten stehen in jeder Ausgabe (`seasonalWays`), auch wenn keine im Spiel ist: Betreiberregel vom
 * 2026-10-14 („sie soll das immer überprüfen, ja, auf jeden fall“).
 */

const { values } = parseArgs({
    options: {
        route: { type: "string", multiple: true, default: [] as string[] },
        /**
         * Viele Routen aus einer Datei, eine Zeile „Von|Nach“ je Route. 🪤 Der Weg für Ortsnamen mit Anführungszeichen
         * oder Apostroph (`Gasthaus "Zum Goldenen Horn"`, `Burg Baran'Schek`): Über die Kommandozeile zerlegt die Shell
         * sie, über `npm run` verliert Windows alles ab der ersten Zeilenschaltung.
         */
        "routen-datei": { type: "string" },
        knoten: { type: "string", multiple: true, default: [] as string[] },
        /** Alle Abschnitte in diesem Fenster zeigen: "x1,y1,x2,y2", mit `--weg` auf einen Wegnamen begrenzt. */
        kasten: { type: "string" },
        weg: { type: "string" },
        /** Den Fangradius frei setzen (`END_SNAP` ohne Angabe). Nur zum Messen, wo eine Lücke die Kette reißt. */
        fang: { type: "string" },
        /** Zählt die Sackgassen einer Wegart und wie weit ihr nächster Knoten entfernt liegt (z. B. `Seeweg`). */
        sackgassen: { type: "string" },
        /**
         * Welche Knotenpaare ein größerer Fangradius verbindet: `--fangpaare 0.02` nennt die Paare, die bei `--fang`
         * (sonst `END_SNAP`) getrennt sind und bei 0,02 verschmelzen, und ob eine Legacy-Kreuzung dort stand.
         */
        fangpaare: { type: "string" },
        /** Der Legacy-Snapshot mit den Kreuzungsobjekten, für `--fangpaare`. */
        snapshot: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/2026-09-28/map-features.json" },
        see: { type: "string", default: "frei" },
        legacy: { type: "boolean", default: false },
        out: { type: "string", default: "../../review/routen-reste" },
        /** Die Linie der Abschnitte mit ausgeben; sonst nur Anfang und Ende je Abschnitt. */
        linie: { type: "boolean", default: false },
        /**
         * Je Naht zwischen zwei Abschnitten die Lücke zwischen den Linien, die Punkte beidseits auf sechs Stellen und
         * den Richtungswechsel: So wird sichtbar, ob eine Kehrtwende aus der Wegwahl kommt oder aus dem Schritt, mit
         * dem die Linie an den Knoten gezogen wird (`toNodes`, WI-0147).
         */
        naehte: { type: "boolean", default: false },
        /**
         * Wie weit die GEZEICHNETE Kurve über die gelieferte Linie ausschlägt, wenn die Linie an einen Ortsknoten
         * gezogen wird — je Lücke und je Fassung (davorsetzen, ersetzen, gerader Stummel). Beantwortet, ob der
         * Ausschlag nur bei winzigen Lücken auftritt oder bei allen.
         */
        ausschlag: { type: "boolean", default: false },
    },
});

/** Ab diesem Richtungswechsel in der Linie heißt es Kehrtwende - Claudios Maß aus Production. */
const KEHRE_GRAD = 154;
/** Wie nah eine Kehrtwende an einem Ort liegen muss, damit sie ihm zugeschrieben wird. */
const KEHRE_AM_ORT = 0.6;
const MILES = AVENTURIA_TRAVEL_MODEL.meilenJeKarteneinheit.wert;

const REQUEST: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

const zahl = (value: number, stellen = 2): string => value.toFixed(stellen);

function wendeGrad(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): number {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu === 0 || lv === 0) return 0;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
    return (Math.acos(cos) * 180) / Math.PI;
}

/** Die Kehrtwenden einer Linie an Orten, die kein Wegpunkt sind - dieselbe Rechnung wie im Topologievergleich. */
function kehren(
    line: readonly [number, number][],
    orte: readonly { name: string; x: number; y: number }[],
    wegpunkte: ReadonlySet<string>,
): { x: number; y: number; grad: number; ort: string; index: number }[] {
    const gefunden: { x: number; y: number; grad: number; ort: string; index: number }[] = [];
    const dicht = (a: readonly [number, number], b: readonly [number, number]): boolean =>
        Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001;
    let vorher: [number, number] | undefined;
    for (let index = 1; index < line.length - 1; index += 1) {
        const mitte = line[index] as [number, number];
        const davor = vorher ?? (line[index - 1] as [number, number]);
        const danach = line[index + 1] as [number, number];
        if (dicht(davor, mitte) || dicht(mitte, danach)) continue;
        vorher = mitte;
        const grad = wendeGrad(davor, mitte, danach);
        if (grad < KEHRE_GRAD) continue;
        let ort = "";
        let nah = KEHRE_AM_ORT;
        for (const kandidat of orte) {
            const abstand = Math.hypot(kandidat.x - mitte[0], kandidat.y - mitte[1]);
            if (abstand < nah) {
                nah = abstand;
                ort = kandidat.name;
            }
        }
        if (ort === "" || wegpunkte.has(ort)) continue;
        gefunden.push({ x: mitte[0], y: mitte[1], grad, ort, index });
    }
    return gefunden;
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const database = createDatabase(config.databaseUrl);
const domain = AVENTURIA.mapDomain;
const model = AVENTURIA_TRAVEL_MODEL;
const water = await loadWater(database, domain);
const terrain = {
    land: await loadLand(database, domain),
    rivers: await loadRivers(database, domain, model),
};
const endSnap = values.fang === undefined ? END_SNAP : Number(values.fang);
const network = await loadRouteNetwork(database, domain, { endSnap });
const weiter =
    values.fangpaare === undefined
        ? null
        : await loadRouteNetwork(database, domain, { endSnap: Number(values.fangpaare) });
const stored = values.see === "frei" ? await loadSeaRoutes(database, domain, { current: true }) : null;
// 💣 Der Dienst nimmt den Seegraphen nur, wenn er zum Datenstand gehört (`matchingSeaGraph`). Ohne diese Probe
// könnte hier ein veralteter Graph fahren, den die Karte längst nicht mehr benutzt - die Antwort wäre wertlos.
const revision = values.see === "frei" ? await readRoutingRevision(database, domain, travelModelVersion(model)) : null;
await database.end({ timeout: 5 });

if (values.see === "frei") {
    if (!stored)
        console.log("🪤 Kein abgeleiteter Seegraph in der Datenbank - die freie Seefahrt ist nicht zu prüfen.");
    else {
        const identitaet = seaGraphIdentity(stored.algorithm, stored.fingerprint);
        const passt = identitaet === revision?.seaGraph;
        console.log(
            `Seegraph: ${stored.algorithm}, Quelle ${stored.fingerprint}, abgeleitet ${String(stored.derivedAt)}\n` +
                (passt
                    ? "Seegraph passt zum Datenstand - genau diesen nimmt auch der Dienst."
                    : `🪤 Seegraph passt NICHT zum Datenstand (Revision erwartet ${String(revision?.seaGraph)}): Der Dienst würde ihn ablehnen, die Zahlen unten gelten nur für diesen Graphen.`),
        );
    }
}
const freeSea = stored ? new FreeSea(stored.graph) : null;
const graph: RouteGraph = buildRouteGraph(network, model, REQUEST, water, freeSea);
console.log(
    `Fang ${zahl(endSnap, 5)}, See ${values.see}${freeSea ? (graph.sea ? " (Seegraph aktiv)" : " (Seegraph kennt das Schiff nicht)") : ""}: ` +
        `${String(network.nodes.size)} Knoten, ${String(network.links.length)} Abschnitte`,
);

const orte = [...network.nodes.values()]
    .filter((node) => node.kind === "place")
    .map((node) => ({ name: node.name, x: node.x, y: node.y }));
const idVonName = new Map<string, string>();
for (const node of network.nodes.values()) {
    if (node.kind === "place" && !idVonName.has(node.name)) idVonName.set(node.name, node.id);
}
const nameVon = (id: string): string => network.nodes.get(id)?.name ?? id;

/** Die Wegenden an einem Ort: welche Wege ihn berühren, wohin sie zeigen und wie weit sie reichen. */
function knotenZeigen(ortName: string): void {
    const id = idVonName.get(ortName);
    if (id === undefined) {
        console.log(`\n## ${ortName}: nicht im Netz`);
        return;
    }
    const node = network.nodes.get(id);
    if (!node) return;
    console.log(`\n## ${ortName} (${zahl(node.x, 3)} | ${zahl(node.y, 3)}), Knoten ${id}`);
    const am: RouteLink[] = network.links.filter((link) => link.from === id || link.to === id);
    for (const link of am.sort((a, b) => a.id.localeCompare(b.id))) {
        const line = link.from === id ? link.coordinates : [...link.coordinates].reverse();
        const ab = line[0] as [number, number];
        const nach = line[1] as [number, number] | undefined;
        const ziel = line[line.length - 1] as [number, number];
        const andere = link.from === id ? link.to : link.from;
        const richtung = nach ? zahl((Math.atan2(nach[1] - ab[1], nach[0] - ab[0]) * 180) / Math.PI, 1) : "-";
        const erlaubt = link.allowedTransports ? link.allowedTransports.join("/") : "alle";
        console.log(
            `  ${link.id.padEnd(16)} ${link.pathName.padEnd(16)} ${link.subtype.padEnd(10)} ` +
                `len=${zahl(link.distance, 3).padStart(8)} nach ${(nameVon(andere) || andere).padEnd(22)} ` +
                `hängt bei [${zahl(ab[0], 3)},${zahl(ab[1], 3)}] (${zahl(Math.hypot(ab[0] - node.x, ab[1] - node.y), 3)} E vom Ort) ` +
                `Abgangswinkel ${richtung.padStart(7)}° Ende [${zahl(ziel[0], 2)},${zahl(ziel[1], 2)}] ` +
                `pts=${String(link.coordinates.length)} ${erlaubt}` +
                (link.seasons ? ` SPERRZEIT ${JSON.stringify(link.seasons)}` : ""),
        );
    }
    if (graph.sea) {
        const speed = travelSpeed(model, REQUEST.transports.sea, "Seeweg");
        console.log(
            `  freie Seefahrt: Schiff ${REQUEST.transports.sea}, Tempo ${speed === null ? "-" : zahl(speed, 3)}`,
        );
    }
}

for (const ort of values.knoten) knotenZeigen(ort);

/**
 * Alle Abschnitte in einem Fenster, mit dem Grad ihrer Knoten: Ein Knoten mit Grad 1 ist das Ende der Kette. So wird
 * sichtbar, WO eine Wegkette reißt, und wie weit das nächste Wegende entfernt liegt (`--kasten`, `--weg`).
 */
function kastenZeigen(fenster: string): void {
    const teile = fenster.split(",").map((wert) => Number(wert.trim()));
    const [x1, y1, x2, y2] = teile as [number, number, number, number];
    if (teile.length !== 4 || teile.some((wert) => Number.isNaN(wert)))
        throw new Error('--kasten braucht "x1,y1,x2,y2"');
    const grad = new Map<string, number>();
    for (const link of network.links) {
        grad.set(link.from, (grad.get(link.from) ?? 0) + 1);
        grad.set(link.to, (grad.get(link.to) ?? 0) + 1);
    }
    const im = (punkt: readonly [number, number]): boolean =>
        punkt[0] >= Math.min(x1, x2) &&
        punkt[0] <= Math.max(x1, x2) &&
        punkt[1] >= Math.min(y1, y2) &&
        punkt[1] <= Math.max(y1, y2);
    const drin = network.links.filter((link) => {
        if (values.weg !== undefined && link.pathName !== values.weg) return false;
        return link.coordinates.some(im);
    });
    console.log(
        `\n## Fenster ${fenster}${values.weg === undefined ? "" : `, Weg „${values.weg}“`}: ${String(drin.length)} Abschnitte`,
    );
    const knotenOrt = (id: string): string => {
        const node = network.nodes.get(id);
        if (!node) return id;
        return `${node.name || "·"}[${zahl(node.x, 3)}|${zahl(node.y, 3)}]${node.kind === "place" ? "" : "~"}`;
    };
    for (const link of drin.sort(
        (a, b) => (a.coordinates[0] as [number, number])[1] - (b.coordinates[0] as [number, number])[1],
    )) {
        const anfang = link.coordinates[0] as [number, number];
        const ende = link.coordinates[link.coordinates.length - 1] as [number, number];
        console.log(
            `  ${link.pathPublicId.slice(0, 8)} ${link.pathName.padEnd(18)} ${link.subtype.padEnd(10)} len=${zahl(link.distance, 3).padStart(7)} ` +
                `[${zahl(anfang[0])},${zahl(anfang[1])}]→[${zahl(ende[0])},${zahl(ende[1])}] ` +
                `${knotenOrt(link.from).padEnd(34)} (Grad ${String(grad.get(link.from) ?? 0)}) → ${knotenOrt(link.to).padEnd(34)} (Grad ${String(grad.get(link.to) ?? 0)})` +
                (link.seasons ? ` SPERRZEIT ${JSON.stringify(link.seasons)}` : " Sperrzeit: keine"),
        );
    }
    // Die Kettenenden im Fenster: Grad 1, und wie weit der nächste Knoten überhaupt entfernt liegt.
    const enden = [...network.nodes.values()].filter((node) => im([node.x, node.y]) && (grad.get(node.id) ?? 0) === 1);
    if (enden.length === 0) return;
    console.log(`\n  Kettenenden im Fenster (Grad 1): ${String(enden.length)}`);
    for (const ende of enden) {
        let naechster = "";
        let abstand = Infinity;
        for (const kandidat of network.nodes.values()) {
            if (kandidat.id === ende.id) continue;
            const weit = Math.hypot(kandidat.x - ende.x, kandidat.y - ende.y);
            if (weit < abstand) {
                abstand = weit;
                naechster = knotenOrt(kandidat.id);
            }
        }
        const wege = network.links
            .filter((link) => link.from === ende.id || link.to === ende.id)
            .map((link) => `${link.pathName}`);
        console.log(
            `    ${knotenOrt(ende.id).padEnd(34)} ${wege.join(", ").padEnd(24)} nächster Knoten ${naechster} in ${zahl(abstand, 5)} E`,
        );
    }
}

if (values.kasten !== undefined) kastenZeigen(values.kasten);

/**
 * Die Sackgassen einer Wegart: Knoten mit Grad 1, an denen nur Wege dieser Art hängen, nach dem Abstand zum nächsten
 * Knoten gruppiert. Dort reißt die Kette, und der Abstand sagt, ob ein Fangradius sie je schließen könnte.
 */
function sackgassenZeigen(subtype: string): void {
    const grad = new Map<string, number>();
    for (const link of network.links) {
        grad.set(link.from, (grad.get(link.from) ?? 0) + 1);
        grad.set(link.to, (grad.get(link.to) ?? 0) + 1);
    }
    const anDerArt = new Map<string, string[]>();
    for (const link of network.links) {
        if (link.subtype !== subtype) continue;
        for (const id of [link.from, link.to]) {
            const liste = anDerArt.get(id);
            if (liste) liste.push(link.pathName);
            else anDerArt.set(id, [link.pathName]);
        }
    }
    const enden = [...anDerArt.keys()].filter((id) => (grad.get(id) ?? 0) === 1);
    const stufen = [0.001, 0.005, 0.01, 0.05, 0.1, 0.2, 0.5, 1, Infinity];
    const faecher = new Map<number, { anzahl: number; beispiele: string[] }>();
    for (const stufe of stufen) faecher.set(stufe, { anzahl: 0, beispiele: [] });
    for (const id of enden) {
        const node = network.nodes.get(id);
        if (!node) continue;
        let abstand = Infinity;
        for (const kandidat of network.nodes.values()) {
            if (kandidat.id === id) continue;
            const weit = Math.hypot(kandidat.x - node.x, kandidat.y - node.y);
            if (weit < abstand) abstand = weit;
        }
        // 🪤 Gerundet gebucht: 0,2 kommt als 0,20000000000000018 heraus und fiele sonst ins nächste Fach.
        const stufe = stufen.find((grenze) => Math.round(abstand * 1e6) / 1e6 <= grenze) as number;
        const fach = faecher.get(stufe) as { anzahl: number; beispiele: string[] };
        fach.anzahl += 1;
        if (fach.beispiele.length < 4) {
            fach.beispiele.push(
                `${(anDerArt.get(id) ?? []).join("/")} [${zahl(node.x, 3)}|${zahl(node.y, 3)}] ${zahl(abstand, 4)} E`,
            );
        }
    }
    console.log(
        `\n## Sackgassen der Wegart „${subtype}“: ${String(enden.length)} Knoten mit Grad 1 (Fang ${zahl(endSnap, 5)})`,
    );
    console.log("\n| nächster Knoten bis | Sackgassen | Beispiele |\n|---|---|---|");
    for (const stufe of stufen) {
        const fach = faecher.get(stufe) as { anzahl: number; beispiele: string[] };
        if (fach.anzahl === 0) continue;
        console.log(
            `| ${stufe === Infinity ? "weiter" : `${zahl(stufe, 3)} E`} | ${String(fach.anzahl)} | ${fach.beispiele.join(" · ")} |`,
        );
    }
}

if (values.sackgassen !== undefined) for (const art of values.sackgassen.split(",")) sackgassenZeigen(art.trim());

/** Ein Kreuzungsobjekt aus Legacys Snapshot: der Halter, den WI-0132 entfernt hat. */
interface Kreuzung {
    id: string;
    x: number;
    y: number;
}

/** Die Kreuzungsobjekte des Snapshots (`feature_type: "junction"`); sie sind Punkte. */
function kreuzungenLesen(datei: string): Kreuzung[] {
    const rohdaten = JSON.parse(readFileSync(datei, "utf8")) as {
        features?: {
            id?: string;
            geometry?: { type?: string; coordinates?: [number, number] };
            properties?: { feature_type?: string; public_id?: string };
        }[];
    };
    const gefunden: Kreuzung[] = [];
    for (const feature of rohdaten.features ?? []) {
        if (feature.properties?.feature_type !== "junction") continue;
        const punkt = feature.geometry?.coordinates;
        if (feature.geometry?.type !== "Point" || !punkt) continue;
        gefunden.push({ id: feature.properties.public_id ?? feature.id ?? "", x: punkt[0], y: punkt[1] });
    }
    return gefunden;
}

/**
 * Die Gegenseite der Fangradius-Frage (Auftrag der führenden Sitzung, 2026-10-14): **Welche Knotenpaare verbindet der
 * größere Radius, die der geltende trennt, und stand dort eine Legacy-Kreuzung?**
 *
 * - Ein Paar **auf** einer Kreuzung ist ein Rundungsfehler der Karte: Legacy hielt die Enden über das Objekt zusammen,
 *   WI-0132 hat es entfernt. Der größere Radius stellt nur her, was vorher da war.
 * - Ein Paar **ohne** Kreuzung, und auch ohne Ort, dessen Kasten ±0,5 beide Enden einsammelt, war bei Legacy **nicht**
 *   verbunden. Dort kann die Trennung gewollt sein (Brücke, Überführung), und der größere Radius erfindet eine
 *   Verbindung. Diese Paare stehen mit Namen und Lage in der Ausgabe.
 *
 * 🪤 Legacys Regel ist der Kasten ±0,5 je Achse, nicht der Abstand: Danach wird hier geurteilt, nicht nach Radius.
 */
function fangpaareZeigen(weitesNetz: RouteNetwork, weiterSnap: number): void {
    const schluessel = (node: { x: number; y: number }): string => `${node.x.toFixed(6)}:${node.y.toFixed(6)}`;
    const weite = new Set([...weitesNetz.nodes.values()].map(schluessel));
    // Verschwunden heißt: Dieser technische Knoten ist im weiten Netz mit einem anderen verschmolzen.
    const weg = [...network.nodes.values()].filter((node) => node.kind === "technical" && !weite.has(schluessel(node)));
    const technisch = [...network.nodes.values()].filter((node) => node.kind === "technical");
    console.log(
        `\n## Was ${zahl(weiterSnap, 5)} verbindet und ${zahl(endSnap, 5)} trennt: ` +
            `${String(network.nodes.size)} → ${String(weitesNetz.nodes.size)} Knoten, ${String(weg.length)} technische Knoten verschmolzen`,
    );
    const kreuzungen = kreuzungenLesen(values.snapshot);
    const orte = [...network.nodes.values()].filter((node) => node.kind === "place");
    /** Legacys Regel: Hält ein Objekt in seinem Kasten ±0,5 BEIDE Enden? */
    const haeltBeide = (
        a: { x: number; y: number },
        b: { x: number; y: number },
        c: { x: number; y: number },
    ): boolean =>
        Math.abs(c.x - a.x) <= ENDPOINT_BOX &&
        Math.abs(c.y - a.y) <= ENDPOINT_BOX &&
        Math.abs(c.x - b.x) <= ENDPOINT_BOX &&
        Math.abs(c.y - b.y) <= ENDPOINT_BOX;
    const gesehen = new Set<string>();
    const paare: {
        a: RouteNode;
        b: RouteNode;
        abstand: number;
        kreuzung: { id: string; abstand: number } | null;
        halter: string | null;
        wege: string[];
    }[] = [];
    for (const node of weg) {
        // Der Partner: der nächste technische Knoten im geltenden Netz, der im weiten Radius liegt.
        let partner: RouteNode | null = null;
        let abstand = Infinity;
        for (const kandidat of technisch) {
            if (kandidat.id === node.id) continue;
            const weit = Math.hypot(kandidat.x - node.x, kandidat.y - node.y);
            if (weit < abstand) {
                abstand = weit;
                partner = kandidat;
            }
        }
        if (!partner || abstand > weiterSnap + 1e-9) continue;
        const paarId = [node.id, partner.id].sort().join("|");
        if (gesehen.has(paarId)) continue;
        gesehen.add(paarId);
        let naechste: { id: string; abstand: number } | null = null;
        for (const kreuzung of kreuzungen) {
            const weit = Math.hypot(kreuzung.x - node.x, kreuzung.y - node.y);
            if (naechste === null || weit < naechste.abstand) naechste = { id: kreuzung.id, abstand: weit };
        }
        const kreuzungHaelt = kreuzungen.some((kreuzung) => haeltBeide(node, partner, kreuzung));
        const ortHaelt = orte.find((ort) => haeltBeide(node, partner, ort));
        const wege = [
            ...new Set(
                network.links
                    .filter(
                        (link) =>
                            link.from === node.id ||
                            link.to === node.id ||
                            link.from === partner.id ||
                            link.to === partner.id,
                    )
                    .map((link) => link.pathName || link.pathPublicId.slice(0, 8)),
            ),
        ];
        paare.push({
            a: node,
            b: partner,
            abstand,
            kreuzung: naechste,
            halter: kreuzungHaelt ? "Kreuzung" : ortHaelt ? `Ort „${ortHaelt.name}“` : null,
            wege,
        });
    }
    const mitHalter = paare.filter((paar) => paar.halter !== null);
    const ohneHalter = paare.filter((paar) => paar.halter === null);
    console.log(
        `\n**${String(paare.length)} Paare** verbindet ${zahl(weiterSnap, 3)}, die ${zahl(endSnap, 3)} trennt.\n` +
            `- **${String(mitHalter.length)}** hatten bei Legacy einen Halter im Kasten ±${zahl(ENDPOINT_BOX, 1)} (Kreuzung oder Ort): Der weite Radius stellt her, was WI-0132 entfernt hat.\n` +
            `- **${String(ohneHalter.length)}** hatten keinen: Dort war Legacy NICHT verbunden, und die Trennung kann gewollt sein.`,
    );
    const zeile = (paar: (typeof paare)[number]): string =>
        `| [${zahl(paar.a.x, 3)} \\| ${zahl(paar.a.y, 3)}] | [${zahl(paar.b.x, 3)} \\| ${zahl(paar.b.y, 3)}] | ${zahl(paar.abstand, 5)} | ${paar.halter ?? "**keiner**"} | ${paar.kreuzung ? zahl(paar.kreuzung.abstand, 3) : "-"} | ${paar.wege.join(", ")} |`;
    if (ohneHalter.length > 0) {
        console.log(`\n### Die ${String(ohneHalter.length)} Paare ohne Halter bei Legacy\n`);
        console.log("| Ende A | Ende B | Abstand | Halter | nächste Kreuzung | Wege |\n|---|---|---|---|---|---|");
        for (const paar of ohneHalter.sort((a, b) => a.abstand - b.abstand)) console.log(zeile(paar));
    }
    const nachHalter = new Map<string, number>();
    for (const paar of mitHalter)
        nachHalter.set(paar.halter as string, (nachHalter.get(paar.halter as string) ?? 0) + 1);
    console.log(`\n### Die ${String(mitHalter.length)} Paare mit Halter\n`);
    console.log("| Ende A | Ende B | Abstand | Halter | nächste Kreuzung | Wege |\n|---|---|---|---|---|---|");
    for (const paar of mitHalter.sort((a, b) => b.abstand - a.abstand)) console.log(zeile(paar));
    console.log("\n| Halter | Paare |\n|---|---|");
    const kreuzungsPaare = nachHalter.get("Kreuzung") ?? 0;
    console.log(`| Kreuzung | ${String(kreuzungsPaare)} |`);
    console.log(`| nur ein Ort | ${String(mitHalter.length - kreuzungsPaare)} |`);
}

if (weiter) fangpaareZeigen(weiter, Number(values.fangpaare));

interface Abschnitt {
    index: number;
    name: string;
    subtype: string;
    transport: string;
    von: string;
    nach: string;
    vonId: string;
    nachId: string;
    units: number;
    stunden: number;
    synthetic: boolean;
    offroad: boolean;
    anfang: [number, number];
    ende: [number, number];
    punkte: number;
    /** Die Kennung der Kante: `see-frei-…` ist eine freie Seereise, `flug-…` ein Flug (`FREE_SEA_EDGE_PREFIX`). */
    kante: string;
    /** Die ausgelieferte Linie des Abschnitts, in Fahrtrichtung - für `--naehte`. */
    linie: [number, number][];
    /**
     * Die Zeichenlinie, wenn der Dienst eine mitschickt (`display`). 🔴 Nur ein Abschnitt OHNE sie wird aus
     * `geometry` geglättet (`segmentShape`), und nur dort kann der herangezogene Punkt die Kurve verziehen.
     */
    display: [number, number][] | null;
    /** Welche Enden der Dienst als Anschlussstück meldet (`joints`, WI-0147). */
    joints: { start: boolean; end: boolean } | null;
}

/** Unsere Route im Prozess: dieselben Stufen wie im Dienst, nur ohne Fastify. */
function unsereRoute(
    von: string,
    nach: string,
): {
    gefunden: boolean;
    units: number;
    meilen: number;
    stunden: number;
    abschnitte: Abschnitt[];
    linie: [number, number][];
    sperrwege: string[];
    kehren: ReturnType<typeof kehren>;
} {
    const vonId = idVonName.get(von);
    const nachId = idVonName.get(nach);
    if (vonId === undefined || nachId === undefined) {
        throw new Error(`Ort nicht im Netz: ${vonId === undefined ? von : nach}`);
    }
    const ergebnis = findRoute(network, graph, [vonId, nachId], terrain);
    const linie: [number, number][] = [];
    for (const abschnitt of ergebnis.segments) {
        for (const punkt of abschnitt.geometry.coordinates) {
            const letzter = linie[linie.length - 1];
            if (letzter && letzter[0] === punkt[0] && letzter[1] === punkt[1]) continue;
            linie.push([punkt[0] as number, punkt[1] as number]);
        }
    }
    return {
        gefunden: ergebnis.found,
        units: ergebnis.distanceUnits,
        meilen: ergebnis.distanceUnits * MILES,
        stunden: ergebnis.travelHours,
        abschnitte: ergebnis.segments.map((segment) => {
            const coordinates = segment.geometry.coordinates;
            return {
                index: segment.index,
                name: segment.path_name,
                subtype: segment.subtype,
                transport: segment.transport_type,
                von: segment.from_node,
                nach: segment.to_node,
                vonId: segment.from_node_id,
                nachId: segment.to_node_id,
                units: segment.distance_units,
                stunden: segment.travel_hours,
                synthetic: segment.synthetic,
                offroad: segment.offroad,
                anfang: (coordinates[0] ?? [0, 0]) as [number, number],
                ende: (coordinates[coordinates.length - 1] ?? [0, 0]) as [number, number],
                punkte: coordinates.length,
                kante: segment.edge_id,
                linie: coordinates.map((punkt) => [punkt[0], punkt[1]] as [number, number]),
                display: segment.display?.coordinates.map((punkt) => [punkt[0], punkt[1]] as [number, number]) ?? null,
                joints: segment.joints ?? null,
            };
        }),
        linie,
        sperrwege: [...new Set(ergebnis.seasonalWays.map((way) => way.path_name))],
        kehren: ergebnis.found ? kehren(linie, orte, new Set([von, nach])) : [],
    };
}

/** Ab dieser Lücke zieht die Ergebnisbildung die Linie an den Knoten (`NODE_GAP` in `route-result.ts`). */
const NAHT_GAP = 0.0005;

/**
 * Die Nähte einer Route: wo die Linie des einen Abschnitts auf die des nächsten trifft, wie weit sie dort klafft, und
 * welcher Richtungswechsel daraus entsteht.
 *
 * 🔴 Gebraucht für die Kehrtwenden an Anlegestellen (WI-0147, Auftrag 2026-10-14): Eine **freie Seereise beginnt und
 * endet genau auf dem Hafenort** (`SeaFleet.line` setzt `at[hafen]` davor und dahinter), ein Landweg dagegen dort, wo
 * er gezeichnet ist - bis 0,5 Einheiten neben dem Ort (`ENDPOINT_BOX`). Die Naht klafft deshalb immer, die
 * Ergebnisbildung zieht beide Seiten an den Ortsknoten (`toNodes`), und der kurze Schritt vom Wegende auf den Ort zeigt
 * entgegen der Fahrtrichtung. Genau dieser Schritt ist der Scheitel, den der Prüfhaken als Kehrtwende zählt.
 */
function naehteZeigen(abschnitte: readonly Abschnitt[], gefundene: ReturnType<typeof kehren>): void {
    const punkt = (p: readonly [number, number]): string => `[${p[0].toFixed(6)}|${p[1].toFixed(6)}]`;
    const weit = (a: readonly [number, number], b: readonly [number, number]): number =>
        Math.hypot(a[0] - b[0], a[1] - b[1]);
    const art = (abschnitt: Abschnitt): string =>
        abschnitt.kante.startsWith(FREE_SEA_EDGE_PREFIX) ? "FREIE SEEREISE" : abschnitt.name || abschnitt.subtype;
    console.log("  Nähte:");
    for (let naht = 1; naht < abschnitte.length; naht += 1) {
        const davor = abschnitte[naht - 1] as Abschnitt;
        const danach = abschnitte[naht] as Abschnitt;
        const linkeSeite = davor.linie;
        const rechteSeite = danach.linie;
        if (linkeSeite.length < 2 || rechteSeite.length < 2) continue;
        const b = linkeSeite[linkeSeite.length - 1] as [number, number];
        const a = linkeSeite[linkeSeite.length - 2] as [number, number];
        const c = rechteSeite[0] as [number, number];
        const d = rechteSeite[1] as [number, number];
        const luecke = weit(b, c);
        // Die Punktfolge der zusammengesetzten Linie: ein Doppelpunkt an der Naht fällt heraus (so baut sie auch
        // `unsereRoute`), also steht dort nur EIN Scheitel.
        const folge: [number, number][] = luecke < 1e-9 ? [a, b, d] : [a, b, c, d];
        const winkel = folge
            .slice(1, -1)
            .map((mitte, index) =>
                zahl(
                    wendeGrad(folge[index] as [number, number], mitte, folge[index + 2] as [number, number]),
                    1,
                ).padStart(6),
            );
        const kehre = gefundene.find((k) => weit([k.x, k.y], b) < 0.01 || weit([k.x, k.y], c) < 0.01);
        const schritte = `Schritt davor ${zahl(weit(a, b), 6)}, danach ${zahl(weit(c, d), 6)}`;
        console.log(
            `  ${String(naht).padStart(3)} ${art(davor).slice(0, 22).padEnd(22)} → ${art(danach).slice(0, 22).padEnd(22)} ` +
                `an ${(danach.von || "·").padEnd(22)} Lücke ${zahl(luecke, 6).padStart(9)}` +
                `${luecke > NAHT_GAP ? " GEZOGEN" : " glatt  "} Winkel ${winkel.join("/")}° ${schritte}` +
                `${kehre ? ` 🪤 KEHRE ${zahl(kehre.grad, 1)}° bei ${kehre.ort}` : ""}`,
        );
        if (!kehre && luecke <= NAHT_GAP) continue;
        console.log(`        links  … ${punkt(a)} ${punkt(b)}`);
        console.log(`        rechts ${punkt(c)} ${punkt(d)} …`);
        for (const seite of [davor, danach]) {
            if (!seite.kante.startsWith(FREE_SEA_EDGE_PREFIX)) continue;
            const erster = seite.linie[0] as [number, number];
            const zweiter = seite.linie[1] as [number, number];
            const vorletzter = seite.linie[seite.linie.length - 2] as [number, number];
            const letzter = seite.linie[seite.linie.length - 1] as [number, number];
            // Die Linie gegen die bezahlte Strecke: Macht die Zeichnung am Hafen einen Haken, den die Kosten nicht
            // kennen, dann weichen die beiden voneinander ab.
            const gemessen = seite.linie.reduce(
                (summe, p, index) => (index === 0 ? 0 : summe + weit(seite.linie[index - 1] as [number, number], p)),
                0,
            );
            console.log(
                `        Seereise ${seite.kante}: Hafenstück am Anfang ${zahl(weit(erster, zweiter), 6)} ` +
                    `(${punkt(erster)} → ${punkt(zweiter)}), am Ende ${zahl(weit(vorletzter, letzter), 6)} ` +
                    `(${punkt(vorletzter)} → ${punkt(letzter)}), Länge gerechnet ${zahl(seite.units, 3)}, ` +
                    `Linie gemessen ${zahl(gemessen, 3)} (Abweichung ${zahl(gemessen - seite.units, 4)})`,
            );
        }
    }
}

/**
 * Die gezeichnete Form eines Routenabschnitts, genau wie `segmentShape` in `apps/web/src/map/route-layers.ts`:
 * Catmull-Rom über die gelieferte Linie, aber **erst ab drei Punkten** — eine Sehne aus zwei Punkten bleibt gerade.
 */
function gezeichneteForm(punkte: readonly (readonly [number, number])[]): [number, number][] {
    if (punkte.length <= 2) return punkte.map((punkt) => [punkt[0], punkt[1]] as [number, number]);
    const kurve = catmullRomLine(punkte.map(([x, y]) => ({ x, y }) as CurvePoint));
    return kurve.map((punkt) => [punkt.x, punkt.y] as [number, number]);
}

/** Der größte Abstand eines Punktes der gezeichneten Kurve von der Linie, die sie darstellen soll. */
function ausschlagUeber(
    kurve: readonly (readonly [number, number])[],
    linie: readonly (readonly [number, number])[],
): number {
    let groesste = 0;
    for (const punkt of kurve) {
        let nah = Infinity;
        for (let index = 0; index < linie.length - 1; index += 1) {
            const [ax, ay] = linie[index] as [number, number];
            const [bx, by] = linie[index + 1] as [number, number];
            const dx = bx - ax;
            const dy = by - ay;
            const laenge = dx * dx + dy * dy;
            const t = laenge > 0 ? Math.max(0, Math.min(1, ((punkt[0] - ax) * dx + (punkt[1] - ay) * dy) / laenge)) : 0;
            nah = Math.min(nah, Math.hypot(punkt[0] - (ax + t * dx), punkt[1] - (ay + t * dy)));
        }
        groesste = Math.max(groesste, nah);
    }
    return groesste;
}

/** Die vier Fassungen einer an den Knoten gezogenen Linie, je mit ihrem Ausschlag. */
function fassungen(
    roh: readonly (readonly [number, number])[],
    knoten: readonly [number, number],
): { roh: number; davor: number; ersetzt: number; stummel: number; stummelGeglaettet: number; punkteDavor: number } {
    const davorLinie = [
        ...roh.map((p) => [p[0], p[1]] as [number, number]),
        [knoten[0], knoten[1]] as [number, number],
    ];
    const ersetztLinie = roh.map((p, index) =>
        index === roh.length - 1 ? ([knoten[0], knoten[1]] as [number, number]) : ([p[0], p[1]] as [number, number]),
    );
    // Fassung B: die Kurve läuft NUR über die Rohlinie, der Knoten hängt als gerader Stummel daran.
    const stummelForm = [...gezeichneteForm(roh), [knoten[0], knoten[1]] as [number, number]];
    return {
        roh: ausschlagUeber(gezeichneteForm(roh), roh),
        davor: ausschlagUeber(gezeichneteForm(davorLinie), davorLinie),
        ersetzt: ausschlagUeber(gezeichneteForm(ersetztLinie), ersetztLinie),
        stummel: ausschlagUeber(stummelForm, davorLinie),
        // 🪤 Legt der Server den Stummel in `display`, glättet `segmentShape` ihn ein ZWEITES Mal (es nimmt nur freie
        // Seefahrt und Flug aus). Was davon übrig bleibt, steht hier.
        stummelGeglaettet: ausschlagUeber(gezeichneteForm(stummelForm), davorLinie),
        punkteDavor: davorLinie.length,
    };
}

/**
 * Wie weit die gezeichnete Kurve über die Linie ausschlägt, wenn ein Wegende an einen Ortsknoten gezogen wird — über
 * ALLE solchen Stellen des Netzes, nach der Lücke gruppiert, und in den drei zur Debatte stehenden Fassungen.
 *
 * 🔴 Die Frage dahinter (Auftrag 2026-10-15): Entsteht der Ausschlag, weil der gezogene Zug KURZ ist, oder weil eine
 * kurze Strecke neben einer langen in der Glättung liegt? Verschwindet er mit größerer Lücke, heilt das Ersetzen unter
 * einer Schwelle den ganzen Fall; bleibt er, braucht es den geraden Stummel.
 */
function ausschlagZeigen(): void {
    // 🔴 Die Grenze 0,01 ist `NODE_SNAP`: Nur unterhalb greift das Ersetzen (Fassung A).
    const stufen = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5];
    const faecher = new Map<
        number,
        {
            luecken: number[];
            roh: number[];
            davor: number[];
            ersetzt: number[];
            stummel: number[];
            zweimal: number[];
            geglaettet: number;
        }
    >();
    for (const stufe of stufen)
        faecher.set(stufe, { luecken: [], roh: [], davor: [], ersetzt: [], stummel: [], zweimal: [], geglaettet: 0 });
    let stellen = 0;
    for (const link of network.links) {
        for (const seite of ["from", "to"] as const) {
            const node = network.nodes.get(seite === "from" ? link.from : link.to);
            if (!node || node.kind !== "place") continue;
            const roh = seite === "from" ? [...link.coordinates].reverse() : [...link.coordinates];
            const ende = roh[roh.length - 1] as [number, number];
            const luecke = Math.hypot(ende[0] - node.x, ende[1] - node.y);
            if (luecke <= NAHT_GAP || luecke >= ENDPOINT_BOX) continue;
            const stufe = stufen.find((grenze) => luecke <= grenze);
            if (stufe === undefined) continue;
            const werte = fassungen(roh, [node.x, node.y]);
            const fach = faecher.get(stufe) as NonNullable<ReturnType<typeof faecher.get>>;
            fach.luecken.push(luecke);
            fach.roh.push(werte.roh);
            fach.davor.push(werte.davor);
            fach.ersetzt.push(werte.ersetzt);
            fach.stummel.push(werte.stummel);
            fach.zweimal.push(werte.stummelGeglaettet);
            if (werte.punkteDavor > 2) fach.geglaettet += 1;
            stellen += 1;
        }
    }
    const median = (werte: number[]): number => {
        if (werte.length === 0) return 0;
        const sortiert = [...werte].sort((a, b) => a - b);
        return sortiert[Math.floor(sortiert.length / 2)] as number;
    };
    const p95 = (werte: number[]): number => {
        if (werte.length === 0) return 0;
        const sortiert = [...werte].sort((a, b) => a - b);
        return sortiert[Math.min(sortiert.length - 1, Math.floor(sortiert.length * 0.95))] as number;
    };
    console.log(
        `\n## Ausschlag der gezeichneten Kurve, je Lücke zwischen Wegende und Ortsknoten (${String(stellen)} Stellen im Netz, Fang ${zahl(endSnap, 5)})\n`,
    );
    console.log(
        "| Lücke bis | Stellen | Rohlinie (Median/p95) | davorsetzen (Median/p95/max) | ersetzen (Median/p95) | Stummel (Median/p95) | Stummel zweimal geglättet (Median/p95) |",
    );
    console.log("|---|---|---|---|---|---|---|");
    for (const stufe of stufen) {
        const fach = faecher.get(stufe) as NonNullable<ReturnType<typeof faecher.get>>;
        if (fach.luecken.length === 0) continue;
        console.log(
            `| ${zahl(stufe, 3)} E | ${String(fach.luecken.length)} | ` +
                `${zahl(median(fach.roh), 4)} / ${zahl(p95(fach.roh), 4)} | ` +
                `**${zahl(median(fach.davor), 4)} / ${zahl(p95(fach.davor), 4)} / ${zahl(Math.max(...fach.davor), 4)}** | ` +
                `${zahl(median(fach.ersetzt), 4)} / ${zahl(p95(fach.ersetzt), 4)} | ` +
                `${zahl(median(fach.stummel), 4)} / ${zahl(p95(fach.stummel), 4)} | ` +
                `${zahl(median(fach.zweimal), 4)} / ${zahl(p95(fach.zweimal), 4)} |`,
        );
    }
    // Dieselbe Frage an einer gebauten Geometrie: eine lange Strecke, dann der Zug auf den Knoten, Winkel 180 Grad.
    console.log(`\n### Dieselbe Frage an einer gebauten Geometrie: Strecke ${zahl(4, 0)} E, Zug genau zurück\n`);
    console.log("| Lücke | Punkte | davorsetzen | ersetzen | Stummel | Stummel zweimal |\n|---|---|---|---|---|---|");
    for (const luecke of [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.45]) {
        const roh: [number, number][] = [
            [10, 10],
            [6, 10],
        ];
        const werte = fassungen(roh, [6 + luecke, 10]);
        console.log(
            `| ${zahl(luecke, 3)} | ${String(werte.punkteDavor)} | **${zahl(werte.davor, 4)}** | ${zahl(werte.ersetzt, 4)} | ${zahl(werte.stummel, 4)} | ${zahl(werte.stummelGeglaettet, 4)} |`,
        );
    }
    console.log(`\n### Wie der Ausschlag an der LÄNGE der Strecke davor hängt, bei fester Lücke 0,002\n`);
    console.log("| Strecke davor | davorsetzen | ersetzen | Stummel | Stummel zweimal |\n|---|---|---|---|---|");
    for (const laenge of [0.05, 0.2, 0.5, 1.1, 4, 10]) {
        const roh: [number, number][] = [
            [10, 10],
            [10 - laenge, 10],
        ];
        const werte = fassungen(roh, [10 - laenge + 0.002, 10]);
        console.log(
            `| ${zahl(laenge, 2)} E | **${zahl(werte.davor, 4)}** | ${zahl(werte.ersetzt, 4)} | ${zahl(werte.stummel, 4)} | ${zahl(werte.stummelGeglaettet, 4)} |`,
        );
    }
}

if (values.ausschlag) ausschlagZeigen();

const outDirectory = resolve(values.out);
mkdirSync(outDirectory, { recursive: true });

/** Legacys Antwort je Route, in der Zeilenform des Orakels. */
interface LegacyZeile {
    error?: { message: string };
    route?: {
        found: boolean;
        distance_units: number;
        duration?: { travel_hours: number };
        segments?: {
            public_id?: string;
            from_node?: string;
            to_node?: string;
            subtype?: string;
            transport_type?: string;
            distance_units?: number;
            travel_hours?: number;
            synthetic?: boolean;
            offroad?: boolean;
            geometry?: { coordinates: [number, number][] };
        }[];
    };
}

const eintraege = [
    ...values.route,
    ...(values["routen-datei"] === undefined
        ? []
        : readFileSync(values["routen-datei"], "utf8")
              .split(/\r?\n/)
              .map((zeile) => zeile.trim())
              .filter((zeile) => zeile !== "" && !zeile.startsWith("#"))),
];
const paare = eintraege.map((eintrag) => {
    const [von, nach] = eintrag.split("|");
    if (von === undefined || nach === undefined) throw new Error(`Eine Route braucht "Von|Nach", nicht "${eintrag}"`);
    return { von: von.trim(), nach: nach.trim() };
});

let legacyZeilen: LegacyZeile[] = [];
if (values.legacy && paare.length > 0) {
    const anfragen = paare.map((paar) => ({
        from: paar.von,
        to: paar.nach,
        via: [],
        optimize: REQUEST.optimize,
        transports: { ...REQUEST.transports, synthetic: REQUEST.transports.land },
        enabled_transports: REQUEST.enabled,
        minimize_transfers: false,
        include_geometry: true,
        debug: false,
    }));
    const requestsFile = join(outDirectory, "legacy-requests.json");
    const resultsFile = join(outDirectory, "legacy-results.jsonl");
    writeFileSync(requestsFile, JSON.stringify(anfragen));
    const oracle = resolve(import.meta.dirname, "../../../../scripts/dev/legacy-route-oracle/run.mjs");
    const oracleDatabase = resolve(
        import.meta.dirname,
        "../../../../review/topologie-vergleich/legacy-2026-09-28.sqlite",
    );
    if (!existsSync(oracleDatabase)) throw new Error(`Orakel-Datenbank fehlt: ${oracleDatabase}`);
    execFileSync(
        process.execPath,
        [oracle, "--requests", requestsFile, "--out", resultsFile, "--workers", "4", "--database", oracleDatabase],
        { stdio: "inherit" },
    );
    legacyZeilen = readFileSync(resultsFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as LegacyZeile);
}

/**
 * Die Form, in der die Karte einen Abschnitt zeichnet — **genau wie `segmentShape`** in
 * `apps/web/src/map/route-layers.ts`, Anschlussstücke eingeschlossen. Mit `ohneJoints` wie vor WI-0147s zweiter
 * Fassung, also mit dem Anschlussstück in der Glättung.
 */
function kartenForm(abschnitt: Abschnitt, ohneJoints = false): [number, number][] {
    const joints = ohneJoints ? null : abschnitt.joints;
    const anfang = joints?.start === true ? (abschnitt.linie[0] as [number, number]) : null;
    const schluss = joints?.end === true ? (abschnitt.linie[abschnitt.linie.length - 1] as [number, number]) : null;
    const quelle = abschnitt.display ?? abschnitt.linie;
    const gleich = (a: readonly [number, number], b: readonly [number, number]): boolean =>
        Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
    let von = 0;
    let bis = quelle.length;
    if (anfang && bis - von > 1 && gleich(anfang, quelle[von] as [number, number])) von += 1;
    if (schluss && bis - von > 1 && gleich(schluss, quelle[bis - 1] as [number, number])) bis -= 1;
    const kern = quelle.slice(von, bis);
    const geglaettet =
        abschnitt.display && abschnitt.kante.startsWith(FREE_SEA_EDGE_PREFIX) ? kern : gezeichneteForm(kern);
    return [...(anfang ? [anfang] : []), ...geglaettet, ...(schluss ? [schluss] : [])];
}

/** Für `--ausschlag` mit Routen: Wie viele Abschnitte die Karte überhaupt aus `geometry` glättet. */
const zeichnung = {
    gesamt: 0,
    mitDisplay: 0,
    geglaettet: 0,
    zweiPunkte: 0,
    amOrt: 0,
    amOrtGeglaettet: 0,
    displayRisse: 0,
    groessterRiss: 0,
    rissArten: new Map<string, number>(),
    mitJoints: 0,
    formAlt: [] as number[],
    formNeu: [] as number[],
    nahtAlt: 0,
    nahtNeu: 0,
    nahtAltGroesste: 0,
    nahtNeuGroesste: 0,
};

for (const [index, paar] of paare.entries()) {
    const unsere = unsereRoute(paar.von, paar.nach);
    if (values.ausschlag) {
        for (const abschnitt of unsere.abschnitte) {
            zeichnung.gesamt += 1;
            // 🔴 Die ECHTE gezeichnete Form, mit und ohne die Anschlussstuecke: Das ist der Nachweis, dass die zweite
            // Fassung greift, und nicht nur die Rechnung daneben.
            if (abschnitt.joints) {
                zeichnung.mitJoints += 1;
                zeichnung.formAlt.push(ausschlagUeber(kartenForm(abschnitt, true), abschnitt.linie));
                zeichnung.formNeu.push(ausschlagUeber(kartenForm(abschnitt), abschnitt.linie));
            }
            if (abschnitt.display) {
                /* siehe unten */
                zeichnung.mitDisplay += 1;
                // 🔴 Klafft die Zeichenlinie gegen die gelieferte Linie? Bei einem an einem Anker geteilten Weg kommt
                // `display` aus der ROHLINIE (`RouteDisplay.piece`) und kennt den herangezogenen Knoten nicht.
                const paare: [[number, number], [number, number], string][] = [
                    [abschnitt.display[0] as [number, number], abschnitt.linie[0] as [number, number], abschnitt.vonId],
                    [
                        abschnitt.display[abschnitt.display.length - 1] as [number, number],
                        abschnitt.linie[abschnitt.linie.length - 1] as [number, number],
                        abschnitt.nachId,
                    ],
                ];
                for (const [a, b, knotenId] of paare) {
                    // 🔴 Nur wo die gelieferte Linie auf einem ORTSKNOTEN endet, ist der Abstand der fehlende
                    // herangezogene Punkt; an einem Anker ist er der gewollte Schwung der Wegkurve.
                    const node = network.nodes.get(knotenId);
                    const amOrtsknoten = node?.kind === "place" && Math.hypot(b[0] - node.x, b[1] - node.y) <= NAHT_GAP;
                    const weit = Math.hypot(a[0] - b[0], a[1] - b[1]);
                    if (weit > NAHT_GAP) {
                        zeichnung.displayRisse += 1;
                        zeichnung.groessterRiss = Math.max(zeichnung.groessterRiss, weit);
                        const art = abschnitt.kante.startsWith(FREE_SEA_EDGE_PREFIX)
                            ? "freie Seereise"
                            : abschnitt.synthetic
                              ? "querfeldein"
                              : abschnitt.kante.startsWith("wp-slice-")
                                ? "geteilter Weg"
                                : abschnitt.kante.startsWith("flug-")
                                  ? "Flug"
                                  : "ganzer Weg";
                        const marke = amOrtsknoten ? `${art} AM ORTSKNOTEN` : `${art} (Anker, gewollt)`;
                        zeichnung.rissArten.set(marke, (zeichnung.rissArten.get(marke) ?? 0) + 1);
                    }
                }
                continue;
            }
            if (abschnitt.linie.length > 2) zeichnung.geglaettet += 1;
            else zeichnung.zweiPunkte += 1;
            // Endet die Linie auf einem Ortsknoten, dessen Rohlinie dort nicht endete, wurde sie gezogen.
            for (const seite of [0, abschnitt.linie.length - 1]) {
                const punkt = abschnitt.linie[seite] as [number, number];
                const node = network.nodes.get(seite === 0 ? abschnitt.vonId : abschnitt.nachId);
                if (!node || node.kind !== "place") continue;
                if (Math.hypot(punkt[0] - node.x, punkt[1] - node.y) > NAHT_GAP) continue;
                zeichnung.amOrt += 1;
                if (abschnitt.linie.length > 2) zeichnung.amOrtGeglaettet += 1;
            }
        }
        /**
         * 🔴 Die Probe auf Bedingung 2: Klafft die GEZEICHNETE Linie an der Naht zwischen zwei Abschnitten? Das ist
         * die Frage, nicht ob ein Abschnittsende auf der gelieferten Linie liegt — am Anker weicht die Wegkurve dort
         * gewollt ab (WI-0030). Gezählt wird mit und ohne Anschlussstücke, damit sichtbar wird, ob die zweite Fassung
         * etwas aufreißt.
         */
        for (let naht = 1; naht < unsere.abschnitte.length; naht += 1) {
            const davor = unsere.abschnitte[naht - 1] as Abschnitt;
            const danach = unsere.abschnitte[naht] as Abschnitt;
            for (const ohne of [true, false]) {
                const links = kartenForm(davor, ohne);
                const rechts = kartenForm(danach, ohne);
                const a = links[links.length - 1] as [number, number];
                const b = rechts[0] as [number, number];
                const weit = Math.hypot(a[0] - b[0], a[1] - b[1]);
                if (ohne) {
                    if (weit > NAHT_GAP) zeichnung.nahtAlt += 1;
                    zeichnung.nahtAltGroesste = Math.max(zeichnung.nahtAltGroesste, weit);
                } else {
                    if (weit > NAHT_GAP) zeichnung.nahtNeu += 1;
                    zeichnung.nahtNeuGroesste = Math.max(zeichnung.nahtNeuGroesste, weit);
                }
            }
        }
    }
    console.log(`\n# ${paar.von} → ${paar.nach}`);
    console.log(
        `\n## wir (Fang ${zahl(endSnap, 5)}, See ${values.see}): ` +
            `${unsere.gefunden ? `${zahl(unsere.meilen, 0)} Meilen (${zahl(unsere.units, 3)} E), ${zahl(unsere.stunden)} h` : "nicht gefunden"}, ` +
            `${String(unsere.abschnitte.length)} Abschnitte, ${String(unsere.kehren.length)} Kehren · ` +
            `Sperrung: ${unsere.sperrwege.length > 0 ? unsere.sperrwege.join(", ") : "nein"}`,
    );
    for (const abschnitt of unsere.abschnitte) {
        console.log(
            `  ${String(abschnitt.index).padStart(3)} ${(abschnitt.name || "-").padEnd(26)} ${abschnitt.subtype.padEnd(12)} ` +
                `${abschnitt.transport.padEnd(11)} len=${zahl(abschnitt.units, 3).padStart(8)} h=${zahl(abschnitt.stunden).padStart(7)} ` +
                `${(abschnitt.von || "·").padEnd(22)} → ${(abschnitt.nach || "·").padEnd(22)} ` +
                `[${zahl(abschnitt.anfang[0])},${zahl(abschnitt.anfang[1])}]→[${zahl(abschnitt.ende[0])},${zahl(abschnitt.ende[1])}] ` +
                `pts=${String(abschnitt.punkte)}${abschnitt.synthetic ? " QUERFELDEIN" : ""}${abschnitt.offroad ? " KARTENPUNKT" : ""}`,
        );
    }
    for (const kehre of unsere.kehren) {
        console.log(
            `  🪤 Kehre bei ${kehre.ort} (${zahl(kehre.x, 3)} | ${zahl(kehre.y, 3)}), ${zahl(kehre.grad, 1)}°, Linienpunkt ${String(kehre.index)}`,
        );
    }
    if (values.naehte) naehteZeigen(unsere.abschnitte, unsere.kehren);
    if (values.linie)
        console.log(`  Linie: ${unsere.linie.map((punkt) => `[${zahl(punkt[0])},${zahl(punkt[1])}]`).join(" ")}`);

    const zeile = legacyZeilen[index];
    if (!zeile) continue;
    if (zeile.error) {
        console.log(`\n## Legacy: Fehler ${zeile.error.message}`);
        continue;
    }
    const route = zeile.route;
    if (!route?.found) {
        console.log(`\n## Legacy: nicht gefunden`);
        continue;
    }
    const legacyLinie: [number, number][] = [];
    for (const abschnitt of route.segments ?? []) {
        for (const punkt of abschnitt.geometry?.coordinates ?? []) {
            const letzter = legacyLinie[legacyLinie.length - 1];
            if (letzter && letzter[0] === punkt[0] && letzter[1] === punkt[1]) continue;
            legacyLinie.push([punkt[0], punkt[1]]);
        }
    }
    const legacyKehren = kehren(legacyLinie, orte, new Set([paar.von, paar.nach]));
    console.log(
        `\n## Legacy (Snapshot 2026-09-28): ${zahl(route.distance_units * MILES, 0)} Meilen (${zahl(route.distance_units, 3)} E), ` +
            `${zahl(route.duration?.travel_hours ?? 0)} h, ${String((route.segments ?? []).length)} Abschnitte, ` +
            `${String(legacyKehren.length)} Kehren`,
    );
    for (const abschnitt of route.segments ?? []) {
        const coordinates = abschnitt.geometry?.coordinates ?? [];
        const anfang = (coordinates[0] ?? [0, 0]) as [number, number];
        const ende = (coordinates[coordinates.length - 1] ?? [0, 0]) as [number, number];
        console.log(
            `  ${(abschnitt.public_id ?? "-").padEnd(10)} ${(abschnitt.subtype ?? "-").padEnd(12)} ` +
                `${(abschnitt.transport_type ?? "-").padEnd(11)} len=${zahl(abschnitt.distance_units ?? 0, 3).padStart(8)} ` +
                `${(abschnitt.from_node ?? "·").padEnd(22)} → ${(abschnitt.to_node ?? "·").padEnd(22)} ` +
                `[${zahl(anfang[0])},${zahl(anfang[1])}]→[${zahl(ende[0])},${zahl(ende[1])}] pts=${String(coordinates.length)}` +
                `${abschnitt.synthetic ? " QUERFELDEIN" : ""}${abschnitt.offroad ? " KARTENPUNKT" : ""}`,
        );
    }
    for (const kehre of legacyKehren) {
        console.log(
            `  🪤 Legacy kehrt bei ${kehre.ort} (${zahl(kehre.x, 3)} | ${zahl(kehre.y, 3)}), ${zahl(kehre.grad, 1)}°`,
        );
    }
}

if (values.ausschlag && zeichnung.gesamt > 0) {
    const anteil = (teil: number): string => `${zahl((teil / zeichnung.gesamt) * 100, 1)} %`;
    console.log(`\n## Was die Karte von diesen Routen überhaupt glättet (${String(zeichnung.gesamt)} Abschnitte)\n`);
    console.log("| | Abschnitte | Anteil |\n|---|---|---|");
    console.log(
        `| mit eigener Zeichenlinie (\`display\`): die Abschnittslinie wird NICHT geglättet | ${String(zeichnung.mitDisplay)} | ${anteil(zeichnung.mitDisplay)} |`,
    );
    console.log(
        `| ohne \`display\`, über zwei Punkte: **aus \`geometry\` geglättet** | ${String(zeichnung.geglaettet)} | ${anteil(zeichnung.geglaettet)} |`,
    );
    console.log(
        `| ohne \`display\`, genau zwei Punkte: bleibt gerade | ${String(zeichnung.zweiPunkte)} | ${anteil(zeichnung.zweiPunkte)} |`,
    );
    console.log(
        `| davon Enden, die auf einem Ortsknoten liegen | ${String(zeichnung.amOrt)} | ${anteil(zeichnung.amOrt)} |`,
    );
    console.log(
        `| davon auf einem geglätteten Abschnitt | ${String(zeichnung.amOrtGeglaettet)} | ${anteil(zeichnung.amOrtGeglaettet)} |`,
    );
}

if (values.ausschlag && zeichnung.mitDisplay > 0) {
    console.log(
        `\n🪤 Von den ${String(zeichnung.mitDisplay)} Abschnitten mit eigener Zeichenlinie klaffen ` +
            `**${String(zeichnung.displayRisse)} Enden** gegen die gelieferte Linie, der größte um ` +
            `${zahl(zeichnung.groessterRiss, 4)} Einheiten. Nach Art: ` +
            [...zeichnung.rissArten].map(([art, wie]) => `${art} ${String(wie)}`).join(", "),
    );
}

if (values.ausschlag && zeichnung.mitJoints > 0) {
    const sortiert = (werte: number[]): number[] => [...werte].sort((a, b) => a - b);
    const med = (werte: number[]): number => sortiert(werte)[Math.floor(werte.length / 2)] ?? 0;
    const p95v = (werte: number[]): number =>
        sortiert(werte)[Math.min(werte.length - 1, Math.floor(werte.length * 0.95))] ?? 0;
    console.log(
        `\n## Die echte Zeichnung dieser Routen (${String(zeichnung.mitJoints)} Abschnitte mit Anschlussstück)\n`,
    );
    console.log("| Fassung | Ausschlag Median | p95 | größter |\n|---|---|---|---|");
    console.log(
        `| Anschlussstück in der Glättung (vorher) | ${zahl(med(zeichnung.formAlt), 4)} | ${zahl(p95v(zeichnung.formAlt), 4)} | ${zahl(Math.max(...zeichnung.formAlt), 4)} |`,
    );
    console.log(
        `| **Anschlussstück abgetrennt (jetzt)** | **${zahl(med(zeichnung.formNeu), 4)}** | **${zahl(p95v(zeichnung.formNeu), 4)}** | **${zahl(Math.max(...zeichnung.formNeu), 4)}** |`,
    );
    console.log(
        `\n**Nähte der gezeichneten Linie:** mit dem Anschlussstück in der Glättung klafften ` +
            `${String(zeichnung.nahtAlt)} (größte ${zahl(zeichnung.nahtAltGroesste, 6)} E), abgetrennt ` +
            `**${String(zeichnung.nahtNeu)}** (größte ${zahl(zeichnung.nahtNeuGroesste, 6)} E).`,
    );
}
