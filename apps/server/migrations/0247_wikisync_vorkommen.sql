-- 0247: WikiSync kennt die Vorkommen als Bereich (WI-0253, Scheibe Vorkommen, §17/§23): Waren, Fauna, Flora und Spezies (`lore_entry`, Migration 0074) werden über ihre gespeicherte
-- Wiki-Adresse (`lore_entry.wiki_url`) mit ihrem Artikel verglichen (Infobox `Gegenstandsgruppe`, `Tierart`, `Pflanzenart`, `Spezies`); die Felder des Eintrags folgen dem Wiki nach Vermerk
-- (`lore_entry_field_origin`), und die Ortszeilen (`lore_place`) bekommen eine ROLLE.
--
--   Vali 2026-10-27, Knopfwahl „Ja, mit Rolle“ (Knopftext von Claudia, kein Zitat): Jeder Wikilink aus den Ortsfeldern bleibt als Ortszeile gespeichert, bekommt aber eine Rolle (Ort,
--   Bezugspunkt, ausgenommen, Teil, Landschaftsart, Volk, früher, andere Welt). Nur „Ort“ erzeugt Treffer (`lore_place_target`, Infofenster „Direkt von hier“ und „Aus der Region“). Eine
--   Zeile OHNE Rolle (der Bestand aus Legacys Zug) gilt als „Ort“, bis ein Abgleich sie bestimmt: `role` ist darum nullbar, ohne Vorgabe.
--
-- Drei Dinge, alle ADDITIV (AGENTS.md, „erst erweitern“):
--
--   1. `lore_place.role` (nullbar, geprüft gegen die acht Wörter) und `retired_origin = 'wikisync'` an `lore_place`: Was der WikiSync still legt, trägt diese Herkunft (wie `adventure_place`, 0241,
--      und die Verknüpfungen der Quellen, 0243). Gelöscht wird nie; ein Tombstone (`suppressed`) und eine von der Redaktion gelöste Zeile (`editor`) leben nie wieder auf, was der WikiSync
--      selbst still legte, schon.
--   2. `wiki_lore_snapshot`: der Wiki-Stand je Eintrag, wie `wiki_territory_snapshot` und `wiki_region_snapshot` bei den Kartenobjekten: die Wiki-Werte der sechs Felder und die Rohtexte
--      `Verbreitung`, `Herkunft`, `Regionen` und `Vorkommen`, GESCHRIEBEN NUR VOM WIKISYNC (die App liest). Damit meldet der Bericht keine Dauerbefunde, wenn das Wiki sich nicht bewegt hat,
--      und die spätere Scheibe Regelvorschläge liest den Wortlaut. `unbekannt` nennt die Felder, deren Wiki-Wert noch nie gelesen wurde (ein neuer Stand beginnt mit allen); NULL an einem
--      bekannten Feld heißt „das Wiki kennt nichts“.
--   3. Die Tafeln des WikiSync (0224, 0225) nennen ihre Bereiche und die Arten der Objekte in je einem CHECK. Sie lernen je ein Wort: der Bereich `vorkommen` in `wikisync_lauf.bereiche`,
--      `wikisync_lauf_zeile.bereich`, `wikisync_bereich_setting.bereich` und `wikisync_uebernahme.bereich`; die Art `lore` (ein Vorkommen, `lore_entry.public_id`) in
--      `wikisync_lauf_zeile.objekt_art` und `wikisync_uebernahme_befund.objekt_art`.
--
-- 🔴 Keine Datenänderung. Das vorige Release schreibt keines der neuen Wörter und liest keine der neuen Spalten. Die Rechte der Jobs-Rolle (spaltengenau, nie DELETE an Fachtafeln) stehen in
-- `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

ALTER TABLE lore_place ADD COLUMN IF NOT EXISTS role TEXT;

ALTER TABLE lore_place DROP CONSTRAINT IF EXISTS lore_place_role_known;
ALTER TABLE lore_place
    ADD CONSTRAINT lore_place_role_known CHECK (
        role IS NULL
        OR role IN ('ort', 'bezugspunkt', 'ausgenommen', 'teil', 'landschaftsart', 'volk', 'frueher', 'andere_welt')
    );

COMMENT ON COLUMN lore_place.role IS
    'Rolle der Ortszeile (0247, WikiSync): ort | bezugspunkt | ausgenommen | teil | landschaftsart | volk | frueher | andere_welt. NULL (Bestand aus Legacys Zug) gilt als ort. Nur ort hat Treffer in lore_place_target.';

ALTER TABLE lore_place DROP CONSTRAINT IF EXISTS lore_place_retired_consistent;
ALTER TABLE lore_place
    ADD CONSTRAINT lore_place_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'legacy', 'wikisync'))
    );

CREATE TABLE IF NOT EXISTS wiki_lore_snapshot (
    id BIGSERIAL PRIMARY KEY,
    lore_entry_id BIGINT NOT NULL REFERENCES lore_entry (id),
    -- Die Wiki-Werte der sechs Felder des Eintrags (NULL: das Wiki kennt nichts oder der Wert ist noch unbekannt, siehe `unbekannt`).
    name TEXT,
    gruppe TEXT,
    typ TEXT,
    lebensraum TEXT,
    synonyme TEXT,
    continent TEXT,
    -- Die Rohtexte der Infobox, so wie das Wiki sie führt (Zeichenverweise einmal aufgelöst, Leerraum an den Rändern weg), mit allen Links.
    verbreitung_roh TEXT,
    herkunft_roh TEXT,
    regionen_roh TEXT,
    vorkommen_roh TEXT,
    -- Felder (Namen des Plans), deren Wiki-Wert noch nie gelesen wurde. Ein neuer Stand beginnt mit allen; das Schreiben eines Werts nimmt das Feld heraus, die Rücknahme setzt es wieder hinein.
    unbekannt TEXT[] NOT NULL DEFAULT ARRAY[
        'name', 'gruppe', 'typ', 'lebensraum', 'synonyme', 'continent', 'roh_verbreitung', 'roh_herkunft', 'roh_regionen', 'roh_vorkommen'
    ]::text[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_lore_snapshot_entry_unique UNIQUE (lore_entry_id),
    CONSTRAINT wiki_lore_snapshot_text_not_blank CHECK (
        (name IS NULL OR btrim(name) <> '')
        AND (gruppe IS NULL OR btrim(gruppe) <> '')
        AND (typ IS NULL OR btrim(typ) <> '')
        AND (lebensraum IS NULL OR btrim(lebensraum) <> '')
        AND (synonyme IS NULL OR btrim(synonyme) <> '')
        AND (continent IS NULL OR btrim(continent) <> '')
        AND (verbreitung_roh IS NULL OR btrim(verbreitung_roh) <> '')
        AND (herkunft_roh IS NULL OR btrim(herkunft_roh) <> '')
        AND (regionen_roh IS NULL OR btrim(regionen_roh) <> '')
        AND (vorkommen_roh IS NULL OR btrim(vorkommen_roh) <> '')
    ),
    CONSTRAINT wiki_lore_snapshot_unbekannt_known CHECK (
        unbekannt <@ ARRAY[
            'name', 'gruppe', 'typ', 'lebensraum', 'synonyme', 'continent', 'roh_verbreitung', 'roh_herkunft', 'roh_regionen', 'roh_vorkommen'
        ]::text[]
    )
);

COMMENT ON TABLE wiki_lore_snapshot IS
    'Wiki-Stand je Lore-Eintrag (0247, WikiSync): die Wiki-Werte der Felder und die Rohtexte Verbreitung, Herkunft, Regionen, Vorkommen. Geschrieben nur vom WikiSync (Jobs-Rolle), die App liest. Keine Fachwerte: Die Felder des Eintrags stehen in lore_entry.';
COMMENT ON COLUMN wiki_lore_snapshot.unbekannt IS
    'Felder (Namen des Plans), deren Wiki-Wert noch nie gelesen wurde. NULL an einem Feld, das hier nicht steht, heißt: das Wiki kennt nichts.';

ALTER TABLE wikisync_lauf DROP CONSTRAINT IF EXISTS wikisync_lauf_bereiche_bekannt;
ALTER TABLE wikisync_lauf
    ADD CONSTRAINT wikisync_lauf_bereiche_bekannt CHECK (
        cardinality(bereiche) >= 1
        AND bereiche <@ ARRAY['ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen']::text[]
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_bereich_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen')
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_objekt_art_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore', 'article')
    );

ALTER TABLE wikisync_bereich_setting DROP CONSTRAINT IF EXISTS wikisync_bereich_setting_bereich_check;
ALTER TABLE wikisync_bereich_setting
    ADD CONSTRAINT wikisync_bereich_setting_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen')
    );

ALTER TABLE wikisync_uebernahme DROP CONSTRAINT IF EXISTS wikisync_uebernahme_bereich_check;
ALTER TABLE wikisync_uebernahme
    ADD CONSTRAINT wikisync_uebernahme_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle', 'vorkommen')
    );

ALTER TABLE wikisync_uebernahme_befund DROP CONSTRAINT IF EXISTS wikisync_uebernahme_befund_objekt_art_check;
ALTER TABLE wikisync_uebernahme_befund
    ADD CONSTRAINT wikisync_uebernahme_befund_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'lore')
    );
