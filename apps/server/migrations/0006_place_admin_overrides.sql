-- Ortslabels: die globale Tafel aus Ortsklasse und Zoomband steuert, ein Admin darf im Einzelfall
-- davon abweichen (ADR-0006). Die Spalten heissen deshalb, was sie sind: Overrides.
--
-- Sie tragen KEINE Legacy-Provenienz. Legacy-Orte kennen solche Felder nicht (Finding MCS-006);
-- das hier ist eine Avesmaps3D-Adminfunktion, und die alten Namen haben das verschwiegen.
--
-- NULL heisst ueberall "globale Regel verwenden". Ein Override ersetzt genau die Eigenschaft, die
-- er setzt, und nichts sonst.

ALTER TABLE place RENAME COLUMN label_min_zoom TO label_min_zoom_override;
ALTER TABLE place RENAME COLUMN label_max_zoom TO label_max_zoom_override;

-- show_name war NOT NULL DEFAULT TRUE und konnte deshalb "erbt die globale Regel" gar nicht
-- ausdruecken: jede Zeile behauptete eine Entscheidung. Als Override ist es dreiwertig.
ALTER TABLE place RENAME COLUMN show_name TO label_visible_override;
ALTER TABLE place ALTER COLUMN label_visible_override DROP NOT NULL;
ALTER TABLE place ALTER COLUMN label_visible_override DROP DEFAULT;
UPDATE place SET label_visible_override = NULL WHERE label_visible_override IS TRUE;

-- Schriftgroesse in pt, dieselbe Einheit wie die globale Tafel (Finding MCS-004), gleiche Schranken.
ALTER TABLE place ADD COLUMN IF NOT EXISTS label_size_override NUMERIC(4, 1)
    CHECK (label_size_override IS NULL OR label_size_override BETWEEN 4 AND 30);

ALTER TABLE place RENAME CONSTRAINT place_label_zoom_ordered TO place_label_override_zoom_ordered;

COMMENT ON COLUMN place.label_min_zoom_override IS
    'Admin-Override des Erscheinungsbandes, logisches Band 0..8. NULL = globale Klassenregel.';
COMMENT ON COLUMN place.label_max_zoom_override IS
    'Admin-Override der oberen Bandgrenze, inklusiv wie in Legacy. NULL = globale Klassenregel.';
COMMENT ON COLUMN place.label_visible_override IS
    'Admin-Override der Sichtbarkeit: TRUE zeigt, FALSE unterdrueckt, NULL = globale Klassenregel.';
COMMENT ON COLUMN place.label_size_override IS
    'Admin-Override der Schriftgroesse in pt, 4 bis 30. NULL = globale Klassenregel.';
