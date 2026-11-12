-- 0146: Neuigkeiten pflegen (WI-0217; Betreiber 2026-10-17: „was fehlt sind löschen und neu“, gewählt „Papierkorb“ und „Bearbeitbar
-- bis zum Zug“ für die Stage).
--
--   1. `geloescht_at`, `geloescht_von`, `geloescht_aus`: der Papierkorb. 🔴 Gelöscht wird weiter nie (WI-0139, `news-grants.psql`
--      nimmt der App-Rolle DELETE): Ein Eintrag im Papierkorb ist eine Zeile mit Zeitpunkt und Person, die sich zurückholen lässt.
--      `geloescht_aus` merkt den Zustand davor. Ein sichtbarer Eintrag wird beim Löschen zugleich versteckt; so zeigt auch das vorige
--      Release, das diese Spalten nicht kennt, nichts Gelöschtes auf avesmaps.de.
--   2. `geaendert_at`: wann eine Person den Eintrag zuletzt geändert hat (bessern, Zustand, Papierkorb). Die Stage vergleicht damit
--      gegen das Ende des letzten Production-Zugs, der `news_entry` ersetzt: Was danach angelegt oder geändert wurde, steht nur auf
--      der Stage (Betreiber 2026-10-17: „neuigkeiten wandern immer von production -> stage“).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): vier nullbare Spalten ohne Vorgabe, keine Bedingung, keine Datenänderung. Das vorige Release
-- liest und schreibt weiter; die Routine (`news_add`) bleibt unverändert. Die App-Rolle hat ihre Rechte an der ganzen Tafel, die
-- neuen Spalten brauchen keine eigene Zeile in `news-grants.psql`.

ALTER TABLE public.news_entry ADD COLUMN IF NOT EXISTS geaendert_at TIMESTAMPTZ;
ALTER TABLE public.news_entry ADD COLUMN IF NOT EXISTS geloescht_at TIMESTAMPTZ;
ALTER TABLE public.news_entry ADD COLUMN IF NOT EXISTS geloescht_von UUID;
ALTER TABLE public.news_entry ADD COLUMN IF NOT EXISTS geloescht_aus TEXT;

COMMENT ON COLUMN public.news_entry.geloescht_at IS
    'Im Papierkorb seit (WI-0217); NULL heißt in der Liste. Gelöscht wird nie, zurückholen setzt NULL.';
COMMENT ON COLUMN public.news_entry.geloescht_aus IS
    'Der Zustand vor dem Papierkorb (WI-0217); Zurückholen stellt ihn wieder her.';
COMMENT ON COLUMN public.news_entry.geaendert_at IS
    'Letzte Änderung durch eine Person (WI-0217); die Stage erkennt daran, was nach dem Production-Zug geschah.';
