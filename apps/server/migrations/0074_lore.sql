-- Lore und Vorkommen (Flora, Fauna, Spezies, Handelswaren): Einträge, Ortsbezüge mit typisierten Zielen, Verbreitungsregeln als Daten,
-- Herkunftsvermerke und Quellenverknüpfungen (WI-0063 P3, Vertrag `project-control/migration/contracts/lore.yaml`, D5).
--
-- 🔴 Der EINTRAG (`lore_entry`) ist die Wurzel: ein Wiki-Artikel einer der vier Arten mit seinen Teilen (Ortszeilen, Regeln, Feldherkunft,
-- Quellen). Er trägt seine Identität (`wiki_key`, Legacys Slug des normalisierten Seitentitels, Namensraum gehört zum Schlüssel:
-- `inoffiziell-…` ist ein anderer Artikel als `…`), KEINE `public_id`. Wiki-Identität ist niemals automatisch Objektidentität: der
-- Schlüssel ist Information und Verbindung zum Artikel, nie ein Fremdschlüssel auf ein Kartenobjekt.
--
-- 🔴 Das ZIEL einer Ortszeile ist ein WIKI-ARTIKEL (Verbreitung, Herkunft, Regionen: „kommt in X vor“), kein Kartenobjekt. Ein Kartenobjekt
-- ist nur gemeint, wenn die Wiki-Zuordnung (D6, Migration 0065) es an genau diesen Artikel bindet. Anders als bei Werken und Karten kann
-- ein Artikel an mehreren Trägern hängen (Fasar bei Ort und Gebiet): `lore_place_target` trägt darum ALLE aktiven Treffer, je Zeile genau
-- EINEN typisierten Fremdschlüssel (Ort, Gebiet, Landschaft, Gipfel), und `target_state` sagt `resolved` (ein Treffer), `ambiguous`
-- (mehrere, keiner ausgezeichnet), `unresolved` (Kontinentbegriff ohne Träger: „gilt überall“) oder `unmatched` (kein aktiver Träger).
-- Aufgelöst wird NUR über den Wiki-Schlüssel, nie über einen Namen, einen Titel oder `match_key`; die Auflösung ist keine Redaktion und
-- wird bei jedem Lauf aus den Trägertabellen neu gerechnet (Tabelle statt Sicht: der Schritt steht in `legacy:update` nach den Trägern).
--
-- 🔴 Regeln sind DATEN, keine Anzeige: Legacys Lebensraum-Regeln (Fläche, Landschaftsart, Klimaspanne) samt Reihenfolge der Bedingungen.
-- Sie werden nicht ausgewertet (zurückgestellt bis zur Messung, Vertrag `regelauswertung`). Identität ist ein Inhalts-Fingerabdruck
-- (`rule_key`, SHA-256 über Eintrag, Beziehung und geordnete Bedingungskette), weil Legacy keine stabile Regelnummer liefert. Eine
-- gelöschte oder inaktive Fläche lässt die Bedingung STEHEN: `area_region_id` bleibt NULL, `legacy_area_public_id` hält die Kennung.
--
-- 🔴 Quellen leben im geteilten System (D1): `lore_entry_source` ist eine weitere Verknüpfungstabelle nach dem Muster von `place_source`
-- (Migration 0066), keine eigene Lore-Quellentabelle. Eine Quelle des Eintrags wird nie zur Quelle eines Ortes, einer Landschaft oder
-- eines Gebiets (WI-0063 5.5).
--
-- 🔴 Keine EAV-Tabelle, keine JSON-Spalte, keine `entity_type`-Haupttabelle, kein gespeicherter Gebietspfad, kein `place_kind` (Legacy
-- führt keins), kein `created_by`, keine `merkmale`- und keine `image_*`-Spalte: Die Merkmale der Infobox zeigt Legacys öffentliches
-- Panel nicht (der Prüfer zählt die Schlüssel), die Bilder haben offene Rechte und gehören, wenn sie kommen, dem Media Core.
--
-- Grenze zu WI-0068: Diese Migration legt Schema an. Geschrieben wird es vorerst nur vom Import (`migrate:lore`); kein Endpunkt ändert
-- Lore. `retired_origin editor`, `target_origin editor` und die Herkunft `editor` sind RESERVIERT: Legacy liefert sie nicht, der Import
-- schreibt sie nie aus eigenem Antrieb und überschreibt sie nie (Kapitel 9.37).
--
-- Gemeinsame Spalten (Vertrag `zielmodell.gemeinsame_spalten`): source_system, migration_run_id, imported_at, is_active, retired_at,
-- retired_origin (import | editor | legacy), created_at, updated_at. Stillgelegt wird, nie gelöscht. `state` (active | retired |
-- suppressed) ist die fachliche Aussage und bleibt mit `is_active` gleichlaufend (`state = 'active'` ⇔ `is_active`).
-- `retired_origin legacy` heißt: Legacy selbst führt die Zeile so (Eintrag `retired` „das Wiki kennt den Artikel nicht mehr“,
-- `suppressed` von Hand unterdrückt, Grabstein einer von Hand entfernten Ortszeile, unterdrückte Quellenverknüpfung); sie folgt bei jedem
-- Zug dem Stand der Quelle. `import` heißt: der Zug nennt die Zeile nicht mehr. `editor` (reserviert) fasst kein Import an.
--
-- Längen: Legacys Obergrenzen (Name 300, Lebensraum 500, Seiten 120, Notiz 200 und die übrigen) stehen hier NICHT als CHECK. Ein
-- längerer Quelltext würde sonst den ganzen Import anhalten (Betreiber 2026-10-03: nur selbst definierte Prüfungen halten an, wie in
-- 0065, 0066 und 0068); der Import meldet ihn als Befund `text_exceeds_legacy_limit` und speichert ihn unverändert.

-- EINTRAG -------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lore_entry (
    id BIGSERIAL PRIMARY KEY,
    -- Legacys wiki_key, wörtlich, nie neu gerechnet (Legacys Slug verschluckt Umlaute: aus Königreich wird k-nigreich).
    wiki_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    wiki_title TEXT,
    wiki_url TEXT,
    gruppe TEXT,
    -- Nur bei Waren belegt.
    typ TEXT,
    -- Freitext, KEIN Ort: die Orte stehen als Ortszeilen, die Regeln als Regeln.
    lebensraum TEXT,
    synonyme TEXT,
    -- Leer heißt „nicht erkannt“ (Legacy behandelt es wie Aventurien), nicht „kein Kontinent“.
    continent TEXT,
    -- Legacys GESPEICHERTER Vergleichsschlüssel für die Warenauflösung freier Handelswarennamen (Leser, P8): wird in Legacy nur beim Anlegen
    -- geschrieben und bei einer Umbenennung nicht nachgezogen, kann also veraltet sein. Wörtlich übernommen, nie nachgebaut.
    match_key TEXT,
    legacy_origin TEXT NOT NULL DEFAULT 'unknown',
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lore_entry_wiki_key_unique UNIQUE (wiki_key),
    CONSTRAINT lore_entry_wiki_key_not_blank CHECK (btrim(wiki_key) <> ''),
    CONSTRAINT lore_entry_kind_known CHECK (kind IN ('fauna', 'flora', 'spezies', 'ware')),
    CONSTRAINT lore_entry_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT lore_entry_text_not_blank CHECK (
        (wiki_title IS NULL OR btrim(wiki_title) <> '')
        AND (wiki_url IS NULL OR btrim(wiki_url) <> '')
        AND (gruppe IS NULL OR btrim(gruppe) <> '')
        AND (typ IS NULL OR btrim(typ) <> '')
        AND (lebensraum IS NULL OR btrim(lebensraum) <> '')
        AND (synonyme IS NULL OR btrim(synonyme) <> '')
        AND (continent IS NULL OR btrim(continent) <> '')
        AND (match_key IS NULL OR btrim(match_key) <> '')
    ),
    -- Eine Adresse geht als href an den Leser: nur http und https (Befund link_scheme_rejected).
    CONSTRAINT lore_entry_wiki_url_http CHECK (wiki_url IS NULL OR wiki_url ~* '^https?://'),
    CONSTRAINT lore_entry_legacy_origin_known CHECK (legacy_origin IN ('wiki', 'manual', 'unknown')),
    CONSTRAINT lore_entry_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT lore_entry_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT lore_entry_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'legacy'))
    )
);

CREATE INDEX IF NOT EXISTS lore_entry_kind ON lore_entry (kind) WHERE is_active;
CREATE INDEX IF NOT EXISTS lore_entry_match_key ON lore_entry (match_key) WHERE match_key IS NOT NULL;

COMMENT ON TABLE lore_entry IS
    'Lore-Eintrag (D5): ein Wiki-Artikel einer der Arten fauna, flora, spezies, ware. Wurzel mit Identität (wiki_key, keine public_id), geordneten Ortszeilen, Regeln, Feldherkunft und Quellen. Lore ist Kontext, kein Objektattribut (WI-0063 5.2).';
COMMENT ON COLUMN lore_entry.wiki_key IS
    'Legacys wiki_key, wörtlich (Slug des normalisierten Seitentitels; der Namensraum steht als Vorsilbe im Schlüssel). Information und Verbindung zum Artikel, nie ein Fremdschlüssel auf ein Kartenobjekt.';
COMMENT ON COLUMN lore_entry.lebensraum IS 'Freitext des Wiki-Artikels, KEIN Ort. Die Orte stehen in lore_place, die maschinenlesbare Fassung in lore_rule.';
COMMENT ON COLUMN lore_entry.match_key IS 'Legacys gespeicherter Vergleichsschlüssel (nur beim Anlegen geschrieben, kann nach einer Umbenennung veraltet sein); wörtlich, nie nachgebaut.';
COMMENT ON COLUMN lore_entry.legacy_origin IS 'wiki | manual | unknown (Legacys origin). Der Schutz je Feld steht in lore_entry_field_origin.';
COMMENT ON COLUMN lore_entry.state IS
    'active | retired (Legacy: das Wiki kennt den Artikel nicht mehr, retired_origin legacy; oder der Zug nennt den Eintrag nicht mehr, retired_origin import) | suppressed (von Hand unterdrückt, Legacy oder, reserviert, ein Editor). Nur active erscheint in einem Leser.';

-- Welches Feld eines Eintrags aus dem Wiki kam und welches von Hand gesetzt wurde (Legacys `field_origins`). Keine Werte, nur Herkunft;
-- die Werte stehen in den typisierten Spalten. Ein fehlender Eintrag heißt „nicht bekannt“, NIE „wiki“. Eine feste Liste von Feldnamen
-- (CHECK): das ist der Herkunftsvermerk aus Kapitel 9.38, keine EAV-Ablage. `merkmale` steht hier, obwohl der Wert nicht übernommen wird:
-- die Herkunft ist trotzdem eine Aussage.
CREATE TABLE IF NOT EXISTS lore_entry_field_origin (
    lore_entry_id BIGINT NOT NULL REFERENCES lore_entry (id),
    field TEXT NOT NULL,
    origin TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lore_entry_id, field),
    CONSTRAINT lore_entry_field_origin_field_known CHECK (
        field IN ('kind', 'wiki_title', 'wiki_url', 'name', 'gruppe', 'typ', 'lebensraum', 'synonyme', 'merkmale', 'continent')
    ),
    CONSTRAINT lore_entry_field_origin_origin_known CHECK (origin IN ('wiki', 'manual'))
);

COMMENT ON TABLE lore_entry_field_origin IS
    'Herkunftsvermerk je Feld eines Eintrags: wiki oder manual, ohne Werte. Ein fehlender Eintrag heißt nicht bekannt, nie wiki. Ein Feld mit Herkunft manual beschreibt ein künftiger Wiki-Abgleich nicht.';

-- ORTSZEILE -----------------------------------------------------------------------------------------------------------------

-- Schlüssel: (Eintrag, place_wiki_key, relation), Legacys uq_lore_place. Weder eine Zeilennummer noch `sort_order` ist Identität;
-- `sort_order` bricht nur die Reihenfolge (Wiki-Orte folgen der Reihenfolge im Artikel, von Hand hinzugefügte tragen 9999).
-- `key_class`, `target_state` und `target_count` sind ABGELEITET und werden bei jedem Lauf neu gerechnet; sie ändern kein Datum der Quelle.
CREATE TABLE IF NOT EXISTS lore_place (
    id BIGSERIAL PRIMARY KEY,
    lore_entry_id BIGINT NOT NULL REFERENCES lore_entry (id),
    -- Der Schlüssel des Wiki-Artikels, auf den die Zeile zeigt (Linkziel im Infobox-Feld), wörtlich.
    place_wiki_key TEXT NOT NULL,
    relation TEXT NOT NULL,
    -- Anzeigetitel des Linkziels; nur Anzeige, nie Schlüssel.
    place_title TEXT,
    sort_order INTEGER NOT NULL,
    key_class TEXT NOT NULL,
    target_state TEXT NOT NULL,
    target_count SMALLINT NOT NULL DEFAULT 0,
    -- `editor` ist RESERVIERT (Ziel von Hand gesetzt, erst nach dem Cutover möglich) und wird nie überschrieben.
    target_origin TEXT NOT NULL DEFAULT 'legacy_import',
    legacy_origin TEXT NOT NULL DEFAULT 'unknown',
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lore_place_key_unique UNIQUE (lore_entry_id, place_wiki_key, relation),
    CONSTRAINT lore_place_wiki_key_not_blank CHECK (btrim(place_wiki_key) <> ''),
    CONSTRAINT lore_place_title_not_blank CHECK (place_title IS NULL OR btrim(place_title) <> ''),
    CONSTRAINT lore_place_relation_known CHECK (relation IN ('verbreitung', 'vorkommen', 'herkunft', 'regionen')),
    CONSTRAINT lore_place_key_class_known CHECK (key_class IN ('continent', 'other')),
    CONSTRAINT lore_place_target_state_known CHECK (target_state IN ('resolved', 'ambiguous', 'unresolved', 'unmatched')),
    -- Zustand und Zahl der Ziele gehören zusammen: ein Treffer, mehrere oder keiner.
    CONSTRAINT lore_place_target_count_matches_state CHECK (
        (target_state = 'resolved' AND target_count = 1)
        OR (target_state = 'ambiguous' AND target_count > 1)
        OR (target_state IN ('unresolved', 'unmatched') AND target_count = 0)
    ),
    CONSTRAINT lore_place_target_origin_known CHECK (target_origin IN ('legacy_import', 'editor')),
    CONSTRAINT lore_place_legacy_origin_known CHECK (legacy_origin IN ('wiki', 'manual', 'unknown')),
    CONSTRAINT lore_place_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT lore_place_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT lore_place_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'legacy'))
    )
);

-- Rückwärts lesen: „welche Einträge gehören zu diesem Schlüssel“ (Kontinentbegriffe: Rang 3, ohne Ziel).
CREATE INDEX IF NOT EXISTS lore_place_wiki_key ON lore_place (place_wiki_key) WHERE is_active;

COMMENT ON TABLE lore_place IS
    'Ortszeile eines Eintrags (D5): dieser Wiki-Artikel kommt in, stammt aus oder wird gehandelt in dem Gegenstand, den ein anderer Wiki-Artikel beschreibt. Das Ziel ist ein Wiki-Artikel; die Kartenobjekte stehen in lore_place_target.';
COMMENT ON COLUMN lore_place.place_wiki_key IS 'Wiki-Schlüssel des Zielartikels, wörtlich. Der Namensraum gehört zum Schlüssel; ein Name, Titel oder match_key löst nie auf.';
COMMENT ON COLUMN lore_place.sort_order IS 'Legacys Reihenfolge (Wiki-Orte folgen dem Artikel, von Hand hinzugefügte tragen 9999), wörtlich; nie neu sortieren.';
COMMENT ON COLUMN lore_place.key_class IS 'continent (der Schlüssel steht in Legacys fester Kontinentliste: „gilt überall“, Rang 3 beim Lesen, nie verworfen) | other. Unabhängig vom Zustand.';
COMMENT ON COLUMN lore_place.target_state IS
    'resolved (genau ein aktiver Träger trägt den Schlüssel) | ambiguous (mehrere, ALLE in lore_place_target, keiner ausgezeichnet) | unresolved (Kontinentbegriff ohne Träger) | unmatched (kein aktiver Träger). Wird bei jedem Lauf aus den Trägertabellen neu gerechnet.';
COMMENT ON COLUMN lore_place.target_count IS 'Zahl der Zeilen in lore_place_target.';
COMMENT ON COLUMN lore_place.target_origin IS 'legacy_import | editor (RESERVIERT: Ziel von Hand gesetzt, wird von keinem Import überschrieben).';
COMMENT ON COLUMN lore_place.state IS 'active | retired (der Zug nennt die Zeile nicht mehr) | suppressed (Grabstein einer von Hand entfernten Wiki-Ortszeile, folgt dem Stand der Quelle).';

-- ZIELE DER ORTSZEILE -------------------------------------------------------------------------------------------------------

-- Je Ziel genau EIN typisierter Fremdschlüssel (echte Fremdschlüssel, keine entity_type-Spalte). Abgeleitet: bei jedem Lauf aus den
-- Trägern neu gerechnet, Kindzeilen ihrer Ortszeile (gelöscht und neu geschrieben, wenn sich die Treffermenge ändert).
CREATE TABLE IF NOT EXISTS lore_place_target (
    id BIGSERIAL PRIMARY KEY,
    lore_place_id BIGINT NOT NULL REFERENCES lore_place (id),
    place_id BIGINT REFERENCES place (id),
    territory_id BIGINT REFERENCES territory (id),
    region_id BIGINT REFERENCES region (id),
    terrain_peak_id BIGINT REFERENCES terrain_peak (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lore_place_target_one_target CHECK (num_nonnulls(place_id, territory_id, region_id, terrain_peak_id) = 1)
);

-- Je Fremdschlüssel höchstens eine Zeile je Ortszeile; zugleich der Leseweg „welche Ortszeilen treffen diesen Ort / dieses Gebiet /
-- diese Landschaft / diesen Gipfel“.
CREATE UNIQUE INDEX IF NOT EXISTS lore_place_target_place ON lore_place_target (place_id, lore_place_id) WHERE place_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lore_place_target_territory ON lore_place_target (territory_id, lore_place_id) WHERE territory_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lore_place_target_region ON lore_place_target (region_id, lore_place_id) WHERE region_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lore_place_target_peak ON lore_place_target (terrain_peak_id, lore_place_id) WHERE terrain_peak_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lore_place_target_lore_place ON lore_place_target (lore_place_id);

COMMENT ON TABLE lore_place_target IS
    'Kartenobjekte, die den Wiki-Schlüssel einer Ortszeile tragen (D5): Ort, Gebiet, Landschaft oder Gipfel, je Zeile genau ein Fremdschlüssel. Alle aktiven Treffer werden gespeichert, keiner ausgezeichnet. Abgeleitet, bei jedem Lauf neu gerechnet; ein Leser prüft die Aktivität des Trägers beim Lesen.';

-- REGELN --------------------------------------------------------------------------------------------------------------------

-- Eine Regel ist der maschinenlesbare Zwilling des Freitextfelds `lebensraum`: eine Beschreibung statt einer Aufzählung von Orten. Sie
-- wird als DATEN übernommen und nicht ausgewertet. Identität: `rule_key` (SHA-256 hex über relation und die geordnete Kette der
-- Bedingungen in kanonischer Schreibweise); eine geänderte Regel ist eine neue Identität, die alte wird stillgelegt.
CREATE TABLE IF NOT EXISTS lore_rule (
    id BIGSERIAL PRIMARY KEY,
    lore_entry_id BIGINT NOT NULL REFERENCES lore_entry (id),
    rule_key TEXT NOT NULL,
    relation TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    legacy_origin TEXT NOT NULL DEFAULT 'unknown',
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lore_rule_key_unique UNIQUE (lore_entry_id, rule_key),
    CONSTRAINT lore_rule_key_format CHECK (rule_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT lore_rule_relation_known CHECK (relation IN ('verbreitung', 'vorkommen', 'herkunft', 'regionen')),
    CONSTRAINT lore_rule_legacy_origin_known CHECK (legacy_origin IN ('manual', 'wiki_verbreitung', 'unknown')),
    CONSTRAINT lore_rule_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT lore_rule_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT lore_rule_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'legacy'))
    )
);

COMMENT ON TABLE lore_rule IS
    'Lebensraum-Regel eines Eintrags (D5), als Daten. Nicht ausgewertet: die Auswertung ist zurückgestellt, bis eine Messung zeigt, dass Regeln Treffer liefern, die die Wiki-Verknüpfungen nicht liefern.';
COMMENT ON COLUMN lore_rule.rule_key IS 'SHA-256 (hex) über Beziehung und geordnete Bedingungskette in kanonischer Schreibweise. Legacy exportiert keine stabile Regelnummer (lore_rule.id ändert sich bei „Regeln ableiten“).';
COMMENT ON COLUMN lore_rule.legacy_origin IS 'manual (Editor) | wiki_verbreitung (Ableitung „Regeln ableiten“) | unknown. Wer eine Regel speichert, dem gehört sie.';

-- Die Bedingungen einer Regel: eine geordnete Kette, strikt von links nach rechts ohne Klammern verknüpft (`join_op`; der Wert der ersten
-- Bedingung ist bedeutungslos). Innerhalb einer Bedingung wirkt immer UND: Fläche, Landschaftsart (Paare Ebene und Art, untereinander
-- ODER) und Klimaspanne. Ein leeres Feld schränkt nicht ein.
CREATE TABLE IF NOT EXISTS lore_rule_term (
    id BIGSERIAL PRIMARY KEY,
    lore_rule_id BIGINT NOT NULL REFERENCES lore_rule (id),
    -- Legacys seq, 0-basiert, die Auswertungsreihenfolge; nie neu sortiert.
    seq SMALLINT NOT NULL,
    join_op TEXT NOT NULL DEFAULT 'und',
    -- Die Fläche ist eine AUSSAGE des Editors, kein Verweis, der mitstirbt: eine gelöschte oder inaktive Fläche lässt die Bedingung stehen
    -- (NULL), die Kennung aus Legacy bleibt als Text.
    area_region_id BIGINT REFERENCES region (id),
    legacy_area_public_id TEXT,
    -- Beide Endpunkte der Spanne oder keiner. Ein unbekannter oder nur ein Endpunkt heißt in Legacy „keine Einschränkung“: dann beide NULL.
    climate_from TEXT REFERENCES climate_zone_type (type_key),
    climate_to TEXT REFERENCES climate_zone_type (type_key),
    legacy_climate_from TEXT,
    legacy_climate_to TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lore_rule_term_seq_unique UNIQUE (lore_rule_id, seq),
    CONSTRAINT lore_rule_term_seq_nonnegative CHECK (seq >= 0),
    CONSTRAINT lore_rule_term_join_op_known CHECK (join_op IN ('und', 'oder')),
    CONSTRAINT lore_rule_term_climate_pair CHECK ((climate_from IS NULL) = (climate_to IS NULL)),
    CONSTRAINT lore_rule_term_legacy_not_blank CHECK (
        (legacy_area_public_id IS NULL OR btrim(legacy_area_public_id) <> '')
        AND (legacy_climate_from IS NULL OR btrim(legacy_climate_from) <> '')
        AND (legacy_climate_to IS NULL OR btrim(legacy_climate_to) <> '')
    )
);

CREATE INDEX IF NOT EXISTS lore_rule_term_area ON lore_rule_term (area_region_id) WHERE area_region_id IS NOT NULL;

COMMENT ON TABLE lore_rule_term IS 'Eine Bedingung einer Regel (D5): Fläche, Landschaftsarten und Klimaspanne, in der Reihenfolge der Auswertung (seq).';
COMMENT ON COLUMN lore_rule_term.legacy_area_public_id IS 'Die Kennung der Fläche (Legacys ecosystem_region.public_id) als Text; bleibt, wenn die Fläche nicht (mehr) aktiv ist.';

-- Die Landschaftsarten einer Bedingung: Paare aus Ebene und Art, untereinander ODER. Teil ihrer Bedingung (fällt mit ihr).
CREATE TABLE IF NOT EXISTS lore_rule_term_type (
    lore_rule_term_id BIGINT NOT NULL REFERENCES lore_rule_term (id) ON DELETE CASCADE,
    region_layer TEXT NOT NULL,
    region_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lore_rule_term_id, region_layer, region_type),
    CONSTRAINT lore_rule_term_type_layer_known CHECK (region_layer IN ('derographisch', 'vegetation', 'topographie', 'klima')),
    CONSTRAINT lore_rule_term_type_not_blank CHECK (btrim(region_type) <> '')
);

COMMENT ON TABLE lore_rule_term_type IS 'Landschaftsart einer Bedingung: Ebene (wie region.region_layer) und Art (wörtlich, wie region.region_type).';

-- QUELLEN -------------------------------------------------------------------------------------------------------------------

-- Verknüpfung Eintrag - Quelle, nach dem Muster von `place_source` (Migration 0066): (Eintrag, Quelle) eindeutig, `reference_kind` NULL
-- ist eine ECHTE QUELLE, gesetzt ist eine PUBLIKATION; `position` ist Legacys Anzeigereihenfolge (offizielle zuerst, dann Anlage).
-- `state suppressed` ist der Tombstone einer von Hand entfernten Wiki-Publikationsverknüpfung (E2+); sie folgt dem Stand der Quelle,
-- solange kein Editor entschieden hat.
CREATE TABLE IF NOT EXISTS lore_entry_source (
    id BIGSERIAL PRIMARY KEY,
    lore_entry_id BIGINT NOT NULL REFERENCES lore_entry (id),
    source_id BIGINT NOT NULL REFERENCES feature_source (id),
    reference_kind TEXT,
    pages TEXT,
    note TEXT,
    -- Legacys Herkunft der Verknüpfung: wiki_publication | manual | unknown.
    legacy_origin TEXT NOT NULL DEFAULT 'unknown',
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lore_entry_source_pair_unique UNIQUE (lore_entry_id, source_id),
    CONSTRAINT lore_entry_source_reference_kind_known CHECK (
        reference_kind IS NULL OR reference_kind IN ('ausfuehrlich', 'ergaenzend', 'erwaehnung')
    ),
    CONSTRAINT lore_entry_source_legacy_origin_known CHECK (legacy_origin IN ('wiki_publication', 'manual', 'unknown')),
    CONSTRAINT lore_entry_source_position_nonnegative CHECK (position >= 0),
    CONSTRAINT lore_entry_source_text_not_blank CHECK (
        (pages IS NULL OR btrim(pages) <> '') AND (note IS NULL OR btrim(note) <> '')
    ),
    CONSTRAINT lore_entry_source_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT lore_entry_source_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT lore_entry_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'legacy'))
    )
);

CREATE INDEX IF NOT EXISTS lore_entry_source_source ON lore_entry_source (source_id);

COMMENT ON TABLE lore_entry_source IS
    'Verknüpfung Lore-Eintrag - Quelle (D5): die Aussage des Eintrags mit Art, Seiten, Notiz und Reihenfolge, am geteilten Katalog feature_source (D1). Wird nie an Ort, Landschaft oder Gebiet vererbt.';
COMMENT ON COLUMN lore_entry_source.reference_kind IS 'NULL = echte Quelle (kein Eintrag in der Publikationsart); sonst ausfuehrlich | ergaenzend | erwaehnung. Fast alle Lore-Verknüpfungen sind Publikationen.';
COMMENT ON COLUMN lore_entry_source.legacy_origin IS 'wiki_publication | manual | unknown (Legacys origin der Verknüpfung, E2+).';
COMMENT ON COLUMN lore_entry_source.state IS 'active (approved) | retired (der Zug nennt sie nicht mehr) | suppressed (Tombstone einer von Hand entfernten Wiki-Publikationsverknüpfung, E2+).';
