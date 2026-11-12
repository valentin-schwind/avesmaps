-- Typbildpaare KI und ohne KI (WI-0281, Betreiber 2026-11-05, wörtlich: „Künftig soll jede Typbildkategorie zwei Typbilder besitzen können:
-- KI-Typbild … Ohne-KI-Typbild … Die bestehenden 55 Typbildkategorien bleiben erhalten. Es sollen keine doppelten Kategorien entstehen.“).
--
-- Je Kategorie zwei Zuordnungen statt einer: `variant` 'ki' (die KI-generierte Illustration, die der Normalmodus bevorzugt) und 'ohne_ki' (eine
-- Illustration, deren Entstehung ohne KI eingetragen ist; nur sie zeigt der Modus „Ohne KI“). Je Kategorie UND Variante trägt genau eine aktive Zeile
-- den ★, der Verlauf (zurückgezogene Zeilen) bleibt je Variante. Ein Asset bleibt ein Asset mit eigener Herkunft und eigenen Rechten; welches in
-- welche Variante darf, sagt seine Entstehung (`typeImageVariantAccepts`, packages/shared/src/media-editor.ts).
--
-- Erweitern, nicht umstellen (docs/regeln/entwicklung.md, „Migrationen: erst erweitern, dann umstellen, dann entfernen“):
-- - `variant` mit DEFAULT 'ki': Das vorige Release schreibt die Spalte nie und legt damit KI-Zeilen an, wie bisher seine einzigen.
-- - Der Index „ein ★ je Kategorie“ wird „ein ★ je Kategorie und Variante“. Nach dieser Migration ist weiter höchstens EINE Zeile je Kategorie aktiv
--   (die Zuordnung unten verschiebt nur, sie legt nichts an); das vorige Release liest also dieselbe Tafel wie vorher. Erst ein Ohne-KI-Typbild, das
--   das neue Release setzt, macht zwei aktive Zeilen je Kategorie (Rückweg danach: WI-0281, „Rückweg“).
-- - Bestehende Zeilen, aktive wie frühere, gehen in die Variante ihrer Entstehung: nur ein Asset mit der Entstehung Foto, Zeichnung oder Scan wird
--   'ohne_ki'. Alles andere bleibt 'ki', ausdrücklich `unknown` und `derived`: Unbekannte Herkunft gilt nie als ohne KI (Betreiber 2026-11-05,
--   „Eine Nicht-KI-Herkunft darf nicht aus dem Aussehen eines Bildes oder fehlenden KI-Metadaten abgeleitet werden“).
-- - Kein Asset, keine Datei, keine Rechte und keine andere Verwendung ändern sich. Was der Normalmodus zeigt, bleibt gleich: Er nimmt die
--   Ohne-KI-Variante, wo die KI-Variante fehlt. Kartendaten berührt das nicht; neue Rechte braucht es nicht (die Tafel ist schon freigegeben).

ALTER TABLE media_type_image
    ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'ki'
        CONSTRAINT media_type_image_variant_known CHECK (variant IN ('ki', 'ohne_ki'));

UPDATE media_type_image t
   SET variant = 'ohne_ki'
  FROM media_asset a
 WHERE a.id = t.media_asset_id
   AND t.variant = 'ki'
   AND a.creation_method IN ('photo', 'drawing', 'scan');

-- Genau ein ★ je Kategorie und Variante; erst der neue Index, dann fällt der alte.
CREATE UNIQUE INDEX IF NOT EXISTS media_type_image_one_active_variant
    ON media_type_image (category, variant) WHERE retired_at IS NULL;
DROP INDEX IF EXISTS media_type_image_one_active;

COMMENT ON COLUMN media_type_image.variant IS
    'WI-0281: ki = die KI-generierte Illustration (Normalmodus bevorzugt), ohne_ki = Entstehung ohne KI eingetragen (Foto, Zeichnung, Scan; nur sie zeigt der Modus „Ohne KI“). Je Kategorie und Variante genau eine aktive Zeile.';
COMMENT ON TABLE media_type_image IS
    'Typbilder (WI-0068, WI-0281): je Kategorie (Kopfgrafik der Art) und Variante (ki, ohne_ki) genau eine aktive Zeile = das gültige Typbild (★); zurückgezogene Zeilen sind der Verlauf. Eine Verwendung der Rolle header; öffentlich nach der Policy.';
