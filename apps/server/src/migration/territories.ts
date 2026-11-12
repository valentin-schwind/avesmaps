import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    LEGACY_POLITICAL_MAX_BAND,
    upperPoliticalBandFromLegacy,
} from "@avesmaps3d/shared";
import { MigrationAborted } from "./places.ts";

/**
 * Legacys öffentlicher Export der Herrschaftsgebiete, übersetzt in das Zielmodell (WI-0062, ADR-0014).
 *
 * `GET https://avesmaps.de/api/app/political-territories-export.php` (Antwort:
 * `project-control/legacy-requests/2026-09-29-territorien-export-antwort.md`). REINE Übersetzung ohne Datenbank:
 * dieselbe Funktion füttert den Import und die Paritätsprüfung, damit beide nie auseinanderlaufen.
 *
 * 🔴 Die Fallen des Exports, jede mit ihrem Verhalten:
 * - Verknüpft wird nur über `public_id`, nie über den Namen.
 * - „Offen“ ist doppelt kodiert (`valid_to_bf` = `null` oder 9999): beides wird `null`.
 * - `geometry` kann `null` sein, Ringe mit weniger als drei verschiedenen Punkten oder der Fläche 0 werden
 *   übersprungen (ein entarteter äußerer Ring nimmt sein Polygon, ein innerer fällt weg; bleibt nichts, entfällt
 *   die Fläche - immer im Bericht).
 * - Hängende Hauptstadt- und Sitz-Verweise werden NICHT geheilt (der Prüfer meldet sie als Befund).
 * - Ein Elter, der fehlt, ein Zyklus und eine Fläche ohne Gebiet brechen den Import ab: ein Baum mit Lücke wäre
 *   still falsch.
 * - Wappen: die Felder reisen unverändert mit, nichts wird geladen oder gezeigt (F8, WI-0063 Abschnitt 26.8).
 * - Bänder: Legacy klemmt jede Gebietsanfrage auf 6, seine Obergrenze 6 heißt „bis ganz nah“ und wird hier 8, an Gebiet
 *   und Fläche (`upperPoliticalBandFromLegacy`, EDIT-0003 T23, WI-0188). Untergrenzen und kleinere Obergrenzen bleiben.
 *   Eine Obergrenze über 6 bleibt, wie sie ist, und ist ein Befund: Legacys 6 wäre dann nicht mehr „oben“.
 */

export const CONTRACT_VERSION = "1";

export interface LegacyTerritoryRow {
    public_id?: unknown;
    name?: unknown;
    short_name?: unknown;
    type?: unknown;
    wiki_type?: unknown;
    parent_public_id?: unknown;
    status?: unknown;
    color?: unknown;
    opacity?: unknown;
    min_zoom?: unknown;
    max_zoom?: unknown;
    valid_from_bf?: unknown;
    valid_to_bf?: unknown;
    valid_label?: unknown;
    wiki_key?: unknown;
    wiki_url?: unknown;
    capital_place_public_id?: unknown;
    seat_place_public_id?: unknown;
    sort_order?: unknown;
    updated_at?: unknown;
    coat_of_arms_url?: unknown;
    coat_license_status?: unknown;
    coat_origin?: unknown;
}

export interface LegacyGeometryRow {
    public_id?: unknown;
    territory_public_id?: unknown;
    geometry?: { type?: unknown; coordinates?: unknown } | null;
    valid_from_bf?: unknown;
    valid_to_bf?: unknown;
    min_zoom?: unknown;
    max_zoom?: unknown;
    updated_at?: unknown;
}

export interface LegacyClaimRow {
    territory_public_id?: unknown;
    claimant_public_id?: unknown;
    sort_order?: unknown;
    source?: unknown;
}

export interface LegacyTerritoryPayload {
    ok?: boolean;
    map_revision?: number;
    territories_revision?: string;
    territories?: LegacyTerritoryRow[];
    geometries?: LegacyGeometryRow[];
    claims?: LegacyClaimRow[];
}

export interface TerritoryRecord {
    publicId: string;
    name: string;
    shortName: string | null;
    territoryType: string | null;
    wikiType: string | null;
    parentPublicId: string | null;
    statusText: string | null;
    color: string;
    opacity: number;
    minZoom: number | null;
    maxZoom: number | null;
    validFromBf: number | null;
    validToBf: number | null;
    validLabel: string | null;
    wikiKey: string | null;
    wikiUrl: string | null;
    capitalPlacePublicId: string | null;
    seatPlacePublicId: string | null;
    sortOrder: number;
    legacyUpdatedAt: string | null;
    coatRef: string | null;
    coatLicenseStatus: string | null;
    coatOrigin: string | null;
}

export type MultiPolygonCoordinates = number[][][][];

export interface AreaRecord {
    publicId: string;
    territoryPublicId: string;
    /** Immer ein MultiPolygon (ein Polygon wird eingepackt), ohne entartete Ringe. */
    coordinates: MultiPolygonCoordinates;
    validFromBf: number | null;
    validToBf: number | null;
    minZoom: number | null;
    maxZoom: number | null;
    legacyUpdatedAt: string | null;
    /** Wie viele entartete Polygone und Löcher diese Fläche verlor. */
    droppedPolygons: number;
    droppedHoles: number;
}

export interface ClaimRecord {
    territoryPublicId: string;
    claimantPublicId: string;
    sortOrder: number;
    source: "wiki" | "manual";
}

/** Ein Gebiet oder eine Fläche, deren Legacy-Obergrenze über 6 liegt (Befund `legacy_band_max_changed`). */
export interface BandAboveLegacyMax {
    table: "territory" | "territory_area";
    publicId: string;
    /** Bei einer Fläche der Name ihres Gebiets. */
    name: string;
    maxZoom: number;
}

export interface SkippedArea {
    publicId: string;
    territoryPublicId: string;
    reason: "geometry_null" | "geometry_unreadable" | "nothing_left";
}

export interface TerritoryTransform {
    territories: TerritoryRecord[];
    areas: AreaRecord[];
    claims: ClaimRecord[];
    /** Flächen, die nicht übernommen werden konnten (Befund, nichts wird geheilt). */
    skippedAreas: SkippedArea[];
    /** Wie viele Flächen ein entartetes Polygon oder Loch verloren, und wie viele Teile insgesamt. */
    areasWithDroppedParts: number;
    droppedPolygons: number;
    droppedHoles: number;
    /** Ansprüche, die auf unbekannte Gebiete zeigen (übersprungen). */
    rejectedClaims: number;
    /** `valid_to_bf` stand auf dem Sentinel 9999 (wird `null`). */
    openEndSentinels: number;
    /** Legacy-Obergrenzen über 6: Legacys 6 wäre nicht mehr „oben“ (WI-0188, wie WI-0129 S11). */
    bandsAboveLegacyMax: BandAboveLegacyMax[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: unknown, field: string, where: string): string {
    if (typeof value !== "string" || !UUID.test(value)) {
        throw new MigrationAborted(`${where}: ${field} ist keine UUID`, { value: String(value) });
    }
    return value.toLowerCase();
}

function asOptionalUuid(value: unknown, field: string, where: string): string | null {
    if (value === null || value === undefined || value === "") return null;
    return asUuid(value, field, where);
}

function asText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

function asInteger(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
}

/** Ein Zoomband in Legacy-Zoom; ungültige Werte (außerhalb 0 bis 8) brechen ab, denn das Schema lehnt sie ab. */
function asZoom(value: unknown, where: string, field: string): number | null {
    const zoom = asInteger(value);
    if (zoom === null) return null;
    if (zoom < 0 || zoom > 8) {
        throw new MigrationAborted(`${where}: ${field} liegt außerhalb 0 bis 8`, { value: zoom });
    }
    return zoom;
}

export function normalizeValidTo(value: unknown, openEndBf: number): { value: number | null; sentinel: boolean } {
    const number = asInteger(value);
    if (number === null) return { value: null, sentinel: false };
    return number === openEndBf ? { value: null, sentinel: true } : { value: number, sentinel: false };
}

function ringPoints(ring: unknown): [number, number][] | null {
    if (!Array.isArray(ring)) return null;
    const points: [number, number][] = [];
    for (const point of ring) {
        if (!Array.isArray(point)) return null;
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        points.push([x, y]);
    }
    return points;
}

/** Fläche eines Rings (Schuhbandformel); 0 heißt entartet. */
function ringArea(points: readonly [number, number][]): number {
    let twice = 0;
    for (let index = 0; index + 1 < points.length; index += 1) {
        const [x1, y1] = points[index] as [number, number];
        const [x2, y2] = points[index + 1] as [number, number];
        twice += x1 * y2 - x2 * y1;
    }
    return Math.abs(twice) / 2;
}

/** Ein Ring taugt, wenn er geschlossen ist, mindestens drei verschiedene Punkte und eine Fläche hat. */
export function isUsableRing(points: readonly [number, number][]): boolean {
    if (points.length < 4) return false;
    const first = points[0] as [number, number];
    const last = points[points.length - 1] as [number, number];
    if (first[0] !== last[0] || first[1] !== last[1]) return false;
    const distinct = new Set(points.map((point) => `${String(point[0])},${String(point[1])}`));
    return distinct.size >= 3 && ringArea(points) > 0;
}

interface CleanedGeometry {
    coordinates: MultiPolygonCoordinates;
    droppedPolygons: number;
    droppedHoles: number;
}

/**
 * Aus dem GeoJSON einer Fläche ein MultiPolygon ohne entartete Teile. `undefined`, wenn die Form nicht lesbar ist
 * (weder Polygon noch MultiPolygon, Punkte keine Zahlen).
 */
export function cleanGeometry(geometry: { type?: unknown; coordinates?: unknown }): CleanedGeometry | undefined {
    let polygons: unknown[];
    if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) polygons = [geometry.coordinates];
    else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) polygons = geometry.coordinates;
    else return undefined;
    const kept: MultiPolygonCoordinates = [];
    let droppedPolygons = 0;
    let droppedHoles = 0;
    for (const polygon of polygons) {
        if (!Array.isArray(polygon) || polygon.length === 0) return undefined;
        const rings = polygon.map(ringPoints);
        if (rings.some((ring) => ring === null)) return undefined;
        const [outer, ...holes] = rings as [number, number][][];
        if (!outer || !isUsableRing(outer)) {
            droppedPolygons += 1;
            continue;
        }
        const usableHoles = holes.filter((hole) => isUsableRing(hole));
        droppedHoles += holes.length - usableHoles.length;
        kept.push([outer, ...usableHoles]);
    }
    return { coordinates: kept, droppedPolygons, droppedHoles };
}

/**
 * Die Quelle muss mit sich übereinstimmen, ehe etwas geschrieben wird: eine gekürzte Übertragung sähe für den
 * Importer aus wie ein Massenlöschen.
 *
 * 🔴 Bleibt ein Abbruch (Betreiber 2026-10-03, „A auch für die Prüfungen“, BLOCKING_SOURCE_CHECKS A17); ebenso eine
 * unlesbare Zeile und ein kaputter Baum in `transformTerritories` (A18).
 */
export function assertTerritorySourceComplete(payload: LegacyTerritoryPayload): void {
    if (payload.ok !== true) {
        throw new MigrationAborted("der Export meldet nicht ok", { ok: String(payload.ok) });
    }
    if (typeof payload.territories_revision !== "string" || payload.territories_revision === "") {
        throw new MigrationAborted("der Export trägt keinen Stempel territories_revision", {});
    }
    if (!Array.isArray(payload.territories) || payload.territories.length === 0) {
        throw new MigrationAborted("der Export enthält keine Gebiete", {});
    }
    if (!Array.isArray(payload.geometries) || !Array.isArray(payload.claims)) {
        throw new MigrationAborted("der Export trägt geometries oder claims nicht", {});
    }
}

function detectCycle(records: readonly TerritoryRecord[]): string | undefined {
    const parentOf = new Map(records.map((record) => [record.publicId, record.parentPublicId]));
    const done = new Set<string>();
    for (const record of records) {
        const path = new Set<string>();
        let current: string | null | undefined = record.publicId;
        while (current && !done.has(current)) {
            if (path.has(current)) return current;
            path.add(current);
            current = parentOf.get(current);
        }
        for (const id of path) done.add(id);
    }
    return undefined;
}

export function transformTerritories(payload: LegacyTerritoryPayload): TerritoryTransform {
    assertTerritorySourceComplete(payload);
    const openEndBf = AVENTURIA_POLITICAL_CARTOGRAPHY.openEndBf;
    let openEndSentinels = 0;
    const bandsAboveLegacyMax: BandAboveLegacyMax[] = [];

    const territories: TerritoryRecord[] = [];
    const seen = new Set<string>();
    for (const row of payload.territories as LegacyTerritoryRow[]) {
        const publicId = asUuid(row.public_id, "public_id", "Gebiet");
        const where = `Gebiet ${publicId}`;
        if (seen.has(publicId)) throw new MigrationAborted(`${where}: public_id kommt doppelt vor`, {});
        seen.add(publicId);
        const name = asText(row.name);
        if (name === null) throw new MigrationAborted(`${where}: kein Name`, {});
        const color = typeof row.color === "string" ? row.color.trim() : "";
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new MigrationAborted(`${where}: Farbe unlesbar`, { color });
        const opacity = Number(row.opacity);
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
            throw new MigrationAborted(`${where}: Deckkraft außerhalb 0 bis 1`, { opacity: String(row.opacity) });
        }
        const validTo = normalizeValidTo(row.valid_to_bf, openEndBf);
        if (validTo.sentinel) openEndSentinels += 1;
        const minZoom = asZoom(row.min_zoom, where, "min_zoom");
        const legacyMaxZoom = asZoom(row.max_zoom, where, "max_zoom");
        if (minZoom !== null && legacyMaxZoom !== null && minZoom > legacyMaxZoom) {
            throw new MigrationAborted(`${where}: min_zoom liegt über max_zoom`, { minZoom, maxZoom: legacyMaxZoom });
        }
        if (legacyMaxZoom !== null && legacyMaxZoom > LEGACY_POLITICAL_MAX_BAND) {
            bandsAboveLegacyMax.push({ table: "territory", publicId, name, maxZoom: legacyMaxZoom });
        }
        const maxZoom = upperPoliticalBandFromLegacy(legacyMaxZoom);
        territories.push({
            publicId,
            name,
            shortName: asText(row.short_name),
            territoryType: asText(row.type),
            wikiType: asText(row.wiki_type),
            parentPublicId: asOptionalUuid(row.parent_public_id, "parent_public_id", where),
            statusText: asText(row.status),
            color: color.toLowerCase(),
            opacity,
            minZoom,
            maxZoom,
            validFromBf: asInteger(row.valid_from_bf),
            validToBf: validTo.value,
            validLabel: asText(row.valid_label),
            wikiKey: asText(row.wiki_key),
            wikiUrl: asText(row.wiki_url),
            capitalPlacePublicId: asOptionalUuid(row.capital_place_public_id, "capital_place_public_id", where),
            seatPlacePublicId: asOptionalUuid(row.seat_place_public_id, "seat_place_public_id", where),
            sortOrder: asInteger(row.sort_order) ?? 0,
            legacyUpdatedAt: asText(row.updated_at),
            coatRef: asText(row.coat_of_arms_url),
            coatLicenseStatus: asText(row.coat_license_status),
            coatOrigin: asText(row.coat_origin),
        });
    }

    // Der Baum muss ganz sein: ein fehlender Elter machte ein Gebiet still zum Reich.
    for (const record of territories) {
        if (record.parentPublicId !== null && !seen.has(record.parentPublicId)) {
            throw new MigrationAborted(`Gebiet ${record.publicId}: der Elter ${record.parentPublicId} fehlt`, {
                name: record.name,
            });
        }
    }
    const cycle = detectCycle(territories);
    if (cycle !== undefined) throw new MigrationAborted(`der Baum enthält einen Zyklus bei ${cycle}`, {});
    const territoryNames = new Map(territories.map((record) => [record.publicId, record.name]));

    const areas: AreaRecord[] = [];
    const skippedAreas: SkippedArea[] = [];
    const seenAreas = new Set<string>();
    let areasWithDroppedParts = 0;
    let droppedPolygons = 0;
    let droppedHoles = 0;
    for (const row of payload.geometries as LegacyGeometryRow[]) {
        const publicId = asUuid(row.public_id, "public_id", "Fläche");
        const where = `Fläche ${publicId}`;
        if (seenAreas.has(publicId)) throw new MigrationAborted(`${where}: public_id kommt doppelt vor`, {});
        seenAreas.add(publicId);
        const territoryPublicId = asUuid(row.territory_public_id, "territory_public_id", where);
        // Eine Fläche ohne Gebiet gibt es im Schema nicht - und darf es in der Quelle nicht geben.
        if (!seen.has(territoryPublicId)) {
            throw new MigrationAborted(`${where}: das Gebiet ${territoryPublicId} fehlt`, {});
        }
        if (row.geometry === null || row.geometry === undefined) {
            skippedAreas.push({ publicId, territoryPublicId, reason: "geometry_null" });
            continue;
        }
        const cleaned = cleanGeometry(row.geometry);
        if (cleaned === undefined) {
            skippedAreas.push({ publicId, territoryPublicId, reason: "geometry_unreadable" });
            continue;
        }
        if (cleaned.droppedPolygons > 0 || cleaned.droppedHoles > 0) areasWithDroppedParts += 1;
        droppedPolygons += cleaned.droppedPolygons;
        droppedHoles += cleaned.droppedHoles;
        if (cleaned.coordinates.length === 0) {
            skippedAreas.push({ publicId, territoryPublicId, reason: "nothing_left" });
            continue;
        }
        const validTo = normalizeValidTo(row.valid_to_bf, openEndBf);
        if (validTo.sentinel) openEndSentinels += 1;
        const minZoom = asZoom(row.min_zoom, where, "min_zoom");
        const legacyMaxZoom = asZoom(row.max_zoom, where, "max_zoom");
        if (minZoom !== null && legacyMaxZoom !== null && minZoom > legacyMaxZoom) {
            throw new MigrationAborted(`${where}: min_zoom liegt über max_zoom`, { minZoom, maxZoom: legacyMaxZoom });
        }
        if (legacyMaxZoom !== null && legacyMaxZoom > LEGACY_POLITICAL_MAX_BAND) {
            bandsAboveLegacyMax.push({
                table: "territory_area",
                publicId,
                name: territoryNames.get(territoryPublicId) ?? territoryPublicId,
                maxZoom: legacyMaxZoom,
            });
        }
        const maxZoom = upperPoliticalBandFromLegacy(legacyMaxZoom);
        areas.push({
            publicId,
            territoryPublicId,
            coordinates: cleaned.coordinates,
            validFromBf: asInteger(row.valid_from_bf),
            validToBf: validTo.value,
            minZoom,
            maxZoom,
            legacyUpdatedAt: asText(row.updated_at),
            droppedPolygons: cleaned.droppedPolygons,
            droppedHoles: cleaned.droppedHoles,
        });
    }

    const claims: ClaimRecord[] = [];
    let rejectedClaims = 0;
    const seenClaims = new Set<string>();
    for (const row of payload.claims as LegacyClaimRow[]) {
        const territoryPublicId = asOptionalUuid(row.territory_public_id, "territory_public_id", "Anspruch");
        const claimantPublicId = asOptionalUuid(row.claimant_public_id, "claimant_public_id", "Anspruch");
        const source = row.source === "wiki" || row.source === "manual" ? row.source : undefined;
        const key = `${String(territoryPublicId)}>${String(claimantPublicId)}`;
        if (
            territoryPublicId === null ||
            claimantPublicId === null ||
            territoryPublicId === claimantPublicId ||
            !seen.has(territoryPublicId) ||
            !seen.has(claimantPublicId) ||
            source === undefined ||
            seenClaims.has(key)
        ) {
            rejectedClaims += 1;
            continue;
        }
        seenClaims.add(key);
        claims.push({ territoryPublicId, claimantPublicId, sortOrder: asInteger(row.sort_order) ?? 0, source });
    }

    return {
        territories,
        areas,
        claims,
        skippedAreas,
        areasWithDroppedParts,
        droppedPolygons,
        droppedHoles,
        rejectedClaims,
        openEndSentinels,
        bandsAboveLegacyMax,
    };
}
