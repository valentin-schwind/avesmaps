import { Value } from "@sinclair/typebox/value";
import { MapSeriesCatalog, type MapSeries } from "./map-series.ts";
import type { MapView } from "./map-views.ts";
import type { ViewerCapability, ViewerContext } from "./viewer.ts";
import aventuriaSeries from "../../../config/map-series/aventuria.json" with { type: "json" };

function parseCatalog(candidate: unknown, fileName: string): MapSeriesCatalog {
    if (!Value.Check(MapSeriesCatalog, candidate)) {
        const [firstError] = [...Value.Errors(MapSeriesCatalog, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid map series catalog in ${fileName} (${detail})`);
    }
    return candidate;
}

export const AVENTURIA_SERIES: MapSeriesCatalog = parseCatalog(aventuriaSeries, "aventuria.json");

/**
 * The series this viewer may choose.
 *
 * One place decides it, because the interface has more than one list: the switcher and the legal
 * notes. Filtering them separately is how they drift apart - and a source credited for an image
 * nobody can select is worse than no entry at all.
 *
 * Takes a `ViewerContext` (or anything shaped like one, so a call site does not need the whole
 * bootstrap machinery for a one-off check) instead of a bare boolean (M9, hardening review
 * 2026-09-28): the question this asks is specifically `view_editor_series`, and staying explicit
 * about WHICH capability is being checked is why the parameter changed at all, not just its type.
 *
 * There is no role model yet (AGENTS.md). Until there is, `view_editor_series` is granted to every
 * viewer on an instance that is reachable only with a password - everyone who got in is an editor -
 * and withheld everywhere else. Once accounts exist, the capability replaces that judgement and
 * nothing else here changes.
 *
 * `catalog` ist seit WI-0220 der wirksame Katalog zur Laufzeit (`GET /api/map-series`, im Browser `map/kartenserien-stand.ts`);
 * ohne Angabe die Vorgabe aus der JSON.
 */
export function getVisibleMapSeries(
    viewer: Pick<ViewerContext, "can">,
    catalog: MapSeriesCatalog = AVENTURIA_SERIES,
): MapSeries[] {
    if (viewer.can("view_editor_series" satisfies ViewerCapability)) {
        return [...catalog.series];
    }
    return catalog.series.filter((series) => series.visibility !== "EDITOR_ONLY");
}

/**
 * Zeigt die Karte diesem Betrachter die Serie nur unter „Nur Karte“? Ja für eine Serie mit Beschriftung im Bild, außer für Editoren
 * (Betreiber 2026-11-10: „unter dem Reiter "Nur Karte" die Karte "Old" auch für Frontendnutzer freischalten“). „Nur Karte“ zeichnet keine
 * eigenen Namen, dort steht keiner doppelt. In allen anderen Ansichten stünde jeder Name doppelt (`docs/regeln/oberflaeche.md`,
 * „Kartenserie `old`“). Editoren sehen sie überall; dort schaltet die Karte unsere Namen ab (`labels: !labelsInImage`).
 */
export function nurUnterNurKarte(
    viewer: Pick<ViewerContext, "can">,
    series: Pick<MapSeries, "labelsInImage">,
): boolean {
    return series.labelsInImage && !viewer.can("view_editor_series" satisfies ViewerCapability);
}

/** Die Ansicht, in der eine Serie mit Beschriftung im Bild auch Besuchern offensteht (`nurUnterNurKarte`). */
export const ANSICHT_FUER_BILDNAMEN: MapView = "none";

export function getMapSeries(seriesId: string): MapSeries {
    const series = AVENTURIA_SERIES.series.find((candidate) => candidate.id === seriesId);
    if (!series) {
        throw new Error(`unknown map series: ${seriesId}`);
    }
    return series;
}

export function getDefaultMapSeries(): MapSeries {
    return getMapSeries(AVENTURIA_SERIES.defaultSeries);
}
