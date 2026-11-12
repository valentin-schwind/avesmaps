import { randomUUID } from "node:crypto";
import {
    AVENTURIA,
    EDITOR_LOCK_ERROR_STATUS,
    EDITOR_PLACE_TEXT_FIELDS,
    herkunftDerAenderung,
    MOVE_TARGET_RADIUS,
    PATH_END_AT_PLACE,
    PLACE_SUBTYPES,
    type EditConflictDetails,
    type EditorLock,
    type EditorMoveTargets,
    type EditorPathEnd,
    type EditorPlaceDetail,
    type EditorPlaceTextChange,
    type EditorPlaceTextField,
    type OperationReceipt,
    type PlaceCreateBody,
    type PlaceMoveBody,
    type PlaceTakeOffMapBody,
    type PlaceSubtype,
    type PlaceUpdateBody,
} from "@avesmaps3d/shared";
import { raumDerAdresseInUmgebung } from "../kanon/namensraum.ts";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { derivePathVisualsFor } from "../derive/path-visual.ts";
import { zieheKraftlinienNach } from "../derive/powerline-bahn.ts";
import { LANDING_REACH } from "../routing/sea-grid.ts";
import { ApiError } from "../http/api-error.ts";
import { composeLage } from "../subjects/facts.ts";
import { fuehreFlussHoehenNach, wasserHoehenProtokoll, type FlussPunktVerschoben } from "../terrain/fluss-hoehen.ts";
import { listEditorLocks } from "./editor-lock.ts";
import { leseHerkunft, setzeHerkunft } from "./feld-herkunft.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "./map-operation.ts";
import { pruefeEntfernen } from "./place-removal-regeln.ts";

/**
 * Lesen und Schreiben eines Orts im Ortseditor (WI-0128 E10 Teil a; EDIT-0001 §4.3, §4.4, §6.2; Vertrag `shared/editor-place-ops.ts`).
 *
 * - **Revision als Konfliktprüfung** (§6.1 Nr. 1): Jede Operation sperrt den Ort (`FOR UPDATE`), vergleicht `baseRevision` und berührt
 *   ihn mit `… AND revision = $base`; auch eine Änderung nur an den Einzelheiten zählt so `place.revision` genau einmal. Veraltet:
 *   409 `edit_conflict` mit jetziger Revision, Zeit und Person aus dem Fachprotokoll.
 * - **Herkunft je Feld** (`*_origin`): ein gesetzter Wert ist `manual`, ↺ setzt Wert und Herkunft `wiki` aus dem Wiki-Stand; die
 *   Beschreibung hat keine Herkunftsspalte. Ein Satz Einzelheiten ohne ein einziges Feld wird still gelegt (`retired_origin = editor`),
 *   wie es die Bedingungen von 0065 verlangen.
 * - **Verschieben ist EINE Operation** (§4.4, G4): der Ort und die genannten Wegenden, je Weg seine Revision, die gezeichnete Kurve
 *   derselben Wege in derselben Transaktion (§6.3). Wegenden am Ort, die nicht genannt sind, bleiben liegen (Strg, D11; G1 = A): Die
 *   Quittung nennt sie als Befund `path_end_left`.
 * - 🪤 **Umbenennen und Stätten:** Stätten hängen heute am Namen der Siedlung (`settlement_place.settlement_key`, 0078); ein neuer
 *   Name trennt sie, bis E18 sie an die Kennung bindet. Die Quittung nennt das als Befund `staetten_by_name`.
 * - **`place.create`** (E10 Teil b): ein neuer Ort mit Lage in der Domäne Aventurien, `source_system = 'avesmaps3d'` ohne
 *   `legacy_public_id` (0091): Kein Import nimmt ihn außer Betrieb, das Zurücksetzen der Testwelt ist E14. Revision 1, Name eindeutig.
 * - **Ein Ort ohne Lage** (E16, Betreiber 2026-10-11: „es kriegt das flag "nicht auf der karte"“): steht in `place_unplaced` (0105),
 *   weil `place.geom` NOT NULL bleibt. Lesen, `place.update` und `place.move` gehen über dieselbe Kennung; `place.move` setzt ihn auf
 *   die Karte: ein `place` mit derselben `public_id` und der nächsten Revision, die Texte als eigene Werte in `place_detail`, die Zeile
 *   ohne Lage stillgelegt (`placed`).
 * - **Ein Wiki-Eintrag aus „Nicht auf der Karte“** (`place.create` mit `wikiKey`): der Ort mit Lage, dazu Legacys Zuordnung X2 mit
 *   eigener Herkunft (`wiki_key_assignment`, `source_system = 'avesmaps3d'`; der Import fasst sie nie an) und die redaktionelle
 *   Zuordnung mit Adresse (`place_wiki_assignment`, `address_only`, Herkunft `editor`). Damit gilt der Eintrag als platziert.
 */

export interface PlaceRow {
    id: string;
    public_id: string;
    map_domain_id: string;
    revision: number;
    updated_at: Date;
    name: string;
    subtype: string;
    place_kind: string | null;
    /** Fehlt bei einem Ort ohne Lage (`place_unplaced`). */
    x: number | null;
    y: number | null;
    /** Die Zeile steht in `place_unplaced` (E16), nicht in `place`. */
    unplaced: boolean;
    is_active: boolean;
    is_hidden: boolean;
    is_ruined: boolean;
    is_nodix: boolean;
    is_seaport: boolean;
    is_underground: boolean;
    is_withdrawn: boolean;
    is_approximate: boolean;
    /** Meer oder See in Reichweite einer Anlegestelle; NULL ohne Lage. */
    water_nearby: boolean | null;
    source_system: string;
    detail_id: string | null;
    detail_active: boolean | null;
    description: string | null;
    einwohner: string | null;
    lage: string | null;
    oberhaupt: string | null;
    einwohner_origin: "wiki" | "manual" | null;
    lage_origin: "wiki" | "manual" | null;
    oberhaupt_origin: "wiki" | "manual" | null;
    wiki_url: string | null;
    assignment_state: string | null;
    wiki_title: string | null;
    /** Der Name laut Wiki (Infobox, Legacy `nest.name`). */
    s_wiki_name: string | null;
    /** Die Ortsklasse laut Wiki und ob Legacy sie geraten hat (0184). */
    s_settlement_class: string | null;
    s_settlement_class_guessed: boolean | null;
    /** Die Bauwerkart laut Wiki (WI-0295). */
    s_building_type: string | null;
    s_description: string | null;
    s_einwohner: string | null;
    s_oberhaupt: string | null;
    region_text: string | null;
    staat_text: string | null;
}

export async function readPlace(sql: Queryable, publicId: string, lock: boolean): Promise<PlaceRow | undefined> {
    const rows = await sql.unsafe<PlaceRow[]>(
        `SELECT p.id::text, p.public_id::text, p.map_domain_id, p.revision::int AS revision, p.updated_at, p.name, p.subtype,
                p.place_kind, ST_X(p.geom) AS x, ST_Y(p.geom) AS y, FALSE AS unplaced, p.is_active, p.is_hidden, p.is_ruined,
                p.is_nodix, p.is_seaport, p.is_underground, p.is_withdrawn, p.is_approximate, p.source_system,
                EXISTS (
                    SELECT 1 FROM region_area w JOIN region r ON r.id = w.region_id AND r.is_active
                     WHERE w.map_domain_id = p.map_domain_id AND w.is_active AND r.region_type IN ('meer', 'see')
                       AND ST_DWithin(w.geom, p.geom, $2)
                ) AS water_nearby,
                d.id::text AS detail_id, d.is_active AS detail_active, d.description, d.einwohner, d.lage, d.oberhaupt,
                d.einwohner_origin, d.lage_origin, d.oberhaupt_origin,
                a.wiki_url, a.assignment_state, s.wiki_title, s.wiki_name AS s_wiki_name,
                s.settlement_class AS s_settlement_class, s.settlement_class_guessed AS s_settlement_class_guessed,
                s.building_type AS s_building_type, s.description AS s_description, s.einwohner AS s_einwohner, s.oberhaupt AS s_oberhaupt, s.region_text, s.staat_text
           FROM place p
           LEFT JOIN place_detail d ON d.place_id = p.id
           LEFT JOIN place_wiki_assignment a ON a.place_id = p.id AND a.is_active
           LEFT JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id AND s.is_active
          WHERE p.public_id = $1::uuid
            AND (p.is_active OR NOT EXISTS (SELECT 1 FROM place_unplaced u WHERE u.public_id = p.public_id AND u.is_active))
          ${lock ? "FOR UPDATE OF p" : ""}`,
        [publicId, LANDING_REACH],
    );
    // Von der Karte genommen: Der Ort steht stillgelegt in `place` und aktiv in `place_unplaced`; es gilt der Ort ohne Lage.
    return rows[0] ?? (await readUnplaced(sql, publicId, lock));
}

/** Ein Ort ohne Lage in der Form eines Orts: keine Lage, keine Wiki-Zuordnung, die Texte als eigene Werte. */
async function readUnplaced(sql: Queryable, publicId: string, lock: boolean): Promise<PlaceRow | undefined> {
    const rows = await sql.unsafe<PlaceRow[]>(
        `SELECT u.id::text, u.public_id::text, u.map_domain_id, u.revision::int AS revision, u.updated_at, u.name, u.subtype,
                u.place_kind, NULL::float8 AS x, NULL::float8 AS y, TRUE AS unplaced, u.is_active, u.is_hidden, u.is_ruined,
                u.is_nodix, u.is_seaport, u.is_underground, u.is_withdrawn, u.is_approximate, NULL::boolean AS water_nearby,
                u.source_system,
                NULL AS detail_id, TRUE AS detail_active, u.description, u.einwohner, u.lage, u.oberhaupt,
                CASE WHEN u.einwohner IS NULL THEN NULL ELSE 'manual' END AS einwohner_origin,
                CASE WHEN u.lage IS NULL THEN NULL ELSE 'manual' END AS lage_origin,
                CASE WHEN u.oberhaupt IS NULL THEN NULL ELSE 'manual' END AS oberhaupt_origin,
                NULL AS wiki_url, NULL AS assignment_state, NULL AS wiki_title, NULL AS s_wiki_name, NULL AS s_settlement_class,
                NULL::boolean AS s_settlement_class_guessed, NULL AS s_building_type, NULL AS s_description,
                NULL AS s_einwohner,
                NULL AS s_oberhaupt, NULL AS region_text, NULL AS staat_text
           FROM place_unplaced u
          WHERE u.public_id = $1::uuid AND u.is_active
          ${lock ? "FOR UPDATE" : ""}`,
        [publicId],
    );
    return rows[0];
}

/** Der Wert eines Felds im Wiki-Stand; die Lage setzt Legacy aus Region und Staat zusammen. */
export function wikiValue(row: PlaceRow, field: EditorPlaceTextField): string | null {
    switch (field) {
        case "description":
            return row.s_description;
        case "einwohner":
            return row.s_einwohner;
        case "oberhaupt":
            return row.s_oberhaupt;
        case "lage":
            return composeLage(row.region_text, row.staat_text);
    }
}

/** Was im Feld steht: nur ein aktiver Satz Einzelheiten zählt. */
export const ownValue = (row: PlaceRow, field: EditorPlaceTextField): string | null =>
    row.detail_active === true ? row[field] : null;
export const ownOrigin = (row: PlaceRow, field: EditorPlaceTextField): "wiki" | "manual" | null =>
    row.detail_active !== true || field === "description" ? null : row[`${field}_origin`];

export async function pathEndsAt(sql: Queryable, place: { id: string }): Promise<EditorPathEnd[]> {
    // Ein Kasten um den Ort wie Legacys ENDPOINT_BOX (±0,5), kein Kreis; der Index findet die Wege über `&&`.
    return sql.unsafe<EditorPathEnd[]>(
        `SELECT w.public_id::text AS "pathId", w.name, e.end_name AS "end", w.revision::int AS revision,
                ST_X(e.pt) AS x, ST_Y(e.pt) AS y, json_build_object('x', ST_X(e.next), 'y', ST_Y(e.next)) AS neighbor
           FROM place p
           JOIN path w ON w.map_domain_id = p.map_domain_id AND w.is_active AND w.geom && ST_Expand(p.geom, $2)
           CROSS JOIN LATERAL (VALUES ('start', ST_StartPoint(w.geom), ST_PointN(w.geom, 2)),
                                      ('end', ST_EndPoint(w.geom), ST_PointN(w.geom, ST_NPoints(w.geom) - 1))) AS e(end_name, pt, next)
          WHERE p.id = $1::bigint AND e.pt IS NOT NULL AND e.pt && ST_Expand(p.geom, $2)
          ORDER BY lower(w.name), w.public_id, e.end_name DESC`,
        [place.id, PATH_END_AT_PLACE],
    );
}

/**
 * Die Gebiete, deren Hauptstadt der Ort ist, die ihn aber in keiner ihrer Formen enthalten (E20; WI-0126 §5.5 „Gebiet“, Kap. 7.42):
 * ein Befund, nie ein Tor. Ein Gebiet ohne Form (nicht gezeigt) zählt nicht.
 */
async function capitalOutside(sql: Queryable, row: PlaceRow): Promise<{ capitalOutside?: string[] }> {
    if (row.unplaced) return {};
    const gebiete = await sql<{ name: string }[]>`
        SELECT t.name FROM territory t
         WHERE t.is_active AND t.capital_place_public_id = ${row.public_id}::uuid
           AND EXISTS (SELECT 1 FROM territory_shape s WHERE s.territory_id = t.id)
           AND NOT EXISTS (
               SELECT 1 FROM territory_shape s JOIN place p ON p.public_id = t.capital_place_public_id
                WHERE s.territory_id = t.id AND ST_Covers(s.geom, p.geom)
           )
         ORDER BY t.name
    `;
    return gebiete.length > 0 ? { capitalOutside: gebiete.map((gebiet) => gebiet.name) } : {};
}

/** Der Ort, wie der Ortseditor ihn liest (`GET /api/editor/places/:id`); `undefined`, wenn es ihn nicht gibt. */
export async function readEditorPlace(database: Database, publicId: string): Promise<EditorPlaceDetail | undefined> {
    const row = await readPlace(database, publicId, false);
    if (row === undefined) return undefined;
    const text = (field: EditorPlaceTextField) => ({
        value: ownValue(row, field),
        origin: ownOrigin(row, field),
        wiki: wikiValue(row, field),
    });
    return {
        publicId: row.public_id,
        revision: row.revision,
        name: row.name,
        subtype: row.subtype,
        kind: row.place_kind,
        ...(row.x !== null && row.y !== null ? { position: { x: row.x, y: row.y } } : {}),
        active: row.is_active,
        hidden: row.is_hidden,
        ruined: row.is_ruined,
        nodix: row.is_nodix,
        seaport: row.is_seaport,
        underground: row.is_underground,
        withdrawn: row.is_withdrawn,
        approximate: row.is_approximate,
        ...(row.water_nearby !== null ? { waterNearby: row.water_nearby } : {}),
        ...(await capitalOutside(database, row)),
        sourceSystem: row.source_system,
        fields: {
            description: text("description"),
            einwohner: text("einwohner"),
            lage: text("lage"),
            oberhaupt: text("oberhaupt"),
        },
        wiki:
            row.assignment_state === null
                ? null
                : { url: row.wiki_url, title: row.wiki_title, state: row.assignment_state },
        ...wikiName(row),
        ...wikiGroesse(row),
        ...wikiArt(row),
        ...(await herkunftDes(database, row)),
        pathEnds: row.unplaced ? [] : await pathEndsAt(database, row),
    };
}

/** Die Bauwerkart laut Wiki, nur mit Artikel (WI-0295): das Feld „Art“ zeigt sie, solange es leer ist. */
const wikiArt = (row: PlaceRow): { kindWiki?: string } => {
    const art = row.assignment_state === null ? "" : (row.s_building_type ?? "").trim();
    return art === "" ? {} : { kindWiki: art };
};

/** Der Name laut Wiki, nur mit Artikel (WI-0225). */
const wikiName = (row: PlaceRow): { nameWiki?: string } =>
    row.assignment_state !== null && row.s_wiki_name !== null ? { nameWiki: row.s_wiki_name } : {};

/**
 * Die Ortsgröße laut Wiki (WI-0225), nur mit Artikel. 🔴 Legacys Regel (`js/ui/wiki-assign-ort.js`, `avesmapsWikiAssignOrtOrtsgroesse` und
 * `avesmapsWikiAssignOrtGroesseIstGeraten`): Eine geratene Klasse ist unbekannt; trägt das Nest kein Kennzeichen, gilt „dorf“ als geraten,
 * weil der Parser darauf zurückfällt (am 17.08.2026 bot das ↺ sonst an, die Metropole Gareth zum Dorf zu machen).
 */
export function wikiOrtsgroesse(row: PlaceRow): PlaceSubtype | undefined {
    if (row.assignment_state === null) return undefined;
    const wert = row.s_settlement_class?.trim().toLowerCase() ?? "";
    if (!(PLACE_SUBTYPES as readonly string[]).includes(wert)) return undefined;
    if (row.s_settlement_class_guessed === true) return undefined;
    if (row.s_settlement_class_guessed === null && wert === "dorf") return undefined;
    return wert as PlaceSubtype;
}

const wikiGroesse = (row: PlaceRow): { subtypeWiki?: PlaceSubtype } => {
    const groesse = wikiOrtsgroesse(row);
    return groesse === undefined ? {} : { subtypeWiki: groesse };
};

/** Die Herkunft der Felder aus `field_origin` (WI-0225), nur wenn es einen Vermerk gibt. */
async function herkunftDes(sql: Queryable, row: PlaceRow): Promise<{ herkunft?: Record<string, "wiki" | "manual"> }> {
    const herkunft = (await leseHerkunft(sql, "place", [row.public_id])).get(row.public_id);
    return herkunft === undefined ? {} : { herkunft: { ...herkunft } as Record<string, "wiki" | "manual"> };
}

/**
 * Die Einrastziele des Verschiebemodus (E12, EDIT-0001 §4.4): freie Wegenden im Umkreis `MOVE_TARGET_RADIUS`, einmal beim Start geholt
 * (beim Ziehen fragt nichts den Server). Frei heißt: kein aktiver Ort im Kasten ±`PATH_END_AT_PLACE` - auch nicht dieser Ort; seine
 * eigenen Enden ziehen mit, statt Ziel zu sein. `undefined`, wenn es den Ort nicht gibt.
 */
export async function readMoveTargets(database: Database, publicId: string): Promise<EditorMoveTargets | undefined> {
    const [ort] = await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${publicId}::uuid`;
    if (ort === undefined) {
        // Ein Ort ohne Lage hat keine Umgebung: Er rastet beim Setzen nirgends ein.
        const ohne = await readUnplaced(database, publicId, false);
        return ohne === undefined ? undefined : { radius: MOVE_TARGET_RADIUS, freeEnds: [] };
    }
    const freeEnds = await database.unsafe<EditorMoveTargets["freeEnds"]>(
        `SELECT w.public_id::text AS "pathId", w.name, e.end_name AS "end", ST_X(e.pt) AS x, ST_Y(e.pt) AS y
           FROM place p
           JOIN path w ON w.map_domain_id = p.map_domain_id AND w.is_active AND w.geom && ST_Expand(p.geom, $2)
           CROSS JOIN LATERAL (VALUES ('start', ST_StartPoint(w.geom)), ('end', ST_EndPoint(w.geom))) AS e(end_name, pt)
          WHERE p.id = $1::bigint AND e.pt IS NOT NULL AND ST_DWithin(e.pt, p.geom, $2)
            AND NOT EXISTS (
                SELECT 1 FROM place q
                 WHERE q.is_active AND q.map_domain_id = p.map_domain_id AND q.geom && ST_Expand(e.pt, $3)
            )
          ORDER BY ST_Distance(e.pt, p.geom), w.public_id, e.end_name`,
        [ort.id, MOVE_TARGET_RADIUS, PATH_END_AT_PLACE],
    );
    return { radius: MOVE_TARGET_RADIUS, freeEnds };
}

/** 409 `edit_conflict` mit jetziger Revision und, aus dem Fachprotokoll, wann und von wem sie kam. */
export async function mapEditConflict(
    sql: Queryable,
    target: {
        kind:
            | "place"
            | "path"
            | "powerline"
            | "area"
            | "territory"
            | "territory_area"
            | "region"
            | "label"
            | "peak"
            | "source"
            | "work"
            | "lore"
            | "corpus"
            | "sprache"
            | "sprache_flaeche";
        publicId: string;
    },
    current: { revision: number; changedAt: Date },
): Promise<ApiError> {
    // Die Kraftlinie (WI-0205 K6): ein Abschnitt, wie sein Eintrag im Fachprotokoll (0143). Die Teilfläche einer Landschaft (WI-0178
    // C2, `area.reshape`) steht im Protokoll unter ihrer eigenen Kennung (0137).
    const column = {
        place: "e.place_public_id",
        path: "e.path_public_id",
        powerline: "e.powerline_public_id",
        area: "e.region_area_public_id",
        territory: "e.territory_public_id",
        territory_area: "e.territory_area_public_id",
        // Die Landschaft und ihre Beschriftung (WI-0178 B2, `landscape.update`), je unter ihrer eigenen Kennung (0137).
        region: "e.region_public_id",
        label: "e.map_label_public_id",
        // Der Gipfel (WI-0178 P1, Migration 0205).
        peak: "e.peak_public_id",
        // Die Katalogquelle (WI-0254, Migration 0232).
        source: "e.source_public_id",
        // Das Werk der Spielliteratur (WI-0254, Migration 0233).
        work: "e.work_public_id",
        // Der Lore-Eintrag, das Vorkommen (WI-0254, Migration 0234).
        lore: "e.lore_public_id",
        // Der Korpus (WI-0254, Migration 0236).
        corpus: "e.corpus_public_id",
        // Die Sprache und ihre Teilfläche (WI-0261 S5d, Migration 0258).
        sprache: "e.sprache_public_id",
        sprache_flaeche: "e.sprache_flaeche_public_id",
    }[target.kind];
    const [last] = await sql.unsafe<{ at: Date; id: string | null; display_name: string | null }[]>(
        `SELECT o.at, o.actor_person_id::text AS id, p.display_name
           FROM map_audit_event e
           JOIN map_operation o ON o.operation_id = e.operation_id
           LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
          WHERE ${column} = $1::uuid AND e.revision_after = $2
          ORDER BY e.id DESC
          LIMIT 1`,
        [target.publicId, current.revision],
    );
    const details: EditConflictDetails = {
        currentRevision: current.revision,
        changedAt: (last?.at ?? current.changedAt).toISOString(),
    };
    if (last?.id != null && last.display_name != null)
        details.changedBy = { id: last.id, displayName: last.display_name };
    return new ApiError(
        409,
        "edit_conflict",
        "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
        details,
    );
}

/**
 * Hält ein anderer einen der Orte (Sperre während der Bearbeitung, EDIT-0003 §4)? Dann 409 `object_locked` mit seiner Sperre, VOR jeder Änderung. Für die Einzelwege dieser
 * Datei und von `place-removal.ts` wie für die Mehrfachauswahl (`place-sammel.ts`) und die Rücknahme (`ruecknahme-ort.ts`); die eigene Sperre der Person zählt nicht (WI-0265 R2).
 */
export async function pruefeFremdeOrtssperre(tx: Sql, actor: MapActor, ids: readonly string[]): Promise<void> {
    const fremd = (await listEditorLocks(tx, "place", undefined)).find(
        (sperre: EditorLock) =>
            ids.includes(sperre.id) && (actor.kind !== "person" || sperre.person.id !== actor.personId),
    );
    if (fremd !== undefined)
        throw new ApiError(
            EDITOR_LOCK_ERROR_STATUS.object_locked,
            "object_locked",
            ids.length > 1
                ? `${fremd.person.name} bearbeitet einen der Orte gerade.`
                : `${fremd.person.name} bearbeitet das gerade.`,
            { lock: fremd },
        );
}

/** Den Ort sperren und gegen den Stand des Entwurfs prüfen; 404 ohne Ort, 409 bei veraltetem Stand. */
export async function lockedPlace(tx: Sql, publicId: string, baseRevision: number): Promise<PlaceRow> {
    const row = await readPlace(tx, publicId, true);
    if (row === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
    if (row.revision !== baseRevision)
        throw await mapEditConflict(
            tx,
            { kind: "place", publicId },
            { revision: row.revision, changedAt: row.updated_at },
        );
    return row;
}

/** Den Ort berühren: zählt seine Revision genau einmal und gibt die neue zurück. */
async function touchPlace(tx: Sql, row: PlaceRow, set: Record<string, unknown>): Promise<number> {
    const columns = Object.keys(set);
    const assignments = [...columns.map((column, index) => `${column} = $${String(index + 3)}`), "revision = revision"];
    const table = row.unplaced ? "place_unplaced" : "place";
    const [updated] = await tx.unsafe<{ revision: number }[]>(
        `UPDATE ${table} SET ${assignments.join(", ")} WHERE id = $1::bigint AND revision = $2 RETURNING revision::int AS revision`,
        [row.id, row.revision, ...Object.values(set)] as never[],
    );
    if (updated === undefined) throw new Error("Ort zwischen Sperre und Änderung verändert");
    return updated.revision;
}

/**
 * Die Revision nach einem Wechsel zwischen `place` und `place_unplaced` (Fehler 2026-10-12, Migration 0115): Beide Tafeln tragen eine
 * Zeile mit DERSELBEN `public_id` und zählen sie je für sich; ein Ort, der zwischen zwei Wechseln bearbeitet wurde, hat in der einen
 * Tafel eine höhere Revision als in der anderen. Die nächste Revision des Objekts liegt über BEIDEN; die Operation setzt sie an beiden
 * Zeilen (`revision_bump_forward()` übernimmt sie), sonst fiele die Revision zurück und das Protokoll wiese die Operation ab.
 */
export async function nextObjectRevision(tx: Sql, publicId: string): Promise<number> {
    const [next] = await tx<{ revision: number }[]>`
        SELECT GREATEST((SELECT max(revision) FROM place WHERE public_id = ${publicId}::uuid),
                        (SELECT max(revision) FROM place_unplaced WHERE public_id = ${publicId}::uuid))::int + 1 AS revision
    `;
    return next!.revision;
}

const PLACE_COLUMNS = {
    name: "name",
    subtype: "subtype",
    kind: "place_kind",
    hidden: "is_hidden",
    ruined: "is_ruined",
    seaport: "is_seaport",
    nodix: "is_nodix",
    underground: "is_underground",
    withdrawn: "is_withdrawn",
    approximate: "is_approximate",
} as const satisfies Partial<Record<keyof PlaceUpdateBody["changes"], string>>;

const BEFORE: Record<keyof typeof PLACE_COLUMNS, (row: PlaceRow) => unknown> = {
    name: (row) => row.name,
    subtype: (row) => row.subtype,
    kind: (row) => row.place_kind,
    hidden: (row) => row.is_hidden,
    ruined: (row) => row.is_ruined,
    seaport: (row) => row.is_seaport,
    nodix: (row) => row.is_nodix,
    underground: (row) => row.is_underground,
    withdrawn: (row) => row.is_withdrawn,
    approximate: (row) => row.is_approximate,
};

const emptyReceipt = (): Pick<OperationReceipt, "affected" | "derivedWork" | "warnings"> => ({
    affected: [],
    derivedWork: [],
    warnings: [],
});

/** `place.update` (EDIT-0001 §4.3): Merkmale am Ort und die Einzelheiten, eine Revision. */
export async function updatePlace(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PlaceUpdateBody,
): Promise<OperationReceipt> {
    const domain = await domainOf(database, publicId);
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "place.update",
            mapDomainId: domain,
            body: { publicId, ...body },
            ...(body.reverts !== undefined ? { source: "restore" as const } : {}),
        },
        async (tx) => {
            await pruefeFremdeOrtssperre(tx, actor, [publicId]);
            const row = await lockedPlace(tx, publicId, body.baseRevision);
            const geaendert = await aendereOrt(tx, row, body.changes);
            if (geaendert === undefined)
                throw new ApiError(400, "validation_failed", "Die Änderung ändert nichts am Ort.");
            return {
                receipt: {
                    ...emptyReceipt(),
                    affected: [{ kind: "place", id: publicId, revision: geaendert.revision }],
                    warnings: geaendert.warnings,
                },
                summary: body.reverts !== undefined ? `${row.name}: Änderung zurückgenommen` : `${row.name} geändert`,
                entries: [
                    {
                        action: "place.updated",
                        placeId: publicId,
                        revisionBefore: row.revision,
                        revisionAfter: geaendert.revision,
                        changes: geaendert.changes,
                    },
                ],
            };
        },
    );
}

/**
 * Die Änderung an EINEM gesperrten Ort innerhalb einer Operation: `place.update` und `place.sammel` (WI-0237, ↺ auf Wiki-Werte für
 * mehrere). Zählt die Revision genau einmal; `undefined`, wenn sie nichts am Ort ändert (dann bleibt er unberührt).
 */
export async function aendereOrt(
    tx: Sql,
    row: PlaceRow,
    aenderung: PlaceUpdateBody["changes"],
): Promise<
    { revision: number; changes: Record<string, MapChange>; warnings: OperationReceipt["warnings"] } | undefined
> {
    const publicId = row.public_id;
    const changes: Record<string, MapChange> = {};
    const warnings: OperationReceipt["warnings"] = [];

    // Name und Ortsgröße: ein Wert oder ↺ auf den Wiki-Wert (WI-0225, Modell c: Wert UND Herkunft).
    const nameAenderung = aenderung.name;
    const name = nameAenderung === undefined || typeof nameAenderung === "string" ? nameAenderung : row.s_wiki_name;
    if (name === null)
        throw new ApiError(400, "validation_failed", "Der Ort hat keinen Wiki-Namen.", { field: "name" });
    const groesseAenderung = aenderung.subtype;
    const groesse =
        groesseAenderung === undefined || typeof groesseAenderung === "string"
            ? groesseAenderung
            : wikiOrtsgroesse(row);
    if (groesseAenderung !== undefined && groesse === undefined)
        throw new ApiError(400, "validation_failed", "Der Ort hat keine Ortsgröße laut Wiki.", {
            field: "subtype",
        });

    // Merkmale am Ort.
    const set: Record<string, unknown> = {};
    for (const key of Object.keys(PLACE_COLUMNS) as (keyof typeof PLACE_COLUMNS)[]) {
        const next = key === "name" ? name : key === "subtype" ? groesse : aenderung[key];
        if (next === undefined || next === BEFORE[key](row)) continue;
        set[PLACE_COLUMNS[key]] = next;
        changes[key] = { before: BEFORE[key](row), after: next };
    }
    if (typeof set["name"] === "string") {
        if (await nameTaken(tx, row.map_domain_id, set["name"], row.public_id)) warnings.push(NAME_TAKEN);
        const staetten = await staettenByName(tx, row.name);
        if (staetten > 0)
            warnings.push({
                code: "staetten_by_name",
                message: `${String(staetten)} Stätten hängen noch am alten Namen und bleiben dort, bis sie an der Kennung hängen.`,
            });
    }

    // Einzelheiten. Ein Ort ohne Lage trägt sie selbst, in derselben Zeile (eine Revision).
    const detail = nextDetail(row, aenderung, changes);
    if (detail !== undefined && row.unplaced)
        Object.assign(set, {
            description: detail.description,
            einwohner: detail.einwohner,
            lage: detail.lage,
            oberhaupt: detail.oberhaupt,
        });
    else if (detail !== undefined) await writeDetail(tx, row, detail);

    // Die Herkunft von Name und Ortsgröße (`field_origin`): ↺ wiki, ein Wert manual.
    const herkunftVorher = (await leseHerkunft(tx, "place", [publicId])).get(publicId) ?? {};
    for (const [feld, wahl] of [
        ["name", nameAenderung],
        ["subtype", groesseAenderung],
    ] as const) {
        if (wahl === undefined) continue;
        const vorher = herkunftVorher[feld] ?? null;
        const nachher = typeof wahl === "string" ? "manual" : herkunftDerAenderung(wahl);
        if (vorher === nachher) continue;
        await setzeHerkunft(tx, "place", [publicId], { [feld]: nachher });
        changes[`${feld}Origin`] = { before: vorher, after: nachher };
    }

    if (Object.keys(changes).length === 0) return undefined;
    const revision = await touchPlace(tx, row, set);
    return { revision, changes, warnings };
}

/** Liegt der Punkt in der Domäne? Sonst 400 auf dem genannten Feld. */
async function assertInside(tx: Sql, domain: string, point: { x: number; y: number }, field: string): Promise<void> {
    const [lage] = await tx<{ inside: boolean }[]>`
        SELECT map_domain_contains(${domain}, ST_SetSRID(ST_MakePoint(${point.x}, ${point.y}), 0)) AS inside
    `;
    if (lage?.inside !== true)
        throw new ApiError(400, "validation_failed", "Die Lage liegt außerhalb der Karte.", { field });
}

/** Der Wiki-Eintrag aus „Nicht auf der Karte“ zu einem Key; 400, wenn es ihn nicht gibt oder er schon auf der Karte steht. */
async function unplacedWikiEntry(
    tx: Sql,
    domain: string,
    wikiKey: string,
): Promise<{ wiki_url: string | null; title: string }> {
    const [eintrag] = await tx<{ wiki_url: string | null; title: string; placed: boolean }[]>`
        SELECT r.wiki_url, r.title,
               EXISTS (
                   SELECT 1 FROM wiki_key_assignment a JOIN place p ON p.public_id = a.object_public_id
                    WHERE a.is_active AND a.legacy_art = 'siedlung' AND a.wiki_key = r.wiki_key
                      AND p.is_active AND p.map_domain_id = ${domain}
               ) AS placed
          FROM wiki_settlement_registry r
         WHERE r.wiki_key = ${wikiKey} AND r.is_active
    `;
    if (eintrag === undefined)
        throw new ApiError(400, "validation_failed", "Diesen Wiki-Eintrag gibt es nicht.", { field: "wikiKey" });
    // Betreiber 2026-10-11: „natürlich darf man nur orte auf die karte ziehen, die noch nicht auf der karte sind“.
    if (eintrag.placed)
        throw new ApiError(400, "validation_failed", "Dieser Wiki-Eintrag steht schon auf der Karte.", {
            field: "wikiKey",
        });
    return eintrag;
}

/** `place.create`: ein neuer Ort mit Lage, ohne Lage (E16) oder aus einem Wiki-Eintrag; die Quittung nennt seine Kennung. */
export async function createPlace(
    database: Database,
    actor: MapActor,
    body: PlaceCreateBody,
): Promise<OperationReceipt> {
    const domain = AVENTURIA.mapDomain;
    return mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "place.create", mapDomainId: domain, body },
        async (tx) => {
            const name = body.name.trim();
            if (name === "")
                throw new ApiError(400, "validation_failed", "Ein Ort braucht einen Namen.", { field: "name" });
            const position = body.position;
            if (body.wikiKey !== undefined && position === undefined)
                throw new ApiError(
                    400,
                    "validation_failed",
                    "Ein Wiki-Eintrag ohne Lage steht schon unter „Nicht auf der Karte“.",
                    {
                        field: "position",
                    },
                );
            if (position !== undefined) await assertInside(tx, domain, position, "position");
            const nameWarnings = (await nameTaken(tx, domain, name)) ? [NAME_TAKEN] : [];
            const wiki = body.wikiKey === undefined ? undefined : await unplacedWikiEntry(tx, domain, body.wikiKey);
            const kind = body.kind?.trim() || null;
            /*
             * 🔴 Dieselben Felder wie beim Ändern (Betreiber 2026-10-13). Ein leerer Text ist KEIN Wert: Er kommt als
             * `null` in die Tafel, damit ein versehentlich angefasstes Feld nicht als „ausdrücklich leer“ gespeichert wird
             * und `place_detail` nicht wegen vier leerer Zeichenketten entsteht (0065: aktiv nur mit einem Feld).
             */
            const merkmale = {
                hidden: body.hidden ?? false,
                ruined: body.ruined ?? false,
                seaport: body.seaport ?? false,
                nodix: body.nodix ?? false,
                underground: body.underground ?? false,
                withdrawn: body.withdrawn ?? false,
                approximate: body.approximate ?? false,
            };
            const texte = {
                description: body.description?.trim() || null,
                einwohner: body.einwohner?.trim() || null,
                lage: body.lage?.trim() || null,
                oberhaupt: body.oberhaupt?.trim() || null,
            };
            const publicId = randomUUID();
            const [neu] =
                position === undefined
                    ? await tx<{ revision: number }[]>`
                          INSERT INTO place_unplaced (public_id, map_domain_id, name, subtype, place_kind, is_hidden,
                                                      is_ruined, is_seaport, is_nodix, is_underground, is_withdrawn,
                                                      is_approximate, description, einwohner, lage, oberhaupt, source_system)
                          VALUES (${publicId}::uuid, ${domain}, ${name}, ${body.subtype}, ${kind}, ${merkmale.hidden},
                                  ${merkmale.ruined}, ${merkmale.seaport}, ${merkmale.nodix}, ${merkmale.underground},
                                  ${merkmale.withdrawn}, ${merkmale.approximate}, ${texte.description}, ${texte.einwohner}, ${texte.lage},
                                  ${texte.oberhaupt}, 'avesmaps3d')
                          RETURNING revision::int AS revision
                      `
                    : await tx<{ revision: number }[]>`
                          INSERT INTO place (public_id, map_domain_id, name, subtype, place_kind, geom, is_hidden,
                                             is_ruined, is_seaport, is_nodix, is_underground, is_withdrawn, is_approximate,
                                             source_system)
                          VALUES (${publicId}::uuid, ${domain}, ${name}, ${body.subtype}, ${kind},
                                  ST_SetSRID(ST_MakePoint(${position.x}, ${position.y}), 0), ${merkmale.hidden},
                                  ${merkmale.ruined}, ${merkmale.seaport}, ${merkmale.nodix}, ${merkmale.underground},
                                  ${merkmale.withdrawn}, ${merkmale.approximate}, 'avesmaps3d')
                          RETURNING revision::int AS revision
                      `;
            if (neu === undefined) throw new Error("Ort nicht angelegt");
            /*
             * 🪤 Ein Ort MIT Lage trägt seine Texte in `place_detail`, einer ohne Lage in seiner eigenen Zeile (0105).
             * Die Herkunft ist `manual`: Ein neuer Ort hat keinen Wiki-Stand, von dem ein Wert stammen könnte.
             */
            const hatText = Object.values(texte).some((wert) => wert !== null);
            if (position !== undefined && hatText)
                await tx`
                    INSERT INTO place_detail (place_id, description, einwohner, lage, oberhaupt, einwohner_origin,
                                              lage_origin, oberhaupt_origin, source_system, is_active)
                    SELECT id, ${texte.description}, ${texte.einwohner}, ${texte.lage}, ${texte.oberhaupt},
                           ${texte.einwohner === null ? null : "manual"}, ${texte.lage === null ? null : "manual"},
                           ${texte.oberhaupt === null ? null : "manual"}, 'avesmaps3d', TRUE
                      FROM place WHERE public_id = ${publicId}::uuid
                `;
            const changes: Record<string, MapChange> = {
                name: { before: null, after: name },
                subtype: { before: null, after: body.subtype },
            };
            if (position !== undefined) changes["position"] = { before: null, after: [position.x, position.y] };
            if (kind !== null) changes["kind"] = { before: null, after: kind };
            for (const [feld, an] of Object.entries(merkmale)) if (an) changes[feld] = { before: null, after: true };
            for (const [feld, wert] of Object.entries(texte))
                if (wert !== null) changes[feld] = { before: null, after: wert };
            if (wiki !== undefined && body.wikiKey !== undefined) {
                // Der Namensraum aus dem Präfix des Titels hinter der Adresse (Namensraum-Tafel der Umgebung), nie aus dem Schlüssel geraten.
                const raum = await raumDerAdresseInUmgebung(tx, wiki.wiki_url);
                await tx`
                    INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns, ns_name, source_system)
                    VALUES ('siedlung', ${publicId}::uuid, ${body.wikiKey}, ${wiki.wiki_url}, ${wiki.title}, ${raum.ns}, ${raum.nsName},
                            'avesmaps3d')
                `;
                if (wiki.wiki_url !== null)
                    await tx`
                        INSERT INTO place_wiki_assignment (place_id, wiki_url, assignment_state, assignment_origin, source_system)
                        SELECT id, ${wiki.wiki_url}, 'address_only', 'editor', 'avesmaps3d' FROM place WHERE public_id = ${publicId}::uuid
                    `;
                changes["wiki"] = { before: null, after: body.wikiKey };
            }
            return {
                receipt: {
                    ...emptyReceipt(),
                    affected: [{ kind: "place", id: publicId, revision: neu.revision }],
                    derivedWork: position === undefined ? [] : [{ kind: "routing", state: "pending" }],
                    warnings: nameWarnings,
                },
                summary: position === undefined ? `${name} angelegt, nicht auf der Karte` : `${name} angelegt`,
                entries: [
                    {
                        action: "place.created",
                        placeId: publicId,
                        revisionBefore: null,
                        revisionAfter: neu.revision,
                        changes,
                    },
                ],
            };
        },
    );
}

export async function domainOf(database: Database, publicId: string): Promise<string> {
    const [row] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM place WHERE public_id = ${publicId}::uuid
        UNION ALL
        SELECT map_domain_id FROM place_unplaced WHERE public_id = ${publicId}::uuid AND is_active
        LIMIT 1
    `;
    if (row === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
    return row.map_domain_id;
}

/**
 * Legacy lehnt einen Namen ab, den schon ein aktiver Ort der Domäne trägt (`features.php`, WI-0126 §3). Bei uns ist das ein BEFUND, kein
 * Tor (WI-0126 §2 „Name eindeutig ist bei uns zunächst ein Befund“, Regel 2026-10-03; EDIT-0001 E20 „kein Befund sperrt das
 * Speichern“): Die Quittung warnt `name_taken`, der Ortseditor schlägt „Name (Region)“ vor. Auch Orte ohne Lage zählen (E16); `ausser`
 * ist die Kennung des Orts selbst.
 */
const NAME_TAKEN = { code: "name_taken", message: "Diesen Namen trägt schon ein anderer Ort." } as const;

async function nameTaken(tx: Sql, domain: string, name: string, ausser?: string): Promise<boolean> {
    const anderer = ausser ?? "00000000-0000-0000-0000-000000000000";
    const [taken] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM (
            SELECT public_id, name FROM place WHERE map_domain_id = ${domain} AND is_active
            UNION ALL
            SELECT public_id, name FROM place_unplaced WHERE map_domain_id = ${domain} AND is_active
        ) o
         WHERE o.public_id <> ${anderer}::uuid AND lower(o.name) = lower(${name})
    `;
    return (taken?.n ?? 0) > 0;
}

async function staettenByName(tx: Sql, name: string): Promise<number> {
    const [row] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM settlement_place WHERE is_active AND settlement_key = lower(${name})
    `;
    return row?.n ?? 0;
}

interface DetailValues {
    description: string | null;
    einwohner: string | null;
    lage: string | null;
    oberhaupt: string | null;
    einwohner_origin: "wiki" | "manual" | null;
    lage_origin: "wiki" | "manual" | null;
    oberhaupt_origin: "wiki" | "manual" | null;
}

/** Die Einzelheiten nach der Änderung, oder `undefined`, wenn sich an ihnen nichts ändert. */
function nextDetail(
    row: PlaceRow,
    request: PlaceUpdateBody["changes"],
    changes: Record<string, MapChange>,
): DetailValues | undefined {
    const next: DetailValues = {
        description: ownValue(row, "description"),
        einwohner: ownValue(row, "einwohner"),
        lage: ownValue(row, "lage"),
        oberhaupt: ownValue(row, "oberhaupt"),
        einwohner_origin: ownOrigin(row, "einwohner"),
        lage_origin: ownOrigin(row, "lage"),
        oberhaupt_origin: ownOrigin(row, "oberhaupt"),
    };
    let changed = false;
    for (const field of EDITOR_PLACE_TEXT_FIELDS) {
        const change: EditorPlaceTextChange | undefined = request[field];
        if (change === undefined) continue;
        const value = "revert" in change ? wikiValue(row, field) : change.value;
        const origin = value === null ? null : "revert" in change ? "wiki" : "manual";
        const before = { value: next[field], origin: field === "description" ? null : next[`${field}_origin`] };
        if (before.value === value && (field === "description" || before.origin === origin)) continue;
        next[field] = value;
        if (field !== "description") next[`${field}_origin`] = origin;
        changes[field] = { before: before.value, after: value };
        if (field !== "description" && before.origin !== origin)
            changes[`${field}Origin`] = { before: before.origin, after: origin };
        changed = true;
    }
    return changed ? next : undefined;
}

async function writeDetail(tx: Sql, row: PlaceRow, next: DetailValues): Promise<void> {
    const empty = next.description === null && next.einwohner === null && next.lage === null && next.oberhaupt === null;
    if (row.detail_id === null) {
        if (empty) return;
        await tx`
            INSERT INTO place_detail (place_id, description, einwohner, lage, oberhaupt, einwohner_origin, lage_origin,
                                      oberhaupt_origin, source_system, is_active)
            VALUES (${row.id}::bigint, ${next.description}, ${next.einwohner}, ${next.lage}, ${next.oberhaupt},
                    ${next.einwohner_origin}, ${next.lage_origin}, ${next.oberhaupt_origin}, 'avesmaps3d', TRUE)
        `;
        return;
    }
    // Ein Satz ohne ein einziges Feld wird still gelegt (0065: aktiv nur mit einem Feld), ein stillgelegter mit Wert wieder aktiv.
    await tx`
        UPDATE place_detail SET
            description = ${next.description}, einwohner = ${next.einwohner}, lage = ${next.lage}, oberhaupt = ${next.oberhaupt},
            einwohner_origin = ${next.einwohner_origin}, lage_origin = ${next.lage_origin}, oberhaupt_origin = ${next.oberhaupt_origin},
            is_active = ${!empty},
            retired_at = ${empty ? new Date() : null},
            retired_origin = ${empty ? "editor" : null},
            updated_at = now()
        WHERE id = ${row.detail_id}::bigint
    `;
}

/** `place.move` (EDIT-0001 §4.4): der Ort an seine neue Lage und die genannten Wegenden mit, eine Operation. */
export async function movePlace(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PlaceMoveBody,
): Promise<OperationReceipt> {
    const domain = await domainOf(database, publicId);
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "place.move",
            mapDomainId: domain,
            body: { publicId, ...body },
            ...(body.reverts !== undefined ? { source: "restore" as const } : {}),
        },
        async (tx) => {
            await pruefeFremdeOrtssperre(tx, actor, [publicId]);
            const row = await lockedPlace(tx, publicId, body.baseRevision);
            if (row.unplaced) return placeUnplaced(tx, row, body);
            return verschiebeOrtIn(tx, row, body);
        },
    );
}

/**
 * Der Ort an seine neue Lage und die genannten Wegenden mit, in der Transaktion einer Operation (`place.move`, und die Rücknahme einer Verschiebung, `ruecknahme-ort.ts`). `enden`:
 * die Wegenden, die als „am Ort hängend“ gelten; ohne Angabe die, die heute am Ort liegen (`pathEndsAt`). Die Rücknahme nennt sie ausdrücklich, weil ein Ende an einem Einrastpunkt
 * hängen kann, der nicht der Ort ist.
 */
export async function verschiebeOrtIn(
    tx: Sql,
    row: PlaceRow,
    body: Pick<PlaceMoveBody, "baseRevision" | "reverts" | "to" | "pathEnds">,
    enden?: readonly EditorPathEnd[],
): Promise<{
    receipt: Pick<OperationReceipt, "affected" | "derivedWork" | "warnings">;
    summary: string;
    entries: MapAuditEntry[];
}> {
    const publicId = row.public_id;
    const ends = enden ?? (await pathEndsAt(tx, row));
    const key = (pathId: string, end: string): string => `${pathId}:${end}`;
    const atPlace = new Map(ends.map((end) => [key(end.pathId, end.end), end]));

    // Je Weg alle genannten Enden zusammen: Ein Weg, der mit beiden Enden am Ort hängt, ändert sich einmal.
    const byPath = new Map<string, PlaceMoveBody["pathEnds"]>();
    for (const end of body.pathEnds) {
        if (!atPlace.has(key(end.pathId, end.end)))
            throw new ApiError(400, "validation_failed", "Dieses Wegende hängt nicht am Ort.", {
                pathId: end.pathId,
                end: end.end,
            });
        byPath.set(end.pathId, [...(byPath.get(end.pathId) ?? []), end]);
    }

    const [lage] = await tx<{ inside: boolean }[]>`
                SELECT map_domain_contains(${row.map_domain_id}, ST_SetSRID(ST_MakePoint(${body.to.x}, ${body.to.y}), 0)) AS inside
            `;
    if (lage?.inside !== true)
        throw new ApiError(400, "validation_failed", "Die neue Lage liegt außerhalb der Karte.", {
            field: "to",
        });
    // Die Wegenden gehen ohne Umweg in `path.geom`, und an `path` prüft kein CHECK die Domäne: Sie halten dieselbe Grenze wie
    // jeder Stützpunkt der Wegkurve (`path-edit.ts`, Befund der Koordination zu ajv: Ein `null` würde dort still zur 0).
    if (body.pathEnds.length > 0) {
        const [draussen] = await tx<{ i: number }[]>`
                    SELECT t.i::int AS i
                      FROM unnest(${body.pathEnds.map((end) => end.to.x)}::float8[], ${body.pathEnds.map((end) => end.to.y)}::float8[])
                           WITH ORDINALITY AS t(x, y, i)
                     WHERE map_domain_contains(${row.map_domain_id}, ST_SetSRID(ST_MakePoint(t.x, t.y), 0)) IS NOT TRUE
                     ORDER BY t.i
                     LIMIT 1
                `;
        const ende = draussen === undefined ? undefined : body.pathEnds[draussen.i - 1];
        if (ende !== undefined)
            throw new ApiError(400, "validation_failed", "Ein Wegende liegt außerhalb der Karte.", {
                field: "pathEnds",
                pathId: ende.pathId,
                end: ende.end,
            });
    }
    // EIN Update: Lage und Revision zusammen, damit sie genau einmal zählt.
    const [verschoben] = await tx<{ revision: number }[]>`
                UPDATE place SET geom = ST_SetSRID(ST_MakePoint(${body.to.x}, ${body.to.y}), 0), revision = revision
                 WHERE id = ${row.id}::bigint AND revision = ${row.revision}
                RETURNING revision::int AS revision
            `;
    if (verschoben === undefined) throw new Error("Ort zwischen Sperre und Änderung verändert");
    const revision = verschoben.revision;

    const entries: MapAuditEntry[] = [
        {
            action: "place.moved",
            placeId: publicId,
            revisionBefore: row.revision,
            revisionAfter: revision,
            changes: { position: { before: [row.x!, row.y!], after: [body.to.x, body.to.y] } },
        },
    ];
    const affected: OperationReceipt["affected"] = [{ kind: "place", id: publicId, revision }];
    const pathIds: number[] = [];
    // Ein Fluss, dessen Ende mit dem Ort zieht, nimmt die eigene Höhe an diesem Stützpunkt mit (WI-0259, „Höhe wandert mit“).
    const flusswege = new Set(
        (
            await tx<{ id: string }[]>`
                        SELECT public_id::text AS id FROM path
                         WHERE public_id = ANY(${[...byPath.keys()]}::uuid[]) AND subtype = 'Flussweg'
                    `
        ).map((weg) => weg.id),
    );
    const gewandert: FlussPunktVerschoben[] = [];
    let flussEintrag: MapAuditEntry | undefined;
    for (const [pathId, pathEnds] of byPath) {
        const current = atPlace.get(key(pathId, pathEnds[0]!.end))!;
        const base = pathEnds[0]!.baseRevision;
        if (pathEnds.some((end) => end.baseRevision !== base) || current.revision !== base) {
            const [now] = await tx<
                { updated_at: Date }[]
            >`SELECT updated_at FROM path WHERE public_id = ${pathId}::uuid`;
            throw await mapEditConflict(
                tx,
                { kind: "path", publicId: pathId },
                { revision: current.revision, changedAt: now?.updated_at ?? new Date() },
            );
        }
        let geometry = "geom";
        const parameters: unknown[] = [pathId, base];
        for (const end of pathEnds) {
            parameters.push(end.to.x, end.to.y);
            const x = `$${String(parameters.length - 1)}`;
            const y = `$${String(parameters.length)}`;
            geometry = `ST_SetPoint(${geometry}, ${end.end === "start" ? "0" : "-1"}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0))`;
        }
        const [path] = await tx.unsafe<{ id: string; revision: number }[]>(
            `UPDATE path SET geom = ${geometry} WHERE public_id = $1::uuid AND revision = $2
                     RETURNING id::text, revision::int AS revision`,
            parameters as never[],
        );
        if (path === undefined) throw new Error("Weg zwischen Lesen und Ändern verändert");
        pathIds.push(Number(path.id));
        affected.push({ kind: "path", id: pathId, revision: path.revision });
        const eintrag: MapAuditEntry = {
            action: "path.endpoint_moved",
            pathId,
            revisionBefore: base,
            revisionAfter: path.revision,
            changes: {
                geometry: {
                    before: pathEnds.map((end) => {
                        const was = atPlace.get(key(pathId, end.end))!;
                        return { end: end.end, x: was.x, y: was.y };
                    }),
                    after: pathEnds.map((end) => ({ end: end.end, x: end.to.x, y: end.to.y })),
                },
            },
        };
        entries.push(eintrag);
        if (flusswege.has(pathId)) {
            flussEintrag ??= eintrag;
            for (const end of pathEnds) {
                const was = atPlace.get(key(pathId, end.end))!;
                gewandert.push({ von: { x: was.x, y: was.y }, nach: end.to });
            }
        }
    }
    await derivePathVisualsFor(tx, pathIds);
    // Die Flusshöhen folgen den Enden, NACH allen Geometrien dieser Transaktion (hängt noch ein Fluss am alten Ende, bleibt sie dort).
    if (gewandert.length > 0) {
        const hoehen = await fuehreFlussHoehenNach(tx, row.map_domain_id, gewandert);
        if (hoehen.umzuege.length > 0 && flussEintrag?.changes !== undefined)
            flussEintrag.changes["wasserHoehen"] = wasserHoehenProtokoll(hoehen.umzuege);
        for (const g of hoehen.affected) affected.push(g);
    }
    // Die Kraftlinien, die an diesem Ort enden, zeichnen ihre Bahn neu (WI-0205 K5); ihre Revision bleibt (drawn_geom zählt nicht).
    const kraftlinien = await zieheKraftlinienNach(tx, { knoten: [publicId] });

    const left = ends.filter((end) => !body.pathEnds.some((m) => m.pathId === end.pathId && m.end === end.end));
    const warnings: OperationReceipt["warnings"] =
        left.length === 0
            ? []
            : [
                  {
                      code: "path_end_left",
                      message: `${String(left.length)} Wegenden blieben an der alten Lage liegen.`,
                  },
              ];
    return {
        receipt: {
            affected,
            derivedWork: [
                ...(pathIds.length > 0 ? [{ kind: "path_visual", state: "done" }] : []),
                ...(kraftlinien > 0 ? [{ kind: "powerline_path", state: "done" }] : []),
                { kind: "routing", state: "pending" },
            ],
            warnings,
        },
        summary: `${row.name} ${body.reverts !== undefined ? "zurück an die frühere Lage" : "verschoben"}${pathIds.length > 0 ? `, ${String(body.pathEnds.length)} Wegenden mit` : ""}`,
        entries,
    };
}

/**
 * Einen Ort ohne Lage auf die Karte setzen (E16, `place.move` an einem Ort aus `place_unplaced`): ein `place` mit derselben
 * `public_id` und der nächsten Revision, die Texte als eigene Werte, die Zeile ohne Lage stillgelegt (`placed`). Wegenden hat er
 * keine, also nimmt er keine mit. Auch die Rücknahme von „Von der Karte nehmen“ (`ruecknahme-ort.ts`, WI-0265 B8a) setzt ihn so zurück.
 */
export async function placeUnplaced(
    tx: Sql,
    row: PlaceRow,
    body: Pick<PlaceMoveBody, "to" | "pathEnds">,
): Promise<{
    receipt: Pick<OperationReceipt, "affected" | "derivedWork" | "warnings">;
    summary: string;
    entries: MapAuditEntry[];
}> {
    if (body.pathEnds.length > 0)
        throw new ApiError(400, "validation_failed", "Ein Ort ohne Lage hat keine Wegenden.", { field: "pathEnds" });
    await assertInside(tx, row.map_domain_id, body.to, "to");
    // War er schon einmal auf der Karte (von ihr genommen, `takePlaceOffMap`), kommt DIESELBE Zeile zurück: mit ihr Wiki-Zuordnung,
    // Bilder und Einzelheiten. `place.public_id` ist eindeutig, auch über stillgelegte Zeilen.
    const [frueher] = await tx<{ id: string; detail_id: string | null }[]>`
        SELECT p.id::text, d.id::text AS detail_id
          FROM place p LEFT JOIN place_detail d ON d.place_id = p.id
         WHERE p.public_id = ${row.public_id}::uuid AND NOT p.is_active
         FOR UPDATE OF p
    `;
    const text = { description: row.description, einwohner: row.einwohner, lage: row.lage, oberhaupt: row.oberhaupt };
    // Die nächste Revision über beiden Zeilen: Die stillgelegte in `place` kann vor oder hinter dieser liegen.
    const revision = await nextObjectRevision(tx, row.public_id);
    const retire = async (): Promise<void> => {
        await tx`
            UPDATE place_unplaced SET is_active = FALSE, retired_at = now(), retired_origin = 'placed', revision = ${revision}
             WHERE id = ${row.id}::bigint
        `;
    };
    if (frueher !== undefined) {
        const [zurueck] = await tx<{ revision: number }[]>`
            UPDATE place SET is_active = TRUE, geom = ST_SetSRID(ST_MakePoint(${body.to.x}, ${body.to.y}), 0), name = ${row.name},
                   subtype = ${row.subtype}, place_kind = ${row.place_kind}, is_hidden = ${row.is_hidden}, is_ruined = ${row.is_ruined},
                   is_nodix = ${row.is_nodix}, is_seaport = ${row.is_seaport}, is_underground = ${row.is_underground},
                   is_withdrawn = ${row.is_withdrawn}, is_approximate = ${row.is_approximate}, revision = ${revision}
             WHERE id = ${frueher.id}::bigint
            RETURNING revision::int AS revision
        `;
        if (frueher.detail_id !== null)
            // Nur was sich ohne Lage geändert hat, wird ein eigener Wert; der Rest (samt Herkunft Wiki) bleibt, wie er war.
            await tx`
                UPDATE place_detail d SET
                       description = ${text.description},
                       einwohner = ${text.einwohner},
                       einwohner_origin = CASE WHEN d.einwohner IS DISTINCT FROM ${text.einwohner} THEN 'manual' ELSE d.einwohner_origin END,
                       lage = ${text.lage},
                       lage_origin = CASE WHEN d.lage IS DISTINCT FROM ${text.lage} THEN 'manual' ELSE d.lage_origin END,
                       oberhaupt = ${text.oberhaupt},
                       oberhaupt_origin = CASE WHEN d.oberhaupt IS DISTINCT FROM ${text.oberhaupt} THEN 'manual' ELSE d.oberhaupt_origin END
                 WHERE d.id = ${frueher.detail_id}::bigint
                   AND (d.description, d.einwohner, d.lage, d.oberhaupt)
                       IS DISTINCT FROM (${text.description}, ${text.einwohner}, ${text.lage}, ${text.oberhaupt})
            `;
        else if (Object.values(text).some((value) => value !== null))
            await tx`
                INSERT INTO place_detail (place_id, description, einwohner, lage, oberhaupt, einwohner_origin, lage_origin,
                                          oberhaupt_origin, source_system, is_active)
                VALUES (${frueher.id}::bigint, ${text.description}, ${text.einwohner}, ${text.lage}, ${text.oberhaupt},
                        ${row.einwohner_origin}, ${row.lage_origin}, ${row.oberhaupt_origin}, 'avesmaps3d', TRUE)
            `;
        await retire();
        return placedReceipt(row, body, zurueck!.revision);
    }
    await tx`
        INSERT INTO place (public_id, map_domain_id, name, subtype, place_kind, geom, is_hidden, is_ruined, is_nodix, is_seaport,
                           is_underground, is_withdrawn, is_approximate, source_system, revision)
        VALUES (${row.public_id}::uuid, ${row.map_domain_id}, ${row.name}, ${row.subtype}, ${row.place_kind},
                ST_SetSRID(ST_MakePoint(${body.to.x}, ${body.to.y}), 0), ${row.is_hidden}, ${row.is_ruined}, ${row.is_nodix},
                ${row.is_seaport}, ${row.is_underground}, ${row.is_withdrawn}, ${row.is_approximate}, ${row.source_system},
                ${revision})
    `;
    if (Object.values(text).some((value) => value !== null))
        await tx`
            INSERT INTO place_detail (place_id, description, einwohner, lage, oberhaupt, einwohner_origin, lage_origin,
                                      oberhaupt_origin, source_system, is_active)
            SELECT id, ${text.description}, ${text.einwohner}, ${text.lage}, ${text.oberhaupt},
                   ${row.einwohner_origin}, ${row.lage_origin}, ${row.oberhaupt_origin}, 'avesmaps3d', TRUE
              FROM place WHERE public_id = ${row.public_id}::uuid
        `;
    await retire();
    return placedReceipt(row, body, revision);
}

function placedReceipt(
    row: PlaceRow,
    body: Pick<PlaceMoveBody, "to">,
    revision: number,
): {
    receipt: Pick<OperationReceipt, "affected" | "derivedWork" | "warnings">;
    summary: string;
    entries: MapAuditEntry[];
} {
    return {
        receipt: {
            affected: [{ kind: "place", id: row.public_id, revision }],
            derivedWork: [{ kind: "routing", state: "pending" }],
            warnings: [],
        },
        summary: `${row.name} auf die Karte gesetzt`,
        entries: [
            {
                action: "place.placed",
                placeId: row.public_id,
                revisionBefore: row.revision,
                revisionAfter: revision,
                changes: { position: { before: null, after: [body.to.x, body.to.y] } },
            },
        ],
    };
}

/**
 * `place.take_off_map` (EDIT-0001 D20; Betreiber 2026-10-11: „hier fehlt "von der karte entfernen"“): das Gegenstück zum Setzen. Der
 * Ort wird in `place` stillgelegt und steht mit DERSELBEN `public_id` als Ort ohne Lage da (`place_unplaced`, 0105), mit seinen
 * Merkmalen und seinen Texten als eigene Werte; Wiki-Zuordnung, Bilder und Einzelheiten bleiben an der stillgelegten Zeile und kommen
 * beim Setzen zurück (`placeUnplaced`). Wegenden am Ort bleiben liegen (G1, „offenes Wegende“). Routing und Kacheln folgen wie nach
 * dem Setzen.
 *
 * Was das Entfernen sperrt, prüft `pruefeEntfernen` (`place-removal-regeln.ts`, E22): eine Kraftlinie am Ort; Stätten nur mit
 * `staetten: "bleiben"` (sie hängen an seinem Namen, der bleibt); ein innerorts-Punkt erst mit E18.
 */
export async function takePlaceOffMap(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PlaceTakeOffMapBody,
): Promise<OperationReceipt> {
    const domain = await domainOf(database, publicId);
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "place.take_off_map",
            mapDomainId: domain,
            body: { publicId, ...body },
        },
        async (tx) => {
            await pruefeFremdeOrtssperre(tx, actor, [publicId]);
            const row = await lockedPlace(tx, publicId, body.baseRevision);
            return nimmOrtVonDerKarteIn(tx, row, body.staetten);
        },
    );
}

/**
 * „Von der Karte nehmen“ an EINEM gesperrten Ort in einer laufenden Transaktion (`place.take_off_map`, und die Rücknahme des Setzens auf die Karte, `ruecknahme-ort.ts`, WI-0265 B8a):
 * dieselben Prüfungen (`pruefeEntfernen`) und derselbe Schreibweg, damit die Rücknahme dieselben Folgen hat wie das Menü.
 */
export async function nimmOrtVonDerKarteIn(
    tx: Sql,
    row: PlaceRow,
    staetten: PlaceTakeOffMapBody["staetten"],
): Promise<{
    receipt: Pick<OperationReceipt, "affected" | "derivedWork" | "warnings">;
    summary: string;
    entries: MapAuditEntry[];
}> {
    if (row.unplaced || !row.is_active)
        throw new ApiError(400, "validation_failed", "Dieser Ort steht schon nicht auf der Karte.");
    await pruefeEntfernen(tx, row, "abnehmen", staetten);
    // Die nächste Revision über beiden Zeilen: Eine Zeile ohne Lage von früher kann vor oder hinter dieser liegen.
    const revision = await nextObjectRevision(tx, row.public_id);
    await tx`UPDATE place SET is_active = FALSE, revision = ${revision} WHERE id = ${row.id}::bigint`;
    const text =
        row.detail_id !== null && row.detail_active === true
            ? {
                  description: row.description,
                  einwohner: row.einwohner,
                  lage: row.lage,
                  oberhaupt: row.oberhaupt,
              }
            : { description: null, einwohner: null, lage: null, oberhaupt: null };
    // Ein Ort, der schon einmal ohne Lage stand, hat dort eine stillgelegte Zeile (`public_id` ist eindeutig): Sie kommt zurück.
    const [frueher] = await tx<{ revision: number }[]>`
                UPDATE place_unplaced SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, map_domain_id = ${row.map_domain_id},
                       name = ${row.name}, subtype = ${row.subtype}, place_kind = ${row.place_kind}, is_hidden = ${row.is_hidden},
                       is_ruined = ${row.is_ruined}, is_nodix = ${row.is_nodix}, is_seaport = ${row.is_seaport},
                       is_underground = ${row.is_underground}, is_withdrawn = ${row.is_withdrawn},
                       is_approximate = ${row.is_approximate},
                       description = ${text.description}, einwohner = ${text.einwohner}, lage = ${text.lage},
                       oberhaupt = ${text.oberhaupt}, revision = ${revision}
                 WHERE public_id = ${row.public_id}::uuid
                RETURNING revision::int AS revision
            `;
    if (frueher === undefined)
        await tx`
                    INSERT INTO place_unplaced (public_id, map_domain_id, name, subtype, place_kind, is_hidden, is_ruined, is_nodix,
                                                is_seaport, is_underground, is_withdrawn, is_approximate, description, einwohner,
                                                lage, oberhaupt, revision, source_system)
                    VALUES (${row.public_id}::uuid, ${row.map_domain_id}, ${row.name}, ${row.subtype}, ${row.place_kind},
                            ${row.is_hidden}, ${row.is_ruined}, ${row.is_nodix}, ${row.is_seaport}, ${row.is_underground},
                            ${row.is_withdrawn}, ${row.is_approximate}, ${text.description}, ${text.einwohner}, ${text.lage},
                            ${text.oberhaupt}, ${revision}, ${row.source_system})
                `;
    // Es gilt, was die Zeile trägt (der Trigger hat das letzte Wort).
    const after = frueher?.revision ?? revision;
    return {
        receipt: {
            affected: [{ kind: "place", id: row.public_id, revision: after }],
            derivedWork: [{ kind: "routing", state: "pending" }],
            warnings: [],
        },
        summary: `${row.name} von der Karte genommen`,
        entries: [
            {
                action: "place.taken_off_map",
                placeId: row.public_id,
                revisionBefore: row.revision,
                revisionAfter: after,
                changes: { position: { before: [row.x, row.y], after: null } },
            },
        ],
    };
}
