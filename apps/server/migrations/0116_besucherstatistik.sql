-- Anonyme Besucherstatistik (WI-0138, BESUCH-0001 §5; Betreiber 2026-10-12: „die anonyme statistik soll beibehalten werden …
-- wir wollen keine individuellen ip loggen“).
--
-- Vier neue Tabellen, additiv: nichts Bestehendes wird angefasst, das vorige Release kennt sie nicht und stört sich nicht an ihnen.
--
-- 🔴 WAS HIER NICHT STEHT, IST DER PUNKT: keine IP-Spalte, keine Sitzung, keine Kennung einer Person, keine Zeile je Besuch.
-- Gespeichert werden Summen (`visitor_metric`) und zwei kurzlebige Hilfstafeln. Die IP wird im Zählpfad gelesen (Geo-Treffer,
-- Tageskennung) und nie abgelegt.
--
-- 💣 `hour` trägt den Platzhalter 24 für „keine Stunde“ und ist NOT NULL. In Legacy war die Spalte NULL-fähig, und weil zwei NULL
-- im UNIQUE-Schlüssel als verschieden gelten, legte dort vom 28.06. bis 25.08.2026 jedes Ereignis eine NEUE Zeile mit count = 1 an:
-- 449.715 Zeilen und 68,7 MB für 107 Tage (gemessen im Abzug vom 2026-10-12). Dieselbe Falle hat Postgres mit ON CONFLICT.
--
-- Legacys Vorlage: `api/_internal/analytics/visitor-analytics.php:62-88`, `:472-527`, `:789-842` (Mirror `cfbbe69c8`).

CREATE TABLE IF NOT EXISTS visitor_metric (
    day         date     NOT NULL,
    hour        smallint NOT NULL DEFAULT 24 CHECK (hour BETWEEN 0 AND 24),
    actor_type  text     NOT NULL CHECK (actor_type IN ('visitor', 'editor', 'bot')),
    metric      text     NOT NULL CHECK (metric <> '' AND length(metric) <= 40),
    dimension   text     NOT NULL DEFAULT '' CHECK (length(dimension) <= 190),
    count       bigint   NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (day, hour, actor_type, metric, dimension)
);

COMMENT ON TABLE visitor_metric IS
    'Anonyme Tagessummen der Nutzung (WI-0138). Eine Zeile je Tag, Stunde, Sorte, Metrik und Ausprägung; nie je Besuch. hour = 24 heißt „keine Stunde“.';

CREATE INDEX IF NOT EXISTS visitor_metric_metric_day_idx ON visitor_metric (metric, day DESC);

-- Wer heute schon gezählt wurde. Die Kennung ist ein HMAC über UTC-Datum, IP und User-Agent mit einem Schlüssel aus der Umgebung
-- (VISITOR_SALT); gespeichert sind 16 Byte. 🔴 Alles vor heute wird gelöscht, die Kennung ist danach wertlos.
CREATE TABLE IF NOT EXISTS visitor_daily_seen (
    day          date  NOT NULL,
    visitor_hash bytea NOT NULL CHECK (octet_length(visitor_hash) = 16),
    PRIMARY KEY (day, visitor_hash)
);

COMMENT ON TABLE visitor_daily_seen IS
    'Tageskennungen, damit ein Gerät am selben Tag einmal zählt (WI-0138). Verfällt um Mitternacht; danach ist nichts mehr zuzuordnen.';

-- Wer gerade da ist, und woraus die Verweildauer entsteht. Hält höchstens Minuten.
CREATE TABLE IF NOT EXISTS visitor_live (
    visitor_hash bytea       PRIMARY KEY CHECK (octet_length(visitor_hash) = 16),
    actor_type   text        NOT NULL CHECK (actor_type IN ('visitor', 'editor')),
    state        text        NOT NULL CHECK (state IN ('active', 'reading', 'hidden')),
    first_seen   timestamptz NOT NULL DEFAULT now(),
    last_seen    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE visitor_live IS
    'Anwesenheit im Fenster von Minuten (WI-0138); daraus entsteht beim Aufräumen die Verweildauer als Korb in visitor_metric.';

CREATE INDEX IF NOT EXISTS visitor_live_last_seen_idx ON visitor_live (last_seen);

-- Das Nachschlagewerk für „woher“: Netz → Land, bei Deutschland zusätzlich das Bundesland. Ohne Personenbezug; die Zeilen kommen
-- aus einem öffentlichen Datensatz (DB-IP lite, CC BY 4.0) und werden von einem Werkzeug eingespielt, nicht von der Anwendung.
CREATE TABLE IF NOT EXISTS visitor_geo_range (
    netz    cidr    PRIMARY KEY,
    country char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
    region  text    NOT NULL DEFAULT '' CHECK (length(region) <= 80)
);

COMMENT ON TABLE visitor_geo_range IS
    'Netzbereiche für den Geo-Treffer (WI-0138). Nachschlagewerk ohne Personenbezug; der Treffer liefert Land und, für DE, das Bundesland.';

CREATE INDEX IF NOT EXISTS visitor_geo_range_netz_idx ON visitor_geo_range USING gist (netz inet_ops);
