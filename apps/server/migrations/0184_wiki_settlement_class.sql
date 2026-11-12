-- 0184: Die Ortsgröße laut Wiki im Schnappschuss der Orte (WI-0225; Auftrag der Editor-Orchestrierung 2026-10-18).
--
--   Am Ort zeigt das Wiki-Feld (Design Guide §13.8) die Ortsgröße des Wiki durchgestrichen, wenn unsere abweicht, wie Legacy
--   (`js/ui/wiki-assign-ort.js`, `avesmapsWikiAssignOrtWerte`: `ortsgroesse` aus `nest.settlement_class`). Der Detailimport hatte die
--   Klasse des Orts-Nests bewusst nicht übernommen („Keine Daten auf Vorrat: ein späterer Leser holt sie additiv aus dem Satz“,
--   `project-control/migration/contracts/subject-details.yaml`); der Leser ist jetzt da. Gefüllt vom Detailimport aus dem vorhandenen
--   Satz, ohne neue Legacy-Anfrage. Kartendaten ändern sich nicht, nur der Schnappschuss des Wiki.
--
--   `settlement_class`: Legacys Ortsklasse wörtlich (metropole, grossstadt, stadt, kleinstadt, dorf, gebaeude, stadtviertel), ohne
--   CHECK wie in `wiki_settlement_registry` (0089): ein neuer Wert hielte sonst den Import an (Betreiber 2026-10-03).
--   `settlement_class_guessed`: Legacys Kennzeichen, dass der Parser die Klasse geraten hat (sein Rückfall ist „dorf“); NULL, wo das Nest
--   den Schlüssel nicht trägt (jedes vor dem 17.08.2026 geschriebene). 🔴 Legacys Regel, übernommen vom Leser: geraten heißt unbekannt,
--   und fehlt das Kennzeichen, gilt „dorf“ als geraten (`avesmapsWikiAssignOrtGroesseIstGeraten`, nach dem Unfall „Gareth wird Dorf“).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): zwei nullbare Spalten ohne Vorgabe; das vorige Release liest sie nie. Rechte: unverändert
-- (der Import schreibt als Migrationsrolle, die App liest).

ALTER TABLE wiki_settlement_snapshot ADD COLUMN IF NOT EXISTS settlement_class TEXT;
ALTER TABLE wiki_settlement_snapshot ADD COLUMN IF NOT EXISTS settlement_class_guessed BOOLEAN;

COMMENT ON COLUMN wiki_settlement_snapshot.settlement_class IS
    'Ortsklasse des Orts-Nests laut Legacy, wörtlich (WI-0225, 0184). Der Leser nimmt sie nur, wenn sie nicht geraten ist.';
COMMENT ON COLUMN wiki_settlement_snapshot.settlement_class_guessed IS
    'Legacys Kennzeichen „vom Parser geraten“; NULL ohne Kennzeichen (dann gilt „dorf“ als geraten, Legacys Regel).';
