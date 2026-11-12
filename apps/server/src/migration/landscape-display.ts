import { randomUUID } from "node:crypto";
import {
    AVENTURIA,
    AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS,
    DISPLAY_FALLBACK_ART,
    effectiveLandscapeDisplay,
    parseLandscapeDisplayResponse,
    upperBandFromLegacy,
    type EffectiveArt,
    type EffectiveLandscapeDisplay,
    type LandscapeDisplayDefaults,
    type LandscapeDisplayResponse,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { sha256Hex } from "./legacy-update.ts";

/**
 * Die Darstellungstafel der Landschaften als fuenfte Legacy-Quelle (WI-0064): Legacys Antwort von `ecosystem-display.php`
 * lesen, mit den Vorgaben aus Legacys Code zur wirksamen Tafel zusammensetzen und in `landscape_display_art` ablegen.
 *
 * Die Regel, nach der die Tafel entsteht, steht in `packages/shared/src/landscape-display.ts`; hier steht nur das Lesen der Datei
 * und das Schreiben. Der Import schreibt eine abgeleitete Tabelle, keine redaktionelle Wahrheit: er bestimmt den Stand bei jedem
 * Zug ganz neu (was dort nicht mehr vorkommt, verschwindet hier), und ein Lauf ohne Aenderung aendert nichts.
 */

/** Was der Import braucht: die gelesene Antwort und der SHA-256 der Antwortdatei (gegen den der Pruefer spaeter haelt). */
export interface LandscapeDisplayInput {
    response: LandscapeDisplayResponse;
    sha256: string;
    bytes: number;
}

/**
 * Liest die Antwortdatei. Ein BOM am Anfang (so liegt der Schnappschuss vom 2026-09-21) ist kein Inhalt; der SHA-256 gilt trotzdem
 * den Bytes der Datei, damit `sha256sum` denselben Wert nennt.
 *
 * 🔴 Eine unbrauchbare Antwort (kein JSON, leerer Stempel, Zahl außerhalb der Schranken) bleibt ein Abbruch (Betreiber
 * 2026-10-03, „A auch für die Prüfungen“, BLOCKING_SOURCE_CHECKS A21): Ein leerer Stempel hieße, alle Übersteuerungen still
 * zu verwerfen.
 */
export function landscapeDisplayFromBytes(bytes: Buffer): LandscapeDisplayInput {
    const decoded = bytes.toString("utf8");
    // Das Byte-Order-Mark, als Zeichencode geschrieben: ein wörtlich eingetragenes wäre unsichtbar (und ein Lint-Fehler).
    const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch (error) {
        throw new Error(`Darstellungstafel: kein JSON (${error instanceof Error ? error.message : String(error)})`, {
            cause: error,
        });
    }
    return { response: parseLandscapeDisplayResponse(payload), sha256: sha256Hex(bytes), bytes: bytes.byteLength };
}

/**
 * Holt die Antwort einmal. Jede Antwort ausser 200 ist ein Fehler - nie ein stiller Rueckfall auf die Vorgaben -, und eine
 * unbrauchbare Antwort (kein JSON, leerer Stempel, Zahl ausserhalb der Schranken) bricht ab, bevor irgendetwas abgelegt wird.
 * Kein bedingter Abruf und keine Wiederholung: die Antwort ist rund 1,8 KB gross, und STRATO entfernt den `ETag` aus Antworten mit
 * Rumpf. Die Bytes gehen unveraendert zurueck, damit die Datei im Download-Fach denselben SHA-256 traegt wie der Bericht.
 */
export async function requestLandscapeDisplay(options: {
    url: string;
    fetcher?: typeof fetch;
}): Promise<{ input: LandscapeDisplayInput; bytes: Buffer }> {
    const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    const response = await fetcher(options.url);
    if (!response.ok) {
        throw new Error(`${options.url}: HTTP ${String(response.status)}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return { input: landscapeDisplayFromBytes(bytes), bytes };
}

export interface PhaseReport {
    created: number;
    updated: number;
    unchanged: number;
    retired: number;
}

export interface ImportLandscapeDisplayReport {
    /** Die Lauf-Kennung, nur wenn der Lauf etwas geaendert hat. */
    runId: string | null;
    stamp: string;
    defaultsRef: string;
    arts: PhaseReport;
    /** Wie viele Eintraege die Uebersteuerung je angewandtem Abschnitt traegt. */
    overrides: { vorgabe: number; groesse: number; kollision: number; global: number; abstaende: number };
    /** Abschnitte, die Legacy fuehrt und Avesmaps3D nicht anwendet, mit ihrer Zahl an Eintraegen. */
    unapplied: Record<string, number>;
    unknownSections: string[];
    /** Hat der Lauf die Tabelle oder ihre Herkunft geaendert? */
    changed: boolean;
}

interface StoredRow {
    art_key: string;
    band_from: number;
    band_to: number;
    curve_max: number;
    priority: number;
    sizes: number[];
}

/**
 * Was die Tabelle je Art traegt: die vier Werte und die neun Groessen. Die Kollisionsrolle steht bewusst nicht darin.
 *
 * 🔴 Hier liegt die Migrationsgrenze der Baender (WI-0129, Betreiber 2026-10-10 E2 A): die wirksame Tafel bleibt Legacys
 * Semantik (bis hoechstens 7), die Tabelle traegt das Ziel. Legacys `bis = 7` heisst „bis ganz nah“ und steht als 8 darin;
 * `bis = -1` (aus), kleinere Werte und `ab` bleiben. Der Pruefer rechnet seine Sollzeilen ueber dieselbe Funktion.
 */
function rowOf(art: EffectiveArt): Omit<StoredRow, "art_key"> {
    return {
        band_from: art.ab,
        band_to: upperBandFromLegacy(art.bis),
        curve_max: art.curveMax,
        priority: art.prio,
        sizes: art.size,
    };
}

function sameRow(stored: StoredRow, wanted: Omit<StoredRow, "art_key">): boolean {
    return (
        stored.band_from === wanted.band_from &&
        stored.band_to === wanted.band_to &&
        stored.curve_max === wanted.curve_max &&
        stored.priority === wanted.priority &&
        stored.sizes.length === wanted.sizes.length &&
        stored.sizes.every((size, band) => Number(size) === wanted.sizes[band])
    );
}

/** Die Zeilen der Tabelle, wie sie zu einer wirksamen Tafel gehoeren: die Grundvorgabe `*` und jede Art. */
export function rowsOf(effective: EffectiveLandscapeDisplay): Map<string, Omit<StoredRow, "art_key">> {
    const rows = new Map<string, Omit<StoredRow, "art_key">>();
    rows.set(DISPLAY_FALLBACK_ART, rowOf(effective.base));
    for (const [art, entry] of Object.entries(effective.arts)) rows.set(art, rowOf(entry));
    return rows;
}

export interface ImportLandscapeDisplayOptions {
    mapDomainId?: string;
    /** Vorgaben aus Legacys Code; ohne Angabe die eingecheckte Datei. Nur Tests geben eigene mit. */
    defaults?: LandscapeDisplayDefaults;
}

export async function importLandscapeDisplay(
    database: Database,
    input: LandscapeDisplayInput,
    options: ImportLandscapeDisplayOptions = {},
): Promise<ImportLandscapeDisplayReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const defaults = options.defaults ?? AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS;
    // Zuerst rechnen, dann schreiben: ein Widerspruch (LandscapeDisplayError) bricht ab, bevor eine Zeile angefasst ist.
    const effective = effectiveLandscapeDisplay(defaults, input.response);
    const wanted = rowsOf(effective);
    const { overrides } = input.response;
    const report: ImportLandscapeDisplayReport = {
        runId: null,
        stamp: effective.stamp,
        defaultsRef: effective.defaultsRef,
        arts: { created: 0, updated: 0, unchanged: 0, retired: 0 },
        overrides: {
            vorgabe: Object.keys(overrides.vorgabe).length,
            groesse: Object.keys(overrides.groesse).length,
            kollision: Object.keys(overrides.kollision).length,
            global: Object.keys(overrides.global).length,
            abstaende: Object.keys(overrides.abstaende).length,
        },
        unapplied: overrides.unapplied,
        unknownSections: overrides.unknownSections,
        changed: false,
    };

    await database.begin(async (transaction) => {
        const stored = await transaction<StoredRow[]>`
            SELECT art_key, band_from, band_to, curve_max, priority, size_by_band::float8[] AS sizes
            FROM landscape_display_art
            WHERE map_domain_id = ${mapDomainId}
        `;
        const storedByKey = new Map(stored.map((row) => [row.art_key, row]));
        const toWrite: string[] = [];
        for (const [art, row] of wanted) {
            const have = storedByKey.get(art);
            if (have === undefined) {
                report.arts.created += 1;
                toWrite.push(art);
            } else if (!sameRow(have, row)) {
                report.arts.updated += 1;
                toWrite.push(art);
            } else {
                report.arts.unchanged += 1;
            }
        }
        const retiring = stored.filter((row) => !wanted.has(row.art_key)).map((row) => row.art_key);
        report.arts.retired = retiring.length;

        const [source] = await transaction<{ stamp: string; sha256: string; defaults_ref: string }[]>`
            SELECT stamp, sha256, defaults_ref FROM landscape_display_source WHERE map_domain_id = ${mapDomainId}
        `;
        const sourceChanged =
            source === undefined ||
            source.stamp !== effective.stamp ||
            source.sha256 !== input.sha256 ||
            source.defaults_ref !== effective.defaultsRef;
        report.changed = toWrite.length > 0 || retiring.length > 0 || sourceChanged;
        if (!report.changed) {
            return;
        }

        const runId = randomUUID();
        report.runId = runId;
        const sourceRef = `ecosystem_display_stamp=${effective.stamp};defaults=${effective.defaultsRef}`;
        await transaction`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
            VALUES (${runId}, 'landscape_display', 'avesmaps-legacy', ${sourceRef}, 'landscape-display-2')
        `;
        for (const art of toWrite) {
            const row = wanted.get(art) as Omit<StoredRow, "art_key">;
            await transaction`
                INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
                VALUES (
                    ${mapDomainId}, ${art}, ${row.band_from}, ${row.band_to}, ${row.curve_max}, ${row.priority},
                    ${`{${row.sizes.join(",")}}`}::numeric(4,1)[]
                )
                ON CONFLICT (map_domain_id, art_key) DO UPDATE SET
                    band_from = EXCLUDED.band_from,
                    band_to = EXCLUDED.band_to,
                    curve_max = EXCLUDED.curve_max,
                    priority = EXCLUDED.priority,
                    size_by_band = EXCLUDED.size_by_band
            `;
        }
        if (retiring.length > 0) {
            await transaction`
                DELETE FROM landscape_display_art
                WHERE map_domain_id = ${mapDomainId} AND art_key = ANY(${retiring}::text[])
            `;
        }
        await transaction`
            INSERT INTO landscape_display_source (map_domain_id, stamp, sha256, defaults_ref, migration_run_id, imported_at)
            VALUES (${mapDomainId}, ${effective.stamp}, ${input.sha256}, ${effective.defaultsRef}, ${runId}, now())
            ON CONFLICT (map_domain_id) DO UPDATE SET
                stamp = EXCLUDED.stamp,
                sha256 = EXCLUDED.sha256,
                defaults_ref = EXCLUDED.defaults_ref,
                migration_run_id = EXCLUDED.migration_run_id,
                imported_at = EXCLUDED.imported_at
        `;
        await transaction`
            UPDATE migration_run
            SET completed_at = now(), status = 'completed', journal = ${
                {
                    arts: report.arts,
                    overrides: report.overrides,
                    unapplied: report.unapplied,
                    unknown_sections: report.unknownSections,
                } as unknown as string
            }
            WHERE id = ${runId}
        `;
    });

    return report;
}

/** Eine Zeile fuer Bericht und Konsole. */
export function summarizeLandscapeDisplay(report: ImportLandscapeDisplayReport): string {
    const unapplied = Object.entries(report.unapplied)
        .map(([name, count]) => `${name} ${String(count)}`)
        .join(", ");
    return (
        `Stempel ${report.stamp}, Arten ${String(report.arts.created)}/${String(report.arts.updated)}/${String(report.arts.retired)} ` +
        `(neu/geaendert/entfernt), Uebersteuerungen: Baender ${String(report.overrides.vorgabe)}, Groessen ${String(report.overrides.groesse)}, ` +
        `Kollision ${String(report.overrides.kollision)}; nicht angewandt: ${unapplied === "" ? "nichts" : unapplied}` +
        (report.unknownSections.length > 0 ? `; UNBEKANNTE Abschnitte: ${report.unknownSections.join(", ")}` : "")
    );
}
