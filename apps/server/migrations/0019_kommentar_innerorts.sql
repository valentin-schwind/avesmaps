-- Nur Kommentare: eine Aussage zurücknehmen, die Legacy nicht trägt.
--
-- 🪤 Migration 0018 hat in den Spaltenkommentar geschrieben: „sie liegen innerorts … ein gebaeude
-- kann ausserorts liegen, ein stadtviertel nie." Der zweite Teil ist aus einem Legacy-KOMMENTAR
-- abgeleitet, nicht aus seinem Fachmodell — und der Betreiber hat am 2026-09-21 widersprochen:
-- solche Sätze gehören nur dann ins Modell, wenn Legacy sie wirklich trägt.
--
-- Gemessen: `stadtviertel` steht in `AVESMAPS_LOCATION_SUBTYPES` und damit in `map_features`, also
-- als Kartenobjekt MIT eigener Position. Das einzige Merkmal, das Legacy führt, ist
-- `avesmapsIstBauwerksklasse` — und das beantwortet „kann etwas enthalten?", nicht „liegt
-- innerorts?". Legacy benennt die Vermischung an derselben Stelle ausdrücklich als offene Stelle.
--
-- 🔴 Ein falscher Kommentar in der Datenbank ist keine Kleinigkeit: er ist das, was der nächste
-- Leser für gesichert hält. Deshalb diese Migration, obwohl sie keine Zeile Struktur ändert.
--
-- Was innerorts wirklich ist — eine Beziehung zu einem Ort, kein Zustand am Objekt — steht in
-- MCS-012. Ein Feld dafür gibt es bewusst noch nicht.

COMMENT ON COLUMN place.subtype IS
    'Ortsklasse, gross -> klein wie Legacys AVESMAPS_ORTSKLASSEN. gebaeude und stadtviertel sind BAUWERKSKLASSEN: keine Siedlung, kein Behaelter, in Legacy als Raute statt als Kreis gezeichnet. Ob ein Objekt innerorts zu einem Ort gehoert, ist eine BEZIEHUNG und keine Eigenschaft dieser Spalte - siehe MCS-012; ein Feld dafuer gibt es noch nicht.';

COMMENT ON TABLE label_class_rank IS
    'Globale Klassenprioritaet der Kartenbeschriftung, zur Laufzeit pflegbar (WI-0007). Gilt fuer alle Objekte einer Klasse; pro Objekt NICHT ueberschreibbar - dafuer ist label_priority da. Reihenfolge gross -> klein wie Legacys AVESMAPS_ORTSKLASSEN.';
