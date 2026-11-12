-- 0227: Prompt, Uhrzeit und Kanäle des Discord-Tagesberichts im Reiter (WI-0255; Vali 2026-10-25: „die betreiber sollen den prompt unter "Neuigkeiten"
-- -> "Discord" -> "Prompt für den täglichen Bericht" ändern können. schön wär auch die uhrzeit für die routine und auch den kanal festlegen können“).
--
-- Die Einstellungen stehen in der Zeile der Routine (`discord_routine`, Migration 0221), also je Umgebung: Der Production-Zug behält die Tafel auf der
-- Stage (`KEEP_RE`), der Abzug für lokal lässt sie weg. Eine Einstellung auf der Stage ändert nie die von Production.
--
--   uhrzeit          Beginn des Sendefensters, `HH:MM` Berliner Zeit; Vorgabe 10:00. Das Fenster reicht vier Stunden weiter, höchstens bis Mitternacht.
--   prompt           der Prompt für den Rahmentext, den ein Formulierer schreibt; NULL: es gilt die Vorgabe der App. Nur Ton und Stil, die Fakten
--                    kommen fest aus der Vorlage, und die harten Regeln der App gehen jedem Prompt vor.
--   berichts_kanal   Kennung des Berichtskanals; NULL: es gilt `DISCORD_BERICHT_KANAL` der Umgebung.
--   test_kanal       Kennung des Testkanals; NULL: es gilt `DISCORD_TESTKANAL` der Umgebung.
--   einstellungen_at / einstellungen_von   wann und wer zuletzt (getrennt von `geaendert_*`, das den Schalter der Routine meint).
--
-- 🔴 Keine Geheimnisse hier: Der Bot-Schlüssel bleibt in der geschützten Konfiguration auf dem VPS. Kanalkennungen sind kein Geheimnis.
-- ADDITIV: nur neue Spalten, alle mit Vorgabe oder NULL; das vorige Release liest und schreibt sie nicht und läuft unverändert weiter. Die Spalten
-- heißen bewusst nicht `discord_…` (Wächter `readonly-allowlist.test.ts` hält Spalten mit dem Wort „discord“ für Anmeldedaten).

ALTER TABLE public.discord_routine
    ADD COLUMN IF NOT EXISTS uhrzeit TEXT NOT NULL DEFAULT '10:00'
        CONSTRAINT discord_routine_uhrzeit_form CHECK (uhrzeit ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    ADD COLUMN IF NOT EXISTS prompt TEXT
        CONSTRAINT discord_routine_prompt_grenze CHECK (prompt IS NULL OR char_length(prompt) BETWEEN 1 AND 1500),
    ADD COLUMN IF NOT EXISTS berichts_kanal TEXT
        CONSTRAINT discord_routine_berichts_kanal_kennung CHECK (berichts_kanal IS NULL OR berichts_kanal ~ '^[0-9]{17,20}$'),
    ADD COLUMN IF NOT EXISTS test_kanal TEXT
        CONSTRAINT discord_routine_test_kanal_kennung CHECK (test_kanal IS NULL OR test_kanal ~ '^[0-9]{17,20}$'),
    ADD COLUMN IF NOT EXISTS einstellungen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS einstellungen_von UUID;

COMMENT ON COLUMN public.discord_routine.uhrzeit IS
    'Beginn des Sendefensters des Tagesberichts, HH:MM Europe/Berlin (WI-0255); das Fenster reicht vier Stunden weiter, höchstens bis Mitternacht.';
COMMENT ON COLUMN public.discord_routine.prompt IS
    'Prompt für den Rahmentext des Tagesberichts (WI-0255); NULL: Vorgabe der App. Nur Ton und Stil, die Fakten kommen aus der Vorlage.';
COMMENT ON COLUMN public.discord_routine.berichts_kanal IS
    'Kennung des Berichtskanals (WI-0255); NULL: Umgebungsvariable DISCORD_BERICHT_KANAL.';
COMMENT ON COLUMN public.discord_routine.test_kanal IS
    'Kennung des Testkanals (WI-0255); NULL: Umgebungsvariable DISCORD_TESTKANAL.';
