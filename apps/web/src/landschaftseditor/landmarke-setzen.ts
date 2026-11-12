import type { Map as MapLibreMap } from "maplibre-gl";
import { shallowRef, type ShallowRef } from "vue";
import type { LandmarkenArt } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { LANDMARKE } from "../map/geometrie/arten";
import type { Teil } from "../map/geometrie/geometrie";
import { installGeometrieModus, type GeometrieModus } from "../map/geometrie/modus";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import type { GipfelDaten } from "./gipfel-daten";
import { landmarkenartName } from "./landschaften-liste";

/**
 * „Hier hinzufügen › ▲ Landmarke setzen › <Art>“ (WI-0271 L4; Kartenmenü A, §9: EIN Eintrag mit den Gipfeln darin; löst „▲ Gipfel setzen …“
 * aus WI-0178 P7 ab). Gespeichert wird erst bei „Fertig“ (EDIT-0003 G4, Vali 2026-10-31):
 *
 * - **Start** an der Stelle des Menüs: ein Punkt der Art auf der Karte, die Leiste des Modus oben („▲ Landmarke setzen · Höhle“, „Fertig“,
 *   „Verwerfen“). Nichts geht an den Server.
 * - **Ziehen** verschiebt den Punkt, mit EINER Punkt-Strategie des Geometrie-Moduls (`LANDMARKE` in `map/geometrie/arten.ts`, dieselbe
 *   wie „Auf der Karte verschieben“ am Gipfel), ohne Einrasten und Mitziehen.
 * - **„Fertig“** legt die Landmarke als EINE Operation an (`peak.create` mit Art und Lage; der Griff „Landmarke-001“ bzw. „Gipfel-001“
 *   kommt vom Server); danach öffnet ihr Fenster mit markiertem Namen. **„Verwerfen“** und Esc lassen nichts zurück.
 * - Ein zweiter Start, solange einer läuft, ersetzt den ersten (die Stelle des neuen Menüs gilt).
 * - **Aus einem Wiki-Kandidaten** (WI-0271 L7, „● Auf der Karte setzen“ an einer ◐-Zeile): derselbe Ablauf, mit der Art des Kandidaten und seinem Namen in der Leiste; „Fertig“ schickt
 *   `wikiKandidat` mit, und die Landmarke heißt wie der Artikel.
 */
export interface LandmarkeSetzenSeite {
    karte(): { map: MapLibreMap; interaction: MapInteractionCoordinator } | undefined;
    readonly daten: Pick<GipfelDaten, "lege">;
    fangradius(): number;
    /** Nach dem Speichern: Karte mit der Revision der Quittung neu. */
    geaendert(revision: number | undefined): void;
    /** Die neue Landmarke: ihr Fenster öffnet, der Name markiert. */
    gesetzt(neu: { readonly publicId: string; readonly name: string }): void;
    melde(text: string, ton: "success" | "warning"): void;
    neueKennung?(): string;
}

export interface LandmarkenEntwurf {
    readonly art: LandmarkenArt;
    readonly x: number;
    readonly y: number;
    readonly sendet: boolean;
    /** Der Wiki-Kandidat, aus dem die Landmarke entsteht (L7): Kennung des Artikels und sein Name. */
    readonly kandidat?: { readonly id: string; readonly name: string };
}

export interface LandmarkeSetzen {
    readonly laufend: Readonly<ShallowRef<LandmarkenEntwurf | undefined>>;
    starte(
        art: LandmarkenArt,
        punkt: { x: number; y: number },
        kandidat?: { readonly id: string; readonly name: string },
    ): void;
    fertig(): Promise<boolean>;
    /** Verwerfen (auch Esc): `true`, wenn etwas lief. */
    verwerfe(): boolean;
    /** Der Titel der Leiste: „Landmarke setzen“ und die Art. */
    titel(): string;
}

/** Die Kennung des Punkts im Modus: Er gehört noch zu keinem Objekt. */
const NEU = "neu";

export function createLandmarkeSetzen(seite: LandmarkeSetzenSeite): LandmarkeSetzen {
    const laufend = shallowRef<LandmarkenEntwurf | undefined>(undefined);
    const neueKennung = seite.neueKennung ?? ((): string => crypto.randomUUID());
    let modus: GeometrieModus | undefined;

    function ende(): void {
        modus?.aus();
        modus = undefined;
        laufend.value = undefined;
    }

    function teile(): Teil[] {
        const e = laufend.value;
        if (e === undefined) return [];
        return [
            {
                objekt: NEU,
                name: landmarkenartName(e.art),
                nr: 0,
                art: "punkt",
                punkte: [{ x: e.x, y: e.y }],
                revision: 0,
            },
        ];
    }

    return {
        laufend,
        starte(art, punkt, kandidat) {
            ende();
            const karte = seite.karte();
            if (karte === undefined) return;
            laufend.value = {
                art,
                x: punkt.x,
                y: punkt.y,
                sendet: false,
                ...(kandidat === undefined ? {} : { kandidat }),
            };
            modus = installGeometrieModus(karte.map, karte.interaction, {
                art: LANDMARKE,
                teile,
                nachbarn: () => [],
                ziele: () => [],
                orte: () => [],
                fangradius: () => seite.fangradius(),
                handbewegung(aenderung) {
                    const p = aenderung.teile[0]?.punkte[0];
                    const jetzt = laufend.value;
                    if (aenderung.art !== "ziehen" || p === undefined || jetzt === undefined) return;
                    laufend.value = { ...jetzt, x: p.x, y: p.y };
                    modus?.aktualisiere();
                },
                // Rechtsklick am Anfasser gehört dem Modus (O2), ein Menü gibt es dafür nicht.
                kontext: () => undefined,
                werkzeug: "landschaftseditor",
            });
            if (modus === undefined) laufend.value = undefined;
        },
        async fertig() {
            const e = laufend.value;
            if (e === undefined || e.sendet) return false;
            laufend.value = { ...e, sendet: true };
            modus?.sperre(true);
            const antwort = await seite.daten.lege({
                operationId: neueKennung(),
                position: [e.x, e.y],
                subtype: e.art,
                ...(e.kandidat === undefined ? {} : { wikiKandidat: e.kandidat.id }),
            });
            if (!antwort.ok) {
                seite.melde(antwort.fehler.message, "warning");
                if (laufend.value !== undefined) laufend.value = { ...laufend.value, sendet: false };
                modus?.sperre(false);
                return false;
            }
            ende();
            seite.geaendert(antwort.quittung.mapRevision);
            seite.gesetzt({ publicId: antwort.quittung.publicId, name: antwort.quittung.name });
            seite.melde(t("landschaftseditor.gipfel.gesetzt", { name: antwort.quittung.name }), "success");
            return true;
        },
        verwerfe() {
            if (laufend.value === undefined) return false;
            ende();
            return true;
        },
        titel: () => t("landschaftseditor.landmarke.setzen"),
    };
}
