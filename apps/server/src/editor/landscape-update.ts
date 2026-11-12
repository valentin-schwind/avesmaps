import {
    gleicheGefahren,
    isTerrainFrame,
    landscapeTypeFits,
    ordneGefahren,
    type EditorLandscapeLayer,
    type LandscapeLabelChanges,
    type LandscapeUpdateBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { AVENTURIA_TERRAIN_RECIPES } from "../terrain/domain/recipes.ts";
import { gebirgSchreiben } from "../terrain/gebirge-editor.ts";
import { formeUmIn, pruefeFlaechen, pruefeFremdeSperre, type FormVorab } from "./landscape-reshape.ts";
import { gipfelSchreiben } from "./peak-update.ts";
import { LANDSCHAFT_ART, mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";

/**
 * „Fertig“ im Landschaftseditor (WI-0178 B2; O3, EDIT-0003 T27 (4), G5; EDIT-0004 §5): `landscape.update`, Felder der Landschaft, ihre
 * Beschriftungen und ihre Form als EINE Operation. Der Fensterrumpf (`apps/web/src/fenster/bearbeitung.ts`) schreibt nur hierüber.
 *
 * - **Revision je Objekt** (G5; Orchestrierung 2026-10-17): Die Landschaft (`region.revision`) zählt nur ihre Felder; eine Operation, die
 *   nur Beschriftungen oder die Form ändert, berührt die Zeile `region` nicht. Grund: Zöge die Form die Landschaft mit, bekäme der
 *   Felder-Entwurf einer Nachbarin, deren Ecke mitgezogen wurde, einen Konflikt ohne Grund. 🪤 Das ersetzt EDIT-0004 §3 M1 Nr. 1 („Jede
 *   Operation an einer Landschaft berührt die Zeile `region`“) und den Satz dazu in `0137_landscape_revision.sql`.
 * - **Der Name** geht in derselben Transaktion an jede Beschriftung, deren Text ihm folgt (`text_follows_name`; noch vom Import
 *   ungefüllt zählt, wer bisher genau den alten Namen trug), und zählt deren Revision (EDIT-0004 §5).
 * - **Ebene und Art** (Betreiber 2026-10-17: „das muss editierbar sein“): Eine neue Ebene kommt mit einer Art aus ihr, die Art passt
 *   zur Ebene (Kartografie-Tafel); auch Meer, See, Insel und Kontinent (T50 (a)), nur der Kontinent „Aventurien“ behält Name, Ebene
 *   und Art (`isTerrainFrame`, 400). Wird die Landschaft zum Gebirge, sind die alten Gebirgswerte ihrer Teilflächen (`terrain_control`)
 *   verworfen (T50 (b), (c)); verlässt sie das Gebirge, bleiben sie unwirksam stehen. Die Beschriftungen, deren Namensart der alten Art
 *   folgte (`map_label.subtype`: Zoomband, Größe, Priorität und Kurve der Tafel `landscape_display_art` hängen daran), bekommen die
 *   neue; in einer neuen Ebene steht die Landschaft oben (`stack_order`). 🪤 Der Legacy-Zug setzt Ebene, Art, Reihenfolge und
 *   Namensart bis zum Cutoff zurück.
 * - **Gelände veraltet** (T18; EDIT-0004 §2.7, §6): Das Gelände bekommt keinen Auftrag. Ändern sich Ebene oder Art (alte oder neue
 *   speist es) oder die Form einer Landschaft, die es speist, meldet die Quittung den Befund `terrain_stale`; neu gerechnet wird mit
 *   dem nächsten Geländelauf, den der Betreiber auslöst. Ein Befund, nie eine Sperre.
 * - **Das Gebirge** (WI-0178 P4, Vertrag WI-0226): je Teilfläche dieser Landschaft eine `GebirgsAenderung`, geschrieben mit
 *   `gebirgSchreiben` NACH den Feldern, damit ein Wechsel zum Gebirge und seine ersten Werte EINE Operation sind. `affected` nennt die
 *   Gebirgswerte (`terrain_control`), das Gelände rechnet im Umkreis neu (WI-0223); das Protokoll hält je Teilfläche `area.gebirge`.
 *   Eine Teilfläche einer anderen Landschaft ist 400.
 * - **Gipfelhöhen** (P5, Gipfelliste im Reiter „Gebirge“): je Gipfel in einer Teilfläche dieser Landschaft seine Höhe gegen seine
 *   Revision, über `gipfelSchreiben` wie im Fenster des Gipfels (EIN Schreibweg); ein Gipfel außerhalb ist 400.
 * - **Die Form** wie `area.reshape` (`landscape-reshape.ts`, `formeUmIn`): eigene Teilflächen und mitgezogene Nachbarn je gegen ihre
 *   Revision.
 * - 🔴 **`FOR NO KEY UPDATE`, nie `FOR UPDATE`** (Befund Claudio 2026-10-19 bei den Gebieten, 503 nach 2 s `lock_timeout`; wie
 *   `path-update.ts`): Die Schriftläufe (`landscape_label_run`, Fremdschlüssel auf `region` und `map_label`) nehmen beim Schreiben
 *   FOR KEY SHARE auf ihre Landschaft und Beschriftung und halten es bis zum Ende ihrer Ableitung. FOR UPDATE wartete darauf; FOR NO KEY
 *   UPDATE nicht, und zwei Editoren schließen sich weiter aus. Kein Schreibweg hier ändert eine Kennung (`id`, `public_id`).
 * - Ein Konflikt an einem der Objekte nimmt alles zurück (409 `edit_conflict`); hält ein anderer eine der Landschaften, 409
 *   `object_locked`; läuft der Zug, 503 (`mapOperation`). Nichts zu schreiben ist 400.
 */

export interface RegionZeile {
    id: string;
    public_id: string;
    name: string;
    region_layer: EditorLandscapeLayer;
    region_type: string | null;
    stack_order: number;
    is_locked: boolean;
    is_hidden: boolean;
    label_curve_enabled: boolean | null;
    label_curve_max: number | null;
    /** Die Gefahrenlage (WI-0308, `region.hazards`), wie gespeichert. */
    hazards: string[];
    map_domain_id: string;
    revision: number;
    updated_at: Date;
}

/** Die Felder der Landschaft nach dem Schreiben. */
export interface Felder {
    name: string;
    layer: EditorLandscapeLayer;
    type: string | null;
    locked: boolean;
    /** Für Besucher verborgen (T41). */
    hidden: boolean;
    curveEnabled: boolean | null;
    curveMax: number | null;
    /** Die Gefahrenlage (WI-0308) in der Folge des Katalogs; leer heißt „ungefährlich“. */
    hazards: readonly string[];
    /** Ganz nach vorn oder ganz nach hinten (D1); ohne Angabe bleibt der Platz, außer in einer neuen Ebene (dort vorn). */
    order: "front" | "back" | undefined;
}

/** Eine Beschriftung der Landschaft, soweit Name und Art sie mitnehmen. */
interface FolgeZeile {
    id: string;
    public_id: string;
    revision: number;
    name: string;
    subtype: string | null;
    text_follows_name: boolean | null;
}

interface LabelZeile {
    public_id: string;
    revision: number;
    updated_at: Date;
    name: string;
    text_follows_name: boolean | null;
    label_size: string | null;
    label_priority: number | null;
    label_min_zoom: number | null;
    label_max_zoom: number | null;
    show_name: boolean | null;
    x: number;
    y: number;
}

/** Was das Gelände außer seinen Tafelzeilen liest: Wasser und Inseln der Topographie (die Anzeigehöhen des Geländes), der Kontinent. */
const GELAENDE_RAHMEN: Readonly<Record<string, readonly string[]>> = {
    topographie: ["meer", "see", "insel"],
    derographisch: ["kontinent"],
};

/** Speisen Ebene und Art das Gelände? Eine Zeile in einer der Fassungen (`config/terrain/aventuria/`) oder ein Rahmen. */
export function speistGelaende(layer: EditorLandscapeLayer, type: string | null): boolean {
    if (type === null) return false;
    if (GELAENDE_RAHMEN[layer]?.includes(type)) return true;
    if (layer !== "topographie" && layer !== "vegetation") return false;
    return [...AVENTURIA_TERRAIN_RECIPES.values()].some((recipe) => Object.hasOwn(recipe[layer], type));
}

export const GELAENDE_VERALTET = {
    code: "terrain_stale",
    message: "Gelände veraltet bis zum nächsten Geländelauf.",
} as const;

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

export async function leseRegion(sql: Sql | Database, regionId: string): Promise<RegionZeile | undefined> {
    const [zeile] = await sql<RegionZeile[]>`
        SELECT id::text AS id, public_id::text AS public_id, name, region_layer, region_type, stack_order::int AS stack_order,
               is_locked, is_hidden, label_curve_enabled, label_curve_max, hazards, map_domain_id, revision::int AS revision, updated_at
          FROM region WHERE public_id = ${regionId}::uuid AND is_active AND region_layer <> 'klima'
    `;
    return zeile;
}

/** Die Felder einer Beschriftung, wie sie im Fachprotokoll stehen (`MAP_AUDIT_FIELDS.label`). */
function labelWerte(zeile: LabelZeile): Record<string, unknown> {
    return {
        text: zeile.name,
        textFollowsName: zeile.text_follows_name,
        size: zeile.label_size === null ? null : Number(zeile.label_size),
        priority: zeile.label_priority,
        zoom: [zeile.label_min_zoom, zeile.label_max_zoom],
        showName: zeile.show_name,
        position: [zeile.x, zeile.y],
    };
}

/** Die Felder einer Landschaft gegen ihre Revision; auch für die Mehrfachauswahl (`landscape-batch.ts`). */
export async function schreibeFelder(
    tx: Sql,
    region: RegionZeile,
    baseRevision: number,
    neu: Felder,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[]; verworfen: number }> {
    const [jetzt] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM region WHERE id = ${region.id}::bigint FOR NO KEY UPDATE
    `;
    if (jetzt === undefined || jetzt.revision !== baseRevision)
        throw await mapEditConflict(
            tx,
            { kind: "region", publicId: region.public_id },
            { revision: jetzt?.revision ?? region.revision, changedAt: jetzt?.updated_at ?? region.updated_at },
        );
    const nameNeu = neu.name !== region.name;
    const ebeneNeu = neu.layer !== region.region_layer;
    const artNeu = neu.type !== region.region_type;
    const sperreNeu = neu.locked !== region.is_locked;
    const verborgenNeu = neu.hidden !== region.is_hidden;
    const kurveNeu = neu.curveEnabled !== region.label_curve_enabled || neu.curveMax !== region.label_curve_max;
    const gefahrNeu = !gleicheGefahren(neu.hazards, region.hazards);
    // In einer neuen Ebene vorn: über der höchsten Stelle dort. „Ganz nach vorn“ und „ganz nach hinten“ (D1, Legacys
    // set_region_stack): über den höchsten bzw. unter den niedrigsten Rang der anderen; wer schon dort liegt, bleibt. Die anderen
    // Landschaften behalten ihren Rang und ihre Revision.
    let order = region.stack_order;
    if (ebeneNeu || neu.order !== undefined) {
        const [grenze] = await tx<{ hoch: number | null; tief: number | null }[]>`
            SELECT max(stack_order)::int AS hoch, min(stack_order)::int AS tief
              FROM region WHERE map_domain_id = ${region.map_domain_id} AND region_layer = ${neu.layer} AND is_active
               AND id <> ${region.id}::bigint
        `;
        const hoch = grenze?.hoch ?? null;
        const tief = grenze?.tief ?? null;
        if (neu.order === "back") {
            if (tief !== null && (ebeneNeu || order >= tief)) order = tief - 1;
        } else if (hoch !== null && (ebeneNeu || order <= hoch)) order = hoch + 1;
        else if (ebeneNeu) order = 1;
    }
    const platzNeu = order !== region.stack_order;
    if (!nameNeu && !ebeneNeu && !artNeu && !sperreNeu && !verborgenNeu && !kurveNeu && !platzNeu && !gefahrNeu)
        return { affected: [], entries: [], verworfen: 0 };
    const [geschrieben] = await tx<{ revision: number }[]>`
        UPDATE region SET name = ${neu.name}, region_layer = ${neu.layer}, region_type = ${neu.type}, stack_order = ${order},
                          is_locked = ${neu.locked}, is_hidden = ${neu.hidden}, label_curve_enabled = ${neu.curveEnabled},
                          label_curve_max = ${neu.curveMax}, hazards = ${ordneGefahren(neu.hazards)}::text[]
         WHERE id = ${region.id}::bigint AND revision = ${baseRevision}
        RETURNING revision::int AS revision
    `;
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (nameNeu) changes["name"] = { before: region.name, after: neu.name };
    if (ebeneNeu) changes["layer"] = { before: region.region_layer, after: neu.layer };
    if (artNeu) changes["type"] = { before: region.region_type, after: neu.type };
    if (order !== region.stack_order) changes["order"] = { before: region.stack_order, after: order };
    if (sperreNeu) changes["locked"] = { before: region.is_locked, after: neu.locked };
    if (verborgenNeu) changes["hidden"] = { before: region.is_hidden, after: neu.hidden };
    if (gefahrNeu) changes["hazards"] = { before: ordneGefahren(region.hazards), after: ordneGefahren(neu.hazards) };
    if (kurveNeu)
        changes["curve"] = {
            before: { enabled: region.label_curve_enabled, max: region.label_curve_max },
            after: { enabled: neu.curveEnabled, max: neu.curveMax },
        };
    const entries: MapAuditEntry[] = [
        {
            action: "region.updated",
            regionId: region.public_id,
            revisionBefore: baseRevision,
            revisionAfter: geschrieben!.revision,
            changes,
        },
    ];
    const affected: OperationReceipt["affected"] = [
        { kind: LANDSCHAFT_ART, id: region.public_id, revision: geschrieben!.revision },
    ];
    // Zum Gebirge: Es gelten neue Werte (Vorgabe aus Preset, T50 (c)), die alten sind verworfen (T50 (b): „aber wehe die werden verwendet
    // und wir sehen es nicht“). Das Gelände liest sie nur bei Topographie und Gebirge; beim Verlassen bleiben sie deshalb unwirksam stehen.
    let verworfen = 0;
    if (istGebirge(neu.layer, neu.type) && !istGebirge(region.region_layer, region.region_type)) {
        const geloescht = await tx`
            DELETE FROM terrain_control WHERE area_id IN (SELECT id FROM region_area WHERE region_id = ${region.id}::bigint)
        `;
        verworfen = geloescht.count;
        // Ebenso ein gezeichnetes Netz aus einer früheren Zeit als Gebirge (WI-0245): Es gehört zu den alten Werten.
        await tx`DELETE FROM terrain_ridge_edge WHERE area_id IN (SELECT id FROM region_area WHERE region_id = ${region.id}::bigint)`;
        await tx`DELETE FROM terrain_ridge_point WHERE area_id IN (SELECT id FROM region_area WHERE region_id = ${region.id}::bigint)`;
        await tx`DELETE FROM terrain_valley_edge WHERE area_id IN (SELECT id FROM region_area WHERE region_id = ${region.id}::bigint)`;
        await tx`DELETE FROM terrain_hollow_point WHERE area_id IN (SELECT id FROM region_area WHERE region_id = ${region.id}::bigint)`;
        await tx`DELETE FROM terrain_water_height WHERE area_id IN (SELECT id FROM region_area WHERE region_id = ${region.id}::bigint)`;
    }
    // Der Text folgt dem Namen (ungefüllt folgt, wer bisher genau den alten Namen trug), die Namensart der Art: wer die alte trug
    // (auf avesmaps3d_dev 2026-10-17 1.255 von 1.346 Beschriftungen; die übrigen sind fast alle `region` an Landschaften ohne Art).
    const labels = await tx<FolgeZeile[]>`
        SELECT id::text AS id, public_id::text AS public_id, revision::int AS revision, name, subtype, text_follows_name
          FROM map_label WHERE region_id = ${region.id}::bigint AND is_active ORDER BY public_id FOR NO KEY UPDATE
    `;
    for (const label of labels) {
        const text =
            nameNeu &&
            (label.text_follows_name === true || (label.text_follows_name === null && label.name === region.name));
        // Ohne Art bisher folgen alle (ihre Namensart war geraten, meist `region`).
        const art = artNeu && (region.region_type === null || label.subtype === region.region_type);
        if (!text && !art) continue;
        const [danach] = await tx<{ revision: number }[]>`
            UPDATE map_label SET name = ${text ? neu.name : label.name}, subtype = ${art ? neu.type : label.subtype}
             WHERE id = ${label.id}::bigint
            RETURNING revision::int AS revision
        `;
        const labelChanges: Record<string, { before: unknown; after: unknown }> = {};
        if (text) labelChanges["text"] = { before: label.name, after: neu.name };
        if (art) labelChanges["type"] = { before: label.subtype, after: neu.type };
        entries.push({
            action: text ? "label.renamed" : "label.updated",
            regionId: region.public_id,
            labelId: label.public_id,
            revisionBefore: label.revision,
            revisionAfter: danach!.revision,
            changes: labelChanges,
        });
        affected.push({ kind: "label", id: label.public_id, revision: danach!.revision });
    }
    return { affected, entries, verworfen };
}

const istGebirge = (layer: string, type: string | null): boolean => layer === "topographie" && type === "gebirge";

/** Felder, die in keine Ableitung eingehen: verborgen (T41) und die Gefahrenlage (WI-0308). */
const OHNE_ABLEITUNG: ReadonlySet<string> = new Set(["hidden", "hazards"]);

async function schreibeBeschriftungen(
    tx: Sql,
    region: RegionZeile,
    labels: NonNullable<LandscapeUpdateBody["labels"]>,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[] }> {
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    for (const label of labels) {
        const [zeile] = await tx<LabelZeile[]>`
            SELECT public_id::text AS public_id, revision::int AS revision, updated_at, name, text_follows_name,
                   label_size::text AS label_size, label_priority, label_min_zoom, label_max_zoom, show_name,
                   ST_X(geom) AS x, ST_Y(geom) AS y
              FROM map_label WHERE public_id = ${label.id}::uuid AND region_id = ${region.id}::bigint AND is_active
               FOR NO KEY UPDATE
        `;
        if (zeile === undefined)
            throw ungueltig("Diese Beschriftung gehört nicht zur Landschaft.", { labelId: label.id });
        if (zeile.revision !== label.baseRevision)
            throw await mapEditConflict(
                tx,
                { kind: "label", publicId: zeile.public_id },
                { revision: zeile.revision, changedAt: zeile.updated_at },
            );
        const c: LandscapeLabelChanges = label.changes;
        // Die eigene Spanne als Paar (Sicht `map_label_effective`, 0057): ein einzelner Wert wirkte nicht.
        if (
            (c.zoomMin === undefined) !== (c.zoomMax === undefined) ||
            (c.zoomReset === true && c.zoomMin !== undefined)
        )
            throw ungueltig("Die Spanne geht als Paar: sichtbar ab und bis, oder die Vorgabe der Art.", {
                labelId: label.id,
                field: "zoom",
            });
        if (c.zoomMin !== undefined && c.zoomMax !== undefined && c.zoomMin > c.zoomMax)
            throw ungueltig("„Sichtbar ab“ liegt hinter „sichtbar bis“.", { labelId: label.id, field: "zoom" });
        const zuruecksetzen = c.zoomReset === true;
        // Die Lage (C4) bleibt in der Karte: sonst schlüge `map_label_inside_domain` erst beim Schreiben an.
        const [x, y] = c.position ?? [null, null];
        if (c.position !== undefined) {
            const [drin] = await tx<{ inside: boolean }[]>`
                SELECT map_domain_contains(${region.map_domain_id}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)) AS inside
            `;
            if (drin?.inside !== true)
                throw ungueltig("Die Beschriftung liegt außerhalb der Karte.", {
                    labelId: label.id,
                    field: "position",
                });
        }
        const [geschrieben] = await tx<LabelZeile[]>`
            UPDATE map_label
               SET label_size = COALESCE(${c.size ?? null}::numeric(4, 1), label_size),
                   label_priority = COALESCE(${c.priority ?? null}::smallint, label_priority),
                   label_min_zoom = CASE WHEN ${zuruecksetzen} THEN NULL
                                         ELSE COALESCE(${c.zoomMin ?? null}::smallint, label_min_zoom) END,
                   label_max_zoom = CASE WHEN ${zuruecksetzen} THEN NULL
                                         ELSE COALESCE(${c.zoomMax ?? null}::smallint, label_max_zoom) END,
                   show_name = COALESCE(${c.visible ?? null}::boolean, show_name),
                   -- ↺ „Namen übernehmen“ (FL3): Ein neuer Name derselben Operation kommt danach mit (schreibeFelder).
                   name = CASE WHEN ${c.followName === true} THEN ${region.name} ELSE name END,
                   text_follows_name = CASE WHEN ${c.followName === true} THEN TRUE ELSE text_follows_name END,
                   geom = CASE WHEN ${x}::float8 IS NULL THEN geom ELSE ST_SetSRID(ST_MakePoint(${x}, ${y}), 0) END
             WHERE public_id = ${label.id}::uuid AND revision = ${label.baseRevision}
            RETURNING public_id::text AS public_id, revision::int AS revision, updated_at, name, text_follows_name,
                      label_size::text AS label_size, label_priority, label_min_zoom, label_max_zoom, show_name,
                      ST_X(geom) AS x, ST_Y(geom) AS y
        `;
        const vorher = labelWerte(zeile);
        const nachher = labelWerte(geschrieben!);
        const changes = Object.fromEntries(
            Object.keys(vorher)
                .filter((feld) => JSON.stringify(vorher[feld]) !== JSON.stringify(nachher[feld]))
                .map((feld) => [feld, { before: vorher[feld], after: nachher[feld] }]),
        );
        if (Object.keys(changes).length === 0) continue;
        affected.push({ kind: "label", id: zeile.public_id, revision: geschrieben!.revision });
        entries.push({
            action: "label.updated",
            regionId: region.public_id,
            labelId: zeile.public_id,
            revisionBefore: zeile.revision,
            revisionAfter: geschrieben!.revision,
            changes,
        });
    }
    return { affected, entries };
}

/** Das Gebirge je Teilfläche (P4): nur Teilflächen dieser Landschaft; je geänderter Teilfläche eine Zeile `area.gebirge`. */
async function schreibeGebirge(
    tx: Sql,
    region: RegionZeile,
    gebirge: NonNullable<LandscapeUpdateBody["gebirge"]>,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[] }> {
    const flaechen = gebirge.map((g) => g.area);
    const eigene = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id FROM region_area
         WHERE region_id = ${region.id}::bigint AND is_active AND public_id = ANY(${flaechen}::uuid[])
    `;
    const fremd = flaechen.filter((area) => !eigene.some((zeile) => zeile.public_id === area));
    if (fremd.length > 0)
        throw ungueltig("Diese Teilfläche gehört nicht zur Landschaft.", { field: "gebirge", areas: fremd });
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    for (const { area, changes } of gebirge) {
        // Das Netz (WI-0245) steht als Feld `netz` mit dem ganzen Netz vorher und nachher im Protokoll, wie eine Spalte.
        const geschrieben = await gebirgSchreiben(tx, area, changes);
        if (geschrieben.aenderungen.length === 0) continue;
        affected.push(...geschrieben.affected);
        entries.push({
            action: "area.gebirge",
            regionId: region.public_id,
            areaId: area,
            changes: {
                gebirge: {
                    before: Object.fromEntries(geschrieben.aenderungen.map((a) => [a.feld, a.alt])),
                    after: Object.fromEntries(geschrieben.aenderungen.map((a) => [a.feld, a.neu])),
                },
            },
        });
    }
    return { affected, entries };
}

/** Die Höhen aus der Gipfelliste (P5): nur Gipfel in einer Teilfläche dieser Landschaft, je über `gipfelSchreiben`. */
async function schreibeGipfelhoehen(
    tx: Sql,
    actor: MapActor,
    region: RegionZeile,
    gipfel: NonNullable<LandscapeUpdateBody["peaks"]>,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[] }> {
    const kennungen = gipfel.map((g) => g.id);
    const drin = await tx<{ public_id: string }[]>`
        SELECT p.public_id::text AS public_id FROM terrain_peak_gelaende p
         WHERE p.public_id = ANY(${kennungen}::uuid[]) AND p.is_active
           AND EXISTS (SELECT 1 FROM region_area a WHERE a.region_id = ${region.id}::bigint AND a.is_active AND ST_Covers(a.geom, p.geom))
    `;
    const fremd = kennungen.filter((id) => !drin.some((zeile) => zeile.public_id === id));
    if (fremd.length > 0)
        throw ungueltig("Dieser Gipfel liegt nicht in der Landschaft.", { field: "peaks", peaks: fremd });
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    for (const { id, baseRevision, height } of gipfel) {
        const geschrieben = await gipfelSchreiben(tx, actor, id, baseRevision, { height });
        if (geschrieben === undefined) continue;
        affected.push(...geschrieben.affected);
        entries.push(...geschrieben.entries);
    }
    return { affected, entries };
}

/** `landscape.update` (WI-0178 B2): Felder, Beschriftungen und Form einer Landschaft in EINER Operation. */
export async function updateLandscape(
    database: Database,
    actor: MapActor,
    regionId: string,
    body: LandscapeUpdateBody,
): Promise<OperationReceipt> {
    const c = body.changes ?? {};
    const felder =
        c.name !== undefined ||
        c.layer !== undefined ||
        c.type !== undefined ||
        c.locked !== undefined ||
        c.curve !== undefined ||
        c.order !== undefined ||
        c.hidden !== undefined ||
        c.hazards !== undefined;
    const labels = body.labels ?? [];
    const areas = body.areas ?? [];
    const gebirge = body.gebirge ?? [];
    const gipfel = body.peaks ?? [];
    if (!felder && labels.length === 0 && areas.length === 0 && gebirge.length === 0 && gipfel.length === 0)
        throw ungueltig("Die Änderung trägt nichts zu schreiben.", { field: "changes" });
    if (felder && body.baseRevision === undefined)
        throw ungueltig("Felder der Landschaft brauchen ihre Revision.", { field: "baseRevision" });
    if (new Set(labels.map((label) => label.id)).size !== labels.length)
        throw ungueltig("Eine Beschriftung steht zweimal in der Änderung.", { field: "labels" });
    if (new Set(gebirge.map((g) => g.area)).size !== gebirge.length)
        throw ungueltig("Eine Teilfläche steht zweimal im Gebirge der Änderung.", { field: "gebirge" });
    if (new Set(gipfel.map((g) => g.id)).size !== gipfel.length)
        throw ungueltig("Ein Gipfel steht zweimal in der Änderung.", { field: "peaks" });
    const region = await leseRegion(database, regionId);
    if (region === undefined) throw new ApiError(404, "not_found", "Diese Landschaft gibt es nicht.");
    const name = c.name?.trim();
    if (c.name !== undefined && (name === undefined || name === ""))
        throw ungueltig("Eine Landschaft braucht einen Namen.", { field: "name" });
    const neu: Felder = {
        name: name ?? region.name,
        layer: c.layer ?? region.region_layer,
        type: c.type ?? region.region_type,
        locked: c.locked ?? region.is_locked,
        hidden: c.hidden ?? region.is_hidden,
        curveEnabled: c.curve?.enabled ?? region.label_curve_enabled,
        curveMax: c.curve?.max ?? region.label_curve_max,
        hazards: c.hazards === undefined ? region.hazards : ordneGefahren(c.hazards),
        order: c.order,
    };
    if (neu.layer !== region.region_layer && c.type === undefined)
        throw ungueltig("Eine neue Ebene braucht eine Art aus ihr.", { field: "type" });
    if (c.type !== undefined && !landscapeTypeFits(neu.layer, c.type))
        throw ungueltig("Diese Art gehört nicht zur Ebene.", { field: "type", layer: neu.layer, type: c.type });
    const vorher = { name: region.name, layer: region.region_layer, type: region.region_type };
    if (isTerrainFrame(vorher) && (neu.name !== vorher.name || neu.layer !== vorher.layer || neu.type !== vorher.type))
        throw ungueltig("Der Kontinent Aventurien rahmt das Gelände: Name, Ebene und Art bleiben.", { field: "name" });
    const form: FormVorab | undefined = areas.length > 0 ? await pruefeFlaechen(database, regionId, areas) : undefined;

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "landscape.update",
            mapDomainId: region.map_domain_id,
            body: { regionId, ...body },
        },
        async (tx) => {
            await pruefeFremdeSperre(tx, actor, [regionId]);
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            const teile: string[] = [];
            let verworfen = 0;
            // Erst die Beschriftungen gegen ihre Revision, dann der Name: Er schreibt die Beschriftungen, die ihm folgen, mit.
            if (labels.length > 0) {
                const geschrieben = await schreibeBeschriftungen(tx, region, labels);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                if (geschrieben.entries.length > 0) teile.push("Beschriftungen");
            }
            if (felder) {
                const geschrieben = await schreibeFelder(tx, region, body.baseRevision!, neu);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                verworfen = geschrieben.verworfen;
                if (neu.name !== region.name) teile.push("Name");
                if (neu.layer !== region.region_layer) teile.push("Ebene");
                if (neu.type !== region.region_type) teile.push("Art");
                if (neu.locked !== region.is_locked) teile.push("Klicksperre");
                if (neu.hidden !== region.is_hidden) teile.push(neu.hidden ? "verborgen" : "zurückgeholt");
                if (!gleicheGefahren(neu.hazards, region.hazards)) teile.push("Gefahrenlage");
                if (neu.curveEnabled !== region.label_curve_enabled || neu.curveMax !== region.label_curve_max)
                    teile.push("Kurve");
                if (neu.order !== undefined && geschrieben.entries[0]?.changes?.["order"] !== undefined)
                    teile.push(neu.order === "front" ? "ganz nach vorn" : "ganz nach hinten");
            }
            if (gebirge.length > 0) {
                const geschrieben = await schreibeGebirge(tx, region, gebirge);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                if (geschrieben.entries.length > 0) teile.push("Gebirge");
            }
            if (gipfel.length > 0) {
                const geschrieben = await schreibeGipfelhoehen(tx, actor, region, gipfel);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                if (geschrieben.entries.length > 0) teile.push("Gipfelhöhen");
            }
            let gelaende = false;
            if (felder && (neu.layer !== region.region_layer || neu.type !== region.region_type))
                gelaende =
                    speistGelaende(region.region_layer, region.region_type) || speistGelaende(neu.layer, neu.type);
            let nachbarn = 0;
            if (form !== undefined) {
                const geschrieben = await formeUmIn(tx, actor, regionId, areas, form);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                nachbarn = geschrieben.nachbarn;
                if (geschrieben.entries.length > 0) {
                    teile.push("Gebietsform");
                    gelaende ||= speistGelaende(neu.layer, neu.type);
                }
            }
            // Die Schriftläufe hängen an der Landschaft (`label_runs` je berührter Landschaft): Sie steht unter `affected`, auch wenn
            // nur eine Beschriftung oder die Form geändert wurde; ihre Revision bleibt dann, wie sie ist.
            if (entries.length > 0 && !affected.some((x) => x.kind === LANDSCHAFT_ART && x.id === regionId))
                affected.unshift({ kind: LANDSCHAFT_ART, id: regionId, revision: region.revision });
            const mit = nachbarn > 0 ? `, ${String(nachbarn)} Nachbarflächen mitgezogen` : "";
            return {
                receipt: { affected: dedupe(affected), derivedWork: [], warnings: gelaende ? [GELAENDE_VERALTET] : [] },
                summary:
                    teile.length === 0
                        ? `${region.name}: nichts geändert`
                        : `${neu.name}: ${teile.join(", ")} geändert${mit}${verworfen > 0 ? `, ${String(verworfen)} Gebirgswerte verworfen` : ""}`,
                entries,
                // Verbergen allein geht in keine Ableitung ein (T41, Claudio 2026-10-18): nur die Kachelrevision. Ebenso die Gefahrenlage
                // (WI-0308): Sie ändert keine Fläche, keinen Namen und kein Gelände; Kachel und Wegfindung lesen sie über die Revision.
                ...(entries.length > 0 &&
                entries.every((e) => Object.keys(e.changes ?? {}).every((k) => OHNE_ABLEITUNG.has(k)))
                    ? { ableitung: false as const }
                    : {}),
            };
        },
    );
}

/** Jede Landschaft einmal (die Form meldet sie schon), in der Reihenfolge des ersten Auftretens. */
function dedupe(affected: OperationReceipt["affected"]): OperationReceipt["affected"] {
    const gesehen = new Set<string>();
    return affected.filter((x) => {
        const schluessel = `${x.kind}|${x.id}`;
        if (gesehen.has(schluessel)) return false;
        gesehen.add(schluessel);
        return true;
    });
}
