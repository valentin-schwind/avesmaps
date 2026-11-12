-- Die zwei Tafeln des Kanon-Etiketts, je Umgebung (WI-0253 B-2; Vali 2026-10-25: „eine tafel je umgebung. man will solche umstiege
-- testen können“; Vertrag `sources.yaml` `kanon.raenge`, `wiki-link-targets.yaml` `namensraum`).
--
-- 🔴 ADDITIV: drei neue Tafeln, eine neue Funktion, ihr Trigger; dazu LOCKERN die sechs Kanon-Tafeln einen CHECK (Abschnitt 4, nur weiter,
-- nie enger). Das vorige Release liest keine der neuen Tafeln; ohne Zeile gilt die Vorgabe
-- aus dem geteilten Paket (`packages/shared/src/wiki-namespaces.ts` und `kanon-tafel.ts`). Rechte: `apps/server/src/db/system-grants.psql`
-- (hinter JEDE Migration). Vorbild ist 0168 (Zoombänder): nur Abweichungen, „zurücksetzen“ löscht die Zeile, eine Revision für
-- `baseRevision`/409.
--
-- 1. `wiki_namespace_setting`: Rang 1, die Namensräume des Wiki Aventurica. Eine Zeile ersetzt die Vorgabe dieser Nummer oder fügt einen
--    Raum hinzu (dann steht hier die ganze Zeile, auch das Präfix). Der Kanon ist die Einordnung einer QUELLE aus diesem Raum; „Kartenobjekte
--    einsammeln“ ist eine eigene Frage, die erst beim nächsten Lauf wirkt; der Bezeichner steht rechts in der geteilten Pille (leer = rund).
-- 2. `canon_object_label_setting`: Rang 4, eine Zeile je Objektart (`place`, `path`, `area`, `territory`, `powerline`, `peak`, die Träger
--    des Kanons). Bei `display` bekommt ein Objekt ohne Wiki-Zuweisung und ohne Quelle INOFFIZIELL mit dem Bezeichner der Art; ohne Zeile gilt
--    die Vorgabe (kein Etikett). Aufgelöst wird beim LESEN (`subjects/carrier-tables.ts`), die Kanon-Zeilen bleiben unberührt.
-- 3. `canon_table_state`: EINE Revision für beide Tafeln (ein Reiter, ein Speichern), gehoben je Anweisung auf einer der beiden Tafeln.
--    Sie fließt in die Leser-Revision, damit eine Tafeländerung das Etikett ohne Neuladen des Servers wechselt.

-- 1. DIE NAMENSRÄUME ------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_namespace_setting (
    ns INTEGER PRIMARY KEY CHECK (ns >= 0),
    -- Das Titelpräfix als Wort ohne Doppelpunkt (`Inoffiziell`); im Hauptraum leer, sonst nie leer.
    prefix TEXT NOT NULL CHECK (
        prefix = btrim(prefix) AND position(':' IN prefix) = 0 AND char_length(prefix) <= 40 AND ((ns = 0) = (prefix = ''))
    ),
    canon TEXT NOT NULL CHECK (canon IN ('official', 'unofficial')),
    collect BOOLEAN NOT NULL,
    -- Der Bezeichner im Etikett: höchstens 40 Zeichen, getrimmt; leer = runde Pille.
    designator TEXT NOT NULL DEFAULT '' CHECK (designator = btrim(designator) AND char_length(designator) <= 40),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    changed_by UUID,
    changed_by_label TEXT
);
-- Ein Präfix gehört einem Raum (ohne Rücksicht auf Groß- und Kleinschreibung, wie MediaWiki den ersten Buchstaben frei stellt).
CREATE UNIQUE INDEX IF NOT EXISTS wiki_namespace_setting_prefix ON wiki_namespace_setting (lower(prefix)) WHERE prefix <> '';
COMMENT ON TABLE wiki_namespace_setting IS
    'Abweichungen der Namensraum-Tafel je Umgebung (WI-0253 B-2): Kanon, Kartenobjekte einsammeln, Bezeichner im Etikett. Die Vorgabe steht im geteilten Paket.';

-- 2. DIE OBJEKTARTEN (RANG 4) ---------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canon_object_label_setting (
    object_kind TEXT PRIMARY KEY CHECK (object_kind IN ('place', 'path', 'area', 'territory', 'powerline', 'peak')),
    -- Bekommt ein Objekt dieser Art ohne Wiki-Zuweisung und ohne Quelle das Etikett INOFFIZIELL?
    display BOOLEAN NOT NULL,
    designator TEXT NOT NULL DEFAULT '' CHECK (designator = btrim(designator) AND char_length(designator) <= 40),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by UUID,
    changed_by_label TEXT
);
COMMENT ON TABLE canon_object_label_setting IS
    'Rang 4 des Kanon-Etiketts je Umgebung (WI-0253 B-2): was weder Wiki-Zuweisung noch Quelle hat. Nur Abweichungen von der Vorgabe (kein Etikett, Bezeichner Avesmaps); aufgelöst beim Lesen.';

-- 3. DIE REVISION ---------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canon_table_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE canon_table_state IS
    'Revision der beiden Kanon-Tafeln (WI-0253 B-2): Grundlage für baseRevision; steigt mit jeder Anweisung an wiki_namespace_setting oder canon_object_label_setting.';

INSERT INTO canon_table_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.canon_table_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO canon_table_state (id, revision, updated_at) VALUES (1, 2, now())
    ON CONFLICT (id) DO UPDATE SET revision = canon_table_state.revision + 1, updated_at = now();
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.canon_table_bump() IS
    'WI-0253 B-2: hebt canon_table_state.revision je Anweisung an einer der beiden Kanon-Tafeln.';

CREATE OR REPLACE TRIGGER wiki_namespace_setting_bump AFTER INSERT OR UPDATE OR DELETE ON wiki_namespace_setting
    FOR EACH STATEMENT EXECUTE FUNCTION public.canon_table_bump();
CREATE OR REPLACE TRIGGER canon_object_label_setting_bump AFTER INSERT OR UPDATE OR DELETE ON canon_object_label_setting
    FOR EACH STATEMENT EXECUTE FUNCTION public.canon_table_bump();

-- 4. DER BEZEICHNER BEI OFFIZIELL --------------------------------------------------------------------------------------------------
--
-- Vali 2026-10-25: Ohne Wiki-Zuweisung zählen die Quellen der Editoren und die Publikationen gemeinsam; eine offiziell angehakte gibt OFFIZIELL
-- mit der ART als Bezeichner („OFFIZIELL | Regionalspielhilfe“), und ein Namensraum trägt seinen Bezeichner unabhängig vom Kanon
-- („OFFIZIELL | Wiki Aventurica“ wäre möglich). Bis hierher erlaubte `<träger>_canon_designator_only_unofficial` einen Bezeichner nur bei
-- unofficial. Der Ersatz LOCKERT nur: ein Bezeichner bleibt verboten bei unlabelled (nichts zu sagen, nichts zu bezeichnen). Das vorige Release
-- (der Import, Legacys Ergebnis) schreibt weiter nur, was beide Fassungen erlauben.
ALTER TABLE place_canon DROP CONSTRAINT IF EXISTS place_canon_designator_only_unofficial;
ALTER TABLE place_canon DROP CONSTRAINT IF EXISTS place_canon_designator_not_unlabelled;
ALTER TABLE place_canon ADD CONSTRAINT place_canon_designator_not_unlabelled CHECK (
    canon <> 'unlabelled' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
);
ALTER TABLE path_canon DROP CONSTRAINT IF EXISTS path_canon_designator_only_unofficial;
ALTER TABLE path_canon DROP CONSTRAINT IF EXISTS path_canon_designator_not_unlabelled;
ALTER TABLE path_canon ADD CONSTRAINT path_canon_designator_not_unlabelled CHECK (
    canon <> 'unlabelled' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
);
ALTER TABLE territory_canon DROP CONSTRAINT IF EXISTS territory_canon_designator_only_unofficial;
ALTER TABLE territory_canon DROP CONSTRAINT IF EXISTS territory_canon_designator_not_unlabelled;
ALTER TABLE territory_canon ADD CONSTRAINT territory_canon_designator_not_unlabelled CHECK (
    canon <> 'unlabelled' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
);
ALTER TABLE region_canon DROP CONSTRAINT IF EXISTS region_canon_designator_only_unofficial;
ALTER TABLE region_canon DROP CONSTRAINT IF EXISTS region_canon_designator_not_unlabelled;
ALTER TABLE region_canon ADD CONSTRAINT region_canon_designator_not_unlabelled CHECK (
    canon <> 'unlabelled' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
);
ALTER TABLE terrain_peak_canon DROP CONSTRAINT IF EXISTS terrain_peak_canon_designator_only_unofficial;
ALTER TABLE terrain_peak_canon DROP CONSTRAINT IF EXISTS terrain_peak_canon_designator_not_unlabelled;
ALTER TABLE terrain_peak_canon ADD CONSTRAINT terrain_peak_canon_designator_not_unlabelled CHECK (
    canon <> 'unlabelled' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
);
ALTER TABLE powerline_canon DROP CONSTRAINT IF EXISTS powerline_canon_designator_only_unofficial;
ALTER TABLE powerline_canon DROP CONSTRAINT IF EXISTS powerline_canon_designator_not_unlabelled;
ALTER TABLE powerline_canon ADD CONSTRAINT powerline_canon_designator_not_unlabelled CHECK (
    canon <> 'unlabelled' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
);
