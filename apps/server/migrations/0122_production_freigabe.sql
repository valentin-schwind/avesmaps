-- 0122: Production-Freigabe, Stufe 1 (FREIGABE-0001; Betreiber 2026-10-13: „können wir (die betreiber) manuell freigaben
-- von features nach production machen (squashes von commits)?“, Abnahme „prima das konzept ist einfach. das gefällt mir“,
-- Entscheidungen „alles wie empfohlen, ja“ — Stufe 1 zuerst, Haken und Kandidat später).
--
-- 🔴 REIN ADDITIV, und bewusst klein: Die Freigabe bekommt KEINE eigene Akte, kein eigenes Protokoll und keine eigene
--    Abnahme. Sie ist ein **Vorgang im Kanal** (FREIGABE-0001 §8) — Verlauf, Stationen, Nachweise, Zuständigkeit, Abnahme,
--    Glocke und der Weg zurück stehen dort seit 0106/0107. Hier kommen nur zwei Namen dazu.

-- 1 Die Vorgangsart. Der CHECK wird erweitert, nicht verengt: Das vorige Release schreibt sie nie und liest sie tolerant
--   (die Oberfläche zeigt eine unbekannte Art mit ihrem Namen).
ALTER TABLE avesmaps_kanal.vorgang DROP CONSTRAINT IF EXISTS vorgang_art;
ALTER TABLE avesmaps_kanal.vorgang ADD CONSTRAINT vorgang_art
    CHECK (art IN ('meldung', 'wiederherstellung', 'freigabe'));

-- 2 Zwei Stationen für den Weg nach Production. `auf_stage` gibt es schon und passt unverändert; `production_live` ist der
--   Nachweis, dass der Postflight grün war, `production_zurueck` der des Rückwegs.
--   🪤 `nachweis_release_pflicht` verlangt bei `auf_stage` ein Release; die neuen tun dasselbe, damit ein Nachweis ohne
--   Release gar nicht entstehen kann.
ALTER TABLE avesmaps_kanal.nachweis DROP CONSTRAINT IF EXISTS nachweis_station;
ALTER TABLE avesmaps_kanal.nachweis ADD CONSTRAINT nachweis_station
    CHECK (station IN ('fix_committed', 'auf_stage', 'claudia_nachgeprueft', 'betreiber_abnahme',
                       'production_live', 'production_zurueck'));
ALTER TABLE avesmaps_kanal.nachweis DROP CONSTRAINT IF EXISTS nachweis_release_pflicht;
ALTER TABLE avesmaps_kanal.nachweis ADD CONSTRAINT nachweis_release_pflicht
    CHECK (station NOT IN ('auf_stage', 'production_live', 'production_zurueck') OR release IS NOT NULL);

-- 3 Die zwei Auftragsarten für Claudios Abholer (wie die Abgleiche, WI-0127 SYS-14b): Der Worker lässt sie liegen
--   (`waits_pickup`), Claudios Korridor übernimmt sie über `job_sync_claim`/`job_sync_phase`/`job_sync_finish`.
--   🔴 `production_candidate` fehlt hier mit Absicht: Der Kandidat ist Stufe 2 (Betreiber 2026-10-13: „erst Stufe 1“).
--   Die Jobart steht nicht als CHECK in der Datenbank (wie alle Jobarten, `packages/shared/src/jobs.ts`); `job_enqueue`
--   nimmt sie an, sobald ein Slot sie kennt. Hier ist deshalb nichts am Schema zu ändern — der Eintrag steht im Katalog.
COMMENT ON TABLE avesmaps_kanal.vorgang IS
    'Vorgänge des Betreiber-Kanals (WI-0124); seit 0122 auch die Production-Freigaben (art = freigabe, FREIGABE-0001 §8).';
