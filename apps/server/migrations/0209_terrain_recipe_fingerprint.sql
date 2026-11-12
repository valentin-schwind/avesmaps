-- 0209: Der Master trägt neben der Fassung den Stand ihres Inhalts (WI-0239; Betreiber 2026-10-19 über die Hauptorchestrierung, wörtlich:
-- „Gelände der Stage: wir testen noch 19. kannst du alle änderungen in die 19 tun ohne neue versionen zu generieren bis wir sie abnehmen?“).
--
-- Eine Fassung, die noch nicht abgenommen ist (`config/terrain/aventuria.json`, `accepted`), ändert sich in sich. Die Nummer allein sagt
-- dann nicht mehr, mit welchem Inhalt ein Master gerechnet wurde: `terrain_local` schriebe einen Master mit altem Inhalt von 19 im
-- Fußabdruck mit neuem fort. `recipe_fingerprint` ist der SHA-256 von `JSON.stringify` des geprüften Rezepts (`recipeFingerprint`,
-- `terrain/domain/recipes.ts`), derselbe Inhalt, den der Eingabe-Fingerabdruck liest; `terrain_local` vergleicht ihn mit dem gewählten.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine nullbare Spalte. Das vorige Release liest und schreibt sie nie; `NULL` heißt „unbekannt“
-- (ein Master von vorher). Geschrieben wird sie wie `recipe_version` (0100) beim Speichern eines Masters und beim Erben eines vorläufigen.

ALTER TABLE terrain_domain_raster ADD COLUMN IF NOT EXISTS recipe_fingerprint TEXT;

COMMENT ON COLUMN terrain_domain_raster.recipe_fingerprint IS
    'Stand des Rezeptinhalts, der diesen Master rechnete (SHA-256 des Rezepts, WI-0239); NULL vor Migration 0209.';
