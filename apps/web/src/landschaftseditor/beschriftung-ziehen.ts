import type { Map as MapLibreMap } from "maplibre-gl";
import { shallowRef, watch, type ShallowRef, type WatchStopHandle } from "vue";
import type { GeometrieArt, Teil } from "../map/geometrie/geometrie";
import { installGeometrieModus, type GeometrieModus } from "../map/geometrie/modus";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * „Auf der Karte verschieben“ an einer Beschriftung (WI-0178 C4; EDIT-0004 §2.5: „Eine Beschriftung ‚an einem Punkt‘ wird auf der Karte
 * gezogen (Modus mit der Strategie Punkt, wie der Ort)“). Der Modus des gemeinsamen Geometrie-Moduls mit EINEM Punkt, ohne Einrasten und
 * ohne Mitziehen; jeder Zug geht in den EINEN Entwurf der Fläche (O3: Feld `labels[id].x/y`), die Leiste „Felder“ mit „Fertig“ kommt
 * mit dem ersten Zug, ↶ nimmt einen Zug zurück. „Fertig“ schreibt die Lage als `landscape.update` (`labels[].changes.position`).
 *
 * Der Modus endet, wenn die Bearbeitung nach einem Zug endet (Fertig, Verwerfen), mit „Verschieben beenden“ im Fenster oder wenn ein
 * anderer Modus beginnen soll, und wenn das Fenster der Fläche schließt. Der Name auf der Karte rückt erst mit „Fertig“; bis dahin zeigt
 * der Anfasser die neue Lage.
 */

export interface BeschriftungZiehenSeite {
    karte(): { map: MapLibreMap; interaction: MapInteractionCoordinator } | undefined;
    /** Die Bearbeitung dieser Fläche; öffnet ihr Fenster. Ohne Schreibrecht keine. */
    bearbeitung(regionId: string): LandschaftBearbeitung | undefined;
    /** Trägt noch ein Fenster die Fläche? Schließt es, endet der Modus. */
    offen(regionId: string): boolean;
    fangradius(): number;
}

export interface BeschriftungZiehen {
    /** Welche Beschriftung gerade gezogen werden kann. */
    readonly laufend: Readonly<ShallowRef<{ readonly regionId: string; readonly labelId: string } | undefined>>;
    starte(regionId: string, labelId: string): void;
    beende(): void;
}

/** Ein Punkt ohne Einrasten, ohne Löschen und ohne Mitziehen. */
const BESCHRIFTUNG: GeometrieArt = {
    id: "beschriftung",
    teilart: "punkt",
    rundung: (punkte) => [...punkte],
    ziele: () => [],
    zielErlaubt: () => false,
    mindestens: 1,
    loeschbar: () => false,
    einfuegen: false,
    speichern: { art: "sofort" },
    mitziehen: false,
    huelleInRuhe: () => true,
    loesen: false,
};

export function createBeschriftungZiehen(seite: BeschriftungZiehenSeite): BeschriftungZiehen {
    const laufend = shallowRef<{ regionId: string; labelId: string } | undefined>(undefined);
    let modus: GeometrieModus | undefined;
    let stop: WatchStopHandle[] = [];

    function beende(): void {
        for (const s of stop) s();
        stop = [];
        modus?.aus();
        modus = undefined;
        laufend.value = undefined;
    }

    function starte(regionId: string, labelId: string): void {
        beende();
        const karte = seite.karte();
        const bearbeitung = seite.bearbeitung(regionId);
        if (karte === undefined || bearbeitung === undefined) return;
        const teil = (): Teil[] => {
            const felder = bearbeitung.stand.value?.felder.labels[labelId];
            const label = bearbeitung.detail.value?.labels.find((l) => l.id === labelId);
            const x = felder?.x ?? label?.x;
            const y = felder?.y ?? label?.y;
            if (x === undefined || y === undefined) return [];
            return [
                {
                    objekt: labelId,
                    name: label?.text ?? "",
                    nr: 0,
                    art: "punkt",
                    punkte: [{ x, y }],
                    revision: label?.revision ?? 1,
                },
            ];
        };
        const neu = installGeometrieModus(karte.map, karte.interaction, {
            art: BESCHRIFTUNG,
            teile: teil,
            nachbarn: () => [],
            ziele: () => [],
            orte: () => [],
            fangradius: seite.fangradius,
            handbewegung(aenderung) {
                if (aenderung.art !== "ziehen") return;
                const p = aenderung.teile[0]?.punkte[0];
                if (p === undefined) return;
                bearbeitung.feld((felder) => {
                    const label = felder.labels[labelId];
                    return label === undefined
                        ? felder
                        : { ...felder, labels: { ...felder.labels, [labelId]: { ...label, x: p.x, y: p.y } } };
                });
                neu?.aktualisiere();
            },
            // Rechtsklick am Anfasser gehört dem Modus (O2), ein Menü gibt es dafür nicht.
            kontext: () => undefined,
            werkzeug: "landschaftseditor",
        });
        if (neu === undefined) return;
        modus = neu;
        laufend.value = { regionId, labelId };
        let warAktiv = bearbeitung.lage.value.aktiv;
        stop = [
            watch(
                () => seite.offen(regionId),
                (offen) => {
                    if (!offen) beende();
                },
            ),
            // ↶, ↷ und ein neuer Stand: der Anfasser folgt dem Entwurf.
            watch(
                () => bearbeitung.stand.value,
                () => modus?.aktualisiere(),
            ),
            // Nach einem Zug endet der Modus mit der Bearbeitung (Fertig, Verwerfen); während gespeichert wird, ruht der Anfasser.
            watch(
                () => [bearbeitung.lage.value.aktiv, bearbeitung.zustand.value.art] as const,
                ([aktiv, art]) => {
                    modus?.sperre(art === "speichert");
                    if (warAktiv && !aktiv) beende();
                    warAktiv = aktiv;
                },
            ),
        ];
    }

    return { laufend, starte, beende };
}
