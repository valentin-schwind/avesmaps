-- Ähnliche Bilder finden (WI-0068 D2; Plan `project-control/handovers/2026-10-11-medien-duplikate-bewertung.md` §1, Pakete D1 bis D3
-- nach dem Betreiber 2026-10-11: „gibt es eine möglichkeit das medienmanagement genau solche "duplikate" zu finden und zu aggregieren“).
--
-- Bytegleiche Duplikate erkennt die SHA-256 des Originals (D1, gebaut und auf der Stage abgenommen). Für dasselbe Bild in anderer Größe
-- oder anderem Format hält diese Spalte einen Wahrnehmungs-Hash fest: 64 Bit als 16 Hexziffern, eine Eigenschaft der BYTES des Originals
-- wie `sha256` und `corners_transparent`, gerechnet von der Pipeline (`apps/server/src/media/raster/wahrnehmung.ts`, Rezept
-- `WAHRNEHMUNG_REZEPT`).
--
-- Die Spalte HÄLT NUR FEST und entscheidet nichts: kein Zusammenführen, keine Veröffentlichung, kein Korb, bis die Kalibrierung am
-- Bestand eine Schwelle je Asset-Typ ergeben hat (`npm run media:aehnlich -- --bericht`). Gefüllt vom Abgleich (`media_settle`), vom
-- Binärimport (`migrate:media-files`, nur wenn er ein Asset ohnehin rechnet) und für den Bestand von `media:aehnlich -- --nachholen
-- --schreiben`. NULL heißt: noch nicht gerechnet.
--
-- Additiv (AGENTS.md „erst erweitern, dann umstellen, dann entfernen“): eine nullbare Spalte ohne Vorgabe und eine Prüfung der Form; das
-- vorige Release liest und schreibt weiter, ohne sie zu kennen. Das Schreibrecht der Jobs-Rolle an genau dieser Spalte steht in
-- `apps/server/src/db/media-grants.psql`.

ALTER TABLE media_file ADD COLUMN IF NOT EXISTS perceptual_hash TEXT;

ALTER TABLE media_file DROP CONSTRAINT IF EXISTS media_file_perceptual_hash_form;
ALTER TABLE media_file ADD CONSTRAINT media_file_perceptual_hash_form
    CHECK (perceptual_hash IS NULL OR (storage_class = 'private_source' AND perceptual_hash ~ '^[0-9a-f]{16}$'));

COMMENT ON COLUMN media_file.perceptual_hash IS
    'Nur an private_source: Wahrnehmungs-Hash des Originals (dHash 9 x 8, 16 Hexziffern, WI-0068 D2). NULL: noch nicht gerechnet. Hält fest, entscheidet nichts.';
