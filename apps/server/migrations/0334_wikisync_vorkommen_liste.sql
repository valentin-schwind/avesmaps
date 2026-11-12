-- 0334: Der Wiki-Stand eines Vorkommens kennt seine Unterseite „Liste“ (WI-0299, OPS-000104; Vorschlag von Nottel, Option „Jetzt bauen“ von Vali gewählt am 2026-11-09).
--
--   Viele Artikel der Wiki Aventurica haben eine Unterseite `<Titel>/Liste` mit Varianten und Einzelexemplaren (Langschwert/Liste, Wolf/Liste), andere nicht (Sikrami). Die Vorschau des WikiSync
--   sucht sie im Dump zu jedem Vorkommen (`wiki/abgleich/vorkommen-liste.ts`) und führt ihren Titel als Feld `liste` im Wiki-Stand, wie die Rohtexte der Infobox: Der Eintrag selbst
--   (`lore_entry`) bekommt kein Feld, denn die Unterseite ist eine Auskunft des Wikis, keine Angabe, die die Redaktion entscheidet. Die Infobox des Vorkommens zeigt den Link nur, wo es ihn gibt;
--   ohne die Prüfung gäbe es tote Links.
--
--   1. `wiki_lore_snapshot.liste`: der Titel der Unterseite, wie der Dump ihn führt (`Langschwert/Liste`). NULL heißt, wie bei den anderen Feldern: das Wiki kennt keine, wenn das Feld nicht in
--      `unbekannt` steht.
--   2. Zwei Prüfungen lernen das Feld: `wiki_lore_snapshot_text_not_blank` (kein leerer Titel) und `wiki_lore_snapshot_unbekannt_known`. Die Vorgabe von `wiki_lore_snapshot.unbekannt`
--      nennt das Feld mit, und jeder bestehende Stand nennt es auch: Das Wiki wurde dazu noch nie gelesen.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“; Vorbild 0252): eine nullbare Spalte, die das vorige Release nie liest und nie schreibt, und gelockerte Prüfungen (jedes bisherige Wort bleibt erlaubt). Das
-- Eintragen von `liste` in `unbekannt` bestehender Stände ist die einzige Datenänderung; das vorige Release liest die Liste als Menge von Namen und ignoriert den, den es nicht kennt. Das Recht der
-- Jobs-Rolle (UPDATE an der neuen Spalte) steht in `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

ALTER TABLE wiki_lore_snapshot ADD COLUMN IF NOT EXISTS liste TEXT;

COMMENT ON COLUMN wiki_lore_snapshot.liste IS
    'Der Titel der Unterseite „Liste“ des Artikels laut Dump (0334, WI-0299), etwa Langschwert/Liste. NULL: das Wiki kennt keine oder der Stand kennt sie noch nicht (siehe unbekannt).';

ALTER TABLE wiki_lore_snapshot DROP CONSTRAINT IF EXISTS wiki_lore_snapshot_text_not_blank;
ALTER TABLE wiki_lore_snapshot
    ADD CONSTRAINT wiki_lore_snapshot_text_not_blank CHECK (
        (name IS NULL OR btrim(name) <> '')
        AND (gruppe IS NULL OR btrim(gruppe) <> '')
        AND (typ IS NULL OR btrim(typ) <> '')
        AND (lebensraum IS NULL OR btrim(lebensraum) <> '')
        AND (synonyme IS NULL OR btrim(synonyme) <> '')
        AND (continent IS NULL OR btrim(continent) <> '')
        AND (kurzbeschreibung IS NULL OR btrim(kurzbeschreibung) <> '')
        AND (verbreitung_roh IS NULL OR btrim(verbreitung_roh) <> '')
        AND (herkunft_roh IS NULL OR btrim(herkunft_roh) <> '')
        AND (regionen_roh IS NULL OR btrim(regionen_roh) <> '')
        AND (vorkommen_roh IS NULL OR btrim(vorkommen_roh) <> '')
        AND (liste IS NULL OR btrim(liste) <> '')
    );

ALTER TABLE wiki_lore_snapshot DROP CONSTRAINT IF EXISTS wiki_lore_snapshot_unbekannt_known;
ALTER TABLE wiki_lore_snapshot
    ADD CONSTRAINT wiki_lore_snapshot_unbekannt_known CHECK (
        unbekannt <@ ARRAY[
            'name', 'gruppe', 'typ', 'lebensraum', 'synonyme', 'continent', 'kurzbeschreibung', 'roh_verbreitung', 'roh_herkunft', 'roh_regionen', 'roh_vorkommen', 'liste'
        ]::text[]
    );

ALTER TABLE wiki_lore_snapshot ALTER COLUMN unbekannt SET DEFAULT ARRAY[
    'name', 'gruppe', 'typ', 'lebensraum', 'synonyme', 'continent', 'kurzbeschreibung', 'roh_verbreitung', 'roh_herkunft', 'roh_regionen', 'roh_vorkommen', 'liste'
]::text[];

-- Bestehende Stände haben die Unterseite noch nie gesucht: Das Feld ist dort unbekannt, bis eine Übernahme es schreibt.
UPDATE wiki_lore_snapshot SET unbekannt = array_append(unbekannt, 'liste') WHERE NOT ('liste' = ANY (unbekannt));
