import { describe, expect, it } from "vitest";
import { settleChecks } from "../src/blocking-checks.ts";
import {
    legacyPathUrl,
    legacySpotUrl,
    looseEndpointCheck,
    measureLooseEndpoints,
    LOOSE_DISTANCE,
    type RetiredNode,
} from "../src/routing/loose-endpoints.ts";
import { ENDPOINT_BOX, type PathRow, type RouteNode } from "../src/routing/network.ts";

/**
 * Lose Wegenden (WI-0092, Befund `route-gareth-alfenmohn-haken-2026-10-06.md`), seit WI-0132 Release N auf der Topologie
 * ohne Kreuzungen: Knoten sind Orte und technische Knoten genau auf den Wegenden.
 *
 * Die Fälle sind benannt, nicht erfunden: Jeder ist eine Stelle, die der Befund beschreibt, auf das
 * Nötigste eingedampft. Gerechnet wird ohne Datenbank — die Messung ist eine reine Funktion über
 * Orte und Wege, und genau das macht sie prüfbar.
 */

const place = (id: string, name: string, x: number, y: number): RouteNode => ({
    id,
    name,
    kind: "place",
    isHidden: false,
    subtype: "dorf",
    x,
    y,
});

const path = (id: string, name: string, points: [number, number][]): PathRow => ({
    public_id: id,
    name,
    subtype: "Strasse",
    coordinates: JSON.stringify({ type: "LineString", coordinates: points }),
    allowed_transports: null,
    transport_domain: null,
    flow_direction: null,
    flow_factor: null,
});

const retired = (id: string, name: string, x: number, y: number): RetiredNode => ({
    publicId: id,
    name,
    subtype: "gebaeude",
    x,
    y,
    retiredOn: "2026-09-29",
});

describe("lose Wegenden messen", () => {
    it("🔴 Fall 1 — ein Wegende an einem stillgelegten Ort wird Rang 1, mit dem gelöschten Ort beim Namen", () => {
        // Der Fall aus dem Befund, eingedampft: Die Wege enden bei (10|10), dort stand „Villa“. Sie treffen sich nicht genau
        // (sonst wären sie ein Treffpunkt, Entscheidung B). Ohne Villa greift sich jedes Ende den 0,3 entfernten Rasthof.
        const nodes = [
            place("start", "Start", 8, 10),
            place("rasthof", "Rasthof", 10.3, 10),
            place("ziel", "Ziel", 13, 10),
        ];
        const paths = [
            path("weg-a", "Gareth-St. Lechmin", [
                [8, 10],
                [10, 10],
            ]),
            path("weg-b", "Heeresrast", [
                [10.002, 10],
                [13, 10],
            ]),
        ];
        const report = measureLooseEndpoints(nodes, paths, [retired("villa", "Villa Phexensglück", 10.01, 10)]);

        expect(report.endpointsTotal, "zwei Kanten, also vier Kantenenden").toBe(4);
        expect(report.loose).toHaveLength(2);
        expect(report.retiredSpots).toHaveLength(1);
        const spot = report.retiredSpots[0];
        expect(spot?.retired?.name).toBe("Villa Phexensglück");
        expect(spot?.retired?.retiredOn).toBe("2026-09-29");
        expect(spot?.ends.map((end) => end.pathPublicId).sort()).toEqual(["weg-a", "weg-b"]);
        // 🔴 Der Punkt der Stelle ist der TREFFPUNKT der Wege, nicht die Stelle des gelöschten Ortes:
        // Dorthin gehört die Reparatur, und dort liegen die Enden schon.
        expect(spot?.x).toBe(10);
        expect(spot?.y).toBe(10);
        expect(spot?.ends[0]?.distance).toBeCloseTo(0.3, 10);
        expect(spot?.ends[0]?.nodeId, "sie hängen heute am Rasthof im Kasten").toBe("rasthof");
        expect(report.otherSpots, "kein loser Stoß ohne gelöschten Ort").toHaveLength(0);
        expect(report.absorbed).toBe(0);
    });

    it("🔴 Entscheidung B: Wegenden, die sich genau treffen und nur wegen „Ort zuerst“ zum Ort springen, nur als Zahl", () => {
        // Koordination 2026-10-10 (WI-0132 §10.6): ein Treffpunkt, den der Ortskasten aufnimmt. Verbunden, keine Stelle.
        const nodes = [
            place("start", "Start", 8, 10),
            place("rasthof", "Rasthof", 10.3, 10),
            place("ziel", "Ziel", 13, 10),
        ];
        const ende = measureLooseEndpoints(
            nodes,
            [
                path("weg-a", "Weg", [
                    [8, 10],
                    [10, 10],
                ]),
                path("weg-b", "Weg", [
                    [10, 10],
                    [13, 10],
                ]),
            ],
            [],
        );
        expect(ende.loose, "Ende trifft Ende: keine Stelle").toHaveLength(0);
        expect(ende.absorbed).toBe(2);
        // Dasselbe für ein Ende genau auf einem Weg (T-Stoß im Ortskasten), auch auf einem Segment ohne Stützpunkt.
        const stoss = measureLooseEndpoints(
            nodes,
            [
                // 0,4 neben dem Rasthof: im Kasten (unter 0,5), also hängt der Stich am Ort, liegt aber genau auf „durch“.
                path("durch", "Weg", [
                    [9.9, 9],
                    [9.9, 11],
                ]),
                path("stich", "Weg", [
                    [9.9, 10],
                    [13, 10],
                ]),
            ],
            [],
        );
        expect(stoss.loose).toHaveLength(0);
        expect(stoss.absorbed).toBe(1);
        expect(looseEndpointCheck(stoss).passed, "nichts für die Redaktion").toBe(true);
        expect(looseEndpointCheck(stoss).detail).toContain("Nur gezählt: 1 Treffpunkte im Ortskasten");
    });

    it("🔴 Fall 2 — ein Weg mit beiden Enden am selben Ort fällt ganz aus dem Netz und zählt NICHT als Kantenende", () => {
        // Der kurze Verbindungsweg aus dem Befund: ohne den gelöschten Ort hängen beide Enden an
        // demselben Ort im Kasten, und das Netz erzeugt für ihn keine einzige Kante.
        const nodes = [place("rasthof", "Rasthof", 10.3, 10), place("ziel", "Ziel", 13, 10)];
        const paths = [
            path("verbinder", "Heeresrast-Fehring-Ginsterfeld", [
                [10, 10],
                [10.3, 10],
            ]),
            path("weg-b", "Heeresrast", [
                [10.3, 10],
                [13, 10],
            ]),
        ];
        const report = measureLooseEndpoints(nodes, paths, [retired("villa", "Villa Phexensglück", 10.01, 10)]);

        expect(report.endpointsTotal, "nur der zweite Weg trägt eine Kante").toBe(2);
        expect(report.loose, "die Enden des gefallenen Weges stehen in keiner Kante").toHaveLength(0);
        expect(report.detached).toHaveLength(1);
        expect(report.detached[0]).toMatchObject({
            pathPublicId: "verbinder",
            reason: "beide_enden_am_selben_knoten",
            nodeId: "rasthof",
            nodeName: "Rasthof",
        });
        expect(report.detached[0]?.retired?.name, "die Brücke zu Rang 1 steht an der Zeile").toBe("Villa Phexensglück");
    });

    it("🔴 Fall 3 — Wege, die sich genau treffen, liefern keinen einzigen Befund (technischer Knoten statt Kreuzung)", () => {
        const nodes = [place("start", "Start", 8, 10), place("ziel", "Ziel", 13, 10)];
        const paths = [
            path("weg-a", "Reichsstraße 3", [
                [8, 10],
                [10, 10],
            ]),
            path("weg-b", "Reichsstraße 3", [
                [10, 10],
                [13, 10],
            ]),
        ];
        const report = measureLooseEndpoints(nodes, paths, []);

        expect(report.endpointsTotal).toBe(4);
        expect(report.loose).toHaveLength(0);
        expect(report.detached).toHaveLength(0);
        expect(report.retiredSpots).toHaveLength(0);
        expect(report.otherSpots).toHaveLength(0);
        expect(report.deadEnds).toBe(0);
        expect(looseEndpointCheck(report).passed, "ohne Befund ist die Prüfung bestanden").toBe(true);
    });

    it("🪤 ein Ende knapp neben seinem Ort ist KEIN Befund — der Grenzwert gilt, nicht das Gefühl", () => {
        // 🪤 Der Versatz liegt rein in y und geht von 0 aus: Nur so ist der Abstand GENAU der
        // Grenzwert. `8 + 0.05` wäre 8,050000000000001, und der Fall prüfte dann etwas anderes,
        // als sein Name sagt.
        const nodes = [place("start", "Start", 8, 0), place("ziel", "Ziel", 13, 0)];
        const dicht = measureLooseEndpoints(
            nodes,
            [
                path("weg", "Weg", [
                    [8, LOOSE_DISTANCE],
                    [13, 0],
                ]),
            ],
            [],
        );
        expect(Math.hypot(0, LOOSE_DISTANCE), "der Fall misst wirklich den Grenzwert").toBe(LOOSE_DISTANCE);
        expect(dicht.loose, "genau auf dem Grenzwert zählt nicht").toHaveLength(0);

        const weiter = measureLooseEndpoints(
            nodes,
            [
                path("weg", "Weg", [
                    [8, 0.06],
                    [13, 0],
                ]),
            ],
            [],
        );
        expect(weiter.loose, "ein Hundertstel darüber schon").toHaveLength(1);
    });

    it("🔴 ein Ende ohne Ort im Kasten und ohne Weg ist eine Sackgasse: kein loses Ende, kein gefallener Weg (WI-0132)", () => {
        const nodes = [place("ziel", "Ziel", 13, 10)];
        const report = measureLooseEndpoints(
            nodes,
            [
                path("weg", "Weg ins Leere", [
                    [8, 10],
                    [13, 10],
                ]),
            ],
            [],
        );
        expect(report.loose).toHaveLength(0);
        expect(report.detached, "der Weg bleibt im Netz").toHaveLength(0);
        expect(report.endpointsTotal).toBe(2);
        expect(report.deadEnds, "die Sackgasse steht als Zahl im Befund").toBe(1);
        expect(looseEndpointCheck(report).detail).toContain("1 Sackgassen");
        expect(ENDPOINT_BOX, "der Kasten bleibt Legacys Regel und wird hier nicht angefasst").toBe(0.5);
    });
});

describe("der Befund in verify:paths", () => {
    const nodes = [
        place("rasthof", "Rasthof", 10.3, 10),
        place("ziel", "Ziel", 13, 10),
        place("start", "Start", 8, 10),
    ];
    // Das Ende von weg-a liegt knapp neben dem Verbinder, nicht genau darauf: eine Stelle, kein Treffpunkt (Entscheidung B).
    const paths = [
        path("weg-a", "Gareth-St. Lechmin", [
            [8, 10],
            [10.002, 10.01],
        ]),
        path("verbinder", "Heeresrast-Fehring-Ginsterfeld", [
            [10, 10],
            [10.3, 10],
        ]),
        path("weg-b", "Heeresrast", [
            [10.3, 10],
            [13, 10],
        ]),
    ];
    const report = measureLooseEndpoints(nodes, paths, [retired("villa", "Villa Phexensglück", 10.01, 10)]);
    const check = looseEndpointCheck(report);

    it("🔴 hält NICHTS an: der Prüfer bleibt grün, obwohl Befunde vorliegen", () => {
        expect(check.passed, "die Prüfung selbst meldet den Befund").toBe(false);
        const settled = settleChecks("verify:paths", [check]);
        expect(settled.checks[0]?.blocking, "sie steht nicht in BLOCKING_CHECKS").toBe(false);
        expect(settled.passed, "das Urteil des Prüfers bleibt bestanden").toBe(true);
    });

    it("🔴 nennt, was er sieht: Zahlen und Rang 1 mit gelöschtem Ort; der Weg ohne Kante nur als Zahl (Entscheidung B)", () => {
        expect(check.detail).toContain("1 von 4 Kantenenden");
        expect(check.detail).toContain("1 davon an 1 stillgelegten Orten");
        expect(check.detail).toContain("1 Wege ohne Kante");
        expect(check.detail, "der Weg zur Arbeitsliste steht dabei").toContain("npm run ops:lose-wegenden");

        const rang1 = check.offenders.filter((line) => line.startsWith("RANG 1"));
        expect(rang1).toHaveLength(1);
        expect(rang1[0]).toContain("Villa Phexensglück villa");
        expect(rang1[0]).toContain("Gareth-St. Lechmin weg-a");
        expect(
            check.offenders.some((line) => line.includes("verbinder")),
            "der geschlungene Weg ist keine Stelle",
        ).toBe(false);
        expect(report.detached.map((path) => path.pathPublicId)).toEqual(["verbinder"]);
    });
});

describe("Adressen in Legacys Oberfläche", () => {
    it("💣 der Pin nennt erst lat, dann lng — und lat IST y", () => {
        // Legacys Karte ist L.CRS.Simple mit MAP_BOUNDS [[0,0],[1024,1024]] (js/app/bootstrap.js,
        // js/config.js), die Geometrie steht als [lng, lat] (api/_internal/map/features.php). Wer die
        // beiden vertauscht, schickt den Redakteur an die gespiegelte Stelle — stumm, denn beide
        // Zahlen liegen im gültigen Bereich.
        expect(legacySpotUrl(552.992, 533.406)).toBe(
            "https://avesmaps.de/?edit=1&pin=533.406%2C552.992&togglePaths=1&toggleCrossings=1",
        );
    });

    it("🪤 ein Weg hat nur über seinen Wiki-Artikel eine Adresse — ?place= löst Wege nicht auf", () => {
        expect(legacyPathUrl("Strasse", "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_2")).toBe(
            "https://avesmaps.de/?strasse=Reichsstra%C3%9Fe_2",
        );
        expect(legacyPathUrl("Flussweg", "https://de.wiki-aventurica.de/wiki/Hils"), "Fluss statt Strasse").toBe(
            "https://avesmaps.de/?fluss=Hils",
        );
        expect(legacyPathUrl("Seeweg", "https://de.wiki-aventurica.de/wiki/Hils")).toBe(
            "https://avesmaps.de/?fluss=Hils",
        );
        expect(legacyPathUrl("Strasse", null), "ohne Artikel keine eigene Adresse").toBeNull();
    });
});
