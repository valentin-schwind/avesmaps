-- Gebietsdetails der Herrschaftsgebiete (WI-0063 P3, Vertrag `project-control/migration/contracts/territory-details.yaml`, Legacy-Export E4).
--
-- 🔴 E4 legt KEINE neue Wurzel an: das Herrschaftsgebiet (`territory`, Migration 0055) behält Identität und Vertrag. Hier hängt ihm
-- EIN Teil an, die textlichen Detailfelder mit Herkunft je Feld. Der Wappenzustand (undecided, none, set) ist KEINE Tabelle dieser
-- Migration: Wappen gehören dem Media Core (`media.yaml`, Migration 0064: `territory_media` und `territory_media_suppression`), und
-- GESCHRIEBEN wird er vom Medienimport (MEDIA-M8, eigene Migration), nicht von diesem Schritt. Dieser Schritt rechnet die Abbildung
-- nur durch (Trockenlauf im Bericht und im Prüfer, `territory-coat.ts`). Kein Lizenzfeld, kein Dateipfad und keine Wappenspalte am
-- Gebiet oder in diesen zwei Tabellen.
--
-- Die drei alten Spalten `territory.coat_ref`, `coat_license_status` und `coat_origin` (Migration 0055, „abgelegt, nicht genutzt“)
-- bleiben unberührt und werden weiter geschrieben (Erweitern). Umstellen und Entfernen sind je ein eigenes Release (AGENTS.md,
-- Migrationen: erst erweitern, dann umstellen, dann entfernen); ein `DROP COLUMN` gehört frühestens nach dem Stage-Release des Umstellens
-- in eine spätere Migration, mit Eintrag in `KNOWN_EXCEPTIONS`.
--
-- 🔴 DREI ZUSTÄNDE JE FELD, wie Legacy sie kennt und der alte Export sie nicht trennte:
--   NULL      = kein Wert (weder Override noch Wiki-Text);
--   ''        = BEWUSSTER LEERWERT (ein leerer Override): Legacy zeigt ihn nicht, aber er verdeckt den Wiki-Wert. Das ist die
--               ausdrückliche Entscheidung „kein Wert“ und es gilt hier das UMGEKEHRTE zur sonstigen Regel „leer wird NULL“. Ein '' ist nur
--               mit der Herkunft `override` zulässig (cross-table, der Prüfer sieht nach);
--   Text      = der wirksame Wert, Override vor Wiki-Text (Legacys Regel `territory-detail-felder.php`).
-- Die Herkunft je Feld (`override` oder `wiki`) steht in `territory_detail_field_origin`: reine Herkunftsvermerke ohne Werte, keine
-- EAV-Ablage. Ein Feld ohne Wert hat keinen Vermerk. Der Leser zeigt ein leeres wirksames Feld nicht (WI-0063 5.3); Avesmaps3D speichert
-- keinen zweiten Wiki-Wert neben dem Leerwert.
--
-- Eine Zeile nur, wenn mindestens ein Feld einen Wert trägt (auch den leeren): ein Gebiet ohne Daten bekommt keine leere Hülle. Verliert
-- ein Gebiet im nächsten Zug alle Felder, wird die Zeile stillgelegt (ihre Felder und Vermerke werden geleert, wie `place_detail`),
-- nie gelöscht. `state suppressed` und `retired_origin editor` sind RESERVIERT (Kapitel 9.37): kein Import legt sie an oder überschreibt
-- sie. Geschrieben wird die Tabelle vorerst nur vom Import (`migrate:territory-details`); kein Endpunkt ändert sie.
--
-- Wiki-Texte stehen unter CC BY-SA 3.0 (Betreiber 2026-10-04); die Namensnennung ist die Wikizeile aus `territory.wiki_url` und der
-- Quellenkasten (D1). Es gibt keine Lizenzspalte je Zeile. `affiliation_raw` ist ein ungeparster Wiki-Text und wird NIE als Baum
-- gelesen (die Zugehörigkeit ist `territory.parent_id`).
--
-- Längen und Wikimarkup: Legacys Obergrenzen sind nicht belegt und stehen nicht als CHECK; Reste von Wikimarkup in einem Text meldet
-- der Import als Befund und repariert sie nicht (Cutoff-Regel, Betreiber 2026-09-21).

CREATE TABLE IF NOT EXISTS territory_detail (
    id BIGSERIAL PRIMARY KEY,
    territory_id BIGINT NOT NULL REFERENCES territory (id),
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
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT territory_detail_territory_unique UNIQUE (territory_id),
    -- Ein Wert ist Text, oder der bewusste Leerwert '', nie nur Leerraum.
    CONSTRAINT territory_detail_fields_not_blank CHECK (
        (continent IS NULL OR continent = '' OR btrim(continent) <> '')
        AND (founded_text IS NULL OR founded_text = '' OR btrim(founded_text) <> '')
        AND (dissolved_text IS NULL OR dissolved_text = '' OR btrim(dissolved_text) <> '')
        AND (form_of_government IS NULL OR form_of_government = '' OR btrim(form_of_government) <> '')
        AND (capital_name IS NULL OR capital_name = '' OR btrim(capital_name) <> '')
        AND (seat_name IS NULL OR seat_name = '' OR btrim(seat_name) <> '')
        AND (ruler IS NULL OR ruler = '' OR btrim(ruler) <> '')
        AND (language IS NULL OR language = '' OR btrim(language) <> '')
        AND (currency IS NULL OR currency = '' OR btrim(currency) <> '')
        AND (population IS NULL OR population = '' OR btrim(population) <> '')
        AND (founder IS NULL OR founder = '' OR btrim(founder) <> '')
        AND (political IS NULL OR political = '' OR btrim(political) <> '')
        AND (trade_zone IS NULL OR trade_zone = '' OR btrim(trade_zone) <> '')
        AND (trade_goods IS NULL OR trade_goods = '' OR btrim(trade_goods) <> '')
        AND (geographic IS NULL OR geographic = '' OR btrim(geographic) <> '')
        AND (blazon IS NULL OR blazon = '' OR btrim(blazon) <> '')
        AND (affiliation_raw IS NULL OR affiliation_raw = '' OR btrim(affiliation_raw) <> '')
    ),
    CONSTRAINT territory_detail_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT territory_detail_state_matches_activity CHECK ((state = 'active') = is_active),
    -- Eine aktive Zeile trägt mindestens ein Feld (keine leere Hülle).
    CONSTRAINT territory_detail_active_has_a_field CHECK (
        NOT is_active
        OR num_nonnulls(
            continent, founded_text, dissolved_text, form_of_government, capital_name, seat_name, ruler, language, currency,
            population, founder, political, trade_zone, trade_goods, geographic, blazon, affiliation_raw
        ) > 0
    ),
    CONSTRAINT territory_detail_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    ),
    CONSTRAINT territory_detail_source_not_blank CHECK (btrim(source_system) <> '')
);

COMMENT ON TABLE territory_detail IS
    'Wirksame Detailfelder eines Herrschaftsgebiets (E4): Override vor Wiki-Text. NULL = kein Wert, leerer String = bewusster Leerwert (leerer Override). Eine Zeile je Gebiet, nur mit mindestens einem Feld.';
COMMENT ON COLUMN territory_detail.affiliation_raw IS
    'Ungeparster Wiki-Text der Zugehörigkeit; wird nie als Hierarchie gelesen (die Zugehörigkeit ist territory.parent_id).';
COMMENT ON COLUMN territory_detail.state IS
    'active | retired | suppressed; suppressed ist für den Editor reserviert (Kapitel 9.37) und bleibt mit is_active gleichlaufend.';

-- Herkunft je Feld: nur der Vermerk, nie ein Wert. Ein Feld ohne Wert hat keinen Vermerk; ein leerer String ist nur mit `override` zulässig
-- (der Prüfer sieht es nach). Kindzeilen der Detailzeile tragen nur den Anlagestempel: Ändert sich der Satz eines Gebiets, wird er ersetzt.
CREATE TABLE IF NOT EXISTS territory_detail_field_origin (
    territory_detail_id BIGINT NOT NULL REFERENCES territory_detail (id),
    field TEXT NOT NULL,
    origin TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (territory_detail_id, field),
    CONSTRAINT territory_detail_field_origin_field_known CHECK (
        field IN (
            'continent', 'founded_text', 'dissolved_text', 'form_of_government', 'capital_name', 'seat_name', 'ruler', 'language',
            'currency', 'population', 'founder', 'political', 'trade_zone', 'trade_goods', 'geographic', 'blazon', 'affiliation_raw'
        )
    ),
    CONSTRAINT territory_detail_field_origin_origin_known CHECK (origin IN ('override', 'wiki'))
);

COMMENT ON TABLE territory_detail_field_origin IS
    'Herkunftsvermerk je Detailfeld (override = Redaktionstext von Legacy, wiki = Wiki-Text). Keine Werte, keine EAV-Ablage; fehlt der Vermerk, hat das Feld keinen Wert.';
