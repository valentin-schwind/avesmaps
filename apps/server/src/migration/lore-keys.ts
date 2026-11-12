import { createHash } from "node:crypto";
import { lookupWikiKeyTargets, wikiKeyOfLoreKey, type WikiKeyLookup } from "../subjects/wiki-key-lookup.ts";
import type { TargetIndex } from "./catalog-places.ts";

/**
 * Schlüssel und Auflösung der Lore (WI-0063 P3, Vertrag `lore.yaml`, D5): die reinen Bausteine, ohne Datenbank und ohne Netz.
 *
 * 🔴 Aufgelöst wird NUR über den Wiki-Schlüssel, nie über einen Namen, einen Titel oder `match_key` (Betreiber 2026-10-05: „was du mit der
 * namensauflösung gemacht hast, haben wir schonmal verbockt“; AGENTS.md „Karteninteraktion“). Der Namensraum gehört zum Schlüssel:
 * `inoffiziell-angbar` ist ein anderer Artikel als `angbar`, und kein Vergleich schneidet ihn ab.
 *
 * ⭐ EIN Key, EINE Schleuse: Die Ortszeilen laufen durch DENSELBEN Lookup wie die Objektlinks der Oberfläche (`subjects/wiki-key-lookup.ts`,
 * gespeist aus Legacys Zuordnung X2): `lookupWikiKeyTargets` nach `wikiKeyOfLoreKey` (die eine Stelle für das Präfix `wiki:`), und beides über
 * `canonicalWikiKey`, die Stelle der Weiterleitungen. Die Lore hat kein zweites Schleusenmodul. Die frühere Auflösung über die D6-Schnappschüsse und
 * `territory.wiki_key` bleibt nur als Vergleichsmaß (`resolveLorePlaceByCarriers`): wo der Lookup anders auflöst, steht ein Befund, nichts wird still
 * angeglichen.
 */

export const LORE_KINDS = ["fauna", "flora", "spezies", "ware"] as const;
export type LoreKind = (typeof LORE_KINDS)[number];

export const LORE_RELATIONS = ["verbreitung", "vorkommen", "herkunft", "regionen"] as const;
export type LoreRelation = (typeof LORE_RELATIONS)[number];

/** Die Ebenen der Landschaftsarten einer Bedingung (wie `region.region_layer`). */
export const RULE_LAYERS = ["derographisch", "vegetation", "topographie", "klima"] as const;
export type RuleLayer = (typeof RULE_LAYERS)[number];

/**
 * Kontinente und Sammelbegriffe, die überall gelten (Legacys feste Liste `AVESMAPS_LORE_CONTINENT_KEYS`, `api/_internal/app/lore.php`).
 * Sie bezeichnen absichtlich kein Kartenobjekt: „gilt überall“, Rang 3 beim Lesen. Sie werden nicht verworfen.
 */
export const CONTINENT_KEYS: readonly string[] = [
    "aventurien",
    "myranor",
    "uthuria",
    "rakshazar",
    "tharun",
    "riesland",
    "guldenland",
    "gueldenland",
    "ehernes-schwert-kontinent",
];

/**
 * Der Schlüssel ohne das Präfix `wiki:` und klein: der Anteil, an dem die Kontinentliste und das Vergleichsmaß messen. Das Präfix kommt aus der
 * einen Stelle (`wikiKeyOfLoreKey`); der Namensraum bleibt Teil des Anteils.
 */
export function bareLoreKey(key: string): string {
    const prefixed = wikiKeyOfLoreKey(key);
    return (prefixed.startsWith("wiki:") ? prefixed.slice("wiki:".length) : prefixed).toLowerCase();
}

export function isContinentKey(key: string): boolean {
    return CONTINENT_KEYS.includes(bareLoreKey(key));
}

export type LoreHitColumn = "place_id" | "territory_id" | "region_id" | "terrain_peak_id";

/** Ein Träger, der den Schlüssel trägt. */
export interface LoreHit {
    column: LoreHitColumn;
    id: string;
}

export type LoreTargetState = "resolved" | "ambiguous" | "unresolved" | "unmatched";

export interface LoreResolution {
    keyClass: "continent" | "other";
    state: LoreTargetState;
    /** Alle Treffer, in fester Reihenfolge (Ort, Gebiet, Landschaft, Gipfel; je Art nach Id). */
    hits: LoreHit[];
    /** Der Schlüssel trifft nur einen Weg oder eine Kraftlinie: kein Zielraum der Lore, nur ein Befund. */
    pathOnly: boolean;
}

const COLUMN_ORDER: readonly LoreHitColumn[] = ["place_id", "territory_id", "region_id", "terrain_peak_id"];

function byId(a: LoreHit, b: LoreHit): number {
    return COLUMN_ORDER.indexOf(a.column) - COLUMN_ORDER.indexOf(b.column) || Number(a.id) - Number(b.id);
}

function stateOf(keyClass: "continent" | "other", hits: readonly LoreHit[]): LoreTargetState {
    return hits.length === 1
        ? "resolved"
        : hits.length > 1
          ? "ambiguous"
          : keyClass === "continent"
            ? "unresolved"
            : "unmatched";
}

/** Die internen Ids der Träger zu den öffentlichen IDs, mit denen der Lookup arbeitet (nur aktive Zeilen). */
export interface LoreCarrierIds {
    places: ReadonlyMap<string, string>;
    territories: ReadonlyMap<string, string>;
    peaks: ReadonlyMap<string, string>;
    /** `region.public_id` (klein) → `region.id`. Eine Landschaft ist EIN Subject (die Gruppe gleichnamiger Regionen): ihr Ziel ist der Anker (kleinste Kennung). */
    regions: ReadonlyMap<string, string>;
}

/**
 * Löst den Schlüssel einer Ortszeile über den Lookup der Oberfläche auf (Vertrag `ortsbezug.aufloesung`):
 *  1. `key_class`: steht der Schlüssel in der Kontinentliste, ist er `continent`, sonst `other`.
 *  2. Den Schlüssel (`wiki:` plus Slug) in die Zuordnung X2 schlagen: Ort, Gebiet (nur mit Form), Landschaft (der Anker ihrer Gruppe), Gipfel.
 *  3. Alle Treffer sind Ziele. Einer ist `resolved`, mehrere `ambiguous` (alle gespeichert, keiner ausgezeichnet), keiner ist bei einem
 *     Kontinentbegriff `unresolved`, sonst `unmatched`.
 * Ein Träger, den der Lookup nicht kennt (stillgelegt, verborgen, Gebiet ohne Form), trifft nicht. Wege und Kraftlinien sind kein Zielraum.
 */
export function resolveLorePlace(placeWikiKey: string, wikiKeys: WikiKeyLookup, ids: LoreCarrierIds): LoreResolution {
    const keyClass = isContinentKey(placeWikiKey) ? "continent" : "other";
    const targets = lookupWikiKeyTargets(wikiKeys, wikiKeyOfLoreKey(placeWikiKey));
    const hits: LoreHit[] = [];
    let otherKinds = 0;
    for (const target of targets) {
        const ref = target.ref;
        let hit: LoreHit | null = null;
        switch (target.kind) {
            case "place": {
                const id = ref.kind === "place" ? ids.places.get(ref.id.toLowerCase()) : undefined;
                if (id !== undefined) hit = { column: "place_id", id };
                break;
            }
            case "territory": {
                const id = ref.kind === "territory" ? ids.territories.get(ref.id.toLowerCase()) : undefined;
                if (id !== undefined) hit = { column: "territory_id", id };
                break;
            }
            case "area": {
                const id = ref.kind === "area" ? ids.regions.get(ref.id.toLowerCase()) : undefined;
                if (id !== undefined) hit = { column: "region_id", id };
                break;
            }
            case "peak": {
                const id = ref.kind === "peak" ? ids.peaks.get(ref.id.toLowerCase()) : undefined;
                if (id !== undefined) hit = { column: "terrain_peak_id", id };
                break;
            }
            case "path":
            case "powerline":
                otherKinds += 1;
                break;
        }
        const found = hit;
        if (found !== null && !hits.some((known) => known.column === found.column && known.id === found.id))
            hits.push(found);
    }
    hits.sort(byId);
    return { keyClass, state: stateOf(keyClass, hits), hits, pathOnly: hits.length === 0 && otherKinds > 0 };
}

/**
 * VERGLEICHSMASS, nicht Quelle: die frühere Auflösung des Entwurfs über die Schnappschüsse und Zuordnungen von D6 und `territory.wiki_key` (aktive Träger,
 * Gebiete auch ohne Form). Die Lore speichert die Auflösung des Lookups (`resolveLorePlace`); wo beide Mengen verschieden sind, meldet `transformLore`
 * den Befund `place_target_differs_from_carriers`, statt eine der beiden still anzugleichen.
 */
export function resolveLorePlaceByCarriers(placeWikiKey: string, index: TargetIndex): LoreResolution {
    const body = bareLoreKey(placeWikiKey);
    const keyClass = CONTINENT_KEYS.includes(body) ? "continent" : "other";
    const hits: LoreHit[] = [];
    if (body !== "") {
        for (const id of index.placesByKey.get(body) ?? []) hits.push({ column: "place_id", id });
        for (const id of index.territoriesByKey.get(`wiki:${body}`) ?? []) hits.push({ column: "territory_id", id });
        for (const id of index.regionsByKey.get(body) ?? []) hits.push({ column: "region_id", id });
        for (const id of index.peaksByKey.get(body) ?? []) hits.push({ column: "terrain_peak_id", id });
    }
    hits.sort(byId);
    return {
        keyClass,
        state: stateOf(keyClass, hits),
        hits,
        pathOnly: hits.length === 0 && body !== "" && index.pathAnchors.has(body),
    };
}

/** Die Zellen der vier Fremdschlüssel einer Zielzeile: genau eine gesetzt. */
export function hitCells(hit: LoreHit): (string | null)[] {
    return COLUMN_ORDER.map((column) => (hit.column === column ? hit.id : null));
}

/** Die Art, wie der Befund die Zielart nennt. */
export function hitKindLabel(column: LoreHitColumn): string {
    switch (column) {
        case "place_id":
            return "Ort";
        case "territory_id":
            return "Gebiet";
        case "region_id":
            return "Landschaft";
        case "terrain_peak_id":
            return "Gipfel";
    }
}

/**
 * Die Lage zu einer Linie einer Bedingung (WI-0254, Migration 0250) in der Form des Fingerabdrucks: die Richtung und die Orte als `place.public_id`. Die Orte stehen ohne Bedeutung der Reihenfolge da
 * (A–B ist B–A): `lageSchluessel` sortiert und schreibt sie klein.
 */
export interface RuleTermLage {
    richtung: string;
    orte: readonly string[];
}

/** Eine Bedingung in der Form, die in den Fingerabdruck der Regel eingeht (Legacy-Werte, nicht unsere Auflösung). */
export interface RuleTermKeyInput {
    joinOp: "und" | "oder" | "ohne";
    areaPublicId: string | null;
    climateFrom: string | null;
    climateTo: string | null;
    types: readonly { layer: string; type: string }[];
    /** Die Lage zu einer Linie; `undefined`, `null` und fehlend sind dasselbe: keine Lage, KEIN sechstes Feld (der Fingerabdruck einer Regel ohne Lage bleibt byte-gleich). */
    lage?: RuleTermLage | null | undefined;
}

const FIELD_SEPARATOR = "\u001f";
const TERM_SEPARATOR = "\u001e";

/** Die Lage als Feld des Fingerabdrucks: `richtung:kennung,kennung`, die Kennungen klein und sortiert (A–B ist B–A). Auch die Bedingungsschlüssel der Ableitung (`bedSchluessel`) schreiben sie so. */
export const lageSchluessel = (lage: RuleTermLage): string =>
    `${lage.richtung}:${lage.orte
        .map((ort) => ort.toLowerCase())
        .sort()
        .join(",")}`;

/** Die Lage im Fachprotokoll (`changes.rules`): `richtung:kennung/kennung`, die Kennungen klein und sortiert wie im Fingerabdruck, nur mit Schrägstrich statt Komma. */
export const lageProtokoll = (lage: RuleTermLage): string => lageSchluessel(lage).replaceAll(",", "/");

/**
 * Die Identität einer Regel: SHA-256 (hex) über Eintrag, Beziehung und die geordnete Bedingungskette in kanonischer Schreibweise
 * (Vertrag `identitaet.regel.kanonische_schreibweise`): je Bedingung in Reihenfolge `join_op` (bei der ersten Bedingung leer: ihr Wert
 * ist bedeutungslos), `area_public_id` (klein), `climate_from`, `climate_to`, die Arten als sortierte Liste `ebene/art`. Leere Werte sind
 * die leere Zeichenkette. Die Reihenfolge der Bedingungen gehört zum Inhalt (Auswertung von links nach rechts).
 *
 * 🔴 **Die Lage zu einer Linie** (WI-0254) kommt als SECHSTES Feld `richtung:kennungen` NUR dazu, wo eine Bedingung eine hat (`lageSchluessel`: Kennungen klein, sortiert, Komma). Eine Bedingung ohne Lage
 * hat KEIN leeres sechstes Feld: Sonst änderte sich der Fingerabdruck jeder gespeicherten Regel, und `UNIQUE (lore_entry_id, rule_key)` und die Erkennung „gleich“ der Ableitung brächen (Goldwerte
 * in `test/lore.test.ts`).
 */
export function ruleKeyOf(entryWikiKey: string, relation: string, terms: readonly RuleTermKeyInput[]): string {
    const canonical = terms
        .map((term, position) =>
            [
                position === 0 ? "" : term.joinOp,
                (term.areaPublicId ?? "").toLowerCase(),
                term.climateFrom ?? "",
                term.climateTo ?? "",
                term.types
                    .map((type) => `${type.layer}/${type.type}`)
                    .sort()
                    .join(","),
                ...(term.lage === undefined || term.lage === null ? [] : [lageSchluessel(term.lage)]),
            ].join(FIELD_SEPARATOR),
        )
        .join(TERM_SEPARATOR);
    return createHash("sha256")
        .update([entryWikiKey, relation, canonical].join(TERM_SEPARATOR + TERM_SEPARATOR), "utf8")
        .digest("hex");
}
