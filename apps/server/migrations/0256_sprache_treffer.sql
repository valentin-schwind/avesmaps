-- 0256: Die Treffer der Sprachen als abgeleiteter Zwischenspeicher (WI-0261 S4; O4; Claudios Einschätzung zur Last
-- `project-control/handovers/2026-10-30-wi0261-sprachen-antwort-an-claudia.md` §3).
--
--   1. `sprache_treffer`: je Objekt (Ort, Herrschaftsgebiet, Region, Weg) und Sprache, die es berührt, eine Zeile mit dem Anteil. Ein Ort zählt
--      per Punkt in Fläche (Anteil 1), eine Fläche mit ihrem Anteil an der eigenen Fläche, ein Weg mit seinem Anteil an der eigenen Länge. Die
--      Sprachflächen einer Sprache werden vorher vereinigt, damit sich überlappende Teilflächen derselben Sprache nicht doppelt zählen.
--      🔴 ABGELEITET, KEIN FACHBESTAND: Geschrieben nur vom Auftrag `sprache_treffer` (Jobs-Rolle, `apps/server/src/jobs/sprachen-treffer-job.ts`),
--      der je Lauf die Treffer seines Umfangs löscht und neu bestimmt; die App liest nur. Die Revision einer Sprache, eines Orts oder einer Fläche
--      ändert sich dadurch nie.
--      🔴 ALLE Berührungen mit Anteil > 0 stehen hier, nicht nur die über dem Startwert `sprachenMindestanteil` (Systemsteuerung, Panel
--      „Sprachen“, 5 %). Die Schwelle wirkt erst beim LESEN (`apps/server/src/sprachen/treffer.ts`). Bewusste Abweichung vom Text des WI und von
--      Claudios §3 („voller Neulauf nach Änderung von `sprachenMindestanteil`“): So rechnet eine Änderung des Startwerts nichts neu, und 0 %
--      („jede Berührung“) braucht keinen eigenen Lauf. Der Preis ist eine längere Tafel (jede Randberührung steht darin), gelesen wird sie nur
--      je Objekt oder je Sprache über die Indizes.
--      Anteile stehen auf sechs Stellen gerundet; was danach 0 ist, gilt als Rechenrauschen an einer gemeinsamen Kante und fehlt.
--   2. `job_enqueue` lernt die Jobart `sprache_treffer` (🪤 0239: eine Art im Katalog, die die Anwendung nicht einreihen darf, endet beim ersten
--      Speichern in 42501).
--   3. `sprache_treffer_sammeln`: der wartende Auftrag der Domäne nimmt jeden weiteren Anlass mit (Muster `job_sammeln`, 0203, und
--      `terrain_local_enqueue`, 0202). Anders als `job_sammeln` VEREINIGT es den Umfang: `{"alle": true}`, oder Sprachen
--      (`sprachen`, Kennungen `sprache.public_id`) und Objekte je Art (`objekte`, Kennungen `public_id`). Ein Lauf über alles schluckt jeden
--      kleineren; mehr als 200 Objekte werden ein Lauf über alles (der volle Lauf kostet lokal Sekunden, eine Liste von Tausenden Kennungen
--      gehört nicht in `input_ref`). Gleitend wie dort: jede weitere Speicherung schiebt den Start auf jetzt + Ruhe, höchstens auf die
--      Obergrenze ab der ersten. Ein laufender Auftrag nimmt nichts mehr auf; was währenddessen gespeichert wird, sammelt der nächste.
--
-- Bereich: `tiles` ohne Kacheln (kein Kartenfußabdruck, wie `territory_derive`): Der Auftrag schneidet kein Gelände im Umkreis. Gegen Zug und
-- Import hält die geteilte Domänensperre (`holdsSharedDomainLock`), gegen sich selbst `maxConcurrent` 1 und eine Sperre je Domäne im Auftrag.
--
-- 🔴 REIN ADDITIV („erst erweitern“): eine neue Tafel, eine neue Funktion; `job_enqueue` ist von ihrer GELTENDEN Fassung (0246) abgeschrieben und
-- nur um die eine Art erweitert, die Signatur bleibt. Das vorige Release kennt die Art nicht, reiht sie nie ein und liest die Tafel nie;
-- `CREATE OR REPLACE` behält Eigentümer und Rechte. Wer `job_enqueue` danach neu schreibt, nimmt `sprache_treffer` mit.
--
-- Rechte: In public gibt die Default-Privilegie der Migrationsrolle der App-Rolle SELECT, INSERT, UPDATE, DELETE an der Tafel und EXECUTE an der
-- Funktion; `apps/server/src/db/system-grants.psql` nimmt der App an der Tafel alles außer SELECT, gibt der Jobs-Rolle INSERT und DELETE (bewusste
-- Ausnahme von „nie DELETE“ wie `lore_place_target`: abgeleiteter Zwischenspeicher) und EXECUTE an `sprache_treffer_sammeln` (eine Übernahme des
-- WikiSync ist eine Operation an der Karte und reiht als Jobs-Rolle ein). Die Einordnung steht in `apps/server/test/support/public-rechte.ts`.

-- 1. TREFFER ----------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sprache_treffer (
    objekt_art TEXT NOT NULL,
    objekt_public_id UUID NOT NULL,
    sprache_id BIGINT NOT NULL REFERENCES sprache (id),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    anteil DOUBLE PRECISION NOT NULL,
    berechnet_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sprache_treffer_pkey PRIMARY KEY (objekt_art, objekt_public_id, sprache_id),
    CONSTRAINT sprache_treffer_objekt_art_known CHECK (objekt_art IN ('place', 'territory', 'region', 'path')),
    CONSTRAINT sprache_treffer_anteil_range CHECK (anteil > 0 AND anteil <= 1)
);

-- Die Zahlen einer Sprache je Art und das Löschen eines Laufs je Sprache; die Sprachen eines Objekts liest der Primärschlüssel.
CREATE INDEX IF NOT EXISTS sprache_treffer_sprache ON sprache_treffer (sprache_id, objekt_art);

-- Ein Lauf über alles löscht und schreibt die Tafel ganz neu: tote Zeilen früh wegräumen (wie die Ableitung der Gebiete, 0147).
ALTER TABLE sprache_treffer SET (autovacuum_vacuum_scale_factor = 0.05);

COMMENT ON TABLE sprache_treffer IS
    'Treffer Sprache <-> Objekt (WI-0261 S4): abgeleiteter Zwischenspeicher des Auftrags sprache_treffer, kein Fachbestand. Alle Beruehrungen mit Anteil > 0; die Schwelle sprachenMindestanteil wirkt erst beim Lesen.';
COMMENT ON COLUMN sprache_treffer.objekt_art IS 'place | territory | region | path.';
COMMENT ON COLUMN sprache_treffer.objekt_public_id IS 'public_id des Orts, Herrschaftsgebiets, der Region oder des Wegs (ohne Fremdschluessel: vier Tafeln).';
COMMENT ON COLUMN sprache_treffer.anteil IS
    'Ort: 1 (Punkt in Flaeche). Flaeche: Anteil an der Flaeche des Objekts. Weg: Anteil an seiner Laenge. Auf sechs Stellen, groesser 0, hoechstens 1.';
COMMENT ON COLUMN sprache_treffer.berechnet_at IS 'Wann der Auftrag diese Zeile geschrieben hat.';

-- 2. DIE JOBART -------------------------------------------------------------------------------------------------------------------

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
        'wiki_dump_einlesen', 'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen', 'wiki_kategorien', 'wiki_artikel',
        'wiki_dump_holen', 'sprache_treffer'
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
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien; WI-0253 D-2: wiki_artikel; WI-0253 B-1: wiki_dump_einlesen, erst mit 0239 erlaubt; WI-0253 §22: wiki_dump_holen; WI-0261 S4: sprache_treffer). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

-- 3. SAMMELN ----------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sprache_treffer_sammeln(
    p_map_domain_id TEXT,
    p_actor_ref TEXT,
    p_umfang JSONB,
    p_quiet_s INTEGER,
    p_max_s INTEGER
) RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_arten CONSTANT TEXT[] := ARRAY['place', 'territory', 'region', 'path'];
    v_hoechstens CONSTANT INTEGER := 200;
    v_id BIGINT;
    v_public UUID;
    v_queued_at TIMESTAMPTZ;
    v_alt JSONB := '{}'::jsonb;
    v_neu JSONB;
    v_sprachen UUID[];
    v_objekte JSONB := '{}'::jsonb;
    v_ids UUID[];
    v_zahl INTEGER := 0;
    v_art TEXT;
    v_quiet INTERVAL := make_interval(secs => GREATEST(COALESCE(p_quiet_s, 0), 0));
    v_max INTERVAL := make_interval(secs => GREATEST(COALESCE(p_max_s, 0), COALESCE(p_quiet_s, 0), 0));
BEGIN
    -- Die Form des Umfangs: {"alle": true}, oder Sprachen und Objekte je Art; leer ist ein Fehler des Aufrufers.
    IF p_umfang IS NULL OR jsonb_typeof(p_umfang) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_umfang) k WHERE k NOT IN ('alle', 'sprachen', 'objekte'))
       OR (p_umfang ? 'alle' AND p_umfang->'alle' <> 'true'::jsonb)
       OR (p_umfang ? 'sprachen' AND jsonb_typeof(p_umfang->'sprachen') <> 'array')
       OR (p_umfang ? 'objekte' AND (jsonb_typeof(p_umfang->'objekte') <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_umfang->'objekte') k WHERE k <> ALL(v_arten))
           OR EXISTS (SELECT 1 FROM jsonb_each(p_umfang->'objekte') e WHERE jsonb_typeof(e.value) <> 'array')))
       OR NOT (p_umfang ? 'alle'
           OR jsonb_array_length(COALESCE(p_umfang->'sprachen', '[]'::jsonb)) > 0
           OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(p_umfang->'objekte', '{}'::jsonb)) e WHERE jsonb_array_length(e.value) > 0)) THEN
        RAISE EXCEPTION 'sprache_treffer_sammeln: Umfang % passt nicht', COALESCE(p_umfang::text, '(leer)') USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('job_sammeln'), hashtext('sprache_treffer/' || COALESCE(p_map_domain_id, '')));
    SELECT j.id, j.public_id, j.queued_at, j.input_ref INTO v_id, v_public, v_queued_at, v_alt
      FROM job j
     WHERE j.kind = 'sprache_treffer' AND j.map_domain_id = p_map_domain_id AND j.state = 'QUEUED'
     ORDER BY j.id LIMIT 1
       FOR UPDATE;
    v_alt := COALESCE(v_alt, '{}'::jsonb);

    -- Vereinigen. Jede Kennung wird als UUID gelesen: Was keine ist, scheitert hier, nicht erst im Auftrag.
    IF v_alt ? 'alle' OR p_umfang ? 'alle' THEN
        v_neu := '{"alle": true}'::jsonb;
    ELSE
        v_sprachen := ARRAY(
            SELECT DISTINCT x::uuid FROM (
                SELECT jsonb_array_elements_text(COALESCE(v_alt->'sprachen', '[]'::jsonb))
                UNION ALL
                SELECT jsonb_array_elements_text(COALESCE(p_umfang->'sprachen', '[]'::jsonb))
            ) s(x) ORDER BY 1);
        FOREACH v_art IN ARRAY v_arten LOOP
            v_ids := ARRAY(
                SELECT DISTINCT x::uuid FROM (
                    SELECT jsonb_array_elements_text(COALESCE(v_alt->'objekte'->v_art, '[]'::jsonb))
                    UNION ALL
                    SELECT jsonb_array_elements_text(COALESCE(p_umfang->'objekte'->v_art, '[]'::jsonb))
                ) s(x) ORDER BY 1);
            IF cardinality(v_ids) > 0 THEN
                v_objekte := v_objekte || jsonb_build_object(v_art, to_jsonb(v_ids));
                v_zahl := v_zahl + cardinality(v_ids);
            END IF;
        END LOOP;
        IF v_zahl > v_hoechstens THEN
            v_neu := '{"alle": true}'::jsonb;
        ELSE
            v_neu := '{}'::jsonb;
            IF cardinality(v_sprachen) > 0 THEN
                v_neu := v_neu || jsonb_build_object('sprachen', to_jsonb(v_sprachen));
            END IF;
            IF v_zahl > 0 THEN
                v_neu := v_neu || jsonb_build_object('objekte', v_objekte);
            END IF;
        END IF;
    END IF;

    IF v_id IS NOT NULL THEN
        UPDATE job SET
            input_ref = v_neu,
            coalesced_count = coalesced_count + 1,
            -- Ruhe ab jetzt, aber nie über die Obergrenze ab der ersten Speicherung hinaus.
            not_before = LEAST(now() + v_quiet, v_queued_at + v_max)
         WHERE id = v_id;
        RETURN v_public;
    END IF;
    SELECT e.public_id INTO v_public
      FROM job_enqueue('sprache_treffer', 1::smallint, p_map_domain_id, p_actor_ref, v_neu, 50::smallint, now() + v_quiet,
                       'tiles', '{}'::smallint[]) e;
    RETURN v_public;
END;
$$;

COMMENT ON FUNCTION sprache_treffer_sammeln(TEXT, TEXT, JSONB, INTEGER, INTEGER) IS
    'WI-0261 S4: reiht den Auftrag sprache_treffer ein oder vereinigt den Umfang mit dem wartenden der Domaene (alle | Sprachen und Objekte je Art; mehr als 200 Objekte werden alle); gleitend wie job_sammeln. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION sprache_treffer_sammeln(TEXT, TEXT, JSONB, INTEGER, INTEGER) FROM PUBLIC;
