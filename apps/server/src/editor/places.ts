import { createHash } from "node:crypto";
import {
    EDITOR_PLACE_ASSIGNMENTS,
    EDITOR_STAETTE_KEY_PREFIX,
    editorPlaceCircle,
    mediaPublicUrl,
    type EditorPlaceAssignment,
    type EditorPlaceList,
    type EditorPlaceRow,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { PUBLISHED_VARIANT } from "../media/roles.ts";
import { lageJeArtikel, type LageJeArtikel } from "./place-scope.ts";
import { listWikiSettlementRows } from "./wiki-settlement-rows.ts";

/**
 * Die Ortsliste des Ortseditors (WI-0128 E4, EDIT-0001 §4.2; Vertrag `packages/shared/src/editor-places.ts`).
 *
 * Eine Abfrage für alle aktiven Orte der Domäne, mit Wiki-Zuordnung (`place_wiki_assignment` → `wiki_settlement_snapshot`, wie
 * `subjects/detail-place.ts`) und den Bindungen der Medienverwaltung (Wappen, Zahl der Titelbilder). 🔴 Verborgene Orte stehen
 * darin (ein Editor muss sie finden), markiert mit `hidden`; die Suche der Besucher blendet sie weiter aus.
 *
 * Die Medien zählen hier wie für Editoren, nicht wie für Besucher: Eine Bindung, die noch auf die Rechteprüfung wartet, ist da. Das
 * Wappen kommt als Adresse seiner veröffentlichten Fassung mit (E19, Gesamtmockup: Wappen links in der Zeile), wie die Plätze der
 * Medienverwaltung es dem Ortseditor zeigen (`media-editor/slots.ts`); ohne gerenderte Fassung bleibt nur `hasCoat`.
 *
 * Dazu „Fehlt“ (WI-0126 §4.1, Blatt Fassung 3), 🔴 **wie Legacys eigene Liste** (`avesmapsWikiSettlementListLocations`, Mirror
 * `3de58d4df`, `api/_internal/wiki/settlements.php:1488-1630`): Die Zeilen ohne Kartenpunkt kommen NUR aus Legacys Registry
 * (`wiki_settlement_registry`, Export X3, 0089), je Wiki-Artikel eine, über den Wiki-Key gegen die Zuordnung X2
 * (`wiki-settlement-rows.ts`). Legacys Stätten (`in_settlement_places`, `settlement_place`) stehen dort nicht; sie gehören in den
 * Reiter „Innerorts“ ihrer Siedlung (E18). Betreiber 2026-10-10 auf den Befund der Koordination: 7.686 statt Legacys 3.523, weil 2.684
 * Wiki-Adressen als Stätte UND als Zeile der Registry standen. Gemessen danach 3.596 (der Rest ist die gewollte Abweichung „Wiki-Keys
 * statt Namen“, Befund `registry_nur_per_name_platziert`).
 *
 * „innerorts: Khunchom“ (`scope`, `within`) rechnet Legacy beim Lesen aus dem Feld `standort` der Registry (`place-scope.php`); hier
 * dieselbe Regel über Wiki-Keys (`place-scope.ts`, Betreiber 2026-10-11), einmal je Liste, für Bauwerke der Registry und der Karte
 * (über ihren Key in X2). Ohne Urteil gilt außerorts, Legacys sichere Seite: Die Zeile bleibt sichtbar. Ohne Registry (vor dem ersten Zug mit X3) stehen die Stätten ohne Kartenpunkt als Übergang in „Fehlt“, und die
 * Oberfläche sagt, dass die Wiki-Liste fehlt.
 */

interface PlaceListRow {
    public_id: string;
    name: string;
    subtype: string | null;
    place_kind: string | null;
    building_type: string | null;
    is_hidden: boolean;
    is_ruined: boolean;
    is_nodix: boolean;
    source_system: string | null;
    x: number;
    y: number;
    assignment_state: string | null;
    wiki_url: string | null;
    wiki_title: string | null;
    region_text: string | null;
    staat_text: string | null;
    has_coat: boolean;
    coat_sha256: string | null;
    image_count: number;
    /** Der Key des Orts in Legacys Zuordnung X2 (Art `siedlung`), für Legacys Urteil innerorts. */
    wiki_key: string | null;
}

const ASSIGNMENTS: ReadonlySet<string> = new Set(EDITOR_PLACE_ASSIGNMENTS);
const assignmentOf = (state: string | null): EditorPlaceAssignment =>
    state !== null && ASSIGNMENTS.has(state) ? (state as EditorPlaceAssignment) : "none";

/** Die Lage aus dem Wiki, wie Legacy sie als Facette liest: Region, sonst Staat. */
const regionOf = (region: string | null, staat: string | null): string | undefined =>
    region?.trim() || staat?.trim() || undefined;

/** Eine Zeile ohne leere Felder (Vertrag: was falsch, null oder leer ist, fehlt). */
function rowOf(row: PlaceListRow, lage: LageJeArtikel): EditorPlaceRow {
    const assignment = assignmentOf(row.assignment_state);
    // Nur ein Bauwerk liegt innerorts; eine Stadt liegt nicht in einer Stadt (das Urteil kennt nur Bauwerke der Registry).
    const urteil = row.wiki_key !== null ? lage.get(row.wiki_key) : undefined;
    const kind = row.place_kind ?? row.building_type;
    const region = regionOf(row.region_text, row.staat_text);
    return {
        key: row.public_id,
        origin: "karte",
        name: row.name,
        circle: editorPlaceCircle(true, assignment),
        assignment,
        ...(row.subtype ? { subtype: row.subtype } : {}),
        ...(kind ? { kind } : {}),
        ...(row.wiki_url ? { wiki: { url: row.wiki_url, ...(row.wiki_title ? { title: row.wiki_title } : {}) } } : {}),
        ...(region ? { region } : {}),
        ...(urteil ? { within: urteil.siedlung, scope: urteil.lage } : {}),
        x: row.x,
        y: row.y,
        ...(row.is_hidden ? { hidden: true as const } : {}),
        ...(row.is_ruined ? { ruined: true as const } : {}),
        ...(row.is_nodix ? { nodix: true as const } : {}),
        ...(row.has_coat ? { hasCoat: true as const } : {}),
        ...(row.coat_sha256 !== null ? { coat: mediaPublicUrl(row.coat_sha256) } : {}),
        ...(row.image_count > 0 ? { imageCount: row.image_count } : {}),
        ...(row.source_system && row.source_system !== "legacy" ? { source: row.source_system } : {}),
    };
}

export async function listEditorPlaces(database: Queryable, mapDomainId = "aventuria"): Promise<EditorPlaceList> {
    const rows = await database<PlaceListRow[]>`
        SELECT p.public_id::text AS public_id, p.name, p.subtype, p.place_kind, s.building_type,
               p.is_hidden, p.is_ruined, p.is_nodix, p.source_system,
               ST_X(p.geom) AS x, ST_Y(p.geom) AS y,
               -- Ein Wiki-Eintrag, den ein Editor platziert hat (E16), trägt nur die Adresse; er gilt als zugeordnet, solange das
               -- Wiki-Verzeichnis den Artikel kennt, und zeigt dessen Titel.
               CASE WHEN a.assignment_state = 'address_only' AND r.wiki_key IS NOT NULL THEN 'assigned' ELSE a.assignment_state END
                   AS assignment_state,
               a.wiki_url, coalesce(s.wiki_title, r.title) AS wiki_title, s.region_text, s.staat_text,
               EXISTS (
                   SELECT 1 FROM place_media m WHERE m.place_id = p.id AND m.role = 'coat' AND m.retired_at IS NULL
               ) AS has_coat,
               c.sha256 AS coat_sha256,
               (
                   SELECT count(DISTINCT x.media_asset_id)::int FROM (
                       SELECT m.media_asset_id FROM place_media m
                        WHERE m.place_id = p.id AND m.role = 'header' AND m.retired_at IS NULL
                       UNION ALL
                       SELECT i.media_asset_id FROM place_media_gallery g
                         JOIN media_gallery_item i ON i.gallery_id = g.media_gallery_id AND i.retired_at IS NULL
                        WHERE g.place_id = p.id AND g.role = 'header' AND g.retired_at IS NULL
                   ) x
               ) AS image_count,
               (
                   SELECT min(k.wiki_key) FROM wiki_key_assignment k
                    WHERE k.is_active AND k.legacy_art = 'siedlung' AND k.object_public_id = p.public_id
               ) AS wiki_key
          FROM place p
          LEFT JOIN place_wiki_assignment a ON a.place_id = p.id AND a.is_active
          LEFT JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id AND s.is_active
          LEFT JOIN wiki_settlement_registry r
                 ON a.assignment_origin = 'editor' AND r.is_active AND r.wiki_url = a.wiki_url
          LEFT JOIN LATERAL (
              SELECT f.sha256 FROM place_media m
                JOIN media_file f ON f.media_asset_id = m.media_asset_id
                                 AND f.storage_class = 'published' AND f.variant = ${PUBLISHED_VARIANT.coat}
               WHERE m.place_id = p.id AND m.role = 'coat' AND m.retired_at IS NULL
               ORDER BY f.created_at DESC, f.id DESC
               LIMIT 1
          ) c ON TRUE
         WHERE p.is_active AND p.map_domain_id = ${mapDomainId}
         ORDER BY lower(p.name), p.public_id
    `;
    // Die Orte ohne Lage (E16): „Nicht auf der Karte“ wie die Wiki-Einträge, mit ihrer eigenen Kennung. Ein von der Karte genommener Ort
    // (`place.take_off_map`) behält seine Wiki-Zuordnung an der stillgelegten Zeile in `place`; die Liste zeigt sie.
    const ohneLage = await database<UnplacedListRow[]>`
        SELECT u.public_id::text AS public_id, u.name, u.subtype, u.place_kind, u.is_hidden, u.is_ruined, u.source_system,
               a.assignment_state, a.wiki_url, s.wiki_title
          FROM place_unplaced u
          LEFT JOIN place p ON p.public_id = u.public_id AND NOT p.is_active
          LEFT JOIN place_wiki_assignment a ON a.place_id = p.id AND a.is_active
          LEFT JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id AND s.is_active
         WHERE u.is_active AND u.map_domain_id = ${mapDomainId}
         ORDER BY lower(u.name), u.public_id
    `;
    // Die Stätten ohne Kartenpunkt („Fehlt“ wie in Legacy). Ein innerorts-Punkt, der auf einem aktiven Ort steht, ist schon eine Zeile
    // der Karte; er kommt nicht doppelt.
    const staetten = await database<StaetteListRow[]>`
        SELECT s.settlement_key, s.settlement_name, s.name, s.place_type, s.wiki_url, s.legacy_public_id::text AS legacy_public_id
          FROM settlement_place s
         WHERE s.is_active AND s.state = 'active'
           AND NOT EXISTS (
               SELECT 1 FROM place j
                WHERE s.on_map AND j.public_id = s.legacy_public_id AND j.is_active AND j.map_domain_id = ${mapDomainId}
           )
         ORDER BY lower(s.name), s.settlement_key, s.legacy_public_id NULLS FIRST
    `;
    const lage = await lageJeArtikel(database, mapDomainId);
    const wiki = await listWikiSettlementRows(database, mapDomainId, lage);
    const orte = [...rows.map((row) => rowOf(row, lage)), ...ohneLage.map(unplacedOf)];
    // Vollständig ist „Fehlt“ erst, wenn die Wiki-Siedlungsregistry (X3) einmal gezogen ist; bis dahin stehen die Stätten dort.
    if (!wiki.imported) return { wikiListe: false, rows: [...orte, ...staetten.map(staetteOf)] };
    return { wikiListe: true, rows: [...orte, ...wiki.rows] };
}

interface UnplacedListRow {
    public_id: string;
    name: string;
    subtype: string;
    place_kind: string | null;
    is_hidden: boolean;
    is_ruined: boolean;
    source_system: string;
    /** Die Wiki-Zuordnung eines von der Karte genommenen Orts (an seiner stillgelegten Zeile); sonst `null`. */
    assignment_state: string | null;
    wiki_url: string | null;
    wiki_title: string | null;
}

/** Ein Ort ohne Lage (E16): ○ nicht auf der Karte; ein von der Karte genommener mit seinem Wiki-Artikel. */
function unplacedOf(row: UnplacedListRow): EditorPlaceRow {
    const assignment = assignmentOf(row.assignment_state);
    return {
        key: row.public_id,
        origin: "ohne-lage",
        name: row.name,
        circle: editorPlaceCircle(false, assignment),
        assignment,
        ...(row.wiki_url ? { wiki: { url: row.wiki_url, ...(row.wiki_title ? { title: row.wiki_title } : {}) } } : {}),
        subtype: row.subtype,
        ...(row.place_kind ? { kind: row.place_kind } : {}),
        ...(row.is_hidden ? { hidden: true as const } : {}),
        ...(row.is_ruined ? { ruined: true as const } : {}),
        ...(row.source_system !== "legacy" ? { source: row.source_system } : {}),
    };
}

interface StaetteListRow {
    settlement_key: string;
    settlement_name: string;
    name: string;
    place_type: string | null;
    wiki_url: string | null;
    legacy_public_id: string | null;
}

/**
 * Der Schlüssel einer Stätte aus ihrer Identität (0078: Siedlung, Name, Punkt, `NULLS NOT DISTINCT`). Er ist öffentlich und bleibt
 * über jeden Import gleich, solange die Stätte dieselbe ist; die interne `id` erscheint nie.
 */
export function staetteKey(row: Pick<StaetteListRow, "settlement_key" | "name" | "legacy_public_id">): string {
    const identity = [row.settlement_key, row.name, row.legacy_public_id ?? ""].join("\u0000");
    return `${EDITOR_STAETTE_KEY_PREFIX}${createHash("sha256").update(identity).digest("base64url").slice(0, 16)}`;
}

function staetteOf(row: StaetteListRow): EditorPlaceRow {
    return {
        key: staetteKey(row),
        origin: "wiki",
        name: row.name,
        circle: editorPlaceCircle(false, "none"),
        assignment: "none",
        ...(row.place_type ? { kind: row.place_type } : {}),
        ...(row.wiki_url ? { wiki: { url: row.wiki_url } } : {}),
        within: row.settlement_name,
    };
}
