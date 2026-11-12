-- Die Registry der Wiki-Siedlungen (WI-0128 E4, Legacy-Export X3 `wiki-siedlungen-export.php`, Betreiberentscheid 2026-10-10 „A“,
-- Anfrage `project-control/legacy-requests/2026-10-10-wiki-siedlungsregistry-export.md`).
--
-- 🔴 Warum es das gibt: Der Ortseditor führt wie Legacys Liste „Alle Siedlungen“ einen Reiter „Fehlt“, und dorthin gehören die Siedlungen,
-- die das Wiki kennt, die aber auf keinem Ort der Karte liegen. `wiki_settlement_snapshot` (Migration 0065) kennt nur Artikel, die schon an
-- einem Ort hängen, und X2 (`wiki_key_assignment`, Migration 0073) nur Zuweisungen. Legacys Registry `wiki_sync_pages` trägt alle; X3 liefert
-- ihre Ortszeilen (die sieben Ortsklassen) mit dem kanonischen Wiki-Key je Zeile.
--
-- 🔴 SCHLÜSSEL STATT NAMEN: Die Identität ist `wiki_key`, wörtlich aus Legacy und durch DIESELBE Regel gerechnet wie X1 `ziel_key` und X2
-- `wiki_key` (Titel → Weiterleitungstafel → `wiki:` + Slug, der Namensraum steckt im Key). Hier wird kein Key gerechnet und kein Name
-- verglichen. Ob eine Zeile „platziert“ ist, steht NICHT in dieser Tabelle: das entscheidet der Leser zur Laufzeit über denselben Key gegen
-- `wiki_key_assignment` und aktive Orte (`apps/server/src/editor/wiki-settlement-rows.ts`). Eine gespeicherte Spalte dafür wäre beim
-- nächsten Ort, den ein Editor setzt, falsch.
--
-- 🪤 Legacys eigenes Urteil „auf der Karte“ (`legacy_auf_karte`) vergleicht NAMEN (Kartenname oder Titel des Nests) und wird deshalb nicht
-- gespeichert; der Prüfer hält es als Befund gegen unsere Zahl (`registry_nur_per_name_platziert`).
--
-- Eine Zeile ohne Key wird nicht gespeichert (Befund), zwei Titel mit demselben Key (die Faltung der Umlaute ist verlustbehaftet, oder ein
-- Titel ist eine Weiterleitung auf den anderen) ergeben EINE Zeile, die erste nach Titel gilt (Befund). Vokabular von Legacy
-- (`settlement_class`, `building_type`) ohne CHECK: ein neuer Wert hielte sonst den Import an (Betreiber 2026-10-03), der Prüfer meldet ihn.
--
-- Gemeinsame Spalten wie bei den Nachbarn: source_system, migration_run_id, imported_at, is_active, retired_at, retired_origin (import | editor),
-- created_at, updated_at. Was Legacy nicht mehr nennt, wird stillgelegt, nie gelöscht.

CREATE TABLE IF NOT EXISTS wiki_settlement_registry (
    id BIGSERIAL PRIMARY KEY,
    -- Der kanonische Key MIT Namensraum, wörtlich aus Legacy (`wiki:gareth`, `wiki:inoffiziell-kleewiesen`). Identität.
    wiki_key TEXT NOT NULL,
    -- Der Titel der Registry (`wiki_sync_pages.title`), wörtlich; Anzeige, nie Schlüssel.
    title TEXT NOT NULL,
    -- Namensraum des Titels (0 Hauptraum, 222 `Inoffiziell:` …), NULL, wo Legacy keinen nennt.
    ns INTEGER,
    ns_name TEXT,
    -- Der Titel ist eine Weiterleitung, der Key ist der der Zielseite (Titel und Namensraum der Zielseite nennt X3 nur, wo Legacy sie kennt).
    is_redirect BOOLEAN NOT NULL DEFAULT FALSE,
    redirect_title TEXT,
    redirect_ns INTEGER,
    redirect_ns_name TEXT,
    wiki_url TEXT,
    -- Legacys Ortsklasse, wörtlich: metropole, grossstadt, stadt, kleinstadt, dorf, gebaeude, stadtviertel.
    settlement_class TEXT NOT NULL,
    settlement_label TEXT,
    -- Bei Bauwerken die Art aus der Wiki-Kategorie (Festung, Tempel …), wörtlich.
    building_type TEXT,
    -- Legacys Ortsliste blendet diese Zeile aus (lineare Infrastruktur: Straße, Mauer, Damm …, `avesmapsWikiSettlementIsExcludedBuildingType`).
    building_type_excluded BOOLEAN NOT NULL DEFAULT FALSE,
    -- NULL heißt: Legacy hat die Seite noch nicht angereichert.
    is_ruined BOOLEAN,
    continent TEXT,
    -- „Region · Staat“, wie Legacys Infobox-Parser es zusammensetzt; Region und Staat einzeln trägt die Registry nicht.
    lage TEXT,
    -- Bei Bauwerken das rohe `|Standort=` der Infobox („[[Gareth]]: [[Arenaviertel]]“), Grundlage von innerorts/außerorts.
    standort TEXT,
    -- Die Registry nennt ein Wappen. Die Adresse selbst geht nicht mit (Medien sind Sache von E5).
    has_coat BOOLEAN NOT NULL DEFAULT FALSE,
    -- Stand des Abgleichs in Legacy, naiv wie geliefert (die Zone des Legacy-Servers ist nicht belegt): abgerufen und angereichert.
    wiki_fetched_at TIMESTAMP,
    wiki_enriched_at TIMESTAMP,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_settlement_registry_key_unique UNIQUE (wiki_key),
    CONSTRAINT wiki_settlement_registry_not_blank CHECK (
        btrim(wiki_key) <> '' AND btrim(title) <> '' AND btrim(settlement_class) <> ''
    ),
    CONSTRAINT wiki_settlement_registry_text_not_blank CHECK (
        (wiki_url IS NULL OR btrim(wiki_url) <> '')
        AND (settlement_label IS NULL OR btrim(settlement_label) <> '')
        AND (building_type IS NULL OR btrim(building_type) <> '')
        AND (continent IS NULL OR btrim(continent) <> '')
        AND (lage IS NULL OR btrim(lage) <> '')
        AND (standort IS NULL OR btrim(standort) <> '')
    ),
    -- Eine Adresse geht als href an den Leser: nur http und https (wie 0074, 0078).
    CONSTRAINT wiki_settlement_registry_wiki_url_http CHECK (wiki_url IS NULL OR wiki_url ~* '^https?://'),
    CONSTRAINT wiki_settlement_registry_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE wiki_settlement_registry IS
    'Wiki-Siedlungen aus Legacys Registry wiki_sync_pages (Export X3), je kanonischem Wiki-Key eine Zeile. Ob eine Zeile auf der Karte liegt, entscheidet der Leser über denselben Key gegen wiki_key_assignment und aktive Orte; nie über einen Namen.';
COMMENT ON COLUMN wiki_settlement_registry.wiki_key IS
    'Kanonischer Wiki-Key mit Namensraum, Legacys Rechnung wörtlich (dieselbe Regel wie X1 ziel_key und X2 wiki_key).';
COMMENT ON COLUMN wiki_settlement_registry.building_type_excluded IS
    'Legacys Ortsliste blendet die Zeile aus (lineare Infrastruktur, vom Bauwerks-Crawl als Gebäude eingetragen). Der Leser folgt ihr.';
COMMENT ON COLUMN wiki_settlement_registry.lage IS
    'Region · Staat aus Legacys Infobox-Parser, zusammengesetzt; leer heißt unbekannt.';
