import {
    isShownPathName,
    mapPointRef,
    parseLandmarkWaypointId,
    parseMapPointId,
    type PathRef,
    type RouteResponse,
    type RouteStage,
    type RouteStagePoint,
    type SubjectRef,
    type TerritoryRef,
} from "@avesmaps3d/shared";
import { isMessageKey, t, type MessageKey } from "../i18n/i18n";

/**
 * Welche Gegenstände eine Etappe nennt (WI-0087 P1, P2): das Ende der Etappe und der Weg, über den sie läuft.
 *
 * 🔴 **Eine Kennung, nie ein Name.** Der Weg kommt aus dem Abschnitt, der seinen Namen getragen hat
 * (`RouteSegment.public_id` = `path.public_id`), nicht aus einem Namensvergleich gegen den Bestand
 * (`AGENTS.md`: „Die Zuordnung läuft über den Wiki-Key, nie über den Namen"). Der Abschnitt wird genau so gelesen,
 * wie der Server `path_names` gebildet hat (`route-stages.ts`, `isShownPathName`) - deshalb nennt die Zeile denselben
 * Weg, den das Infopanel in seiner Wegeliste nennt.
 *
 * 🪤 **Ein Punkt ohne `place_id` ist kein Ort** (`marker`, `exit`, `join`, `landing`): Er hat keinen Gegenstand, und
 * sein Name ist deshalb gar nicht erst ein Knopf - ein Knopf, der nichts tut, ist schlimmer als kein Knopf.
 */

/**
 * Der Gegenstand hinter einem Ende der Etappe: ein Ort über seine Kennung, ein Kartenpunkt über seine Lage, eine Landmarke der
 * Anfrage (`l:<uuid>`, WI-0271 L6) als Gipfel-Subject über ihre `public_id`; sonst keiner.
 */
export function stagePointRef(point: RouteStagePoint): SubjectRef | undefined {
    const id = point.place_id;
    if (!id) return undefined;
    if (point.point === "place") return { kind: "place", id };
    if (point.point === "point") {
        const landmark = parseLandmarkWaypointId(id);
        if (landmark !== null) return { kind: "peak", id: landmark };
        const at = parseMapPointId(id);
        return at === null ? undefined : mapPointRef(at.x, at.y);
    }
    return undefined;
}

/**
 * Die Ortsklasse eines Wegpunkts in der Sprache der Seite („Dorf"); `undefined`, wo es keine gibt.
 *
 * 🔴 **Kein Rückfall auf „Ort".** Ein Kartenpunkt (`kartenpunkt`) hat keine Klasse, und ein erfundenes Wort unter
 * seinem Namen sagte nichts; dann entfällt der Teil (WI-0087 P3, A8). Eine Landmarke der Anfrage nennt ihre Art (`peak.<art>`,
 * „Höhle“; WI-0271 L6).
 */
export function stageKindLabel(point: RouteStagePoint): string | undefined {
    const subtype = point.subtype ?? "";
    const key = parseLandmarkWaypointId(point.place_id ?? "") === null ? `place.${subtype}` : `peak.${subtype}`;
    return subtype !== "" && isMessageKey(key) ? t(key as MessageKey) : undefined;
}

/** Das unterste Gebiet mit Namen an einem Wegpunkt, als Gegenstand; `undefined`, wo der Punkt keines trägt. */
export function stageTerritory(point: RouteStagePoint): { name: string; ref: TerritoryRef } | undefined {
    const territory = point.territory;
    if (territory === undefined || territory.name === "") return undefined;
    return { name: territory.name, ref: { kind: "territory", id: territory.id } };
}

/**
 * Der Weg, den die Etappenzeile nennt: der ERSTE echte Wegname des Abschnitts (`path_names`), dazu seine Kennung,
 * wenn der Abschnitt sie trägt.
 *
 * 🔴 **Nur ein echter Name gewinnt.** `path_names` enthält ausdrücklich keine erzeugten Namen („Flussweg-12"); eine
 * leere Liste heißt „kein Name", nicht „bau einen" - dann bleibt es bei der Gattung (`typeLabel`).
 *
 * Mehrere Namen in einem Abschnitt: der erste steht in der Zeile, die vollständige Folge steht im Infopanel
 * (WI-0079). Zwei Namen in einer schmalen Zeile lesen sich schlechter als einer.
 */
export function stagePath(stage: RouteStage, route: RouteResponse): { name: string; ref?: PathRef } | undefined {
    const name = stage.path_names[0];
    if (name === undefined || name === "") return undefined;
    const segments = route.segments.slice(stage.segment_start, stage.segment_start + stage.segment_count);
    for (const segment of segments) {
        if (segment.synthetic || segment.public_id === "") continue;
        if (!isShownPathName(segment.path_name, segment.subtype)) continue;
        if (segment.path_name.trim() !== name) continue;
        return { name, ref: { kind: "path", anchor: segment.public_id } };
    }
    // Befund, kein Raten: Der Name steht, der Weg ist nicht zu bestimmen - dann ist er Anzeige und kein Knopf.
    return { name };
}
