import { LEGACY_MAX_BAND, upperBandFromLegacy } from "@avesmaps3d/shared";
import { MigrationAborted } from "./places.ts";

/**
 * Import der Regionsdomaene (WI-0003).
 *
 * Die Region ist die Aggregatwurzel: ihre Flaechen und ihre gebundenen Labels gehoeren zu ihr und
 * werden nie als unabhaengige Domaenen behandelt. Der Lauf schreibt in vier Phasen, aber das ist
 * eine Vorsichtsmassnahme beim Schreiben, keine Domaengrenze - er laeuft in einer Transaktion, und
 * die Aggregatpruefung entscheidet ueber Erfolg, nicht eine einzelne Phase.
 *
 * Drei Quellen, drei Staende:
 *   list_regions        die einzige VOLLSTAENDIGE Regionsquelle (Capability edit, als Datei)
 *   ecosystem-areas     die Flaechengeometrie (oeffentlich)
 *   map-features        die Labels (oeffentlich)
 *
 * 🪤 ecosystem-areas liefert Flaechen, nicht Regionen: es joint ueber AKTIVE Flaechen, und eine
 * Region ohne aktive Flaeche kommt darin gar nicht vor. Live sind das zwoelf. Deshalb kommen die
 * Regionen aus list_regions und nur die Geometrie von dort.
 */

/** 2: Legacys Obergrenze 7 steht im Ziel als 8 (WI-0129, Vertrag regions.yaml `label_bands`). */
export const CONTRACT_VERSION = "2";

/** Die vier Legacy-Ebenen. Der Spaltenname ist neu, die Werte sind unveraendert. */
export const REGION_LAYERS = ["derographisch", "vegetation", "topographie", "klima"] as const;
export type RegionLayer = (typeof REGION_LAYERS)[number];

/**
 * Klima bleibt draussen: acht globale Zonen statt tausender lokaler Landschaften, und als einzige
 * aus Trennlinien abgeleitet. Spaeter werden die Trennlinien die Source of Truth, die Zonen daraus
 * abgeleitet - und vorher ist der Widerspruch sieben gegen acht Zonen zu klaeren.
 */
export const MIGRATED_LAYERS: RegionLayer[] = ["derographisch", "vegetation", "topographie"];

export interface LegacyRegion {
    public_id?: string;
    name?: string;
    kind?: string;
    region_type?: string | null;
    wiki_region_key?: string | null;
    wiki_url?: string | null;
    area_count?: number;
    label_public_id?: string | null;
    curve_label?: boolean;
    curve_label_max?: number;
    stack_order?: number;
    is_locked?: boolean;
}

export interface LegacyRegionPayload {
    ok?: boolean;
    regions?: LegacyRegion[];
}

/**
 * 💣 Legacys `is_trial` wird nicht übernommen: Die Erprobung ist dort seit 2026-08-01 abgeschafft, der
 * Stempel steht überall auf 0, und ein Filter darauf machte gezeichnete Flächen still wirkungslos (WI-0048).
 */
export interface LegacyArea {
    public_id?: string;
    region_public_id?: string;
    geometry?: { type?: string; coordinates?: unknown } | null;
    geometry_revision?: number;
    affects_paths?: unknown;
}

export interface LegacyAreaPayload {
    ok?: boolean;
    revision?: number;
    truncated?: boolean;
    areas?: LegacyArea[];
}

export interface LegacyFeature {
    geometry?: { type?: string; coordinates?: unknown };
    properties?: Record<string, unknown>;
}

export interface LegacyMapPayload {
    ok?: boolean;
    revision?: number;
    features?: LegacyFeature[];
}

export interface TransformedRegion {
    publicId: string;
    name: string;
    regionLayer: RegionLayer;
    regionType: string | null;
    stackOrder: number;
    isLocked: boolean;
    wikiUrl: string | null;
    wikiRegionKey: string | null;
    curveEnabled: boolean;
    curveMax: number | null;
    /** Legacy-Zeiger auf das primaere Label. Kann ins Leere gehen; das wird berichtet, nicht repariert. */
    primaryLabelPublicId: string | null;
}

export interface TransformedArea {
    publicId: string;
    regionPublicId: string;
    geometry: unknown;
    geometryRevision: number | null;
    affectsPaths: boolean;
}

export interface TransformedLabel {
    publicId: string;
    regionPublicId: string;
    name: string;
    subtype: string | null;
    x: number;
    y: number;
    minZoom: number | null;
    maxZoom: number | null;
    size: number | null;
    priority: number | null;
    rotation: number | null;
    showName: boolean | null;
    isNodix: boolean | null;
    legacyRevision: number | null;
}

export interface TransformResult {
    regions: TransformedRegion[];
    areas: TransformedArea[];
    labels: TransformedLabel[];
    skippedClimateRegions: number;
    skippedClimateAreas: number;
    freeLabels: number;
    /** Regionen, deren Primaerzeiger auf kein auslieferbares Label zeigt. Bestand, kein Fehler. */
    danglingPrimaryLabels: { publicId: string; name: string; pointer: string }[];
    /**
     * Regionen ohne eigenen Primaerzeiger, deren Primaerlabel stattdessen ueber den Rueckwaertszeiger
     * genau eines Labels aufgeloest wurde (`label.ecosystem_region_public_id`). Bestand, kein Fehler
     * (Koordination 2026-09-28, Fund an Amboss `5e0a6f49-…`: Legacys alter Speicherfehler cf0c19544/
     * bc86fbab3 liess den Vorwaertszeiger der Region leer, obwohl das Label sie eindeutig beansprucht).
     */
    primaryLabelFromReverse: { publicId: string; name: string; labelPublicId: string }[];
    rejected: { publicId: string; reason: string }[];
    /**
     * Wie viele Label-Maxima beim Lesen von Legacys 7 auf das Ziel 8 gehoben wurden (WI-0129, Betreiber 2026-10-10 E2 A).
     * Beim zweiten Lauf über dieselbe Quelle dieselbe Zahl: gezählt wird die Quelle, nicht, was sich im Ziel ändert.
     */
    labelUpperBandsFromLegacy: number;
    /**
     * Labels, deren Legacy-Maximum über Legacys Obergrenze 7 liegt. Legacy nimmt heute nur 0..7 an; steht hier je etwas,
     * hat Legacy seine Obergrenze angehoben, und seine 7 ist nicht mehr terminal. Nur Befund, kein Abbruch (WI-0129 S11).
     */
    labelBandsAboveLegacyMax: { publicId: string; name: string; maxZoom: number }[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Legacy liefert max_zoom bei 65 Labels als Zeichenkette "7". Eine Zahl ist eine Zahl. */
function asNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") {
        return value;
    }
    if (value === 1 || value === "1") {
        return true;
    }
    if (value === 0 || value === "0") {
        return false;
    }
    return null;
}

/**
 * Die drei Quellen muessen sich als ganze Antwort ausweisen, bevor irgendetwas geschrieben wird.
 * Eine abgeschnittene Datei scheitert schon am JSON; was diese Pruefung faengt, ist eine Antwort,
 * die zwar parst, aber nicht die gestellte Frage beantwortet.
 *
 * 🔴 Bleibt ein Abbruch (Betreiber 2026-10-03, „A auch für die Prüfungen“, BLOCKING_SOURCE_CHECKS A15).
 */
export function assertSourcesComplete(
    regions: LegacyRegionPayload,
    areas: LegacyAreaPayload,
    labels: LegacyMapPayload,
): void {
    if (regions.ok !== true || !Array.isArray(regions.regions) || regions.regions.length === 0) {
        throw new MigrationAborted("die Regionsquelle weist sich nicht als vollstaendige Antwort aus", {
            ok: String(regions.ok),
            regions: Array.isArray(regions.regions) ? regions.regions.length : "kein Array",
        });
    }
    if (areas.ok !== true || !Array.isArray(areas.areas) || areas.areas.length === 0) {
        throw new MigrationAborted("die Flaechenquelle weist sich nicht als vollstaendige Antwort aus", {
            ok: String(areas.ok),
            areas: Array.isArray(areas.areas) ? areas.areas.length : "kein Array",
        });
    }
    // Dieser Endpunkt meldet seine Unvollstaendigkeit selbst. Ein true hier waere ein halber Bestand.
    if (areas.truncated !== false) {
        throw new MigrationAborted("die Flaechenquelle meldet sich selbst als abgeschnitten", {
            truncated: String(areas.truncated),
        });
    }
    if (!Number.isFinite(areas.revision)) {
        throw new MigrationAborted("die Flaechenquelle traegt keine endliche Revision", {
            revision: String(areas.revision),
        });
    }
    if (labels.ok !== true || !Array.isArray(labels.features) || labels.features.length === 0) {
        throw new MigrationAborted("die Kartenquelle weist sich nicht als vollstaendige Antwort aus", {
            ok: String(labels.ok),
            features: Array.isArray(labels.features) ? labels.features.length : "kein Array",
        });
    }
    if (!Number.isFinite(labels.revision)) {
        throw new MigrationAborted("die Kartenquelle traegt keine endliche Revision", {
            revision: String(labels.revision),
        });
    }
}

/**
 * Bringt die drei Quellen auf das Aggregat zusammen.
 *
 * Die Zugehoerigkeit eines Labels wird nach Legacys eigener Regel aufgeloest: der Zeiger am Label
 * gewinnt, der Primaerzeiger der Region fuellt nur Luecken und ueberschreibt nie. Der oeffentliche
 * Kartenpayload traegt das Ergebnis dieser Regel bereits mit - die Regel steht hier trotzdem, damit
 * ein spaeterer Snapshot mit einer Luecke nicht still das Falsche migriert.
 */
export function transformSources(
    regionPayload: LegacyRegionPayload,
    areaPayload: LegacyAreaPayload,
    labelPayload: LegacyMapPayload,
): TransformResult {
    const result: TransformResult = {
        regions: [],
        areas: [],
        labels: [],
        skippedClimateRegions: 0,
        skippedClimateAreas: 0,
        freeLabels: 0,
        danglingPrimaryLabels: [],
        primaryLabelFromReverse: [],
        rejected: [],
        labelUpperBandsFromLegacy: 0,
        labelBandsAboveLegacyMax: [],
    };

    const inScope = new Set<string>();
    for (const raw of regionPayload.regions ?? []) {
        const publicId = String(raw.public_id ?? "");
        const layer = String(raw.kind ?? "") as RegionLayer;
        if (!UUID_PATTERN.test(publicId)) {
            result.rejected.push({ publicId, reason: "region: keine UUID" });
            continue;
        }
        if (!REGION_LAYERS.includes(layer)) {
            result.rejected.push({ publicId, reason: `region: unbekannte Ebene ${String(raw.kind)}` });
            continue;
        }
        if (!MIGRATED_LAYERS.includes(layer)) {
            result.skippedClimateRegions += 1;
            continue;
        }
        const name = String(raw.name ?? "").trim();
        if (name === "") {
            result.rejected.push({ publicId, reason: "region: leerer Name" });
            continue;
        }
        const curveEnabled = raw.curve_label === true;
        inScope.add(publicId);
        result.regions.push({
            publicId,
            name,
            regionLayer: layer,
            regionType: raw.region_type ? String(raw.region_type) : null,
            stackOrder: asNumber(raw.stack_order) ?? 0,
            isLocked: raw.is_locked === true,
            wikiUrl: raw.wiki_url ? String(raw.wiki_url) : null,
            wikiRegionKey: raw.wiki_region_key ? String(raw.wiki_region_key) : null,
            curveEnabled,
            // Die Anzahl ist nur mit eingeschaltetem Schalter eine Aussage.
            curveMax: curveEnabled ? Math.min(3, Math.max(1, asNumber(raw.curve_label_max) ?? 1)) : null,
            primaryLabelPublicId:
                raw.label_public_id && UUID_PATTERN.test(String(raw.label_public_id))
                    ? String(raw.label_public_id)
                    : null,
        });
    }

    for (const raw of areaPayload.areas ?? []) {
        const publicId = String(raw.public_id ?? "");
        const regionPublicId = String(raw.region_public_id ?? "");
        if (!UUID_PATTERN.test(publicId) || !UUID_PATTERN.test(regionPublicId)) {
            result.rejected.push({ publicId, reason: "flaeche: keine UUID" });
            continue;
        }
        if (!inScope.has(regionPublicId)) {
            result.skippedClimateAreas += 1;
            continue;
        }
        const type = raw.geometry?.type;
        if (type !== "Polygon" && type !== "MultiPolygon") {
            result.rejected.push({ publicId, reason: `flaeche: Geometrietyp ${String(type)}` });
            continue;
        }
        result.areas.push({
            publicId,
            regionPublicId,
            geometry: raw.geometry,
            geometryRevision: asNumber(raw.geometry_revision),
            affectsPaths: asBoolean(raw.affects_paths) ?? true,
        });
    }

    // Legacys Aufloesungsregel, Schritt zwei: was der Primaerzeiger der Region bindet, ohne dass das
    // Label es selbst sagt. Fuellt nur Luecken.
    const boundByRegionPointer = new Map<string, string>();
    for (const region of result.regions) {
        if (region.primaryLabelPublicId) {
            boundByRegionPointer.set(region.primaryLabelPublicId, region.publicId);
        }
    }

    const deliveredLabels = new Set<string>();
    // Umgekehrte Kandidaten fuer den Fallback unten: welche Labels beanspruchen eine Region ueber
    // ihren EIGENEN Zeiger (nicht ueber boundByRegionPointer, der ja schon von der Region herkommt).
    const ownReverseCandidates = new Map<string, string[]>();
    for (const feature of labelPayload.features ?? []) {
        const properties = feature.properties ?? {};
        if (properties["feature_type"] !== "label") {
            continue;
        }
        const publicId = String(properties["public_id"] ?? "");
        if (!UUID_PATTERN.test(publicId)) {
            result.rejected.push({ publicId, reason: "label: keine UUID" });
            continue;
        }
        deliveredLabels.add(publicId);

        const own = properties["ecosystem_region_public_id"];
        const ownRegionPublicId = typeof own === "string" && own !== "" ? own : null;
        const regionPublicId = ownRegionPublicId ?? boundByRegionPointer.get(publicId) ?? "";
        if (regionPublicId === "") {
            result.freeLabels += 1;
            continue;
        }
        if (!inScope.has(regionPublicId)) {
            // Ein Label an einer Klimaregion gibt es live nicht; faellt es je an, bleibt es draussen.
            result.freeLabels += 1;
            continue;
        }

        const coordinates = feature.geometry?.coordinates;
        const x = Array.isArray(coordinates) ? asNumber(coordinates[0]) : null;
        const y = Array.isArray(coordinates) ? asNumber(coordinates[1]) : null;
        if (feature.geometry?.type !== "Point" || x === null || y === null) {
            result.rejected.push({ publicId, reason: "label: keine Punktgeometrie" });
            continue;
        }
        const name = String(properties["name"] ?? "").trim();
        if (name === "") {
            result.rejected.push({ publicId, reason: "label: leerer Name" });
            continue;
        }

        // 🔴 Die Migrationsgrenze der Bänder (WI-0129): Legacys terminale 7 heißt im Ziel 8, alles andere bleibt, die
        // Untergrenze immer. Gelesen wird stets die QUELLE, deshalb ist der zweite Lauf derselbe wie der erste.
        const legacyMaxZoom = asNumber(properties["max_zoom"]);
        if (legacyMaxZoom === LEGACY_MAX_BAND) result.labelUpperBandsFromLegacy += 1;
        if (legacyMaxZoom !== null && legacyMaxZoom > LEGACY_MAX_BAND) {
            result.labelBandsAboveLegacyMax.push({ publicId, name, maxZoom: legacyMaxZoom });
        }

        result.labels.push({
            publicId,
            regionPublicId,
            name,
            subtype: properties["feature_subtype"] ? String(properties["feature_subtype"]) : null,
            x,
            y,
            minZoom: asNumber(properties["min_zoom"]),
            maxZoom: upperBandFromLegacy(legacyMaxZoom),
            size: asNumber(properties["size"]),
            priority: asNumber(properties["priority"]),
            rotation: asNumber(properties["rotation"]),
            showName: asBoolean(properties["show_name"]),
            isNodix: asBoolean(properties["is_nodix"]),
            legacyRevision: asNumber(properties["revision"]),
        });
        if (ownRegionPublicId) {
            const candidates = ownReverseCandidates.get(ownRegionPublicId) ?? [];
            candidates.push(publicId);
            ownReverseCandidates.set(ownRegionPublicId, candidates);
        }
    }

    // Fallback (Koordination 2026-09-28): fehlt der Vorwaertszeiger der Region, beansprucht sie aber
    // GENAU EIN ausgeliefertes Label ueber seinen eigenen Rueckwaertszeiger, wird dieses Label ihr
    // Primaerlabel. Zeigen mehrere oder kein Label auf sie, bleibt es wie heute (dangling/null).
    for (const region of result.regions) {
        if (region.primaryLabelPublicId !== null) {
            continue;
        }
        const candidates = ownReverseCandidates.get(region.publicId);
        if (candidates && candidates.length === 1) {
            const labelPublicId = candidates[0] as string;
            region.primaryLabelPublicId = labelPublicId;
            result.primaryLabelFromReverse.push({ publicId: region.publicId, name: region.name, labelPublicId });
        }
    }

    for (const region of result.regions) {
        if (region.primaryLabelPublicId && !deliveredLabels.has(region.primaryLabelPublicId)) {
            result.danglingPrimaryLabels.push({
                publicId: region.publicId,
                name: region.name,
                pointer: region.primaryLabelPublicId,
            });
        }
    }

    return result;
}
