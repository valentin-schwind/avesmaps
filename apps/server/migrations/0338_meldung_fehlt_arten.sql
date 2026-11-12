-- Das Meldeformular fragt bei „Etwas fehlt“ eine neue Liste (WI-0279, Betreiber 2026-11-11): Insel, Landschaft (Wald, Sumpf, Wüste …), Herrschaftsgebiet und Sprache kommen dazu.
-- Nur erweitert: `gebiet` bleibt gültig (Bestand, Legacy-Übernahme, altes Fenster im Browser), das vorige Release läuft unverändert weiter.
-- Wiederholbar: Der CHECK wird gelockert; die Funktionen `community_meldung` und `community_meldung_als` reichen den Wert unverändert durch.

ALTER TABLE avesmaps_community.vorgang DROP CONSTRAINT IF EXISTS vorgang_fehlt_art;
ALTER TABLE avesmaps_community.vorgang ADD CONSTRAINT vorgang_fehlt_art CHECK (
    fehlt_art IS NULL OR (
        kategorie = 'fehlt'
        AND fehlt_art IN ('ort', 'weg', 'fluss', 'gebirge', 'gewaesser', 'gebiet', 'anderes', 'insel', 'landschaft', 'herrschaft', 'sprache')
    )
);
