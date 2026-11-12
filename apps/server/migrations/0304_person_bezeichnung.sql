-- 0304: Bezeichnung am Konto (WI-0279 E10; Betreiber 2026-11-03): die Wortform, in der die Rollen einer Person stehen.
--
-- Nur eine von drei Formen, kein Geschlecht und keine Anrede; freiwillig, `NULL` heißt ohne Wahl und zeigt die neutrale Form. Nur die
-- Person selbst schreibt sie (`/api/account/bezeichnung`), beim Auflösen des Kontos geht sie mit (`auth/dissolve.ts`).
--
-- 🔴 ADDITIV: eine neue, nullbare Spalte; das vorige Release liest sie nie. Die App-Rolle hat die Rechte an `person` für die ganze Tafel,
-- also kommt nichts über Claudio hinzu. Die Spalte zählt die Revision der Person nicht mit (Trigger `person_revision`, Migration 0097):
-- Eine neue Wortform soll niemandem, der gerade den Namen ändert, einen Konflikt melden.

ALTER TABLE avesmaps_auth.person ADD COLUMN IF NOT EXISTS bezeichnung TEXT
    CONSTRAINT person_bezeichnung_wortform CHECK (bezeichnung IN ('maskulin', 'feminin', 'neutral'));
COMMENT ON COLUMN avesmaps_auth.person.bezeichnung IS
    'Wortform der eigenen Rollen (WI-0279 E10), freiwillig; NULL zeigt die neutrale Form. Das Protokoll nennt sie nie.';
