-- Bildbezug je Verwendung: Ortsansicht oder Typbild (Betreiber 2026-10-11, wörtlich „1A … 2 B … 3 A ja das gilt für alle“;
-- Arbeitsanweisung project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md, Mockup
-- project-control/mockups/bildbezug-2026-10-11.html, WI-0068 Abschnitt „Bildbezug (Ortsansicht/Typbild)“).
--
-- 1A: Ob ein Kopfbild an einem Ort den Ort ausdrücklich darstellt (`place_view`, „Ortsansicht“) oder ihn nur veranschaulicht
-- (`type_image`, „Typbild“), ist eine Eigenschaft der VERWENDUNG, nicht des Assets. Der Startwert kommt aus einer Regel, die der Server
-- beim Lesen rechnet (apps/server/src/media/image-relation.ts): dieselbe Datei (`media_file` Variante `source`, sha256) hängt als
-- Kopfbild an genau EINEM aktiven Ort, dann Ortsansicht, sonst Typbild. Gezählt über die Datei, nicht über die Asset-Kennung, weil Legacy
-- dieselbe Datei in verschiedene Assets gelegt hat. Diese Spalte ist die redaktionelle Übersteuerung je Verwendung; sie gewinnt in
-- beide Richtungen. NULL heißt: die Regel gilt.
--
-- 🔴 Kein Nachtrag, keine Zeile wird geändert: Die Regel rechnet beim Lesen, die Spalte füllt allein ein Mensch über die Operation
-- `header.relation` der Medienverwaltung (Recht `upload_media`, Fachprotokoll, Revision). Kein Import schreibt sie: Sie steht in
-- keiner Spaltenliste von `migrate:media`, und der Import löscht weder Galerieeinträge noch Bindungen (er zieht höchstens zurück), also
-- übersteht sie jeden Zug (AGENTS.md, Betreiber 2026-10-10: „die entscheidung darf nicht nachträglich kompromittiert werden“).
--
-- Additiv (AGENTS.md „erst erweitern, dann umstellen, dann entfernen“): eine nullbare Spalte mit eigenem CHECK an der neuen Spalte; das
-- vorige Release liest und schreibt weiter, ohne sie zu kennen. Keine neuen Rechte: Die App-Rolle schreibt beide Tabellen schon
-- (Default-Privilegien der Migrationsrolle), die Revision zählt der vorhandene Trigger (0086) bei jeder Spalte mit.

ALTER TABLE media_gallery_item
    ADD COLUMN IF NOT EXISTS image_relation_override TEXT
        CHECK (image_relation_override IS NULL OR image_relation_override IN ('place_view', 'type_image'));

ALTER TABLE place_media
    ADD COLUMN IF NOT EXISTS image_relation_override TEXT
        CHECK (image_relation_override IS NULL OR image_relation_override IN ('place_view', 'type_image'));

COMMENT ON COLUMN media_gallery_item.image_relation_override IS
    'Bildbezug dieses Galerieeintrags, von einem Menschen gesetzt (Betreiber 2026-10-11 „1A“): place_view (Ortsansicht) oder type_image (Typbild). NULL: die Regel gilt (dieselbe Quelldatei an genau einem aktiven Ort = Ortsansicht). Kein Import schreibt sie.';
COMMENT ON COLUMN place_media.image_relation_override IS
    'Bildbezug dieser Kopfbild-Bindung, von einem Menschen gesetzt (Betreiber 2026-10-11 „1A“): place_view oder type_image; NULL: die Regel gilt. Nur bei role = header von Bedeutung. Kein Import schreibt sie.';
