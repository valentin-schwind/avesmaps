import type { LandscapeBrushBody, LandscapeBrushResult } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { leseZeilen } from "./landscape-boolean.ts";
import { rechneStrich } from "./pinsel-strich.ts";

/**
 * „Fläche malen“ und „Fläche radieren“ (Werkzeug 6, `POST …/:id/brush`; Vertrag `LandscapeBrushBody`): EIN Strich, gerechnet, nichts
 * geschrieben. Die Rechnung teilt die Landschaft mit der Sprache (`pinsel-strich.ts`); hier steht, was nur die Landschaft prüft:
 *
 * - Die Teilfläche muss zu dieser Landschaft gehören und auf der Karte sein (404); ihre Revision prüft erst „Fertig“.
 */
export async function maleStrich(
    database: Database,
    regionId: string,
    body: LandscapeBrushBody,
): Promise<LandscapeBrushResult> {
    const teil = (await leseZeilen(database, [body.areaId], false)).get(body.areaId);
    if (teil === undefined || teil.region !== regionId)
        throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
    return rechneStrich(database, body);
}
