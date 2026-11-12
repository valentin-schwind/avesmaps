import type { MediaMergePreview } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Was ein Zusammenführen bewegen würde, bevor es jemand auslöst (WI-0068 D1; Betreiber 2026-10-11: „Vor dem Klick eine Vorschau
 * mit Zahlen (Gruppen, Assets, umziehende Bindungen)“). Reines Lesen.
 *
 * 🔴 **Gruppen mit abweichenden Rechten bleiben draußen.** Weichen Grundlage, Prüfstand oder Urheber zwischen den Mitgliedern
 * ab, ist die Frage, welches Werk bleibt, keine Rechnung mehr — solche Gruppen stehen einzeln im Korb und zählen hier nur als
 * `withDifferingRights`. Im Bestand sind das 5 von 218 Gruppen.
 *
 * 🔴 **Reisebilder fehlen ganz** (WI-0272 S3, Fixrunde D): Eine Gruppe, in der auch nur EIN Werk ein Reisebild ist (`source_system = 'photobox'`), steht weder in den
 * Gruppen noch in den Zahlen. Reisebilder nehmen an keiner Zusammenführung teil (`merge.ts`).
 *
 * 🪤 **Die Vorgabe für das bleibende Werk ist die größte Auflösung** (Betreiber 2026-10-11, Frage 2 Antwort A), bei gleicher
 * Fläche das ÄLTESTE — sonst hinge die Vorgabe am Zufall der Zeilenreihenfolge, und zwei Vorschauen nacheinander nennten
 * verschiedene Werke.
 *
 * 🪤 **`moves` und `retires` sind gerechnet, nicht geraten:** `retires` zählt die Verwendungen, bei denen das bleibende Werk am
 * selben Platz schon hängt — dort geht nur eine Zeile (Eindeutigkeit je Fachobjekt und Rolle), die andere wird zurückgezogen.
 */
export async function mergePreview(database: Queryable): Promise<MediaMergePreview> {
    const rows = await database<
        {
            fileGroup: string;
            keepAssetId: string;
            members: number;
            moves: number;
            retires: number;
            rightsDiffer: boolean;
        }[]
    >`
        WITH
        -- Die Bytes, an denen ein Reisebild hängt: Die ganze Gruppe bleibt draußen, auch wenn nur ein Werk darin eines ist.
        reisebild AS (
            SELECT DISTINCT f.sha256
              FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE f.storage_class = 'private_source' AND a.source_system = 'photobox'
        ),
        quelle AS (
            SELECT f.media_asset_id AS asset_id, f.sha256, coalesce(f.width, 0) * coalesce(f.height, 0) AS flaeche
              FROM media_file f
             WHERE f.storage_class = 'private_source' AND NOT EXISTS (SELECT 1 FROM reisebild r WHERE r.sha256 = f.sha256)
        ),
        -- Nur Werke, die nicht schon aufgegangen sind: eine aktive Zusammenfuehrung nimmt ihr Werk aus dem Spiel.
        offen AS (
            SELECT q.* FROM quelle q
             WHERE NOT EXISTS (
                 SELECT 1 FROM media_merge m WHERE m.merged_asset_id = q.asset_id AND m.lifted_at IS NULL
             )
        ),
        gruppe AS (
            SELECT sha256, count(*)::int AS members FROM offen GROUP BY sha256 HAVING count(*) > 1
        ),
        -- Das bleibende Werk je Gruppe: groesste Flaeche, bei Gleichstand das aelteste (kleinste id).
        bleibt AS (
            SELECT DISTINCT ON (o.sha256) o.sha256, o.asset_id, a.public_id
              FROM offen o JOIN gruppe g ON g.sha256 = o.sha256 JOIN media_asset a ON a.id = o.asset_id
             ORDER BY o.sha256, o.flaeche DESC, o.asset_id
        ),
        -- Die Kennung der Gruppe: das aelteste Werk, wie MamAssetSummary.fileGroup.
        kennung AS (
            SELECT DISTINCT ON (o.sha256) o.sha256, a.public_id
              FROM offen o JOIN gruppe g ON g.sha256 = o.sha256 JOIN media_asset a ON a.id = o.asset_id
             ORDER BY o.sha256, o.asset_id
        ),
        -- Jede Verwendung der aufgehenden Werke, mit dem Platz, auf den sie zeigt.
        verwendung AS (
            SELECT o.sha256, b.asset_id AS kept, 'place_media' AS tafel, place_id::text || '|' || role AS platz
              FROM place_media v JOIN offen o ON o.asset_id = v.media_asset_id JOIN bleibt b ON b.sha256 = o.sha256
             WHERE v.media_asset_id <> b.asset_id
            UNION ALL
            SELECT o.sha256, b.asset_id, 'territory_media', territory_id::text || '|' || role
              FROM territory_media v JOIN offen o ON o.asset_id = v.media_asset_id JOIN bleibt b ON b.sha256 = o.sha256
             WHERE v.media_asset_id <> b.asset_id
            UNION ALL
            SELECT o.sha256, b.asset_id, 'adventure_media', adventure_id::text || '|' || role
              FROM adventure_media v JOIN offen o ON o.asset_id = v.media_asset_id JOIN bleibt b ON b.sha256 = o.sha256
             WHERE v.media_asset_id <> b.asset_id
            UNION ALL
            SELECT o.sha256, b.asset_id, 'citymap_media', citymap_id::text || '|' || role
              FROM citymap_media v JOIN offen o ON o.asset_id = v.media_asset_id JOIN bleibt b ON b.sha256 = o.sha256
             WHERE v.media_asset_id <> b.asset_id
            UNION ALL
            SELECT o.sha256, b.asset_id, 'media_gallery_item', gallery_id::text || '|-'
              FROM media_gallery_item v JOIN offen o ON o.asset_id = v.media_asset_id JOIN bleibt b ON b.sha256 = o.sha256
             WHERE v.media_asset_id <> b.asset_id
            UNION ALL
            SELECT o.sha256, b.asset_id, 'media_type_image', category || '|' || variant
              FROM media_type_image v JOIN offen o ON o.asset_id = v.media_asset_id JOIN bleibt b ON b.sha256 = o.sha256
             WHERE v.media_asset_id <> b.asset_id
        ),
        -- Die Plaetze, an denen das BLEIBENDE Werk schon haengt: dort wird zurueckgezogen statt umgehaengt.
        belegt AS (
            SELECT b.sha256, 'place_media' AS tafel, place_id::text || '|' || role AS platz
              FROM place_media v JOIN bleibt b ON b.asset_id = v.media_asset_id
            UNION ALL
            SELECT b.sha256, 'territory_media', territory_id::text || '|' || role
              FROM territory_media v JOIN bleibt b ON b.asset_id = v.media_asset_id
            UNION ALL
            SELECT b.sha256, 'adventure_media', adventure_id::text || '|' || role
              FROM adventure_media v JOIN bleibt b ON b.asset_id = v.media_asset_id
            UNION ALL
            SELECT b.sha256, 'citymap_media', citymap_id::text || '|' || role
              FROM citymap_media v JOIN bleibt b ON b.asset_id = v.media_asset_id
            UNION ALL
            SELECT b.sha256, 'media_gallery_item', gallery_id::text || '|-'
              FROM media_gallery_item v JOIN bleibt b ON b.asset_id = v.media_asset_id
            UNION ALL
            -- Ein Platz der Typbilder ist Kategorie und Variante (Migration 0314), wie ziehUm in merge.ts sie vergleicht.
            SELECT b.sha256, 'media_type_image', category || '|' || variant
              FROM media_type_image v JOIN bleibt b ON b.asset_id = v.media_asset_id
        ),
        -- Je Platz zieht nur EINE Verwendung um: Haengen zwei aufgehende Werke am selben Platz (zwei Versionen derselben Karte, WI-0287 Stufe 2), belegt die erste ihn beim
        -- bleibenden Werk, und ziehUm (merge.ts) zieht die zweite zurueck. Darum zaehlen die Umzuege je Platz einmal, der Rest sind Rueckzuege.
        bewegung AS (
            SELECT v.sha256,
                   count(DISTINCT v.tafel || '#' || v.platz) FILTER (WHERE bl.platz IS NULL)::int AS moves,
                   (count(*) - count(DISTINCT v.tafel || '#' || v.platz) FILTER (WHERE bl.platz IS NULL))::int AS retires
              FROM verwendung v
              LEFT JOIN (SELECT DISTINCT sha256, tafel, platz FROM belegt) bl
                ON bl.sha256 = v.sha256 AND bl.tafel = v.tafel AND bl.platz = v.platz
             GROUP BY v.sha256
        ),
        -- Weichen die Rechte voneinander ab? Grundlage, Pruefstand oder Urheber, ueber die Mitglieder der Gruppe.
        rechte AS (
            SELECT o.sha256,
                   count(DISTINCT coalesce(r.rights_basis, '-')) > 1
                   OR count(DISTINCT coalesce(r.clearance_state, '-')) > 1
                   OR count(DISTINCT coalesce(r.creator, '-')) > 1 AS differ
              FROM offen o JOIN gruppe g ON g.sha256 = o.sha256
              LEFT JOIN media_rights r ON r.media_asset_id = o.asset_id
             GROUP BY o.sha256
        )
        SELECT k.public_id::text AS "fileGroup", b.public_id::text AS "keepAssetId", g.members,
               coalesce(w.moves, 0) AS moves, coalesce(w.retires, 0) AS retires, coalesce(r.differ, false) AS "rightsDiffer"
          FROM gruppe g
          JOIN bleibt b ON b.sha256 = g.sha256
          JOIN kennung k ON k.sha256 = g.sha256
          LEFT JOIN bewegung w ON w.sha256 = g.sha256
          LEFT JOIN rechte r ON r.sha256 = g.sha256
         ORDER BY g.members DESC, k.public_id
    `;
    const sauber = rows.filter((row) => !row.rightsDiffer);
    return {
        groups: rows,
        totals: {
            groups: sauber.length,
            members: sauber.reduce((summe, row) => summe + row.members, 0),
            moves: sauber.reduce((summe, row) => summe + row.moves, 0),
            retires: sauber.reduce((summe, row) => summe + row.retires, 0),
            withDifferingRights: rows.length - sauber.length,
        },
    };
}
