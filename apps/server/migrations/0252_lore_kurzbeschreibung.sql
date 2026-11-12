-- 0252: Ein Vorkommen führt eine Kurzbeschreibung aus seinem Wiki-Artikel (WI-0260, Infobox eines Vorkommens: Ware, Flora, Fauna, Spezies; Vali 2026-10-30: „ja das wär nett“).
--
--   Der WikiSync liest zu jedem Artikel mit einer der vier Infoboxen den Abschnitt „Kurzbeschreibung“ (sonst den ersten Absatz nach der Infobox) und kürzt ihn auf höchstens drei Sätze und
--   etwa 400 Zeichen (`wiki/infobox/kurzbeschreibung.ts`). Zitate und als Ulisses gekennzeichnete Inhalte lässt er weg. Der Text steht unter der Lizenz CC BY-SA 3.0 (Fuß des Wikis); die
--   Infobox zeigt die Lizenzzeile dazu. Das Feld folgt dem Wiki wie die übrigen Felder des Eintrags, nach Vermerk (`lore_entry_field_origin`) und mit einem Wiki-Stand (`wiki_lore_snapshot`):
--
--   1. `lore_entry.kurzbeschreibung`: der Text, NULL ohne Kurzbeschreibung. Wie bei den übrigen Feldern (0074) steht die Länge NICHT als CHECK: Der Leser kürzt, ein längerer Wert würde
--      sonst die Übernahme anhalten.
--   2. `wiki_lore_snapshot.kurzbeschreibung`: der Wiki-Wert hinter dem Feld (Rücknahme, „Änderung seit der letzten Übernahme“). NULL heißt, wie bei den anderen: das Wiki kennt nichts, wenn das Feld
--      nicht in `unbekannt` steht.
--   3. Drei Prüfungen lernen das Feld: `lore_entry_field_origin_field_known` (der Vermerk `wiki` oder `manual`), `wiki_lore_snapshot_text_not_blank` (kein leerer Text) und
--      `wiki_lore_snapshot_unbekannt_known`. Die Vorgabe von `wiki_lore_snapshot.unbekannt` nennt das Feld mit, und jeder bestehende Stand nennt es auch: Das Wiki wurde dazu noch nie gelesen.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): zwei nullbare Spalten, die das vorige Release nie liest und nie schreibt, und gelockerte Prüfungen (jedes bisherige Wort bleibt erlaubt). Das Eintragen
-- von `kurzbeschreibung` in `unbekannt` bestehender Stände ist die einzige Datenänderung; das vorige Release liest die Liste als Menge von Namen und ignoriert den, den es nicht kennt. Die Rechte
-- der Jobs-Rolle (UPDATE an der neuen Spalte beider Tafeln) stehen in `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

ALTER TABLE lore_entry ADD COLUMN IF NOT EXISTS kurzbeschreibung TEXT;

COMMENT ON COLUMN lore_entry.kurzbeschreibung IS
    'Kurzbeschreibung aus dem Wiki-Artikel (0252, WikiSync, WI-0260): reiner Text, höchstens drei Sätze und etwa 400 Zeichen, ohne Zitate und ohne Inhalte der Ulisses Medien & Spiel Distribution GmbH. Lizenz des Wikis: CC BY-SA 3.0. NULL: keine. Der Schutz steht in lore_entry_field_origin.';

ALTER TABLE wiki_lore_snapshot ADD COLUMN IF NOT EXISTS kurzbeschreibung TEXT;

COMMENT ON COLUMN wiki_lore_snapshot.kurzbeschreibung IS
    'Die Kurzbeschreibung laut Wiki (0252, WI-0260). NULL: das Wiki kennt keine oder der Stand kennt sie noch nicht (siehe unbekannt).';

ALTER TABLE lore_entry_field_origin DROP CONSTRAINT IF EXISTS lore_entry_field_origin_field_known;
ALTER TABLE lore_entry_field_origin
    ADD CONSTRAINT lore_entry_field_origin_field_known CHECK (
        field IN ('kind', 'wiki_title', 'wiki_url', 'name', 'gruppe', 'typ', 'lebensraum', 'synonyme', 'merkmale', 'continent', 'kurzbeschreibung')
    );

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
    );

ALTER TABLE wiki_lore_snapshot DROP CONSTRAINT IF EXISTS wiki_lore_snapshot_unbekannt_known;
ALTER TABLE wiki_lore_snapshot
    ADD CONSTRAINT wiki_lore_snapshot_unbekannt_known CHECK (
        unbekannt <@ ARRAY[
            'name', 'gruppe', 'typ', 'lebensraum', 'synonyme', 'continent', 'kurzbeschreibung', 'roh_verbreitung', 'roh_herkunft', 'roh_regionen', 'roh_vorkommen'
        ]::text[]
    );

ALTER TABLE wiki_lore_snapshot ALTER COLUMN unbekannt SET DEFAULT ARRAY[
    'name', 'gruppe', 'typ', 'lebensraum', 'synonyme', 'continent', 'kurzbeschreibung', 'roh_verbreitung', 'roh_herkunft', 'roh_regionen', 'roh_vorkommen'
]::text[];

-- Bestehende Stände haben die Kurzbeschreibung noch nie gelesen: Das Feld ist dort unbekannt, bis eine Übernahme es schreibt.
UPDATE wiki_lore_snapshot SET unbekannt = array_append(unbekannt, 'kurzbeschreibung') WHERE NOT ('kurzbeschreibung' = ANY (unbekannt));
