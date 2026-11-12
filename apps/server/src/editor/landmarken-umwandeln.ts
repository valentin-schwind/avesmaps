import { createHash } from "node:crypto";
import { landmarkenArtVorschlag, type LandmarkenArt, type PeakChanges } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { GIPFEL_ART } from "./gelaende-folgen.ts";
import { vorDemCutoff } from "./legacy-cutoff.ts";
import type { MapActor } from "./map-operation.ts";
import { merkmaleAusOrt, UMWANDELBARE_ORTSART, wandleOrtInLandmarke } from "./ort-in-landmarke.ts";
import { pathEndsAt, readPlace, type PlaceRow } from "./place-edit.ts";
import { kraftlinienAm, pruefeStaetten } from "./place-removal-regeln.ts";
import { merkmaleGeordnet, updatePeak } from "./peak-update.ts";

/**
 * Der Lauf „Bauwerke in Landmarken“ über eine feste Liste (WI-0271 L8, §17): prüfen und schreiben, ohne Kommandozeile (`landmarken-umwandeln-cli.ts`). Regeln und Freigabe stehen im Kopf der Kommandozeile.
 *
 * - **Offen:** Der Ort wird eine Landmarke, EINE Operation `landmarke.umwandeln` wie im Editor. Weicht die gewünschte Art vom Vorschlag der Regel ab, folgt eine zweite Operation `peak.update`.
 * - **Nachzug** (§17): Eine schon umgewandelte Zeile, an der die Merkmale des stillen Orts fehlen oder die als verborgener Ort `show_name = false` bekam. EINE Operation `peak.update`; nur einmal (`kennung`).
 * - **Gesperrt:** innerorts, Gebiet, kein Bauwerk, nicht auf der Karte, vor dem Cutoff. Bleibt liegen.
 */

export interface LaufZeile {
    publicId: string;
    art: LandmarkenArt;
}

export interface Befund {
    zeile: LaufZeile;
    name: string;
    zustand: "offen" | "nachzug" | "erledigt" | "gesperrt";
    grund?: string;
    revision?: number;
    vorschlag?: LandmarkenArt;
    wegenden?: number;
    /** Die Merkmale, die der Ort mitgibt. */
    merkmale?: readonly string[];
    /** Was am stillen Ort bleibt, weil eine Landmarke es nicht tragen kann. */
    bleibt?: readonly string[];
    kraftlinien?: number;
    landmarke?: string;
    /** Nachzug: der Stand der Landmarke und was sich ändert. */
    nachzug?: { revision: number; changes: PeakChanges };
    /** Nur Hinweis: Die Art der Landmarke weicht von der Liste ab (ein Editor oder ein abgebrochener Lauf). Der Lauf schreibt sie nicht. */
    artHeute?: string;
}

/** Eine feste Kennung je Zeile und Schritt (Form einer UUID, Version 5): ein zweiter Lauf bekommt die erste Quittung. */
export function kennung(publicId: string, schritt: "umwandeln" | "art" | "merkmale"): string {
    const h = createHash("sha256").update(`avesmaps3d:landmarken-umwandeln:${schritt}:${publicId}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const bleibtAmOrt = (ort: Pick<PlaceRow, "is_ruined" | "is_seaport">): string[] => [
    ...(ort.is_ruined ? ["Ruine"] : []),
    ...(ort.is_seaport ? ["Seehafen"] : []),
];

export async function pruefeZeile(
    sql: Queryable,
    zeile: LaufZeile,
    umgebung: MapActor["environment"],
    env: NodeJS.ProcessEnv = process.env,
): Promise<Befund> {
    const [schon] = await sql<
        { peak: string; name: string; subtype: string; merkmale: string[]; show_name: boolean; revision: number }[]
    >`
        SELECT t.public_id::text AS peak, t.name, t.subtype, t.merkmale, t.show_name, t.revision::int AS revision
          FROM terrain_peak_bezug b JOIN terrain_peak t ON t.id = b.terrain_peak_id
         WHERE b.ziel_art = 'place' AND b.ziel_public_id = ${zeile.publicId}::uuid AND b.rolle = 'umgewandelt_aus' AND b.is_active AND t.is_active
    `;
    const ort = await readPlace(sql, zeile.publicId, false);
    if (schon !== undefined) {
        const erledigt: Befund = {
            zeile,
            name: schon.name,
            zustand: "erledigt",
            landmarke: schon.peak,
            ...(ort === undefined ? {} : { bleibt: bleibtAmOrt(ort) }),
            ...(schon.subtype === zeile.art ? {} : { artHeute: schon.subtype }),
        };
        if (ort === undefined) return erledigt;
        const [gelaufen] = await sql<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${kennung(zeile.publicId, "merkmale")}::uuid
        `;
        if ((gelaufen?.n ?? 0) > 0) return erledigt;
        const merkmale = merkmaleGeordnet([...schon.merkmale, ...merkmaleAusOrt(ort)]);
        const changes: PeakChanges = {
            ...(merkmale.join() === merkmaleGeordnet(schon.merkmale).join() ? {} : { merkmale }),
            ...(ort.is_hidden && !schon.show_name ? { showName: true } : {}),
        };
        return Object.keys(changes).length === 0
            ? erledigt
            : { ...erledigt, zustand: "nachzug", nachzug: { revision: schon.revision, changes }, merkmale };
    }
    if (ort === undefined) return { zeile, name: "?", zustand: "gesperrt", grund: "Ort nicht gefunden" };
    const basis = {
        zeile,
        name: ort.name,
        revision: ort.revision,
        merkmale: merkmaleAusOrt(ort),
        bleibt: bleibtAmOrt(ort),
    };
    if (!ort.is_active) return { ...basis, zustand: "gesperrt", grund: "Ort nicht aktiv" };
    if (ort.unplaced || ort.x === null) return { ...basis, zustand: "gesperrt", grund: "Ort ohne Lage" };
    if (ort.subtype !== UMWANDELBARE_ORTSART)
        return { ...basis, zustand: "gesperrt", grund: `kein Bauwerk (${ort.subtype})` };
    if (vorDemCutoff(umgebung, env, "orte")) return { ...basis, zustand: "gesperrt", grund: "vor dem Cutoff der Orte" };
    // Dieselben Sperren, die die Umwandlung selbst prüft (innerorts): im Trockenlauf sichtbar, nicht erst beim Lauf.
    try {
        await pruefeStaetten(sql as Parameters<typeof pruefeStaetten>[0], ort, "loeschen", undefined);
    } catch (e) {
        return { ...basis, zustand: "gesperrt", grund: e instanceof Error ? e.message : String(e) };
    }
    const [gebiet] = await sql<{ name: string }[]>`
        SELECT name FROM territory WHERE is_active AND (capital_place_public_id = ${zeile.publicId}::uuid OR seat_place_public_id = ${zeile.publicId}::uuid) LIMIT 1
    `;
    if (gebiet !== undefined)
        return { ...basis, zustand: "gesperrt", grund: `Hauptstadt oder Sitz von ${gebiet.name}` };
    const enden = await pathEndsAt(sql, ort);
    return {
        ...basis,
        zustand: "offen",
        vorschlag: landmarkenArtVorschlag(ort.name, ort.place_kind),
        wegenden: enden.length,
        kraftlinien: (await kraftlinienAm(sql, zeile.publicId)).length,
    };
}

/** Eine Zeile ausgeführt, oder der Fehler: Eine Zeile hält die nächste nicht an. */
export type LaufErgebnis =
    | { art: "umgewandelt"; befund: Befund; peakId: string; name: string; subtype: string }
    | { art: "nachgezogen"; befund: Befund }
    | { art: "fehler"; befund: Befund; text: string };

/** Schreibt die offenen und die nachzuziehenden Zeilen, je Zeile eigene Operationen. */
export async function fuehreLaufAus(
    db: Database,
    actor: MapActor,
    befunde: readonly Befund[],
    env: NodeJS.ProcessEnv = process.env,
): Promise<LaufErgebnis[]> {
    const ergebnisse: LaufErgebnis[] = [];
    for (const b of befunde) {
        try {
            if (b.zustand === "offen") {
                const q = await wandleOrtInLandmarke(
                    db,
                    actor,
                    b.zeile.publicId,
                    { operationId: kennung(b.zeile.publicId, "umwandeln"), baseRevision: b.revision! },
                    env,
                );
                let art = q.subtype;
                if (q.subtype !== b.zeile.art) {
                    const rev = q.affected.find((g) => g.kind === GIPFEL_ART && g.id === q.peakId)?.revision;
                    if (rev === undefined) throw new Error("Revision der neuen Landmarke fehlt in der Quittung");
                    await updatePeak(db, actor, q.peakId, {
                        operationId: kennung(b.zeile.publicId, "art"),
                        baseRevision: rev,
                        changes: { subtype: b.zeile.art },
                    });
                    art = b.zeile.art;
                }
                ergebnisse.push({ art: "umgewandelt", befund: b, peakId: q.peakId, name: q.name, subtype: art });
            } else if (b.zustand === "nachzug") {
                await updatePeak(db, actor, b.landmarke!, {
                    operationId: kennung(b.zeile.publicId, "merkmale"),
                    baseRevision: b.nachzug!.revision,
                    changes: b.nachzug!.changes,
                });
                ergebnisse.push({ art: "nachgezogen", befund: b });
            }
        } catch (e) {
            ergebnisse.push({ art: "fehler", befund: b, text: e instanceof Error ? e.message : String(e) });
        }
    }
    return ergebnisse;
}
