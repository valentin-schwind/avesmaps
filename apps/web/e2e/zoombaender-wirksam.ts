import type { APIRequestContext } from "@playwright/test";
import { ZOOM_BANDS_URL, wirksameZoombaender, type Zoomspanne } from "@avesmaps3d/shared";

/**
 * Die gültige Spanne einer Spur (`orte.dorf.zeichen` …), wie die Karte sie vor dem Start liest (WI-0221, `map/zoombaender-stand.ts`):
 * die Vorgabe des geteilten Pakets mit den Abweichungen aus der Systemsteuerung (`GET /api/zoom-bands`); ohne Antwort die Vorgabe.
 * Ein Test, der an einem Band hängt, rechnet damit statt mit einer festen Zahl: Verstellt der Betreiber eine Spanne, bleibt er richtig.
 */
export async function wirksameSpanne(request: APIRequestContext, id: string): Promise<Zoomspanne> {
    let abweichungen: Record<string, unknown> = {};
    const antwort = await request.get(ZOOM_BANDS_URL);
    if (antwort.ok()) {
        const body = (await antwort.json()) as { abweichungen?: unknown } | null;
        if (typeof body?.abweichungen === "object" && body.abweichungen !== null)
            abweichungen = body.abweichungen as Record<string, unknown>;
    }
    const spanne = wirksameZoombaender(abweichungen)[id];
    if (spanne === undefined) throw new Error(`keine Spur ${id} im Katalog der Zoombänder`);
    return spanne;
}
