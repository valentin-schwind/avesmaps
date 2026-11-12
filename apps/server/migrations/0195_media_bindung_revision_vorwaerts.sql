-- Gleichzeitige Wechsel an einem Platz (WI-0068 R8, Befund 2026-10-18, `apps/server/test/media-wettlauf.test.ts`).
--
-- Der gesehene Stand eines Platzes (Wappen eines Orts oder Gebiets, Titelbild eines Orts, ★ einer Typbildkategorie) ist die Revision
-- seiner AKTIVEN Zeile. Ersetzt ein Wechsel das Bild, wird die alte Zeile zurückgezogen und eine andere aktiv: eine neue (sie begann bei
-- Revision 1) oder eine früher zurückgezogene desselben Bildes (sie zählte von ihrem alten Stand um eins weiter). Traf diese Zahl die,
-- die eine zweite Redakteurin gesehen hatte, ging deren Wechsel durch und ersetzte den ersten still: beide bekamen 200.
--
-- Die Anwendung setzt die Revision der neu aktiven Zeile deshalb über jede, die der Platz je trug (`naechsteRevision` in
-- `apps/server/src/media-editor/binding-operations.ts`, ebenso in `type-images.ts`). Beim Anlegen geht das ohne Hilfe; beim Zurückholen
-- einer Zeile übernimmt der Revisionstrigger die gesetzte höhere Zahl nur mit `revision_bump_forward()` (0115: GREATEST(OLD + 1, NEW)).
-- Diese Migration stellt die drei Trigger darauf um.
--
-- Additiv: keine neue Funktion, keine neuen Rechte (PostgreSQL prüft das Recht an der Triggerfunktion beim Anlegen des Triggers), keine
-- Datenänderung. Das vorige Release setzt `revision` nie und zählt mit `revision_bump_forward()` genau wie mit `revision_bump()`.

CREATE OR REPLACE TRIGGER place_media_revision BEFORE UPDATE ON place_media
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

CREATE OR REPLACE TRIGGER territory_media_revision BEFORE UPDATE ON territory_media
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

CREATE OR REPLACE TRIGGER media_type_image_revision BEFORE UPDATE ON media_type_image
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();
