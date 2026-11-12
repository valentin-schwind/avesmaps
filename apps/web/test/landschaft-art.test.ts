import { describe, expect, it } from "vitest";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import { teileAus } from "../src/landschaftseditor/ecken";
import { createLandschaftArt, felderAus, type LandschaftStand } from "../src/landschaftseditor/landschaft-art";

/**
 * Die Landschaft als Art des gemeinsamen Entwurfs (WI-0178 B2, O3). Problemfälle: Name, Beschriftung und Form gehen in getrennte
 * Operationen; ein unverändertes Feld reist mit und überschreibt, was ein anderer gesetzt hat; die Revision der Landschaft reist mit,
 * obwohl nur die Form geändert ist (T44 (4)); beim Anwenden auf einen neuen Stand gehen fremde Beschriftungswerte verloren. Ebene und
 * Art (Betreiber 2026-10-17): eine neue Ebene geht ohne ihre Art los; „Fertig“ schreibt, obwohl die Art fehlt.
 */

const WALD = "c3c3c3c3-0000-4000-8000-000000000001";
const FLAECHE = "c3c3c3c3-0000-4000-8000-0000000000a1";
const LABEL = "c3c3c3c3-0000-4000-8000-0000000000c1";

const D: EditorLandscapeDetail = {
    id: WALD,
    name: "Formwald",
    layer: "vegetation",
    type: "wald",
    circle: "voll",
    order: 0,
    clickLocked: false,
    areas: [
        {
            id: FLAECHE,
            affectsPaths: true,
            revision: 7,
            polygons: [
                [
                    [
                        [0, 0],
                        [10, 0],
                        [10, 10],
                    ],
                ],
            ],
        },
    ],
    labels: [{ id: LABEL, text: "Formwald", x: 5, y: 5, visible: true, revision: 4, size: 12 }],
    neighbors: [],
    revision: 3,
};

const start = (): LandschaftStand => ({ felder: felderAus(D), form: undefined });

describe("Landschaft als Art des gemeinsamen Entwurfs", () => {
    it("🔴 Name, Beschriftung und Form in EINEM Körper, je gegen die eigene Revision; Unverändertes reist nicht mit", () => {
        const art = createLandschaftArt();
        const teile = teileAus(D.areas, D.name);
        const s0: LandschaftStand = { ...start(), form: { teile, nachbarn: [] } };
        const gezogen = teile.map((teil) => ({
            ...teil,
            punkte: teil.punkte.map((p, i) => (i === 1 ? { x: 12, y: 0 } : p)),
        }));
        const jetzt: LandschaftStand = {
            felder: {
                ...s0.felder,
                name: "Formforst",
                labels: { [LABEL]: { ...s0.felder.labels[LABEL]!, priority: 4 } },
            },
            form: { teile: gezogen, nachbarn: [] },
        };
        expect(art.operation(D, s0, jetzt, "op")).toEqual({
            operationId: "op",
            baseRevision: 3,
            changes: { name: "Formforst" },
            labels: [{ id: LABEL, baseRevision: 4, changes: { priority: 4 } }],
            areas: [
                {
                    id: FLAECHE,
                    baseRevision: 7,
                    polygons: [
                        [
                            [
                                [0, 0],
                                [12, 0],
                                [10, 10],
                            ],
                        ],
                    ],
                },
            ],
        });
        expect(art.geaendert(D, jetzt)).toEqual(["name", "beschriftungen", "form"]);
    });

    it("🔴 nur die Form: keine Revision der Landschaft im Körper (T44 (4)); nichts geändert: keine Operation", () => {
        const art = createLandschaftArt();
        const teile = teileAus(D.areas, D.name);
        const s0: LandschaftStand = { ...start(), form: { teile, nachbarn: [] } };
        const gezogen = teile.map((teil) => ({
            ...teil,
            punkte: teil.punkte.map((p, i) => (i === 2 ? { x: 9, y: 9 } : p)),
        }));
        const body = art.operation(D, s0, { ...s0, form: { teile: gezogen, nachbarn: [] } }, "op");
        expect(body).not.toHaveProperty("baseRevision");
        expect(body?.areas).toHaveLength(1);
        expect(art.operation(D, s0, s0, "op")).toBeUndefined();
    });

    it("fremde Änderungen je Teil; auf den neuen Stand bleiben fremde Beschriftungswerte, eigene gewinnen", () => {
        const art = createLandschaftArt();
        const frisch: EditorLandscapeDetail = {
            ...D,
            revision: 4,
            labels: [{ ...D.labels[0]!, revision: 5, size: 16 }],
        };
        expect(art.fremde(D, frisch)).toEqual(["beschriftungen"]);
        const eigen: LandschaftStand = {
            felder: {
                ...felderAus(D),
                name: "Formforst",
                labels: { [LABEL]: { ...felderAus(D).labels[LABEL]!, priority: 2 } },
            },
            form: undefined,
        };
        expect(art.aufNeuenStand(D, frisch, eigen).felder).toEqual({
            name: "Formforst",
            ebene: "vegetation",
            art: "wald",
            gesperrt: false,
            verborgen: false,
            gefahren: [],
            labels: {
                [LABEL]: {
                    size: 16,
                    priority: 2,
                    zoomMin: undefined,
                    zoomMax: undefined,
                    visible: true,
                    followName: true,
                    x: 5,
                    y: 5,
                },
            },
        });
    });

    it("🔴 Ebene und Art: neue Ebene ohne Art sperrt „Fertig“ mit Grund; mit Art gehen beide als Paar, nur die Art allein", () => {
        const art = createLandschaftArt();
        const s0 = start();
        const ohneArt: LandschaftStand = { ...s0, felder: { ...s0.felder, ebene: "topographie", art: undefined } };
        expect(art.pruefe!(D, ohneArt)).toContain("Topographie");
        expect(art.geaendert(D, ohneArt)).toEqual(["ebene", "art"]);
        const mitArt: LandschaftStand = { ...s0, felder: { ...s0.felder, ebene: "topographie", art: "tal" } };
        expect(art.pruefe!(D, mitArt)).toBeUndefined();
        expect(art.operation(D, s0, mitArt, "op")).toEqual({
            operationId: "op",
            baseRevision: 3,
            changes: { layer: "topographie", type: "tal" },
        });
        const nurArt: LandschaftStand = { ...s0, felder: { ...s0.felder, art: "urwald" } };
        expect(art.operation(D, s0, nurArt, "op")).toEqual({
            operationId: "op",
            baseRevision: 3,
            changes: { type: "urwald" },
        });
        // Wer nie eine Art hatte und die Ebene behält, darf ohne schreiben.
        const { type, ...ohneJe } = D;
        expect(type).toBe("wald");
        expect(art.pruefe!(ohneJe, { felder: felderAus(ohneJe), form: undefined })).toBeUndefined();
    });

    it("ein anderer hat die Ebene geändert: fremd; eigene Ebene und Art bleiben beim Anwenden als Paar", () => {
        const art = createLandschaftArt();
        const frisch: EditorLandscapeDetail = { ...D, revision: 4, layer: "topographie", type: "tal" };
        expect(art.fremde(D, frisch)).toEqual(["ebene", "art"]);
        const eigen: LandschaftStand = { felder: { ...felderAus(D), art: "urwald" }, form: undefined };
        expect(art.aufNeuenStand(D, frisch, eigen).felder).toMatchObject({ ebene: "vegetation", art: "urwald" });
        const nurName: LandschaftStand = { felder: { ...felderAus(D), name: "Formforst" }, form: undefined };
        expect(art.aufNeuenStand(D, frisch, nurName).felder).toMatchObject({ ebene: "topographie", art: "tal" });
    });

    it("🔴 Klicksperre, Kurve und „Namen übernehmen“: nur Geändertes reist, Folgen nur in eine Richtung (FL3)", () => {
        const art = createLandschaftArt();
        const d: EditorLandscapeDetail = {
            ...D,
            curve: { enabled: false },
            labels: [{ ...D.labels[0]!, text: "Der alte Forst" }],
        };
        const s0: LandschaftStand = { felder: felderAus(d), form: undefined };
        expect(s0.felder.labels[LABEL]!.followName).toBe(false);
        const jetzt: LandschaftStand = {
            felder: {
                ...s0.felder,
                gesperrt: true,
                kurve: true,
                laeufe: 2,
                labels: { [LABEL]: { ...s0.felder.labels[LABEL]!, followName: true } },
            },
            form: undefined,
        };
        expect(art.operation(d, s0, jetzt, "op")).toEqual({
            operationId: "op",
            baseRevision: 3,
            changes: { locked: true, curve: { enabled: true, max: 2 } },
            labels: [{ id: LABEL, baseRevision: 4, changes: { followName: true } }],
        });
        expect(art.geaendert(d, jetzt)).toEqual(["sperre", "kurve", "beschriftungen"]);
        // Nur die Kurve aus: ohne Höchstzahl.
        const aus: LandschaftStand = { ...s0, felder: { ...s0.felder, kurve: false } };
        const mitKurve: LandschaftStand = { ...s0, felder: { ...s0.felder, kurve: true } };
        expect(art.operation(d, mitKurve, aus, "op")?.changes).toEqual({ curve: { enabled: false } });
    });

    it("🔴 die Spanne reist als Paar; ↺ „Vorgabe der Art“ als zoomReset", () => {
        const art = createLandschaftArt();
        const d: EditorLandscapeDetail = { ...D, labels: [{ ...D.labels[0]!, zoomMin: 2, zoomMax: 6 }] };
        const s0: LandschaftStand = { felder: felderAus(d), form: undefined };
        const label = s0.felder.labels[LABEL]!;
        const nurBis: LandschaftStand = {
            ...s0,
            felder: { ...s0.felder, labels: { [LABEL]: { ...label, zoomMax: 8 } } },
        };
        expect(art.operation(d, s0, nurBis, "op")?.labels).toEqual([
            { id: LABEL, baseRevision: 4, changes: { zoomMin: 2, zoomMax: 8 } },
        ]);
        const vorgabe: LandschaftStand = {
            ...s0,
            felder: { ...s0.felder, labels: { [LABEL]: { ...label, zoomMin: undefined, zoomMax: undefined } } },
        };
        expect(art.operation(d, s0, vorgabe, "op")?.labels).toEqual([
            { id: LABEL, baseRevision: 4, changes: { zoomReset: true } },
        ]);
    });

    it("🔴 D1: der Platz ist ein Wunsch (ganz nach vorn oder hinten), kein Rang; er reist allein mit der Revision und hält auf neuem Stand", () => {
        const art = createLandschaftArt();
        const s0 = start();
        const vorn: LandschaftStand = { ...s0, felder: { ...s0.felder, platz: "vorn" } };
        expect(art.operation(D, s0, vorn, "op")).toEqual({
            operationId: "op",
            baseRevision: 3,
            changes: { order: "front" },
        });
        expect(art.geaendert(D, vorn)).toEqual(["platz"]);
        const hinten: LandschaftStand = { ...s0, felder: { ...s0.felder, platz: "hinten" } };
        expect(art.operation(D, s0, hinten, "op")?.changes).toEqual({ order: "back" });
        // Ein anderer hat umgestapelt: fremd am Platz; der eigene Wunsch gilt auf dem neuen Stand weiter.
        const frisch: EditorLandscapeDetail = { ...D, revision: 4, order: 12 };
        expect(art.fremde(D, frisch)).toEqual(["platz"]);
        expect(art.aufNeuenStand(D, frisch, vorn).felder.platz).toBe("vorn");
        expect(art.aufNeuenStand(D, frisch, s0).felder.platz).toBeUndefined();
    });

    it("🔴 C4: die Lage reist als Paar und nur, wenn sie sich bewegt hat; eine Sicherung ohne Lage bewegt nichts", () => {
        const art = createLandschaftArt();
        const s0 = start();
        const label = s0.felder.labels[LABEL]!;
        const gezogen: LandschaftStand = {
            ...s0,
            felder: { ...s0.felder, labels: { [LABEL]: { ...label, x: 7, y: 5 } } },
        };
        expect(art.operation(D, s0, gezogen, "op")).toEqual({
            operationId: "op",
            labels: [{ id: LABEL, baseRevision: 4, changes: { position: [7, 5] } }],
        });
        expect(art.geaendert(D, gezogen)).toEqual(["beschriftungen"]);
        const { x, y, ...ohneLage } = label;
        expect([x, y]).toEqual([5, 5]);
        const alt: LandschaftStand = { ...s0, felder: { ...s0.felder, labels: { [LABEL]: ohneLage } } };
        expect(art.operation(D, s0, alt, "op")).toBeUndefined();
    });

    it("🔴 das Gebirge (P4): nur Geändertes als `gebirge`, ↺ als `zurueck`; ohne Gebirge im Entwurf nichts davon", () => {
        const art = createLandschaftArt();
        const berg: EditorLandscapeDetail = {
            ...D,
            layer: "topographie",
            type: "gebirge",
            areas: [
                {
                    ...D.areas[0]!,
                    gebirge: {
                        typ: null,
                        muster: null,
                        kammhoehe: 4000,
                        werte: { plateau: 0.9 },
                        modell: {},
                        netz: { kaemme: [], nebengipfel: [] },
                        revision: 1,
                    },
                },
            ],
        };
        const s0: LandschaftStand = { felder: felderAus(berg), form: undefined };
        const jetzt: LandschaftStand = {
            ...s0,
            felder: {
                ...s0.felder,
                gebirge: { [FLAECHE]: { typ: "kammgebirge", muster: null, kammhoehe: null, werte: {} } },
            },
        };
        expect(art.operation(berg, s0, jetzt, "op")).toEqual({
            operationId: "op",
            // Gegen die Revision der Gebirgswerte aus dem gelesenen Stand (WI-0245).
            gebirge: [
                { area: FLAECHE, changes: { typ: "kammgebirge", zurueck: ["kammhoehe", "plateau"], baseRevision: 1 } },
            ],
        });
        expect(art.geaendert(berg, jetzt)).toEqual(["gebirge"]);
        // Wird die Fläche im Entwurf wieder zum Wald, reist das Gebirge nicht mit (sonst 400 `kein_gebirge`).
        const wald = { ...jetzt, felder: { ...jetzt.felder, ebene: "vegetation" as const, art: "wald" } };
        expect(art.operation(berg, s0, wald, "op")?.gebirge).toBeUndefined();
    });

    it("🔴 ein Wald wird im Entwurf zum Gebirge: die ersten Werte gehen gegen „keine Werte“ (T50), mit Ebene und Art in EINEM Körper", () => {
        const art = createLandschaftArt();
        const s0 = start();
        const jetzt: LandschaftStand = {
            ...s0,
            felder: {
                ...s0.felder,
                ebene: "topographie",
                art: "gebirge",
                gebirge: { [FLAECHE]: { typ: "rumpfgebirge", muster: null, kammhoehe: 1500, werte: {} } },
            },
        };
        expect(art.operation(D, s0, jetzt, "op")).toEqual({
            operationId: "op",
            baseRevision: 3,
            changes: { type: "gebirge", layer: "topographie" },
            // Eine Fläche, die erst zum Gebirge wird, hat keine Werte: Revision 0 (T50 verwirft die alten vorher).
            gebirge: [{ area: FLAECHE, changes: { typ: "rumpfgebirge", kammhoehe: 1500, baseRevision: 0 } }],
        });
    });

    it("🔴 Gipfelhöhen (P5): nur geänderte gegen die Revision des Gipfels; ein neuer Stand behält die eigene Höhe, ein fremder Gipfelstand ist ein Konflikt", () => {
        const art = createLandschaftArt();
        const ZINNE = "c3c3c3c3-0000-4000-8000-0000000000d1";
        const SPITZE = "c3c3c3c3-0000-4000-8000-0000000000d2";
        const berg: EditorLandscapeDetail = {
            ...D,
            layer: "topographie",
            type: "gebirge",
            peaks: [
                { id: ZINNE, name: "Zinne", subtype: "berggipfel", height: 3200, position: [5, 5], revision: 2 },
                { id: SPITZE, name: "Spitze", subtype: "vulkan", position: [6, 6], revision: 1 },
            ],
        };
        const s0: LandschaftStand = { felder: felderAus(berg), form: undefined };
        const jetzt: LandschaftStand = {
            ...s0,
            felder: { ...s0.felder, gipfelHoehen: { [ZINNE]: 3400, [SPITZE]: 1800 } },
        };
        expect(art.operation(berg, s0, jetzt, "op")?.peaks).toEqual([
            { id: ZINNE, baseRevision: 2, height: 3400 },
            { id: SPITZE, baseRevision: 1, height: 1800 },
        ]);
        expect(art.geaendert(berg, jetzt)).toEqual(["gipfel"]);
        // Zurück auf die gelesene Höhe: nichts zu schreiben.
        const zurueck = { ...jetzt, felder: { ...jetzt.felder, gipfelHoehen: { [ZINNE]: 3200 } } };
        expect(art.operation(berg, s0, zurueck, "op")).toBeUndefined();
        // Ein anderer hat die Spitze geändert: fremd, und auf dem neuen Stand steht die eigene Höhe gegen dessen Revision.
        const neu: EditorLandscapeDetail = {
            ...berg,
            peaks: [berg.peaks![0]!, { ...berg.peaks![1]!, height: 900, revision: 2 }],
        };
        expect(art.fremde(berg, neu)).toEqual(["gipfel"]);
        const angewandt = art.aufNeuenStand(berg, neu, jetzt);
        expect(angewandt.felder.gipfelHoehen).toEqual({ [ZINNE]: 3400, [SPITZE]: 1800 });
        expect(art.operation(neu, s0, angewandt, "op")?.peaks).toContainEqual({
            id: SPITZE,
            baseRevision: 2,
            height: 1800,
        });
    });

    it("🔴 Gefahrenlage (WI-0308): die ganze Auswahl reist in der Folge des Katalogs mit der Revision; gleiche Auswahl reist nicht", () => {
        const art = createLandschaftArt();
        const s0 = start();
        expect(s0.felder.gefahren).toEqual([]);
        const jetzt: LandschaftStand = { ...s0, felder: { ...s0.felder, gefahren: ["wildnis", "kriminalitaet"] } };
        expect(art.operation(D, s0, jetzt, "op")).toEqual({
            operationId: "op",
            baseRevision: 3,
            changes: { hazards: ["kriminalitaet", "wildnis"] },
        });
        expect(art.geaendert(D, jetzt)).toEqual(["gefahr"]);
        // Dieselbe Auswahl in anderer Folge ist keine Änderung.
        const gelesen: EditorLandscapeDetail = { ...D, hazards: ["kriminalitaet", "wildnis"] };
        const s1: LandschaftStand = { felder: felderAus(gelesen), form: undefined };
        const umgestellt: LandschaftStand = { ...s1, felder: { ...s1.felder, gefahren: ["wildnis", "kriminalitaet"] } };
        expect(art.operation(gelesen, s1, umgestellt, "op")).toBeUndefined();
        expect(art.geaendert(gelesen, umgestellt)).toEqual([]);
        // „ungefährlich“ leert.
        const leer: LandschaftStand = { ...s1, felder: { ...s1.felder, gefahren: [] } };
        expect(art.operation(gelesen, s1, leer, "op")?.changes).toEqual({ hazards: [] });
    });

    it("🔴 Gefahrenlage: ein anderer hat sie geändert = fremd; die eigene Wahl gewinnt auf dem neuen Stand, sonst gilt die fremde", () => {
        const art = createLandschaftArt();
        const frisch: EditorLandscapeDetail = { ...D, revision: 4, hazards: ["seuche"] };
        expect(art.fremde(D, frisch)).toEqual(["gefahr"]);
        const ohneEigene = art.aufNeuenStand(D, frisch, start());
        expect(ohneEigene.felder.gefahren).toEqual(["seuche"]);
        const eigen: LandschaftStand = { ...start(), felder: { ...start().felder, gefahren: ["unerforscht"] } };
        expect(art.aufNeuenStand(D, frisch, eigen).felder.gefahren).toEqual(["unerforscht"]);
    });

    it("eine Sicherung von vorher ohne Gefahrenlage schreibt keine", () => {
        const art = createLandschaftArt();
        const s0 = start();
        const alt: { -readonly [K in keyof LandschaftStand["felder"]]?: LandschaftStand["felder"][K] } = {
            ...s0.felder,
        };
        delete alt.gefahren;
        const jetzt: LandschaftStand = {
            felder: { ...(alt as LandschaftStand["felder"]), name: "Formforst" },
            form: undefined,
        };
        expect(art.operation(D, s0, jetzt, "op")?.changes).toEqual({ name: "Formforst" });
    });
});
