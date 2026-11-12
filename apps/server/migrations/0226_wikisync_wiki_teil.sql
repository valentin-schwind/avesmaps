-- 0226: WikiSync C-2 – der Wiki-Teil eines Laufs (WI-0253 §4 „Dump und API: zwei Teile eines Laufs“, §10; Vali 2026-10-25: „Dump gelesen, Sync steht aus“).
--
--   Was erst eine VORLAGE im Wiki setzt – die Ortsgröße (`settlement_class`), die Bauwerkart (`building_type`) und der Kontinent (`continent`) – steht nicht im Dump-Text. Dafür gibt es
--   Kategorie-Abfragen über die MediaWiki-API, langsam (20 Sekunden Abstand zwischen zwei Anfragen, IP-weit) und deshalb fortsetzbar: Ein Auftrag (`wiki_kategorien`) macht einen kleinen
--   Schritt mit Cursor, legt ihn ab und reiht sich neu ein, bis der Bereich fertig ist. Hier liegt, was dafür bleiben muss.
--
-- 1. `wikisync_wiki_teil`: der Lauf des Wiki-Teils. Er hängt an einer Vorschau (`wikisync_lauf`, Teil 1 aus dem Dump) und PINNT deren Dump (Datei, SHA-256, Stand, Seiten) und die Revision der
--    Namensraum-Tafel; fällt die Vorschau (ältere Läufe räumen sich ab), fällt er mit ihr. `kette` zählt die Aufträge einer Reihe: Ein Nachfolger, dessen Nummer nicht mehr stimmt, ist von
--    einer neueren Reihe überholt und tut nichts (ein doppelt gestarteter oder nach einem Absturz wiederholter Auftrag macht keinen zweiten Strang auf).
-- 2. `wikisync_wiki_teil_bereich`: je Bereich (Orte, Gebiete, Landschaften), ob sein Wiki-Teil fertig ist, die Zahl der angehängten Planzeilen und deren Zahlen. `fertig` ist, was die Übernahme
--    (D-1, `wiki-teil.ts`) fragt. `abgeloest`: Ein späterer Wiki-Teil derselben Vorschau hat seine Zeilen ersetzt.
-- 3. `wikisync_abfrage_stand`: je Lauf, Bereich und Abfrageform (Ortsgröße, Bauwerkart, Kontinent) der Cursor – bei Kategorien ZWEI Teile (Kategorie und Stelle darin), beim Kontinent ein
--    Titel-Versatz –, die Zähler, „Schritt n von m“ und die geschätzte Restzeit, die Pause (403, 429, Unterbrecher) und der letzte Fehler. Eine Revision hält zwei Schreiber auseinander.
-- 4. `wikisync_abfrage_wert`: was die Abfragen lieferten (Titel → Klasse, Art, Kontinent). Der ERSTE Schreiber gewinnt (Legacy: `isset($map[$normTitle])`), auch über Schritte hinweg. Beim
--    Kontinent steht die feste Titelliste schon da (Wert leer, `gelesen` falsch) und füllt sich: Der Versatz zeigt immer in dieselbe Liste.
--
--   Kein Wikitext, kein Geheimnis: Die Tafeln tragen Titel von Artikeln, Namen von Kategorien und Wörter der Klassen. Weder Benutzername noch Passwort noch Cookie gehen je hinein.
--
-- 5. `job_enqueue` lernt `wiki_kategorien`: Der Auftrag reiht seinen Nachfolger selbst ein (Jobs-Rolle), und die Steuerung (D-2) den ersten (App-Rolle, SECURITY DEFINER).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): vier neue Tafeln, die das vorige Release nie liest; `job_enqueue` von ihrer geltenden Fassung (0225) abgeschrieben und um eine Art erweitert, die
-- Argumentliste bleibt. Keine Datenänderung an einer Fachtafel. Rechte: `apps/server/src/db/system-grants.psql` (hinter JEDE Migration): Die App liest, die Jobs-Rolle schreibt.

CREATE TABLE IF NOT EXISTS wikisync_wiki_teil (
    id BIGSERIAL PRIMARY KEY,
    -- Die Vorschau (Teil 1), an die sich der Wiki-Teil hängt; mit ihr fällt er.
    vorschau_lauf_id BIGINT NOT NULL REFERENCES wikisync_lauf (id) ON DELETE CASCADE,
    bereiche TEXT[] NOT NULL,
    status TEXT NOT NULL DEFAULT 'laeuft' CHECK (status IN ('laeuft', 'fertig', 'fehlgeschlagen')),
    -- Der Dump, auf dem die Vorschau stand (nur der Dateiname, nie ein Pfad): Teil 1 und Teil 2 gehören zusammen.
    dump_datei TEXT,
    dump_sha256 TEXT,
    dump_stand TEXT,
    dump_seiten INTEGER,
    tafel_revision BIGINT,
    parser_version TEXT NOT NULL,
    -- Die Nummer der Reihe: Jeder Auftrag trägt sie, ein Nachfolger mit einer anderen ist überholt.
    kette INTEGER NOT NULL DEFAULT 0 CHECK (kette >= 0),
    job_public_id UUID,
    ausgeloest_von UUID,
    ausgeloest_label TEXT,
    gestartet_am TIMESTAMPTZ NOT NULL DEFAULT now(),
    aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT now(),
    beendet_am TIMESTAMPTZ,
    -- Bei `fehlgeschlagen`: ein fester Code und ein Satz; nie ein Geheimnis.
    fehler_code TEXT CHECK (char_length(fehler_code) <= 64),
    fehler TEXT CHECK (char_length(fehler) <= 500),
    CONSTRAINT wikisync_wiki_teil_bereiche_bekannt CHECK (
        cardinality(bereiche) >= 1 AND bereiche <@ ARRAY['ort', 'gebiet', 'region']::text[]
    ),
    CONSTRAINT wikisync_wiki_teil_beendet CHECK ((status = 'laeuft') = (beendet_am IS NULL)),
    CONSTRAINT wikisync_wiki_teil_fehler_nur_bei_fehlschlag CHECK (fehler IS NULL OR status = 'fehlgeschlagen'),
    CONSTRAINT wikisync_wiki_teil_dump_datei_ohne_pfad CHECK (dump_datei IS NULL OR dump_datei !~ '[/\\]')
);

CREATE INDEX IF NOT EXISTS wikisync_wiki_teil_vorschau ON wikisync_wiki_teil (vorschau_lauf_id, id DESC);

COMMENT ON TABLE wikisync_wiki_teil IS
    'Der Wiki-Teil eines WikiSync-Laufs (WI-0253 C-2): Kategorie-Abfragen über die MediaWiki-API je Bereich, fortsetzbar. Hängt an einer Vorschau und pinnt deren Dump und Tafel-Revision.';
COMMENT ON COLUMN wikisync_wiki_teil.kette IS
    'Nummer der Auftragsreihe: Ein Nachfolger, dessen Nummer nicht mehr stimmt, ist überholt und tut nichts.';

CREATE TABLE IF NOT EXISTS wikisync_wiki_teil_bereich (
    lauf_id BIGINT NOT NULL REFERENCES wikisync_wiki_teil (id) ON DELETE CASCADE,
    bereich TEXT NOT NULL CHECK (bereich IN ('ort', 'gebiet', 'region')),
    -- Die Reihenfolge im Lauf: ein Bereich nach dem anderen.
    position SMALLINT NOT NULL CHECK (position >= 0),
    status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'fertig', 'abgeloest')),
    -- Wie viele Planzeilen der Wiki-Teil an die Vorschau gehängt hat, und die Zahlen dazu (felderGelesen, unveraendert, uebernommen, eigen, befunde): ein Protokoll, nie ein Fachwert.
    zeilen INTEGER NOT NULL DEFAULT 0 CHECK (zeilen >= 0),
    zahlen JSONB NOT NULL DEFAULT '{}'::jsonb,
    beendet_am TIMESTAMPTZ,
    PRIMARY KEY (lauf_id, bereich),
    CONSTRAINT wikisync_wiki_teil_bereich_beendet CHECK ((status = 'offen') = (beendet_am IS NULL))
);

COMMENT ON TABLE wikisync_wiki_teil_bereich IS
    'Je Bereich, ob sein Wiki-Teil fertig ist (WI-0253 C-2): Erst dann ist die Übernahme erlaubt („Dump gelesen, Sync steht aus“). fertig = die Planzeilen sind an die Vorschau gehängt.';

CREATE TABLE IF NOT EXISTS wikisync_abfrage_stand (
    lauf_id BIGINT NOT NULL,
    bereich TEXT NOT NULL CHECK (bereich IN ('ort', 'gebiet', 'region')),
    -- ortsgroesse: categorymembers der fünf Siedlungsgrößen. bauwerkart: Unterkategorien, dann Mitglieder. kontinent: prop=categories über Titel.
    form TEXT NOT NULL CHECK (form IN ('ortsgroesse', 'bauwerkart', 'kontinent')),
    position SMALLINT NOT NULL CHECK (position >= 0),
    status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'laeuft', 'pausiert', 'fertig')),
    -- Nur die Bauwerkart hat Stufen: erst die Arten (Unterkategorien), dann die Mitglieder jeder Art.
    stufe TEXT CHECK (stufe IS NULL OR stufe IN ('arten', 'mitglieder')),
    -- Der Cursor: die Kategorie (Ortsgröße, Mitglieder der Bauwerkart) beziehungsweise der Titel-Versatz (Kontinent) – und bei Kategorien die Stelle darin (das cmcontinue der API).
    cursor_index INTEGER NOT NULL DEFAULT 0 CHECK (cursor_index >= 0),
    cursor_weiter TEXT CHECK (char_length(cursor_weiter) <= 1000),
    -- Die Bauwerksarten: in der Stufe „arten“ der rohe Zwischenstand, in „mitglieder“ die fertige Liste, auf die der Cursor zeigt.
    arten TEXT[] NOT NULL DEFAULT '{}',
    -- „Schritt n von m“: n Anfragen sind gestellt; m ist die Schätzung (NULL: noch unbekannt – unbekannt ist nicht null).
    schritte INTEGER NOT NULL DEFAULT 0 CHECK (schritte >= 0),
    schritte_gesamt INTEGER CHECK (schritte_gesamt IS NULL OR schritte_gesamt >= 0),
    -- Anfragen, gelesene Titel, Werte, Fortsetzungen, Neustarts, Stapelgröße: ein Protokoll, nie ein Fachwert.
    zaehler JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Die geschätzte Restzeit in Sekunden (Rest der Schritte mal der Takt); NULL, wenn m unbekannt ist.
    rest_sekunden INTEGER CHECK (rest_sekunden IS NULL OR rest_sekunden >= 0),
    -- Eine Pause (403, 429, Unterbrecher): bis wann und warum; und der letzte Fehler dieses Strangs.
    pausiert_bis TIMESTAMPTZ,
    pause_grund TEXT CHECK (char_length(pause_grund) <= 64),
    fehlversuche INTEGER NOT NULL DEFAULT 0 CHECK (fehlversuche >= 0),
    pausen INTEGER NOT NULL DEFAULT 0 CHECK (pausen >= 0),
    fehler_code TEXT CHECK (char_length(fehler_code) <= 64),
    fehler TEXT CHECK (char_length(fehler) <= 500),
    -- Zählt mit jedem Speichern: Wer mit einem älteren Stand schreibt, wird abgewiesen, ohne zu überschreiben.
    revision INTEGER NOT NULL DEFAULT 0,
    gestartet_am TIMESTAMPTZ,
    aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lauf_id, bereich, form),
    FOREIGN KEY (lauf_id, bereich) REFERENCES wikisync_wiki_teil_bereich (lauf_id, bereich) ON DELETE CASCADE,
    CONSTRAINT wikisync_abfrage_stand_form_zum_bereich CHECK (
        (bereich = 'ort' AND form IN ('ortsgroesse', 'bauwerkart')) OR (bereich IN ('gebiet', 'region') AND form = 'kontinent')
    ),
    CONSTRAINT wikisync_abfrage_stand_stufe_nur_bauwerkart CHECK (stufe IS NULL OR form = 'bauwerkart')
);

COMMENT ON TABLE wikisync_abfrage_stand IS
    'Der Cursor je Lauf, Bereich und Abfrageform des Wiki-Teils (WI-0253 C-2): Kategorie und Stelle darin (oder Titel-Versatz), Zähler, Schritt n von m, Restzeit, Pause, letzter Fehler. Ein Neustart fragt nichts doppelt.';
COMMENT ON COLUMN wikisync_abfrage_stand.schritte_gesamt IS
    'Die Schätzung der Anfragen insgesamt; NULL: noch unbekannt (die Arten der Bauwerksliste sind erst nach der ersten Stufe bekannt).';

CREATE TABLE IF NOT EXISTS wikisync_abfrage_wert (
    lauf_id BIGINT NOT NULL,
    bereich TEXT NOT NULL,
    form TEXT NOT NULL,
    -- Der Titel des Artikels, wie Legacy ihn führt (Unterstriche zu Leerzeichen, ohne Sprungmarke).
    titel TEXT NOT NULL CHECK (char_length(titel) BETWEEN 1 AND 500),
    -- Die Klasse (dorf …), die Art (Steinkreis …) oder der Kontinent (Aventurien …); beim Kontinent NULL, bis der Stapel gelesen ist oder wenn die Seite fehlt.
    wert TEXT CHECK (wert IS NULL OR char_length(wert) BETWEEN 1 AND 200),
    -- Kontinent: die Stelle in der festen Titelliste. Sonst 0.
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    gelesen BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (lauf_id, bereich, form, titel),
    FOREIGN KEY (lauf_id, bereich, form) REFERENCES wikisync_abfrage_stand (lauf_id, bereich, form) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS wikisync_abfrage_wert_liste ON wikisync_abfrage_wert (lauf_id, bereich, form, position);

COMMENT ON TABLE wikisync_abfrage_wert IS
    'Was die Kategorie-Abfragen lieferten (WI-0253 C-2): Titel → Klasse, Bauwerkart oder Kontinent. Der erste Schreiber gewinnt. Beim Kontinent steht die feste Titelliste schon da.';

-- 5. DIE ART IN DER WARTESCHLANGE -----------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION job_enqueue(
    p_kind TEXT,
    p_kind_version SMALLINT,
    p_map_domain_id TEXT,
    p_actor_ref TEXT,
    p_input_ref JSONB,
    p_priority SMALLINT DEFAULT 50,
    p_not_before TIMESTAMPTZ DEFAULT NULL,
    p_scope_kind TEXT DEFAULT 'domain',
    p_scope_tiles SMALLINT[] DEFAULT '{}',
    p_depends_on BIGINT[] DEFAULT '{}'
) RETURNS TABLE (id BIGINT, public_id UUID)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN (
        'terrain_local', 'dem_publish', 'display_heights', 'routing_reload', 'media_settle', 'legacy_pull', 'legacy_media',
        'terrain_preview', 'path_profile', 'media_quarantine', 'kanal_bild', 'legacy_zug', 'production_pull',
        'land_smooth', 'label_runs', 'territory_derive', 'media_merge_all', 'path_label_runs', 'sea_derive',
        'map_series_tile', 'map_series_production', 'abzug_lokal',
        'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen', 'wiki_kategorien'
    ) THEN
        RAISE EXCEPTION 'job_enqueue: Jobart % darf die Anwendung nicht einreihen', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '42501';
    END IF;
    -- Ein Zug einer Kategorie nennt genau eine der drei. Herrschaftsgebiete gibt es hier nicht und nie (Betreiber 2026-10-13):
    -- Die Sperre steht in der Datenbank, nicht nur im Werkzeug, damit kein Aufrufer sie umgehen kann.
    IF p_kind = 'legacy_zug' AND COALESCE(p_input_ref->>'kategorie', '') NOT IN ('landschaften', 'wege', 'orte') THEN
        RAISE EXCEPTION 'job_enqueue: legacy_zug braucht die Kategorie landschaften, wege oder orte (nicht %)',
            COALESCE(p_input_ref->>'kategorie', '(leer)') USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT i.id, i.public_id FROM job_insert(
        p_kind, p_kind_version, p_map_domain_id, 'queued', p_actor_ref, NULL, NULL, p_input_ref, p_priority,
        p_not_before, p_scope_kind, p_scope_tiles, p_depends_on
    ) i;
END;
$$;

COMMENT ON FUNCTION job_enqueue IS
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';
