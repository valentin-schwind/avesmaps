import { ENTWICKLER_VERTRAG_FASSUNG, type EntwicklerRoute, type RouteResponse } from "@avesmaps3d/shared";

/**
 * Die Sicht der Entwickler-API auf eine Route (WI-0303 P7): wenige Felder mit festen Namen statt der Antwort des Planers, die mit der
 * Oberfläche wächst. Strecken in Meilen, Zeiten in Stunden, beide auf zwei Stellen gerundet.
 */

const GRUENDE: Readonly<Record<NonNullable<RouteResponse["reason"]>, NonNullable<EntwicklerRoute["grund"]>>> = {
    network_disconnected: "kein_zusammenhang",
    season_closed: "gesperrt",
};

const HINWEISE: Readonly<Record<RouteResponse["warnings"][number], string>> = {
    cross_country: "querfeldein",
    free_sea_unavailable: "keine_freie_see",
};

const rund = (wert: number): number => Math.round(wert * 100) / 100;

export function entwicklerRoute(route: RouteResponse): EntwicklerRoute {
    const meilen = (einheiten: number): number => rund(einheiten * route.miles_per_unit);
    const linie: [number, number][] = [];
    for (const segment of route.segments) {
        for (const [x, y] of segment.geometry.coordinates) {
            const letzter = linie.at(-1);
            // Der Anfang eines Abschnitts ist das Ende des vorigen: nur einmal.
            if (letzter?.[0] === x && letzter[1] === y) continue;
            linie.push([x, y]);
        }
    }
    return {
        vertrag: ENTWICKLER_VERTRAG_FASSUNG,
        gefunden: route.found,
        ...(route.reason ? { grund: GRUENDE[route.reason] } : {}),
        orte: route.waypoints.map((ort) => ({ id: ort.id, name: ort.name })),
        meilen: meilen(route.distance_units),
        reisestunden: rund(route.travel_hours),
        raststunden: rund(route.rest_hours),
        gesamtstunden: rund(route.total_hours),
        reisetage: rund(route.travel_days),
        stundenProTag: route.hours_per_day,
        etappen: route.stages.map((etappe) => ({
            art: etappe.type,
            mittel: etappe.transport,
            wege: etappe.path_names,
            von: { x: etappe.from.x, y: etappe.from.y },
            nach: { x: etappe.to.x, y: etappe.to.y },
            meilen: meilen(etappe.distance_units),
            reisestunden: rund(etappe.travel_hours),
            raststunden: rund(etappe.rest_hours),
        })),
        linie,
        hinweise: route.warnings.map((hinweis) => HINWEISE[hinweis]),
    };
}
