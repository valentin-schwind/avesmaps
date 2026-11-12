-- Die Wege-Domaene, Stufe 1: darstellen und beschriften, noch kein Routing
-- (WI-0010, Contract project-control/migration/contracts/paths.yaml, Betreiberfreigabe 2026-09-21).
--
-- Geometrie liegt im Kartenraum mit SRID 0, wie bei Orten und Regionen (Kapitel 4.13); die
-- Renderprojektion entsteht auf dem Weg nach draussen und wird nie gespeichert (Kapitel 4.17.4).
--
-- 🔴 EIN WEG IST HIER EIN ABSCHNITT. Die "ganze Strasse" ist in Legacy ABGELEITET - der
-- Gruppenschluessel entsteht aus dem Wiki-Schluessel oder aus Name plus Art, und zwar ausdruecklich
-- auch ueber Luecken hinweg. Eine Gruppentabelle waere eine Tabelle fuer etwas, das Legacy bewusst
-- rechnet. Gemessen am Bestand: 6983 Abschnitte tragen zusammen 634 verschiedene Namen unter den
-- beschrifteten; "Reichsstrasse 2" allein hat 75 Abschnitte.

CREATE TABLE IF NOT EXISTS path (
    id BIGSERIAL PRIMARY KEY,
    -- Legacy-UUID bleibt die oeffentliche Identitaet. Im Snapshot vollstaendig und eindeutig:
    -- 6983 von 6983, keine Duplikate.
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    name TEXT NOT NULL,

    -- Die acht Wegarten des Bestands. Eine neunte ist eine Produktentscheidung, kein Import.
    -- 🪤 Die Schreibweise ist die des Bestands (`Strasse`, nicht `Straße`) - sie ist der stabile
    -- Schluessel, nicht die Beschriftung. Legacys Gewichtstafel prueft kleingeschrieben und kennt
    -- vier Schreibweisen fuer Reichsstrasse; wir speichern eine.
    subtype TEXT NOT NULL CHECK (
        subtype IN ('Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad', 'Flussweg', 'Seeweg')
    ),

    -- 💣 NOT NULL mit Vorgabe FALSE, und das ist hier KEINE behauptete Entscheidung, sondern die
    -- gemessene Semantik: Legacy liest `(bool) ($props['show_label'] ?? false)`, und der Client
    -- verlangt einen ausdruecklichen Wahrheitswert. Ein fehlender Wert heisst dort "aus", also
    -- heisst er auch hier "aus". Das ist der Unterschied zu `label_curve_enabled` bei den Regionen,
    -- wo NULL "nicht migriert" bedeutet - dort trug der Endpunkt den Wert gar nicht.
    label_visible BOOLEAN NOT NULL DEFAULT FALSE,

    -- Ein Bach ist ein Flussweg MIT einem Merkmal, keine neunte Art (Legacy, Owner 30.08.2026;
    -- alle 272 Baeche im Bestand sind Flusswege). ⭐ Legacy hat hier genau das richtig gemacht, was
    -- es bei `gebaeude` sieben Mal falsch hatte: ein Merkmal bekommt einen eigenen Namen, statt in
    -- einem Typwert mitzureisen (MCS-012).
    is_bach BOOLEAN NOT NULL DEFAULT FALSE,

    geom geometry(LineString, 0) NOT NULL,

    source_system TEXT NOT NULL,
    legacy_public_id UUID,
    -- Welcher Lauf diese Zeile zuletzt angefasst hat. Dieselbe Spur wie bei Orten und Regionen:
    -- ohne sie laesst sich hinterher nicht sagen, woher ein Wert stammt.
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Ein Bach ist immer ein Flussweg. Im Schema, nicht nur in der Anwendung: die Regel stammt aus
    -- dem Fachmodell und ueberlebt so auch einen Import, der sie nicht kennt.
    CONSTRAINT path_bach_ist_flussweg CHECK (NOT is_bach OR subtype = 'Flussweg')
);

CREATE UNIQUE INDEX IF NOT EXISTS path_public_id_key ON path (public_id);
CREATE INDEX IF NOT EXISTS path_geom_idx ON path USING GIST (geom);
CREATE INDEX IF NOT EXISTS path_domain_subtype ON path (map_domain_id, subtype) WHERE is_active;
-- Fuer die Kettenbildung: gleichnamige Abschnitte zusammenholen.
CREATE INDEX IF NOT EXISTS path_name_idx ON path (map_domain_id, name) WHERE is_active AND label_visible;

COMMENT ON TABLE path IS
    'Wegabschnitte (WI-0010 Stufe 1). Ein Abschnitt ist die Wurzel; die "ganze Strasse" wird aus Name und Art abgeleitet, auch ueber Luecken. Kein Routing, keine Topologie, keine Verkehrsmittel - die gehoeren zum Travel-Modell (Stufe 3).';
COMMENT ON COLUMN path.subtype IS
    'Wegart, stabiler Schluessel in der Schreibweise des Bestands. Sie ist der Schluessel ZWEIER getrennter Tafeln: der Kartografie (Farbe, Strich, Zoom) und spaeter des Travel-Modells (Geschwindigkeiten). Ein gemeinsamer Schluessel ist keine gemeinsame Quelle - eine Aenderung der Darstellung darf das Routing nicht aendern (Betreiberentscheidung 2026-09-21).';
COMMENT ON COLUMN path.label_visible IS
    'Redaktionell: traegt dieser Abschnitt seinen Namen auf der Karte? Gemessen 2356 von 6983. Ein fehlender Wert heisst AUS - so liest es Legacy auf beiden Seiten.';
COMMENT ON COLUMN path.is_bach IS
    'Merkmal am Flussweg, keine eigene Wegart (Legacy Owner 30.08.2026). 272 im Bestand.';

-- Die Renderrelation. Feste Zeilenreihenfolge seit Migration 0016: `public_id` ist ein
-- Tie-Breaker fuer gleiche Kachelbytes und sagt NICHTS ueber fachliche Wichtigkeit.
--
-- 🪤 `collision_rank` steht hinter `geom`, wie in 0017 - eine Sicht waechst in PostgreSQL nur am
-- Ende, und ein DROP VIEW naehme der Martin-Rolle das Leserecht.
CREATE OR REPLACE VIEW path_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(LineString, 3857) AS geom,
    -- Wege tragen keine Klassenordnung und keine redaktionelle Prioritaet: Legacy kennt fuer sie
    -- weder das eine noch das andere. Der Rang haelt sie damit alle gleich - entschieden wird
    -- zwischen ihnen durch die Kachelreihenfolge, und gegenueber ANDEREN Namensarten durch die
    -- Layerreihenfolge. Die Funktion wird trotzdem benutzt, damit hier keine zweite Skala entsteht.
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank
FROM path p
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW path_render IS
    'Wegabschnitte fuer die Kachel. Feste Reihenfolge nach public_id (0016). Die Kettenbildung fuer die Beschriftung passiert NICHT hier - sie braucht eine eigene Relation, weil sie Abschnitte zusammenfasst.';
