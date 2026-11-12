import type { Map as MapLibreMap } from "maplibre-gl";
import { shallowRef, watch, type ShallowRef, type WatchStopHandle } from "vue";
import { LANDMARKE } from "../map/geometrie/arten";
import type { Teil } from "../map/geometrie/geometrie";
import { installGeometrieModus, type GeometrieModus } from "../map/geometrie/modus";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import type { GipfelBearbeitung } from "./landschaftseditor-steuerung";

/**
 * „Auf der Karte verschieben“ am Gipfel oder Vulkan (WI-0178 P2; Betreiber über Claudio 2026-10-18: „es gibt keine möglichkeit berge zu
 * verschieben, weil man kann nicht draufklicken :)“). Wie das Verschieben einer Beschriftung (`beschriftung-ziehen.ts`): der Modus des
 * gemeinsamen Geometrie-Moduls mit EINEM Punkt, ohne Einrasten und Mitziehen; jeder Zug geht in den EINEN Entwurf des Gipfels (Felder
 * `x`, `y`), die Leiste mit „Fertig“ kommt mit dem ersten Zug, ↶ nimmt ihn zurück. „Fertig“ schreibt `peak.update` mit der Lage, und das
 * Gelände rechnet im Umkreis (der Fuß zeigt das Band).
 *
 * Der Modus endet mit der Bearbeitung nach einem Zug (Fertig, Verwerfen), mit „Verschieben beenden“ und wenn das Fenster schließt.
 */
export interface GipfelZiehenSeite {
    karte(): { map: MapLibreMap; interaction: MapInteractionCoordinator } | undefined;
    /** Die Bearbeitung des Gipfels (Gegenstand `gipfel:<Kennung>`); ohne Schreibrecht keine. */
    bearbeitung(gegenstand: string): GipfelBearbeitung | undefined;
    /** Trägt noch ein Fenster den Gipfel? Schließt es, endet der Modus. */
    offen(gegenstand: string): boolean;
    fangradius(): number;
}

export interface GipfelZiehen {
    /** Welcher Gipfel gerade gezogen werden kann (sein Gegenstand). */
    readonly laufend: Readonly<ShallowRef<string | undefined>>;
    starte(gegenstand: string): void;
    beende(): void;
}

export function createGipfelZiehen(seite: GipfelZiehenSeite): GipfelZiehen {
    const laufend = shallowRef<string | undefined>(undefined);
    let modus: GeometrieModus | undefined;
    let stop: WatchStopHandle[] = [];

    function beende(): void {
        for (const s of stop) s();
        stop = [];
        modus?.aus();
        modus = undefined;
        laufend.value = undefined;
    }

    function starte(gegenstand: string): void {
        beende();
        const karte = seite.karte();
        const bearbeitung = seite.bearbeitung(gegenstand);
        if (karte === undefined || bearbeitung === undefined) return;
        const teil = (): Teil[] => {
            const felder = bearbeitung.stand.value?.felder;
            const detail = bearbeitung.detail.value;
            const x = felder?.x ?? detail?.position[0];
            const y = felder?.y ?? detail?.position[1];
            if (x === undefined || y === undefined || detail === undefined) return [];
            return [
                {
                    objekt: detail.id,
                    name: detail.name,
                    nr: 0,
                    art: "punkt",
                    punkte: [{ x, y }],
                    revision: detail.revision,
                },
            ];
        };
        const neu = installGeometrieModus(karte.map, karte.interaction, {
            // EINE Punkt-Strategie (`punktArt` in `map/geometrie/arten.ts`), ohne Wegnetz.
            art: LANDMARKE,
            teile: teil,
            nachbarn: () => [],
            ziele: () => [],
            orte: () => [],
            fangradius: seite.fangradius,
            handbewegung(aenderung) {
                if (aenderung.art !== "ziehen") return;
                const p = aenderung.teile[0]?.punkte[0];
                if (p === undefined) return;
                bearbeitung.feld((felder) => ({ ...felder, x: p.x, y: p.y }));
                neu?.aktualisiere();
            },
            // Rechtsklick am Anfasser gehört dem Modus (O2), ein Menü gibt es dafür nicht.
            kontext: () => undefined,
            werkzeug: "landschaftseditor",
        });
        if (neu === undefined) return;
        modus = neu;
        laufend.value = gegenstand;
        let warAktiv = bearbeitung.lage.value.aktiv;
        stop = [
            watch(
                () => seite.offen(gegenstand),
                (offen) => {
                    if (!offen) beende();
                },
            ),
            watch(
                () => bearbeitung.stand.value,
                () => modus?.aktualisiere(),
            ),
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
