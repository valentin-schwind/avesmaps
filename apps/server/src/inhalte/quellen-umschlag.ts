import { mediaEditorPreviewUrl, type InhalteUmschlag } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { resolveLiteratureCovers } from "../media/resolver.ts";
import { PUBLISHED_VARIANT, internVariante } from "../media/roles.ts";

/**
 * Das Umschlagbild zu Quellen des Katalogs (WI-0287, Publikationen der Kartensammlung): der Umschlag des Werks der Literatur (`adventure_media`, Rolle `literature_cover`), das eine
 * Quelle meint. Gebraucht von der Klappbox der Publikationen (`media-editor/kartensammlung.ts`) und von der Suche zum Anhängen (`quellen-lesen.ts`, `umschlag=true`). Nur für Editoren.
 *
 * - 🔴 **Nie über den Namen** (Projektregel). Eine Quelle meint ein Werk, wenn (in dieser Stufenfolge, die erste Stufe mit Treffern gilt):
 *   1. ihr Schlüssel `wikipub:<wiki_key>` dem `wiki_key` des Werks gleicht (derselbe Schlüsselraum, Migration 0068);
 *   2. ihre Adresse einer Adresse des Werks gleicht (`link_fshop`, `link_ulisses`, `wiki_url`);
 *   3. die Nummer des Produkts in ihrer Adresse die des Werks ist: F-Shop `search?sSearch=<Artikelnummer>` gegen `fshop_code`, Ulisses `/product/<Nummer>` gegen dieselbe Nummer in
 *      `link_ulisses`. Gemessen 2026-11-07 am lokalen Bestand: Die 131 Quellen der Sammlung tragen die Shop-Adresse als Suche bzw. ohne Namensteil, die Werke die volle
 *      Produktseite. Stufe 2 trifft keine; mit Stufe 1 allein haben 20 ein Bild, mit Stufe 3 dazu 89 (20 über den Schlüssel, 53 F-Shop, 16 Ulisses).
 * - **Eindeutig oder nichts:** Meint eine Quelle auf ihrer Stufe mehrere Werke (ein Sammelband, dessen Nummer auch die enthaltenen Abenteuer tragen), gibt es kein Bild. Nur aktive Werke.
 * - **Welches Bild:** das öffentliche, wie Besucher es sähen (`resolveLiteratureCovers`, dieselbe Entscheidung); sonst die private Vorschau (`intern_literature_cover`), die nur Editoren
 *   mit `view_media_private` laden. Ohne beides: kein Bild.
 */

/** Die Artikelnummer der F-Shop-Suche (`https://www.f-shop.de/search?sSearch=10291`). */
const FSHOP_NUMMER = "^https?://(?:www\\.)?f-shop\\.de/search\\?sSearch=([^&#]+)";
/** Die Produktnummer bei Ulisses (`https://www.ulisses-ebooks.de/de/product/126494/…`). */
const ULISSES_NUMMER = "^https?://(?:www\\.)?ulisses-ebooks\\.de/(?:[a-z]{2}/)?product/([0-9]+)";

interface UmschlagZeile {
    quelle: string;
    werk: string;
    asset_id: string;
    iv_variant: string | null;
    iv_w: number | null;
    iv_h: number | null;
}

/** Je Quelle (`feature_source.public_id`) ihr Umschlagbild; eine Quelle ohne Bild fehlt in der Antwort. Zwei Abfragen für alle Quellen, kein N+1. */
export async function umschlaegeVon(
    database: Queryable,
    quellen: readonly string[],
): Promise<Map<string, InhalteUmschlag>> {
    const ergebnis = new Map<string, InhalteUmschlag>();
    const kennungen = [...new Set(quellen)];
    if (kennungen.length === 0) return ergebnis;
    const intern = internVariante(PUBLISHED_VARIANT.literature_cover);
    const zeilen = await database<UmschlagZeile[]>`
        WITH q AS (
            SELECT f.public_id::text AS quelle, f.url,
                   CASE WHEN f.source_key LIKE 'wikipub:%' THEN substr(f.source_key, 9) END AS wiki_key,
                   lower(substring(f.url from ${FSHOP_NUMMER})) AS fshop,
                   substring(f.url from ${ULISSES_NUMMER}) AS ulisses
              FROM feature_source f
             WHERE f.public_id = ANY(${kennungen}::uuid[])
        ),
        w AS MATERIALIZED (
            SELECT a.id, a.public_id::text AS werk, a.wiki_key, a.link_fshop, a.link_ulisses, a.wiki_url,
                   lower(a.fshop_code) AS fshop, substring(a.link_ulisses from ${ULISSES_NUMMER}) AS ulisses
              FROM adventure a WHERE a.is_active
        ),
        -- Je Weg ein Gleichheitsvergleich (Hash-Join statt eines ODER über jedes Paar).
        treffer AS (
            SELECT q.quelle, w.id AS werk_id, w.werk, 1 AS stufe FROM q JOIN w ON w.wiki_key = q.wiki_key
            UNION SELECT q.quelle, w.id, w.werk, 2 FROM q JOIN w ON w.link_fshop = q.url
            UNION SELECT q.quelle, w.id, w.werk, 2 FROM q JOIN w ON w.link_ulisses = q.url
            UNION SELECT q.quelle, w.id, w.werk, 2 FROM q JOIN w ON w.wiki_url = q.url
            UNION SELECT q.quelle, w.id, w.werk, 3 FROM q JOIN w ON w.fshop = q.fshop
            UNION SELECT q.quelle, w.id, w.werk, 3 FROM q JOIN w ON w.ulisses = q.ulisses
        ),
        stufe AS (SELECT quelle, min(stufe) AS stufe FROM treffer GROUP BY quelle),
        eindeutig AS (
            SELECT t.quelle, min(t.werk) AS werk, min(t.werk_id) AS werk_id
              FROM treffer t JOIN stufe s ON s.quelle = t.quelle AND s.stufe = t.stufe
             GROUP BY t.quelle
            HAVING count(*) = 1
        )
        SELECT e.quelle, e.werk, a.public_id::text AS asset_id, iv.variant AS iv_variant, iv.width AS iv_w, iv.height AS iv_h
          FROM eindeutig e
          JOIN adventure_media m ON m.adventure_id = e.werk_id AND m.role = 'literature_cover' AND m.retired_at IS NULL
          JOIN media_asset a ON a.id = m.media_asset_id
          LEFT JOIN LATERAL (
              SELECT f.variant, f.width, f.height FROM media_file f
               WHERE f.media_asset_id = a.id AND f.storage_class = 'derivative' AND f.variant = ${intern}
               ORDER BY f.created_at DESC, f.id DESC LIMIT 1
          ) iv ON TRUE
    `;
    if (zeilen.length === 0) return ergebnis;
    const oeffentlich = await resolveLiteratureCovers(
        database,
        zeilen.map((zeile) => zeile.werk),
    );
    for (const zeile of zeilen) {
        const sicht = oeffentlich.get(zeile.werk);
        if (sicht !== undefined) {
            ergebnis.set(zeile.quelle, { url: sicht.url, width: sicht.width, height: sicht.height, oeffentlich: true });
        } else if (zeile.iv_variant !== null && zeile.iv_w !== null && zeile.iv_h !== null) {
            ergebnis.set(zeile.quelle, {
                url: mediaEditorPreviewUrl(zeile.asset_id, zeile.iv_variant),
                width: zeile.iv_w,
                height: zeile.iv_h,
                oeffentlich: false,
            });
        }
    }
    return ergebnis;
}
