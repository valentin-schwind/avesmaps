-- Die Stätten über Kennungen (WI-0134, Betreiberentscheid F1 = B vom 2026-10-10, Vertrag `staetten.yaml` Version 2). Quellen: Legacys
-- Rohquellen-Export der Stätten (X4 `staetten-rohquellen-export.php`) und die Ergänzung von X3 um die Linkziele der `standort`-Kette
-- (`standort_links`). Anfrage: `project-control/legacy-requests/2026-10-10-staetten-rohquellen-export.md`.
--
-- 🔴 ERWEITERN, NICHT UMSTELLEN (AGENTS.md „Migrationen“): Diese Migration legt nur neue Tabellen an. `settlement_place` (0078) bleibt
-- unverändert und bleibt die Quelle der heutigen Leser (Panelzeile „Stätten“, Ortsliste), bis diese in einem eigenen Release umgestellt
-- werden; entfernt wird sie frühestens danach. Bis dahin füllt I27 beide: `settlement_place` wie bisher aus `in_settlement_places`, die
-- Tabellen hier aus X4.
--
-- 🔴 OBJEKT, BEZIEHUNG UND EVIDENZ GETRENNT (WI-0134 §3 Regel 1):
--   site                 die Stätte als OBJEKT, mit Legacys eigener Kennung je Quelle
--   site_settlement      die INNERORTS-BEZIEHUNG: nur aus einer gespeicherten Kennung (P1 `innerorts.ort`, P2 `settlement_public_id`)
--                        oder aus der Entscheidung eines Menschen in Avesmaps3D
--   site_named_place     die EVIDENZ: ein Ort, den die Kette der Stätte nennt (Linkziel mit Key). Nie eine Beziehung: ein Link auf einen
--                        Ort heißt nicht „innerorts“ (Betreiber 2026-10-10)
-- dazu für die Bauwerke der Registry (P3a, X3) `wiki_settlement_registry_named_place`, dieselbe Evidenz an der Registry-Zeile.
--
-- 🪤 Ob ein genannter Ort ein Kartenort ist, steht NICHT hier: das fragt der Leser zur Laufzeit über den Key gegen die Zuordnung X2
-- (`wiki_key_assignment`), wie bei der Registry (0089). Eine gespeicherte Antwort wäre beim nächsten zugewiesenen Ort falsch.
--
-- Keine JSON-Spalte, kein `entity_type`, kein `scope`, kein `is_outside`, kein Lageurteil (Legacys in/bei/unklar kommt nicht mit).

CREATE TABLE IF NOT EXISTS site (
    id BIGSERIAL PRIMARY KEY,
    -- Legacys Quelle: punkt (P1 Kartenpunkt mit `innerorts`), gespeichert (P2 `settlement_place`), weg (P3b `wiki_path_staging`),
    -- sitz (P3c `wiki_organisation_seat`), stadtteil (P3d Stadtteilweiterleitung). Die Registry-Bauwerke (P3a) stehen in
    -- `wiki_settlement_registry`, nicht hier.
    source_kind TEXT NOT NULL,
    -- Legacys eigene Kennung der Zeile: P1 und P2 die `public_id`, P3b der Wege-Key, P3c Organisation und Ortsangabe (getrennt durch
    -- U+001F; Legacy hat für einen Sitz keine stabile Kennung), P3d der Titel der Weiterleitung. Nie ein Name einer Stadt, nie eine Adresse.
    source_key TEXT NOT NULL,
    name TEXT NOT NULL,
    -- Nur P1: Legacys Ortsgröße des Punkts (gebaeude, stadtviertel).
    site_class TEXT,
    -- Legacys Art, bereinigt um den Rest des Importfehlers (WI-0122, `cleanPlaceType`); NULL heißt: Legacy nennt keine.
    site_type TEXT,
    -- Nur P3c: die Rolle wörtlich (hauptsitz, zweigsitz) und die Reihenfolge der Sitze im Artikel.
    seat_role TEXT,
    seat_order INTEGER,
    wiki_url TEXT,
    -- Der kanonische Key des EIGENEN Artikels, wörtlich aus Legacy (Regel von X1/X2). Nie gerechnet; P3d trägt nie einen (Regel 6: der Key
    -- einer Stadtteilweiterleitung ist der Key ihrer Stadt).
    wiki_key TEXT,
    -- Die rohe Ortsangabe der Quelle: Lage (Weg), Sitz-Ort (Organisation), Standort (Stadtteil). Ihre Linkziele stehen in site_named_place.
    raw_location TEXT,
    -- Nur P2: Legacys Herkunft der gespeicherten Stätte (`origin`, etwa garetien).
    source_origin TEXT,
    -- Nur P1: der Punkt steht in Legacy auf der Karte (aktiv); ein von der Karte genommener bleibt Stätte und trägt FALSE.
    on_map BOOLEAN NOT NULL DEFAULT FALSE,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT site_source_unique UNIQUE (source_kind, source_key),
    CONSTRAINT site_source_kind_known CHECK (source_kind IN ('punkt', 'gespeichert', 'weg', 'sitz', 'stadtteil')),
    CONSTRAINT site_not_blank CHECK (btrim(source_key) <> '' AND btrim(name) <> ''),
    CONSTRAINT site_text_not_blank CHECK (
        (site_class IS NULL OR btrim(site_class) <> '')
        AND (site_type IS NULL OR btrim(site_type) <> '')
        AND (seat_role IS NULL OR btrim(seat_role) <> '')
        AND (wiki_url IS NULL OR btrim(wiki_url) <> '')
        AND (wiki_key IS NULL OR btrim(wiki_key) <> '')
        AND (raw_location IS NULL OR btrim(raw_location) <> '')
        AND (source_origin IS NULL OR btrim(source_origin) <> '')
    ),
    -- Eine Adresse geht als href an den Leser: nur http und https (wie 0078, 0089).
    CONSTRAINT site_wiki_url_http CHECK (wiki_url IS NULL OR wiki_url ~* '^https?://'),
    CONSTRAINT site_class_only_point CHECK (site_class IS NULL OR source_kind = 'punkt'),
    CONSTRAINT site_seat_only_seat CHECK (
        (source_kind = 'sitz' AND seat_role IS NOT NULL AND seat_order IS NOT NULL)
        OR (source_kind <> 'sitz' AND seat_role IS NULL AND seat_order IS NULL)
    ),
    CONSTRAINT site_on_map_only_point CHECK (NOT on_map OR source_kind = 'punkt'),
    -- Regel 6: die Identität einer Weiterleitung ist ihr Titel, nie der Key ihrer Adresse.
    CONSTRAINT site_redirect_without_key CHECK (source_kind <> 'stadtteil' OR wiki_key IS NULL),
    CONSTRAINT site_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    ),
    CONSTRAINT site_source_system_not_blank CHECK (btrim(source_system) <> '')
);

-- „Welche Stätten nennen diesen Artikel als ihren eigenen“ (die Sitze einer Organisation teilen ihn).
CREATE INDEX IF NOT EXISTS site_wiki_key ON site (wiki_key) WHERE is_active AND wiki_key IS NOT NULL;

COMMENT ON TABLE site IS
    'Stätte als Objekt (WI-0134): je Zeile einer Legacy-Quelle (P1 Punkt, P2 gespeichert, P3b Weg, P3c Sitz, P3d Stadtteil) mit Legacys eigener Kennung. Zwei Sitze einer Organisation sind zwei Zeilen. Die Beziehung zu einem Ort steht in site_settlement, die genannten Orte in site_named_place.';
COMMENT ON COLUMN site.source_key IS
    'Legacys eigene Kennung je Quelle: public_id (punkt, gespeichert), Wege-Key (weg), Organisation U+001F Ortsangabe (sitz), Titel der Weiterleitung (stadtteil). Nie ein Name einer Stadt, nie eine Adresse.';
COMMENT ON COLUMN site.wiki_key IS
    'Kanonischer Key des eigenen Artikels, wörtlich aus Legacy. Bei stadtteil immer NULL: der Key einer Stadtteilweiterleitung ist der Key ihrer Stadt.';


CREATE TABLE IF NOT EXISTS site_settlement (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES site (id),
    -- Legacys GESPEICHERTE Kennung der Siedlung (P1 `innerorts.ort`, P2 `settlement_public_id`). NULL mit einer Herkunft ist eine
    -- Entscheidung „keine Stadt“ (P1: `field_origins.innerorts` ohne Wert) und bleibt stehen.
    settlement_legacy_public_id UUID,
    -- Der Ort, den diese Kennung trifft (aktiver Ort mit `place.public_id` = Kennung); NULL, wenn sie keinen trifft. Gesetzt wird er nur aus
    -- der Kennung oder von einem Menschen, nie aus einem Namen, einer Adresse oder einem Linkziel.
    place_id BIGINT REFERENCES place (id),
    -- Herkunft: manual und wiki (Legacys Stempel am Punkt), gespeichert (Legacy speichert die Kennung, ohne gestempelte Herkunft; alle P2),
    -- editor (ein Mensch in Avesmaps3D). Eine Zeile mit `editor` fasst kein Zug an (AGENTS.md, Betreiber 2026-10-10).
    origin TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Eine Beziehung je Stätte: ein Sitz in zwei Städten sind zwei Stätten.
    CONSTRAINT site_settlement_site_unique UNIQUE (site_id),
    CONSTRAINT site_settlement_origin_known CHECK (origin IN ('manual', 'wiki', 'gespeichert', 'editor')),
    -- Aus Legacy nur über die Kennung: ohne gespeicherte Kennung kein Ort (der Mensch wählt den Ort selbst, das ist seine Kennung).
    CONSTRAINT site_settlement_place_from_identifier CHECK (
        origin = 'editor' OR place_id IS NULL OR settlement_legacy_public_id IS NOT NULL
    ),
    CONSTRAINT site_settlement_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    ),
    CONSTRAINT site_settlement_source_system_not_blank CHECK (btrim(source_system) <> '')
);

-- „Die Stätten dieses Ortes“ (der künftige Leser des Panels und des Reiters „Innerorts“).
CREATE INDEX IF NOT EXISTS site_settlement_place ON site_settlement (place_id) WHERE is_active AND place_id IS NOT NULL;

COMMENT ON TABLE site_settlement IS
    'Innerorts-Beziehung einer Stätte (WI-0134 §3 Regel 2): nur aus Legacys gespeicherter Kennung (P1 innerorts.ort, P2 settlement_public_id) mit Herkunft, oder von einem Menschen in Avesmaps3D (origin editor, kein Zug überschreibt sie). Ein Linkziel erzeugt nie eine Zeile hier.';
COMMENT ON COLUMN site_settlement.settlement_legacy_public_id IS
    'Legacys gespeicherte Kennung der Siedlung. NULL mit Herkunft heißt: Entscheidung „keine Stadt“.';
COMMENT ON COLUMN site_settlement.place_id IS
    'Der aktive Ort, den die Kennung trifft (place.public_id); NULL, wenn sie keinen trifft. Nie aus Name, Adresse oder Linkziel.';


CREATE TABLE IF NOT EXISTS site_named_place (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES site (id),
    -- Die Reihenfolge des Linkziels in der Kette (Quelltext).
    position INTEGER NOT NULL,
    -- Das Linkziel wörtlich (der Titel vor einem `|`, nie die Anzeige) und Legacys kanonischer Key; NULL heißt: Legacy nennt keinen.
    target_raw TEXT NOT NULL,
    target_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT site_named_place_position_unique UNIQUE (site_id, position),
    CONSTRAINT site_named_place_position_nonnegative CHECK (position >= 0),
    CONSTRAINT site_named_place_not_blank CHECK (btrim(target_raw) <> '' AND (target_key IS NULL OR btrim(target_key) <> ''))
);

CREATE INDEX IF NOT EXISTS site_named_place_key ON site_named_place (target_key) WHERE target_key IS NOT NULL;

COMMENT ON TABLE site_named_place IS
    'Ein Ort, den die Kette einer Stätte nennt (Linkziel mit Key, Evidenz). Keine Beziehung: ob die Stätte darin oder dabei liegt, sagt der Text, und ein mehrdeutiger oder schlüsselloser Eintrag bindet nichts. Teil der Stätte, ersetzt mit ihrem Satz.';


CREATE TABLE IF NOT EXISTS wiki_settlement_registry_named_place (
    id BIGSERIAL PRIMARY KEY,
    registry_id BIGINT NOT NULL REFERENCES wiki_settlement_registry (id),
    position INTEGER NOT NULL,
    target_raw TEXT NOT NULL,
    target_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_settlement_registry_named_place_position_unique UNIQUE (registry_id, position),
    CONSTRAINT wiki_settlement_registry_named_place_position_nonnegative CHECK (position >= 0),
    CONSTRAINT wiki_settlement_registry_named_place_not_blank CHECK (
        btrim(target_raw) <> '' AND (target_key IS NULL OR btrim(target_key) <> '')
    )
);

CREATE INDEX IF NOT EXISTS wiki_settlement_registry_named_place_key
    ON wiki_settlement_registry_named_place (target_key) WHERE target_key IS NOT NULL;

COMMENT ON TABLE wiki_settlement_registry_named_place IS
    'Die Linkziele der standort-Kette einer Registry-Zeile (X3 standort_links): Ziel wörtlich und Legacys Key, in der Reihenfolge des Quelltexts. Evidenz, kein Urteil und keine Bindung.';
