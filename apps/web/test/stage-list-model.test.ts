import { afterEach, describe, expect, it } from "vitest";
import type { RouteResponse, RouteSegment, RouteStage, RouteStagePoint } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import {
    isStation,
    stageListModel,
    type StageGroupModel,
    type StageListItem,
} from "../src/route-planner/stage-list-model.ts";

/**
 * Das Listenmodell der Etappen (WI-0079 P1): Mediengruppen, Wegpunktstationen, durchgehende Nummern und der
 * eigenständige Flug. Reine Daten - wie es aussieht, prüfen die Browserfälle.
 */

afterEach(() => setLocale("de"));

const place = (name: string): RouteStagePoint => ({ point: "place", place_id: name, name, x: 1, y: 2 });

const stage = (index: number, type: string, from: string, to: string, over: Partial<RouteStage> = {}): RouteStage => ({
    index,
    leg_index: 0,
    segment_start: index,
    segment_count: 1,
    type,
    transport: type === "Flussweg" ? "riverSailer" : type === "Seeweg" ? "cargoShip" : "groupFoot",
    flow_state: null,
    path_names: [],
    from: place(from),
    to: place(to),
    distance_units: 10,
    travel_hours: 2,
    rest_hours: 0,
    ...over,
});

/**
 * Ein Abschnitt zu einer Etappe: Er trägt die Kennung des Weges (`public_id`) und seinen Namen - daraus holt sich die
 * Zeile den Weg als Gegenstand, nie aus einem Namensvergleich gegen den Bestand (WI-0087 P1).
 */
const segment = (index: number, over: Partial<RouteSegment> = {}): RouteSegment =>
    ({
        index,
        edge_id: `e${String(index)}`,
        public_id: "",
        subtype: "Strasse",
        path_name: "",
        synthetic: false,
        ...over,
    }) as unknown as RouteSegment;

const routeOf = (...stages: RouteStage[]): RouteResponse =>
    ({
        found: true,
        miles_per_unit: 3,
        legs: [],
        stages,
        segments: stages.map((entry) => segment(entry.segment_start)),
    }) as unknown as RouteResponse;

/** Dieselbe Reise, aber mit ausdrücklich gesetzten Abschnitten (für die Wegnamen). */
const routeWith = (stages: RouteStage[], segments: RouteSegment[]): RouteResponse =>
    ({ found: true, miles_per_unit: 3, legs: [], stages, segments }) as unknown as RouteResponse;

const options = { pointNames: new Map<string, string>(), closures: new Set<number>() };
const build = (route: RouteResponse) => stageListModel(route, options);

const kinds = (items: StageListItem[]): string[] =>
    items.map((item) =>
        item.kind === "group" ? `group:${item.group.domain}` : item.kind === "flight" ? "flight" : "station",
    );

const groupAt = (items: StageListItem[], at: number): StageGroupModel => {
    const item = items[at];
    if (item?.kind !== "group") throw new Error("keine Gruppe");
    return item.group;
};

describe("Mediengruppen (§1.1)", () => {
    it("🔴 Land → Fluss → See → Land ergibt VIER Blöcke; zwei Landblöcke werden nicht zusammengezogen", () => {
        const { items } = build(
            routeOf(
                stage(0, "Strasse", "Gareth", "Burg"),
                stage(1, "Flussweg", "Burg", "Mardramund"),
                stage(2, "Seeweg", "Mardramund", "Kap"),
                stage(3, "Weg", "Kap", "Khunchom"),
            ),
        );
        expect(kinds(items)).toEqual(["station", "group:land", "group:river", "group:sea", "group:land", "station"]);
    });

    it("ein Wechsel der Wegart oder des Transportmittels innerhalb eines Mediums teilt NICHT", () => {
        const { items } = build(
            routeOf(
                stage(0, "Reichsstrasse", "A", "B"),
                stage(1, "Pfad", "B", "C", { transport: "lightWalker" }),
                stage(2, "Querfeldein", "C", "D"),
            ),
        );
        expect(kinds(items)).toEqual(["station", "group:land", "station"]);
        expect(groupAt(items, 1).stageIndexes).toEqual([0, 1, 2]);
    });

    it("die Kennzahlen einer Gruppe: Zahl der Etappen, Distanz, Reisezeit ohne Rast", () => {
        const { items } = build(routeOf(stage(0, "Strasse", "A", "B"), stage(1, "Weg", "B", "C")));
        expect(groupAt(items, 1).meta.map((value) => `${value.zahl} ${value.einheit}`)).toEqual([
            "2 Etappen",
            "60,00 Meilen",
            "4,0 Std.",
        ]);
    });

    it("eine lange Fahrt wird in Tagen gesagt, eine kurze in Stunden", () => {
        const { items } = build(routeOf(stage(0, "Seeweg", "A", "B", { travel_hours: 57.6 })));
        expect(groupAt(items, 1).meta[2]).toMatchObject({ zahl: "2,4", einheit: "Tage" });
    });
});

describe("die durchgehende Kette und ihre Nummern (§1.2)", () => {
    it("die Etappen laufen global von 1 bis n, über Gruppen hinweg", () => {
        const { rows } = build(
            routeOf(
                stage(0, "Strasse", "A", "B"),
                stage(1, "Flussweg", "B", "C"),
                stage(2, "Weg", "C", "D"),
                stage(3, "Weg", "D", "E"),
            ),
        );
        expect(rows.map((row) => row.number)).toEqual([1, 2, 3, 4]);
        expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3]);
    });

    it("die Zeile nennt Wegart, Distanz und Reisezeit als Werte", () => {
        const { rows } = build(routeOf(stage(0, "Strasse", "Gareth", "Perricum")));
        expect(rows[0]).toMatchObject({ fromName: "Gareth", toName: "Perricum", typeLabel: "Straße" });
        expect(rows[0]?.distance).toMatchObject({ zahl: "30,00", einheit: "Meilen" });
        expect(rows[0]?.duration).toMatchObject({ zahl: "2,0", einheit: "Std." });
    });
});

describe("Wegpunktstationen aus leg_index (§1.3)", () => {
    /**
     * 🔴 A11/A12 (WI-0087 P5). Der frühere Fall hielt das Gegenteil fest („ein Zwischenziel teilt eine Mediengruppe
     * NICHT"); genau diese Bauweise ließ das Zwischenziel mit der Gruppe verschwinden (Betreiber 2026-10-05).
     */
    it("🔴 A11: ein Zwischenziel mitten im Medium TEILT die Gruppe und steht zwischen den Klappboxen", () => {
        const { items } = build(
            routeOf(stage(0, "Strasse", "Gareth", "Hartsteen"), stage(1, "Weg", "Hartsteen", "Burg", { leg_index: 1 })),
        );
        expect(kinds(items)).toEqual(["station", "group:land", "station", "group:land", "station"]);
        // Keine Gruppe trägt eine Station mehr - nur so kann keine mit einer Gruppe eingeklappt werden.
        for (const item of items) {
            if (item.kind === "group") expect(item.group.rows.every((row) => !isStation(row))).toBe(true);
        }
        const station = items[2];
        expect(station?.kind === "station" && station.station.name).toBe("Hartsteen");
    });

    it("🔴 A12: die Zähler der geteilten Gruppen zählen je Box, nicht die alte Summe", () => {
        const { items, rows } = build(
            routeOf(
                stage(0, "Strasse", "Gareth", "Hartsteen"),
                stage(1, "Weg", "Hartsteen", "Burg", { leg_index: 1 }),
                stage(2, "Weg", "Burg", "Perricum", { leg_index: 1 }),
            ),
        );
        const counts = items.flatMap((item) => (item.kind === "group" ? [item.group.meta[0]?.zahl] : []));
        expect(counts).toEqual(["1", "2"]);
        // Die Kette läuft über die Fuge: die Nummern bleiben global, nicht je Box neu.
        expect(rows.map((row) => row.number)).toEqual([1, 2, 3]);
        const keys = items.flatMap((item) => (item.kind === "group" ? [item.group.key] : []));
        expect(new Set(keys).size, "jede Box hat einen eigenen Schlüssel").toBe(keys.length);
    });

    it("🔴 fällt der Wegpunkt mit dem Medienwechsel zusammen, steht die Station ZWISCHEN den Gruppen", () => {
        const { items } = build(
            routeOf(stage(0, "Flussweg", "Burg", "Perricum"), stage(1, "Seeweg", "Perricum", "Kap", { leg_index: 1 })),
        );
        expect(kinds(items)).toEqual(["station", "group:river", "station", "group:sea", "station"]);
        const station = items[2];
        expect(station?.kind === "station" && station.station.name).toBe("Perricum");
    });

    it("Start, Zwischenziel und Ziel tragen ihre Rolle; es gibt keine zweite Nummerierung", () => {
        const { items, rows } = build(
            routeOf(
                stage(0, "Strasse", "Gareth", "Hartsteen"),
                stage(1, "Weg", "Hartsteen", "Khunchom", { leg_index: 1 }),
            ),
        );
        const first = items[0];
        const last = items[items.length - 1];
        expect(first?.kind === "station" && first.station).toMatchObject({ name: "Gareth", role: "Start" });
        expect(last?.kind === "station" && last.station).toMatchObject({ name: "Khunchom", role: "Ziel" });
        expect(rows.map((row) => row.number)).toEqual([1, 2]);
    });
});

describe("der Flug ist eigenständig (§1.4)", () => {
    const flug = (index: number, from: string, to: string, over: Partial<RouteStage> = {}): RouteStage =>
        stage(index, "Flug", from, to, { transport: "griffin", ...over });

    it("🔴 keine Mediengruppe, sondern EIN Listenkopf mit Flugmittel, Etappenzahl, Distanz und Reisezeit", () => {
        const { items } = build(routeOf(flug(0, "Gareth", "Hartsteen"), flug(1, "Hartsteen", "Fasar")));
        expect(kinds(items)).toEqual(["station", "flight", "station"]);
        const head = items[1];
        if (head?.kind !== "flight") throw new Error("kein Flug");
        expect(head.flight.title).toBe("Flugreise · Greif");
        expect(head.flight.meta.map((value) => `${value.zahl} ${value.einheit}`)).toEqual([
            "2 Etappen",
            "60,00 Meilen",
            "4,0 Std.",
        ]);
        expect(head.flight.icon).toContain("Greif");
    });

    it("🔴 ein eigenes Flugmittel bekommt KEIN fremdes Bild, sondern das neutrale (Befund WI-0079 §8a)", () => {
        const { items, rows } = build(routeOf(flug(0, "A", "B", { transport: "custom" })));
        const head = items[1];
        if (head?.kind !== "flight") throw new Error("kein Flug");
        // Seit dem 2026-10-05 gibt es das Bild „Eigenes Fluggerät“; der Hexenflug wird nie wieder geliehen.
        expect(head.flight.icon).toContain("EigenesFluggeraet");
        expect(rows[0]?.icon).toContain("EigenesFluggeraet");
        expect(head.flight.icon).not.toContain("Hexenflug");
    });

    it("die Stationen laufen auch im Flug mit", () => {
        const { items } = build(
            routeOf(flug(0, "Gareth", "Hartsteen"), flug(1, "Hartsteen", "Fasar", { leg_index: 1 })),
        );
        const head = items[1];
        if (head?.kind !== "flight") throw new Error("kein Flug");
        expect(head.flight.rows.map((row) => (isStation(row) ? "station" : "stage"))).toEqual([
            "stage",
            "station",
            "stage",
        ]);
    });
});

describe("Eiltempo am Etikett (WI-0078, F4 = B)", () => {
    it("ganz betroffen, teilweise betroffen, gar nicht", () => {
        const { rows } = build(
            routeOf(
                stage(0, "Strasse", "A", "B", { hurry: { distance_units: 10, saved_hours: 0.4, hurried_hours: 0.8 } }),
                stage(1, "Strasse", "B", "C", { hurry: { distance_units: 4, saved_hours: 0.2, hurried_hours: 0.4 } }),
                stage(2, "Gebirgspass", "C", "D"),
            ),
        );
        expect(rows.map((row) => row.hurry)).toEqual(["full", "partial", null]);
    });
});

describe("Die Rast als Etikett (WI-0087 P8)", () => {
    it("🔴 eine Etappe, in die eine Rast fällt, ist markiert - eine ohne nicht", () => {
        const { rows } = build(
            routeOf(
                stage(0, "Strasse", "A", "B", { rest_hours: 16 }),
                stage(1, "Strasse", "B", "C"),
                // Ein Rundungsrest ist keine Rast.
                stage(2, "Strasse", "C", "D", { rest_hours: 0.001 }),
            ),
        );
        expect(rows.map((row) => row.rest)).toEqual([true, false, false]);
    });

    it("🔴 Rast und Eiltempo an DERSELBEN Etappe: beide Etiketten, nicht eines statt des anderen", () => {
        const { rows } = build(
            routeOf(
                stage(0, "Strasse", "A", "B", {
                    rest_hours: 16,
                    hurry: { distance_units: 10, saved_hours: 0.4, hurried_hours: 0.8 },
                }),
            ),
        );
        expect(rows[0]).toMatchObject({ rest: true, hurry: "full" });
    });
});

describe("Sprache", () => {
    it("🔴 englisch: dieselben Gruppen und Rollen in den Worten der englischen Tafel", () => {
        setLocale("en");
        const { items } = build(routeOf(stage(0, "Strasse", "A", "B")));
        expect(groupAt(items, 1).title).toBe("Overland");
        const first = items[0];
        expect(first?.kind === "station" && first.station.role).toBe("Start");
        expect(groupAt(items, 1).meta[1]).toMatchObject({ einheit: "miles" });
    });
});

describe("Der Wegname statt der Gattung (WI-0087 P1)", () => {
    const way = (name: string, id = "11111111-2222-3333-4444-555555555555"): RouteSegment =>
        segment(0, { public_id: id, path_name: name, subtype: "Pfad" });

    it("🔴 A1: trägt der Abschnitt einen echten Wegnamen, nennt die Zeile ihn - nicht „Pfad“", () => {
        const { rows } = build(
            routeWith(
                [stage(0, "Pfad", "A", "B", { path_names: ["Elfenpfad vom See in Osenbrück"] })],
                [way("Elfenpfad vom See in Osenbrück")],
            ),
        );
        expect(rows[0]?.pathName).toBe("Elfenpfad vom See in Osenbrück");
        expect(rows[0]?.pathRef).toEqual({ kind: "path", anchor: "11111111-2222-3333-4444-555555555555" });
        // Die Gattung bleibt im Modell stehen; die Zeile zeigt sie nur nicht mehr.
        expect(rows[0]?.typeLabel).toBe("Pfad");
    });

    it("🔴 A2: eine leere `path_names` heißt „kein Name“ - es bleibt bei der Gattung, nichts wird erfunden", () => {
        const { rows } = build(routeOf(stage(0, "Pfad", "A", "B")));
        expect(rows[0]?.pathName).toBeUndefined();
        expect(rows[0]?.pathRef).toBeUndefined();
        expect(rows[0]?.typeLabel).toBe("Pfad");
    });

    it("🔴 A3: mehrere Namen - der ERSTE steht in der Zeile", () => {
        const { rows } = build(
            routeWith(
                [stage(0, "Pfad", "A", "B", { path_names: ["Elfenpfad", "Zweiter Weg"], segment_count: 2 })],
                [
                    way("Elfenpfad", "aaaaaaaa-2222-3333-4444-555555555555"),
                    segment(1, {
                        public_id: "bbbbbbbb-2222-3333-4444-555555555555",
                        path_name: "Zweiter Weg",
                        subtype: "Pfad",
                    }),
                ],
            ),
        );
        expect(rows[0]?.pathName).toBe("Elfenpfad");
        expect(rows[0]?.pathRef).toEqual({ kind: "path", anchor: "aaaaaaaa-2222-3333-4444-555555555555" });
    });

    /** 🔴 WI-0087 P10, die drei Beispiele des Betreibers (2026-10-06), wörtlich nachgestellt. */
    describe("Die Wegart neben dem Namen - nur, wenn der Name sie nicht nennt (P10)", () => {
        const zeile = (type: string, name: string, subtype = type) => {
            const { rows } = build(
                routeWith(
                    [stage(0, type, "A", "B", { path_names: [name] })],
                    [segment(0, { public_id: "cccccccc-2222-3333-4444-555555555555", path_name: name, subtype })],
                ),
            );
            return rows[0];
        };

        it("🔴 die Art steht NICHT im Namen: sie kommt in Klammern dahinter", () => {
            const row = zeile("Weg", "Dragenfels-Perainsgarten");
            expect(row?.pathName).toBe("Dragenfels-Perainsgarten");
            expect(row?.pathType).toBe("Weg");
        });

        it("🔴 die Art STEHT im Namen - auch klein geschrieben: kein Zusatz", () => {
            // „Reichsstraße 3“ enthält „Straße“ nur klein; ein Vergleich mit Schreibung hängte „(Straße)“ an.
            const row = zeile("Strasse", "Reichsstraße 3");
            expect(row?.pathName).toBe("Reichsstraße 3");
            expect(row?.pathType).toBeUndefined();
        });

        it("🔴 kein Name: es bleibt bei der Gattung allein, ohne Klammern", () => {
            const { rows } = build(routeOf(stage(0, "Strasse", "A", "B")));
            expect(rows[0]?.pathName).toBeUndefined();
            expect(rows[0]?.pathType).toBeUndefined();
            expect(rows[0]?.typeLabel).toBe("Straße");
        });

        it("auch ein Flussweg oder Seeweg bekommt den Zusatz nur, wo der Name ihn nicht nennt", () => {
            expect(zeile("Flussweg", "Großer Fluss")?.pathType).toBe("Flussweg");
            expect(zeile("Flussweg", "Jennbachs Flussweg")?.pathType).toBeUndefined();
            expect(zeile("Seeweg", "Perlenmeer-Passage")?.pathType).toBe("Seeweg");
        });

        it("🔴 englisch: verglichen wird gegen die englische Artbezeichnung", () => {
            setLocale("en");
            expect(zeile("Strasse", "Reichsstraße 3")?.pathType).toBe("Road");
            expect(zeile("Strasse", "The Old Road")?.pathType).toBeUndefined();
        });
    });

    it("🔴 A4: ohne Kennung am Abschnitt bleibt der Name Anzeige - Befund statt raten", () => {
        const { rows } = build(
            routeWith(
                [stage(0, "Pfad", "A", "B", { path_names: ["Namenloser Anker"] })],
                [segment(0, { public_id: "", path_name: "Namenloser Anker", subtype: "Pfad" })],
            ),
        );
        expect(rows[0]?.pathName).toBe("Namenloser Anker");
        expect(rows[0]?.pathRef, "kein Knopf, der ins Leere klickt").toBeUndefined();
    });
});

describe("Die Gegenstände der Enden und der Stationen (WI-0087 P2, P3)", () => {
    const marker = (name: string): RouteStagePoint => ({ point: "marker", place_id: null, name, x: 1, y: 2 });

    it("🔴 A5: ein Ortsende trägt seinen Gegenstand - damit öffnet der Klick das Panel", () => {
        const { rows } = build(routeOf(stage(0, "Strasse", "Gareth", "Perricum")));
        expect(rows[0]?.fromRef).toEqual({ kind: "place", id: "Gareth" });
        expect(rows[0]?.toRef).toEqual({ kind: "place", id: "Perricum" });
    });

    it("🔴 A6: ein Ende OHNE Ort hat keinen Gegenstand - und damit keinen Knopf", () => {
        const { rows } = build(routeOf(stage(0, "Strasse", "Gareth", "Perricum", { to: marker("Anschlusspunkt") })));
        expect(rows[0]?.fromRef).toEqual({ kind: "place", id: "Gareth" });
        expect(rows[0]?.toRef).toBeUndefined();
    });

    it("🔴 A7: ein Wegpunkt mit Ort und Gebiet nennt beides in der zweiten Zeile", () => {
        const from: RouteStagePoint = {
            point: "place",
            place_id: "dragenfels",
            name: "Dragenfels",
            subtype: "dorf",
            territory: { id: "mardershoeh", name: "Baronie Königlich Mardershöh" },
            x: 1,
            y: 2,
        };
        const { items } = build(routeOf(stage(0, "Strasse", "Dragenfels", "Perricum", { from })));
        const first = items[0];
        if (first?.kind !== "station") throw new Error("keine Station");
        expect(first.station.kindLabel).toBe("Dorf");
        expect(first.station.territory).toEqual({
            name: "Baronie Königlich Mardershöh",
            ref: { kind: "territory", id: "mardershoeh" },
        });
        expect(first.station.ref).toEqual({ kind: "place", id: "dragenfels" });
    });

    it("🔴 A8: ohne Gebiet bleibt nur die Ortsklasse - kein leeres „in“", () => {
        const from: RouteStagePoint = {
            point: "place",
            place_id: "dorf",
            name: "Irgendwo",
            subtype: "dorf",
            x: 1,
            y: 2,
        };
        const { items } = build(routeOf(stage(0, "Strasse", "Irgendwo", "Perricum", { from })));
        const first = items[0];
        if (first?.kind !== "station") throw new Error("keine Station");
        expect(first.station.kindLabel).toBe("Dorf");
        expect(first.station.territory).toBeUndefined();
    });

    it("ein Wegpunkt ohne bekannte Ortsklasse bekommt kein erfundenes Wort", () => {
        const from: RouteStagePoint = { point: "place", place_id: "x", name: "Irgendwo", x: 1, y: 2 };
        const { items } = build(routeOf(stage(0, "Strasse", "Irgendwo", "Perricum", { from })));
        const first = items[0];
        if (first?.kind !== "station") throw new Error("keine Station");
        expect(first.station.kindLabel).toBeUndefined();
    });
});

describe("Grenzfälle", () => {
    it("eine Reise ohne Etappen ergibt eine leere Liste, keinen leeren Kasten", () => {
        expect(build(routeOf()).items).toEqual([]);
        expect(build(routeOf()).rows).toEqual([]);
    });

    it("eine Etappe, an der die Route einer Sperre ausweicht, trägt die Marke", () => {
        const model = stageListModel(routeOf(stage(0, "Strasse", "A", "B")), {
            ...options,
            closures: new Set([0]),
        });
        expect(model.rows[0]?.closure).toBe(true);
    });
});
