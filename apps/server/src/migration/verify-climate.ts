import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { CLIMATE_ZONES, MIN_GAP, type ClimateCheck, type LegacyBand } from "./climate.ts";

/** Ein Ort mit der Klimazone, die Legacy selbst dafuer ausweist. */
export interface LegacyPlaceZone {
    x: number;
    y: number;
    zone: string;
}

/**
 * Liest die Orte mit Klimazone aus `map-features.json`.
 *
 * ⭐ Das ist der einzige UNABHAENGIGE Zeuge in diesem Contract. `baender_gleich_wie_legacy`
 * vergleicht unsere Geometrie mit Legacys Geometrie; diese Zahlen hat Legacy dagegen zur Laufzeit
 * selbst gerechnet, mit seinem eigenen Punkt-in-Polygon. Stimmen beide ueberein, ist nicht nur die
 * Form richtig, sondern auch die Zuordnung Band zu Zonenschluessel.
 */
export function readLegacyPlaceZones(payload: unknown): LegacyPlaceZone[] {
    const root = payload as { features?: unknown[] };
    const places: LegacyPlaceZone[] = [];
    for (const entry of root.features ?? []) {
        const feature = entry as {
            properties?: { climate_zone?: string; feature_type?: string };
            geometry?: { type?: string; coordinates?: number[] };
        };
        const zone = feature.properties?.climate_zone;
        const coordinates = feature.geometry?.coordinates;
        // 🪤 `feature_type === "location"` steht hier ausdruecklich, obwohl im Snapshot 140088
        // GENAU die 3426 Locations eine Zone tragen und sonst nichts. Ohne den Filter haengt die
        // Zahl an einer Eigenschaft, die zufaellig gilt: Legacy haengt `climate_zone` heute nur an
        // Orte, koennte es aber morgen auch an ein Label haengen. Dann zaehlte dieses Gate
        // stillschweigend etwas anderes, als sein Name sagt.
        if (
            zone &&
            feature.properties?.feature_type === "location" &&
            feature.geometry?.type === "Point" &&
            coordinates?.length === 2
        ) {
            places.push({ x: coordinates[0] as number, y: coordinates[1] as number, zone });
        }
    }
    return places;
}

/**
 * Die Gates aus dem Contract `climate.yaml` (WI-0005).
 *
 * Jede dieser Prüfungen darf den Plan widerlegen. Wird eine rot, ist zu berichten — nicht passend zu machen
 * (Betreiberauftrag 2026-09-21). 🔴 Seit 2026-10-03 hält keine von ihnen den Lauf an (Betreiber: „B“, nur melden): Eine
 * ausgefallene Prüfung ist ein Befund mit Zahlen und den betroffenen Zonen und Linien, das Urteil bleibt grün.
 *
 * Die schärfste ist `baender_gleich_wie_legacy`: sie schließt den Kreis. Entstehen aus den
 * rekonstruierten Linien wieder exakt Legacys Bänder, war die Annahme hinter der ganzen
 * Rekonstruktion richtig.
 */

export interface ClimateReport {
    passed: boolean;
    checks: ClimateCheck[];
}

const SAMPLE = 5;

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): ClimateCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

/** Erwartete Punktzahlen der sieben Linien, am 2026-09-21 gemessen (Contract). */
const EXPECTED_POINTS = [33, 42, 31, 39, 111, 113, 69];

/** Erwartete Zahl senkrecht mehrteiliger Stellen je Band — der Nachweis, dass Blasen erhalten sind. */
const EXPECTED_BUBBLES: Record<string, number> = {
    polar: 0,
    subpolar: 4,
    boreal: 4,
    gemaessigt: 0,
    subtropen_winterfeucht: 78,
    trockene_subtropen: 112,
    subtropisch: 98,
    tropisch: 7,
};

export async function verifyClimate(
    database: Database,
    legacyBands: readonly LegacyBand[],
    legacyPlaces: readonly LegacyPlaceZone[] = [],
): Promise<ClimateReport> {
    const checks: ClimateCheck[] = [];
    const byType = new Map(legacyBands.map((band) => [band.typeKey, band.geoJson]));

    const [counts] = await database<{ zones: number; dividers: number; bands: number }[]>`
        SELECT (SELECT count(*)::int FROM climate_zone_type) AS zones,
               (SELECT count(*)::int FROM climate_divider) AS dividers,
               (SELECT count(*)::int FROM climate_band) AS bands
    `;
    checks.push(
        check("zonen_vollzaehlig", counts?.zones === 8, `${String(counts?.zones ?? 0)} Zonentypen (erwartet 8)`),
    );
    checks.push(
        check(
            "linien_anzahl",
            counts?.dividers === 7,
            `${String(counts?.dividers ?? 0)} Trennlinien (erwartet 7 = Zonenzahl minus eins)`,
        ),
    );

    const orderMismatch = await database<{ type_key: string; sort_order: number }[]>`
        SELECT type_key, sort_order FROM climate_zone_type
        WHERE (type_key, sort_order) NOT IN (
            ('polar', 10), ('subpolar', 20), ('boreal', 30), ('gemaessigt', 40),
            ('subtropen_winterfeucht', 50), ('trockene_subtropen', 55),
            ('subtropisch', 60), ('tropisch', 70)
        )
    `;
    checks.push(
        check(
            "zonenordnung",
            orderMismatch.length === 0,
            orderMismatch.length === 0 ? "Schlüssel und Nord-Süd-Reihenfolge wie im Contract" : "Reihenfolge weicht ab",
            orderMismatch.map((row) => `${row.type_key}: ${String(row.sort_order)}`),
        ),
    );

    // Jedes Zonenpaar braucht genau eine Linie, jede Linie ihr Paar.
    const identity = await database<{ missing: string }[]>`
        WITH pairs AS (
            SELECT t.type_key AS south
            FROM climate_zone_type t
            WHERE t.sort_order > (SELECT min(sort_order) FROM climate_zone_type)
        )
        SELECT p.south AS missing FROM pairs p
        WHERE NOT EXISTS (SELECT 1 FROM climate_divider d WHERE d.south_type_key = p.south)
    `;
    checks.push(
        check(
            "linien_identitaet",
            identity.length === 0,
            identity.length === 0 ? "jedes Zonenpaar trägt seine Linie" : `${String(identity.length)} Paare ohne Linie`,
            identity.map((row) => row.missing),
        ),
    );

    const malformed = await database<{ south_type_key: string; detail: string }[]>`
        SELECT south_type_key,
               format('x %s..%s, %s Punkte, einfach=%s',
                      ST_X(ST_StartPoint(geom)), ST_X(ST_EndPoint(geom)),
                      ST_NPoints(geom), ST_IsSimple(geom)) AS detail
        FROM climate_divider
        WHERE ST_X(ST_StartPoint(geom)) <> 0 OR ST_X(ST_EndPoint(geom)) <> 1024
           OR ST_NPoints(geom) > 500 OR ST_NPoints(geom) < 2 OR NOT ST_IsSimple(geom)
    `;
    checks.push(
        check(
            "linien_normalisierung",
            malformed.length === 0,
            malformed.length === 0
                ? "jede Linie läuft von Rand zu Rand, ohne Selbstschnitt"
                : `${String(malformed.length)} Linien verletzen die Form`,
            malformed.map((row) => `${row.south_type_key}: ${row.detail}`),
        ),
    );

    // Nord nach Süd: am Westrand muss y streng fallen, mit Mindestabstand.
    const ordering = await database<{ detail: string }[]>`
        WITH ordered AS (
            SELECT d.south_type_key, t.sort_order, ST_Y(ST_StartPoint(d.geom)) AS west_y
            FROM climate_divider d JOIN climate_zone_type t ON t.type_key = d.south_type_key
        ), pairs AS (
            SELECT a.south_type_key AS upper, b.south_type_key AS lower, a.west_y - b.west_y AS gap
            FROM ordered a JOIN ordered b ON b.sort_order > a.sort_order
            AND NOT EXISTS (SELECT 1 FROM ordered m WHERE m.sort_order > a.sort_order AND m.sort_order < b.sort_order)
        )
        SELECT format('%s über %s: Abstand %s', upper, lower, round(gap::numeric, 3)) AS detail
        FROM pairs WHERE gap < ${MIN_GAP}
    `;
    checks.push(
        check(
            "linien_ordnung",
            ordering.length === 0,
            ordering.length === 0
                ? `am Westrand streng fallend, Mindestabstand ${String(MIN_GAP)}`
                : `${String(ordering.length)} Paare zu eng`,
            ordering.map((row) => row.detail),
        ),
    );

    const crossing = await database<{ detail: string }[]>`
        SELECT format('%s kreuzt %s', a.south_type_key, b.south_type_key) AS detail
        FROM climate_divider a JOIN climate_divider b ON b.id > a.id
        WHERE ST_Crosses(a.geom, b.geom) OR ST_Overlaps(a.geom, b.geom)
    `;
    checks.push(
        check(
            "linien_kreuzungsfrei",
            crossing.length === 0,
            crossing.length === 0 ? "keine zwei Linien schneiden einander" : `${String(crossing.length)} Kreuzungen`,
            crossing.map((row) => row.detail),
        ),
    );

    const points = await database<{ south_type_key: string; pts: number; sort_order: number }[]>`
        SELECT d.south_type_key, ST_NPoints(d.geom) AS pts, t.sort_order
        FROM climate_divider d JOIN climate_zone_type t ON t.type_key = d.south_type_key
        ORDER BY t.sort_order
    `;
    const pointOffenders = points
        .map((row, index) => ({ row, expected: EXPECTED_POINTS[index] }))
        .filter((entry) => entry.row.pts !== entry.expected)
        .map((entry) => `${entry.row.south_type_key}: ${String(entry.row.pts)} statt ${String(entry.expected)}`);
    checks.push(
        check(
            "punktzahl_je_linie",
            pointOffenders.length === 0,
            pointOffenders.length === 0
                ? `${EXPECTED_POINTS.join(", ")} wie gemessen`
                : `${String(pointOffenders.length)} Linien mit abweichender Punktzahl`,
            pointOffenders,
        ),
    );

    const overlap = await database<{ detail: string }[]>`
        SELECT format('%s / %s: %s', a.type_key, b.type_key,
                      round(ST_Area(ST_Intersection(a.geom, b.geom))::numeric, 6)) AS detail
        FROM climate_band a JOIN climate_band b ON b.type_key <> a.type_key
        WHERE ST_Area(ST_Intersection(a.geom, b.geom)) > 0
    `;
    checks.push(
        check(
            "baender_ueberschneidungsfrei",
            overlap.length === 0,
            overlap.length === 0 ? "kein Band überlappt ein anderes" : `${String(overlap.length)} Überlappungen`,
            overlap.map((row) => row.detail),
        ),
    );

    const [coverage] = await database<{ total: string; gap: string; outside: string }[]>`
        WITH u AS (SELECT ST_Union(geom) AS g FROM climate_band)
        SELECT round(ST_Area(g)::numeric, 1)::text AS total,
               round(ST_Area(ST_Difference(ST_MakeEnvelope(0, 0, 1024, 1024, 0), g))::numeric, 2)::text AS gap,
               round(ST_Area(ST_Difference(g, ST_MakeEnvelope(0, 0, 1024, 1024, 0)))::numeric, 2)::text AS outside
        FROM u
    `;
    checks.push(
        check(
            "baender_lueckenlos",
            coverage?.total === "1048576.0" && coverage.gap === "0.00" && coverage.outside === "0.00",
            `Abdeckung ${String(coverage?.total)} von 1048576.0, unbedeckt ${String(coverage?.gap)}, außerhalb ${String(coverage?.outside)}`,
        ),
    );

    const invalid = await database<{ type_key: string; grund: string }[]>`
        SELECT type_key, ST_IsValidReason(geom) AS grund FROM climate_band WHERE NOT ST_IsValid(geom)
    `;
    checks.push(
        check(
            "baender_gueltig",
            invalid.length === 0,
            invalid.length === 0 ? "jedes Band ist gültige Geometrie" : `${String(invalid.length)} ungültig`,
            invalid.map((row) => `${row.type_key}: ${row.grund}`),
        ),
    );

    // 🔴 Die schärfste Prüfung: das abgeleitete Band IST Legacys Band.
    const differing: string[] = [];
    for (const zone of CLIMATE_ZONES) {
        const geoJson = byType.get(zone);
        if (!geoJson) {
            differing.push(`${zone}: fehlt im Snapshot`);
            continue;
        }
        const [row] = await database<{ same: boolean }[]>`
            SELECT ST_Equals(b.geom, ST_SetSRID(ST_GeomFromGeoJSON(${geoJson}), 0)) AS same
            FROM climate_band b WHERE b.type_key = ${zone}
        `;
        if (row?.same !== true) {
            differing.push(zone);
        }
    }
    checks.push(
        check(
            "baender_gleich_wie_legacy",
            differing.length === 0,
            differing.length === 0
                ? "jedes abgeleitete Band ist ST_Equals zu Legacys Band"
                : `${String(differing.length)} Bänder weichen ab`,
            differing,
        ),
    );

    // Blasen: die Zahl der senkrecht mehrteiligen Stellen je Band muss gleich bleiben.
    const bubbleOffenders: string[] = [];
    for (const zone of CLIMATE_ZONES) {
        const [row] = await database<{ stellen: number }[]>`
            WITH b AS (SELECT geom AS g FROM climate_band WHERE type_key = ${zone}),
            probe AS (
                SELECT ST_NumGeometries(ST_Multi(ST_Intersection(b.g,
                       ST_SetSRID(ST_MakeLine(ST_MakePoint(x, 0), ST_MakePoint(x, 1024)), 0)))) AS teile
                FROM b, generate_series(1, 1023, 2) AS x
            )
            SELECT count(*) FILTER (WHERE teile > 1)::int AS stellen FROM probe
        `;
        const expected = EXPECTED_BUBBLES[zone];
        if (row?.stellen !== expected) {
            bubbleOffenders.push(`${zone}: ${String(row?.stellen)} statt ${String(expected)}`);
        }
    }
    checks.push(
        check(
            "blasen_erhalten",
            bubbleOffenders.length === 0,
            bubbleOffenders.length === 0
                ? "die rückwärts laufenden Stücke sind unverändert"
                : `${String(bubbleOffenders.length)} Bänder mit anderer Blasenzahl`,
            bubbleOffenders,
        ),
    );

    // 🔴 Der einzige Vergleich gegen eine UNABHAENGIGE Quelle. Alles andere prueft unsere Geometrie
    // gegen Legacys Geometrie; diese Zonen hat Legacy zur Laufzeit selbst gerechnet.
    //
    // 🪤 Die Prueflinge sind Punkte auf einer Kante nicht ausgenommen: Legacys Even-Odd-Raycast
    // laesst den Kantenfall undefiniert, unser ST_Contains schliesst den Rand aus. Gemessen am
    // ganzen Bestand stimmen trotzdem 3426 von 3426 - deshalb bleibt die Schwelle bei NULL
    // Abweichungen. Wer sie spaeter lockert, verdeckt genau die Verwechslung, die dieser Test
    // fangen soll.
    if (legacyPlaces.length > 0) {
        const xs = legacyPlaces.map((place) => place.x);
        const ys = legacyPlaces.map((place) => place.y);
        const zones = legacyPlaces.map((place) => place.zone);
        const mismatched = await database<{ x: number; y: number; ours: string | null; legacy: string }[]>`
            WITH probe AS (
                SELECT ordinality AS i, x, y
                FROM unnest(${xs}::float8[], ${ys}::float8[]) WITH ORDINALITY AS t(x, y, ordinality)
            ), got AS (
                SELECT p.i, p.x, p.y,
                       (SELECT b.type_key FROM climate_band b
                        WHERE ST_Contains(b.geom, ST_SetSRID(ST_MakePoint(p.x, p.y), 0)) LIMIT 1) AS ours
                FROM probe p
            )
            SELECT g.x, g.y, g.ours, (${zones}::text[])[g.i] AS legacy
            FROM got g
            WHERE g.ours IS DISTINCT FROM (${zones}::text[])[g.i]
        `;
        checks.push(
            check(
                "zugehoerigkeit_ort",
                mismatched.length === 0,
                mismatched.length === 0
                    ? `${String(legacyPlaces.length)} Orte stimmen mit Legacys eigener Zone überein`
                    : `${String(mismatched.length)} von ${String(legacyPlaces.length)} Orten liegen in einer anderen Zone`,
                mismatched.map(
                    (row) => `(${String(row.x)}, ${String(row.y)}): ${String(row.ours)} statt ${row.legacy}`,
                ),
            ),
        );
    } else {
        // 🪤 Kein stiller Skip: eine Pruefung, die nicht lief, ist kein bestandenes Gate.
        checks.push(check("zugehoerigkeit_ort", false, "übersprungen — kein map-features.json übergeben"));
    }

    // Der Riegel: ein direkter Schreibversuch muss scheitern.
    //
    // 🪤 Geprüft wird mit einem INSERT, nicht mit einem UPDATE. Der Trigger ist `FOR EACH ROW` -
    // ein UPDATE, das keine Zeile trifft, feuert ihn nicht, und die Prüfung meldete auf leerer
    // Tabelle fälschlich "der Riegel greift nicht". Ein INSERT erzeugt immer eine Zeile und ist
    // damit unabhängig vom Bestand aussagekräftig. Die Transaktion wird ohnehin zurückgerollt.
    let guarded = false;
    let guardDetail = "";
    try {
        await database.begin(async (transaction) => {
            await transaction`
                INSERT INTO climate_band (type_key, geom, source_fingerprint)
                VALUES ('polar',
                        ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))'), 0),
                        'guard-probe')
                ON CONFLICT (type_key) DO UPDATE SET source_fingerprint = 'guard-probe'
            `;
            // Kommt der Lauf hierhin, hat der Riegel versagt - zurückgerollt wird trotzdem.
            throw new Error("__rollback__");
        });
    } catch (error) {
        guarded = !(error instanceof Error && error.message === "__rollback__");
        guardDetail = guarded ? String((error as Error).message).slice(0, 80) : "der Schreibversuch kam durch";
    }
    checks.push(
        check(
            "baender_nicht_mutierbar",
            guarded,
            guarded ? "ein direkter Schreibversuch scheitert am Riegel" : `💣 der Riegel greift NICHT: ${guardDetail}`,
        ),
    );

    // Betreiber 2026-10-03 („B“): Auch die Klima-Gates melden nur; `BLOCKING_CHECKS` enthält keine Klima-Prüfung mehr.
    return settleChecks("verify:climate", checks);
}
