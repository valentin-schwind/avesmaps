-- Der Asset-Typ steht am Asset (WI-0068 P4b, Betreiber 2026-10-10).
--
-- Betreiber, wörtlich: „wappen sind ein eigener bild typ und haben nichts mit normalen bildern zu tun. sie müssen bestimmte
-- qualitätsmerkmale erfüllen“; zur Liste Wappen · Bild · Karte · Kartenvorschau · Buchumschlag · 3D-Modell: „das war die liste, genau“.
-- Bisher war ein Wappen nur eine ROLLE einer Bindung; ein hochgeladenes, noch nicht gebundenes Wappen wusste nicht, dass es eines ist
-- (der Typ stand nur im Fachprotokoll). Die Rolle bleibt die Verwendung, der Typ ist eine Eigenschaft des Assets und begrenzt die Rollen
-- (`MEDIA_ASSET_TYPE_ROLES` in packages/shared/src/media.ts, EINE Tafel).
--
-- 🔴 ADDITIV, das vorige Release erträgt es (AGENTS „erst erweitern, dann umstellen, dann entfernen“):
--   - Die Spalte ist nullbar und hat keinen Vorgabewert; das vorige Release liest sie nicht und legt Assets ohne sie an (NULL heißt
--     „noch kein Typ“, der Server lässt dann jede Rolle zu und trägt den Typ beim ersten Binden nach).
--   - Die Prüfung gilt nur der neuen Spalte; NULL erfüllt sie.
--   - Der Nachtrag ändert nur Zeilen ohne Typ (wiederholbar, ein zweiter Lauf ändert nichts) und rührt keine Bindung, keine Rechte und
--     keinen Titel an. `asset_type` steht nicht in der Spaltenliste des Triggers `media_asset_revision`: Der Nachtrag hebt keine
--     Revision und beschert keinem offenen Editor einen Konflikt. Er ist eindeutig: am Satz vom 2026-10-10 gemessen trägt jedes der 2.501 Assets genau eine Legacy-Klasse, und jede
--     Klasse passt zu genau einer Rolle (keine Doppelverwendung, nichts Ungebundenes).
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS asset_type TEXT;

ALTER TABLE media_asset
    DROP CONSTRAINT IF EXISTS media_asset_type_known,
    ADD CONSTRAINT media_asset_type_known CHECK (
        asset_type IS NULL OR asset_type IN ('coat', 'picture', 'map', 'map_preview', 'cover', 'model_3d')
    );

COMMENT ON COLUMN media_asset.asset_type IS
    'Asset-Typ (WI-0068, Betreiber 2026-10-10): coat (Wappen), picture (Bild), map (Karte), map_preview (Kartenvorschau), cover (Buchumschlag), model_3d. Bestimmt die erlaubten Rollen (MEDIA_ASSET_TYPE_ROLES). NULL: noch kein Typ (vor 0095 angelegt, ohne Klasse und Verwendung).';

-- 1. 3D-Modelle sind es von ihrer Art her.
UPDATE media_asset SET asset_type = 'model_3d' WHERE asset_type IS NULL AND media_kind = 'model_3d';

-- 2. Der Bestand aus Legacy: die Klasse des Manifests (media_legacy_source, 1:1 zum Asset).
UPDATE media_asset a
SET asset_type = CASE ls.media_class
        WHEN 'settlement_coat' THEN 'coat'
        WHEN 'territory_coat' THEN 'coat'
        WHEN 'settlement_image' THEN 'picture'
        WHEN 'citymap_full' THEN 'map'
        WHEN 'citymap_preview' THEN 'map_preview'
        WHEN 'literature_cover' THEN 'cover'
    END
FROM media_legacy_source ls
WHERE ls.media_asset_id = a.id
  AND a.asset_type IS NULL
  AND ls.media_class IN ('settlement_coat', 'territory_coat', 'settlement_image', 'citymap_full', 'citymap_preview', 'literature_cover');

-- 3. Ein Upload im Editor: der Typ, für den hochgeladen wurde (Fachprotokoll `asset.uploaded`, `details.role`).
UPDATE media_asset a
SET asset_type = CASE e.details ->> 'role'
        WHEN 'coat' THEN 'coat'
        WHEN 'header' THEN 'picture'
        WHEN 'map_full' THEN 'map'
        WHEN 'map_preview' THEN 'map_preview'
        WHEN 'literature_cover' THEN 'cover'
    END
FROM media_audit_event e
WHERE e.media_asset_public_id = a.public_id
  AND e.action = 'asset.uploaded'
  AND a.asset_type IS NULL
  AND e.details ->> 'role' IN ('coat', 'header', 'map_full', 'map_preview', 'literature_cover');

-- 4. Sonst die Rolle einer Verwendung, aber nur, wenn alle aktiven Verwendungen auf denselben Typ zeigen; sonst bleibt NULL (Befund).
WITH roles AS (
    SELECT media_asset_id, role FROM place_media WHERE retired_at IS NULL
    UNION ALL SELECT media_asset_id, role FROM territory_media WHERE retired_at IS NULL
    UNION ALL SELECT media_asset_id, 'header' FROM media_gallery_item WHERE retired_at IS NULL
    UNION ALL SELECT media_asset_id, role FROM citymap_media WHERE retired_at IS NULL
    UNION ALL SELECT media_asset_id, role FROM adventure_media WHERE retired_at IS NULL
),
typed AS (
    SELECT media_asset_id,
           CASE role
               WHEN 'coat' THEN 'coat'
               WHEN 'header' THEN 'picture'
               WHEN 'map_full' THEN 'map'
               WHEN 'map_preview' THEN 'map_preview'
               WHEN 'literature_cover' THEN 'cover'
           END AS asset_type
    FROM roles
),
single AS (
    SELECT media_asset_id, min(asset_type) AS asset_type
    FROM typed
    GROUP BY media_asset_id
    HAVING count(DISTINCT asset_type) = 1
)
UPDATE media_asset a
SET asset_type = single.asset_type
FROM single
WHERE single.media_asset_id = a.id AND a.asset_type IS NULL;
