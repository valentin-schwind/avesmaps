-- Die Nutzung der eigenen Schnittstellen (WI-0138 V12, BESUCH-0001 §13 F; Legacys Schwestertabelle `api_metric`).
--
-- Eine Zeile je Tag, Stunde, Metrik und Ausprägung - nie je Anfrage. Die Ausprägung ist der **Routenname** (`/api/route`,
-- `/api/share/:code`), nie die aufgerufene Adresse: Mit der Adresse wüchse die Tafel mit dem Verkehr statt mit der Zahl der
-- Wege, und Suchbegriffe echter Besucher stünden in einer Betriebstabelle (Legacys Begründung, `api-metrics.php:70-78`).
--
-- Additiv wie 0116: eine neue Tabelle, nichts Bestehendes wird angefasst.
--
-- 💣 `hour` trägt denselben Platzhalter 24 wie `visitor_metric`. Zwei verschiedene Zahlen für dieselbe Aussage wären beim
-- nächsten gemeinsamen Leser eine Falle.

CREATE TABLE IF NOT EXISTS api_metric (
    day       date     NOT NULL,
    hour      smallint NOT NULL DEFAULT 24 CHECK (hour BETWEEN 0 AND 24),
    metric    text     NOT NULL CHECK (metric <> '' AND length(metric) <= 40),
    dimension text     NOT NULL DEFAULT '' CHECK (length(dimension) <= 190),
    count     bigint   NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (day, hour, metric, dimension)
);

COMMENT ON TABLE api_metric IS
    'Anfragen an die eigenen Schnittstellen, als Tagessummen je Routenname (WI-0138). Keine Adressen, keine Nutzlast, keine Schlüssel.';

CREATE INDEX IF NOT EXISTS api_metric_metric_day_idx ON api_metric (metric, day DESC);
