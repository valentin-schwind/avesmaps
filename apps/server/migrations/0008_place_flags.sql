-- Ortsmerkmale aus Legacy (WI-0002, Finding MCS-006). Drei Merker und die Ortsart liegen dort im
-- properties_json; ein fehlender Schluessel bedeutet false beziehungsweise leer, nicht "unbekannt".
ALTER TABLE place ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE place ADD COLUMN IF NOT EXISTS is_ruined BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE place ADD COLUMN IF NOT EXISTS is_nodix BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE place ADD COLUMN IF NOT EXISTS place_kind TEXT;

COMMENT ON COLUMN place.is_hidden IS
    'Verborgen: die Karte zeichnet weder Markierung noch Namen; die Routenfindung darf den Ort nicht als Kandidat waehlen. Von Hand gesetzt, Legacy-Semantik.';
COMMENT ON COLUMN place.is_ruined IS
    'Ruine. Beschreibendes Merkmal, aendert die Zeichnung nicht.';
COMMENT ON COLUMN place.is_nodix IS
    'Aus Legacy verlustfrei uebernommen. Fachliche Bedeutung UNKNOWN (Kraftlinienbezug belegt) - es wird kein Verhalten daraus abgeleitet.';
COMMENT ON COLUMN place.place_kind IS
    'Ortsart wie Festung, Kloster, Bruecke. Beschreibendes Merkmal, aendert die Zeichnung nicht.';

-- Verborgene Orte wird die Karte haeufig ausschliessen muessen.
CREATE INDEX IF NOT EXISTS place_domain_visible ON place (map_domain_id) WHERE is_active AND NOT is_hidden;
