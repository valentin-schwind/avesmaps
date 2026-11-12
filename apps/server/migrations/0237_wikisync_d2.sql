-- 0237: WikiSync D-2 – Übernahme für Orte, Wege, Gebiete und Landschaften, Einzelartikel (WI-0253 §4 D, §11).
--
--   Die Übernahme (D-1, Migration 0225) kennt jetzt vier weitere Bereiche. Dafür braucht die Datenbank drei Dinge, alle nur Erweiterungen:
--
-- 1. `wikisync_uebernahme_befund.befund` lernt vier Wörter: `weitere_zuweisung` (ein Wegartikel, der nur als weitere Zuweisung am Abschnitt hängt), `schnappschuss_schlank` (der Wiki-Stand eines Wegs
--    trägt keine Texte), `wert_unzulaessig` (der Wiki-Wert passt nicht ins Feld: eine Ortsgröße, die es nicht gibt) und `name_gesperrt` (der Name bleibt: der Kontinent, der das Gelände rahmt,
--    oder eine Stätte, die am alten Namen eines Orts hängt). Die Wörter stehen in `packages/shared/src/system/wikisync.ts`.
-- 2. `wikisync_artikel`: der Vergleich EINES Artikels über die MediaWiki-API („Artikel vergleichen“, Recht ab Editor, eine Anfrage ohne Anmeldung im Takt von 20 Sekunden). Er schreibt in keine Fachtafel
--    und nicht in den Bericht der Vorschau; das Ergebnis (die Planzeilen der Objekte, die an diesem Artikel hängen) steht hier, bis ein neuerer Vergleich es ablöst (die letzten zwanzig bleiben).
--    Kein Wikitext: Die Zeilen tragen bereinigte Werte einzelner Infobox-Felder (wie `wikisync_lauf_zeile`).
-- 3. `job_enqueue` lernt `wiki_artikel` (und behält jede Art der geltenden Fassung, 0226).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue Tafel, die das vorige Release nie liest; eine gelockerte Prüfung; `job_enqueue` von ihrer geltenden Fassung (0226) abgeschrieben und um eine Art
-- erweitert, die Argumentliste bleibt. Keine Datenänderung an einer Fachtafel. Rechte: `apps/server/src/db/system-grants.psql` (hinter JEDE Migration): Die App liest, die Jobs-Rolle schreibt.

-- 1. DIE BEFUNDE ------------------------------------------------------------------------------------------------------------------------

ALTER TABLE wikisync_uebernahme_befund DROP CONSTRAINT IF EXISTS wikisync_uebernahme_befund_befund_check;
ALTER TABLE wikisync_uebernahme_befund
    ADD CONSTRAINT wikisync_uebernahme_befund_befund_check CHECK (
        befund IN (
            'seit_vorschau_geaendert', 'kein_schnappschuss', 'name_leer', 'name_vergeben', 'linie_unvollstaendig', 'wert_gekuerzt',
            'seit_uebernahme_geaendert', 'weitere_zuweisung', 'schnappschuss_schlank', 'wert_unzulaessig', 'name_gesperrt'
        )
    );

-- 2. DER VERGLEICH EINES ARTIKELS -------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wikisync_artikel (
    id BIGSERIAL PRIMARY KEY,
    -- Der Titel, den die Person nannte (Unterstriche wie Leerzeichen), und der, unter dem das Wiki den Artikel führt (nach einer Weiterleitung).
    titel TEXT NOT NULL CHECK (char_length(titel) BETWEEN 1 AND 500),
    wiki_titel TEXT CHECK (wiki_titel IS NULL OR char_length(wiki_titel) BETWEEN 1 AND 500),
    wiki_namensraum INTEGER,
    -- Die Fassung des Artikels, die verglichen wurde: Revisionsnummer und Zeit des Wikis.
    wiki_revision BIGINT,
    wiki_stand TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'laeuft' CHECK (status IN ('laeuft', 'fertig', 'fehlgeschlagen')),
    -- Die Fassung des Lesers, nach der gerechnet wurde (`WIKISYNC_PARSER_VERSION`), und die Revision der Namensraum-Tafel.
    parser_version TEXT NOT NULL,
    tafel_revision BIGINT,
    job_public_id UUID,
    ausgeloest_von UUID,
    ausgeloest_label TEXT,
    gestartet_am TIMESTAMPTZ NOT NULL DEFAULT now(),
    beendet_am TIMESTAMPTZ,
    fehler_code TEXT CHECK (fehler_code IS NULL OR char_length(fehler_code) <= 64),
    fehler TEXT CHECK (fehler IS NULL OR char_length(fehler) <= 500),
    -- Die Planzeilen (Felder und Befunde zum Artikel) der Objekte, die an ihm hängen, und die Zahlen je Bereich; ein Protokoll, nie ein Fachwert.
    zeilen JSONB NOT NULL DEFAULT '[]'::jsonb,
    zahlen JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT wikisync_artikel_beendet CHECK ((status = 'laeuft') = (beendet_am IS NULL)),
    CONSTRAINT wikisync_artikel_fehler_nur_bei_fehlschlag CHECK ((fehler IS NULL AND fehler_code IS NULL) OR status = 'fehlgeschlagen'),
    CONSTRAINT wikisync_artikel_zeilen_liste CHECK (jsonb_typeof(zeilen) = 'array' AND jsonb_array_length(zeilen) <= 500)
);

CREATE INDEX IF NOT EXISTS wikisync_artikel_neu ON wikisync_artikel (id DESC);

COMMENT ON TABLE wikisync_artikel IS
    'Der Vergleich eines einzelnen Wiki-Artikels über die MediaWiki-API (WI-0253 D-2): schreibt in keine Fachtafel; die Planzeilen der Objekte am Artikel stehen als JSON da. Die letzten zwanzig bleiben.';

-- 3. DIE ART IN DER WARTESCHLANGE -------------------------------------------------------------------------------------------------------

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
        'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen', 'wiki_kategorien', 'wiki_artikel'
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
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien; WI-0253 D-2: wiki_artikel). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';
