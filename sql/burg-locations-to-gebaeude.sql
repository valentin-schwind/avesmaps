START TRANSACTION;

SELECT revision + 1 INTO @next_revision
FROM map_revision
WHERE id = 1
FOR UPDATE;

UPDATE map_features
SET feature_subtype = 'gebaeude',
    properties_json = JSON_SET(
        COALESCE(properties_json, JSON_OBJECT()),
        '$.feature_subtype', 'gebaeude',
        '$.settlement_class', 'gebaeude',
        '$.settlement_class_label', 'Besondere Bauwerke/Staetten'
    ),
    revision = @next_revision
WHERE feature_type = 'location'
  AND name LIKE 'Burg %';

UPDATE map_revision
SET revision = @next_revision
WHERE id = 1;

COMMIT;
