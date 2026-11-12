-- 0238: Der Stand des Syncs je Objekt – die Wiki-Box im Objekteditor (WI-0253, Scheibe „Objekt-Sync am WikiFeld“, Betreiber 2026-10-25: „perfekt das wollen wir“).
--
--   Die Box zeigt am Objekt, wann zuletzt gesynct wurde, mit welchem Ergebnis und wer es war (eine Person oder der automatische WikiSync-Lauf), und bei einer Drosselung des Wikis (429), bis wann ein
--   neuer Sync gesperrt ist. Das ist ein Protokoll, nie ein Fachwert: Keine Fachtafel liest es, kein Wert der Karte hängt daran.
--
-- Eine Zeile je Objekt (`art`, `objekt_id`: die öffentliche Kennung des Orts, des Wegabschnitts, des Gebiets, der Landschaft, des Kraftlinienabschnitts; ein Weg, eine Kraftlinie oder eine Landschaft
-- aus mehreren Abschnitten trägt die Zeile an jedem davon). Zwei Teile, damit ein gescheiterter Versuch den letzten Erfolg nicht überschreibt:
--
-- 1. der letzte ERFOLG (`am` bis `wiki_stand`): Zeit, Ergebnis (`uebernommen`: Felder wurden angewendet · `stand`: nur der Wiki-Stand wurde nachgezogen, alle Felder behalten eigene Werte ·
--    `keine_aenderung`: das Wiki hatte nichts Neues), die Felder, die sich änderten, und der Auslöser (`automatisch` = der Lauf der Übernahme, sonst die Person oder ein Werkzeug);
-- 2. der letzte FEHLSCHLAG (`fehler_am` bis `frei_ab`), der mit dem nächsten Erfolg fällt: Code (`http_429`, `pausiert`, `verbindung`, `nicht_im_wiki` …) und das Ende der Pause.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue Tafel, die das vorige Release nie liest; keine Datenänderung an einer Fachtafel. Rechte: `apps/server/src/db/system-grants.psql` (hinter JEDE Migration):
-- Die App liest, die Jobs-Rolle schreibt (der Auftrag `wiki_artikel` mit Objekt und die Übernahme des WikiSync).

CREATE TABLE IF NOT EXISTS wikisync_objekt (
    art TEXT NOT NULL CHECK (art IN ('ort', 'weg', 'gebiet', 'region', 'kraftlinie')),
    objekt_id UUID NOT NULL,
    -- Der letzte Erfolg.
    am TIMESTAMPTZ,
    ergebnis TEXT CHECK (ergebnis IS NULL OR ergebnis IN ('uebernommen', 'stand', 'keine_aenderung')),
    anzahl INTEGER CHECK (anzahl IS NULL OR anzahl >= 0),
    -- Die Felder des Plans (`name`, `einwohner`, `settlement_class` …), deren wirksamer Wert sich änderte; höchstens 40.
    felder TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(felder) <= 40),
    automatisch BOOLEAN NOT NULL DEFAULT FALSE,
    ausgeloest_von UUID,
    ausgeloest_label TEXT CHECK (ausgeloest_label IS NULL OR char_length(ausgeloest_label) <= 80),
    -- Die Fassung des Artikels, mit der gesynct wurde (nur beim Sync über die API).
    wiki_revision BIGINT,
    wiki_stand TIMESTAMPTZ,
    -- Der letzte Fehlschlag.
    fehler_am TIMESTAMPTZ,
    fehler_code TEXT CHECK (fehler_code IS NULL OR char_length(fehler_code) <= 64),
    fehler TEXT CHECK (fehler IS NULL OR char_length(fehler) <= 500),
    frei_ab TIMESTAMPTZ,
    job_public_id UUID,
    PRIMARY KEY (art, objekt_id),
    CONSTRAINT wikisync_objekt_erfolg_ganz CHECK ((am IS NULL) = (ergebnis IS NULL) AND (am IS NULL) = (anzahl IS NULL)),
    CONSTRAINT wikisync_objekt_fehler_ganz CHECK ((fehler_am IS NULL) = (fehler_code IS NULL)),
    CONSTRAINT wikisync_objekt_nicht_leer CHECK (am IS NOT NULL OR fehler_am IS NOT NULL)
);

COMMENT ON TABLE wikisync_objekt IS
    'Der Stand des Syncs je Objekt für die Wiki-Box (WI-0253): der letzte Erfolg (Zeit, Ergebnis, Felder, Auslöser: Person oder automatisch) und der letzte Fehlschlag (Code, Ende der Pause). Ein Protokoll, nie ein Fachwert.';
COMMENT ON COLUMN wikisync_objekt.objekt_id IS
    'Die öffentliche Kennung des Objekts: place, path (Abschnitt), territory, region oder powerline (Abschnitt).public_id; je nach art.';
