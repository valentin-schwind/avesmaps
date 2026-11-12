import {
    EDITOR_LOCK_ERROR_STATUS,
    LANDMARKEN_MERKMALE,
    merkmaleDerArt,
    formtGelaende,
    type EditorPeakDetail,
    type FeldHerkunft,
    type LandmarkenArt,
    type LandmarkenMerkmal,
    type OperationReceipt,
    type PeakChanges,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { zieheKraftlinienNach } from "../derive/powerline-bahn.ts";
import { ApiError } from "../http/api-error.ts";
import { listEditorLocks } from "./editor-lock.ts";
import { zieheFlussendenNach } from "./flussenden-folgen.ts";
import { leseHerkunft, setzeHerkunft } from "./feld-herkunft.ts";
import { GIPFEL_ART } from "./gelaende-folgen.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";

/**
 * Gipfel und Vulkane als Objekte des Derographie-Editors (WI-0178 P1; EDIT-0003 T55; Vertrag `packages/shared/src/editor-peaks.ts`):
 * Lesen und `peak.update`.
 *
 * - **EIN Schreibweg** (Betreiber 2026-10-18: „diese höhe soll sowohl durch klick auf das objekt als auch in der gipfel-liste der gebirge
 *   verändert werden“): `gipfelSchreiben` in der Transaktion einer Operation; `peak.update` ruft es, die Gipfelliste des Gebirges (P5)
 *   ruft es aus `landscape.update`.
 * - **Eine Höhe, die eine Hand setzt, ist eigen** (WI-0253 §21, Vali 2026-10-27): `gipfelSchreiben` schreibt in derselben Transaktion den Vermerk `manual` (`field_origin`, Art `peak`, Feld
 *   `height`); der WikiSync übernimmt dann keine Höhe aus dem Wiki mehr. Eine Höhe ohne Vermerk folgt dem Wiki, wo es einen Wert gibt. EIN Schreibweg: Das Fenster des Gipfels, die Gipfelliste des
 *   Gebirges und jede Wiederherstellung gehen über diese Funktion.
 * - **Gelände:** Die Operation meldet `{ kind: "peak" }`; die Schreibnaht reiht das Gelände im Umkreis ein, wenn sich der Eintrag im
 *   Eingabeindex ändert (`gelaende-folgen.ts`, WI-0223): bei Höhe und Lage, nie bei Name und „Auf der Karte anzeigen“.
 * - **Kraftlinien** (WI-0271 §17): Eine Landmarke kann Knoten einer Kraftlinie sein. Ihre Bahn folgt der Lage in derselben Transaktion wie bei Ort und Kraftlinienpunkt, und solange dort eine Linie endet, geht die Landmarke nicht still (`nimmGipfelWeg`, 409 `powerline_endpoint`).
 * - **Flussenden** (OPS-000088): Ein Flussende, das auf einer Marke eingerastet ist, folgt ihrer Lage in derselben Transaktion (`flussenden-folgen.ts`), auch wenn die Lage aus der Gipfelliste oder einer Rücknahme kommt.
 * - **Revision** (Migration 0205) gegen `baseRevision`, 409 `edit_conflict` mit wer und wann; hält ein anderer den Gipfel, 409
 *   `object_locked`; läuft der Zug, 503 (`mapOperation`). Nichts zu schreiben ist 400.
 * - 🪤 **Bis zum Cutoff** setzt der Landschaften-Zug (I10) Gipfel auf Legacys Stand zurück, wie Flächen.
 * - **Landmarken** (WI-0271 L3): Art und Merkmale gehen über denselben Weg. Eine Höhe tragen nur Arten mit Gelände (CHECK
 *   `terrain_peak_hoehe_nur_gelaende`, 0276): Eine Höhe an einer anderen Art ist 400, ein Wechsel zu ihr leert die Höhe (im Protokoll als
 *   `height` nach `null`, ihr Vermerk bleibt; ohne Höhe folgt sie ohnehin dem Wiki). Ob das Gelände rechnet, entscheidet weiter der
 *   Eingabeindex: Er liest die Sicht `terrain_peak_gelaende`, ein Wechsel unter den Arten ohne Gelände ändert ihn nicht.
 */

export interface GipfelZeile {
    id: string;
    public_id: string;
    name: string;
    subtype: LandmarkenArt;
    height_schritt: number | null;
    merkmale: LandmarkenMerkmal[];
    show_name: boolean;
    x: number;
    y: number;
    map_domain_id: string;
    revision: number;
    updated_at: Date;
    is_active: boolean;
}

/** Ein Gipfel; ohne `auchGeloescht` nur ein aktiver. */
export async function leseGipfel(
    sql: Queryable,
    publicId: string,
    sperren = false,
    auchGeloescht = false,
): Promise<GipfelZeile | undefined> {
    const [zeile] = sperren
        ? await sql<GipfelZeile[]>`
              SELECT id::text, public_id::text, name, subtype, height_schritt, merkmale, show_name, ST_X(geom) AS x, ST_Y(geom) AS y,
                     map_domain_id, revision::int AS revision, updated_at, is_active
                FROM terrain_peak WHERE public_id = ${publicId}::uuid AND (is_active OR ${auchGeloescht}) FOR NO KEY UPDATE
          `
        : await sql<GipfelZeile[]>`
              SELECT id::text, public_id::text, name, subtype, height_schritt, merkmale, show_name, ST_X(geom) AS x, ST_Y(geom) AS y,
                     map_domain_id, revision::int AS revision, updated_at, is_active
                FROM terrain_peak WHERE public_id = ${publicId}::uuid AND (is_active OR ${auchGeloescht})
          `;
    return zeile;
}

/** Die Gebirge, in deren aktiven Teilflächen der Gipfel liegt (wie die Gipfelliste des Gebirges, P5). */
export async function gebirgeAmGipfel(sql: Queryable, peakId: string): Promise<{ id: string; name: string }[]> {
    return sql<{ id: string; name: string }[]>`
        SELECT DISTINCT r.public_id::text AS id, r.name
          FROM terrain_peak_gelaende p
          JOIN region_area a ON a.is_active AND ST_Covers(a.geom, p.geom)
          JOIN region r ON r.id = a.region_id AND r.is_active AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
         WHERE p.public_id = ${peakId}::uuid
         ORDER BY r.name
    `;
}

const nichtDa = (): ApiError => new ApiError(404, "not_found", "Diesen Gipfel gibt es nicht.");

/** Die Merkmale in der Folge des Katalogs, jedes einmal: So vergleichen und speichern sich zwei gleiche Mengen gleich. */
export const merkmaleGeordnet = (merkmale: readonly string[]): LandmarkenMerkmal[] =>
    LANDMARKEN_MERKMALE.filter((merkmal) => merkmale.includes(merkmal));

/** Für Besucher nicht oder erst aus der Nähe auf der Karte (`hidden` der Editorlisten). */
export const fuerBesucherVerborgen = (merkmale: readonly string[]): boolean =>
    merkmale.includes("verborgen") || merkmale.includes("nur_gelaende");
const ungueltig = (satz: string, feld: string): ApiError =>
    new ApiError(400, "validation_failed", satz, { field: feld });

export async function readEditorPeak(database: Queryable, publicId: string): Promise<EditorPeakDetail | undefined> {
    const zeile = await leseGipfel(database, publicId, false, true);
    if (zeile === undefined) return undefined;
    const gebirge = zeile.is_active ? await gebirgeAmGipfel(database, publicId) : [];
    return {
        id: zeile.public_id,
        name: zeile.name,
        subtype: zeile.subtype,
        ...(zeile.height_schritt === null ? {} : { height: zeile.height_schritt }),
        ...(zeile.merkmale.length === 0 ? {} : { merkmale: merkmaleGeordnet(zeile.merkmale) }),
        showName: zeile.show_name,
        position: [zeile.x, zeile.y],
        revision: zeile.revision,
        ...(zeile.is_active ? {} : { state: "retired" as const }),
        ...(gebirge.length > 0 ? { mountains: gebirge } : {}),
    };
}

/**
 * Schreibt die Änderung an EINEM Gipfel in der Transaktion einer Operation, gegen seine Revision; gibt Gegenstand und Protokollzeile
 * zurück, oder nichts, wenn sich nichts ändert. Höhe und Lage melden den Gipfel unter `affected` (Gelände im Umkreis).
 */
export async function gipfelSchreiben(
    tx: Sql,
    actor: MapActor,
    publicId: string,
    baseRevision: number,
    changes: PeakChanges,
    /** Die Herkunft, die eine geänderte Höhe hinterlässt: Eine Hand setzt sie (`manual`, die Vorgabe); die Rücknahme eines Werts, der dem Wiki folgte, setzt `wiki` (WI-0265 B6c). */
    hoehenHerkunft: FeldHerkunft = "manual",
): Promise<
    | {
          affected: OperationReceipt["affected"];
          entries: MapAuditEntry[];
          summary: string;
          kraftlinien: number;
          /** So viele Flussenden sind der Lage gefolgt. */
          flussenden: number;
          warnings: OperationReceipt["warnings"];
      }
    | undefined
> {
    const gipfel = await leseGipfel(tx, publicId, true);
    if (gipfel === undefined) throw nichtDa();
    if (gipfel.revision !== baseRevision)
        throw await mapEditConflict(
            tx,
            { kind: "peak", publicId },
            { revision: gipfel.revision, changedAt: gipfel.updated_at },
        );
    const fremd = (await listEditorLocks(tx, "peak", undefined)).find(
        (sperre) => sperre.id === publicId && (actor.kind !== "person" || sperre.person.id !== actor.personId),
    );
    if (fremd !== undefined)
        throw new ApiError(
            EDITOR_LOCK_ERROR_STATUS.object_locked,
            "object_locked",
            `${fremd.person.name} bearbeitet das gerade.`,
            { lock: fremd },
        );

    const name = changes.name?.trim();
    if (name !== undefined && name === "") throw ungueltig("Ein Gipfel braucht einen Namen.", "name");
    const geaendert: Record<string, { before: unknown; after: unknown }> = {};
    if (name !== undefined && name !== gipfel.name) geaendert["name"] = { before: gipfel.name, after: name };
    const art = changes.subtype ?? gipfel.subtype;
    if (art !== gipfel.subtype) geaendert["subtype"] = { before: gipfel.subtype, after: art };
    // Die Höhe nach dem Wechsel der Art: nur bei Gelände; sonst leer (CHECK `terrain_peak_hoehe_nur_gelaende`).
    if (!formtGelaende(art) && changes.height !== undefined)
        throw ungueltig("Nur Berggipfel und Vulkan haben eine Höhe.", "height");
    const hoehe = formtGelaende(art) ? (changes.height ?? gipfel.height_schritt) : null;
    if (hoehe !== gipfel.height_schritt) geaendert["height"] = { before: gipfel.height_schritt, after: hoehe };
    const moeglich = merkmaleDerArt(art);
    if (changes.merkmale?.some((merkmal) => !moeglich.includes(merkmal)) === true)
        throw ungueltig("„Nur Gelände“ geht nur an Berggipfel und Vulkan.", "merkmale");
    const merkmaleVorher = merkmaleGeordnet(gipfel.merkmale);
    // Wie die Höhe: Der Wechsel zu einer Art ohne Gelände nimmt „nur Gelände“ mit, sonst stünde sie unsichtbar und ohne Wirkung da.
    const merkmale = merkmaleGeordnet(changes.merkmale ?? merkmaleVorher).filter((merkmal) =>
        moeglich.includes(merkmal),
    );
    if (merkmale.join() !== merkmaleVorher.join()) geaendert["merkmale"] = { before: merkmaleVorher, after: merkmale };
    if (changes.showName !== undefined && changes.showName !== gipfel.show_name)
        geaendert["showName"] = { before: gipfel.show_name, after: changes.showName };
    const lage = changes.position;
    if (lage !== undefined && (lage[0] !== gipfel.x || lage[1] !== gipfel.y)) {
        const [drin] = await tx<{ inside: boolean }[]>`
            SELECT map_domain_contains(${gipfel.map_domain_id}, ST_SetSRID(ST_MakePoint(${lage[0]}, ${lage[1]}), 0)) AS inside
        `;
        if (drin?.inside !== true) throw ungueltig("Der Gipfel liegt außerhalb der Karte.", "position");
        geaendert["position"] = { before: [gipfel.x, gipfel.y], after: [lage[0], lage[1]] };
    }
    if (Object.keys(geaendert).length === 0) return undefined;

    const [geschrieben] = await tx<{ revision: number }[]>`
        UPDATE terrain_peak
           SET name = ${name ?? gipfel.name},
               subtype = ${art},
               height_schritt = ${hoehe},
               merkmale = ${merkmale}::text[],
               show_name = ${changes.showName ?? gipfel.show_name},
               geom = CASE WHEN ${lage !== undefined} THEN ST_SetSRID(ST_MakePoint(${lage?.[0] ?? 0}, ${lage?.[1] ?? 0}), 0)
                           ELSE geom END
         WHERE id = ${gipfel.id}::bigint AND revision = ${baseRevision}
        RETURNING revision::int AS revision
    `;
    if (geschrieben === undefined)
        throw await mapEditConflict(
            tx,
            { kind: "peak", publicId },
            { revision: gipfel.revision, changedAt: gipfel.updated_at },
        );
    // Die Höhe hat eine Hand gesetzt: Sie gehört ihr und folgt dem Wiki nicht mehr (der Vermerk steht in derselben Transaktion wie der Wert).
    // Eine Höhe, die der Wechsel zu einer Art ohne Gelände leert, setzt keine Hand: Ihr Vermerk bleibt.
    if (geaendert["height"] !== undefined && hoehe !== null) {
        const bisher = (await leseHerkunft(tx, "peak", [publicId])).get(publicId)?.["height"] ?? null;
        await setzeHerkunft(tx, "peak", [publicId], { height: hoehenHerkunft });
        if (bisher !== hoehenHerkunft) geaendert["heightOrigin"] = { before: bisher, after: hoehenHerkunft };
    }
    const kraftlinien =
        geaendert["position"] === undefined ? 0 : await zieheKraftlinienNach(tx, { knoten: [publicId] });
    const fluesse =
        geaendert["position"] === undefined
            ? undefined
            : await zieheFlussendenNach(
                  tx,
                  actor,
                  gipfel.map_domain_id,
                  { x: gipfel.x, y: gipfel.y },
                  { x: lage![0], y: lage![1] },
              );
    // Ob das Gelände rechnet, entscheidet die Schreibnaht am Eingabeindex (`gelaende-folgen.ts`): Name, Anzeige und Merkmale ändern ihn nicht,
    // die Art nur, wenn sie die Geländewirkung wechselt (der Index liest die Sicht der Geländearten).
    return {
        affected: [{ kind: GIPFEL_ART, id: publicId, revision: geschrieben.revision }, ...(fluesse?.affected ?? [])],
        entries: [
            {
                action: "peak.updated",
                peakId: publicId,
                revisionBefore: gipfel.revision,
                revisionAfter: geschrieben.revision,
                changes: geaendert,
            },
            ...(fluesse?.entries ?? []),
        ],
        summary: `${name ?? gipfel.name}: ${Object.keys(geaendert).join(", ")}${
            (fluesse?.enden ?? 0) > 0 ? `, ${String(fluesse!.enden)} Flussenden mit` : ""
        }`,
        kraftlinien,
        flussenden: fluesse?.enden ?? 0,
        warnings: fluesse?.warnings ?? [],
    };
}

/** `peak.update` (WI-0178 P1): EINE Operation an einem Gipfel. */
export async function updatePeak(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: { operationId: string; baseRevision: number; changes: PeakChanges },
): Promise<OperationReceipt> {
    const vorher = await leseGipfel(database, publicId);
    if (vorher === undefined) throw nichtDa();
    return mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "peak.update", mapDomainId: vorher.map_domain_id, body },
        async (tx) => {
            const geschrieben = await gipfelSchreiben(tx, actor, publicId, body.baseRevision, body.changes);
            if (geschrieben === undefined) throw new ApiError(400, "validation_failed", "Nichts zu ändern.");
            return {
                receipt: {
                    affected: geschrieben.affected,
                    derivedWork: [
                        ...(geschrieben.kraftlinien > 0 ? [{ kind: "powerline_path", state: "done" as const }] : []),
                        ...(geschrieben.flussenden > 0
                            ? [
                                  { kind: "path_visual", state: "done" as const },
                                  { kind: "routing", state: "pending" as const },
                              ]
                            : []),
                    ],
                    warnings: geschrieben.warnings,
                },
                summary: geschrieben.summary,
                entries: geschrieben.entries,
            };
        },
    );
}

/** Hält ein anderer einen der Gipfel? Dann 409 `object_locked` mit wer und seit wann. */
export async function pruefeFremdeGipfelSperre(tx: Sql, actor: MapActor, gipfel: readonly string[]): Promise<void> {
    if (gipfel.length === 0) return;
    const fremd = (await listEditorLocks(tx, "peak", undefined)).find(
        (sperre) => gipfel.includes(sperre.id) && (actor.kind !== "person" || sperre.person.id !== actor.personId),
    );
    if (fremd !== undefined)
        throw new ApiError(
            EDITOR_LOCK_ERROR_STATUS.object_locked,
            "object_locked",
            `${fremd.person.name} bearbeitet das gerade.`,
            { lock: fremd },
        );
}

/** Löscht EINEN Gipfel weich, in der Transaktion des Aufrufers (gesperrt gelesen); die Revision prüft der Aufrufer. */
export async function nimmGipfelWeg(
    tx: Sql,
    gipfel: GipfelZeile,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[] }> {
    const linien = await tx<{ name: string }[]>`
        SELECT DISTINCT coalesce(nullif(name, ''), public_id::text) AS name FROM powerline
         WHERE (is_active OR off_map) AND ${gipfel.public_id}::uuid IN (from_public_id, to_public_id)
         ORDER BY 1
    `;
    if (linien.length > 0)
        throw new ApiError(
            409,
            "powerline_endpoint",
            `An ${gipfel.name} endet eine Kraftlinie (${linien
                .slice(0, 3)
                .map((linie) => linie.name)
                .join(", ")}); erst sie umhängen oder entfernen.`,
            { powerlines: linien.map((linie) => linie.name) },
        );
    const [neu] = await tx<{ revision: number }[]>`
        UPDATE terrain_peak SET is_active = FALSE
         WHERE id = ${gipfel.id}::bigint AND is_active AND revision = ${gipfel.revision}
        RETURNING revision::int AS revision
    `;
    if (neu === undefined)
        throw await mapEditConflict(
            tx,
            { kind: "peak", publicId: gipfel.public_id },
            { revision: gipfel.revision, changedAt: gipfel.updated_at },
        );
    return {
        affected: [{ kind: GIPFEL_ART, id: gipfel.public_id, revision: neu.revision }],
        entries: [
            {
                action: "peak.retired",
                peakId: gipfel.public_id,
                revisionBefore: gipfel.revision,
                revisionAfter: neu.revision,
                changes: { active: { before: true, after: false } },
            },
        ],
    };
}
