import type { Component } from "vue";
import {
    EDITOR_LANDSCAPE_BOX_TARGETS_URL,
    EDITOR_LANDSCAPES_URL,
    type EditorLandscapeLayer,
    type EditorLandscapeTargets,
    type LandscapeCreateBody,
    type LandscapeCreateReceipt,
} from "@avesmaps3d/shared";
import { sende } from "../fenster/entwurf-senden";
import { FLAECHE_ANLEGEN } from "../map/geometrie/arten";
import { kantenZiele } from "../map/geometrie/formentwurf";
import type { Ziel } from "../map/geometrie/geometrie";
import type { NeueFlaecheAndockung, NeueFlaecheErgebnis } from "../map/geometrie/neue-flaeche";

/**
 * Die Andockung der Derographie an „Neue Fläche“ (WI-0178 T47; gemeinsamer Ablauf C3 `map/geometrie/neue-flaeche.ts`, Kopf
 * `project-control/discovery/wi-0209-c3-neue-flaeche-schnittstelle-2026-10-18.md`): je Ebene eine.
 *
 * - **Ansicht:** die Derographie in der Ebene der Fläche; der Ablauf schaltet um und nach einem Abbruch zurück, nach „Fertig“ bleibt sie.
 * - **Ziele:** Ecken und Kanten der Flächen DERSELBEN Ebene im Kasten des Ausschnitts und die Stützpunkte der Flüsse
 *   (`GET /api/editor/landscapes/targets`), wie beim Formen einer Fläche (`ecken.ts`), nur ohne Nachbarn: Eine neue Fläche zieht nichts mit.
 * - **Schreiben:** `landscape.create` (`POST /api/editor/landscapes`), der Ring eckig, wie gezeichnet.
 * - **Danach:** das Fenster an der neuen Fläche, der Name markiert (`geoeffnet` der Steuerung).
 * - **Zusatz:** der Regler „Untergrund“ in der Leiste (C3, Frage 5), dasselbe Bauteil wie in der Ebenenleiste.
 */
export interface DerographieAndockungDeps {
    readonly fetcher?: typeof fetch;
    /** Das Bauteil für den Platz `#zusatz` der Leiste: der Regler „Untergrund“ (`untergrund-regler.vue`, von der Seite gereicht). */
    readonly zusatz?: Component | undefined;
    /** Die Fläche entsteht für diesen Wiki-Eintrag (WI-0284): `wiki_region_snapshot.public_id`. */
    readonly wikiEintrag?: string | undefined;
    /** Gespeichert: das Fenster an der neuen Fläche, der Name markiert. */
    geoeffnet(neu: { readonly publicId: string; readonly name: string }): void;
}

/** Die Ziele aus der Antwort: Ecken und Kanten der Flächen, die Flusspunkte als Ecken; doppelte Ecken stehen einmal. */
export function zieleImKasten(ziele: EditorLandscapeTargets): Ziel[] {
    const raus: Ziel[] = [];
    const gesehen = new Set<string>();
    kantenZiele(ziele.edges, gesehen, raus);
    for (const punkt of ziele.riverPoints) {
        const schluessel = `${punkt.pathId} ${punkt.x.toFixed(5)} ${punkt.y.toFixed(5)}`;
        if (gesehen.has(schluessel)) continue;
        gesehen.add(schluessel);
        raus.push({ art: "ecke", at: { x: punkt.x, y: punkt.y }, objekt: punkt.pathId, name: punkt.name });
    }
    return raus;
}

export function derographieAndockung(
    ebene: EditorLandscapeLayer,
    deps: DerographieAndockungDeps,
): NeueFlaecheAndockung {
    const fetcher = deps.fetcher ?? ((url, init) => fetch(url, init));
    return {
        id: ebene,
        art: FLAECHE_ANLEGEN,
        ansicht: { view: "landscapes", layer: ebene },
        titel: `layer.${ebene}`,
        zusatz: deps.zusatz,
        darf: () => undefined,
        async ziele(kasten, _um, signal) {
            const adresse = `${EDITOR_LANDSCAPE_BOX_TARGETS_URL}?${new URLSearchParams({
                layer: ebene,
                x0: String(kasten.x0),
                y0: String(kasten.y0),
                x1: String(kasten.x1),
                y1: String(kasten.y1),
            }).toString()}`;
            try {
                const antwort = await fetcher(adresse, { headers: { accept: "application/json" }, signal });
                if (!antwort.ok) return null;
                return zieleImKasten((await antwort.json()) as EditorLandscapeTargets);
            } catch {
                return null;
            }
        },
        async schreibe(ring, operationId): Promise<NeueFlaecheErgebnis> {
            const body: LandscapeCreateBody = {
                operationId,
                layer: ebene,
                ring: ring.map((p) => [p.x, p.y]),
                ...(deps.wikiEintrag === undefined ? {} : { wikiEintrag: deps.wikiEintrag }),
            };
            const antwort = await sende<LandscapeCreateReceipt>(EDITOR_LANDSCAPES_URL, body, "POST", fetcher);
            if (antwort.ok)
                return {
                    ok: true,
                    publicId: antwort.quittung.publicId,
                    name: antwort.quittung.name,
                    mapRevision: antwort.quittung.mapRevision,
                };
            return antwort.status > 0 && antwort.status < 500
                ? { ok: false, satz: antwort.fehler.message }
                : { ok: false, status: antwort.status };
        },
        geoeffnet: (neu) => deps.geoeffnet(neu),
    };
}
