-- Der Verlauf der Serverlast über Tage und Wochen (WI-0141, Betreiber 2026-10-14: „eine wochenübersicht ‚Aktivste
-- Zeiten‘ und ein ‚Verlauf‘ der durchschnittlichen auslastung wäre hilfreich zu sehen, wo die peaks sind“).
--
-- Rein additiv: Das vorige Release schreibt `system_sample` weiter wie bisher und kennt weder die Spalte noch die Tafel.
--
-- 🔴 WARUM EINE ZWEITE TAFEL. `system_sample` hält 5-Minuten-Fächer für 25 h (SYS-8) — 288 Zeilen am Tag. Über 90 Tage
-- wären das 26.000, und für die Frage „wann ist viel los“ braucht niemand die Auflösung von fünf Minuten. Das
-- Stundenmittel sind 2.160 Zeilen und zeigt Tagesgang und Spitzen genauso.
--
-- 🔴 MITTEL UND SPITZE. Ein Mittelwert allein verschweigt genau das, was der Betreiber sehen will: die Spitze. Darum
-- steht beides in der Zeile.

ALTER TABLE system_sample ADD COLUMN IF NOT EXISTS cpu REAL CHECK (cpu IS NULL OR (cpu >= 0 AND cpu <= 1));

COMMENT ON COLUMN system_sample.cpu IS
    'Anteil der Kernzeit des Serverprozesses zwischen zwei Stichproben (0..1); NULL heißt „nicht messbar“, nie 0 (WI-0141).';

CREATE TABLE IF NOT EXISTS system_hour (
    hour            TIMESTAMPTZ PRIMARY KEY,
    proben          INTEGER NOT NULL CHECK (proben > 0),
    cpu             REAL CHECK (cpu IS NULL OR (cpu >= 0 AND cpu <= 1)),
    cpu_max         REAL CHECK (cpu_max IS NULL OR (cpu_max >= 0 AND cpu_max <= 1)),
    load1           DOUBLE PRECISION CHECK (load1 IS NULL OR load1 >= 0),
    load1_max       DOUBLE PRECISION CHECK (load1_max IS NULL OR load1_max >= 0),
    mem_used_bytes  BIGINT CHECK (mem_used_bytes IS NULL OR mem_used_bytes >= 0),
    mem_max_bytes   BIGINT CHECK (mem_max_bytes IS NULL OR mem_max_bytes >= 0),
    mem_total_bytes BIGINT CHECK (mem_total_bytes IS NULL OR mem_total_bytes >= 0)
);

COMMENT ON TABLE system_hour IS
    'Stundenmittel und -spitzen der Serverlast (WI-0141); verdichtet aus system_sample, älter als 90 Tage löscht die Anwendung.';
