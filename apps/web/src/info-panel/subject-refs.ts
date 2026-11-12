import {
    AVENTURIA,
    mapPointRef,
    parsePathChain,
    type AreaRef,
    type MapPoint,
    type SearchHit,
    type SubjectRef,
} from "@avesmaps3d/shared";
import type { AreaSelection } from "../map/area-selection";
import { pathSegmentOfKey, selectionFromSearchHit } from "../map/area-selection";
import type { SelectedPlace } from "../map/interaction/owners";
import type { PresentedSelection } from "./presentation";

/**
 * Wie aus dem, was die Karte oder die Suche kennt, ein `SubjectRef` wird (WI-0063 P5). Die Kennung ist immer die der
 * Fachdomäne, nie ein Anzeigename (WI-0063 Abschnitt 7): ein Ort über seine `public_id`, eine Fläche über die der Region, ein
 * Weg oder Fluss über den Kettenschlüssel `name:<Name>`, den Kartenauswahl und Suche schon führen (das alte `Name:Wegtyp` gilt weiter), ein
 * Weg ohne echten Namen über seinen Abschnitt (`#<public_id>` der Kartenauswahl wird zum Anker).
 */

/** Der Ref einer gezeichneten oder gesuchten Fläche, eines Wegs oder eines Gebiets (`AreaSelection`). */
export function subjectRefOfArea(area: AreaSelection): SubjectRef | undefined {
    if (area.kind === "territory") return { kind: "territory", id: area.id };
    if (area.kind === "path") {
        // Ein Weg ohne echten Namen ist sein Abschnitt: Der Server löst ihn zu seinem Artikel oder zu ihm allein auf (`resolvePathGroup`).
        const abschnitt = pathSegmentOfKey(area.id);
        if (abschnitt !== undefined) return { kind: "path", anchor: abschnitt };
        return parsePathChain(area.id) === null ? undefined : { kind: "path", chain: area.id };
    }
    // Die Gruppe nennt die ANDEREN Regionen gleichen Namens; die gewählte ist `id`.
    const others = (area.group ?? []).filter((id) => id !== area.id);
    const ref: AreaRef = { kind: "area", id: area.id, ...(others.length === 0 ? {} : { group: others.slice(0, 63) }) };
    return ref;
}

/** Der Ref eines angeklickten Orts. */
export function subjectRefOfPlace(place: Pick<SelectedPlace, "id">): SubjectRef | undefined {
    return place.id === "" ? undefined : { kind: "place", id: place.id };
}

/** Der Ref eines Treffers der Suche; `undefined`, wo es keinen Subject gibt (freies Label, Klimazone: nur Kontext). */
export function subjectRefOfHit(hit: SearchHit): SubjectRef | undefined {
    switch (hit.kind) {
        case "ort":
            return { kind: "place", id: hit.id };
        case "weg":
            return parsePathChain(hit.id) === null ? undefined : { kind: "path", chain: hit.id };
        case "landschaft": {
            if (hit.region === undefined) return undefined;
            const selection = selectionFromSearchHit(hit);
            return selection === undefined ? undefined : subjectRefOfArea(selection);
        }
        case "klima":
            return undefined;
    }
}

/** Was die Karte an Darstellung aus einem Treffer schon kennt: gewählter Ort oder leuchtende Fläche. */
export function presentationOfHit(hit: SearchHit): PresentedSelection {
    if (hit.kind === "ort") {
        return { place: { id: hit.id, name: hit.name, subtype: hit.subtype ?? "", x: hit.x, y: hit.y } };
    }
    const area = selectionFromSearchHit(hit);
    return area === undefined ? {} : { area };
}

/** Der Ref einer freien Kartenstelle, auf 0,01 gerundet; `undefined` außerhalb der Karte (der Server wiese sie ab). */
export function subjectRefOfPoint(point: MapPoint): SubjectRef | undefined {
    const { bounds } = AVENTURIA.coordinateSpace;
    if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY) {
        return undefined;
    }
    return mapPointRef(point.x, point.y);
}
