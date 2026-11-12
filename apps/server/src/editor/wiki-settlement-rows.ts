import { editorPlaceCircle, type EditorPlaceRow } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import type { LageJeArtikel } from "./place-scope.ts";

/**
 * Die Wiki-Siedlungen OHNE Kartenpunkt als Zeilen der Ortsliste (WI-0128 E4, EDIT-0001 §4.2, Vertrag `packages/shared/src/editor-places.ts`):
 * die aktiven Zeilen der Registry (`wiki_settlement_registry`, Legacy-Export X3, Migration 0089), deren Wiki-Key keinem aktiven Ort der Domäne
 * zugewiesen ist. `listEditorPlaces` (`places.ts`) hängt sie an die Orte und Stätten an; es gibt keine zweite Liste.
 *
 * 🔴 „Platziert“ heißt: ein aktiver Ort der Domäne trägt denselben kanonischen Wiki-Key in der Zuordnung X2 (`wiki_key_assignment`, Art
 * `siedlung`) - dieselbe Quelle wie der Lookup der Objektlinks (`subjects/wiki-key-lookup.ts`). Nie ein gleicher Name: Legacys Liste blendet
 * auch Zeilen aus, deren Titel nur wie ein Kartenname heißt; hier stehen sie unter „Fehlt“ (Befund `registry_nur_per_name_platziert` beim
 * Zug). Ein verborgener Ort ist platziert (er steht als Zeile der Karte in der Liste), ein stillgelegter nicht.
 *
 * Wie Legacys Liste:
 * - Es fehlen die Zeilen, die Legacy ausblendet (`building_type_excluded`: lineare Infrastruktur, die der Bauwerks-Crawl als Gebäude eintrug).
 * - Der Kontinent der Domäne zählt; ein leerer gilt als Aventurien (Legacy `avesmapsWikiSettlementListLocations`: „Leerer Kontinent zählt
 *   clientseitig als Aventurien“, Vorgabe des Kontinent-Filters Aventurien). Eine Domäne ohne bekannten Kontinent bekommt keine Zeile.
 * - `region` ist „Region, sonst Staat“ wie bei den Orten: Legacys `lage` setzt „Region · Staat“ aus den nichtleeren Teilen zusammen, ihr erster
 *   Teil ist also genau das.
 * - Ein Bauwerk trägt Legacys Urteil innerorts oder unklar samt Siedlung (`place-scope.ts`, für die ganze Liste einmal gerechnet).
 *
 * 🪤 Sobald Editoren hier Orte anlegen und Wiki-Artikel zuweisen (Stufe B), muss die Frage „platziert“ zusätzlich die eigene Zuweisung lesen;
 * heute kommt jede Zuweisung aus Legacy.
 */

/** Der Kontinent, den Legacys Registry für die Siedlungen einer Kartendomäne nennt. */
const CONTINENT_OF_DOMAIN: Readonly<Record<string, string>> = { aventuria: "Aventurien" };

interface RegistryListRow {
    wiki_key: string;
    title: string;
    wiki_url: string | null;
    settlement_class: string;
    building_type: string | null;
    is_ruined: boolean | null;
    lage: string | null;
    has_coat: boolean;
}

export interface WikiSettlementRows {
    /** Die Registry ist importiert (mindestens eine aktive Zeile): erst dann ist „Fehlt“ vollständig (`wikiListe`). */
    imported: boolean;
    rows: EditorPlaceRow[];
}

/** „Region, sonst Staat“ aus Legacys `lage` („Region · Staat“, aus den nichtleeren Teilen zusammengesetzt). */
const regionOfLage = (lage: string | null): string | undefined => lage?.split(" · ")[0]?.trim() || undefined;

function rowOf(row: RegistryListRow, lage: LageJeArtikel): EditorPlaceRow {
    const region = regionOfLage(row.lage);
    const urteil = lage.get(row.wiki_key);
    return {
        // Der Schlüssel IST der kanonische Wiki-Key: Er trägt nach der Regel von X1/X2 schon `wiki:` vor dem Slug (`wiki:gareth`).
        key: row.wiki_key,
        origin: "wiki",
        name: row.title,
        circle: editorPlaceCircle(false, "none"),
        assignment: "none",
        subtype: row.settlement_class,
        ...(row.building_type ? { kind: row.building_type } : {}),
        ...(row.wiki_url ? { wiki: { url: row.wiki_url, title: row.title } } : {}),
        ...(region ? { region } : {}),
        ...(urteil ? { within: urteil.siedlung, scope: urteil.lage } : {}),
        ...(row.is_ruined ? { ruined: true as const } : {}),
        ...(row.has_coat ? { hasCoat: true as const } : {}),
    };
}

export async function listWikiSettlementRows(
    database: Queryable,
    mapDomainId = "aventuria",
    lage: LageJeArtikel = new Map(),
): Promise<WikiSettlementRows> {
    const [state] = await database<{ imported: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM wiki_settlement_registry WHERE is_active) AS imported
    `;
    const continent = CONTINENT_OF_DOMAIN[mapDomainId];
    if (!state?.imported || continent === undefined) return { imported: state?.imported === true, rows: [] };
    const rows = await database<RegistryListRow[]>`
        SELECT r.wiki_key, r.title, r.wiki_url, r.settlement_class, r.building_type, r.is_ruined, r.lage, r.has_coat
          FROM wiki_settlement_registry r
         WHERE r.is_active AND NOT r.building_type_excluded
           AND (r.continent IS NULL OR r.continent = ${continent})
           AND NOT EXISTS (
               SELECT 1
                 FROM wiki_key_assignment a
                 JOIN place p ON p.public_id = a.object_public_id
                WHERE a.is_active AND a.legacy_art = 'siedlung' AND a.wiki_key = r.wiki_key
                  AND p.is_active AND p.map_domain_id = ${mapDomainId}
           )
           -- Ein von der Karte genommener Ort (place.take_off_map) steht als Ort ohne Lage in der Liste; sein Artikel nicht noch einmal.
           AND NOT EXISTS (
               SELECT 1
                 FROM wiki_key_assignment a
                 JOIN place_unplaced u ON u.public_id = a.object_public_id
                WHERE a.is_active AND a.legacy_art = 'siedlung' AND a.wiki_key = r.wiki_key
                  AND u.is_active AND u.map_domain_id = ${mapDomainId}
           )
           -- Ein Ort, der eine Landmarke wurde (WI-0271 L8): Sein Artikel hängt an ihr und steht nicht wieder zum Setzen da.
           AND NOT EXISTS (
               SELECT 1
                 FROM wiki_key_assignment a
                 JOIN terrain_peak tp ON tp.public_id = a.object_public_id
                WHERE a.is_active AND a.legacy_art = 'region' AND a.wiki_key = r.wiki_key
                  AND tp.is_active AND tp.map_domain_id = ${mapDomainId}
           )
         ORDER BY lower(r.title), r.wiki_key
    `;
    return { imported: true, rows: rows.map((row) => rowOf(row, lage)) };
}
