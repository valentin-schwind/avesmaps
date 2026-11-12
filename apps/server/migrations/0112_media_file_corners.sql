-- Wappen mit Mängeln (WI-0068 P4b T2b; Betreiber 2026-10-10: Wappen haben Qualitätsmerkmale, „transparenter hintergrund und
-- quadratisches format“; der Bestand bleibt, was die Merkmale nicht erfüllt, steht im Korb „Wappen mit Mängeln“).
--
-- Ob die vier Ecken eines Wappens durchsichtig sind, ist eine Eigenschaft der BYTES des Originals (wie `sha256`), gemessen von der
-- Pipeline an einer 32 × 32-Fassung (`render.ts`, `cornersTransparent`, Schwelle `CORNER_ALPHA_MAX`). Die Spalte HÄLT NUR FEST: Über die
-- Veröffentlichung entscheidet die Messung weiter nur bei einem Wappen aus dem Editor (es wird zum Quadrat aufgefüllt und bleibt mit
-- undurchsichtigen Ecken privat, T2a); der Bestand aus Legacy bleibt veröffentlicht, wie er ist, und steht nur im Korb.
--
-- Gefüllt vom Abgleich (`media_settle`) und vom Binärimport (`migrate:media-files`) an der Zeile `private_source`; NULL heißt: noch nicht
-- gemessen (ein Lauf misst nach, was fehlt), bei Nicht-Wappen bleibt sie NULL.
--
-- Additiv (AGENTS.md „erst erweitern, dann umstellen, dann entfernen“): eine nullbare Spalte ohne Vorgabe; das vorige Release liest und
-- schreibt weiter, ohne sie zu kennen. Keine neuen Rechte (die App- und die Jobs-Rolle schreiben `media_file` schon).

ALTER TABLE media_file ADD COLUMN IF NOT EXISTS corners_transparent BOOLEAN;

COMMENT ON COLUMN media_file.corners_transparent IS
    'Nur an private_source eines Wappens: Sind die vier Ecken des Bildes durchsichtig (Pipeline, 32 x 32, Alpha <= 15)? NULL: noch nicht gemessen oder kein Wappen. Hält fest, entscheidet nicht (außer beim Wappen aus dem Editor, T2a).';
