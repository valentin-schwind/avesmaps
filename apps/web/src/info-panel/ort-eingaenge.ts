import { mediaPhotoboxOrtEingaengeUrl, type PhotoboxOrtEingaenge } from "@avesmaps3d/shared";
import { getJson, type Fetcher } from "../auth/api";
import { eingangsbild } from "./bildbezug";
import type { HeaderImage } from "./panel-types";

/**
 * Die offenen Eingänge eines Ortes für den Kopf seiner Infobox (WI-0272 S5; Probierseite 7.1: „Editoren sehen offene Eingänge des Orts schon im Kopf“).
 *
 * 🔴 Nur im Editor-Modus mit `view_media_private`, und nur über die eigene geschützte Route der Medienverwaltung (`GET /api/editor/media/photobox/ort/:id/eingaenge`, `no-store`): Die öffentliche Antwort des Ortes
 * kennt keinen Eingang und wird öffentlich zwischengespeichert. Wer das Recht nicht hat, fragt hier gar nicht erst (der Aufrufer prüft es); fragt er doch, antwortet der Server 401 oder 403, und das heißt: keine
 * Eingänge.
 */

/** Holt die Eingänge; ein Fehler (kein Recht, keine Verbindung, ein älterer Server) heißt: keine. Ein jüngerer Wunsch bricht den älteren ab (`signal`). */
export async function ladeOrtEingaenge(
    ortId: string,
    fetcher: Fetcher = fetch,
    signal?: AbortSignal,
): Promise<HeaderImage[]> {
    try {
        const antwort = await getJson<PhotoboxOrtEingaenge>(mediaPhotoboxOrtEingaengeUrl(ortId), (url, init) =>
            fetcher(url, signal === undefined ? init : { ...init, signal }),
        );
        return antwort.eingaenge.map(eingangsbild);
    } catch {
        return [];
    }
}
