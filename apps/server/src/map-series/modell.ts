import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    AVENTURIA_SERIES,
    SERIES_SWITCH_PREFIX,
    istKartenserieKennung,
    kartenserieEndgueltig,
    kartenserieStufe,
    type AdminKartenserie,
    type AdminKartenserien,
    type KartenserieAuftrag,
    type KartenserieUebernahmeStand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { isMissingTable } from "../system/state-row.ts";
import { ablageAus, freieBytes, grenzeBytes, juengsteQuelle, offeneUploads, uploadSicht } from "./ablage.ts";
import { fassungenVon } from "./fassungen.ts";
import { kartenserienKatalog, leseKartenserien } from "./stand.ts";

/**
 * Der letzte Auftrag `map_series_tile` je Serie (Schnitt 3): solange er wartet oder läuft, und wenn er gescheitert ist (bis ein neuer
 * kommt). Ein erfolgreicher steht nicht hier, sondern als Fassung. Fehlt die Warteschlange, gibt es keine.
 */
async function auftraege(db: Queryable): Promise<Map<string, KartenserieAuftrag>> {
    try {
        const rows = await db<
            {
                serie: string;
                public_id: string;
                state: string;
                phase: string | null;
                progress: number | null;
                wait_reason: string | null;
                error_summary: string | null;
                art: string | null;
                kante: number | null;
                queued_at: Date;
            }[]
        >`
            SELECT DISTINCT ON (j.input_ref->>'serie') j.input_ref->>'serie' AS serie, j.public_id::text AS public_id, j.state,
                   j.phase, j.progress::float8 AS progress, j.wait_reason, j.error_summary, j.input_ref->>'art' AS art,
                   (j.input_ref->>'kante')::int AS kante, j.queued_at
              FROM job j
             WHERE j.kind = 'map_series_tile'
             ORDER BY j.input_ref->>'serie', j.queued_at DESC, j.id DESC
        `;
        return new Map(
            rows
                .filter((r) => r.state !== "SUCCEEDED")
                .map((r) => [
                    r.serie,
                    {
                        jobId: r.public_id,
                        state: r.state,
                        phase: r.phase,
                        progress: r.progress,
                        waitReason: r.wait_reason,
                        fehler: r.error_summary,
                        art: r.art === "neu" ? ("neu" as const) : ("ersetzen" as const),
                        kante: r.kante,
                        seit: r.queued_at.toISOString(),
                    },
                ]),
        );
    } catch (error) {
        if (!isMissingTable(error)) throw error;
        return new Map();
    }
}

/**
 * Die letzte Übernahme nach Production je Serie (Schnitt 4), auch eine fertige: Der Reiter zeigt, welche Fassung zuletzt rüberging.
 */
async function uebernahmen(db: Queryable): Promise<Map<string, KartenserieUebernahmeStand>> {
    try {
        const rows = await db<
            {
                serie: string;
                public_id: string;
                state: string;
                phase: string | null;
                error_summary: string | null;
                revision: string | null;
                queued_at: Date;
                finished_at: Date | null;
            }[]
        >`
            SELECT DISTINCT ON (j.input_ref->>'serie') j.input_ref->>'serie' AS serie, j.public_id::text AS public_id, j.state,
                   j.phase, j.error_summary, j.input_ref->>'revision' AS revision, j.queued_at, j.finished_at
              FROM job j
             WHERE j.kind = 'map_series_production'
             ORDER BY j.input_ref->>'serie', j.queued_at DESC, j.id DESC
        `;
        return new Map(
            rows.map((r) => [
                r.serie,
                {
                    jobId: r.public_id,
                    state: r.state,
                    phase: r.phase,
                    fehler: r.error_summary,
                    revision: r.revision ?? "",
                    seit: r.queued_at.toISOString(),
                    bis: r.finished_at?.toISOString() ?? null,
                },
            ]),
        );
    } catch (error) {
        if (!isMissingTable(error)) throw error;
        return new Map();
    }
}

/**
 * Das Lesemodell des Reiters „Kartenserien“ (WI-0220 Schnitt 2): die wirksamen Serien in der Reihenfolge des Fächers, je Serie die
 * Sichtbarkeit (mit dem Inhaltsschalter), ob sie die Vorgabe ist, die Fassung ihrer Pyramide und wer zuletzt etwas geändert hat;
 * dazu der Papierkorb.
 */

/** Der Zeiger einer Pyramide (`<TILE_ROOT>/<serie>/current.json`, ADR-0008); ohne `TILE_ROOT` oder Datei `null`. */
async function fassungVon(tileRoot: string | undefined, id: string): Promise<AdminKartenserie["fassung"]> {
    if (tileRoot === undefined || !istKartenserieKennung(id)) return null;
    try {
        const zeiger = JSON.parse(await readFile(join(tileRoot, id, "current.json"), "utf8")) as Record<
            string,
            unknown
        >;
        return typeof zeiger["revision"] === "string" && typeof zeiger["maxNativeZoom"] === "number"
            ? { revision: zeiger["revision"], maxNativeZoom: zeiger["maxNativeZoom"] }
            : null;
    } catch {
        return null;
    }
}

export async function kartenserienModell(
    db: Queryable,
    { tileRoot, now }: { tileRoot: string | undefined; now: Date },
): Promise<AdminKartenserien> {
    const stand = await leseKartenserien(db);
    const katalog = kartenserienKatalog(stand);
    let aus = new Set<string>();
    let geaendert = new Map<string, { at: string; by: string | null }>();
    let papierkorb: AdminKartenserien["papierkorb"] = [];
    try {
        const rows = await db<
            { key: string }[]
        >`SELECT key FROM content_switch WHERE NOT enabled AND key LIKE 'map.series.%'`;
        aus = new Set(rows.map((r) => r.key.slice(SERIES_SWITCH_PREFIX.length)));
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
    if (stand.source === "database") {
        const rows = await db<
            {
                series_id: string;
                changed_at: Date;
                by: string | null;
                status: string;
                papierkorb_at: Date | null;
                label: string | null;
            }[]
        >`
            SELECT m.series_id, m.changed_at, COALESCE(p.display_name, m.changed_by_label) AS by, m.status, m.papierkorb_at, m.label
              FROM map_series m
              LEFT JOIN avesmaps_auth.person p ON p.id = m.changed_by
        `;
        geaendert = new Map(rows.map((r) => [r.series_id, { at: r.changed_at.toISOString(), by: r.by }]));
        // Nach der Frist steht eine Serie nicht mehr im Papierkorb: Ihre Kacheln sind weg oder kommen gleich weg (`papierkorb.ts`).
        papierkorb = rows
            .filter((r) => r.status === "papierkorb" && r.papierkorb_at !== null)
            .map((r) => ({ r, endgueltig: kartenserieEndgueltig(r.papierkorb_at!) }))
            .filter(({ endgueltig }) => endgueltig.getTime() > now.getTime())
            .map(({ r, endgueltig }) => ({
                id: r.series_id,
                label: r.label ?? AVENTURIA_SERIES.series.find((s) => s.id === r.series_id)?.label ?? r.series_id,
                seit: r.papierkorb_at!.toISOString(),
                endgueltig: endgueltig.toISOString(),
            }));
    }
    const vorgabeKennungen = new Set(AVENTURIA_SERIES.series.map((s) => s.id));
    const quellenWurzel = ablageAus(process.env, tileRoot)?.wurzel;
    const laufend = await auftraege(db);
    const rueber = await uebernahmen(db);
    const serien = await Promise.all(
        katalog.series.map(async (serie) => ({
            serie,
            quelle: vorgabeKennungen.has(serie.id) ? ("vorgabe" as const) : ("neu" as const),
            quelleDa:
                quellenWurzel === undefined
                    ? false
                    : (await juengsteQuelle(join(quellenWurzel, serie.id))) !== undefined,
            stufe: kartenserieStufe(serie, aus.has(serie.id)),
            istVorgabe: serie.id === katalog.defaultSeries,
            fassung: await fassungVon(tileRoot, serie.id),
            fassungen: await fassungenVon(tileRoot, serie.id),
            auftrag: laufend.get(serie.id) ?? null,
            uebernahme: rueber.get(serie.id) ?? null,
            geaendert: geaendert.get(serie.id) ?? null,
        })),
    );
    // Angelegt, aber noch nicht zerlegt (Schnitt 3): Im Fächer erscheinen sie erst danach, im Reiter mit ihrem Auftrag.
    const imKatalog = new Set(katalog.series.map((s) => s.id));
    const inArbeit = stand.zeilen
        .filter((z) => z.status === "aktiv" && !vorgabeKennungen.has(z.id) && !imKatalog.has(z.id))
        .map((z) => ({ id: z.id, label: z.label ?? z.id, auftrag: laufend.get(z.id) ?? null }));
    const ablage = ablageAus(process.env, tileRoot);
    const platz =
        ablage === undefined
            ? null
            : { freiBytes: await freieBytes(ablage.wurzel), grenzeBytes: grenzeBytes(process.env) };
    const uploads =
        ablage === undefined
            ? []
            : (await offeneUploads(ablage)).map(({ wert, bekommen }) => uploadSicht(wert, bekommen));
    return {
        now: now.toISOString(),
        revision: stand.revision,
        source: stand.source,
        license: katalog.license,
        serien,
        papierkorb,
        platz,
        uploads,
        inArbeit,
        unknownKeys: stand.unknownKeys,
    };
}
