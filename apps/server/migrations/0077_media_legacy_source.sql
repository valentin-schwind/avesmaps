-- Die Legacy-Herkunft eines Medien-Assets (WI-0063 Abschnitt 26.20 MEDIA-4, Vertrag `project-control/migration/contracts/media.yaml`,
-- `umsetzung_m8_m10`; Plan MEDIA-M8 bis M10).
--
-- 🔴 Eine Zeile je Asset, das der Medienimport aus Legacys Manifest (Export E5) angelegt hat. Sie trägt, was Legacy über das Bild
-- sagt und das Ziel-Asset NICHT tragen soll (`media_asset` bleibt medienart-neutral, WI-0068 und `model_3d` kennen kein
-- Legacy): die Klasse (bestimmt die Rolle), die Adresse der Datei in Legacys Speicher, Legacys Herkunftsvermerke und Legacys
-- eigenes Veröffentlichungstor als EVIDENZ. Das Tor `legacy_public` ist nie eine Freigabe in Avesmaps3D (media.yaml:
-- „Legacy-public ist Evidenz, nie eine neue Publikationsfreigabe“); die Entscheidung trifft allein `media/policy.ts`.
--
-- Wofür die Zeile gebraucht wird: (1) Der Binärimport (M9/M10) findet die Datei über `local_url`, auch ohne das Manifest in der
-- Hand (Neu-Rendern nach einer Rezeptänderung oder einer neuen Freigabe). (2) Der Prüfer zählt je Klasse. (3) WI-0068 filtert
-- nach Importannahmen und Herkunft, ohne `source_ref` zerlegen zu müssen (der Schlüssel ist eine Identität, kein Datenfeld).
--
-- INTERN: Adresse und Vermerke verlassen nie einen Editor- oder Admin-Lesepfad; der Resolver (`media/resolver.ts`) liest diese
-- Tabelle nicht. Rein additiv (eine neue Tabelle), das vorige Release ignoriert sie.

CREATE TABLE IF NOT EXISTS media_legacy_source (
    media_asset_id BIGINT PRIMARY KEY REFERENCES media_asset (id),
    -- Legacys Klasse; sie bestimmt die Rolle des Bildes (settlement_image -> header, *_coat -> coat, citymap_full -> map_full,
    -- citymap_preview -> map_preview, literature_cover -> literature_cover). Eine Klasse ist keine Rolle: Legacy nennt die Rolle
    -- der Ortsbilder `gallery`.
    media_class TEXT NOT NULL,
    -- Legacys Herkunft des Bildes, roh: upload | external (Ortsbilder), custom | wiki_localized | wiki_staging (Wappen),
    -- upload | autoget (Kartenbilder), upload | autoget | wiki_sync | unknown (Cover).
    legacy_origin TEXT,
    -- Ortswappen: own | wiki; Gebietswappen: override | territory | staging. Sagt, welches Feld gewann, nicht die Lizenz.
    legacy_source TEXT,
    -- Ortsbilder: `string` (Altform, kein Objekt, also nie eine Einstufung) oder `object`.
    legacy_form TEXT,
    -- Die Adresse wie in Legacys Datenbank gespeichert (kann eine Wiki-Adresse sein), nur mit Export B.
    stored_url TEXT,
    -- Die Datei in Legacys Speicher (`/uploads/...`, ohne `?v=`): die einzige Adresse, die der Binärimport holt.
    local_url TEXT NOT NULL,
    -- Die Wiki-Quelldatei einer lokalisierten Kopie, wo Legacy sie kennt, nur mit Export B.
    source_url TEXT,
    -- Legacys eigenes Tor je Klasse: EVIDENZ, keine Freigabe.
    legacy_public BOOLEAN NOT NULL,
    -- Zeigt Legacy das Bild heute (Tor UND Schalter UND Objekt öffentlich)? Nur mit Export B, sonst NULL.
    legacy_shown BOOLEAN,
    -- `media_revision` des Manifests, aus dem die Zeile zuletzt kam (Information, kein Schlüssel).
    media_revision TEXT,
    -- Was Legacy beim Abruf der Datei sagte, wörtlich (Provenienz des Binärimports): `ETag` und `Last-Modified` der Antwort und der
    -- Zeitpunkt des Abrufs. Legacys Dateien unter bestehenden Adressen sind nicht unveränderlich (Media-Core-Plan, STOP-Regel 37):
    -- ein späterer Zug fragt mit diesen Werten bedingt nach und holt nur, was sich geändert hat. NULL: nie geholt (oder aus einer
    -- Kopie ohne diese Angaben übernommen).
    file_etag TEXT,
    file_last_modified TEXT,
    file_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_legacy_source_class_known CHECK (
        media_class IN (
            'settlement_image', 'settlement_coat', 'territory_coat', 'citymap_full', 'citymap_preview', 'literature_cover'
        )
    ),
    CONSTRAINT media_legacy_source_origin_known CHECK (
        legacy_origin IS NULL
        OR legacy_origin IN (
            'upload', 'external', 'custom', 'wiki_localized', 'wiki_staging', 'autoget', 'wiki_sync', 'unknown'
        )
    ),
    CONSTRAINT media_legacy_source_form_known CHECK (legacy_form IS NULL OR legacy_form IN ('string', 'object')),
    -- Nur Legacys eigener Speicher: keine fremde Adresse, kein Cache-Stempel (`?v=` ändert sich, die Datei nicht).
    CONSTRAINT media_legacy_source_local_url_own CHECK (local_url ~ '^/uploads/[^?#]+$')
);

CREATE INDEX IF NOT EXISTS media_legacy_source_class ON media_legacy_source (media_class);

COMMENT ON TABLE media_legacy_source IS
    'INTERN: Legacys Angaben zu einem importierten Medien-Asset (Klasse, Adresse der Datei, Herkunft, Legacys eigenes Tor als Evidenz). Nie in einer öffentlichen Antwort (WI-0063 MEDIA-M8).';
COMMENT ON COLUMN media_legacy_source.media_class IS
    'Legacys Klasse. Bestimmt die Rolle des Assets für Importer und Prüfer; Legacys Rollenwert (gallery, full, preview, cover) steht nirgends.';
COMMENT ON COLUMN media_legacy_source.local_url IS
    'Die Datei in Legacys Speicher, relativ (/uploads/…), ohne ?v=. Nur sie holt der Binärimport; eine fremde Adresse ist ein Befund (external_unlocalized).';
COMMENT ON COLUMN media_legacy_source.legacy_public IS
    'Legacys eigenes Veröffentlichungstor (Lizenz-Gate je Klasse). EVIDENZ, nie eine Freigabe in Avesmaps3D (media.yaml rechte.legacy_public_ist_keine_freigabe).';
COMMENT ON COLUMN media_legacy_source.legacy_form IS
    'Ortsbilder: string = Altform ohne Einstufung (Vorgabe ai_generated, legacy_assumed), object = Eintrag mit Feldern.';
