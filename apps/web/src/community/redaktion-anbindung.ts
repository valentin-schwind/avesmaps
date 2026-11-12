import { mapPointRef, type BezugObjektart } from "@avesmaps3d/shared";
import { oeffnenPlan, type ObjektZiel } from "../aenderungen/aenderung-modell";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import { flyToSubject } from "../info-panel/subject-camera";
import type { SubjectSelection } from "../info-panel/subject-selection";
import type { Camera } from "../map/camera/camera";
import { installiereHerkunft, setzeHerkunft } from "./herkunft";
import { redaktion, type VorgangBezug } from "./redaktion";

/**
 * Die Anbindung der Redaktion an die Seite (WI-0268 C3): was `app.vue` der Steuerung `redaktion.ts` einmal gibt. Hier steht, wie ein Bezug auf der Karte gezeigt und im passenden Editor geöffnet wird;
 * `app.vue` selbst kennt davon nur den Aufruf.
 *
 * - **Zeigen** (Bedienkonzept §2.2 Nr. 3): Ein Objekt wird gewählt und angeflogen wie über einen Objektlink (`openSubject`, Quelle `link`, Kamera `target`) und lässt das Infopanel zu: Das Fenster der Redaktion
 *   steht vor ihm (`still`). Eine Stelle wird angeflogen, wo sie liegt. Immer über `camera.ts` und nie ein Sprung.
 * - **Im Editor öffnen** (⚙, §2.4): derselbe Weg wie „Im Objektverlauf zeigen“ in „Änderungen“ (`oeffnenPlan`): Subjekt wählen, Werkzeug des Verbs öffnen, in der Reihenfolge, die die Art verlangt.
 *   Gespeichert wird allein im Editor, mit dessen Prüfungen und Sperren; der Vorgang schreibt nichts in die Karte (`map_mutation = false`).
 * - **Mit Herkunft** (WI-0268 C7, `herkunft.ts`): ⚙ setzt die COM-Nummer des Vorgangs VOR dem Öffnen des Werkzeugs, und jedes Speichern am Objekt trägt sie in der Kopfzeile `Avesmaps-Herkunft`;
 *   der Server merkt sie sich an der Kartenoperation, „Änderungen“ zeigt „aus COM-…“. Die Hülle um `fetch` legt `verbindeRedaktion` einmal; ohne ⚙ tut sie nichts.
 */

/** Das Subjekt und das Werkzeug je Objektart des Bezugs (dieselbe Zuordnung wie `objektZiel` des Objektverlaufs). */
export const ZIEL_JE_OBJEKTART: Readonly<Record<BezugObjektart, ObjektZiel>> = {
    place: { subject: "place", werkzeug: "ortseditor" },
    path: { subject: "path", werkzeug: "wegeditor" },
    area: { subject: "area", werkzeug: "landschaftseditor" },
    territory: { subject: "territory", werkzeug: "gebietseditor" },
    peak: { subject: "peak", werkzeug: "landschaftseditor" },
    powerline: { subject: "powerline", werkzeug: "kraftlinieneditor" },
};

export interface RedaktionUmfeld {
    readonly fenster: Werkzeugfenster;
    readonly selection: Pick<SubjectSelection, "openSubject">;
    /** Die Kamera der Seite; sie entsteht nach der Karte. */
    readonly kamera: () => Camera | undefined;
    /** Erst wenn die Karte bereit ist (`whenMapReady` der Seite). */
    readonly bereit: (aktion: () => void) => void;
    /** Das Verb eines Werkzeugs (`oeffneWerkzeug` der Seite). */
    readonly oeffneWerkzeug: (werkzeug: string) => void;
    /** Das Editorpanel zeigen und Community › Meldungen wählen, oder den genannten Unterreiter (der Klick in der Glocke, WI-0268 C5; `social` seit WI-0270). */
    readonly zeigeMeldungen: (unterreiter?: string) => void;
}

export function verbindeRedaktion(umfeld: RedaktionUmfeld): void {
    installiereHerkunft(umfeld.fenster.stand);
    redaktion.verbinde({
        fenster: umfeld.fenster,
        zeigeMeldungen: umfeld.zeigeMeldungen,
        zeige(bezug: VorgangBezug) {
            if (bezug.art === "objekt" && bezug.objektArt !== null && bezug.objektId !== null) {
                const plan = oeffnenPlan(ZIEL_JE_OBJEKTART[bezug.objektArt], bezug.objektId);
                umfeld.selection.openSubject(plan.ref, { source: "link", camera: "target", still: true });
                return;
            }
            // Eine Stelle (oder ein Objekt ohne Kennung) liegt, wo sie gemeldet wurde.
            const lage = bezug.lage;
            if (lage === null) return;
            umfeld.bereit(() => {
                const kamera = umfeld.kamera();
                if (kamera !== undefined) flyToSubject(kamera, mapPointRef(lage.x, lage.y), undefined);
            });
        },
        oeffneImEditor(bezug, vorgang) {
            const plan = oeffnenPlan(ZIEL_JE_OBJEKTART[bezug.objektArt], bezug.objektId);
            // Die Herkunft gilt ab hier, solange das Fenster des Werkzeugs offen ist; sie muss stehen, bevor das Werkzeug etwas lädt oder speichert.
            setzeHerkunft(vorgang, bezug.objektId, plan.werkzeug);
            if (plan.werkzeugZuerst) umfeld.oeffneWerkzeug(plan.werkzeug);
            umfeld.selection.openSubject(plan.ref, plan.optionen);
            if (!plan.werkzeugZuerst) umfeld.oeffneWerkzeug(plan.werkzeug);
        },
    });
}
