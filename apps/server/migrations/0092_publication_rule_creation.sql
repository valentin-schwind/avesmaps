-- Freigaberegeln dürfen zusätzlich die ENTSTEHUNG nennen (WI-0068, Betreiber 2026-10-10).
--
-- Betreiber, wörtlich: „eigene bilder sind nicht automatisch öffentlich, aber die die wir haben sind alle KI-generiert und alle
-- KI-generierten sind öffentlich“. Die beiden Klassenregeln für Wappen und Ortsbilder (G1, `own_work` für `coat` und `header`, Betreiber
-- 2026-10-04 und 2026-10-05) galten jedem Asset der Rechtsgrundlage „eigenes Werk“, also auch einem neuen Upload ohne Rechteprüfung. Ihre
-- Nachfolger nennen die Entstehung: (own_work, ai_generated, coat) und (own_work, ai_generated, header). „KI-generiert“ gehört zur
-- Entstehung (`media_asset.creation_method`), nicht zu den Rechten (WI-0068 §6, §7).
--
-- 🔴 ADDITIV, das vorige Release erträgt es (AGENTS „erst erweitern, dann umstellen, dann entfernen“):
--   - Die Spalte ist nullbar; NULL heißt „jede Entstehung“, wie bisher jede Regel. Das vorige Release liest sie nicht und liest eine neue
--     Regel (own_work, ai_generated, coat) als (own_work, coat): dieselbe Wirkung wie die abgelöste Regel, auch nach einem Rückweg.
--   - Die Prüfung gilt nur der neuen Spalte; das vorige Release schreibt sie nie.
--   - Der Eindeutigkeitsindex nimmt die Entstehung dazu: Die alte und die neue Regel unterscheiden sich nur in ihr. Er wird ZUERST angelegt,
--     dann fällt der alte (ein Index ist kein Leservertrag; `seedPublicationRules` des vorigen Release fragt mit WHERE NOT EXISTS).
-- Die Zeilen der neuen Regeln schreibt diese Migration NICHT: Sie entstehen mit `seedPublicationRules` (migrate:media, media:regeln) in
-- EINER Transaktion mit dem Widerruf der Vorgänger, mit Zitat und Datum.
ALTER TABLE publication_rule ADD COLUMN IF NOT EXISTS creation_method TEXT;

ALTER TABLE publication_rule
    DROP CONSTRAINT IF EXISTS publication_rule_creation_method_known,
    ADD CONSTRAINT publication_rule_creation_method_known CHECK (
        creation_method IS NULL OR creation_method IN ('photo', 'drawing', 'ai_generated', 'scan', 'derived')
    );

CREATE UNIQUE INDEX IF NOT EXISTS publication_rule_one_active_per_scope
    ON publication_rule (rights_basis, license_key, creation_method, role) NULLS NOT DISTINCT
    WHERE revoked_on IS NULL;
DROP INDEX IF EXISTS publication_rule_one_active;

COMMENT ON COLUMN publication_rule.creation_method IS
    'Entstehung, für die die Regel gilt (media_asset.creation_method); NULL: jede. Betreiber 2026-10-10: die Klassenregeln für Wappen und Ortsbilder gelten KI-generierten eigenen Werken, nicht jedem eigenen Werk (media/policy.ts, ruleCovers).';
