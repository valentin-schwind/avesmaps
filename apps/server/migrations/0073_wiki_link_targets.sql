-- Wiki-Linkziele je Artikel und Feld (Legacy-Export X1, je ARTIKEL, Legacy-Commit 04a85a54f) und Zuordnungstafel Wiki-Key -> Objekt
-- (Legacy-Export X2) (WI-0063 27.12, Vertrag `project-control/migration/contracts/wiki-link-targets.yaml`).
--
-- 🔴 Warum es das gibt: Ein Objekt, das in einem Wiki-Feld GENANNT wird, wird nur über seinen Wiki-Key zum Objektlink, nie über seinen Namen
-- (Betreiber 2026-10-05, AGENTS.md „Karteninteraktion“; Legacy `docs/abenteuer-feature-design.md` §5). Der Quelltext des Wikis trägt das Ziel
-- (`[[Reichsstraße 2|2]]`), unsere gespeicherten Felder tragen nur den Anzeigetext. X1 liefert je Artikel und Feld die Links samt Ziel und
-- KANONISCHEM Key (Namensraum und Weiterleitungen sind darin aufgelöst), X2 liefert je Kartenobjekt mit Wiki-Zuweisung denselben Key. X1 ist je
-- ARTIKEL (Betreiber 2026-10-05: „X1 je Artikel ja“): ein Weg in 56 Abschnitten steht einmal da, welche Objekte an einem Artikel hängen, sagt X2.
-- Beide Seiten laufen in Legacy durch dieselbe Funktion; hier wird nie ein Key gerechnet, nie einer aus einem Namen geraten und nichts zurück
-- umgeschrieben. `ziel` bleibt das rohe Linkziel mit Namensraum-Präfix, `target_key` der kanonische Key (`wiki:inoffiziell-…` gegen `wiki:…`).
--
-- Drei Tabellen, je eine Aussage, echte Fremdschlüssel nur dort, wo ein Elternteil besteht:
--   `wiki_key_assignment`  X2: je Kartenobjekt (Art und Kennung von Legacy) der kanonische Key. Kein Fremdschlüssel auf die Träger: Legacys
--                          Kennung ist je Art eine andere (Ort, Wegabschnitt, Kraftlinie, Beschriftung oder Landschaft, Gebiet), und der
--                          Leser löst sie zur Laufzeit gegen unsere Träger auf, statt eine Zeile für ein Objekt zu verlieren, das es hier
--                          (noch) nicht gibt. Gebiete stehen nur hier (X1 führt keine Gebiets-Infobox).
--   `wiki_link_page`       X1: der Artikel (ein Eintrag je Key; ein Weg mit 56 Abschnitten ist EIN Artikel).
--   `wiki_link_target`     X1: die Links eines Feldes dieser Seite, in der Reihenfolge des Quelltextes (Kindzeilen, ersetzt, nie angehäuft).
--
-- 🔴 Keine EAV-Tabelle, keine JSON-Spalte, keine `entity_type`-Haupttabelle. `field` ist der Name des Infobox-Feldes laut Legacys Positivliste
-- (Vokabular von Legacy, kein CHECK: ein neues Feld hielte sonst den Import an; der Prüfer meldet Felder, die kein Leser kennt).
-- `{{Pol|X}}` im Feld Staat und `{{Reg|X}}` im Feld Region sind Links (Betreiber 2026-10-05: „Pol/Reg ja“): `link_art` `vorlage` mit dem Namen der Vorlage in
-- `link_template`, Ziel X (Vorlage:Pol nennt als einzigen Parameter die übergeordnete politische Region, mehr behauptet das Ziel nicht); echte
-- Wikilinks tragen `link_art` `wikilink`. Alle anderen Vorlagen sind in Legacy keine Links und stehen hier nicht.
--
-- Gemeinsame Spalten der beiden führenden Tabellen (Vertrag `zielmodell.gemeinsame_spalten`): source_system, migration_run_id, imported_at,
-- is_active, retired_at, retired_origin (import | editor), created_at, updated_at. Stillgelegt wird, nie gelöscht. Kindzeilen tragen nur den
-- Anlagestempel.
--
-- Ablösung: `wiki_settlement_traffic_link` (Migration 0065; Verkehrswege der Orte, 55 Zeilen aus `verkehrswege_links` der Einzelzuweisung) liest
-- ab diesem Stand kein Leser mehr; X1 führt dieselbe Aussage für alle Arten. Die Tafel BLEIBT (erst erweitern, dann umstellen, dann entfernen:
-- AGENTS.md „Migrationen“), und der Prüfer meldet, ob X1 sie vollständig enthält. DROP frühestens nach dem Stage-Release des Umstellens.

-- X2: ZUORDNUNG --------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_key_assignment (
    id BIGSERIAL PRIMARY KEY,
    -- Legacys Art des Objekts. `region` ist eine BESCHRIFTUNG mit Wiki-Zuweisung (gebunden an eine Landschaft oder ein Gipfel), `landschaft`
    -- die Fläche einer Landschaftsebene (`ecosystem_region`), `gebiet` ein Herrschaftsgebiet.
    legacy_art TEXT NOT NULL,
    -- Legacys Kennung: bei Ort, Weg, Kraftlinie und Beschriftung die `public_id` des Kartenmerkmals, bei Landschaft die der Fläche, bei Gebiet
    -- die des Gebiets.
    object_public_id UUID NOT NULL,
    -- Der kanonische Key MIT Namensraum, wörtlich: `wiki:` plus Slug der Seite hinter der Weiterleitungstafel. Nie von uns gerechnet.
    wiki_key TEXT NOT NULL,
    -- Wörtlich, wie geliefert (kodiert). NULL, wo es nur einen gespeicherten Key gibt (Gebiet, Landschaft ohne Adresse).
    wiki_url TEXT,
    wiki_title TEXT,
    -- Der Namensraum der Seite (0 Hauptraum, 222 `Inoffiziell:`, 218 `DSK:`, 220 `Elf:`, 444 `Ilaris:`); NULL, wo er nicht ermittelbar ist
    -- (kein Raten aus dem Slug: `elf-volk` ist „Elf (Volk)“ im Hauptraum oder „Elf:Volk“ in 220).
    ns INTEGER,
    ns_name TEXT,
    -- Eine Weiterleitung hat den Key verändert: Titel und Namensraum der Zielseite (NULL, wo Legacys Dump die Seite nicht kennt).
    is_redirect BOOLEAN NOT NULL DEFAULT FALSE,
    redirect_title TEXT,
    redirect_ns INTEGER,
    redirect_ns_name TEXT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_key_assignment_object_unique UNIQUE (legacy_art, object_public_id),
    CONSTRAINT wiki_key_assignment_art_known CHECK (
        legacy_art IN ('siedlung', 'weg', 'region', 'kraftlinie', 'landschaft', 'gebiet')
    ),
    CONSTRAINT wiki_key_assignment_key_not_blank CHECK (btrim(wiki_key) <> ''),
    CONSTRAINT wiki_key_assignment_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS wiki_key_assignment_key ON wiki_key_assignment (wiki_key) WHERE is_active;

COMMENT ON TABLE wiki_key_assignment IS
    'Zuordnungstafel Wiki-Key -> Kartenobjekt (Legacy-Export X2): je zugewiesenem Objekt der kanonische Key mit Namensraum. Quelle des Lookups, über den ein Linkziel zu einem Objekt wird; nie aus einem Namen abgeleitet.';
COMMENT ON COLUMN wiki_key_assignment.wiki_key IS
    'Kanonischer Wiki-Key mit Namensraum (wiki:gareth, wiki:inoffiziell-kleewiesen), Legacys Rechnung wörtlich übernommen.';
COMMENT ON COLUMN wiki_key_assignment.ns IS
    'Namensraum der Seite; NULL, wo Legacy ihn nicht ermitteln kann. Wird nie aus dem Slug geraten.';

-- X1: ARTIKEL UND LINKZIELE -------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_link_page (
    id BIGSERIAL PRIMARY KEY,
    -- Der kanonische Key des Artikels: derselbe Schlüsselraum wie `wiki_key_assignment.wiki_key`. Alle Objekte desselben Artikels (die
    -- Abschnitte eines Wegs) teilen diese eine Zeile.
    page_key TEXT NOT NULL,
    page_title TEXT NOT NULL,
    -- Die Seitenart des Wiki-Dumps in Legacy (Positivliste der Felder je Art): settlement, building, region, path, powerline.
    page_kind TEXT NOT NULL,
    ns INTEGER NOT NULL,
    ns_name TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_link_page_key_unique UNIQUE (page_key),
    CONSTRAINT wiki_link_page_key_not_blank CHECK (btrim(page_key) <> '' AND btrim(page_title) <> ''),
    CONSTRAINT wiki_link_page_kind_known CHECK (page_kind IN ('settlement', 'building', 'region', 'path', 'powerline')),
    CONSTRAINT wiki_link_page_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE wiki_link_page IS
    'Ein Wiki-Artikel, dessen Infobox-Felder Legacy gelesen hat (X1), je kanonischem Key einmal. Eltern von wiki_link_target; ein Artikel ohne Links bleibt als Zeile stehen (gelesen, nichts verlinkt).';

CREATE TABLE IF NOT EXISTS wiki_link_target (
    id BIGSERIAL PRIMARY KEY,
    page_id BIGINT NOT NULL REFERENCES wiki_link_page (id),
    -- Name des Infobox-Feldes laut Legacys Positivliste (region, staat, oberhaupt, verkehrswege, lage, verlauf, nachbar_n …).
    field TEXT NOT NULL,
    -- Die Reihenfolge des Links im Feld (Quelltext).
    position INTEGER NOT NULL,
    -- Der Anzeigetext des Links, wie er im Feld steht; er ist nie Schlüssel. Bei einer Vorlage ist es das Ziel selbst.
    display_text TEXT NOT NULL,
    -- `wikilink` ([[Ziel|Anzeige]]) oder `vorlage` ({{Pol|X}} im Staat, {{Reg|X}} in der Region, Ziel X) und der Name der Vorlage.
    link_art TEXT NOT NULL,
    link_template TEXT,
    -- Das rohe Linkziel mit Namensraum-Präfix („Reichsstraße 2“, „Inoffiziell:Rossbergen“) und der kanonische Key.
    target_raw TEXT NOT NULL,
    target_key TEXT NOT NULL,
    target_ns INTEGER NOT NULL,
    target_ns_name TEXT NOT NULL,
    -- Eine Weiterleitung hat den Key verändert: Titel und Namensraum der Zielseite (NULL, wo Legacys Dump die Seite nicht kennt).
    is_redirect BOOLEAN NOT NULL DEFAULT FALSE,
    redirect_title TEXT,
    redirect_ns INTEGER,
    redirect_ns_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_link_target_position_unique UNIQUE (page_id, field, position),
    CONSTRAINT wiki_link_target_position_nonnegative CHECK (position >= 0),
    CONSTRAINT wiki_link_target_key_not_blank CHECK (btrim(target_key) <> '' AND btrim(display_text) <> '' AND btrim(field) <> ''),
    CONSTRAINT wiki_link_target_art_known CHECK (
        (link_art = 'wikilink' AND link_template IS NULL) OR (link_art = 'vorlage' AND link_template IS NOT NULL AND btrim(link_template) <> '')
    )
);

CREATE INDEX IF NOT EXISTS wiki_link_target_key ON wiki_link_target (target_key);

COMMENT ON TABLE wiki_link_target IS
    'Die Links eines Infobox-Feldes eines Wiki-Artikels (X1): Anzeigetext, rohes Ziel, Art (wikilink oder die Vorlagen Pol/Reg), kanonischer Key mit Namensraum, in der Reihenfolge des Quelltextes. Teil der Seite, kein eigener Träger. Andere Vorlagen sind keine Links.';
COMMENT ON COLUMN wiki_link_target.display_text IS
    'Anzeigetext wie im Feld; nie ein Schlüssel. Der Leser setzt den Link dorthin, wo dieser Text im angezeigten Feldtext steht.';
COMMENT ON COLUMN wiki_link_target.target_key IS
    'Kanonischer Key des Linkziels mit Namensraum (Weiterleitungen aufgelöst); trifft über wiki_key_assignment genau ein Objekt oder keins.';
