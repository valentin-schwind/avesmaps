import type { Map as MapLibreMap } from "maplibre-gl";
import { shallowRef, type ShallowRef } from "vue";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import { ORT } from "../map/geometrie/arten";
import type { Punkt, Teil } from "../map/geometrie/geometrie";
import { installGeometrieModus } from "../map/geometrie/modus";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { startansicht } from "../map/start-view";
import { createKraftlinienDaten, type KraftlinienDaten } from "./kraftlinien-daten";

/**
 * „Kraftlinienpunkt verschieben“ (WI-0205 K5, EDIT-0003 T52; Auftrag der Orchestrierung 2026-10-18: kein neuer Modus): die Punkt-Art des
 * Geometrie-Moduls, mit der auch „Ort verschieben“ läuft (`ORT` in `map/geometrie/arten.ts`, `map/geometrie/ort.ts`): derselbe Griff,
 * derselbe Kringel, dasselbe sofortige Speichern beim Loslassen.
 *
 * - **Start** aus dem Kartenmenü am Kraftlinienpunkt. Lage und Revision kommen aus den Nodices (`EditorPowerlineTarget.revision`).
 * - **Die Linien an ihm** sind die Nachbarn: je Abschnitt eine Strecke vom anderen Ende seiner gezeichneten Bahn zum Punkt; sie ziehen beim
 *   Ziehen mit (gerade, wie die Wegenden beim Ort). Kein Ziel: Ein Kraftlinienpunkt rastet nirgends ein.
 * - **Loslassen** ist EINE Operation `nodix.move`; der Server zieht die Bahnen nach, die Karte zeichnet mit der Revision der Quittung neu.
 *   Danach endet der Modus. **Esc** vorher: nichts gesendet.
 */

/** Was die Karte für den Modus tut; in der Seite gebunden (`createKraftlinienpunktVerschiebenFuerSeite`). */
export interface PunktKarte {
    /** Schaltet die Punkt-Art für diesen Punkt ein; ohne Karte (oder wenn schon ein Modus läuft) `undefined`. */
    ein(
        teile: readonly Teil[],
        nachbarn: readonly Teil[],
        losgelassen: (punkt: Punkt) => void,
    ): { abbrechen(): boolean; aus(): void } | undefined;
    /** Die Enden gegenüber dem Punkt, je Abschnitt einer Linie an ihm (Kartenkoordinaten). */
    gegenueber(id: string): readonly Punkt[];
    /** Nach dem Verschieben: Karte und Bögen neu (`revision` aus der Quittung). */
    geaendert(revision: number | undefined): void;
}

export interface KraftlinienpunktVerschiebenOptionen {
    readonly daten: Pick<KraftlinienDaten, "nodices" | "verschiebePunkt">;
    readonly karte: PunktKarte;
    readonly melde: (text: string, ton: "success" | "warning") => void;
    readonly neueKennung?: () => string;
}

export interface KraftlinienpunktVerschieben {
    /** Der Kraftlinienpunkt, an dem der Modus läuft. */
    readonly laufend: Readonly<ShallowRef<string | undefined>>;
    starte(id: string): Promise<boolean>;
    /** Esc: beendet einen laufenden Modus, der noch nichts gesendet hat. Gibt zurück, ob einer lief. */
    abbrechen(): boolean;
}

export function createKraftlinienpunktVerschieben(
    optionen: KraftlinienpunktVerschiebenOptionen,
): KraftlinienpunktVerschieben {
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    const laufend = shallowRef<string | undefined>(undefined);
    let modus: { abbrechen(): boolean; aus(): void } | undefined;
    let gesendet = false;

    function ende(): void {
        modus?.aus();
        modus = undefined;
        laufend.value = undefined;
        gesendet = false;
    }

    async function loslassen(id: string, revision: number, ziel: Punkt): Promise<void> {
        gesendet = true;
        const antwort = await optionen.daten.verschiebePunkt(id, {
            operationId: neueKennung(),
            baseRevision: revision,
            x: ziel.x,
            y: ziel.y,
        });
        ende();
        if (!antwort.ok) {
            optionen.melde(antwort.fehler.message, "warning");
            return;
        }
        optionen.karte.geaendert(antwort.quittung.mapRevision);
        optionen.melde(t("kraftlinieneditor.punkt.verschoben"), "success");
    }

    return {
        laufend,
        async starte(id) {
            if (laufend.value !== undefined) return false;
            const punkt = (await optionen.daten.nodices(new AbortController().signal))?.targets.find(
                (ziel) => ziel.id === id && ziel.kind === "nodix",
            );
            if (punkt?.revision === undefined) {
                optionen.melde(t("kraftlinieneditor.punkt.fehlt"), "warning");
                return false;
            }
            const revision = punkt.revision;
            const von: Punkt = { x: punkt.x, y: punkt.y };
            const teile: Teil[] = [
                { objekt: id, name: t("kraftlinieneditor.punkt"), nr: 0, art: "punkt", punkte: [von], revision },
            ];
            // Je Abschnitt eine Strecke, deren Ende genau auf dem Punkt liegt: So zieht das Modul sie mit.
            const nachbarn: Teil[] = optionen.karte.gegenueber(id).map((anderes, nr) => ({
                objekt: `${id}#${String(nr)}`,
                name: "",
                nr,
                art: "linie",
                punkte: [anderes, von],
                revision: 1,
            }));
            laufend.value = id;
            modus = optionen.karte.ein(teile, nachbarn, (ziel) => void loslassen(id, revision, ziel));
            if (modus === undefined) {
                laufend.value = undefined;
                return false;
            }
            return true;
        },
        abbrechen() {
            if (laufend.value === undefined || gesendet) return false;
            modus?.abbrechen();
            ende();
            return true;
        },
    };
}

export interface KraftlinienpunktSeite {
    karte(): MapLibreMap | undefined;
    interaction(): MapInteractionCoordinator | undefined;
    /** Die Enden gegenüber einem Knoten aus dem Netz der Bögen (`PowerlineArcsController.gegenueberAm`). */
    gegenueber(id: string): readonly Punkt[];
    geaendert(revision: number | undefined): void;
}

/** Der Modus für die Seite: Server, Karte und Fangradius verbunden, damit `app.vue` nur die Griffe reicht. */
export function createKraftlinienpunktVerschiebenFuerSeite(seite: KraftlinienpunktSeite): KraftlinienpunktVerschieben {
    return createKraftlinienpunktVerschieben({
        daten: createKraftlinienDaten(),
        melde: (text, ton) => showToast(text, ton),
        karte: {
            ein(teile, nachbarn, losgelassen) {
                const map = seite.karte();
                const interaction = seite.interaction();
                if (map === undefined || interaction === undefined) return undefined;
                const geometrie = installGeometrieModus(map, interaction, {
                    art: ORT,
                    teile: () => teile,
                    nachbarn: () => nachbarn,
                    ziele: () => [],
                    orte: () => [],
                    fangradius: () => startansicht().fangradius,
                    handbewegung(aenderung) {
                        if (aenderung.art !== "ziehen") return;
                        // Gesendet ist gesendet: Bis der Modus endet, packt niemand den Griff.
                        geometrie?.sperre(true);
                        const punkt = aenderung.teile.find((teil) => teil.objekt === teile[0]?.objekt)?.punkte[0];
                        if (punkt !== undefined) losgelassen(punkt);
                    },
                    // Klick und Rechtsklick am Griff gehören dem Modus (O2), wie beim Ort.
                    kontext: () => undefined,
                });
                return geometrie;
            },
            gegenueber: (id) => seite.gegenueber(id),
            geaendert: (revision) => seite.geaendert(revision),
        },
    });
}
