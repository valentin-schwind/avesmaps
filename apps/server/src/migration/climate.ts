import { createHash } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding } from "../findings.ts";

/**
 * Klimazonen: die sieben Trennlinien gewinnen, die acht Bänder daraus ableiten (WI-0005, MCS-009).
 *
 * 🔴 Die Trennlinien sind die Wahrheit. Ein Band IST der Raum zwischen zwei Linien — „keine
 * Überlappung" ist deshalb keine Prüfung, sondern Bauart. Wer ein Band als eigenständiges Polygon
 * führt, baut die zweite Wahrheit ein, gegen die Legacy seinen Riegel gesetzt hat.
 *
 * Die Wurzel ist der geordnete SATZ, nicht die einzelne Linie: Reihenfolge, Mindestabstand,
 * Kreuzungsfreiheit und die vollständige Bandabdeckung sind Aussagen über den Satz als Ganzes.
 * Deshalb läuft der Import in EINER Transaktion und prüft danach den Verbund.
 */

/** Steigt, wenn sich die Ableitung ändert — und entwertet damit alle Bänder. */
export const CLIMATE_ALGORITHM_VERSION = "1";

/** Nord nach Süd. Diese Reihenfolge entscheidet, welche Linie zwischen welchen Zonen liegt. */
export const CLIMATE_ZONES = [
    "polar",
    "subpolar",
    "boreal",
    "gemaessigt",
    "subtropen_winterfeucht",
    "trockene_subtropen",
    "subtropisch",
    "tropisch",
] as const;

/** Legacys Mindestabstand zweier Linien am Westrand, in Karteneinheiten. */
export const MIN_GAP = 1.0;
const MAP_MIN = 0;
const MAP_MAX = 1024;

export interface LegacyBand {
    typeKey: string;
    geoJson: string;
}

export interface ClimateCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

/** Liest die acht Klimaflächen aus dem Snapshot. */
export function readLegacyBands(payload: unknown): LegacyBand[] {
    const root = payload as { areas?: unknown[] };
    const bands: LegacyBand[] = [];
    for (const entry of root.areas ?? []) {
        const area = entry as { kind?: string; region_type?: string; geometry?: unknown; geo?: unknown };
        if (area.kind !== "klima") {
            continue;
        }
        const geometry = area.geometry ?? area.geo;
        bands.push({
            typeKey: String(area.region_type),
            geoJson: typeof geometry === "string" ? geometry : JSON.stringify(geometry),
        });
    }
    return bands;
}

export interface ReconstructedDivider {
    /** Die Zone UNTERHALB der Linie — ihre stabile Identität. */
    southTypeKey: string;
    wkt: string;
    pointCount: number;
}

/**
 * Gewinnt die sieben Trennlinien aus den acht Bändern zurück.
 *
 * ⭐ Der Schnitt zweier benachbarter Bänder IST die Trennlinie: beide Kanten stammen aus derselben
 * Linie und teilen ihre Stützpunkte punktgleich. Belegt, nicht plausibel gemacht — für jedes Band
 * gilt `Bandecken = Oberkante + Unterkante + 1`, und diese Gleichung geht nur auf, wenn kein Punkt
 * verlorengeht (`verifyReconstruction`).
 *
 * 🪤 `ST_LineMerge` liefert die Linie von x=1024 nach x=0, also RÜCKWÄRTS zur Normalisierungsregel.
 * Sie wird hier umgedreht. Trivial, und ungeprüft fatal: eine verkehrt herum gespeicherte Linie
 * verletzt „erste Position auf x = 0" und die Reihenfolge ihrer Stützpunkte.
 *
 * 🔴 Der Beweis der Verlustfreiheit (`verifyReconstruction`) hält den Lauf seit 2026-10-03 nicht mehr an (Betreiber: „B“, nur
 * melden; siehe `losslessFinding`). Lässt sich aus zwei Bändern gar keine Linie gewinnen (ein Band fehlt, die Grenze ist nicht
 * EINE Linie), gibt es nichts zu schreiben: Das bleibt ein technischer Abbruch, keine Prüfung.
 */
export async function reconstructDividers(
    database: Database,
    bands: readonly LegacyBand[],
): Promise<ReconstructedDivider[]> {
    const byType = new Map(bands.map((band) => [band.typeKey, band.geoJson]));
    const dividers: ReconstructedDivider[] = [];

    for (let index = 0; index < CLIMATE_ZONES.length - 1; index += 1) {
        const north = byType.get(CLIMATE_ZONES[index] as string);
        const south = byType.get(CLIMATE_ZONES[index + 1] as string);
        if (!north || !south) {
            throw new Error(
                `Snapshot fehlt ein Band: ${String(CLIMATE_ZONES[index])} oder ${String(CLIMATE_ZONES[index + 1])}`,
            );
        }

        // 💣 ST_SetSRID ist nicht kosmetisch: ST_GeomFromGeoJSON liefert SRID 4326, auch bei
        // Kartenkoordinaten 0..1024. Ohne diese Zeile bricht der Schnitt mit "mixed SRID" ab.
        const [row] = await database<{ wkt: string | null; pts: number; typ: string; parts: number }[]>`
            WITH cut AS (
                SELECT ST_LineMerge(ST_Intersection(
                    ST_SetSRID(ST_GeomFromGeoJSON(${north}), 0),
                    ST_SetSRID(ST_GeomFromGeoJSON(${south}), 0)
                )) AS g
            )
            SELECT ST_AsText(ST_Reverse(g)) AS wkt, ST_NPoints(g) AS pts,
                   ST_GeometryType(g) AS typ, ST_NumGeometries(g) AS parts
            FROM cut
        `;
        if (!row?.wkt || row.typ !== "ST_LineString") {
            throw new Error(
                `Die Grenze zwischen ${String(CLIMATE_ZONES[index])} und ${String(CLIMATE_ZONES[index + 1])} ` +
                    `verschmilzt nicht zu EINER Linie (${String(row?.typ)}, ${String(row?.parts)} Teile). ` +
                    "Damit trägt die Rekonstruktion nicht — stoppen, nicht behelfen.",
            );
        }
        dividers.push({
            southTypeKey: CLIMATE_ZONES[index + 1] as string,
            wkt: row.wkt,
            pointCount: row.pts,
        });
    }
    return dividers;
}

/**
 * Der Beweis, dass die Rekonstruktion keinen Punkt verliert.
 *
 * Für jedes Band muss `Bandecken = Oberkante + Unterkante + 1` gelten; am Kartenrand zählt die
 * Kante zwei Punkte, und die 1 ist der Schlusspunkt des Rings. Die Gleichung geht nur auf, wenn
 * jeder Stützpunkt zurückkommt — sie ist damit schärfer als jeder Stichprobenvergleich.
 */
export async function verifyReconstruction(
    database: Database,
    bands: readonly LegacyBand[],
    dividers: readonly ReconstructedDivider[],
): Promise<ClimateCheck> {
    const byType = new Map(bands.map((band) => [band.typeKey, band.geoJson]));
    const offenders: string[] = [];

    for (const [index, zone] of CLIMATE_ZONES.entries()) {
        const geoJson = byType.get(zone);
        if (!geoJson) {
            offenders.push(`${zone}: fehlt im Snapshot`);
            continue;
        }
        const [row] = await database<{ pts: number }[]>`
            SELECT ST_NPoints(ST_SetSRID(ST_GeomFromGeoJSON(${geoJson}), 0)) AS pts
        `;
        const upper = index === 0 ? 2 : (dividers[index - 1]?.pointCount ?? 0);
        const lower = index === CLIMATE_ZONES.length - 1 ? 2 : (dividers[index]?.pointCount ?? 0);
        const expected = upper + lower + 1;
        if (row?.pts !== expected) {
            offenders.push(
                `${zone}: ${String(row?.pts)} statt ${String(expected)} (${String(upper)} + ${String(lower)} + 1)`,
            );
        }
    }

    return {
        name: "rekonstruktion_verlustfrei",
        passed: offenders.length === 0,
        detail:
            offenders.length === 0
                ? "Bandecken = Oberkante + Unterkante + 1 für alle acht"
                : `${String(offenders.length)} Bänder rechnen nicht auf`,
        ...(offenders.length > 0 ? { offenders } : {}),
    };
}

/** Der Fingerabdruck des Satzes — nicht einer Zeile. Ändert er sich, sind ALLE Bänder veraltet. */
export function dividerSetFingerprint(dividers: readonly ReconstructedDivider[]): string {
    const parts = [...dividers]
        .sort((a, b) => a.southTypeKey.localeCompare(b.southTypeKey))
        .map((divider) => `${divider.southTypeKey}:${divider.wkt}`);
    return createHash("sha256")
        .update(`${parts.join("\n")}|${CLIMATE_ALGORITHM_VERSION}`)
        .digest("hex");
}

/**
 * Schreibt die Linien und leitet die Bänder ab — in EINER Transaktion.
 *
 * 🔴 Der Satz ist die Transaktionsgrenze. Eine Linie für sich ist nicht konsistenzfähig: die
 * Reihenfolge, der Mindestabstand und die Kreuzungsfreiheit sind Aussagen über den Verbund. Ein
 * Lauf, der Linien einzeln committet, hinterlässt zwischendrin einen Zustand, in dem die
 * Invarianten nicht gelten — und Bänder, die zu keinem Satz gehören.
 *
 * Idempotent: die Linien werden über ihre Identität abgeglichen, die Bänder nur geschrieben, wenn
 * ihre Geometrie sich unterscheidet. Ein zweiter Lauf schreibt nichts.
 */
export async function importClimate(
    database: Database,
    bands: readonly LegacyBand[],
): Promise<{ dividers: number; bands: number; written: boolean; fingerprint: string }> {
    const dividers = await reconstructDividers(database, bands);
    const fingerprint = dividerSetFingerprint(dividers);
    let written = false;

    await database.begin(async (transaction) => {
        for (const divider of dividers) {
            const [existing] = await transaction<{ same: boolean }[]>`
                SELECT ST_Equals(geom, ST_SetSRID(ST_GeomFromText(${divider.wkt}), 0)) AS same
                FROM climate_divider WHERE south_type_key = ${divider.southTypeKey}
            `;
            if (existing?.same === true) {
                continue;
            }
            written = true;
            await transaction`
                INSERT INTO climate_divider (south_type_key, geom)
                VALUES (${divider.southTypeKey}, ST_SetSRID(ST_GeomFromText(${divider.wkt}), 0))
                ON CONFLICT (south_type_key) DO UPDATE
                    SET geom = EXCLUDED.geom,
                        revision = climate_divider.revision + 1,
                        updated_at = now()
            `;
        }

        // Eine Linie ohne Zonenpaar gibt es nicht mehr; ihre Zone wäre entfallen, und das wäre eine
        // eigene Migration. Hier ist sie ein Fehler, kein stiller Rest.
        const keys = dividers.map((divider) => divider.southTypeKey);
        const orphans = await transaction<{ south_type_key: string }[]>`
            SELECT south_type_key FROM climate_divider WHERE south_type_key <> ALL(${keys})
        `;
        if (orphans.length > 0) {
            throw new Error(`Trennlinien ohne Zonenpaar: ${orphans.map((row) => row.south_type_key).join(", ")}`);
        }

        const derived = await deriveBands(transaction, fingerprint);
        written = written || derived;
    });

    return { dividers: dividers.length, bands: CLIMATE_ZONES.length, written, fingerprint };
}

/**
 * Baut die acht Bänder aus den Linien.
 *
 * Ring = obere Kante nach Osten, untere Kante nach Westen zurück, geschlossen. `NULL` als Kante
 * heißt Kartenrand. Weil beide Kanten exakt am Rand beginnen und enden, teilen benachbarte Bänder
 * ihre Linie punktgleich — es entsteht kein Spalt, den ein Verschnitt später als „gehört zu keiner
 * Zone" meldet.
 */
export async function deriveBands(database: Queryable, fingerprint: string): Promise<boolean> {
    // Der Riegel lässt genau diese Transaktion durch. Er sitzt im Schema, weil ein Riegel in der
    // Anwendung die zweite Wahrheit nicht verhindert, die das ganze Modell vermeiden soll.
    await database`SELECT set_config('climate.deriving', 'on', true)`;
    let written = false;

    for (const [index, zone] of CLIMATE_ZONES.entries()) {
        const upperKey = index === 0 ? null : zone;
        const lowerKey = index === CLIMATE_ZONES.length - 1 ? null : (CLIMATE_ZONES[index + 1] as string);

        const [row] = await database<{ wkt: string }[]>`
            WITH edges AS (
                SELECT
                    CASE WHEN ${upperKey}::text IS NULL
                         THEN ST_SetSRID(ST_MakeLine(ST_MakePoint(${MAP_MIN}, ${MAP_MAX}),
                                                     ST_MakePoint(${MAP_MAX}, ${MAP_MAX})), 0)
                         ELSE (SELECT geom FROM climate_divider WHERE south_type_key = ${upperKey})
                    END AS upper,
                    CASE WHEN ${lowerKey}::text IS NULL
                         THEN ST_SetSRID(ST_MakeLine(ST_MakePoint(${MAP_MIN}, ${MAP_MIN}),
                                                     ST_MakePoint(${MAP_MAX}, ${MAP_MIN})), 0)
                         ELSE (SELECT geom FROM climate_divider WHERE south_type_key = ${lowerKey})
                    END AS lower
            )
            SELECT ST_AsText(ST_MakePolygon(ST_AddPoint(
                       ST_MakeLine(upper, ST_Reverse(lower)),
                       ST_StartPoint(upper)
                   ))) AS wkt
            FROM edges
        `;
        if (!row?.wkt) {
            throw new Error(`Band ${zone} liess sich nicht bilden`);
        }

        const [existing] = await database<{ same: boolean; fp: string }[]>`
            SELECT ST_Equals(geom, ST_SetSRID(ST_GeomFromText(${row.wkt}), 0)) AS same,
                   source_fingerprint AS fp
            FROM climate_band WHERE type_key = ${zone}
        `;
        if (existing?.same === true && existing.fp === fingerprint) {
            continue;
        }
        written = true;
        await database`
            INSERT INTO climate_band (type_key, geom, source_fingerprint)
            VALUES (${zone}, ST_SetSRID(ST_GeomFromText(${row.wkt}), 0), ${fingerprint})
            ON CONFLICT (type_key) DO UPDATE
                SET geom = EXCLUDED.geom, source_fingerprint = EXCLUDED.source_fingerprint,
                    derived_at = now()
        `;
    }
    return written;
}

/**
 * Der Befund, wenn die Rekonstruktion nicht verlustfrei ist (früher: „Die Rekonstruktion verliert Punkte. Gestoppt, nichts
 * geschrieben“). 🔴 Betreiber 2026-10-03: nur melden, „B“. Der Lauf schreibt weiter; der Befund nennt die Zahlen je Band und
 * die betroffenen Zonen (Tabelle `climate_band`, Zone als Kennung). Ohne Verstoß gibt es keinen Befund.
 */
export function losslessFinding(check: ClimateCheck): Finding | undefined {
    if (check.passed) return undefined;
    const offenders = check.offenders ?? [];
    const zones = offenders.flatMap((offender) => {
        const zone = /^([a-z_]+):/.exec(offender)?.[1];
        return zone === undefined ? [] : [{ table: "climate_band", publicId: zone, name: zone }];
    });
    return createFinding(
        `migrate:climate/${check.name}`,
        `${check.name}: ${check.detail}; der Lauf geht weiter`,
        { baender: zones.length },
        zones,
        zones.length,
        offenders,
    );
}
