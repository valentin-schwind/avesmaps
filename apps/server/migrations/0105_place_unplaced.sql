-- Orte ohne Lage (WI-0128 E16; Betreiber 2026-10-11: „es kriegt das flag "nicht auf der karte" … das ist doch vollkommen klar.“).
--
-- Ein Editor legt einen Ort an, ohne ihn auf die Karte zu setzen: Er steht unter „Nicht auf der Karte“ wie die Wiki-Einträge ohne
-- Kartenpunkt, bis „● Auf der Karte setzen“ oder das Ziehen aus der Liste ihn platziert. Dann wird er ein `place` mit DERSELBEN
-- `public_id`, und diese Zeile wird stillgelegt (`retired_origin = 'placed'`). `place.geom` bleibt NOT NULL (0003); eine Lage, die es
-- nicht gibt, steht nie in `place`. Vorlage: project-control/discovery/wi-0128-e16-ort-ohne-lage-2026-10-11.md, Option 2.
--
-- Kein Import liest oder schreibt diese Tafel; das Zurücksetzen der Testwelt (E14) legt ihre Zeilen still. Die Texte (Beschreibung,
-- Einwohner, Lage, Oberhaupt) stehen hier, weil `place_detail` an `place` hängt; beim Platzieren wandern sie dorthin, als eigene Werte.
-- Die Revision zählt der Trigger wie bei `place` (0091).
--
-- Additiv: Das vorige Release liest die Tafel nicht und bleibt heil.

CREATE TABLE IF NOT EXISTS place_unplaced (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    name TEXT NOT NULL,
    subtype TEXT NOT NULL,
    place_kind TEXT,
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    is_ruined BOOLEAN NOT NULL DEFAULT FALSE,
    is_nodix BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    einwohner TEXT,
    lage TEXT,
    oberhaupt TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    source_system TEXT NOT NULL DEFAULT 'avesmaps3d',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_unplaced_public_id_unique UNIQUE (public_id),
    CONSTRAINT place_unplaced_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT place_unplaced_subtype_known CHECK (
        subtype IN ('metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf', 'gebaeude', 'stadtviertel')
    ),
    CONSTRAINT place_unplaced_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('placed', 'editor', 'testwelt'))
    )
);

CREATE INDEX IF NOT EXISTS place_unplaced_domain_active ON place_unplaced (map_domain_id) WHERE is_active;

CREATE OR REPLACE TRIGGER place_unplaced_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, place_kind, is_hidden, is_ruined, is_nodix, description, einwohner, lage,
                     oberhaupt, is_active, revision
    ON place_unplaced
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE place_unplaced IS
    'Ein Ort ohne Lage, vom Editor angelegt (WI-0128 E16): steht unter „Nicht auf der Karte“, bis er platziert wird; dann ein place mit derselben public_id und diese Zeile stillgelegt (placed).';
COMMENT ON COLUMN place_unplaced.revision IS
    'Fachrevision wie place.revision: zählt der Trigger place_unplaced_revision; beim Platzieren übernimmt der Ort sie.';
