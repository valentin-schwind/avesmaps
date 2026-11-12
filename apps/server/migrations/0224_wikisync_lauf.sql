-- 0224: Die Läufe des WikiSync-Abgleichs (WI-0253 C; Work Item §3 Punkt 2 und 6: der Quellenstand ist belegbar, der Plan wird protokolliert).
--
--   Ein Lauf ist eine VORSCHAU: Er liest die Fachtafeln (Orte, Wege, Gebiete, Landschaften, Kraftlinien, Gipfel und ihre Wiki-Schnappschüsse) und den
--   Wiki-Dump und schreibt NUR in diese zwei Tafeln. Was „würde übernommen“ heißt, wendet erst die spätere Übernahme (D) an, mit Passkey und je Bereich.
--   Die Fachtafeln schreibt dieser Lauf nie; ein Test hält einen Hash über sie vor und nach dem Lauf gleich.
--
-- 1. `wikisync_lauf`: ein Lauf, mit dem Stand seiner Quelle gepinnt – Dump (Datei, SHA-256, Stand, Seiten), Revision der Namensraum-Tafel, Version des Lesers –,
--    mit den Bereichen, die er gerechnet hat, und den Zahlen je Bereich (`zahlen`, ein Protokoll, keine Fachdaten). Der Bericht zeigt je Bereich den jüngsten
--    fertigen Lauf; zwei je Bereich bleiben stehen, ältere räumt der nächste Lauf ab.
-- 2. `wikisync_lauf_zeile`: die Planzeilen. Je Zeile ein Feld eines Objekts (oder ein Befund zum Artikel): Objekt, Artikel, Feld, alt, neu, Eigentümer und
--    Wirkung. 🔴 Kein Wikitext: `alt` und `neu` sind bereinigte Werte einzelner Infobox-Felder (höchstens 4.000 Zeichen), nie die Seite.
--
-- Eigentümer, Wirkung, Status und Befund sind feste Wörter (`packages/shared/src/system/wikisync.ts`); die CHECKs halten sie hier fest, damit kein Lauf ein
-- Wort schreibt, das der Bericht nicht kennt. Die Tafeln tragen kein Objekt als Fremdschlüssel: Ein Objekt kann bis zum Lesen verschwunden sein, die
-- Zeile bleibt, was sie war (der Lauf pinnt einen Stand, keine Gegenwart).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): zwei neue Tafeln, die das vorige Release nie liest. Rechte: `apps/server/src/db/system-grants.psql` (hinter JEDE
-- Migration): Die App liest, die Jobs-Rolle schreibt.

CREATE TABLE IF NOT EXISTS wikisync_lauf (
    id BIGSERIAL PRIMARY KEY,
    -- Heute nur die Vorschau; die Übernahme (D) bekommt ihre Art, wenn sie kommt.
    art TEXT NOT NULL DEFAULT 'vorschau' CHECK (art IN ('vorschau')),
    -- Die Bereiche, die dieser Lauf gerechnet hat (`WIKISYNC_BEREICHE`).
    bereiche TEXT[] NOT NULL,
    status TEXT NOT NULL DEFAULT 'laeuft' CHECK (status IN ('laeuft', 'fertig', 'fehlgeschlagen')),
    -- Der Dump, aus dem gerechnet wurde: nur der Dateiname (nie ein Pfad), die Prüfsumme, der Stand des Wikis (Datum oder Zeit; NULL: unbekannt).
    dump_datei TEXT,
    dump_sha256 TEXT,
    dump_stand TEXT,
    dump_seiten INTEGER,
    dump_vollstaendig BOOLEAN,
    -- Die Revision der Namensraum-Tafel der Umgebung (`canon_table_state`); NULL: Es galt die Vorgabe, die Datenbank hatte keine Zeile.
    tafel_revision BIGINT,
    -- Die Fassung der Leser und Regeln, nach denen gerechnet wurde (`WIKISYNC_PARSER_VERSION`).
    parser_version TEXT NOT NULL,
    -- Der Auftrag der Warteschlange (`job.public_id`), ohne Fremdschlüssel.
    job_public_id UUID,
    -- Die Person, die den Lauf ausgelöst hat (`avesmaps_auth.person.id`, ohne Fremdschlüssel ins geschützte Schema) und ihr Name; NULL: Werkzeug.
    ausgeloest_von UUID,
    ausgeloest_label TEXT,
    gestartet_am TIMESTAMPTZ NOT NULL DEFAULT now(),
    beendet_am TIMESTAMPTZ,
    fehler TEXT,
    -- Je Bereich die Zahlen des Laufs (Objekte, mit Adresse, gefunden, umgeleitet, übernommen …): ein Protokoll, nie ein Fachwert.
    zahlen JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT wikisync_lauf_bereiche_bekannt CHECK (
        cardinality(bereiche) >= 1
        AND bereiche <@ ARRAY['ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie']::text[]
    ),
    -- Ein fertiger Lauf hat seine Quelle gepinnt, und der Dump war vollständig (ein abgeschnittener Dump rechnet nichts).
    CONSTRAINT wikisync_lauf_fertig_gepinnt CHECK (
        status <> 'fertig'
        OR (
            dump_datei IS NOT NULL
            AND dump_sha256 ~ '^[0-9a-f]{64}$'
            AND dump_seiten IS NOT NULL
            AND dump_vollstaendig IS TRUE
        )
    ),
    CONSTRAINT wikisync_lauf_dump_datei_ohne_pfad CHECK (dump_datei IS NULL OR dump_datei !~ '[/\\]'),
    CONSTRAINT wikisync_lauf_beendet CHECK ((status = 'laeuft') = (beendet_am IS NULL)),
    CONSTRAINT wikisync_lauf_fehler_nur_bei_fehlschlag CHECK (fehler IS NULL OR status = 'fehlgeschlagen')
);

CREATE INDEX IF NOT EXISTS wikisync_lauf_fertig ON wikisync_lauf (id DESC) WHERE status = 'fertig';

COMMENT ON TABLE wikisync_lauf IS
    'Ein Abgleich der Karte mit dem Wiki-Dump (WI-0253 C): eine Vorschau, die in keine Fachtafel schreibt. Pinnt Dump (Datei, SHA-256, Stand), Tafel-Revision und Leserversion; die Zeilen stehen in wikisync_lauf_zeile.';
COMMENT ON COLUMN wikisync_lauf.zahlen IS
    'Zahlen je Bereich (Objekte, mit Adresse, Kennungen ohne Wiki-Adresse, gefunden, umgeleitet, nicht im Dump, Felder, übernommen, eigen, Befunde, neue Artikel): ein Protokoll des Laufs, keine Fachdaten.';

CREATE TABLE IF NOT EXISTS wikisync_lauf_zeile (
    id BIGSERIAL PRIMARY KEY,
    lauf_id BIGINT NOT NULL REFERENCES wikisync_lauf (id) ON DELETE CASCADE,
    -- Die Reihenfolge im Lauf (der Plan ist sortiert und wiederholbar).
    position INTEGER NOT NULL CHECK (position >= 0),
    bereich TEXT NOT NULL CHECK (bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie')),
    -- Die Art des Objekts auf der Karte; `article` bei einem neuen Artikel, den die Karte noch nicht kennt.
    objekt_art TEXT NOT NULL CHECK (objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'article')),
    -- Die öffentliche Kennung des Objekts (bei einer Gruppe das erste) und sein Name zur Zeit des Laufs; NULL bei einem neuen Artikel.
    objekt_id UUID,
    objekt_name TEXT CHECK (char_length(objekt_name) <= 500),
    -- Wie viele Objekte die Zeile zusammenfasst (die Abschnitte eines Wegs teilen einen Artikel).
    objekte INTEGER NOT NULL DEFAULT 1 CHECK (objekte >= 1),
    artikel TEXT CHECK (char_length(artikel) <= 500),
    namensraum INTEGER,
    -- Der Name des Felds; NULL bei einem Befund zum Artikel oder zur Zuordnung.
    feld TEXT CHECK (feld ~ '^[a-z][a-z0-9_]*$' AND char_length(feld) <= 64),
    -- Der Istwert (was die Karte zeigt) und der Wiki-Wert aus dem Dump, je mit ihrem Zustand: kein (NULL), leer (bewusst leer), text.
    alt TEXT CHECK (char_length(alt) <= 4000),
    alt_zustand TEXT NOT NULL CHECK (alt_zustand IN ('kein', 'leer', 'text')),
    neu TEXT CHECK (char_length(neu) <= 4000),
    neu_zustand TEXT NOT NULL CHECK (neu_zustand IN ('kein', 'leer', 'text')),
    eigentuemer TEXT NOT NULL CHECK (eigentuemer IN ('wiki', 'manual', 'legacy', 'unterdrueckt', 'getrennt', 'unbekannt')),
    wirkung TEXT NOT NULL CHECK (wirkung IN ('uebernommen', 'eigen', 'befund')),
    status TEXT NOT NULL CHECK (status IN ('neu', 'geaendert', 'zu_entfernen', 'unterdrueckt', 'mehrdeutig', 'fehlerhaft')),
    befund TEXT CHECK (
        befund IN (
            'umleitung', 'mehrdeutig', 'infobox_kaputt', 'artikel_nicht_im_dump', 'namensraum_unbekannt', 'neuer_artikel',
            'zuordnung_gesperrt', 'herkunft_widerspruch'
        )
    ),
    -- Eine kurze Angabe zum Befund (Zieltitel einer Umleitung, Grund einer kaputten Infobox); nie Wikitext.
    grund TEXT CHECK (char_length(grund) <= 200),
    CONSTRAINT wikisync_lauf_zeile_position_eindeutig UNIQUE (lauf_id, position),
    -- Ein Artikelbefund ist nie eine Übernahme und nie ein eigener Wert: Eine Zuordnung ändert dieser Abgleich nie.
    CONSTRAINT wikisync_lauf_zeile_befund_ohne_uebernahme CHECK (
        (feld IS NOT NULL AND befund IS NULL)
        OR befund = 'herkunft_widerspruch'
        OR (feld IS NULL AND befund IS NOT NULL AND wirkung = 'befund')
    ),
    -- Wirkung folgt dem Eigentümer (herkunft.ts): nur das Wiki wird übernommen, nur der eigene Wert bleibt eigen.
    CONSTRAINT wikisync_lauf_zeile_wirkung_folgt_eigentuemer CHECK (
        (eigentuemer = 'wiki' AND wirkung IN ('uebernommen', 'befund'))
        OR (eigentuemer = 'manual' AND wirkung IN ('eigen', 'befund'))
        OR (eigentuemer NOT IN ('wiki', 'manual') AND wirkung = 'befund')
    )
);

CREATE INDEX IF NOT EXISTS wikisync_lauf_zeile_filter ON wikisync_lauf_zeile (lauf_id, bereich, wirkung);

COMMENT ON TABLE wikisync_lauf_zeile IS
    'Die Planzeilen eines WikiSync-Laufs (WI-0253 C): Feld, Istwert, Wiki-Wert, Eigentümer und Wirkung – oder ein Befund zum Artikel. Kein Wikitext, kein Fremdschlüssel auf ein Objekt.';
