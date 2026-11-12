-- Diagnosen zu Fehlern im Browser (WI-0202; Betreiber 2026-10-16 auf Review-Frage 5).
--
-- Die Zählung je Art steht als Metrik `client_fehler` in `visitor_metric` wie jede Summe der Statistik. Hier liegt nur die
-- bereinigte Diagnose, mit eigener kurzer Frist (14 Tage, gelöscht im Takt der Besucherstatistik): Eine Zeile je Tag und
-- Signatur, gleiche Diagnosen zählen hoch.
--
-- 🔴 Keine Spalte für IP, Tageskennung, Sorte (Besucher oder Editor), Uhrzeit oder Adresse. Was hier steht, hat der Server
-- noch einmal bereinigt (`bereinigeDiagnose` in `packages/shared/src/client-fehler.ts`). Die Listen der Arten und
-- Grafikklassen stehen nur dort; hier prüfen nur Längen, damit eine neue Art keine Migration braucht und nicht still scheitert.
--
-- Additiv wie 0116 und 0117: eine neue Tabelle, nichts Bestehendes wird angefasst. Eigentümer wie `visitor_metric`.

CREATE TABLE IF NOT EXISTS client_error_diagnosis (
    day       date     NOT NULL,
    signature text     NOT NULL CHECK (signature ~ '^[0-9a-f]{32}$'),
    kind      text     NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
    name      text     NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
    message   text     NOT NULL DEFAULT '' CHECK (length(message) <= 160),
    frames    text[]   NOT NULL DEFAULT '{}' CHECK (cardinality(frames) <= 5),
    release   text     NOT NULL DEFAULT '' CHECK (length(release) <= 64),
    browser   text     NOT NULL DEFAULT '' CHECK (length(browser) <= 20),
    graphics  text     NOT NULL DEFAULT '' CHECK (length(graphics) <= 20),
    count     bigint   NOT NULL DEFAULT 1 CHECK (count >= 1),
    PRIMARY KEY (day, signature)
);

COMMENT ON TABLE client_error_diagnosis IS
    'Bereinigte Diagnosen zu Fehlern im Browser, je Tag und Signatur (WI-0202). Keine IP, keine Kennung, keine Adresse; Frist 14 Tage.';

CREATE INDEX IF NOT EXISTS client_error_diagnosis_day_idx ON client_error_diagnosis (day DESC);
