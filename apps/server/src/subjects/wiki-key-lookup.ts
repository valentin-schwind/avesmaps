import { subjectKey, type AreaRef, type SubjectRef } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { resolvePathGroup } from "./path-group.ts";
import type { PathIndex, RegionIndex, TerritoryIndex } from "./subject-index.ts";

/**
 * Die Zuordnung „Wiki-Key → Kartenobjekt“ (WI-0063 27.12, Betreiber 2026-10-05, AGENTS.md „Karteninteraktion“): die EINE Stelle, die der Linkpfad fragt, wenn ein
 * Wert eines Wiki-Feldes ein Objekt der Karte nennen soll.
 *
 * 🔴 NIE ÜBER DEN NAMEN. Betreiber 2026-10-05: „was du mit der namensauflösung gemacht hast, haben wir schonmal verbockt, genau dasselbe war bei
 * legacy auch - du hast geglaubt man könne die namen via namensauflösung suchen und ich musste dich irgendwie davon überzeugen auf die wiki-keys
 * umzustellen“ (Legacy `docs/abenteuer-feature-design.md` §5, „Namensauflösung (wiki-key-basiert)“). Ein Name ist Anzeige, nie Schlüssel; auch ein
 * „eindeutiger“ Name macht keinen Link. Der Weg ist:
 *
 *   Linkziel im Wiki-Quelltext (`[[Reichsstraße 2|2]]`)
 *     → kanonischer Wiki-Key mit Namensraum, den Legacy für das Ziel liefert (X1 `ziel_key`, `wiki:reichsstrasse-2`)
 *     → das Kartenobjekt, dem GENAU dieser Key zugewiesen ist (X2, `wiki_key_assignment`).
 *
 * Fehlt das Linkziel, fehlt dem Objekt die Zuweisung oder tragen zwei Objekte denselben Key, bleibt der Wert Text. Ein Objekt ohne Zuweisung hat
 * keinen Key; Avesmaps3D rät keinen (Legacy rät seit dem Owner-Entscheid vom 08.09.2026 auch nicht mehr). Hier wird kein Key GERECHNET: Beide Seiten
 * kommen aus Legacy, beide durch dieselbe Funktion (Titel → Weiterleitungstafel `wiki_redirect_alias` → `wiki:` + Slug, der Namensraum steckt im Key),
 * und werden wörtlich verglichen.
 *
 * ⭐ Quelle ist die Zuordnungstafel X2 (`wiki_key_assignment`, Importschritt I24): je Kartenobjekt mit Wiki-Zuweisung Legacys Kennung und der kanonische
 * Key. Sie ersetzt die Zuweisungen, die unsere Daten selbst tragen (`place_wiki_assignment`, `region.wiki_url`, …) als Quelle; diese sind der Abgleich
 * (`verify:wiki-links`, Befund `wiki_key_vs_assignment`). Der Lookup löst Legacys Kennung gegen unsere Träger auf: Ort und Gipfel über `public_id`,
 * Wegabschnitt zur Wegegruppe, Kraftlinie zur Gruppe ihres Keys, Landschaft über die Region (und die Beschriftung, die an sie gebunden ist), Gebiet über
 * `territory.public_id` (nur mit abgeleiteter Form). Er hängt am Datenstand und wird mit dem `SubjectIndex` je Revision im Speicher gebaut, nicht je Anfrage.
 *
 * Weiterleitungen sind in beiden Keys schon aufgelöst (`weiterleitung_auf` nennt sie in den Daten); `canonicalWikiKey` bleibt die EINE Schleuse, durch die
 * Aufbau und Abfrage gehen, und ist deshalb heute die Identität. Es gibt keine eigene Aliastafel.
 */

/** Die Arten von Objekten, denen ein Wiki-Key zugewiesen sein kann. `area` ist die Landschaft einer beliebigen Ebene samt Kontinent und Meer. */
export type WikiKeyKind = "place" | "territory" | "area" | "peak" | "path" | "powerline";

export interface WikiKeyTarget {
    kind: WikiKeyKind;
    ref: SubjectRef;
}

/** Die Träger unserer Seite, deren Artikel der Leser kennen muss, um dessen Linkziele zu laden (`pageKeysOf`). */
export type PageCarrier = "place" | "peak" | "area" | "path" | "powerline";

export interface WikiKeyLookup {
    /** Kanonischer Wiki-Key zu allen Objekten, denen er zugewiesen ist; je Objekt einmal, in fester Reihenfolge. */
    byKey: ReadonlyMap<string, readonly WikiKeyTarget[]>;
    /** `<Art>:<öffentliche ID>` eines Trägers (Ort, Gipfel, Region, Wegabschnitt, Kraftlinien-Segment) → der Key seines Artikels. */
    pageKeys: ReadonlyMap<string, string>;
}

/** Das Ergebnis einer Zuordnung: genau ein Objekt, mehrere (mehrdeutig, kein Link) oder keines. */
export type WikiKeyMatch = { kind: "one"; ref: SubjectRef } | { kind: "many" } | { kind: "none" };

/**
 * Der kanonische Wiki-Key zu einem Wiki-Key. HEUTE DIE IDENTITÄT: Die Schlüssel von X1 und X2 haben die Weiterleitungen der Wiki (Legacy
 * `wiki_redirect_alias`) schon durchlaufen, ihr Ergebnis steht im Key. Sollte je ein Key unaufgelöst ankommen, wird hier - und nur hier - eingehängt;
 * Aufbau und Abfrage des Lookups fragen beide über diese Funktion. Es gibt keine eigene Aliastafel.
 */
export function canonicalWikiKey(key: string): string {
    return key;
}

/** Ein Objekt unter einem Key; zwei Einträge für dasselbe Objekt zählen nicht doppelt. */
function addTo(map: Map<string, WikiKeyTarget[]>, key: string, target: WikiKeyTarget): void {
    const canonical = canonicalWikiKey(key);
    if (canonical === "") return;
    const list = map.get(canonical);
    if (list === undefined) {
        map.set(canonical, [target]);
        return;
    }
    const wanted = subjectKey(target.ref);
    if (!list.some((known) => subjectKey(known.ref) === wanted)) list.push(target);
}

interface AssignmentRow {
    art: string;
    id: string;
    key: string;
}

/**
 * Baut den Lookup aus der Zuordnungstafel. Ein Objekt, das es bei uns nicht gibt (stillgelegt, verborgen, anderer Kartenraum, freie Beschriftung ohne
 * Region, Gebiet ohne Form), ist kein Ziel: ein Link darauf könnte nichts zeigen.
 */
export async function buildWikiKeyLookup(
    database: Database,
    parts: {
        territories: TerritoryIndex;
        paths: PathIndex;
        regions: RegionIndex;
        /** Der kanonische Ref einer Fläche (`canonicalAreaRef`): hereingereicht, damit es keinen Importkreis mit dem Index gibt. */
        areaRef: (publicId: string) => AreaRef | null;
    },
    mapDomainId: string,
): Promise<WikiKeyLookup> {
    // Die Landschaft vor der Beschriftung: Die Fläche ist die genauere Aussage über ihre Region, die Beschriftung die Wiederholung desselben Artikels.
    const rows = await database<AssignmentRow[]>`
        SELECT legacy_art AS art, object_public_id::text AS id, wiki_key AS key
        FROM wiki_key_assignment
        WHERE is_active
        ORDER BY array_position(ARRAY['siedlung','weg','kraftlinie','landschaft','region','gebiet'], legacy_art), wiki_key, object_public_id
    `;
    const [places, peaks, labels, powerlines] = await Promise.all([
        database<{ id: string }[]>`
            SELECT p.public_id::text AS id
            FROM wiki_key_assignment a JOIN place p ON p.public_id = a.object_public_id
            WHERE a.is_active AND a.legacy_art = 'siedlung'
              AND p.is_active AND NOT p.is_hidden AND p.map_domain_id = ${mapDomainId}
        `,
        database<{ id: string }[]>`
            SELECT t.public_id::text AS id
            FROM wiki_key_assignment a JOIN terrain_peak t ON t.public_id = a.object_public_id
            WHERE a.is_active AND a.legacy_art = 'region' AND t.is_active AND t.map_domain_id = ${mapDomainId}
        `,
        database<{ id: string; region: string }[]>`
            SELECT l.public_id::text AS id, r.public_id::text AS region
            FROM wiki_key_assignment a
            JOIN map_label l ON l.public_id = a.object_public_id
            JOIN region r ON r.id = l.region_id
            WHERE a.is_active AND a.legacy_art = 'region' AND l.is_active AND r.is_active AND r.map_domain_id = ${mapDomainId}
        `,
        database<{ id: string }[]>`
            SELECT p.public_id::text AS id
            FROM wiki_key_assignment a JOIN powerline p ON p.public_id = a.object_public_id
            WHERE a.is_active AND a.legacy_art = 'kraftlinie' AND p.is_active AND p.map_domain_id = ${mapDomainId}
        `,
    ]);
    const placeIds = new Set(places.map((row) => row.id));
    const peakIds = new Set(peaks.map((row) => row.id));
    const regionOfLabel = new Map(labels.map((row) => [row.id, row.region]));
    const powerlineIds = new Set(powerlines.map((row) => row.id));

    const byKey = new Map<string, WikiKeyTarget[]>();
    const pageKeys = new Map<string, string>();
    const setPageKey = (carrier: PageCarrier, id: string, key: string): void => {
        const slot = `${carrier}:${id}`;
        if (!pageKeys.has(slot)) pageKeys.set(slot, canonicalWikiKey(key));
    };
    // Eine Kraftlinie ist die Gruppe ihrer Segmente: Alle Segmente EINES Keys sind dieselbe Kraftlinie, der Anker ist das kleinste (die Zeilen kommen nach Kennung).
    const segmentsOfKey = new Map<string, string[]>();

    for (const row of rows) {
        const key = canonicalWikiKey(row.key);
        if (key === "") continue;
        switch (row.art) {
            case "siedlung":
                if (placeIds.has(row.id)) {
                    addTo(byKey, key, { kind: "place", ref: { kind: "place", id: row.id } });
                    setPageKey("place", row.id, key);
                }
                break;
            case "weg": {
                // Ein Weg ist die Gruppe seiner Abschnitte: Der Abschnitt zählt für die Gruppe seiner Hauptzuweisung (X2 kennt nur sie).
                const group = resolvePathGroup(parts.paths, row.id);
                if (group !== null) {
                    addTo(byKey, key, { kind: "path", ref: group.ref });
                    setPageKey("path", row.id, key);
                }
                break;
            }
            case "kraftlinie":
                if (powerlineIds.has(row.id)) {
                    const members = segmentsOfKey.get(key);
                    if (members === undefined) segmentsOfKey.set(key, [row.id]);
                    else members.push(row.id);
                    setPageKey("powerline", row.id, key);
                }
                break;
            case "landschaft": {
                // Mehrere Regionen derselben Gruppe sind EIN Subject (WI-0047).
                const ref = parts.regions.byPublicId.has(row.id) ? parts.areaRef(row.id) : null;
                if (ref !== null) {
                    addTo(byKey, key, { kind: "area", ref });
                    setPageKey("area", row.id, key);
                }
                break;
            }
            case "region": {
                // Eine Beschriftung: ein Gipfel, oder eine, die an eine Landschaft gebunden ist (dann gilt der Artikel für diese Landschaft).
                if (peakIds.has(row.id)) {
                    addTo(byKey, key, { kind: "peak", ref: { kind: "peak", id: row.id } });
                    setPageKey("peak", row.id, key);
                    break;
                }
                const regionId = regionOfLabel.get(row.id);
                const ref =
                    regionId !== undefined && parts.regions.byPublicId.has(regionId) ? parts.areaRef(regionId) : null;
                if (regionId !== undefined && ref !== null) {
                    addTo(byKey, key, { kind: "area", ref });
                    setPageKey("area", regionId, key);
                }
                break;
            }
            case "gebiet": {
                // Ein Gebiet ohne Form steht nicht auf der Karte: kein Flug, keine Markierung, also kein Ziel.
                const territory = parts.territories.byPublicId.get(row.id);
                if (territory !== undefined && parts.territories.shaped.has(territory.id)) {
                    addTo(byKey, key, { kind: "territory", ref: { kind: "territory", id: territory.publicId } });
                }
                break;
            }
        }
    }
    for (const [key, members] of segmentsOfKey) {
        const [anchor] = [...members].sort();
        if (anchor !== undefined) addTo(byKey, key, { kind: "powerline", ref: { kind: "powerline", anchor } });
    }
    return { byKey, pageKeys };
}

/**
 * ALLE Objekte, die genau diesen Wiki-Key tragen, in fester Reihenfolge (leer: keines). Der Linkpfad braucht nur das Urteil „eines, mehrere, keines“
 * (`lookupWikiKey`); die Lore (D5, Schritt I25) speichert bei Mehrdeutigkeit ALLE Treffer und wählt keinen. Beide gehen durch dieselbe Schleuse.
 */
export function lookupWikiKeyTargets(lookup: WikiKeyLookup, key: string): readonly WikiKeyTarget[] {
    const canonical = canonicalWikiKey(key);
    return canonical === "" ? [] : (lookup.byKey.get(canonical) ?? []);
}

/** Welches Objekt trägt diesen Wiki-Key? Eines ist ein Treffer, mehrere sind mehrdeutig (kein Link), keines heißt: kein Objekt der Karte. */
export function lookupWikiKey(lookup: WikiKeyLookup, key: string): WikiKeyMatch {
    const targets = lookupWikiKeyTargets(lookup, key);
    const [first] = targets;
    if (first === undefined) return { kind: "none" };
    return targets.length === 1 ? { kind: "one", ref: first.ref } : { kind: "many" };
}

/**
 * Der Key einer Zeile der Lore (`place_wiki_key`, Legacys `lore_place`) in der Form der Zuordnung X2: `wiki:` plus Slug. Legacys Lore schreibt den Slug
 * des Seitentitels, die Zuordnung führt dieselbe Funktion mit dem Präfix `wiki:` (die Beispielantwort der Lore trägt es schon). Das ist die EINE Stelle für
 * dieses Präfix: Sie setzt es, wo es fehlt, und lässt alles andere wie es ist. Der Namensraum steckt im Slug (`inoffiziell-…`) und wird nie abgeschnitten,
 * nichts wird gefaltet. Danach geht der Key durch `canonicalWikiKey`, die Schleuse der Weiterleitungen.
 */
export function wikiKeyOfLoreKey(key: string): string {
    const trimmed = key.trim();
    if (trimmed === "") return "";
    return canonicalWikiKey(trimmed.startsWith("wiki:") ? trimmed : `wiki:${trimmed}`);
}

/**
 * Die Keys der Artikel, die zu diesen Trägern gehören (Orte, Gipfel, Regionen einer Gruppe, Wegabschnitte, Kraftlinien-Segmente), je Key einmal in der
 * Reihenfolge der Kennungen. Leer, wenn der Träger keine Zuweisung in der Zuordnungstafel hat: dann gibt es keine Linkziele, und alle Felder bleiben Text.
 */
export function pageKeysOf(lookup: WikiKeyLookup, carrier: PageCarrier, ids: readonly string[]): string[] {
    const keys: string[] = [];
    for (const id of ids) {
        const key = lookup.pageKeys.get(`${carrier}:${id}`);
        if (key === undefined) continue;
        const canonical = canonicalWikiKey(key);
        if (!keys.includes(canonical)) keys.push(canonical);
    }
    return keys;
}
