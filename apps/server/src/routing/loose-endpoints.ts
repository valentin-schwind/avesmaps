import { AVENTURIA, type Wegfindungswerte } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";
import { netzOptionen, WEGFINDUNG_VORGABEN } from "./einstellungen.ts";
import {
    buildTopologyNetwork,
    createEndpointAttacher,
    loadRouteGraphRows,
    storedLine,
    type PathRow,
    type RouteNode,
} from "./network.ts";
import { contactFinder } from "./topology.ts";

/**
 * Lose Wegenden: WO ein Wegende an einem Knoten hängt, der nicht dort steht, wo der Weg endet.
 *
 * 🔴 Befund vom 2026-10-06 (`project-control/discovery/route-gareth-alfenmohn-haken-2026-10-06.md`).
 * Ein Wegende hängt am nächsten Ort im Kasten `ENDPOINT_BOX` (0,5 E) — wörtlich Legacys Regel. Wird
 * der Ort, an dem das Ende wirklich sitzt, gelöscht, hängt das Ende an einem anderen, und
 * der Sprung dorthin kostet im Graphen NICHTS: die Route springt durch die Luft, die Strecke wird zu
 * kurz angegeben, und ein kurzer Verbindungsweg kann mit beiden Enden am selben Knoten landen und ganz
 * aus dem Netz fallen.
 *
 * Seit WI-0132 Release N rechnet es auf der Topologie ohne Kreuzungen (`topology.ts`): Ein technischer Knoten liegt
 * genau auf seinen Wegenden, ein Sprung entsteht nur noch am Ort. Ein Wegende, das weder Ort noch Weg trifft, ist eine
 * Sackgasse und KEIN loses Ende; diese Stellen zeigt der Prüfhaken „Wege treffen sich nicht“ (`topology-findings.ts`),
 * hier stehen sie nur als Zahl. Gestrichen ist der Grund „Ende ohne Knoten“: Kein Weg fällt mehr deshalb heraus.
 *
 * 🔴 Repariert wird nach dem Cutoff in Production im Wegeeditor (Betreiber 2026-10-10, WI-0132 §6), nicht in Legacy.
 * Dieses Modul MISST nur und schreibt nie; es ist die eine Quelle für die Redaktionsliste (`npm run ops:lose-wegenden`),
 * den Befund in `verify:paths` und den Prüfhaken „Offene Wegenden“.
 *
 * 💣 Die Topologie wird nicht nachgebaut, sondern gerufen (`buildTopologyNetwork`, dieselbe Ableitung wie im Router),
 * und das Urteil „fällt ganz aus dem Netz“ kommt aus dem Netz selbst, nicht aus einer zweiten Rechnung.
 * Legacy hat die Lehre dazu an derselben Regel aufgeschrieben: 541 von 11.662 Endpunkten gingen beim
 * Abschreiben an den falschen Ort.
 */

/**
 * Ab wann ein Wegende „lose“ heißt. 🪤 Das ist KEIN zweiter Grenzwert neben `ENDPOINT_BOX`: Der Kasten
 * entscheidet, OB ein Ende hängt (Legacys Regel, unverändert), diese Zahl nur, ab wann der Abstand
 * berichtenswert ist. Sie stammt aus dem Befund (281 von 19.372 Enden über 0,05 E) und urteilt über
 * nichts.
 */
export const LOOSE_DISTANCE = 0.05;

/** Ein stillgelegter Ort: ein möglicher gelöschter Knoten. Kreuzungen sind seit Release N keine Knoten mehr. */
export interface RetiredNode {
    publicId: string;
    /** Der Name, unter dem Legacy ihn führte. */
    name: string;
    /** Die Ortsklasse. */
    subtype: string | null;
    x: number;
    y: number;
    /**
     * Wann wir ihn stillgelegt haben. 🪤 `place` führt KEIN `retired_at`; das ist `updated_at`, also der Zug, in dem der
     * Import ihn stillgelegt hat — nicht der Tag, an dem ein Editor in Legacy gelöscht hat.
     */
    retiredOn: string | null;
}

/** Ein Wegende, das an einem Knoten hängt, der mehr als `LOOSE_DISTANCE` entfernt steht. */
export interface LooseEnd {
    pathPublicId: string;
    pathName: string;
    subtype: string;
    /** Anfang oder Ende des ganzen Weges; `innen` an einem Teilungspunkt (kann praktisch nicht lose sein). */
    which: "anfang" | "ende" | "innen";
    /** Wo der Weg geometrisch endet. */
    x: number;
    y: number;
    /** Der Knoten, an dem er heute hängt (praktisch immer ein Ort: Ein technischer Knoten liegt genau auf dem Ende). */
    nodeId: string;
    nodeKind: RouteNode["kind"];
    nodeName: string;
    nodeX: number;
    nodeY: number;
    /** Der Sprung in Karteneinheiten, den die Route umsonst macht. */
    distance: number;
    /**
     * Der stillgelegte Knoten, an dem dieses Ende hinge, wäre er noch aktiv — gemessen, indem dieselbe
     * Endpunktsuche über aktive UND stillgelegte Knoten läuft. Fehlt, wenn dort nie einer stand.
     */
    retired: RetiredNode | null;
}

/**
 * Ein Weg, der im Graphen überhaupt keine Kante erzeugt: Beide Enden und jede Teilung hängen am selben Knoten. Den
 * früheren zweiten Grund („Ende ohne Knoten“) gibt es seit Release N nicht mehr; ein solches Ende ist eine Sackgasse.
 */
export interface DetachedPath {
    pathPublicId: string;
    pathName: string;
    subtype: string;
    reason: "beide_enden_am_selben_knoten";
    /** Der Knoten, an dem beide Enden hängen. */
    nodeId: string;
    nodeName: string;
    /** Der stillgelegte Knoten, an dem sein Anfang hinge — die Brücke zu Rang 1. */
    retired: RetiredNode | null;
    x: number;
    y: number;
}

/** Der nächste Ort, der groß genug ist, um eine Gegend zu benennen. */
export interface NearestPlace {
    name: string;
    subtype: string;
    distance: number;
}

/** Eine Stelle: ein Punkt der Karte, an dem ein oder mehrere Wegenden lose hängen. */
export interface LooseSpot {
    /** Stabiler Schlüssel: der stillgelegte Knoten, sonst der gerundete Punkt. */
    key: string;
    /**
     * Der Punkt, auf den der Knoten gehört: wo die Wegenden wirklich zusammenlaufen. 🪤 NICHT die
     * Stelle des gelöschten Knotens — der stand oft ein paar Tausendstel daneben.
     */
    x: number;
    y: number;
    /** Der stillgelegte Knoten dieser Stelle, falls es einen gibt. */
    retired: RetiredNode | null;
    /** Der nächste nennenswerte Ort, damit die Stelle einen Namen hat statt nur Zahlen. */
    nearest: NearestPlace | null;
    ends: LooseEnd[];
    /** Wege, die hier ganz aus dem Netz fallen (Teilmenge von `detached`). */
    detached: DetachedPath[];
    /** 1 = Ende auf stillgelegtem Knoten, 3 = sonstiger loser Stoß. Rang 2 ist eine eigene Liste. */
    rank: 1 | 3;
}

export interface LooseEndpointReport {
    mapDomainId: string;
    /**
     * Mit welchen Abständen gemessen wurde (WI-0214): „lose“ ab `looseDistance`, der Ortskasten `endpointBox`. Die
     * eingestellten Werte der Wegfindung, nicht die Vorgaben; der Befund nennt sie, damit er sagt, wonach er misst.
     */
    looseDistance: number;
    endpointBox: number;
    /** Alle Kantenenden im Netz (zwei je Weg mit Knoten an beiden Enden). */
    endpointsTotal: number;
    /**
     * Wegenden über `LOOSE_DISTANCE` neben ihrem Ort OHNE genauen Wegkontakt: die Stellen für die Redaktion. 🔴 Entscheidung B der
     * Koordination 2026-10-10 (WI-0132 §10.6): Ein Ende, das genau auf einem anderen Ende oder Weg liegt und nur wegen „Ort zuerst“
     * zum Ort springt, ist ein Treffpunkt, den der Ortskasten aufnimmt; es steht nur in `absorbed`.
     */
    loose: LooseEnd[];
    /** Wegenden über `LOOSE_DISTANCE` neben ihrem Ort, die genauen Wegkontakt haben: nur als Zahl (Entscheidung B). */
    absorbed: number;
    /** Rang 1: Stellen mit stillgelegtem Ort. */
    retiredSpots: LooseSpot[];
    /** Rang 3: lose Stöße ohne stillgelegten Ort. */
    otherSpots: LooseSpot[];
    /**
     * Wege ohne jede Kante: Alle Stücke hängen an einem Ort (meist ein kurzer Weg ganz im Ortskasten). Seit Entscheidung B nur
     * als Zahl gemeldet, nicht als Stelle; die Liste bleibt für Werkzeuge und Tests.
     */
    detached: DetachedPath[];
    /**
     * Wegenden, die weder Ort noch Weg treffen (Sackgassen der Topologie). Kein loses Ende: Ihre Stellen zeigt der Prüfhaken
     * „Wege treffen sich nicht“; hier stehen sie nur als Zahl, damit der Befund das ganze Bild nennt.
     */
    deadEnds: number;
    /** Der Wiki-Key je Kartenobjekt (`public_id` → Key und Adresse), soweit Legacy einen zuweist. */
    wikiKeys: Map<string, { key: string; url: string | null }>;
}

/** Legacys Schlüssel für einen Punkt: fünf Stellen, wie `exactKey` im Netz. */
const pointKey = (x: number, y: number): string => `${x.toFixed(5)}:${y.toFixed(5)}`;

/**
 * Welche Ortsklasse wie weit trägt, in Karteneinheiten. Ein Gehöft taugt nicht als Wegmarke, eine
 * Metropole benennt die ganze Gegend: „im Großraum Gareth“ sagt mehr als „1,4 E von Possel“, obwohl
 * Possel näher liegt. Die Reichweiten sind eine Darstellungsentscheidung dieses Berichts und urteilen
 * über nichts (IMPLEMENTATION DETAIL); gemessen wird mit ihnen keine Karteneigenschaft.
 */
const NAMING_REACH: readonly [subtype: string, reach: number][] = [
    ["metropole", 8],
    ["grossstadt", 5],
    ["stadt", 3],
    ["kleinstadt", 1.5],
];

/** Der Ort, der diese Gegend benennt: die größte Klasse, die noch hierher reicht; sonst die nächste überhaupt. */
function nearestPlace(nodes: readonly RouteNode[], x: number, y: number): NearestPlace | null {
    let fallback: NearestPlace | null = null;
    for (const [subtype, reach] of NAMING_REACH) {
        let best: NearestPlace | null = null;
        for (const node of nodes) {
            if (node.kind !== "place" || node.subtype !== subtype) continue;
            const distance = Math.hypot(node.x - x, node.y - y);
            if (best === null || distance < best.distance) best = { name: node.name, subtype, distance };
        }
        if (best === null) continue;
        if (best.distance <= reach) return best;
        if (fallback === null || best.distance < fallback.distance) fallback = best;
    }
    return fallback;
}

/**
 * Die Adresse einer Stelle in Legacys Oberfläche: der dokumentierte Pin-Deep-Link.
 *
 * 🔴 `?pin=<lat>,<lng>` mit drei Nachkommastellen, gelesen von `readSharePinFromUrl`
 * (`js/map-features/map-features-layer-state.js`) und von `avesmapsInitialViewFromSharePin`
 * (`js/app/bootstrap.js`, der Pin schlägt den gespeicherten Editor-Ausschnitt). Legacys Karte ist
 * `L.CRS.Simple` mit `MAP_BOUNDS [[0,0],[1024,1024]]`, also **lat = y und lng = x** — dieselben Zahlen
 * wie bei uns (`config/map-domains/aventuria.json`). `?edit=1` schaltet den Editor frei
 * (`IS_EDIT_MODE`, `js/config.js`), `togglePaths` und `toggleCrossings` zeigen Wege und Kreuzungen
 * (Vorgaben `false`, `DEFAULT_PLANNER_STATE`).
 */
export function legacySpotUrl(x: number, y: number): string {
    const pin = `${y.toFixed(3)},${x.toFixed(3)}`;
    return `https://avesmaps.de/?edit=1&pin=${encodeURIComponent(pin)}&togglePaths=1&toggleCrossings=1`;
}

/**
 * Die Adresse eines WEGES in Legacy: der Wiki-Deep-Link seines Artikels.
 *
 * 🪤 Es gibt keine andere. `?place=<publicId>` löst nur Siedlungen und Landschaftsbeschriftungen auf —
 * „Wege sind nicht über ?place= auflösbar“ steht wörtlich in `map-features-path-rendering.js`. Ein Weg
 * ohne Wiki-Artikel hat damit **keine eigene Adresse**; für ihn bleibt die Adresse der Stelle.
 * Parameter nach Wegart: Flussweg und Seeweg `fluss`, sonst `strasse` (`js/app/wiki-deeplink.js`).
 */
export function legacyPathUrl(subtype: string, wikiUrl: string | null): string | null {
    if (!wikiUrl) return null;
    const page = /\/wiki\/([^?#]+)/i.exec(wikiUrl);
    if (!page?.[1]) return null;
    const parameter = subtype === "Flussweg" || subtype === "Seeweg" ? "fluss" : "strasse";
    return `https://avesmaps.de/?${parameter}=${page[1]}`;
}

// 🪤 Eine Adresse für den GELÖSCHTEN Knoten gibt es bewusst nicht. Legacy kennt ihn nicht mehr:
// `?siedlung=` fände keinen Artikel, `?place=<publicId>` keinen Ort. Ein Link, der nichts öffnet, wäre
// schlimmer als keiner — er sähe nach einem Weg aus. Die Stelle führt den Redakteur hin, der gelöschte
// Knoten steht mit Name, Art, Kennung und Stilllegungstag daneben.

interface RetiredRow {
    id: string;
    name: string;
    subtype: string | null;
    x: number;
    y: number;
    retired_on: string | null;
}

/** Liest die stillgelegten Orte — die möglichen gelöschten Knoten. Die Tabelle `crossing` liest es nicht mehr. */
async function loadRetiredNodes(database: Queryable, mapDomainId: string): Promise<RetiredRow[]> {
    return database<RetiredRow[]>`
        SELECT public_id::text AS id, name, subtype,
               ST_X(geom) AS x, ST_Y(geom) AS y, to_char(updated_at, 'YYYY-MM-DD') AS retired_on
        FROM place
        WHERE map_domain_id = ${mapDomainId} AND NOT is_active
        ORDER BY id
    `;
}

/** Die Wiki-Keys der Wege und Orte (Legacy-Export X2). Ohne Tabelle (alter Stand) eine leere Karte. */
async function loadWikiKeys(
    database: Queryable,
    mapDomainId: string,
): Promise<Map<string, { key: string; url: string | null }>> {
    void mapDomainId; // `wiki_key_assignment` kennt keine Domäne: Legacys Zuordnung ist global.
    const rows = await database<{ id: string; wiki_key: string; wiki_url: string | null }[]>`
        SELECT object_public_id::text AS id, wiki_key, wiki_url
        FROM wiki_key_assignment
        WHERE is_active AND legacy_art IN ('weg', 'siedlung')
    `;
    return new Map(rows.map((row) => [row.id, { key: row.wiki_key, url: row.wiki_url }]));
}

/**
 * Misst die losen Wegenden aus einem gegebenen Bestand. Reine Rechnung ohne Datenbank, damit ein Test
 * sie mit einer Handvoll Knoten und Wegen fahren kann.
 */
export function measureLooseEndpoints(
    places: RouteNode[],
    paths: PathRow[],
    retiredNodes: RetiredNode[],
    options: {
        mapDomainId?: string;
        wikiKeys?: Map<string, { key: string; url: string | null }>;
        /** Die wirksamen Kenngrößen der Wegfindung (WI-0214); ohne Angabe die Vorgaben. Dieselben wie im Router. */
        werte?: Wegfindungswerte;
    } = {},
): LooseEndpointReport {
    const werte = options.werte ?? WEGFINDUNG_VORGABEN;
    const netz = netzOptionen(werte);
    // Dieselbe Suche noch einmal über aktive UND stillgelegte Orte: Sie beantwortet „woran hinge
    // dieses Ende, stünde der gelöschte Ort noch?“ mit der Regel, die den Fehler erzeugt hat.
    const retiredById = new Map(retiredNodes.map((node) => [node.publicId, node]));
    const withRetired = createEndpointAttacher(
        [
            ...places,
            ...retiredNodes.map((node): RouteNode => ({
                id: node.publicId,
                name: node.name,
                kind: "place",
                isHidden: false,
                x: node.x,
                y: node.y,
            })),
        ],
        { endpointBox: netz.endpointBox, exactHit: netz.exactHit },
    );

    const loose: LooseEnd[] = [];
    const detached: DetachedPath[] = [];

    // 🔴 Gemessen werden KANTENENDEN, nicht Wegenden — dieselbe Größe wie im Befund (19.372 gegen
    // 9.506 Wege). Eine Kante ist das Stück zwischen zwei Knoten; ein an Innenpunkten geteilter Weg
    // trägt mehrere. Der Unterschied ist nicht kosmetisch: Ein Weg, dessen beide Enden am selben
    // Knoten hängen, erzeugt GAR KEINE Kante, seine Enden stehen also in dieser Zahl nicht — er ist
    // Rang 2 und wird dort einmal gezählt, nicht zweimal.
    //
    // Das Urteil „fällt ganz aus dem Netz“ kommt aus dem Netz selbst, nicht aus einer Nebenrechnung.
    const { network, topology } = buildTopologyNetwork(places, paths, netz);
    const withLinks = new Set(network.links.map((link) => link.pathPublicId));
    const planOf = new Map(topology.plans.map((plan) => [plan.publicId, plan]));
    const endpointsTotal = network.links.length * 2;
    // Entscheidung B (Koordination 2026-10-10, WI-0132 §10.6): genauer Wegkontakt mit derselben Regel wie im Router.
    const touches = contactFinder(paths.map((path) => ({ publicId: path.public_id, coordinates: storedLine(path) })));
    let absorbed = 0;

    for (const link of network.links) {
        const line = network.paths.get(link.pathPublicId);
        const first = link.coordinates[0];
        const last = link.coordinates[link.coordinates.length - 1];
        if (!first || !last) continue;
        // 🪤 Ein Innenpunkt, an dem geteilt wurde, liegt auf fünf Stellen GENAU auf seinem Knoten; er
        // kann nie lose sein. Für die Redaktion zählt trotzdem, ob das lose Ende der Anfang oder das
        // Ende des ganzen Weges ist — danach sucht ein Editor auf der Karte.
        const istAnfang = (point: [number, number]): boolean =>
            line !== undefined && pointKey(point[0], point[1]) === pointKey(line[0]?.[0] ?? NaN, line[0]?.[1] ?? NaN);
        const istEnde = (point: [number, number]): boolean =>
            line !== undefined &&
            pointKey(point[0], point[1]) ===
                pointKey(line[line.length - 1]?.[0] ?? NaN, line[line.length - 1]?.[1] ?? NaN);
        for (const [point, nodeId] of [
            [first, link.from],
            [last, link.to],
        ] as [[number, number], string][]) {
            const node = network.nodes.get(nodeId);
            if (!node) continue;
            const distance = Math.hypot(node.x - point[0], node.y - point[1]);
            if (distance <= werte.looseDistance) continue;
            // Ein Treffpunkt, den der Ortskasten aufnimmt: verbunden, nur gezählt.
            if (touches(point)) {
                absorbed += 1;
                continue;
            }
            const wouldBe = withRetired.at(point);
            const retired = wouldBe ? (retiredById.get(wouldBe.id) ?? null) : null;
            loose.push({
                pathPublicId: link.pathPublicId,
                pathName: link.pathName,
                subtype: link.subtype,
                which: istAnfang(point) ? "anfang" : istEnde(point) ? "ende" : "innen",
                x: point[0],
                y: point[1],
                nodeId: node.id,
                nodeKind: node.kind,
                nodeName: node.name,
                nodeX: node.x,
                nodeY: node.y,
                distance,
                retired,
            });
        }
    }

    for (const path of paths) {
        if (withLinks.has(path.public_id)) continue;
        const plan = planOf.get(path.public_id);
        const first = plan?.coordinates[0];
        if (!plan || !first) continue;
        // 🪤 Gegenprobe: Seit jedes Ende einen Knoten hat (Ort, Kontakt oder Sackgasse), fällt ein Weg nur noch heraus,
        // wenn alle seine Stücke am selben Knoten beginnen und enden. Alles andere wäre ein Fehler des Netzes.
        if (plan.start !== plan.end || plan.splits.some((split) => split.nodeId !== plan.start)) {
            throw new Error(`Weg ohne Kante, aber nicht an einem einzigen Knoten: ${path.public_id}`);
        }
        const wouldBe = withRetired.at(first);
        detached.push({
            pathPublicId: path.public_id,
            pathName: path.name,
            subtype: path.subtype,
            reason: "beide_enden_am_selben_knoten",
            nodeId: plan.start,
            nodeName: network.nodes.get(plan.start)?.name ?? "",
            retired: wouldBe ? (retiredById.get(wouldBe.id) ?? null) : null,
            x: first[0],
            y: first[1],
        });
    }

    loose.sort((a, b) => b.distance - a.distance);

    // Stellen bilden: über den stillgelegten Knoten, sonst über den Punkt (fünf Stellen, wie im Netz).
    const spots = new Map<string, LooseSpot>();
    for (const end of loose) {
        const key = end.retired ? `knoten:${end.retired.publicId}` : `punkt:${pointKey(end.x, end.y)}`;
        const spot = spots.get(key) ?? {
            key,
            x: end.x,
            y: end.y,
            retired: end.retired,
            nearest: null,
            ends: [],
            detached: [],
            rank: end.retired ? 1 : 3,
        };
        spot.ends.push(end);
        spots.set(key, spot);
    }
    // Der Punkt der Stelle ist der, auf dem die MEISTEN Enden liegen — nicht der des gelöschten
    // Knotens: Dort soll der neue Knoten hin, und die Enden liegen schon dort.
    for (const spot of spots.values()) {
        const haeufigkeit = new Map<string, { x: number; y: number; n: number }>();
        for (const end of spot.ends) {
            const key = pointKey(end.x, end.y);
            const seen = haeufigkeit.get(key) ?? { x: end.x, y: end.y, n: 0 };
            seen.n += 1;
            haeufigkeit.set(key, seen);
        }
        const beste = [...haeufigkeit.values()].sort((a, b) => b.n - a.n)[0];
        if (beste) {
            spot.x = beste.x;
            spot.y = beste.y;
        }
        spot.nearest = nearestPlace(places, spot.x, spot.y);
    }
    // Ein aus dem Netz gefallener Weg gehört zu der Stelle, an der sein gelöschter Knoten stand — das
    // ist die Überschneidung zwischen Rang 1 und Rang 2. Er hat selbst KEIN loses Kantenende (er hat
    // ja gar keine Kante), deshalb führt der Weg über den stillgelegten Knoten, nicht über die Enden.
    for (const path of detached) {
        if (!path.retired) continue;
        spots.get(`knoten:${path.retired.publicId}`)?.detached.push(path);
    }

    const byDistance = (a: LooseSpot, b: LooseSpot): number =>
        Math.max(...b.ends.map((end) => end.distance)) - Math.max(...a.ends.map((end) => end.distance));
    const all = [...spots.values()];
    return {
        mapDomainId: options.mapDomainId ?? AVENTURIA.mapDomain,
        looseDistance: werte.looseDistance,
        endpointBox: werte.endpointBox,
        endpointsTotal,
        loose,
        retiredSpots: all.filter((spot) => spot.rank === 1).sort(byDistance),
        otherSpots: all.filter((spot) => spot.rank === 3).sort(byDistance),
        detached,
        absorbed,
        deadEnds: topology.ends.filter((end) => end.contact === "offen").length,
        wikiKeys: options.wikiKeys ?? new Map(),
    };
}

/** Liest den Bestand und misst. Reiner Lesepfad: keine einzige Schreibanweisung. */
export async function loadLooseEndpoints(
    database: Queryable,
    mapDomainId: string = AVENTURIA.mapDomain,
): Promise<LooseEndpointReport> {
    const { places, paths } = await loadRouteGraphRows(database, mapDomainId);
    const retiredRows = await loadRetiredNodes(database, mapDomainId);
    const wikiKeys = await loadWikiKeys(database, mapDomainId);
    const retired: RetiredNode[] = retiredRows.map((row) => ({
        publicId: row.id,
        name: row.name,
        subtype: row.subtype,
        x: row.x,
        y: row.y,
        retiredOn: row.retired_on,
    }));
    // Die eingestellten Werte, wie der Router sie rechnet (WI-0214): Der Prüfhaken im Auge und `verify:paths` lesen sie
    // über dieselbe Lesestelle, nicht über `werte()` — das ist der Zustand des Routing-Workers, nicht dieses Prozesses.
    const werte = await wegfindungswerte(database);
    return measureLooseEndpoints(places, paths, retired, { mapDomainId, wikiKeys, werte });
}

/** Die Form, in der `verify:paths` eine Prüfung führt (strukturgleich mit `ParityCheck`). */
export interface LooseEndpointCheck {
    name: "wegenden_am_knoten";
    passed: boolean;
    detail: string;
    offenders: string[];
}

/**
 * Der Befund für `verify:paths` (Betreiberentscheidung 2026-10-06: „ja, bau C auch ein“).
 *
 * 🔴 Er HÄLT NICHTS AN: `wegenden_am_knoten` steht nicht in `BLOCKING_CHECKS` und soll dort nicht
 * stehen (Betreiber 2026-10-03). `settleChecks` macht aus dem Ausfall einen Befund, das Urteil des
 * Prüfers bleibt grün — eine redaktionelle Lücke in den Daten ist kein Grund, unseren Import anzuhalten.
 *
 * 💣 Er nennt, WAS er sieht, nicht nur DASS er etwas sieht. Dieselbe Lehre wie bei `verify:runs` und
 * `verify:path-runs` (2026-10-06): Eine Prüfung, die „281 lose Enden“ sagt und keine Stelle nennt, ist
 * für die Redaktion wertlos. Jede Stelle steht hier mit Punkt, Wegen und Kennungen — Rang 1 (Ende an
 * einem stillgelegten Ort) zuerst, dann die übrigen. Nur als Zahl (Entscheidung B der Koordination 2026-10-10, WI-0132
 * §10.6): die Treffpunkte, die der Ortskasten aufnimmt, die Wege ohne Kante und die Sackgassen (deren Stellen zeigt der
 * Prüfhaken „Wege treffen sich nicht“).
 *
 * Reine Funktion über den Bericht, damit ein Test sie ohne Datenbank fahren kann.
 */
export function looseEndpointCheck(report: LooseEndpointReport): LooseEndpointCheck {
    const einheit = (value: number): string => value.toFixed(3).replace(".", ",");
    const name = (value: string): string => (value.trim() === "" ? "(ohne Namen)" : value);
    const spotLine = (spot: LooseSpot, rank: string): string => {
        const maximum = Math.max(...spot.ends.map((end) => end.distance));
        const wege = spot.ends.map((end) => `${name(end.pathName)} ${end.pathPublicId}`).join(", ");
        return (
            `${rank} (${einheit(spot.x)} | ${einheit(spot.y)}): ${String(spot.ends.length)} ` +
            `${spot.ends.length === 1 ? "Wegende" : "Wegenden"}, bis ${einheit(maximum)} E neben ` +
            `${spot.ends[0]?.nodeId ?? "?"}` +
            (spot.retired === null ? "" : `, stillgelegt: ${spot.retired.name} ${spot.retired.publicId}`) +
            ` — ${wege}`
        );
    };
    const onRetired = report.retiredSpots.reduce((sum, spot) => sum + spot.ends.length, 0);
    return {
        name: "wegenden_am_knoten",
        passed: report.loose.length === 0,
        detail:
            `${String(report.loose.length)} von ${String(report.endpointsTotal)} Kantenenden hängen ohne genauen ` +
            `Wegkontakt über ${String(report.looseDistance).replace(".", ",")} E neben ihrem Ort; ${String(onRetired)} davon an ` +
            `${String(report.retiredSpots.length)} stillgelegten Orten. Nur gezählt: ${String(report.absorbed)} ` +
            `Treffpunkte im Ortskasten, ${String(report.detached.length)} Wege ohne Kante, ${String(report.deadEnds)} ` +
            "Sackgassen (Prüfhaken „Wege treffen sich nicht“; Arbeitsliste: npm run ops:lose-wegenden)",
        offenders: [
            ...report.retiredSpots.map((spot) => spotLine(spot, "RANG 1")),
            ...report.otherSpots.map((spot) => spotLine(spot, "loser Stoß")),
        ],
    };
}

/** Die Zahlen des Befunds in einem Satz — dieselbe Zeile für Prüfer und Werkzeug. */
export function looseEndpointSummary(report: LooseEndpointReport): string {
    const zahl = (value: number): string => String(value).replace(".", ",");
    return (
        `${String(report.loose.length)} von ${String(report.endpointsTotal)} Kantenenden hängen ohne genauen Wegkontakt ` +
        `über ${zahl(report.looseDistance)} E neben ihrem Ort (Kasten ${zahl(report.endpointBox)} E); ` +
        `${String(report.retiredSpots.reduce((sum, spot) => sum + spot.ends.length, 0))} davon an ` +
        `${String(report.retiredSpots.length)} stillgelegten Orten; nur gezählt: ${String(report.absorbed)} ` +
        `Treffpunkte im Ortskasten, ${String(report.detached.length)} Wege ohne Kante, ` +
        `${String(report.deadEnds)} Sackgassen`
    );
}
