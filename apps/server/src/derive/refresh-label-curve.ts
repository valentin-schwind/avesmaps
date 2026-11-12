import { MAX_BAND } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { POLY_DEGREE } from "./curve-fit.ts";
import { ALGORITHM_VERSION, deriveRegion, type RegionInput, type RegionResult } from "./label-runs.ts";

/**
 * „Labelkurve aktualisieren“ für EINE Region (WI-0018).
 *
 * Das ist die Funktion hinter Legacys Kontextmenü-Eintrag gleichen Namens (`refresh_curve`,
 * Fähigkeit `edit`) — ausdrücklich nicht der Sammellauf, den Legacy nicht in Editorhand gibt. Die
 * Kurve berechnet ein Editor auf Anstoß; wo der Name je Zoomstufe steht, folgt daraus ohne weiteres
 * Zutun (Betreiber 2026-09-23).
 *
 * 🔴 Das Kontextmenü und ein Schreibendpunkt kommen mit dem Editor. Ohne Rollen stünde ein Endpunkt
 * jedem Besucher offen, und diese Rechnung trianguliert eine ganze Fläche. Bis dahin ruft sie das
 * CLI: `npm run derive:runs -- --region <public_id>`.
 */

export interface CurveRegion {
    input: RegionInput;
    /** Die EINSTELLUNG der Region, nicht die vorhandene Kurve — wie Legacys Menüeintrag. */
    enabled: boolean;
}

export type RefreshOutcome =
    | { status: "written"; name: string; runs: number }
    | { status: "skipped"; name: string; reason: string }
    | { status: "not-found"; publicId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Die Regionen mit eingeschalteter Kurvenbeschriftung — oder genau die eine, gleich ob eingeschaltet. */
export async function loadCurveRegions(database: Database, publicId?: string): Promise<CurveRegion[]> {
    const rows = await database<
        {
            region_id: string;
            region_public_id: string;
            name: string;
            enabled: boolean | null;
            style_label_id: string;
            label_text: string;
            label_size: string | null;
            label_min_zoom: number | null;
            label_max_zoom: number | null;
            curve_max: number | null;
            curve_degree: number | null;
            label_type: string | null;
            tafel_curve_max: number | null;
        }[]
    >`
        SELECT r.id::text AS region_id, r.public_id::text AS region_public_id, r.name,
               r.label_curve_enabled AS enabled,
               l.id::text AS style_label_id, l.name AS label_text,
               -- 🔴 Die WIRKSAMEN Werte (Migration 0057, WI-0064): der eigene Wert des Labels, sonst die Darstellungstafel seiner
               -- Art. Dieselbe Ansicht speist die Kacheln; ein Lauf, der andere Baender rechnete als die Karte zeigt, waere
               -- ein Loch im Erscheinungsband. Ohne Tafel (leere Tabelle) bleibt es beim eigenen Wert und den Ersatzwerten unten.
               e.label_size, e.label_min_zoom, e.label_max_zoom,
               r.label_curve_max AS curve_max, r.label_curve_degree AS curve_degree,
               l.subtype AS label_type, e.curve_max AS tafel_curve_max
        FROM region r
        JOIN map_label l ON l.id = r.primary_label_id AND l.is_active
        JOIN map_label_effective e ON e.label_id = l.id
        WHERE r.is_active
          AND ${publicId === undefined ? database`r.label_curve_enabled` : database`r.public_id = ${publicId}::uuid`}
        ORDER BY r.name
    `;
    return rows.map((row) => ({
        enabled: row.enabled === true,
        input: {
            regionId: Number(row.region_id),
            regionPublicId: row.region_public_id,
            name: row.name,
            styleLabelId: Number(row.style_label_id),
            labelText: row.label_text,
            // Ohne eigene Groesse UND ohne Tafel waere jede Breite geraten; 18 ist Legacys Vorgabe fuer Landschaften.
            labelSize: row.label_size === null ? 18 : Number(row.label_size),
            labelType: row.label_type,
            labelMinZoom: row.label_min_zoom ?? 2,
            // Legacys Vorgabe ist „bis 7“, also bis ganz nah: im Ziel die hoechste Stufe (WI-0129).
            labelMaxZoom: row.label_max_zoom ?? MAX_BAND,
            // Die Region traegt ihre Hoechstzahl, sonst gilt die der Tafel, sonst 1 (Legacys Grundvorgabe).
            curveMax: row.curve_max ?? row.tafel_curve_max ?? 1,
            // 🪤 Gelesen, nicht vorausgesetzt: sonst setzte jede Sammelberechnung einen Grad, den ein
            // Editor gesetzt hat, still auf 3 zurück (WI-0019).
            curveDegree: row.curve_degree ?? POLY_DEGREE,
        },
    }));
}

/**
 * Schreibt die Läufe einer Region — oder löscht sie nur, wenn keine entstanden sind. Dann entfällt
 * die Kurve, und der Name steht als Punktlabel (I7); alte Läufe verdeckten ihn (`has_curve_run`).
 *
 * 🪤 Die Sperre je Region reiht zwei Aufrufe für dieselbe Region hintereinander. Ohne sie löscht der
 * zweite, was der erste noch nicht festgeschrieben hat, und fügt danach dieselben Schlüssel ein: ein
 * Eindeutigkeitsfehler statt eines Ergebnisses.
 *
 * 🔴 Eine Transaktionssperre (`pg_advisory_xact_lock`), nicht `SELECT … FOR NO KEY UPDATE` auf `region`
 * (EDIT-0004 Fund 6): Die Zeilensperre verlangt das UPDATE-Recht an `region`, und das hat die
 * Jobs-Rolle nicht, die den Auftrag `label_runs` rechnet (WI-0178 B3; dieselbe Falle wie
 * `karteneinstellungen.ts`). Gesperrt wird nur gegen einen zweiten Lauf derselben Region; dass die
 * Region gleichzeitig bearbeitet wird, hält sie nicht auf, der nächste Auftrag rechnet dann neu.
 */
export async function storeRuns(database: Database, input: RegionInput, result?: RegionResult): Promise<void> {
    await database.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext('avesmaps3d:landscape_label_run'), hashtext(${String(input.regionId)}))`;
        await transaction`DELETE FROM landscape_label_run WHERE region_id = ${input.regionId}`;
        if (!result) {
            return;
        }
        for (const run of result.runs) {
            const wkt = `LINESTRING(${run.points.map((point) => `${String(point.x)} ${String(point.y)}`).join(",")})`;
            await transaction`
                INSERT INTO landscape_label_run (
                    region_id, style_label_id, instance, instance_count,
                    run_min_zoom, run_max_zoom, name_width_px,
                    geom, source_fingerprint, algorithm_version
                ) VALUES (
                    ${input.regionId}, ${input.styleLabelId}, ${run.instance}, ${run.instanceCount},
                    ${run.runMinZoom}, ${run.runMaxZoom}, ${result.nameWidthPixels},
                    ST_SetSRID(ST_GeomFromText(${wkt}), 0), ${result.fingerprint}, ${ALGORITHM_VERSION}
                )
            `;
        }
    });
}

export interface DeriveReport {
    regions: number;
    /** Die Namen der neu geschriebenen Regionen. */
    written: string[];
    unchanged: number;
    runs: number;
    skipped: string[];
    /** Die Regionen, deren Läufe keiner Kurvenregion mehr gehörten und weggeräumt wurden. */
    removed: string[];
}

/**
 * Die Sammelberechnung über jede Region mit eingeschalteter Kurvenbeschriftung. Ohne `all` nur die
 * veralteten — veraltet heißt: der Fingerabdruck der gespeicherten Läufe stimmt nicht mehr.
 */
export async function deriveAll(database: Database, options: { all: boolean }): Promise<DeriveReport> {
    const regions = await loadCurveRegions(database);
    const report: DeriveReport = {
        regions: regions.length,
        written: [],
        unchanged: 0,
        runs: 0,
        skipped: [],
        removed: [],
    };

    // 🔴 Läufe gehören nur den Regionen, die diese Schleife sieht. Was sonst liegt, räumte niemand weg:
    // Eine stillgelegte Region behielt ihre Läufe (Legacy-Stand 2026-09-26, Amboss, Finsterkamm und
    // Koschberge unter neuer Kennung neu angelegt). Eine ausgeschaltete Kurve stünde sogar weiter auf
    // der Karte, denn die Sicht fragt label_curve_enabled nicht ab, und verdeckte das Punktlabel (I7).
    const keep = regions.map(({ input }) => String(input.regionId));
    const removed = await database<{ name: string }[]>`
        WITH gone AS (
            DELETE FROM landscape_label_run
            WHERE NOT (region_id = ANY(${keep}::bigint[]))
            RETURNING region_id
        )
        SELECT DISTINCT reg.name FROM gone JOIN region reg ON reg.id = gone.region_id ORDER BY reg.name
    `;
    report.removed = removed.map((row) => row.name);

    for (const { input } of regions) {
        const existing = await database<{ fingerprint: string; count: number }[]>`
            SELECT source_fingerprint AS fingerprint, count(*)::int
            FROM landscape_label_run WHERE region_id = ${input.regionId}
            GROUP BY source_fingerprint
        `;

        const result = await deriveRegion(database, input);
        if (result.skipped) {
            report.skipped.push(`${result.name}: ${result.skipped}`);
            // I7: die Kurve entfaellt, der Name bleibt als Punktlabel. Alte Laeufe muessen weg,
            // sonst stuende ein Name auf einer Kurve, die nicht mehr gilt.
            await storeRuns(database, input);
            continue;
        }

        const current = existing.length === 1 ? existing[0]?.fingerprint : undefined;
        if (!options.all && current === result.fingerprint && existing[0]?.count === result.runs.length) {
            report.unchanged += 1;
            continue;
        }

        await storeRuns(database, input, result);
        report.written.push(result.name);
        report.runs += result.runs.length;
    }
    return report;
}

/** Rechnet die Kurve einer Region neu und schreibt ihre Läufe. Sagt, was geschah, statt still nichts zu tun. */
export async function refreshLabelCurve(database: Database, publicId: string): Promise<RefreshOutcome> {
    if (!UUID.test(publicId)) {
        return { status: "not-found", publicId };
    }
    const [region] = await loadCurveRegions(database, publicId);
    if (!region) {
        // 🪤 Eine Landschaft ohne aktive erste Beschriftung (EDIT-0004 B6: es gibt sie) fehlt in `loadCurveRegions`, ist aber nicht
        // unbekannt: Ihr Auftrag `label_runs` scheiterte sonst endgültig (`input_invalid`), schon nach einer reinen Namensänderung
        // (WI-0178, 2026-10-18). Sie hat keinen Lauf; was noch liegt, gilt nicht mehr.
        // Auch eine stille Fläche (D2: von der Karte genommen oder gelöscht) verliert ihre Schriftläufe, statt den Auftrag scheitern zu lassen.
        const [ohne] = await database<{ id: string; name: string; is_active: boolean }[]>`
            SELECT id::text AS id, name, is_active FROM region WHERE public_id = ${publicId}::uuid
        `;
        if (!ohne) {
            return { status: "not-found", publicId };
        }
        await database.begin(async (transaction) => {
            await transaction`SELECT pg_advisory_xact_lock(hashtext('avesmaps3d:landscape_label_run'), hashtext(${ohne.id}))`;
            await transaction`DELETE FROM landscape_label_run WHERE region_id = ${ohne.id}::bigint`;
        });
        return {
            status: "skipped",
            name: ohne.name,
            reason: ohne.is_active ? "ohne Beschriftung" : "nicht auf der Karte",
        };
    }
    if (!region.enabled) {
        // Legacy an derselben Stelle: „Für diese Fläche entsteht keine Kurve — ist die
        // Kurvenbeschriftung aus?“ Was noch an Läufen liegt, gilt nicht mehr.
        await storeRuns(database, region.input);
        return { status: "skipped", name: region.input.name, reason: "Kurvenbeschriftung aus" };
    }
    const result = await deriveRegion(database, region.input);
    await storeRuns(database, region.input, result);
    return result.skipped
        ? { status: "skipped", name: result.name, reason: result.skipped }
        : { status: "written", name: result.name, runs: result.runs.length };
}
