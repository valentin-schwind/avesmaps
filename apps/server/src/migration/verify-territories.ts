import { AVENTURIA } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { transformTerritories, type LegacyTerritoryPayload, type TerritoryRecord } from "./territories.ts";

/**
 * Parität der Herrschaftsgebiete gegen dieselbe Datei (WI-0062, ADR-0014).
 *
 * Geprüft wird das AGGREGAT, nicht nur die Zeilenzahl: dass Baum, Farben, Bänder, Gültigkeit und Wappenfelder Feld für
 * Feld stimmen, dass jede Fläche ein aktives Gebiet hat, dass die Geometrie Punkt für Punkt dieselbe ist (bis auf die
 * entarteten Ringe, die der Import bewusst auslässt) und dass der Baum keinen Zyklus hat.
 *
 * Befunde sind KEINE Fehler: Sie melden, was in Legacys Bestand redaktionell auffällig ist (ungültige Flächen, hängende
 * Hauptstadtverweise, Platzhalter). AGENTS.md: was falsch aussieht, wird befundet und vorgelegt, nicht korrigiert.
 */

export interface ParityCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface TerritoryParityReport {
    passed: boolean;
    stamp: string;
    checks: ParityCheck[];
    /** Befunde für die Redaktion, ohne Einfluss auf das Urteil. */
    findings: string[];
}

const SAMPLE = 5;

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): ParityCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

interface StoredTerritory {
    public_id: string;
    name: string;
    short_name: string | null;
    territory_type: string | null;
    wiki_type: string | null;
    status_text: string | null;
    color: string;
    opacity: string;
    min_zoom: number | null;
    max_zoom: number | null;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    valid_label: string | null;
    wiki_key: string | null;
    wiki_url: string | null;
    capital_place_public_id: string | null;
    seat_place_public_id: string | null;
    sort_order: number;
    coat_ref: string | null;
    coat_license_status: string | null;
    coat_origin: string | null;
    parent_public_id: string | null;
}

/** Die Felder eines Gebiets, wie Datei und Datenbank sie in gleicher Form nennen. */
function expectedFields(record: TerritoryRecord): Omit<StoredTerritory, "opacity"> & { opacity: number } {
    return {
        public_id: record.publicId,
        name: record.name,
        short_name: record.shortName,
        territory_type: record.territoryType,
        wiki_type: record.wikiType,
        status_text: record.statusText,
        color: record.color,
        opacity: record.opacity,
        min_zoom: record.minZoom,
        max_zoom: record.maxZoom,
        valid_from_bf: record.validFromBf,
        valid_to_bf: record.validToBf,
        valid_label: record.validLabel,
        wiki_key: record.wikiKey,
        wiki_url: record.wikiUrl,
        capital_place_public_id: record.capitalPlacePublicId,
        seat_place_public_id: record.seatPlacePublicId,
        sort_order: record.sortOrder,
        coat_ref: record.coatRef,
        coat_license_status: record.coatLicenseStatus,
        coat_origin: record.coatOrigin,
        parent_public_id: record.parentPublicId,
    };
}

export async function verifyTerritories(
    database: Database,
    payload: LegacyTerritoryPayload,
    options: { mapDomainId?: string } = {},
): Promise<TerritoryParityReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const expected = transformTerritories(payload);
    const stamp = payload.territories_revision as string;
    const checks: ParityCheck[] = [];
    const findings: string[] = [];

    // ---- Bestand ---------------------------------------------------------------------------------------------
    const [counts] = await database<{ territories: number; areas: number; claims: number }[]>`
        SELECT
            (SELECT count(*)::int FROM territory WHERE map_domain_id = ${mapDomainId} AND is_active) AS territories,
            (SELECT count(*)::int FROM territory_area WHERE map_domain_id = ${mapDomainId} AND is_active) AS areas,
            (SELECT count(*)::int FROM territory_claim WHERE is_active) AS claims
    `;
    checks.push(
        check(
            "count_parity",
            counts?.territories === expected.territories.length &&
                counts?.areas === expected.areas.length &&
                counts?.claims === expected.claims.length,
            `Quelle ${String(expected.territories.length)}/${String(expected.areas.length)}/${String(expected.claims.length)}, ` +
                `Ziel ${String(counts?.territories)}/${String(counts?.areas)}/${String(counts?.claims)} (Gebiete/Flächen/Ansprüche)`,
        ),
    );

    // ---- Felder, Baum -----------------------------------------------------------------------------------------
    const stored = await database<StoredTerritory[]>`
        SELECT t.public_id::text, t.name, t.short_name, t.territory_type, t.wiki_type, t.status_text, t.color,
               t.opacity::text, t.min_zoom, t.max_zoom, t.valid_from_bf, t.valid_to_bf, t.valid_label,
               t.wiki_key, t.wiki_url, t.capital_place_public_id::text, t.seat_place_public_id::text,
               t.sort_order, t.coat_ref, t.coat_license_status, t.coat_origin, p.public_id::text AS parent_public_id
        FROM territory t
        LEFT JOIN territory p ON p.id = t.parent_id
        WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
    `;
    const storedById = new Map(stored.map((row) => [row.public_id, row]));
    const differing: string[] = [];
    const treeDiffering: string[] = [];
    for (const record of expected.territories) {
        const want = expectedFields(record);
        const have = storedById.get(record.publicId);
        if (!have) {
            differing.push(`${record.publicId} fehlt`);
            continue;
        }
        if (have.parent_public_id !== want.parent_public_id) {
            treeDiffering.push(
                `${record.name}: Elter ${String(have.parent_public_id)} statt ${String(want.parent_public_id)}`,
            );
        }
        const wrong = (Object.keys(want) as (keyof typeof want)[]).filter((key) => {
            if (key === "parent_public_id") return false;
            if (key === "opacity") return Number(have.opacity) !== want.opacity;
            return have[key] !== want[key];
        });
        if (wrong.length > 0) differing.push(`${record.name}: ${wrong.join(", ")}`);
    }
    checks.push(
        check(
            "field_parity",
            differing.length === 0,
            differing.length === 0
                ? "alle Felder der Gebiete stimmen (Name, Art, Farbe, Deckkraft, Bänder, Gültigkeit, Wiki, Hauptstadt, Wappenfelder)"
                : `${String(differing.length)} Gebiete weichen ab`,
            differing,
        ),
    );
    checks.push(
        check(
            "tree_parity",
            treeDiffering.length === 0,
            treeDiffering.length === 0 ? "der Baum stimmt" : `${String(treeDiffering.length)} Eltern weichen ab`,
            treeDiffering,
        ),
    );

    // ---- Baum: keine Waisen, keine Zyklen ---------------------------------------------------------------------
    const orphanAreas = await database<{ public_id: string }[]>`
        SELECT a.public_id::text
        FROM territory_area a
        LEFT JOIN territory t ON t.id = a.territory_id
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND (t.id IS NULL OR NOT t.is_active)
    `;
    checks.push(
        check(
            "no_orphan_areas",
            orphanAreas.length === 0,
            orphanAreas.length === 0
                ? "jede aktive Fläche gehört einem aktiven Gebiet"
                : `${String(orphanAreas.length)} Flächen ohne aktives Gebiet`,
            orphanAreas.map((row) => row.public_id),
        ),
    );
    const danglingParents = await database<{ public_id: string }[]>`
        SELECT t.public_id::text
        FROM territory t
        JOIN territory p ON p.id = t.parent_id
        WHERE t.map_domain_id = ${mapDomainId} AND t.is_active AND NOT p.is_active
    `;
    checks.push(
        check(
            "no_dangling_parents",
            danglingParents.length === 0,
            danglingParents.length === 0
                ? "kein aktives Gebiet hängt an einem stillgelegten Elter"
                : `${String(danglingParents.length)} hängende Eltern`,
            danglingParents.map((row) => row.public_id),
        ),
    );
    const cycles = await database<{ public_id: string }[]>`
        WITH RECURSIVE walk AS (
            SELECT id, parent_id, 1 AS depth FROM territory WHERE map_domain_id = ${mapDomainId}
            UNION ALL
            SELECT w.id, t.parent_id, w.depth + 1
            FROM walk w JOIN territory t ON t.id = w.parent_id
            WHERE w.depth < 64
        )
        SELECT DISTINCT t.public_id::text
        FROM walk w JOIN territory t ON t.id = w.id
        WHERE w.depth >= 64
    `;
    checks.push(
        check(
            "no_cycles",
            cycles.length === 0,
            cycles.length === 0 ? "der Baum hat keinen Zyklus" : `${String(cycles.length)} Gebiete in einem Zyklus`,
            cycles.map((row) => row.public_id),
        ),
    );

    // ---- Geometrie: Punkt für Punkt ---------------------------------------------------------------------------
    const ids = expected.areas.map((area) => area.publicId);
    const geojson = expected.areas.map((area) =>
        JSON.stringify({ type: "MultiPolygon", coordinates: area.coordinates }),
    );
    const areaFields = expected.areas.map(
        (area) =>
            `${String(area.validFromBf)}|${String(area.validToBf)}|${String(area.minZoom)}|${String(area.maxZoom)}|${area.territoryPublicId}`,
    );
    const geometryDiffering = await database<{ public_id: string }[]>`
        SELECT e.public_id::text
        FROM unnest(${ids}::uuid[], ${geojson}::text[]) AS e(public_id, gj)
        LEFT JOIN territory_area a ON a.public_id = e.public_id AND a.is_active
        WHERE a.id IS NULL
           OR NOT ST_OrderingEquals(a.geom, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(e.gj), 0)))
    `;
    checks.push(
        check(
            "geometry_parity",
            geometryDiffering.length === 0,
            geometryDiffering.length === 0
                ? `${String(ids.length)} Flächen Punkt für Punkt gleich`
                : `${String(geometryDiffering.length)} Flächen weichen ab`,
            geometryDiffering.map((row) => row.public_id),
        ),
    );
    const fieldsDiffering = await database<{ public_id: string }[]>`
        SELECT e.public_id::text
        FROM unnest(${ids}::uuid[], ${areaFields}::text[]) AS e(public_id, fields)
        LEFT JOIN territory_area a ON a.public_id = e.public_id AND a.is_active
        LEFT JOIN territory t ON t.id = a.territory_id
        WHERE a.id IS NULL
           OR concat_ws('|', coalesce(a.valid_from_bf::text, 'null'), coalesce(a.valid_to_bf::text, 'null'),
                        coalesce(a.min_zoom::text, 'null'), coalesce(a.max_zoom::text, 'null'), t.public_id::text)
              <> e.fields
    `;
    checks.push(
        check(
            "area_field_parity",
            fieldsDiffering.length === 0,
            fieldsDiffering.length === 0
                ? "Gültigkeit, Zoomband und Gebiet aller Flächen stimmen"
                : `${String(fieldsDiffering.length)} Flächen weichen ab`,
            fieldsDiffering.map((row) => row.public_id),
        ),
    );

    // ---- Stempel ----------------------------------------------------------------------------------------------
    const [state] = await database<{ source_stamp: string | null }[]>`
        SELECT source_stamp FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    checks.push(
        check(
            "source_stamp",
            state?.source_stamp === stamp,
            `Stempel der Quelle ${stamp}, im Ziel ${String(state?.source_stamp)}`,
        ),
    );

    // ---- Befunde (ohne Einfluss auf das Urteil) ---------------------------------------------------------------
    const [numbers] = await database<
        {
            invalid: number;
            withoutArea: number;
            placeholders: number;
            danglingCapital: number;
            danglingSeat: number;
        }[]
    >`
        SELECT
            (SELECT count(*)::int FROM territory_area WHERE map_domain_id = ${mapDomainId} AND is_active AND NOT is_valid) AS invalid,
            (SELECT count(*)::int FROM territory t WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
                AND NOT EXISTS (SELECT 1 FROM territory_area a WHERE a.territory_id = t.id AND a.is_active)) AS "withoutArea",
            (SELECT count(*)::int FROM territory t WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
                AND t.name ~ '^Neues Herrschaftsgebiet \\(\\d+\\)$'
                AND NOT EXISTS (SELECT 1 FROM territory_area a WHERE a.territory_id = t.id AND a.is_active)
                AND NOT EXISTS (SELECT 1 FROM territory k WHERE k.parent_id = t.id)) AS placeholders,
            (SELECT count(*)::int FROM territory t WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
                AND t.capital_place_public_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM place p WHERE p.public_id = t.capital_place_public_id AND p.is_active)) AS "danglingCapital",
            (SELECT count(*)::int FROM territory t WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
                AND t.seat_place_public_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM place p WHERE p.public_id = t.seat_place_public_id AND p.is_active)) AS "danglingSeat"
    `;
    if (numbers) {
        findings.push(
            `${String(numbers.invalid)} Flächen sind ungültig (Schleifen, Löcher außerhalb); die Ableitung repariert sie beim Lesen`,
        );
        findings.push(`${String(numbers.withoutArea)} Gebiete ohne eigene Fläche (Aggregate und Blätter)`);
        findings.push(
            `${String(numbers.placeholders)} Platzhalter „Neues Herrschaftsgebiet (n)“ ohne Fläche und ohne Kinder`,
        );
        findings.push(
            `${String(numbers.danglingCapital)} Hauptstadt- und ${String(numbers.danglingSeat)} Sitz-Verweise ohne aktiven Ort (nicht geheilt)`,
        );
    }
    findings.push(
        `${String(expected.droppedPolygons)} entartete Polygone und ${String(expected.droppedHoles)} entartete Löcher in ` +
            `${String(expected.areasWithDroppedParts)} Flächen beim Import ausgelassen; ${String(expected.skippedAreas.length)} Flächen ganz übersprungen`,
    );
    if (expected.rejectedClaims > 0) findings.push(`${String(expected.rejectedClaims)} Ansprüche nicht übernommen`);

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    const settled = settleChecks("verify:territories", checks);
    return { passed: settled.passed, stamp, checks: settled.checks, findings };
}
