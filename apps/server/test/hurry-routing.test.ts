import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, isHurryDay, ROUTE_DEFAULTS, routeHurry, stageHurry } from "@avesmaps3d/shared";
import { prepareGround } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { NO_OFFROAD_TERRAIN } from "../src/routing/route-edge.ts";

/**
 * Eiltempo (WI-0078): Es wirkt NACH der Wegsuche, allein auf die Zeit.
 *
 * 🔴 **Die harte Invariante:** Für dieselben Wegpunkte und dieselben übrigen Optionen ist die Kantenfolge mit und
 * ohne Eiltempo bitgleich identisch - unter „Schnellste Route“ wie unter „Kürzeste Strecke“. Was sich ändert, ist
 * die Zeit geeigneter Abschnitte, nichts sonst.
 *
 * Die Regeln selbst stehen im Reisemodell (`eiltempo`), nicht im Router: welches Mittel auf welcher Wegart eilt,
 * welcher Boden und welche Landschaft es vereiteln, und dass nur jeder zweite Reisetag eilt.
 *
 * 🔴 **Die Taktung rechnet AM REISETAG** (Betreiber 2026-10-05: „das was in der GA steht“): Am Eiltag gilt der VOLLE
 * Faktor, am gewöhnlichen Tag keiner. Die kurzen Strecken dieser Datei bleiben unter einem Reisetag und tragen
 * deshalb 1,5 beziehungsweise 1,25; die Taktung selbst steht weiter unten an einer langen Reise.
 */

const model = AVENTURIA_TRAVEL_MODEL;
/** Der volle Faktor der Geographia - an einem Eiltag, und der erste Reisetag ist einer. */
const FOOT = 1.5;
const CART = 1.25;
/** Eiltempo an: der Router braucht dazu den Reisetag des Planers, denn die Taktung rechnet am Reisetag. */
const EIL = { hoursPerDay: ROUTE_DEFAULTS.hours_per_day };

const ort = (id: string, x: number, y: number, extra: Partial<RouteNode> = {}): RouteNode => ({
    id,
    name: id,
    kind: "place",
    isHidden: false,
    x,
    y,
    ...extra,
});

const weg = (id: string, subtype: string, coordinates: [number, number][]) => ({
    public_id: id,
    name: id,
    subtype,
    coordinates: JSON.stringify({ type: "LineString", coordinates }),
    allowed_transports: null,
    transport_domain: null,
    flow_direction: null,
    flow_factor: null,
});

const request = (over: Partial<RouteRequest> = {}): RouteRequest => ({
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
    ...over,
});

/** Eine Fläche einer Landschaftsart, als bremsender Boden geladen (`loadGround` liefert genau diese Form). */
const flaeche = (type: string, minX: number, minY: number, maxX: number, maxY: number) =>
    prepareGround([
        {
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [minX, minY],
                        [maxX, minY],
                        [maxX, maxY],
                        [minX, maxY],
                        [minX, minY],
                    ],
                ],
            },
            minX,
            minY,
            maxX,
            maxY,
            factor: 7.5,
            type,
        },
    ]);

/** Ein gerader Weg von A nach B der gegebenen Wegart. */
function strecke(subtype: string, laenge = 10) {
    const network = buildRouteNetwork(
        [ort("A", 100, 100), ort("B", 100 + laenge, 100)],
        [
            weg("w", subtype, [
                [100, 100],
                [100 + laenge, 100],
            ]),
        ],
    );
    return network;
}

function fahre(
    subtype: string,
    hurry: boolean,
    over: Partial<RouteRequest> = {},
    terrain = NO_OFFROAD_TERRAIN,
    laenge = 10,
) {
    const network = strecke(subtype, laenge);
    const options = request(over);
    return findRoute(network, buildRouteGraph(network, model, options), ["A", "B"], terrain, null, hurry ? EIL : null);
}

describe("Eiltempo ändert die Zeit, nie die Route", () => {
    it("🔴 die Kantenfolge ist mit und ohne Eiltempo bitgleich - schnellste wie kürzeste", () => {
        // Ein Netz mit zwei Wegen zwischen denselben Orten: einer schnell und lang, einer langsam und kurz.
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("M", 105, 102), ort("B", 110, 100)],
            [
                weg("schnell", "Reichsstrasse", [
                    [100, 100],
                    [105, 102],
                    [110, 100],
                ]),
                weg("kurz", "Pfad", [
                    [100, 100],
                    [110, 100],
                ]),
            ],
        );
        for (const optimize of ["fastest", "shortest"] as const) {
            const options = request({ optimize });
            const graph = buildRouteGraph(network, model, options);
            const normal = findRoute(network, graph, ["A", "B"], NO_OFFROAD_TERRAIN, null, null);
            const eilig = findRoute(network, graph, ["A", "B"], NO_OFFROAD_TERRAIN, null, EIL);
            expect(eilig.segments.map((segment) => segment.edge_id)).toEqual(
                normal.segments.map((segment) => segment.edge_id),
            );
            expect(eilig.segments.map((segment) => JSON.stringify(segment.geometry))).toEqual(
                normal.segments.map((segment) => JSON.stringify(segment.geometry)),
            );
            expect(eilig.distanceUnits).toBe(normal.distanceUnits);
            // Die Suche hat dieselben Kosten bezahlt: Eiltempo wiegt keine Kante.
            expect(eilig.segments.map((segment) => segment.cost_units)).toEqual(
                normal.segments.map((segment) => segment.cost_units),
            );
        }
    });

    it("ohne Haken bleibt alles, wie es war - kein Feld, keine andere Zahl", () => {
        const normal = fahre("Strasse", false);
        expect(normal.segments[0]?.hurry_factor).toBeUndefined();
        expect(fahre("Strasse", true).travelHours).toBeLessThan(normal.travelHours);
    });
});

describe("wo das Eiltempo greift - und wo nicht", () => {
    const stunden = (subtype: string, hurry: boolean, over: Partial<RouteRequest> = {}): number =>
        fahre(subtype, hurry, over).travelHours;

    it("zu Fuß auf Reichsstraße, Straße und Weg - und auf Pfaden, die nur Wanderer eilen", () => {
        // 🪤 Vier Einheiten, damit auch der langsame Wüstenpfad in den ERSTEN Reisetag passt: Sonst teilt die
        // Taktung den Abschnitt an der Tagesgrenze, und der Faktor ist zu Recht kleiner als der volle.
        const kurz = (subtype: string, hurry: boolean): number =>
            fahre(subtype, hurry, {}, NO_OFFROAD_TERRAIN, 4).travelHours;
        for (const subtype of ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Wuestenpfad"]) {
            expect(kurz(subtype, false) / 8, subtype).toBeLessThan(1);
            expect(kurz(subtype, true), subtype).toBeCloseTo(kurz(subtype, false) / FOOT, 10);
        }
    });

    it("🔴 Gebirgspass und Querfeldein nie (GA S. 123: in Gebirgen unmöglich, nur befestigte Wege)", () => {
        for (const subtype of ["Gebirgspass"]) {
            expect(stunden(subtype, true), subtype).toBeCloseTo(stunden(subtype, false), 10);
        }
    });

    it("ein Fuhrwerk eilt mit 1,25 und nur auf den Wegarten, die es fährt", () => {
        const wagen = { transports: { land: "wagon", river: "riverSailer", sea: "cargoShip" } };
        expect(stunden("Strasse", true, wagen)).toBeCloseTo(stunden("Strasse", false, wagen) / CART, 10);
        // Der Pfad steht für das Fuhrwerk in keiner Eilliste - und es fährt ihn ohnehin nicht (`nieAngeboten`).
        const kutsche = { transports: { land: "horseCarriage", river: "riverSailer", sea: "cargoShip" } };
        expect(stunden("Pfad", true, kutsche)).toBeCloseTo(stunden("Pfad", false, kutsche), 10);
    });

    it("die Kamelkarawane hat keine Eilregel, Fluss und Meer auch nicht", () => {
        const karawane = { transports: { land: "caravan", river: "riverSailer", sea: "cargoShip" } };
        expect(stunden("Strasse", true, karawane)).toBeCloseTo(stunden("Strasse", false, karawane), 10);
        expect(stunden("Flussweg", true)).toBeCloseTo(stunden("Flussweg", false), 10);
        expect(stunden("Seeweg", true)).toBeCloseTo(stunden("Seeweg", false), 10);
    });

    it("🔴 Sumpf, Dschungel, Urwald und Regenwald schließen es aus, auch auf der besten Straße", () => {
        for (const art of ["suempfe_moore", "dschungel", "urwald", "regenwald"]) {
            const terrain = { ...NO_OFFROAD_TERRAIN, ground: flaeche(art, 100, 99, 120, 101) };
            const im = findRoute(
                strecke("Reichsstrasse"),
                buildRouteGraph(strecke("Reichsstrasse"), model, request()),
                ["A", "B"],
                terrain,
                null,
                EIL,
            );
            expect(im.segments[0]?.hurry_factor, art).toBeUndefined();
        }
        // Dieselbe Fläche als Wald bremst querfeldein, verbietet aber kein Eiltempo.
        const wald = { ...NO_OFFROAD_TERRAIN, ground: flaeche("wald", 100, 99, 120, 101) };
        const network = strecke("Reichsstrasse");
        const durchWald = findRoute(network, buildRouteGraph(network, model, request()), ["A", "B"], wald, null, EIL);
        expect(durchWald.segments[0]?.hurry_factor).toBeCloseTo(FOOT, 10);
    });
});

describe("die Taktung: nur jeder zweite Reisetag (Betreiber 2026-10-05, F3 = A)", () => {
    /** Eine Kette gleich langer Straßenstücke: genug Reisetage, dass die Taktung mehrmals umschlägt. */
    function kette(stuecke: number, laenge = 10) {
        const nodes = Array.from({ length: stuecke + 1 }, (_, i) => ort(`N${String(i)}`, 100 + i * laenge, 100));
        const paths = Array.from({ length: stuecke }, (_, i) =>
            weg(`w${String(i)}`, "Strasse", [
                [100 + i * laenge, 100],
                [100 + (i + 1) * laenge, 100],
            ]),
        );
        const network = buildRouteNetwork(nodes, paths);
        const stations = ["N0", `N${String(stuecke)}`];
        return {
            normal: findRoute(network, buildRouteGraph(network, model, request()), stations, NO_OFFROAD_TERRAIN),
            eilig: findRoute(
                network,
                buildRouteGraph(network, model, request()),
                stations,
                NO_OFFROAD_TERRAIN,
                null,
                EIL,
            ),
        };
    }

    it("🔴 eine Reise, die an EINEM Reisetag endet, bekommt den vollen Faktor 1,5", () => {
        // 9 Einheiten = 27 Meilen: 30 Meilen wären zu Fuß genau ein Reisetag (Wege des Entdeckers).
        const kurz = fahre("Strasse", true, {}, NO_OFFROAD_TERRAIN, 9);
        const roh = fahre("Strasse", false, {}, NO_OFFROAD_TERRAIN, 9);
        expect(roh.travelDays).toBeLessThan(1);
        expect(kurz.segments[0]?.hurry_factor).toBeCloseTo(1.5, 10);
        expect(kurz.travelHours).toBeCloseTo(roh.travelHours / 1.5, 10);
    });

    it("🔴 der erste Reisetag eilt voll, ein ganz gewöhnlicher Tag gar nicht", () => {
        // Kurze Stücke: mehrere liegen ganz in einem Reisetag, also kommen beide Fälle rein vor.
        const { eilig } = kette(24, 3);
        const faktoren = eilig.segments.map((segment) => segment.hurry_factor);
        expect(faktoren[0]).toBeCloseTo(1.5, 10);
        // Abschnitte ganz in einem Eiltag tragen den VOLLEN Faktor, nicht einen gemittelten.
        expect(
            faktoren.filter((factor) => factor !== undefined && Math.abs(factor - 1.5) < 1e-9).length,
        ).toBeGreaterThan(1);
        // Abschnitte ganz in einem gewöhnlichen Tag tragen gar keinen - das Feld fehlt.
        expect(faktoren.some((factor) => factor === undefined)).toBe(true);
        // ... und einen über der Tagesgrenze geteilten: zwischen 1 und dem vollen Faktor.
        expect(faktoren.some((factor) => factor !== undefined && factor > 1 && factor < 1.49)).toBe(true);
        // Kein Abschnitt trägt mehr als den Faktor der Geographia.
        for (const factor of faktoren) if (factor !== undefined) expect(factor).toBeLessThanOrEqual(1.5 + 1e-9);
    });

    it("🔴 über eine lange Reise bleibt der halbe Reisetag im Eiltempo - wirksam rund 1,25", () => {
        const { normal, eilig } = kette(40);
        expect(normal.travelDays).toBeGreaterThan(10);
        const wirksam = normal.travelHours / eilig.travelHours;
        // Die Hälfte der wirklichen Tage eilt mit 1,5: 1,5 · ½ + 1 · ½ = 1,25 normale Stunden je wirklicher.
        expect(wirksam).toBeGreaterThan(1.2);
        expect(wirksam).toBeLessThan(1.3);
        expect(eilig.travelHours).toBeLessThan(normal.travelHours);
    });

    it("🪤 ein Abschnitt, der nicht eilen darf, kostet Reisetage wie jeder andere", () => {
        // Ein Gebirgspass von einem ganzen Reisetag verbraucht den ersten Eiltag; die Straße danach eilt nicht.
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("M", 105, 100), ort("B", 115, 100)],
            [
                weg("pass", "Gebirgspass", [
                    [100, 100],
                    [105, 100],
                ]),
                weg("strasse", "Strasse", [
                    [105, 100],
                    [115, 100],
                ]),
            ],
        );
        const route = findRoute(
            network,
            buildRouteGraph(network, model, request()),
            ["A", "B"],
            NO_OFFROAD_TERRAIN,
            null,
            EIL,
        );
        const pass = route.segments[0];
        const strasse = route.segments[1];
        // Der Pass dauert mehr als einen Reisetag an Land und eilt selbst nie.
        expect(pass?.hurry_factor).toBeUndefined();
        expect((pass?.travel_hours ?? 0) / EIL.hoursPerDay).toBeGreaterThan(1);
        // Also beginnt die Straße erst am zweiten Reisetag, und der eilt nicht: Wäre der Zähler beim Pass stehen
        // geblieben, stünde hier der volle Faktor 1,5. Ihr kleiner Rest kommt vom Hineinreichen in den dritten Tag.
        expect(strasse?.hurry_factor ?? 1).toBeLessThan(1.2);
        // Dieselbe Straße als ZWEITES Stück einer Straßenkette beginnt noch im ersten Eiltag und eilt deutlich mehr.
        const ohnePass = kette(2).eilig.segments[1]?.hurry_factor ?? 1;
        expect(ohnePass).toBeGreaterThan(strasse?.hurry_factor ?? 1);
    });

    it("🪤 der Zähler läuft über die Mediengrenze weiter - eine Flussfahrt kostet Reisetage", () => {
        // Zwei kurze Straßenstücke; dazwischen einmal nichts, einmal eine Flussfahrt von mehr als einem Wassertag.
        const bauen = (fluss: number) => {
            const mitte = 100 + 3;
            const nodes = [
                ort("A", 100, 100),
                ort("M", mitte, 100),
                ort("K", mitte + fluss, 100),
                ort("B", mitte + fluss + 3, 100),
            ];
            const paths = [
                weg("s1", "Strasse", [
                    [100, 100],
                    [mitte, 100],
                ]),
                weg("f", "Flussweg", [
                    [mitte, 100],
                    [mitte + fluss, 100],
                ]),
                weg("s2", "Strasse", [
                    [mitte + fluss, 100],
                    [mitte + fluss + 3, 100],
                ]),
            ];
            const network = buildRouteNetwork(nodes, paths);
            return findRoute(
                network,
                buildRouteGraph(network, model, request()),
                ["A", "B"],
                NO_OFFROAD_TERRAIN,
                null,
                EIL,
            );
        };
        const kurz = bauen(1);
        const lang = bauen(30);
        // Die Flussfahrt selbst eilt nie (die Geographia kennt keinen allgemeinen Eilfaktor für Flussmittel).
        expect(kurz.segments[1]?.hurry_factor).toBeUndefined();
        expect(lang.segments[1]?.hurry_factor).toBeUndefined();
        // Hinter der kurzen Fahrt liegt die zweite Straße noch im ersten Eiltag und eilt voll ...
        expect(kurz.segments[2]?.hurry_factor).toBeCloseTo(1.5, 10);
        // ... hinter der langen nicht mehr: Die Fahrt hat Reisetage verbraucht.
        expect(lang.segments[2]?.hurry_factor ?? 1).toBeLessThan(1.5);
    });

    it("die Taktung kommt aus dem Reisemodell, nicht aus einer Zahl im Code", () => {
        expect(model.eiltempo.wert.taktung).toEqual({ reisetage: 2, eiltage: 1 });
        expect(isHurryDay(model, 0)).toBe(true);
        expect(isHurryDay(model, 1)).toBe(false);
    });

    it("🔴 keine Reise wird im Eiltempo länger - Abschnitt für Abschnitt", () => {
        for (const stuecke of [1, 2, 3, 5, 8, 13, 21]) {
            const { normal, eilig } = kette(stuecke);
            expect(eilig.travelHours, `${String(stuecke)} Stücke`).toBeLessThanOrEqual(normal.travelHours + 1e-9);
            eilig.segments.forEach((segment, index) => {
                const roh = normal.segments[index]?.travel_hours ?? 0;
                expect(segment.travel_hours).toBeLessThanOrEqual(roh + 1e-9);
                expect(segment.travel_hours).toBeGreaterThanOrEqual(roh / 1.5 - 1e-9);
            });
        }
    });
});

describe("die Summen bleiben in sich stimmig", () => {
    it("Abschnitte, Teilstrecken und die Reise nennen dieselbe Zeit", () => {
        const network = buildRouteNetwork(
            [ort("A", 100, 100), ort("M", 110, 100), ort("B", 120, 100)],
            [
                weg("w1", "Strasse", [
                    [100, 100],
                    [110, 100],
                ]),
                weg("w2", "Gebirgspass", [
                    [110, 100],
                    [120, 100],
                ]),
            ],
        );
        const route = findRoute(
            network,
            buildRouteGraph(network, model, request()),
            ["A", "M", "B"],
            NO_OFFROAD_TERRAIN,
            null,
            EIL,
        );
        const abschnitte = route.segments.reduce((sum, segment) => sum + segment.travel_hours, 0);
        expect(route.travelHours).toBeCloseTo(abschnitte, 10);
        expect(route.legs.reduce((sum, leg) => sum + leg.travelHours, 0)).toBeCloseTo(abschnitte, 10);
        // Gemischt: die Straße eilt, der Gebirgspass nicht.
        expect(route.segments.map((segment) => segment.hurry_factor !== undefined)).toEqual([true, false]);
    });

    it("was das Eiltempo gebracht hat, rechnet sich aus den Abschnitten (`stageHurry`, `routeHurry`)", () => {
        const route = fahre("Strasse", true);
        const segment = route.segments[0];
        const hurry = stageHurry(model, route.segments);
        expect(hurry?.distance_units).toBeCloseTo(segment?.distance_units ?? 0, 10);
        expect(hurry?.saved_hours).toBeCloseTo((segment?.travel_hours ?? 0) * (FOOT - 1), 10);
        // Der Abschnitt liegt ganz im ersten Eiltag: Dann sind seine Stunden ALLE Eilstunden.
        expect(hurry?.hurried_hours).toBeCloseTo(segment?.travel_hours ?? 0, 10);
        expect(routeHurry([])).toBeUndefined();
        expect(stageHurry(model, fahre("Gebirgspass", true).segments)).toBeUndefined();
    });
});
