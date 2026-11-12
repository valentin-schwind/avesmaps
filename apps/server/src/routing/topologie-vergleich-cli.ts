import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { loadRouteNetwork, type RouteNetwork } from "./network.ts";
import { buildRouteGraph, findRoute, type RouteGraph, type RouteRequest } from "./router.ts";
import { loadLand } from "./land.ts";
import { loadRivers } from "./rivers.ts";
import { loadWater } from "./water.ts";
import { END_SNAP } from "./topology.ts";

/**
 * Der Vergleich der Topologievarianten über 200 zufällige Routen (Betreiberauftrag 2026-10-14, wörtlich: „sie soll erst
 * mit 200 zufälligen routen einen vergleich mit legacy und ihrem ansatz machen“).
 *
 * Aufruf (aus `apps/server`):
 *   node --env-file-if-exists=../../.env src/routing/topologie-vergleich-cli.ts [--pairs 200] [--seed 14] [--legacy]
 *
 * 🔴 **Das Werkzeug ändert nichts.** Es rechnet dieselben Routen in mehreren Varianten der Topologie und legt eine Tabelle
 * daneben. Die Entscheidung, welche Variante gilt, trifft der Betreiber danach.
 *
 * **Die Varianten** sind heute der Fangradius am Wegende (`END_SNAP`), alle auf DEMSELBEN Datenstand und deshalb exakt
 * vergleichbar: 0,001 (der Stand vor WI-0147), 0,005 (der geltende) und 0,01 (die Reserve, falls weitere Umwege gemeldet
 * werden). Damit ist die eine offene Stellschraube an echten Routen durchprobierbar, bevor die Konstante bewegt wird.
 * Andere Stufen nennt `--fang` auf der Kommandozeile, eine Angabe je Stufe; die gezogenen Paare bleiben dabei dieselben,
 * solange `END_SNAP` eine der genannten Stufen ist (`--fang 0.005 --fang 0.01 --fang 0.02`, WI-0147 Nachprüfung).
 *
 * 🪤 **Zwei Varianten der ersten Messung sind weg, mit Absicht.** „Treffpunkt vor Ortskasten“ (Claudios Vorschlag) ist
 * gemessen und verworfen: 169 von 206 Reisen begannen oder endeten damit querfeldein, sechs Routen fielen weg. Und das
 * Ziehen der Linie an jeden durchfahrenen Ortsknoten ist keine Variante mehr, sondern abgeschafft. Die Zahlen beider
 * stehen in `discovery/topologie-vergleich-200-routen-2026-10-14.md`; wer sie erneut braucht, nimmt `cce22d0d`.
 *
 * **Legacy** (`--legacy`) rechnet mit `scripts/dev/legacy-route-oracle/run.mjs`, also seinem eigenen PHP-Code gegen einen
 * Snapshot. 🪤 Der Snapshot ist vom 2026-09-28, unser Datenstand vom 2026-10-11: Legacy ist der Maßstab für „ist diese
 * Route plausibel“, nicht für die Stelle hinter dem Komma (Betreiber 2026-10-05: „exakte vergleiche machen keinen [sinn] -
 * nur absurd komische zahlen sollten dann zur überprüfung vorgelegt werden“).
 *
 * **Je Route erfasst** (Betreibervorgabe): Länge, Reisezeit, Kehrtwenden an Orten, die kein Wegpunkt sind, gefunden ja/nein
 * und Sperrung ja/nein. Dazu eine Ausreißerliste mit Ortsnamen.
 */

const { values } = parseArgs({
    options: {
        pairs: { type: "string", default: "200" },
        seed: { type: "string", default: "14" },
        workers: { type: "string", default: "6" },
        out: { type: "string", default: "../../review/topologie-vergleich" },
        snapshot: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/2026-09-28/map-features.json" },
        legacy: { type: "boolean", default: false },
        /** Die Antworten des Orakels aus einem früheren Lauf nehmen, statt es noch einmal rechnen zu lassen. */
        "legacy-wieder": { type: "boolean", default: false },
        /**
         * Andere Stufen des Fangradius als die drei unten, eine Angabe je Stufe (`--fang 0.005 --fang 0.02`). Die
         * Ausreißerliste misst weiter an `END_SNAP`, wenn die Stufe dabei ist, sonst an der ersten: So bleiben die
         * gezogenen Paare dieselben wie ohne den Schalter, und die Antworten des Orakels sind wiederverwendbar.
         */
        fang: { type: "string", multiple: true, default: [] as string[] },
    },
});

/** Ab diesem Richtungswechsel in der Linie heißt es Kehrtwende (Claudios Messung in Production: über 154°). */
const KEHRE_GRAD = 154;
/** Wie nah eine Kehrtwende an einem Ort liegen muss, damit sie ihm zugeschrieben wird. */
const KEHRE_AM_ORT = 0.6;

const MILES = AVENTURIA_TRAVEL_MODEL.meilenJeKarteneinheit.wert;

/** Die Optionen des Planers, wie die Karte sie schickt (seit WI-0153 Schnitt 7e ohne gezeichnete Seewege; ohne Seegraph keine Seereise). */
const REQUEST: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

/** Eine Variante: die Topologie haengt hier nur am Fangradius, deshalb ist sie dasselbe wie ihr Netz. */
interface Variante {
    id: string;
    label: string;
    endSnap: number;
}

const STUFEN: Variante[] = [
    { id: "fang-001", label: "Fangradius 0,001 (Stand vor WI-0147)", endSnap: 0.001 },
    { id: "fang-005", label: `Fangradius ${String(END_SNAP).replace(".", ",")} (geltend)`, endSnap: END_SNAP },
    { id: "fang-01", label: "Fangradius 0,01 (Reserve)", endSnap: 0.01 },
];

/** Wie eine mit `--fang` genannte Stufe heißt. */
const stufenId = (endSnap: number): string => `fang-${String(endSnap).replace("0.", "")}`;

const VARIANTEN: Variante[] =
    values.fang.length === 0
        ? STUFEN
        : values.fang.map((wert) => {
              const endSnap = Number(wert);
              if (!Number.isFinite(endSnap) || endSnap <= 0)
                  throw new Error(`--fang braucht eine Zahl über 0, nicht "${wert}"`);
              const bekannt = STUFEN.find((stufe) => stufe.endSnap === endSnap);
              return bekannt ?? { id: stufenId(endSnap), label: `Fangradius ${wert.replace(".", ",")}`, endSnap };
          });

/** Die geltende Variante; die Ausreisserliste wird an ihr gemessen. */
const AKTUELL = (VARIANTEN.find((variante) => variante.endSnap === END_SNAP) ?? (VARIANTEN[0] as Variante)).id;

/**
 * Die Pflichtfälle aus Claudios Handover (Nachtrag 4, Meldungen des Editors „Tigersprung“ und des Betreibers). Sie kommen
 * zu den 200 zufälligen Routen dazu.
 */
const PFLICHT: [string, string][] = [
    ["Oblotin", "Weidensee"],
    ["Trallop", "Baliho"],
    ["Gareth", "Kaiserhain"],
    ["Marano", "Gareth"],
    ["Rabenbrücke", "Burg Oberhartsteen"],
    ["Treie", "Norburg"],
];

/** Ein kleiner, reproduzierbarer Zufall (mulberry32), wie im Paritätswerkzeug. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Die sichtbaren Orte im größten zusammenhängenden Teil des Netzes: nur von dort werden Paare gezogen. */
function hauptteil(network: RouteNetwork, graph: RouteGraph): string[] {
    const seen = new Set<string>();
    let best: string[] = [];
    for (const start of graph.drawn.keys()) {
        if (seen.has(start)) continue;
        const component: string[] = [];
        const stack = [start];
        seen.add(start);
        while (stack.length > 0) {
            const node = stack.pop() as string;
            component.push(node);
            for (const edge of graph.drawn.get(node) ?? []) {
                if (!seen.has(edge.to)) {
                    seen.add(edge.to);
                    stack.push(edge.to);
                }
            }
        }
        if (component.length > best.length) best = component;
    }
    const inMain = new Set(best);
    return [...network.nodes.values()]
        .filter((node) => node.kind === "place" && !node.isHidden && inMain.has(node.id))
        .map((node) => node.id);
}

/** Der Winkel des Richtungswechsels in Grad: 0 heißt geradeaus, 180 heißt Kehrtwende. */
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

interface Kehre {
    x: number;
    y: number;
    grad: number;
    ort: string;
}

/**
 * Die Kehrtwenden einer Route an Orten, die KEIN Wegpunkt sind — der Prüfhaken des Betreibers.
 *
 * 🪤 Gemessen wird an der Linie der Abschnitte (`geometry`), nicht an der Knotenfolge: Der Stichweg entsteht erst dadurch,
 * dass die Linie bis an den Ort gezogen wird (`cfc3ffe9`). Punkte, die dichter als ein Tausendstel beieinander liegen,
 * werden übersprungen; sonst zählte die Rundung als Richtungswechsel.
 */
function kehren(
    line: readonly [number, number][],
    orte: readonly { name: string; x: number; y: number }[],
    wegpunkte: ReadonlySet<string>,
): Kehre[] {
    const gefunden: Kehre[] = [];
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
        gefunden.push({ x: mitte[0], y: mitte[1], grad, ort });
    }
    return gefunden;
}

interface Messung {
    gefunden: boolean;
    einheiten: number;
    meilen: number;
    stunden: number;
    kehren: Kehre[];
    /** Wege der Route mit Sperrzeit (`seasonalWays`): die Spalte „Sperrung ja/nein“. */
    sperrwege: string[];
    /** Erster oder letzter Abschnitt querfeldein: Der Ort hängt nicht mehr am Netz, ein Anker trägt ihn. */
    ankerAmRand: boolean;
    abschnitte: number;
    /**
     * 🔴 **Die größte Lücke an einer NAHT**, also zwischen dem letzten Punkt eines Abschnitts und dem ersten des
     * nächsten. Sie muss 0 sein: Eine Naht mit Abstand ist ein sichtbarer Riss in der blauen Linie.
     *
     * 💣 Warum das als Spalte mitläuft (WI-0147): Seit die Linie nur noch an Wegpunkte gezogen wird, endet ein Abschnitt
     * dort, wo sein Weg gezeichnet ist. Hängen zwei Wegenden am selben Ort, liegen aber nicht aufeinander, fehlt das
     * Stück zwischen ihnen — früher führte die Linie über den Ortspunkt und war durchgehend (mit Kehrtwende).
     */
    groessteNaht: number;
    /** Wo diese Naht liegt, für die Ausreißerliste. */
    nahtAn: string;
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const database = createDatabase(config.databaseUrl);
const model = AVENTURIA_TRAVEL_MODEL;
const water = await loadWater(database, AVENTURIA.mapDomain);
const terrain = {
    land: await loadLand(database, AVENTURIA.mapDomain),
    rivers: await loadRivers(database, AVENTURIA.mapDomain, model),
};

const netze = new Map<string, { network: RouteNetwork; graph: RouteGraph }>();
for (const variante of VARIANTEN) {
    const network = await loadRouteNetwork(database, AVENTURIA.mapDomain, { endSnap: variante.endSnap });
    netze.set(variante.id, { network, graph: buildRouteGraph(network, model, REQUEST, water) });
    const technisch = [...network.nodes.values()].filter((node) => node.kind === "technical").length;
    console.log(`${variante.id}: ${String(network.nodes.size)} Knoten, davon ${String(technisch)} technische`);
}
await database.end({ timeout: 5 });

const basis = netze.get(AKTUELL) as { network: RouteNetwork; graph: RouteGraph };
const orte = [...basis.network.nodes.values()]
    .filter((node) => node.kind === "place")
    .map((node) => ({ name: node.name, x: node.x, y: node.y }));
const idVonName = new Map<string, string>();
for (const node of basis.network.nodes.values()) {
    if (node.kind === "place" && !idVonName.has(node.name)) idVonName.set(node.name, node.id);
}

/**
 * Die Paare: aus dem Hauptteil des HEUTIGEN Netzes. 🔴 Nur so ist ein „nicht gefunden“ in einer anderen Variante ein echter
 * Rückschritt und nicht bloß ein Ort, der ohnehin abseits liegt.
 */
const next = random(Number(values.seed));
const kandidaten = hauptteil(basis.network, basis.graph);
const faelle: { von: string; nach: string; pflicht: boolean }[] = [];
for (const [von, nach] of PFLICHT) {
    const vonId = idVonName.get(von);
    const nachId = idVonName.get(nach);
    if (vonId === undefined || nachId === undefined) {
        console.log(`Pflichtfall übersprungen, Ort fehlt im Datenstand: ${von} → ${nach}`);
        continue;
    }
    faelle.push({ von: vonId, nach: nachId, pflicht: true });
}
while (faelle.length < Number(values.pairs) + PFLICHT.length) {
    const von = kandidaten[Math.floor(next() * kandidaten.length)] as string;
    const nach = kandidaten[Math.floor(next() * kandidaten.length)] as string;
    if (von === nach) continue;
    faelle.push({ von, nach, pflicht: false });
}

const nameVon = (id: string): string => basis.network.nodes.get(id)?.name ?? id;

function messen(network: RouteNetwork, graph: RouteGraph, fall: { von: string; nach: string }): Messung {
    const ergebnis = findRoute(network, graph, [fall.von, fall.nach], terrain);
    const wegpunkte = new Set([nameVon(fall.von), nameVon(fall.nach)]);
    const linie: [number, number][] = [];
    for (const abschnitt of ergebnis.segments) {
        for (const punkt of abschnitt.geometry.coordinates) {
            const letzter = linie[linie.length - 1];
            if (letzter && letzter[0] === punkt[0] && letzter[1] === punkt[1]) continue;
            linie.push([punkt[0] as number, punkt[1] as number]);
        }
    }
    const erster = ergebnis.segments[0];
    const letzter = ergebnis.segments[ergebnis.segments.length - 1];
    let groessteNaht = 0;
    let nahtAn = "";
    for (let index = 1; index < ergebnis.segments.length; index += 1) {
        const davor = ergebnis.segments[index - 1]?.geometry.coordinates;
        const danach = ergebnis.segments[index]?.geometry.coordinates;
        if (!davor || !danach || davor.length === 0 || danach.length === 0) continue;
        const [ax, ay] = davor[davor.length - 1] as [number, number];
        const [bx, by] = danach[0] as [number, number];
        const abstand = Math.hypot(ax - bx, ay - by);
        if (abstand > groessteNaht) {
            groessteNaht = abstand;
            nahtAn = ergebnis.segments[index - 1]?.to_node ?? "";
        }
    }
    return {
        gefunden: ergebnis.found,
        einheiten: ergebnis.distanceUnits,
        meilen: ergebnis.distanceUnits * MILES,
        stunden: ergebnis.travelHours,
        kehren: ergebnis.found ? kehren(linie, orte, wegpunkte) : [],
        sperrwege: [...new Set(ergebnis.seasonalWays.map((way) => way.path_name))],
        ankerAmRand: (erster?.synthetic ?? false) || (letzter?.synthetic ?? false),
        abschnitte: ergebnis.segments.length,
        groessteNaht,
        nahtAn,
    };
}

const outDirectory = resolve(values.out);
mkdirSync(outDirectory, { recursive: true });

/** Legacys Antwort je Fall, in der Zeilenform des Orakels. */
interface LegacyZeile {
    error?: { message: string };
    route?: {
        found: boolean;
        distance_units: number;
        duration?: { travel_hours: number };
        segments?: { geometry?: { coordinates: [number, number][] } }[];
    };
}
let legacyZeilen: LegacyZeile[] = [];
if (values.legacy) {
    const anfragen = faelle.map((fall) => ({
        from: nameVon(fall.von),
        to: nameVon(fall.nach),
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
    /**
     * 🪤 **Wiederverwendet wird nur, wenn die ANFRAGEN dieselben sind**, nicht bloß gleich viele: Die Paare kommen aus dem
     * Hauptteil des Netzes, und der hängt am Fangradius. Ein anderer Radius kann eine andere Liste ziehen, und dann
     * stünden Legacys Antworten neben den falschen Routen.
     */
    const neuerText = JSON.stringify(anfragen);
    const schonDa =
        values["legacy-wieder"] &&
        existsSync(requestsFile) &&
        existsSync(resultsFile) &&
        readFileSync(requestsFile, "utf8") === neuerText &&
        readFileSync(resultsFile, "utf8").trim().split("\n").length === faelle.length;
    writeFileSync(requestsFile, neuerText);
    const oracle = resolve(import.meta.dirname, "../../../../scripts/dev/legacy-route-oracle/run.mjs");
    if (schonDa) console.log(`${String(faelle.length)} Antworten von Legacy aus dem früheren Lauf.`);
    else console.log(`${String(faelle.length)} Fälle, Legacy rechnet ...`);
    if (!schonDa)
        execFileSync(
            process.execPath,
            [
                oracle,
                "--requests",
                requestsFile,
                "--out",
                resultsFile,
                "--workers",
                values.workers,
                "--database",
                join(outDirectory, "legacy-2026-09-28.sqlite"),
            ],
            { stdio: "inherit" },
        );
    legacyZeilen = readFileSync(resultsFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as LegacyZeile);
}

function legacyMessung(index: number, fall: { von: string; nach: string }): Messung | null {
    const zeile = legacyZeilen[index];
    if (!zeile) return null;
    const route = zeile.route;
    if (!route)
        return {
            gefunden: false,
            einheiten: 0,
            meilen: 0,
            stunden: 0,
            kehren: [],
            sperrwege: [],
            ankerAmRand: false,
            abschnitte: 0,
            groessteNaht: 0,
            nahtAn: "",
        };
    const linie: [number, number][] = [];
    for (const abschnitt of route.segments ?? []) {
        for (const punkt of abschnitt.geometry?.coordinates ?? []) {
            const letzter = linie[linie.length - 1];
            if (letzter && letzter[0] === punkt[0] && letzter[1] === punkt[1]) continue;
            linie.push([punkt[0], punkt[1]]);
        }
    }
    const wegpunkte = new Set([nameVon(fall.von), nameVon(fall.nach)]);
    return {
        gefunden: route.found,
        einheiten: route.distance_units,
        meilen: route.distance_units * MILES,
        stunden: route.duration?.travel_hours ?? 0,
        kehren: route.found ? kehren(linie, orte, wegpunkte) : [],
        sperrwege: [],
        ankerAmRand: false,
        abschnitte: (route.segments ?? []).length,
        groessteNaht: 0,
        nahtAn: "",
    };
}

/** Alle Messungen: je Fall eine Zeile je Variante, dazu Legacy. */
const zeilen = faelle.map((fall, index) => {
    const je = new Map<string, Messung>();
    for (const variante of VARIANTEN) {
        const netz = netze.get(variante.id) as { network: RouteNetwork; graph: RouteGraph };
        je.set(variante.id, messen(netz.network, netz.graph, fall));
    }
    return { fall, index, je, legacy: values.legacy ? legacyMessung(index, fall) : null };
});

const zahl = (value: number, stellen = 1): string => value.toFixed(stellen).replace(".", ",");

/** Die Übersicht je Variante: was der Betreiber zuerst liest. */
function uebersicht(): string {
    const kopf = [
        "| Variante | gefunden | Kehren an Orten | Routen mit Kehre | Meilen zusammen | Stunden zusammen | Anker am Rand | Risse in der Linie |",
        "|---|---|---|---|---|---|---|---|",
    ];
    const reihen = VARIANTEN.map((variante) => {
        const messungen = zeilen.map((zeile) => zeile.je.get(variante.id) as Messung);
        const gefunden = messungen.filter((messung) => messung.gefunden).length;
        const alleKehren = messungen.reduce((summe, messung) => summe + messung.kehren.length, 0);
        const mitKehre = messungen.filter((messung) => messung.kehren.length > 0).length;
        const meilen = messungen.reduce((summe, messung) => summe + messung.meilen, 0);
        const stunden = messungen.reduce((summe, messung) => summe + messung.stunden, 0);
        const anker = messungen.filter((messung) => messung.ankerAmRand).length;
        const risse = messungen.filter((messung) => messung.groessteNaht > 0.001).length;
        return `| ${variante.label} | ${String(gefunden)}/${String(messungen.length)} | ${String(alleKehren)} | ${String(mitKehre)} | ${zahl(meilen, 0)} | ${zahl(stunden, 0)} | ${String(anker)} | ${String(risse)} |`;
    });
    if (values.legacy) {
        const messungen = zeilen.map((zeile) => zeile.legacy).filter((messung): messung is Messung => messung !== null);
        if (messungen.length > 0) {
            const gefunden = messungen.filter((messung) => messung.gefunden).length;
            const alleKehren = messungen.reduce((summe, messung) => summe + messung.kehren.length, 0);
            const mitKehre = messungen.filter((messung) => messung.kehren.length > 0).length;
            const meilen = messungen.reduce((summe, messung) => summe + messung.meilen, 0);
            const stunden = messungen.reduce((summe, messung) => summe + messung.stunden, 0);
            reihen.push(
                `| Legacy (Snapshot 2026-09-28) | ${String(gefunden)}/${String(messungen.length)} | ${String(alleKehren)} | ${String(mitKehre)} | ${zahl(meilen, 0)} | ${zahl(stunden, 0)} | - | - |`,
            );
        }
    }
    return [...kopf, ...reihen].join("\n");
}

/** Die Pflichtfälle einzeln: die Routen, die der Betreiber und der Editor gemeldet haben. */
function pflichttabelle(): string {
    const kopf = [
        `| Route | Variante | Meilen | Stunden | Kehren | Orte der Kehren | Sperrung |`,
        "|---|---|---|---|---|---|---|",
    ];
    const reihen: string[] = [];
    for (const zeile of zeilen.filter((kandidat) => kandidat.fall.pflicht)) {
        const route = `${nameVon(zeile.fall.von)} → ${nameVon(zeile.fall.nach)}`;
        const legacy = zeile.legacy;
        if (legacy) {
            reihen.push(
                `| ${route} | Legacy | ${zahl(legacy.meilen, 0)} | ${zahl(legacy.stunden)} | ${String(legacy.kehren.length)} | ${[...new Set(legacy.kehren.map((kehre) => kehre.ort))].join(", ")} | - |`,
            );
        }
        for (const variante of VARIANTEN) {
            const messung = zeile.je.get(variante.id) as Messung;
            reihen.push(
                `| ${route} | ${variante.id} | ${messung.gefunden ? zahl(messung.meilen, 0) : "nicht gefunden"} | ${zahl(messung.stunden)} | ${String(messung.kehren.length)} | ${[...new Set(messung.kehren.map((kehre) => kehre.ort))].join(", ")} | ${messung.sperrwege.length > 0 ? messung.sperrwege.join(", ") : "nein"} |`,
            );
        }
    }
    return [...kopf, ...reihen].join("\n");
}

/**
 * Die Ausreißer der GELTENDEN Variante, nicht die des Bestands: Was bleibt übrig, wenn die Änderung gilt?
 * Vorgelegt werden NAMEN, keine Tabellen (Betreiber 2026-10-05: „nur absurd komische zahlen sollten dann zur überprüfung
 * vorgelegt werden“). Je Ausreißer steht dabei, ob eine Sperrung im Spiel ist (Betreiber 2026-10-14: „sie soll das immer
 * überprüfen, ja, auf jeden fall“).
 */
function ausreisser(): string {
    const teile: string[] = [];
    const empfohlen = (zeile: (typeof zeilen)[number]): Messung => zeile.je.get(AKTUELL) as Messung;

    const gegenLegacy = zeilen
        .filter((zeile) => {
            const legacy = zeile.legacy;
            const messung = empfohlen(zeile);
            return (
                legacy?.gefunden === true &&
                messung.gefunden &&
                legacy.meilen > 0 &&
                messung.meilen > 1.5 * legacy.meilen
            );
        })
        .map((zeile) => {
            const messung = empfohlen(zeile);
            const legacy = zeile.legacy as Messung;
            return {
                text: `- **${nameVon(zeile.fall.von)} → ${nameVon(zeile.fall.nach)}**: ${zahl(messung.meilen, 0)} Meilen gegen Legacys ${zahl(legacy.meilen, 0)} (Faktor ${zahl(messung.meilen / legacy.meilen, 2)}) · Sperrung: ${messung.sperrwege.length > 0 ? messung.sperrwege.join(", ") : "nein"}`,
                faktor: messung.meilen / legacy.meilen,
            };
        })
        .sort((a, b) => b.faktor - a.faktor);
    teile.push("### Deutlich weiter als Legacy (über 1,5 mal)", "");
    teile.push(gegenLegacy.length > 0 ? gegenLegacy.map((eintrag) => eintrag.text).join("\n") : "Keine.");

    // Die engste gemessene Stufe ist der Maßstab für „geht verloren“ - ohne `--fang` ist das 0,001.
    const engste = [...VARIANTEN].sort((a, b) => a.endSnap - b.endSnap)[0] as Variante;
    const verloren = zeilen.filter((zeile) => {
        const eng = zeile.je.get(engste.id) as Messung;
        return eng.gefunden && !empfohlen(zeile).gefunden;
    });
    const legacyFindet = zeilen.filter((zeile) => zeile.legacy?.gefunden === true && !empfohlen(zeile).gefunden);
    teile.push("", "### Routen, die verloren gehen", "");
    teile.push(
        [
            `- gegen den Fangradius ${String(engste.endSnap).replace(".", ",")}: ${String(verloren.length)}${verloren.length > 0 ? ` (${verloren.map((zeile) => `${nameVon(zeile.fall.von)} → ${nameVon(zeile.fall.nach)}`).join(", ")})` : ""}`,
            `- gegen Legacy: ${String(legacyFindet.length)}${legacyFindet.length > 0 ? ` (${legacyFindet.map((zeile) => `${nameVon(zeile.fall.von)} → ${nameVon(zeile.fall.nach)}`).join(", ")})` : ""}`,
        ].join("\n"),
    );

    const risse = zeilen
        .filter((zeile) => empfohlen(zeile).groessteNaht > 0.001)
        .map((zeile) => ({ zeile, naht: empfohlen(zeile).groessteNaht }))
        .sort((a, b) => b.naht - a.naht);
    teile.push("", "### Risse in der gezeichneten Linie", "");
    teile.push(
        risse.length === 0
            ? "Keine: Jede Naht zwischen zwei Abschnitten schließt auf 0,001 genau."
            : risse
                  .slice(0, 15)
                  .map(
                      ({ zeile, naht }) =>
                          `- **${nameVon(zeile.fall.von)} → ${nameVon(zeile.fall.nach)}**: ${zahl(naht, 4)} Einheiten an ${empfohlen(zeile).nahtAn || "einem Knoten ohne Namen"}`,
                  )
                  .join("\n"),
    );

    /** Wo nach der Änderung noch gekehrt wird, und ob Legacy an derselben Stelle auch kehrt. */
    const zaehlen = (waehlen: (zeile: (typeof zeilen)[number]) => Messung | null): Map<string, number> => {
        const map = new Map<string, number>();
        for (const zeile of zeilen)
            for (const kehre of waehlen(zeile)?.kehren ?? []) map.set(kehre.ort, (map.get(kehre.ort) ?? 0) + 1);
        return map;
    };
    const unsere = zaehlen(empfohlen);
    const legacys = zaehlen((zeile) => zeile.legacy);
    const gemeinsam = [...unsere.keys()].filter((ort) => (legacys.get(ort) ?? 0) > 0);
    const summe = [...unsere.values()].reduce((a, b) => a + b, 0);
    const auchLegacy = gemeinsam.reduce((sum, ort) => sum + (unsere.get(ort) ?? 0), 0);
    teile.push("", "### Kehrtwenden, die übrig bleiben", "");
    teile.push(
        `${String(summe)} an ${String(unsere.size)} Orten; davon ${String(auchLegacy)} an Orten, an denen **Legacy auch kehrt** (dort ist es die Karte, nicht die Rechnung).`,
        "",
        "| Ort | wir | Legacy |",
        "|---|---|---|",
        ...[...unsere.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([ort, anzahl]) => `| ${ort} | ${String(anzahl)} | ${String(legacys.get(ort) ?? 0)} |`),
    );
    return teile.join("\n");
}

const bericht = [
    `# Topologievergleich: ${String(faelle.length - PFLICHT.length)} zufällige Routen, ${String(VARIANTEN.length)} Varianten und Legacy`,
    "",
    `Stand ${new Date().toISOString().slice(0, 10)}, Datenstand der lokalen Entwicklungsdatenbank, Seed ${values.seed}, ${String(faelle.length)} Routen (${String(PFLICHT.length)} davon Pflichtfälle aus den Meldungen).`,
    "",
    `Alle ${String(VARIANTEN.length)} Varianten rechnen auf demselben Datenstand und sind deshalb exakt vergleichbar. Legacy rechnet gegen`,
    `seinen Snapshot (${values.snapshot.split("/").slice(-2, -1).join("")}) und ist der Maßstab für „ist diese Route plausibel“, nicht für die Stelle hinter dem Komma.`,
    "",
    "## Übersicht",
    "",
    uebersicht(),
    "",
    "## Die gemeldeten Routen",
    "",
    pflichttabelle(),
    "",
    "## Ausreißer",
    "",
    ausreisser(),
    "",
].join("\n");

const berichtDatei = join(outDirectory, "bericht.md");
writeFileSync(berichtDatei, bericht);
writeFileSync(
    join(outDirectory, "zeilen.json"),
    JSON.stringify(
        zeilen.map((zeile) => ({
            von: nameVon(zeile.fall.von),
            nach: nameVon(zeile.fall.nach),
            pflicht: zeile.fall.pflicht,
            legacy: zeile.legacy,
            varianten: Object.fromEntries([...zeile.je].map(([id, messung]) => [id, messung])),
        })),
        null,
        1,
    ),
);
console.log(bericht);
console.log(`\nBericht: ${berichtDatei}`);
