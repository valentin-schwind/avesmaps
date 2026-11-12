-- WI-0120, Nachtrag 2026-10-10: Discords Zwei-Faktor-Angabe wird nicht mehr gespeichert.
--
-- Betreiber 2026-10-10 auf die Frage, ob `mfa_enabled` als bloße Information bleibt, nachdem sie seit dem Entscheid „4. B“ nicht
-- mehr als zweiter Faktor zählt: „B: nicht mehr speichern“.
--
-- Release N der Zwei-Release-Regel (AGENTS.md „Migrationen: erst erweitern, dann umstellen, dann entfernen“): Ab diesem Release
-- liest und schreibt kein Code die Spalte mehr (Discord-Client, Anmeldung, Einladung, Verknüpfen, Personendetail). Hier wird sie
-- nullbar, verliert ihre Vorgabe und alle Werte. `DROP COLUMN` folgt frühestens im nächsten Release (Plan in WI-0120, Abschnitt
-- „Nachtrag 2026-10-10: mfa_enabled nicht mehr speichern“).
--
-- Was die Vorversion im Wechsel noch tut, geht weiter: Sie schreibt die Spalte ausdrücklich (ein Wert ist erlaubt) und liest sie im
-- Personendetail (NULL kommt dort als `false` an). Schreibt sie im Fenster des Wechsels einen Wert, nimmt ihn spätestens der Drop
-- im nächsten Release mit.
ALTER TABLE avesmaps_auth.discord_login
    ALTER COLUMN mfa_enabled DROP NOT NULL,
    ALTER COLUMN mfa_enabled DROP DEFAULT;

UPDATE avesmaps_auth.discord_login SET mfa_enabled = NULL WHERE mfa_enabled IS NOT NULL;
