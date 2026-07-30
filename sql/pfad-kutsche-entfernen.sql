-- One-off repair, 2026-07-30: the carriage is no longer allowed on a Pfad.
--
-- Ordered by the Owner together with the editor change that stops pre-selecting "Kutsche" for the
-- Pfad way type. This file strips horseCarriage from the lists that were already stored WITH it.
-- Measured on the live data on 2026-07-30: 793 of 1503 Pfade, and 790 of those 793 carry nothing but
-- the untouched six-option default -- nobody ever deselected anything there, the default was merely
-- saved along. Three are real partial editor decisions that kept the carriage; they lose it too,
-- because the order was "all paths".
--
-- The 645 Pfade that store NO list are deliberately left alone. "Nothing recorded" is the honest
-- state, and the changed default now covers them. Writing lists onto rows that had none is exactly
-- what went wrong on 2026-05-11: the normalize_wuestenpfad_transports admin action wrote [] instead
-- of the intended list and no transport_domain, and 26 rows had to be healed afterwards.
--
-- The ban is NOT hard. A carriage does get through a handful of paths, nobody knows which yet, so the
-- checkbox stays offered in the editor and an editor may tick it again. Nothing here prevents that --
-- but do not re-run this file afterwards, or those decisions are stripped again.
--
-- Idempotent: the WHERE clause tests the same JSON_SEARCH the UPDATE uses, so a second run right
-- after the first matches no rows. horseCarriage occurs at most once per list (features.php
-- array_unique's the list before saving); should a legacy row carry it twice, the verification query
-- at the bottom still reports it and the file can be run once more.
--
-- map_revision is bumped ONCE, not per row, and no map_audit_log rows are written: 793 undo entries
-- would bury the editors' own history (Strg+Z walks the log downwards).
--
-- Run ONCE in phpMyAdmin.
--
-- Before (should report 793):
--   SELECT COUNT(*) FROM map_features
--    WHERE feature_type = 'path' AND feature_subtype = 'Pfad'
--      AND JSON_SEARCH(properties_json, 'one', 'horseCarriage', NULL, '$.allowed_transports[*]') IS NOT NULL;
--
-- After (must report 0):
--   SELECT COUNT(*) FROM map_features
--    WHERE feature_type = 'path' AND feature_subtype = 'Pfad'
--      AND JSON_SEARCH(properties_json, 'one', 'horseCarriage', NULL, '$.allowed_transports[*]') IS NOT NULL;

START TRANSACTION;

SELECT revision + 1 INTO @next_revision
FROM map_revision
WHERE id = 1
FOR UPDATE;

UPDATE map_features
SET properties_json = JSON_REMOVE(
        properties_json,
        JSON_UNQUOTE(JSON_SEARCH(properties_json, 'one', 'horseCarriage', NULL, '$.allowed_transports[*]'))
    ),
    revision = @next_revision
WHERE feature_type = 'path'
  AND feature_subtype = 'Pfad'
  AND JSON_SEARCH(properties_json, 'one', 'horseCarriage', NULL, '$.allowed_transports[*]') IS NOT NULL;

UPDATE map_revision
SET revision = @next_revision
WHERE id = 1;

COMMIT;
