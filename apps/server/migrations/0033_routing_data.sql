-- Die Routingdaten aus Legacy: Kreuzungen als Knoten und die Routingattribute der Wege
-- (WI-0017 R1, Contract `paths.yaml` Version 2, MCS-017).
--
-- 🔴 BETREIBERFREIGABE 2026-09-23 („import freigegeben"), scope-genau: die 2542 Kreuzungen und die
-- Routingattribute der Wege aus Snapshot 140088. Die Freigabe gilt nur diesem Umfang.
--
-- 💣 WARUM DIE KREUZUNGEN JETZT DOCH KOMMEN: Stufe 1 hatte sie weggelassen, weil Legacys Routing sie
-- angeblich nicht als Knoten benutzte. Das stimmt nicht (MCS-017): die oeffentliche Route rechnet
-- ueber `client-graph.php`, und dort SIND Orte und Kreuzungen die Knoten; Wegenden haengen im Kasten
-- +-0,5 daran. Ohne Kreuzungen laesst sich Legacys Netz nicht nachbauen und damit nicht vergleichen.
--
-- 🪤 Kreuzungen werden NICHT gezeichnet. Es gibt keine Renderrelation, keine Kachel, keinen Layer -
-- die Karte bleibt, wie sie ist. Sie sind Routingknoten, keine Kartenobjekte (Kap. 6.16).

CREATE TABLE IF NOT EXISTS crossing (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Legacys Name, wie er im Bestand steht: 1799 Mal "Kreuzung", sonst Positionsnummern wie
    -- "Kreuzung-41" (329 Mal derselbe!). Er ist KEINE Identitaet und wird nicht als Schluessel
    -- benutzt - Legacy benennt ihn je Anfrage in `Kreuzung-<Zeilen-Id>` um. Er steht hier nur fuer
    -- die Nachvollziehbarkeit des Imports.
    legacy_name TEXT NOT NULL,
    -- Legacy schreibt dieselbe Sache mit zwei Werten (KD1 im Contract): 1799 junction, 743 crossing.
    legacy_kind TEXT NOT NULL CHECK (legacy_kind IN ('junction', 'crossing')),
    geom geometry(Point, 0) NOT NULL,
    source_system TEXT NOT NULL,
    legacy_public_id UUID,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crossing_geom_idx ON crossing USING gist (geom);

COMMENT ON TABLE crossing IS
    'Kreuzungen als Routingknoten (WI-0017, MCS-017). Nicht gezeichnet: keine Renderrelation. Wegenden haengen in Legacy im Kasten +-0,5 an Orten UND Kreuzungen; ohne sie ist das Netz nicht nachbaubar.';

-- Die Routingattribute der Wege. Alle vier sind NULLBAR, und NULL heisst jeweils "nicht gespeichert"
-- - nicht "leer" und nicht "Vorgabe". Die Unterscheidung traegt Legacys Semantik:

-- 🔴 Eine gespeicherte Liste ist massgeblich, AUCH WENN SIE LEER IST (563 Wege: nicht befahrbar).
-- Fehlt sie (NULL), nimmt Legacy die Vorgabe der Wegart (client-graph.php#L1752-L1826).
ALTER TABLE path ADD COLUMN IF NOT EXISTS allowed_transports TEXT[] CHECK (
    allowed_transports IS NULL OR allowed_transports <@ ARRAY[
        'caravan', 'groupFoot', 'lightWalker', 'horseCarriage', 'groupHorse', 'lightRider',
        'riverSailer', 'riverBarge', 'cargoShip', 'fastShip', 'galley'
    ]::TEXT[]
);

ALTER TABLE path ADD COLUMN IF NOT EXISTS transport_domain TEXT CHECK (
    transport_domain IS NULL OR transport_domain IN ('land', 'river', 'sea', 'none')
);

-- Je Transportmittel ein Fenster "gangbar von ... bis ..." in aventurischen Monaten. Es sperrt nur,
-- wenn eine Route einen Reisebeginn hat (transport-season.php). 99 Wege im Bestand.
ALTER TABLE path ADD COLUMN IF NOT EXISTS transport_seasons JSONB;

-- Der Stroemungsfaktor neben der Richtung (0028): stromauf kostet Zeit x Faktor. NULL heisst "nicht
-- gespeichert" - Legacy nimmt dann 2,0 (GA S. 129). Gespeichert sind 172 Werte, meist 2.
ALTER TABLE path ADD COLUMN IF NOT EXISTS flow_factor NUMERIC CHECK (flow_factor IS NULL OR flow_factor >= 1);

COMMENT ON COLUMN path.allowed_transports IS
    'Erlaubte Transportmittel. NULL = keine Liste gespeichert (Legacy nimmt die Vorgabe der Wegart); leeres Array = ausdruecklich keins. Routingattribut (WI-0017).';
COMMENT ON COLUMN path.transport_domain IS
    'land | river | sea | none. NULL = nicht gespeichert. Zusammen mit allowed_transports entscheidet sie, ob eine Kante fuer ein Transportmittel existiert.';
COMMENT ON COLUMN path.transport_seasons IS
    'Zeitfenster je Transportmittel {transport: {from_month, from_day, to_month, to_day}}. Sperrt nur mit Reisebeginn. NULL = keine Sperre.';
COMMENT ON COLUMN path.flow_factor IS
    'Stroemungsfaktor stromauf (Zeit x Faktor). NULL = nicht gespeichert, Legacy nimmt dann 2,0.';

-- Die Richtung aus 0028 war als reine Darstellungsangabe eingefuehrt. Mit dem Faktor daneben ist
-- sie jetzt AUCH Routingattribut - der Kommentar sagt es, damit niemand sie als Bildschmuck liest.
COMMENT ON COLUMN path.flow_direction IS
    'Fliessrichtung entlang der gespeicherten Geometrie: forward = in Punktreihenfolge, reverse = entgegen. NULL = unbekannt (Legacy zeichnet dort keinen Pfeil). Zeichnet die Stroemungspfeile UND ist seit 0033 Routingattribut: stromauf kostet Zeit x flow_factor.';
