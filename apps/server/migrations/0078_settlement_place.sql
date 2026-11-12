-- Die Stätten eines Ortes (WI-0109, Vertrag `project-control/migration/contracts/staetten.yaml`, D7): was an besonderen Bauwerken IN
-- einem Ort liegt und keine eigene Kartenposition hat - Tempel, Stadtteile, Paläste, Garderegimenter, Flotten, Bibliotheken.
--
-- 🔴 DIE BINDUNG IST DER GEFALTETE SIEDLUNGSNAME, und das ist Legacys eigene Regel, nicht unsere Erfindung. Legacys Tabelle
-- `settlement_place` bindet intern über `settlement_public_id` (Finding MCS-012), aber ihr öffentlicher Export
-- (`in_settlement_places` in `api/app/map-features.php`) trägt je Eintrag nur `{name, settlement, type, wiki_url}` - den NAMEN der
-- Siedlung, keine Kennung. Und Legacys Leser faltet ihn genau so (`avesmapsStaettenSchluessel`: `trim().toLowerCase()`, bewusst
-- OHNE Umlaut-Abbildung, weil Stadtname und Ortsname aus derselben Quelle stammen). `settlement_key` ist dieser gefaltete Name,
-- `settlement_name` der wörtliche Wert des Exports (nur Anzeige).
--
-- 🪤 Darum steht hier KEIN `place_id`. Eine Spalte, die auf genau einen Ort zeigt, bräuchte eine Regel für den Fall, dass zwei Orte
-- denselben gefalteten Namen tragen - und die hat Legacy nicht: dort zeigen BEIDE Orte dieselben Stätten, weil der Eimer am Namen
-- hängt. Gemessen am 2026-10-08 ist der Fall leer (4.984 aktive Orte, 4.984 verschiedene gefaltete Namen; 493 der 495 genannten
-- Siedlungen treffen genau einen Ort, 2 keinen). Eine abgeleitete Spalte, die heute nichts entscheidet und morgen eine erfundene
-- Regel bräuchte, entsteht nicht; der Lesepfad vergleicht den Schlüssel, der Import meldet die Auflösung als Befund.
--
-- 🔴 IDENTITÄT: (`settlement_key`, `name`, `legacy_public_id`), mit `NULLS NOT DISTINCT`. Der Name allein ist es nicht: Legacy
-- entdoppelt die innerorts-PUNKTE ausdrücklich nicht gegeneinander („zwei gleichnamige Tempel sind zwei Tempel",
-- `avesmapsBuildInSettlementPlaceList`), und ein Punkt trägt als einziger eine eigene Kennung. Ohne sie im Schlüssel wären zwei
-- gleichnamige Punkte EINER Stadt ein Doppeleintrag; mit `NULLS NOT DISTINCT` bleiben die namenlos gebundenen Zeilen (Wiki-Ableitung
-- und gespeicherte Stätten, `legacy_public_id` NULL) weiter je Stadt und Name eindeutig - genau wie Legacys `UNIQUE KEY
-- (settlement_public_id, name)`.
--
-- 🔴 `place_type` ist WÖRTLICH Legacys `type`, auch leer (NULL). Legacys Rückfall „Bauwerk" ist ANZEIGE und steht bei uns in der
-- Sprachtafel (`infoPanel.staetten.fallbackType`), nicht in den Daten: ein erfundener Wert in der Spalte wäre beim nächsten Zug
-- nicht mehr von einem echten zu unterscheiden. Gemessen tragen 10 von 4.092 Einträgen keine Art.
--
-- 💣 DER HTML-DURCHSCHLAG IN DER ART BLEIBT STEHEN (Cutoff-Regel, AGENTS.md: was redaktionell falsch aussieht, wird befundet und
-- vorgelegt). `api/_internal/wiki/organisation-seats.php` entfernt `[[`/`]]` und schneidet dann mit `explode('/', $wert)[0]` - der
-- Schrägstrich im schließenden `</small>` ist der Schnitt. 14 Arten mit 36 Einträgen tragen Reste. Kein CHECK, kein Filter, keine
-- Korrektur: der Wert wird wörtlich gespeichert und wörtlich gezeigt (unsere Anzeige escapt, wie Legacys `escapeHtml`). Der Befund
-- steht in `staetten.yaml` -> `redaktionsbefund_html_in_arten`.
--
-- 🔴 `legacy_public_id` und `on_map` tragen NUR die innerorts-Punkte (die dritte Quelle des Exports, 25 von 4.092): sie sind
-- Kartenpunkte und bekommen im Panel den Sprung ⊕. Eine gespeicherte oder aus dem Wiki abgeleitete Stätte hat beides nicht.
-- `on_map` ist Legacys `auf_der_karte` - ein Punkt, der von der Karte genommen wurde, reist weiter mit, trägt aber FALSE und
-- bekommt keinen Sprung (gemessen: 2 von 25 stehen auf der Karte).
--
-- Längen: Legacys Obergrenzen (Name 190, Art 80, Adresse 500) stehen hier NICHT als CHECK - ein längerer Wert würde sonst den
-- ganzen Import anhalten (Betreiber 2026-10-03: nur selbst definierte Prüfungen halten an, wie in 0065, 0066, 0074).
--
-- Gemeinsame Spalten wie bei den Nachbarn: source_system, migration_run_id, imported_at, is_active, retired_at, retired_origin,
-- created_at, updated_at. Stillgelegt wird, nie gelöscht; `state` (active | retired) bleibt mit `is_active` gleichlaufend.
-- `retired_origin editor` ist RESERVIERT: Legacy liefert es nicht, der Import schreibt es nie und überschreibt es nie.

CREATE TABLE IF NOT EXISTS settlement_place (
    id BIGSERIAL PRIMARY KEY,
    -- Legacys Verbindungsschlüssel: der Siedlungsname, `trim().toLowerCase()` (avesmapsStaettenSchluessel).
    settlement_key TEXT NOT NULL,
    -- Der Siedlungsname wörtlich aus dem Export; nur Anzeige und Befund, nie Schlüssel.
    settlement_name TEXT NOT NULL,
    name TEXT NOT NULL,
    -- Legacys `type`, wörtlich; NULL heißt „Legacy nennt keine Art" (der Rückfall „Bauwerk" ist Anzeige).
    place_type TEXT,
    wiki_url TEXT,
    -- Nur innerorts-Punkte: die Kennung des Kartenpunkts, zu dem der Sprung ⊕ führt.
    legacy_public_id UUID,
    on_map BOOLEAN NOT NULL DEFAULT FALSE,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT settlement_place_key_unique UNIQUE NULLS NOT DISTINCT (settlement_key, name, legacy_public_id),
    CONSTRAINT settlement_place_settlement_not_blank CHECK (btrim(settlement_key) <> '' AND btrim(settlement_name) <> ''),
    -- Der Schlüssel IST der gefaltete Name: eine Zeile, die das verletzt, würde von keinem Ort gefunden.
    CONSTRAINT settlement_place_key_is_folded CHECK (settlement_key = lower(btrim(settlement_name))),
    CONSTRAINT settlement_place_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT settlement_place_text_not_blank CHECK (
        (place_type IS NULL OR btrim(place_type) <> '') AND (wiki_url IS NULL OR btrim(wiki_url) <> '')
    ),
    -- Eine Adresse geht als href an den Leser: nur http und https (Befund link_scheme_rejected, wie 0074).
    CONSTRAINT settlement_place_wiki_url_http CHECK (wiki_url IS NULL OR wiki_url ~* '^https?://'),
    -- `on_map` ist eine Aussage über einen Kartenpunkt: ohne Kennung gibt es keinen.
    CONSTRAINT settlement_place_on_map_needs_id CHECK (NOT on_map OR legacy_public_id IS NOT NULL),
    CONSTRAINT settlement_place_state_known CHECK (state IN ('active', 'retired')),
    CONSTRAINT settlement_place_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT settlement_place_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'legacy'))
    ),
    CONSTRAINT settlement_place_source_not_blank CHECK (btrim(source_system) <> '')
);

-- Der Leseweg des Panels: „die Stätten DIESES Ortes", nach Art und Name geordnet (Legacy gliedert nach Art, deutsch sortiert; die
-- Reihenfolge der Antwort ist damit schon fast die der Anzeige).
CREATE INDEX IF NOT EXISTS settlement_place_settlement
    ON settlement_place (settlement_key, place_type, name)
    WHERE is_active;

-- Der Sprung ⊕: von der Kennung des Kartenpunkts zum Ort. Nur die 25 Punkte tragen eine.
CREATE INDEX IF NOT EXISTS settlement_place_legacy_public_id
    ON settlement_place (legacy_public_id)
    WHERE legacy_public_id IS NOT NULL;

COMMENT ON TABLE settlement_place IS
    'Stätte eines Ortes (D7, WI-0109): ein besonderes Bauwerk IN einer Siedlung, ohne eigene Kartenposition. Gebunden über den gefalteten Siedlungsnamen (Legacys in_settlement_places trägt keine Kennung der Siedlung), nicht über einen Fremdschlüssel.';
COMMENT ON COLUMN settlement_place.settlement_key IS
    'Der Siedlungsname, trim().toLowerCase() - Legacys avesmapsStaettenSchluessel, wörtlich dieselbe Faltung. Der Lesepfad vergleicht ihn mit lower(btrim(place.name)).';
COMMENT ON COLUMN settlement_place.settlement_name IS 'Der Siedlungsname wörtlich aus dem Export; nur Anzeige und Befund.';
COMMENT ON COLUMN settlement_place.place_type IS
    'Legacys type, wörtlich (auch mit HTML-Resten aus organisation-seats.php, siehe Befund). NULL heißt: Legacy nennt keine Art; der Rückfall Bauwerk steht in der Sprachtafel.';
COMMENT ON COLUMN settlement_place.legacy_public_id IS
    'Nur innerorts-Punkte: die public_id des Kartenpunkts. Ziel des Sprungs ⊕ im Panel, aufgelöst beim Lesen gegen aktive place-Zeilen.';
COMMENT ON COLUMN settlement_place.on_map IS
    'Legacys auf_der_karte: der Punkt steht noch auf der Karte. Ein von der Karte genommener Punkt reist weiter mit, trägt FALSE und bekommt keinen Sprung.';
COMMENT ON COLUMN settlement_place.state IS
    'active | retired (der Zug nennt die Zeile nicht mehr, retired_origin import; editor ist reserviert). Nur active erscheint in einem Leser.';
