-- Klimazonen: die Trennlinien sind die Wahrheit, die Bänder sind abgeleitet (WI-0005, MCS-009).
--
-- 🔴 Die fachliche Aggregatwurzel ist der geordnete SATZ der Trennlinien, nicht die einzelne Zeile:
-- Reihenfolge, Mindestabstand, Kreuzungsfreiheit und die vollständige Bandabdeckung sind Aussagen
-- über den Satz als Ganzes. Eine eigene Wurzeltabelle braucht es dafür nicht -- der Satz ist
-- implizit "alle climate_divider dieser Kartendomäne". Jede spätere Mutation wird gegen den ganzen
-- Satz validiert und zieht Ableitung und Revision in derselben Transaktion nach.

-- Das Zonenvokabular. Migration-managed, NICHT redaktionell (Betreiberentscheidung 2026-09-21):
-- die Klimaschlüssel sind domänenübergreifende Verträge -- Routing, Lebensraumregeln,
-- Regionszuordnung, UI und Export hängen daran. Eine neunte Zone ist deshalb ein Work Item mit
-- Migration und kein Editor-Klick.
CREATE TABLE IF NOT EXISTS climate_zone_type (
    type_key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    -- 💣 Die Nord-Süd-Reihenfolge, und damit tragend statt kosmetisch: aus ihr folgt, welche Linie
    -- zwischen welchen Zonen liegt. Die Zehnerlücken sind Einschubreserve -- die 55 ist die am
    -- 2026-08-03 nachträglich eingeschobene Steppenzone.
    sort_order INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT climate_zone_type_sort_unique UNIQUE (sort_order)
);

COMMENT ON TABLE climate_zone_type IS
    'Kontrolliertes Domaenenvokabular der Klimazonen. Migration-managed; eine neue Zone ist eine Migration (WI-0005).';
COMMENT ON COLUMN climate_zone_type.sort_order IS
    'Nord nach Sued. Bestimmt, zwischen welchen Zonen eine Trennlinie liegt.';

-- Die Trennlinien: die einzigen redaktionellen, autoritativen Daten dieser Domäne.
CREATE TABLE IF NOT EXISTS climate_divider (
    id BIGSERIAL PRIMARY KEY,
    -- 🔴 Die Identität einer Linie ist ihre SÜDLICHE Zone, nicht eine laufende Nummer. Nur dadurch
    -- überlebt eine von Hand gezogene Grenze das Einfügen einer neuen Zone. In Legacy stand an
    -- dieser Stelle bis 2026-08-03 ein DELETE über alle Linien, das jede Handarbeit vernichtet
    -- hätte, sobald jemand eine Zone ergänzt.
    --
    -- 🪤 Der UNIQUE ist neu. Legacy führt `south_type_key` ohne Unique und ohne Index, obwohl sein
    -- Abgleich `UPDATE ... WHERE south_type_key = :key` fährt -- die Eindeutigkeit ist dort
    -- vorausgesetzt und nicht erzwungen.
    south_type_key TEXT NOT NULL UNIQUE REFERENCES climate_zone_type (type_key),
    geom geometry(LineString, 0) NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Rand zu Rand, als Zusicherung und nicht als Hoffnung: eine Linie, die nicht beide Kartenränder
    -- trifft, lässt ihr Band offen, und jeder Verschnitt danach liefert Unsinn.
    CONSTRAINT climate_divider_spans_map CHECK (
        ST_X(ST_StartPoint(geom)) = 0 AND ST_X(ST_EndPoint(geom)) = 1024
    ),
    CONSTRAINT climate_divider_point_count CHECK (ST_NPoints(geom) BETWEEN 2 AND 500),
    -- 💣 Selbstschnitt verboten, monoton steigendes x aber AUSDRÜCKLICH NICHT gefordert: seit
    -- 2026-08-03 darf eine Linie rückwärts laufen ("Blasen", für die Khôm-Wüste). Sie sind im
    -- Bestand verbreitet, und eine Migration, die sie glättet, ändert die Karte.
    CONSTRAINT climate_divider_simple CHECK (ST_IsSimple(geom))
);

COMMENT ON TABLE climate_divider IS
    'Die autoritativen Klimagrenzen. Identitaet ist die suedliche Zone. Baender werden hieraus abgeleitet (WI-0005).';
COMMENT ON COLUMN climate_divider.geom IS
    'LineString von x=0 bis x=1024 in aventuria-v1. Darf rueckwaerts laufen (Blasen); nur Selbstschnitt ist verboten.';

-- Die Bänder: abgeleitet, nie Quelle.
CREATE TABLE IF NOT EXISTS climate_band (
    type_key TEXT PRIMARY KEY REFERENCES climate_zone_type (type_key) ON DELETE CASCADE,
    geom geometry(Polygon, 0) NOT NULL,
    -- Woraus das Band entstand. Ändert sich der Fingerabdruck, ist es veraltet.
    source_fingerprint TEXT NOT NULL,
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS climate_band_geom_gist ON climate_band USING GIST (geom);
CREATE INDEX IF NOT EXISTS climate_divider_geom_gist ON climate_divider USING GIST (geom);

COMMENT ON TABLE climate_band IS
    'Abgeleitete Klimabaender. NIEMALS Source of Truth: der Raum zwischen zwei Trennlinien (ADR, WI-0005).';

/*
 * Der Riegel gegen Handbearbeitung -- im SCHEMA, nicht in der Anwendung.
 *
 * 🔴 Legacy erzwingt ihn serverseitig und begründet es gut: ein UI-Riegel schützt vor dem
 * Verklicken, nicht vor einem Tab, der seit gestern offen ist. Dort ist er trotzdem reiner
 * Anwendungscode -- es gibt keine Spalte "abgeleitet" und keinen Trigger. Hier steht er in der
 * Datenbank, weil er sonst genau die zweite Wahrheit zulässt, die das ganze Modell vermeidet: die
 * Linie und ein von Hand verschobenes Band.
 *
 * Das Ableitungswerkzeug setzt `climate.deriving` für seine Transaktion und kommt durch; jeder
 * andere Weg scheitert. Das ist keine Sicherheitsgrenze gegen einen Angreifer mit
 * Datenbankzugang -- es ist eine gegen den ehrlichen Irrtum, und das ist der Fall, der eintritt.
 */
CREATE OR REPLACE FUNCTION climate_band_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_setting('climate.deriving', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION
            'climate_band is derived from climate_divider and must not be written directly (WI-0005)'
            USING HINT = 'Run the derivation tool; it sets climate.deriving for its transaction.';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS climate_band_no_manual_write ON climate_band;
CREATE TRIGGER climate_band_no_manual_write
    BEFORE INSERT OR UPDATE OR DELETE ON climate_band
    FOR EACH ROW EXECUTE FUNCTION climate_band_guard();

COMMENT ON FUNCTION climate_band_guard IS
    'Verriegelt climate_band gegen direkte Mutation. Nur die Ableitung setzt climate.deriving (WI-0005).';

-- Die acht Zonen. Migration-managed: diese Liste IST der Vertrag.
--
-- 🪤 Die Schlüssel bleiben, wie sie sind. Am 2026-08-04 wurden in Legacy zwei BESCHRIFTUNGEN
-- umbenannt ("Trockene Subtropen" -> "Subtropische Steppenzone", "Subtropische Zone" ->
-- "Subtropische Wüstenzone"); die Schlüssel nicht, weil sie in Regionszeigern, im Routing und in
-- der Bodentafel stehen. Eine Schlüsselumbenennung wäre eine Datenmigration, keine Textänderung.
INSERT INTO climate_zone_type (type_key, label, sort_order) VALUES
    ('polar', 'Polare Zone', 10),
    ('subpolar', 'Subpolare Zone', 20),
    ('boreal', 'Boreale Zone', 30),
    ('gemaessigt', 'Gemäßigte Zone', 40),
    ('subtropen_winterfeucht', 'Winterfeuchte Subtropen', 50),
    ('trockene_subtropen', 'Subtropische Steppenzone', 55),
    ('subtropisch', 'Subtropische Wüstenzone', 60),
    ('tropisch', 'Tropische Zone', 70)
ON CONFLICT (type_key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Renderansicht der Bänder. Folgt der `*_render`-Konvention, damit der Postmigrate sie findet.
CREATE OR REPLACE VIEW climate_band_render AS
SELECT
    b.type_key,
    t.label,
    t.sort_order,
    map_domain_to_render('aventuria', b.geom)::geometry(Polygon, 3857) AS geom
FROM climate_band b
JOIN climate_zone_type t ON t.type_key = b.type_key
WHERE t.is_active;

COMMENT ON VIEW climate_band_render IS
    'Abgeleitete Renderansicht der Klimabaender. Niemals Source of Truth (Kapitel 4.17.4).';
