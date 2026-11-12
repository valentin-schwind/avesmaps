import { ApiError } from "../http/api-error.ts";
import { PHOTOBOX_QUELLSYSTEM } from "../photobox/db.ts";

/**
 * Reisebilder bleiben in ihren Rollen (WI-0272 S3, Fixrunde Block F, Review I7; Fachkonzept §13): Ein Reisebild ist die Einreichung eines Besuchers und wird nur über die Rolle
 * `photobox` öffentlich, nach der Freigabe der Redaktion und der Freigaberegel. Kein Editor bindet es als Wappen oder Titelbild, legt es in eine Galerie oder macht es zum
 * Typbild: Dort griffe weder der Schalter `media.role.photobox` noch die Aufbewahrung nach dem Offline-Nehmen (die Bindung hielte alle Dateien fest). Der Server sagt es mit
 * 409 `media_photobox_not_bindable`, vor jeder anderen Prüfung des Typs.
 *
 * Die Auswahl in der Oberfläche filtert noch nicht nach Herkunft; S5 bekommt für die Galerie je Ort einen eigenen Weg.
 */
export function requireNichtReisebild(asset: { sourceSystem: string | null }): void {
    if (asset.sourceSystem !== PHOTOBOX_QUELLSYSTEM) return;
    throw new ApiError(
        409,
        "media_photobox_not_bindable",
        "Ein Reisebild lässt sich nirgends einbinden: Es bleibt ein Reisebild an seiner Kartenstelle.",
    );
}
