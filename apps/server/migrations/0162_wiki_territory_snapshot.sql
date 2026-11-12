-- 0162: Wiki-Schnappschuss der Herrschaftsgebiete (WI-0209; EDIT-0003 F24/G6, Entscheid der Orchestrierung 2026-10-18, Weg a).
--
--   Der Feldbaustein (`fenster/wiki-feld`) zeigt hinter dem Label den Wiki-Wert durchgestrichen, wenn der eigene Wert abweicht, und ↺ setzt
--   auf ihn zurück. Bei Orten, Wegen und Landschaften liegt der Wiki-Wert in einem Schnappschuss (`wiki_*_snapshot`, 0065). Den Gebieten
--   fehlte er: Legacys Export E4 liefert nur den WIRKSAMEN Wert (Override vor Wiki-Text, `territory-detail-felder.php`) und die Liste
--   der Felder mit Override (`detail_overrides`), nie den Wiki-Wert hinter einem Override (Befund an die Orchestrierung 2026-10-18).
--
--   Vorbild `wiki_region_snapshot` (0065): je Wiki-Artikel eine Zeile, gelesen über `territory.wiki_key = wiki_territory_snapshot.wiki_key`
--   ohne Fremdschlüssel (`territory.wiki_key` IST die Zuordnung, territories.yaml; die Adresse ist `territory.wiki_url`, darum hier keine
--   Spalte dafür: Der Prüfer von E4 duldet an seinen Tafeln keine Adress- oder Dateispalte). Nur Artikel (`wiki:…`); ein eigener Knoten
--   (`eigener-knoten:…`) hat keinen Artikel und keinen Schnappschuss. Die 17 Felder wie `territory_detail` (0076), je Feld drei Zustände:
--     Text                         = der Wiki-Wert;
--     NULL                         = das Wiki kennt keinen Wert;
--     NULL und Zeile in `…_unknown` = der Wiki-Wert ist UNBEKANNT (Legacy führte dort einen Override und lieferte den Wiki-Wert nie).
--   „Unbekannt“ steht als Kindzeile, nicht als Array oder JSON (keine EAV, Muster `territory_detail_field_origin`): Der Baustein zeigt
--   dort den eigenen Wert ohne Durchstreichung und ohne ↺, mit einem leisen Vermerk.
--
-- 🔴 LESETAFEL. Geschrieben nur vom Import (I23, `migrate:territory-details`, aus E4: Herkunft `wiki` gibt den Wert, `override` „unbekannt“)
-- und EINMAL von dieser Migration (unten). Kein Endpunkt schreibt sie; die App-Rolle liest (Rechtetafel `public-rechte.ts`, bis zur
-- Vorlage von Claudio). Kein Kartenobjekt, keine Geometrie.
--
-- 🔴 EINMALIGE FÜLLUNG aus den eigenen Tafeln (`territory_detail`, `territory_detail_field_origin`; Stand des letzten Gebietsimports): So
-- bekommt auch Production den Schnappschuss, ohne Legacy (H7: dort kein Gebietsimport mehr). Auf der Stage gleicht der nächste Zug ihn
-- danach ab. Gleich aus beiden Wegen: Herkunft `wiki` gibt den Wert, `override` (auch der bewusste Leerwert '') „unbekannt“, kein
-- Vermerk und kein Wert „das Wiki kennt nichts“. Idempotent (`ON CONFLICT DO NOTHING`); eine Zeile, die schon da ist, bleibt.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): zwei neue Tafeln; das vorige Release liest sie nie.

CREATE TABLE IF NOT EXISTS wiki_territory_snapshot (
    id BIGSERIAL PRIMARY KEY,
    wiki_key TEXT NOT NULL,
    continent TEXT,
    founded_text TEXT,
    dissolved_text TEXT,
    form_of_government TEXT,
    capital_name TEXT,
    seat_name TEXT,
    ruler TEXT,
    language TEXT,
    currency TEXT,
    population TEXT,
    founder TEXT,
    political TEXT,
    trade_zone TEXT,
    trade_goods TEXT,
    geographic TEXT,
    blazon TEXT,
    affiliation_raw TEXT,
    synced_at TIMESTAMPTZ,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_territory_snapshot_key_unique UNIQUE (wiki_key),
    CONSTRAINT wiki_territory_snapshot_key_is_article CHECK (wiki_key LIKE 'wiki:_%'),
    -- Ein Wiki-Wert ist Text, nie leer (der bewusste Leerwert ist ein eigener Wert, kein Wiki-Wert).
    CONSTRAINT wiki_territory_snapshot_text_not_blank CHECK (
        (continent IS NULL OR btrim(continent) <> '')
        AND (founded_text IS NULL OR btrim(founded_text) <> '')
        AND (dissolved_text IS NULL OR btrim(dissolved_text) <> '')
        AND (form_of_government IS NULL OR btrim(form_of_government) <> '')
        AND (capital_name IS NULL OR btrim(capital_name) <> '')
        AND (seat_name IS NULL OR btrim(seat_name) <> '')
        AND (ruler IS NULL OR btrim(ruler) <> '')
        AND (language IS NULL OR btrim(language) <> '')
        AND (currency IS NULL OR btrim(currency) <> '')
        AND (population IS NULL OR btrim(population) <> '')
        AND (founder IS NULL OR btrim(founder) <> '')
        AND (political IS NULL OR btrim(political) <> '')
        AND (trade_zone IS NULL OR btrim(trade_zone) <> '')
        AND (trade_goods IS NULL OR btrim(trade_goods) <> '')
        AND (geographic IS NULL OR btrim(geographic) <> '')
        AND (blazon IS NULL OR btrim(blazon) <> '')
        AND (affiliation_raw IS NULL OR btrim(affiliation_raw) <> '')
    ),
    CONSTRAINT wiki_territory_snapshot_source_not_blank CHECK (btrim(source_system) <> ''),
    CONSTRAINT wiki_territory_snapshot_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE wiki_territory_snapshot IS
    'Wiki-Stand eines Gebietsartikels (WI-0209, F24/G6), einmal je Artikel; gelesen ueber territory.wiki_key = wiki_key (ohne Fremdschluessel). NULL = das Wiki kennt keinen Wert, ausser das Feld steht in wiki_territory_snapshot_unknown (Wiki-Wert unbekannt). Geschrieben nur vom Import (I23) und einmal von Migration 0162.';

-- Felder, deren Wiki-Wert unbekannt ist: Legacy führte dort einen Override und lieferte den Wiki-Wert nie (E4). Kindzeilen ihres
-- Schnappschusses, nur mit Anlagestempel: Ändert sich der Satz, wird er ersetzt, nie angehäuft. Das Feld selbst ist dann NULL.
CREATE TABLE IF NOT EXISTS wiki_territory_snapshot_unknown (
    snapshot_id BIGINT NOT NULL REFERENCES wiki_territory_snapshot (id),
    field TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_id, field),
    CONSTRAINT wiki_territory_snapshot_unknown_field_known CHECK (
        field IN (
            'continent', 'founded_text', 'dissolved_text', 'form_of_government', 'capital_name', 'seat_name', 'ruler', 'language',
            'currency', 'population', 'founder', 'political', 'trade_zone', 'trade_goods', 'geographic', 'blazon', 'affiliation_raw'
        )
    )
);

COMMENT ON TABLE wiki_territory_snapshot_unknown IS
    'Detailfelder eines Gebietsartikels mit unbekanntem Wiki-Wert (Legacy-Override ohne gelieferten Wiki-Wert, E4). Kein Wert, kein Durchstreichen, kein Zuruecksetzen auf das Wiki.';

-- EINMALIGE FÜLLUNG -------------------------------------------------------------------------------------------------------------
-- Jedes aktive Gebiet mit Wiki-Artikel bekommt eine Zeile; die Werte nur aus Feldern mit Herkunft `wiki`.
INSERT INTO wiki_territory_snapshot (
    wiki_key, continent, founded_text, dissolved_text, form_of_government, capital_name, seat_name, ruler, language, currency,
    population, founder, political, trade_zone, trade_goods, geographic, blazon, affiliation_raw, migration_run_id, imported_at
)
SELECT DISTINCT ON (t.wiki_key)
    t.wiki_key,
    CASE WHEN 'continent' = ANY (h.wiki) THEN d.continent END,
    CASE WHEN 'founded_text' = ANY (h.wiki) THEN d.founded_text END,
    CASE WHEN 'dissolved_text' = ANY (h.wiki) THEN d.dissolved_text END,
    CASE WHEN 'form_of_government' = ANY (h.wiki) THEN d.form_of_government END,
    CASE WHEN 'capital_name' = ANY (h.wiki) THEN d.capital_name END,
    CASE WHEN 'seat_name' = ANY (h.wiki) THEN d.seat_name END,
    CASE WHEN 'ruler' = ANY (h.wiki) THEN d.ruler END,
    CASE WHEN 'language' = ANY (h.wiki) THEN d.language END,
    CASE WHEN 'currency' = ANY (h.wiki) THEN d.currency END,
    CASE WHEN 'population' = ANY (h.wiki) THEN d.population END,
    CASE WHEN 'founder' = ANY (h.wiki) THEN d.founder END,
    CASE WHEN 'political' = ANY (h.wiki) THEN d.political END,
    CASE WHEN 'trade_zone' = ANY (h.wiki) THEN d.trade_zone END,
    CASE WHEN 'trade_goods' = ANY (h.wiki) THEN d.trade_goods END,
    CASE WHEN 'geographic' = ANY (h.wiki) THEN d.geographic END,
    CASE WHEN 'blazon' = ANY (h.wiki) THEN d.blazon END,
    CASE WHEN 'affiliation_raw' = ANY (h.wiki) THEN d.affiliation_raw END,
    d.migration_run_id,
    d.imported_at
FROM territory t
LEFT JOIN territory_detail d ON d.territory_id = t.id AND d.is_active
LEFT JOIN LATERAL (
    SELECT coalesce(array_agg(o.field) FILTER (WHERE o.origin = 'wiki'), '{}') AS wiki
    FROM territory_detail_field_origin o
    WHERE o.territory_detail_id = d.id
) h ON TRUE
WHERE t.is_active AND t.wiki_key LIKE 'wiki:_%'
ORDER BY t.wiki_key, t.id
ON CONFLICT (wiki_key) DO NOTHING;

-- Was Legacy überschrieb, ist im Schnappschuss unbekannt.
INSERT INTO wiki_territory_snapshot_unknown (snapshot_id, field)
SELECT DISTINCT s.id, o.field
FROM wiki_territory_snapshot s
JOIN territory t ON t.wiki_key = s.wiki_key AND t.is_active
JOIN territory_detail d ON d.territory_id = t.id AND d.is_active
JOIN territory_detail_field_origin o ON o.territory_detail_id = d.id AND o.origin = 'override'
WHERE s.is_active
ON CONFLICT DO NOTHING;
