import type {
    EditorLandscapeArea,
    EditorLandscapeDetail,
    EditorLandscapeLayer,
    EditorLandscapeTargets,
} from "@avesmaps3d/shared";
import type { EditorSperre } from "../editor-sperre/sperre";
import { FLAECHE } from "../map/geometrie/arten";
import { ENTWURF_SCHRITTE, type Entwurf } from "../fenster/entwurf-kern";
import {
    createFormentwurf,
    kantenZiele,
    ringZiele,
    teileAus as ringeAls,
    type FormKarte,
    type FormLauf,
    type FormMeldung,
    type FormQuelle,
    type FormStand,
    type Formentwurf,
} from "../map/geometrie/formentwurf";
import type { Teil, Ziel } from "../map/geometrie/geometrie";
import { aufbauAus, type Aufbau } from "../map/geometrie/formoperation";

export { standNach } from "../map/geometrie/formentwurf";
export { aufbauAus, operationAus, type Aufbau } from "../map/geometrie/formoperation";

/**
 * „✎ Ecken bearbeiten“ an einer Landschaft (WI-0178 C1, C2; EDIT-0004 §2.3; EDIT-0003 T27 (4), (6), (7), (13)) als Quelle des
 * gemeinsamen Formentwurfs (`map/geometrie/formentwurf.ts`, seit WI-0209 C1): Was hier steht, ist nur, was die Landschaft anders hat.
 * Ablauf, Entwurf, Sperre, „Fertig“ und Esc stehen im Kopf von `formentwurf.ts` und `fenster/entwurf-kern.ts`.
 *
 * - **Lesen:** die Landschaft mit ihren Teilflächen (eckig, mit Revision) und die Andockziele um sie
 *   (`GET /api/editor/landscapes/:id/targets`): die Nachbarn derselben Ebene mit gemeinsamen Ecken ganz, die Kanten anderer Flächen
 *   der sichtbaren Ebenen, die Stützpunkte der Flüsse. Ohne Teilfläche gibt es nichts zu bearbeiten (Zeichnen kommt mit C3).
 * - **Schreiben** (B2, O3; EDIT-0003 T44): Die Form steht im EINEN Entwurf der Landschaft (`fenster/bearbeitung.ts`, `entwurf`), und
 *   „Fertig“ der Bearbeitung schreibt sie mit den Feldern als `landscape.update` (`landschaft-art.ts`): jede Teilfläche, die der
 *   Entwurf geändert hat, und die Nachbarn, deren gemeinsame Ecken mitgezogen sind, je gegen ihre Revision. Einen eigenen Schreibweg hat
 *   „Ecken bearbeiten“ nicht mehr; wie viele Ringe jedes Polygon hat, meldet das Lesen an die Art (`merkeAufbau`).
 */

/** So weit gehen ↶ und Strg+Z zurück (Betreiber 2026-10-16, T27 (7): „bis 20 Schritte“). */
export const ECKEN_SCHRITTE = ENTWURF_SCHRITTE;

export interface EckenDaten {
    landschaft(regionId: string, signal: AbortSignal): Promise<EditorLandscapeDetail | null>;
    ziele(
        regionId: string,
        ebenen: readonly EditorLandscapeLayer[],
        signal: AbortSignal,
    ): Promise<EditorLandscapeTargets | null>;
}

export type EckenKarte = FormKarte;
export type EckenLauf = FormLauf;
export type EckenMeldung = FormMeldung;
export type Ecken = Formentwurf;
/** Was im Entwurf steht: die eigenen Ringe und die Ringe der Nachbarn, wie sie nach den Schritten liegen. */
export type Stand = FormStand;

export interface EckenOptionen {
    readonly daten: EckenDaten;
    readonly karte: EckenKarte;
    readonly fangradius: () => number;
    /** Die sichtbaren Ebenen der Karte: Nur deren Kanten sind Ziele (T27 (1)). */
    readonly ebenen: () => readonly EditorLandscapeLayer[];
    /** Die Sperre während der Bearbeitung (EDIT-0003 §4): Der Modus beginnt erst, wenn die Landschaft gesperrt ist. */
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust" | "liste">;
    /** Der EINE Entwurf der Landschaft (O3, `bearbeitung.formEntwurf()`); ohne Angabe ein eigener (Tests). */
    readonly entwurf?: Entwurf<FormStand>;
    /** Wie viele Ringe jedes Polygon der eigenen Flächen und der Nachbarn hat, sobald gelesen (für `landscape.update`). */
    readonly merkeAufbau?: (aufbau: Aufbau) => void;
}

/** Die Ringe von Teilflächen als Teile: je Teilfläche ein Objekt, `nr` zählt ihre Ringe über alle Polygone. */
export function teileAus(
    flaechen: readonly Pick<EditorLandscapeArea, "id" | "polygons" | "revision">[],
    name: string,
): Teil[] {
    return ringeAls(flaechen, name);
}

/**
 * Die Ziele des Modus: Ecken und Kanten der Nachbarn (mit ihrer Stelle, damit sie mitziehen und später gespeichert werden können),
 * der Nachbarn, die ein anderer gerade bearbeitet (`gehalten`: einrasten ja, mitziehen nein, als hielte man Strg; EDIT-0003 §4), der
 * anderen Flächen im Kasten und die Stützpunkte der Flüsse. Doppelte Ecken (zwei Kanten teilen ihr Ende) stehen einmal.
 */
export function zieleAus(
    ziele: EditorLandscapeTargets,
    nachbarn: readonly Teil[],
    gehalten: readonly Teil[] = [],
): Ziel[] {
    const raus: Ziel[] = [];
    const gesehen = new Set<string>();
    const ecke = (ziel: Ziel): void => {
        const schluessel = `${ziel.objekt} ${ziel.at.x.toFixed(5)} ${ziel.at.y.toFixed(5)}`;
        if (gesehen.has(schluessel)) return;
        gesehen.add(schluessel);
        raus.push(ziel);
    };
    ringZiele(nachbarn, true, gesehen, raus);
    ringZiele(gehalten, false, gesehen, raus);
    kantenZiele(ziele.edges, gesehen, raus);
    for (const punkt of ziele.riverPoints)
        ecke({ art: "ecke", at: { x: punkt.x, y: punkt.y }, objekt: punkt.pathId, name: punkt.name });
    return raus;
}

export function createEcken(optionen: EckenOptionen): Ecken {
    const { daten } = optionen;
    const quelle: FormQuelle = {
        sperrArt: "landscape",
        async lade(regionId, signal) {
            const [detail, gefunden] = await Promise.all([
                daten.landschaft(regionId, signal),
                daten.ziele(regionId, optionen.ebenen(), signal),
            ]);
            if (detail === null || gefunden === null) return null;
            optionen.merkeAufbau?.(aufbauAus([...detail.areas, ...gefunden.neighbors]));
            return {
                sperrId: regionId,
                name: detail.name,
                teile: teileAus(detail.areas, detail.name),
                nachbarn: gefunden.neighbors.map((n) => ({
                    sperrId: n.regionId,
                    name: n.name,
                    teile: teileAus([n], n.name),
                })),
                ziele: (freie, gehalten) => zieleAus(gefunden, freie, gehalten),
            };
        },
    };
    return createFormentwurf({
        art: FLAECHE,
        quelle,
        karte: optionen.karte,
        fangradius: optionen.fangradius,
        sperre: optionen.sperre,
        // Was der Server beim Speichern ablehnen würde, übernimmt schon der Schritt nicht (Vali 2026-11-10, `form-regel.ts`).
        pruefeSchritte: true,
        ...(optionen.entwurf === undefined ? {} : { entwurf: optionen.entwurf }),
    });
}
