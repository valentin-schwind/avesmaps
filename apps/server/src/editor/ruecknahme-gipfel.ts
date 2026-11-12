import type { RuecknahmeBody, RuecknahmePruefung, RuecknahmeReceipt, RuecknahmeVorschauBody } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import type { MapActor } from "./map-operation.ts";
import { familieVon, ruecknehmenMit, vorschauMit } from "./ruecknahme-flaeche.ts";
import type { RuecknahmeLeser } from "./ruecknahme.ts";

/**
 * Einen Gipfel zurücknehmen (WI-0265 B6c; Fachvertrag C.1 bis C.3, F.1): die Familie des Gipfels, `POST /api/editor/peaks/:id/restore-series[/preview]`. Der Gipfel ist ein eigener Scope
 * (sein Protokolleintrag nennt die Landschaft nicht, `arbeitsserie.ts`), seine Serien sind Folgen von „Fertig“ an demselben Gipfel; jedes Mitglied berührt den Gipfel `:id`.
 *
 * - **Was zurückgeht** (Parität mit dem Client-↺ im Fenster des Gipfels, das nur „Gipfel entfernen …“ zurückholte, und mehr): Name, Höhe, „Auf der Karte anzeigen“ und Lage
 *   (`peak.update`, auch als Serie), Stilllegen und Zurückholen (`peak.retire`, `peak.restore`, ein „Entfernen …“ der Mehrfachauswahl, das ihn mitnahm; dann kommen ihre Landschaften mit zurück,
 *   ganz oder gar nicht). Seit WI-0265 B8c auch das Setzen (`peak.create`, Berggipfel, Vulkan oder Landmarke): Es geht zurück als Stilllegen (`peak.retired`, derselbe Weg wie Entfernen); die Rücknahme dieser Rücknahme
 *   belebt wieder. Ein Gipfel oder Vulkan, der im Gelände steht, löst dabei genau EINE Geländekette aus, eine Landmarke ohne Geländewirkung keine.
 * - **Die Höhe folgt dem Wiki** (WI-0253 §21): Eine Höhe, die ohne Vermerk dem Wiki folgte, kommt mit dem Vermerk `wiki` zurück (`gipfelSchreiben` mit der Herkunft von vorher), eine eigene Höhe
 *   als eigene. Eine Höhe, die vorher leer war, kann der Schreibweg nicht leeren: Konflikt `gipfel_wert`.
 * - **Adapter, Inverse und Quittung** sind die der Derographie (`ruecknahme-flaeche.ts`); hier steht nur, was am Gipfel hängt: die Karte, die Operation `peak.restore_series` und der Scope.
 * - **EIN Adapter für jede Landmarkenart** (WI-0271 L3): Art und Merkmale gehen wie Name und Lage zurück. Ein Wechsel der Geländewirkung (Berggipfel ↔ Höhle) rechnet das Gelände in EINER
 *   Kette über die Schreibnaht, ein Wechsel unter Arten ohne Gelände keine; ein Gipfelfeld, das der Adapter nicht kennt, ist `not_revertable` (Grund `art`).
 */

/** Die Karte eines Gipfels, auch eines gelöschten (dessen Entfernen die Rücknahme zurückholt); 404, wenn es ihn nicht gibt. */
async function karteDesGipfels(database: Queryable, peakId: string): Promise<string> {
    const [zeile] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM terrain_peak WHERE public_id = ${peakId}::uuid
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diesen Gipfel gibt es nicht.");
    return zeile.map_domain_id;
}

/** `POST /api/editor/peaks/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauGipfel(
    database: Database,
    peakId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const karte = await karteDesGipfels(database, peakId);
    return vorschauMit(database, familieVon({ art: "peak", id: peakId }, karte), body, leser);
}

/** `POST /api/editor/peaks/:id/restore-series`. */
export async function ruecknehmenGipfel(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    peakId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const karte = await karteDesGipfels(database, peakId);
    return ruecknehmenMit(database, actor, leser, familieVon({ art: "peak", id: peakId }, karte), body);
}
