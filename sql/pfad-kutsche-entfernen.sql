-- One-off repair, 2026-07-30: the carriage is no longer allowed on a Pfad.
--
-- Ordered by the Owner together with the editor change that stops pre-selecting "Kutsche" for the
-- Pfad way type. This file strips horseCarriage from the lists that were already stored WITH it.
--
-- Measured on 2026-07-30: 910 rows carry it -- 793 active ones (those are the Pfade the map serves,
-- api/app/map-features.php filters is_active = 1) plus 117 inactive ones. The inactive rows are
-- repaired too, on purpose: reactivating one later must not smuggle the carriage back in. Of the
-- active 793, 790 carry nothing but the untouched six-option default -- nobody ever deselected
-- anything there, the default was merely saved along. Three are real partial editor decisions that
-- kept the carriage; they lose it too, because the order was "all paths".
--
-- The 645 active Pfade that store NO list are deliberately left alone (1503 active Pfade = 793 with
-- the carriage + 65 with a list without it + 645 with no list). "Nothing recorded" is
-- the honest state, and the changed default now covers them. Writing lists onto rows that had none
-- is what went wrong on 2026-05-11: the normalize_wuestenpfad_transports admin action wrote []
-- instead of the intended list and no transport_domain, and 26 rows had to be healed afterwards.
--
-- The ban is NOT hard. A carriage does get through a handful of paths, nobody knows which yet, so the
-- checkbox stays offered in the editor and an editor may tick it again. Nothing here prevents that --
-- but do not re-run this file afterwards, or those decisions are stripped again.
--
-- NOTE (2026-07-30): the first version of this file wrapped both statements in a transaction and
-- passed the new revision through the session variable @next_revision (copied from
-- sql/burg-locations-to-gebaeude.sql). Run in phpMyAdmin it changed NOTHING -- no map_features row
-- came back with a raised revision afterwards. map_features.revision is BIGINT UNSIGNED NOT NULL, so
-- an empty @next_revision makes the UPDATE fail and rolls the transaction back, which matches what
-- was observed. The variable is not needed: both statements below read map_revision directly. Run
-- them ONE AT A TIME and read the reported row count each time.
--
-- Step 0 -- how many are there? Expect 910 (this counts inactive rows too, the map does not):
--   SELECT COUNT(*) FROM map_features
--    WHERE feature_type = 'path' AND feature_subtype = 'Pfad'
--      AND JSON_SEARCH(properties_json, 'one', 'horseCarriage', NULL, '$.allowed_transports[*]') IS NOT NULL;

-- Step 1 -- strip the carriage and stamp the rows with the next revision.
-- Must report ~910 rows affected. Idempotent: a second run matches nothing, because the WHERE clause
-- tests the same JSON_SEARCH the SET uses. horseCarriage occurs at most once per list (features.php
-- array_unique's it before saving); if a legacy row carried it twice, step 3 still reports it and
-- this statement can be run once more.
UPDATE map_features
SET properties_json = JSON_REMOVE(
        properties_json,
        JSON_UNQUOTE(JSON_SEARCH(properties_json, 'one', 'horseCarriage', NULL, '$.allowed_transports[*]'))
    ),
    revision = (SELECT revision + 1 FROM map_revision WHERE id = 1)
WHERE feature_type = 'path'
  AND feature_subtype = 'Pfad'
  AND JSON_SEARCH(properties_json, 'one', 'horseCarriage', NULL, '$.allowed_transports[*]') IS NOT NULL;

-- Step 2 -- publish that revision, so every client revalidates its cached map payload.
-- ONE bump for the whole repair, not one per row, and no map_audit_log rows at all: 910 undo entries
-- would bury the editors' own history (Strg+Z walks the log downwards). Harmless to run twice.
UPDATE map_revision SET revision = revision + 1 WHERE id = 1;

-- Step 3 -- proof. The count MUST be 0:
--   SELECT COUNT(*) FROM map_features
--    WHERE feature_type = 'path' AND feature_subtype = 'Pfad'
--      AND JSON_SEARCH(properties_json, 'one', 'horseCarriage', NULL, '$.allowed_transports[*]') IS NOT NULL;
--
-- And a direct look at three repaired rows -- allowed_transports must list five transports, no
-- horseCarriage, and revision must be the raised value:
--   SELECT name, revision, JSON_EXTRACT(properties_json, '$.allowed_transports') AS erlaubt
--     FROM map_features
--    WHERE feature_type = 'path' AND feature_subtype = 'Pfad'
--      AND JSON_LENGTH(properties_json, '$.allowed_transports') > 0
--    ORDER BY revision DESC LIMIT 3;
