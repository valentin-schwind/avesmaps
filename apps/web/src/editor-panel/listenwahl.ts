import type { Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA,
    editorPathGroupKey,
    fromRenderLngLat,
    pathReaderName,
    toRenderLngLat,
    type SubjectRef,
} from "@avesmaps3d/shared";
import type { AreaSelection } from "../map/area-selection";
import { selectionOf } from "../map/area-selection-input";
import { pathSelectionOf } from "../map/path-selection-input";
import { subjectRefOfArea } from "../info-panel/subject-refs";
import type { OpenSubjectOptions } from "../info-panel/subject-selection";
import type { PresentedSelection } from "../info-panel/presentation";

/**
 * Ein Klick in der Liste eines Editors lässt das Objekt auf der Karte aufleuchten wie ein Klick auf das Objekt selbst (WI-0218 Nachbesserung;
 * EDIT-0003 G3, G9; Auftrag der Orchestrierung 2026-10-18 nach dem Befund des Betreibers auf der Stage: „klick auf kraftlinie in der liste
 * lässt sie nicht leuchten (dasselbe problem wie bei vorher bei landschaften). bei wegen geht es auch noch nicht. bei orten und
 * herrschaftsgebieten ist es da.“).
 *
 * 🔴 EIN Weg für jede Liste und keine eigene Leuchtschicht: dieselbe Auswahl, die ein Klick auf der Karte baut (`selectionOf` für Flächen und
 * Gebiete, `pathSelectionOf` für Wege, der Name einer Kraftlinie wie in `openPowerline`), über dieselbe Naht `openSubject`. Mit `still`
 * (das Infopanel bleibt hinten, die Kamera steht) und der Darstellung vorweg: Ohne sie stellte die Antwort eine Fläche auf die Standardkarte
 * (`presentationFromDetail`, für Suche und Links), und die Ansicht der Liste ginge verloren. Die Ortsliste wählt schon so
 * (`ortseditor-steuerung.ts`); für einen Ort leuchtet die Antwort selbst.
 */

const space = AVENTURIA.coordinateSpace;

/** Ein Rahmen in Kartenkoordinaten: [x0, y0, x1, y1]. */
type Rahmen = readonly number[] | undefined;

/** Was eine Liste gewählt hat: die Zeile, so weit die Auswahl der Karte sie braucht. */
export type Listenwahl =
    | {
          readonly art: "landschaft" | "gebiet";
          readonly id: string;
          readonly name: string;
          readonly type?: string | undefined;
          readonly bounds?: Rahmen;
      }
    | {
          readonly art: "weg";
          readonly id: string;
          readonly name: string;
          readonly subtype: string;
          readonly bounds?: Rahmen;
      }
    | { readonly art: "kraftlinie"; readonly id: string; readonly name: string };

/** Die Öffnung der Auswahl: was `openSubject` bekommt. */
export interface ListenOeffnung {
    readonly ref: SubjectRef;
    readonly options: OpenSubjectOptions;
}

/** Die Mitte eines Rahmens in Kartenkoordinaten; ohne Rahmen die Mitte der Karte. */
function mitteVon(map: MapLibreMap, bounds: Rahmen): { x: number; y: number } {
    const [x0, y0, x1, y1] = bounds ?? [];
    return x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined
        ? fromRenderLngLat(space, map.getCenter())
        : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Die Öffnung, mit der die Liste ihre Wahl auf der Karte zeigt; `undefined`, wo es keinen Gegenstand gibt. */
export function listenOeffnung(map: MapLibreMap, wahl: Listenwahl): ListenOeffnung | undefined {
    const still = (presentation: PresentedSelection, title: string): OpenSubjectOptions => ({
        source: "link",
        camera: "none",
        still: true,
        known: { ...(title === "" ? {} : { title }), presentation },
    });
    if (wahl.art === "kraftlinie") {
        // Wie `openPowerline`: Eine namenlose Linie ist nur sie selbst, die Karte kennt eine Gruppe am Namen und hätte keine zu leuchten.
        return {
            ref: { kind: "powerline", anchor: wahl.id },
            options: still(wahl.name === "" ? {} : { powerline: { name: wahl.name } }, wahl.name),
        };
    }
    let area: AreaSelection;
    if (wahl.art === "weg") {
        const near = toRenderLngLat(space, mitteVon(map, wahl.bounds));
        // Der Schlüssel der Zeile: die Kette ihres Namens, ohne echten Namen ihr Abschnitt (wie der Klick auf der Karte, `pathCandidates`).
        const id = editorPathGroupKey({ publicId: wahl.id, name: wahl.name, subtype: wahl.subtype });
        area = pathSelectionOf({ kind: "path", id, name: wahl.name, type: wahl.subtype, area: 0 }, near);
    } else {
        const kind = wahl.art === "landschaft" ? "landscape" : "territory";
        area = selectionOf(
            map,
            { kind, id: wahl.id, name: wahl.name, type: wahl.type ?? "", area: 0 },
            mitteVon(map, wahl.bounds),
        );
    }
    const ref = subjectRefOfArea(area);
    // Ein Weg heißt, wie ein Leser ihn sieht (`pathReaderName`, wie beim Klick auf der Karte): Ein Griff wie „Pfad-3443“ ist kein Titel.
    const title = wahl.art === "weg" ? (pathReaderName(wahl.name, wahl.subtype) ?? "") : wahl.name;
    return ref === undefined ? undefined : { ref, options: still({ area }, title) };
}
