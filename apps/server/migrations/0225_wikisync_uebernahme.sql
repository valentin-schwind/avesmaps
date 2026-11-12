-- 0225: WikiSync D-1 – der Bereichsschalter je Umgebung, die Übernahme und die Rücknahme (WI-0253 §4 D, §8; Vali 2026-10-25).
--
-- 1. `wikisync_bereich_setting` und `wikisync_bereich_state`: Welche Bereiche (Orte, Wege, Gebiete, Landschaften, Gipfel, Kraftlinien) dem WikiSync gehören
--    und nicht mehr dem Legacy-Zug. Je Umgebung in ihrer eigenen Datenbank (Vorbild Zoombänder, 0168): Die Vorgabe ist KEIN Bereich, eine Zeile heißt „gehört
--    dem WikiSync“, „zurück an den Legacy-Zug“ löscht sie. Eine Revision für `baseRevision`/409 hebt der Trigger je Anweisung. Umschalten darf nur die
--    Betreiber-Vorlage mit Passkey (`switch_wikisync_area`); der Legacy-Zug lässt einen umgeschalteten Bereich aus (`wiki/abgleich/schalter.ts`).
-- 2. `wikisync_uebernahme` und `wikisync_uebernahme_befund`: das Protokoll der Übernahme und der Rücknahme, je Bereich und Lauf. Eine Zeile je Bereich: der Lauf
--    der Vorschau, aus dem übernommen wurde (ohne Fremdschlüssel: die Läufe räumen sich ab), der gepinnte Dump, der Auftrag, die Operation an der Karte
--    (`map_operation`, aus deren `changes` die Rücknahme liest) und die Zahlen. Die Befunde sind die Felder, die NICHT geschrieben wurden, mit dem Grund. Beide
--    schreibt allein die Jobs-Rolle; die App liest (`apps/server/src/db/system-grants.psql`).
-- 3. `map_operation.source` lernt `wikisync`: Eine Übernahme ist eine Operation an der Karte wie ein Speichern im Editor (Kennung, Hash, Quittung, Akteur, Fachprotokoll
--    je Gegenstand, Folge `seq` für die Leser-Revision und die Kachelrevision), aber nicht aus dem Editor. Der CHECK wird nur GEWEITET.
-- 4. `wikisync_lauf_zeile.objekt_ids`: Die Planzeile nennt die Objekte, die sie zusammenfasst.
-- 5. `job_enqueue` lernt `wiki_vorschau`, `wiki_uebernehmen` und `wiki_zuruecknehmen`: Die Routen der Steuerung reihen sie ein (App-Rolle, SECURITY DEFINER).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): vier neue Tafeln; ein CHECK, der um ein Wort wächst; `job_enqueue` von ihrer geltenden Fassung (0218) abgeschrieben und
-- um drei Arten erweitert, die Argumentliste bleibt. Das vorige Release liest keine der neuen Tafeln, kennt das Wort `wikisync` nicht und reiht die Arten nie ein.
-- Keine Datenänderung an einer Fachtafel. Rechte: `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

-- 1. DER SCHALTER ------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wikisync_bereich_setting (
    bereich TEXT PRIMARY KEY CHECK (bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie')),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    changed_by UUID,
    changed_by_label TEXT
);
COMMENT ON TABLE wikisync_bereich_setting IS
    'Welche Bereiche in dieser Umgebung dem WikiSync gehören (WI-0253 D-1). Keine Zeile: der Bereich gehört dem Legacy-Zug (die Vorgabe). Eine Zeile: Der Legacy-Zug lässt ihn aus.';

CREATE TABLE IF NOT EXISTS wikisync_bereich_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE wikisync_bereich_state IS
    'Revision des Bereichsschalters (WI-0253 D-1): Grundlage für baseRevision; steigt mit jeder Anweisung an wikisync_bereich_setting.';

INSERT INTO wikisync_bereich_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.wikisync_bereich_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO wikisync_bereich_state (id, revision, updated_at) VALUES (1, 2, now())
    ON CONFLICT (id) DO UPDATE SET revision = wikisync_bereich_state.revision + 1, updated_at = now();
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.wikisync_bereich_bump() IS
    'WI-0253 D-1: hebt wikisync_bereich_state.revision je Anweisung an wikisync_bereich_setting.';

CREATE OR REPLACE TRIGGER wikisync_bereich_setting_bump AFTER INSERT OR UPDATE OR DELETE ON wikisync_bereich_setting
    FOR EACH STATEMENT EXECUTE FUNCTION public.wikisync_bereich_bump();

-- 2. DAS PROTOKOLL DER ÜBERNAHME ---------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wikisync_uebernahme (
    id BIGSERIAL PRIMARY KEY,
    art TEXT NOT NULL CHECK (art IN ('uebernahme', 'zuruecknahme')),
    bereich TEXT NOT NULL CHECK (bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie')),
    -- Der Lauf der Vorschau, aus dessen Zeilen übernommen wurde (bei einer Rücknahme: der Lauf der Übernahme). Ohne Fremdschlüssel: Läufe räumen sich ab.
    lauf_id BIGINT NOT NULL,
    -- Nur bei einer Rücknahme: die Übernahme, die sie zurücknimmt.
    zurueck_von BIGINT REFERENCES wikisync_uebernahme (id),
    status TEXT NOT NULL DEFAULT 'laeuft' CHECK (status IN ('laeuft', 'fertig', 'fehlgeschlagen', 'abgebrochen', 'abgelehnt')),
    -- Der Dump des Laufs, aus dem übernommen wurde (nur der Dateiname, nie ein Pfad).
    dump_datei TEXT,
    dump_sha256 TEXT,
    dump_stand TEXT,
    job_public_id UUID,
    -- Die Operation an der Karte (`map_operation.operation_id`), ohne Fremdschlüssel; NULL: Es wurde nichts geschrieben.
    operation_id UUID,
    ausgeloest_von UUID,
    ausgeloest_label TEXT,
    gestartet_am TIMESTAMPTZ NOT NULL DEFAULT now(),
    beendet_am TIMESTAMPTZ,
    -- Bei `fehlgeschlagen` die Fehlermeldung, bei `abgelehnt` und `abgebrochen` der Grund (ein Wort aus `WIKISYNC_ABLEHNUNGEN` oder ein Satz).
    grund TEXT CHECK (char_length(grund) <= 500),
    -- Die Zahlen des Laufs (Zeilen gelesen, Felder geschrieben, schon gleich, Befunde, Objekte): ein Protokoll, nie ein Fachwert.
    zahlen JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Wann eine Rücknahme diese Übernahme zurückgenommen hat und welche.
    zurueckgenommen_am TIMESTAMPTZ,
    zurueckgenommen_durch BIGINT REFERENCES wikisync_uebernahme (id),
    CONSTRAINT wikisync_uebernahme_beendet CHECK ((status = 'laeuft') = (beendet_am IS NULL)),
    CONSTRAINT wikisync_uebernahme_zurueck_nur_bei_ruecknahme CHECK ((art = 'zuruecknahme') = (zurueck_von IS NOT NULL)),
    CONSTRAINT wikisync_uebernahme_dump_datei_ohne_pfad CHECK (dump_datei IS NULL OR dump_datei !~ '[/\\]'),
    CONSTRAINT wikisync_uebernahme_zurueck_gemeinsam CHECK ((zurueckgenommen_am IS NULL) = (zurueckgenommen_durch IS NULL))
);

CREATE INDEX IF NOT EXISTS wikisync_uebernahme_bereich ON wikisync_uebernahme (bereich, id DESC);
CREATE INDEX IF NOT EXISTS wikisync_uebernahme_lauf ON wikisync_uebernahme (lauf_id, bereich, id DESC);

COMMENT ON TABLE wikisync_uebernahme IS
    'Das Protokoll einer Übernahme oder Rücknahme je Bereich und Lauf (WI-0253 D-1): Lauf der Vorschau, gepinnter Dump, Auftrag, Operation an der Karte, Zahlen. Die Rücknahme liest die Änderungen aus map_audit_event der Operation.';

CREATE TABLE IF NOT EXISTS wikisync_uebernahme_befund (
    id BIGSERIAL PRIMARY KEY,
    uebernahme_id BIGINT NOT NULL REFERENCES wikisync_uebernahme (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    -- Die Art des Objekts auf der Karte und seine öffentliche Kennung; Name zur Zeit des Laufs.
    objekt_art TEXT NOT NULL CHECK (objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak')),
    objekt_id UUID,
    objekt_name TEXT CHECK (char_length(objekt_name) <= 500),
    feld TEXT CHECK (feld ~ '^[a-z][a-z0-9_]*$' AND char_length(feld) <= 64),
    befund TEXT NOT NULL CHECK (
        befund IN (
            'seit_vorschau_geaendert', 'kein_schnappschuss', 'name_leer', 'name_vergeben', 'linie_unvollstaendig', 'wert_gekuerzt',
            'seit_uebernahme_geaendert'
        )
    ),
    -- Eine kurze Angabe (der Istwert, den die Vorschau nicht sah, ist KEIN Wikitext, aber auch kein Wert: nur ein Satz).
    grund TEXT CHECK (char_length(grund) <= 200),
    CONSTRAINT wikisync_uebernahme_befund_position_eindeutig UNIQUE (uebernahme_id, position)
);

COMMENT ON TABLE wikisync_uebernahme_befund IS
    'Die Felder, die eine Übernahme oder Rücknahme NICHT geschrieben hat, mit dem Grund (WI-0253 D-1): seit der Vorschau geändert, kein Wiki-Stand, Name nicht erlaubt. Höchstens 1.000 Zeilen je Lauf; die Zahl steht in wikisync_uebernahme.zahlen.';

-- 3. DIE QUELLE `wikisync` -----------------------------------------------------------------------------------------------------------

ALTER TABLE map_operation
    DROP CONSTRAINT IF EXISTS map_operation_source_known,
    ADD CONSTRAINT map_operation_source_known CHECK (source IN ('editor', 'import', 'restore', 'testwelt_reset', 'wikisync'));

-- 4. DIE KENNUNGEN DER PLANZEILEN -----------------------------------------------------------------------------------------------

-- Eine Planzeile fasst mehrere Objekte zusammen (die Abschnitte eines Wegs oder einer Kraftlinie teilen einen Artikel) und nannte bisher nur ihre Zahl und einen
-- Vertreter. Die Übernahme schreibt an GENAU diesen Objekten, also nennt die Zeile sie. Ein Lauf von vor dieser Migration trägt `{}`: Für eine Zeile mit mehr als einem
-- Objekt ist er keine Grundlage mehr (`laufOhneKennungen`), die Vorschau muss neu rechnen.
ALTER TABLE wikisync_lauf_zeile ADD COLUMN IF NOT EXISTS objekt_ids UUID[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN wikisync_lauf_zeile.objekt_ids IS
    'Die öffentlichen Kennungen aller Objekte, die die Zeile zusammenfasst (WI-0253 D-1); leer bei einem neuen Artikel und in Läufen von vor 0225.';

-- 5. DIE ARTEN IN DER WARTESCHLANGE ---------------------------------------------------------------------------------------------

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
        'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen'
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
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';
