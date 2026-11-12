-- 0248: Die Regelvorschläge der Vorkommen und die Begriffstafel (WI-0253 Scheibe Regelvorschläge, §24; Regelbuch `review/wi-0253/regelbuch/regelbuch.md`; Vali 2026-10-27, F1, F4, F5).
--
--   F1 (Knopfwahl „Ja, ‚ohne‘“): die dritte Verknüpfung `ohne` in der Regelkette – „bisher minus diese Bedingung“, streng von links nach rechts.
--   F4 (wörtlich): „kannst du die regel erstellen, aber mit einem ausrufezeichen oder so andeuten, dass er das regel-gebiet nicht gefunden hat, die regel wird so lange ignoriert bis alle gebiete
--       oder orte in der regel auf der karte zugewiesen wurden“ – eine Bedingung darf auf eine Fläche zeigen, die es (noch) nicht gibt: gespeichert mit dem Wiki-Namen (`wiki_area_title`),
--       sichtbar mit „!“; die Regel wartet und zählt nirgends, bis jede Fläche zugewiesen ist.
--   F5 (wörtlich): „biete nach dem sync eine liste von begriffen an, die du gefunden hast und deren zuweisung wir über eine tagliste in einer mappingtabelle zuweisen können, das feld hat
--       autocomplete mit den begriffen, die wir haben und funktioniert über pillen, die wieder entfernt werden können z.B. Heide: (Graslandschaft X). du bestimmst initial die näherungen.“
--       – die Begriffstafel je Umgebung: nur die Abweichungen von den Startwerten stehen in der Datenbank (wie bei den Kanon-Tafeln, 0223); die Startwerte führt der Code.
--
-- Fünf Dinge, alle ADDITIV (AGENTS.md, „erst erweitern“):
--
--   1. `lore_rule_term`: `join_op` lernt `ohne`; die nullbare Spalte `wiki_area_title` (der Wiki-Name einer Fläche, die es noch nicht gibt) mit ihrer Prüfung (nur ohne Fläche und ohne Kennung aus Legacy).
--      `lore_rule`: `retired_origin` lernt `wikisync` (was die Übernahme der Regelvorschläge still legt, wie bei `lore_place`, 0247).
--   2. Die Begriffstafel: `wikisync_begriff_setting` (Abweichungen: Wort und Pillen), `wikisync_begriff_state` (EINE Revision für `baseRevision`/409, gehoben je Anweisung durch den Trigger).
--   3. Das Protokoll der Ableitung, an den Lauf der Vorschau gehängt (`ON DELETE CASCADE`, die zwei jüngsten Läufe je Bereich bleiben): `wikisync_regel_lauf` (Zahlen, Revision der Begriffstafel),
--      `wikisync_regel_vorschlag` (ein Vorschlag je Eintrag), `wikisync_regel_wort` (die gefundenen Wörter mit Zahl). Keine Fachtafel: Der Lauf schreibt in keine.
--   4. Die Übernahmen: `wikisync_regel_uebernahme` und `wikisync_regel_uebernahme_zeile` – wer wann welche Regeln anlegte und still legte, damit die Rücknahme je Übernahme möglich ist.
--
-- 🔴 Keine Datenänderung. Das vorige Release schreibt weder `ohne` noch eine offene Fläche noch die neue Herkunft und liest keine der neuen Tafeln. Die Rechte (spaltengenau, nie DELETE an Fachtafeln)
-- stehen in `apps/server/src/db/system-grants.psql` und `map-grants.psql` (hinter JEDE Migration).

-- 1. DIE REGEL -------------------------------------------------------------------------------------------------------------

ALTER TABLE lore_rule_term DROP CONSTRAINT IF EXISTS lore_rule_term_join_op_known;
ALTER TABLE lore_rule_term
    ADD CONSTRAINT lore_rule_term_join_op_known CHECK (join_op IN ('und', 'oder', 'ohne'));

ALTER TABLE lore_rule_term ADD COLUMN IF NOT EXISTS wiki_area_title TEXT;
ALTER TABLE lore_rule_term DROP CONSTRAINT IF EXISTS lore_rule_term_wiki_area_title_check;
ALTER TABLE lore_rule_term
    ADD CONSTRAINT lore_rule_term_wiki_area_title_check CHECK (
        wiki_area_title IS NULL
        OR (btrim(wiki_area_title) <> '' AND area_region_id IS NULL AND legacy_area_public_id IS NULL)
    );

COMMENT ON COLUMN lore_rule_term.join_op IS
    'und | oder | ohne (0248, F1): `ohne` heißt „bisher minus die Treffer dieser Bedingung“, auf Flächen und Siedlungen je getrennt, streng von links nach rechts. Bei der ersten Bedingung bedeutungslos.';
COMMENT ON COLUMN lore_rule_term.wiki_area_title IS
    'Der Titel des Wiki-Artikels einer Fläche, die es in der Karte (noch) nicht gibt (0248, F4): Die Regel wartet und zählt nirgends, bis jede ihrer Flächen zugewiesen ist. Gesetzt nur ohne area_region_id und ohne legacy_area_public_id.';

ALTER TABLE lore_rule DROP CONSTRAINT IF EXISTS lore_rule_retired_consistent;
ALTER TABLE lore_rule
    ADD CONSTRAINT lore_rule_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'legacy', 'wikisync'))
    );

-- 2. DIE BEGRIFFSTAFEL -----------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wikisync_begriff_setting (
    -- Das Wort, wie das Wiki es schreibt, klein: ein Wort der Begriffstafel (höchstens 40 Zeichen, ohne Leerraum).
    wort TEXT PRIMARY KEY CHECK (wort = lower(btrim(wort)) AND char_length(wort) BETWEEN 1 AND 40 AND wort !~ '[[:space:]]'),
    -- Die Pillen, die gelten sollen: `<ebene>|<art>` (Landschaftsart) oder `zone|<schluessel>` (Klimazone); auch leer („bewusst keine“).
    pillen TEXT[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(pillen) <= 8),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema.
    changed_by UUID,
    changed_by_label TEXT
);
COMMENT ON TABLE wikisync_begriff_setting IS
    'Die Begriffstafel je Umgebung (WI-0253 §24, F5): nur die Abweichungen von den Startwerten (Wort und Pillen). Eine Zeile ersetzt den Startwert des Worts oder legt ein Wort an; „zurücksetzen“ löscht sie. Die nächste Ableitung der Regelvorschläge liest die Tafel.';

CREATE TABLE IF NOT EXISTS wikisync_begriff_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE wikisync_begriff_state IS
    'Revision der Begriffstafel (WI-0253 §24): Grundlage für baseRevision/409; steigt mit jeder Anweisung an wikisync_begriff_setting. Eine Ableitung nennt die Revision, nach der sie rechnete.';
INSERT INTO wikisync_begriff_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.wikisync_begriff_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO wikisync_begriff_state (id, revision, updated_at) VALUES (1, 2, now())
    ON CONFLICT (id) DO UPDATE SET revision = wikisync_begriff_state.revision + 1, updated_at = now();
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.wikisync_begriff_bump() IS
    'WI-0253 §24: hebt wikisync_begriff_state.revision je Anweisung an wikisync_begriff_setting.';

CREATE OR REPLACE TRIGGER wikisync_begriff_setting_bump AFTER INSERT OR UPDATE OR DELETE ON wikisync_begriff_setting
    FOR EACH STATEMENT EXECUTE FUNCTION public.wikisync_begriff_bump();

-- 3. DAS PROTOKOLL DER ABLEITUNG -------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wikisync_regel_lauf (
    lauf_id BIGINT PRIMARY KEY REFERENCES wikisync_lauf (id) ON DELETE CASCADE,
    -- Die Revision der Begriffstafel, nach der die Ableitung rechnete.
    begriffe_revision BIGINT,
    zahlen JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE wikisync_regel_lauf IS
    'Kopf der Ableitung der Regelvorschläge zu einem Lauf der Vorschau (WI-0253 §24): die Revision der Begriffstafel und die Zahlen. Ein Lauf mit dem Bereich vorkommen hat genau eine Zeile.';

CREATE TABLE IF NOT EXISTS wikisync_regel_vorschlag (
    id BIGSERIAL PRIMARY KEY,
    lauf_id BIGINT NOT NULL REFERENCES wikisync_lauf (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    lore_entry_id BIGINT NOT NULL REFERENCES lore_entry (id),
    eintrag_name TEXT NOT NULL,
    art TEXT NOT NULL CHECK (art IN ('fauna', 'flora', 'spezies', 'ware')),
    artikel TEXT,
    typ TEXT NOT NULL CHECK (typ IN ('manuell', 'wartet', 'negiert', 'mehrdeutig', 'unvollstaendig', 'rueckfrage', 'vollstaendig')),
    status TEXT NOT NULL CHECK (status IN ('neu', 'geaendert', 'entfaellt', 'manuell')),
    wartet BOOLEAN NOT NULL,
    vorgewaehlt BOOLEAN NOT NULL,
    waehlbar BOOLEAN NOT NULL,
    sperre TEXT,
    suchtext TEXT NOT NULL,
    -- Der Wortlaut des Wikis mit dem Zustand jedes Glieds, die Regeln je Beziehung (Bedingungen, bisherige Regel, Teile mit Grund): ein Protokoll, kein Fachwert.
    payload JSONB NOT NULL,
    CONSTRAINT wikisync_regel_vorschlag_eintrag_unique UNIQUE (lauf_id, lore_entry_id),
    CONSTRAINT wikisync_regel_vorschlag_vorgewaehlt_waehlbar CHECK (NOT vorgewaehlt OR waehlbar)
);
CREATE INDEX IF NOT EXISTS wikisync_regel_vorschlag_lauf ON wikisync_regel_vorschlag (lauf_id, position);
COMMENT ON TABLE wikisync_regel_vorschlag IS
    'Ein Regelvorschlag je Vorkommen (WI-0253 §24), abgeleitet aus den Rohtexten der Infobox im Lauf der Vorschau. Reines Protokoll; angelegt wird eine Regel erst durch „Übernehmen“, und nur für die ausgewählten.';

CREATE TABLE IF NOT EXISTS wikisync_regel_wort (
    lauf_id BIGINT NOT NULL REFERENCES wikisync_lauf (id) ON DELETE CASCADE,
    wort TEXT NOT NULL,
    anzahl INTEGER NOT NULL CHECK (anzahl >= 1),
    -- Das Wort steht in der Begriffstafel (Startwert oder eigene Zeile); sonst ist es ein gefundenes Wort ohne Zuweisung.
    in_tafel BOOLEAN NOT NULL,
    PRIMARY KEY (lauf_id, wort)
);
COMMENT ON TABLE wikisync_regel_wort IS
    'Die Wörter, die die Ableitung der Regelvorschläge sah (WI-0253 §24, F5): mit der Zahl ihrer Nennungen und ob die Begriffstafel sie kennt. Daraus bietet die Begriffstafel die Liste „gefundene Wörter“ an.';

-- 4. DIE ÜBERNAHMEN --------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wikisync_regel_uebernahme (
    id BIGSERIAL PRIMARY KEY,
    -- Der Lauf, dessen Vorschläge übernommen wurden (ohne Fremdschlüssel: Der Lauf wird abgeräumt, die Übernahme bleibt).
    lauf_id BIGINT,
    operation_id UUID,
    actor_person_id UUID,
    actor_label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    zurueckgenommen_am TIMESTAMPTZ,
    zurueckgenommen_von UUID,
    zurueckgenommen_label TEXT
);
COMMENT ON TABLE wikisync_regel_uebernahme IS
    'Eine Übernahme von Regelvorschlägen (WI-0253 §24): wer wann aus welchem Lauf. Jede Übernahme ist einzeln zurücknehmbar.';

CREATE TABLE IF NOT EXISTS wikisync_regel_uebernahme_zeile (
    id BIGSERIAL PRIMARY KEY,
    uebernahme_id BIGINT NOT NULL REFERENCES wikisync_regel_uebernahme (id),
    lore_entry_id BIGINT NOT NULL REFERENCES lore_entry (id),
    relation TEXT NOT NULL CHECK (relation IN ('verbreitung', 'vorkommen', 'herkunft', 'regionen')),
    -- Die Regel, die die Übernahme angelegt hat (leer bei `entfaellt`), und die vom Wiki abgeleiteten Regeln, die sie still legte.
    angelegt_rule_id BIGINT REFERENCES lore_rule (id),
    stillgelegt_rule_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::bigint[]
);
CREATE INDEX IF NOT EXISTS wikisync_regel_uebernahme_zeile_uebernahme ON wikisync_regel_uebernahme_zeile (uebernahme_id);
COMMENT ON TABLE wikisync_regel_uebernahme_zeile IS
    'Was eine Übernahme je Eintrag und Beziehung tat (WI-0253 §24): die angelegte Regel und die still gelegten. Die Rücknahme legt die angelegte still und belebt die still gelegten wieder, wo sie noch so dastehen.';
