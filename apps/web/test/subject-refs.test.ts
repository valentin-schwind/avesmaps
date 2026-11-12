import { describe, expect, it } from "vitest";
import type { SubjectDetail } from "@avesmaps3d/shared";
import { presentationFromDetail } from "../src/info-panel/presentation.ts";
import {
    subjectRefOfArea,
    subjectRefOfHit,
    subjectRefOfPlace,
    subjectRefOfPoint,
    presentationOfHit,
} from "../src/info-panel/subject-refs.ts";
import type { AreaSelection } from "../src/map/area-selection.ts";

/**
 * Wie aus einem Klick, einem Treffer oder einer Antwort der `SubjectRef` und die Darstellung der Karte wird (WI-0063 P5). Reine Funktionen,
 * ohne Browser. Was das Panel zeigt, prüft `panel-model.test.ts`.
 */

const GARETH_ID = "80558060-4299-54aa-b520-814b10819885";
const REVISION = "1b1fc50153bf";

const garethAnswer: SubjectDetail = {
    subject: { kind: "place", id: GARETH_ID },
    revision: REVISION,
    title: "Gareth",
    subtitle: [
        { part: "type", key: "metropole" },
        {
            part: "capitalOf",
            territory: {
                ref: { kind: "territory", id: "99dacb52-93f1-4698-8746-1dd9d4b55992" },
                name: "Königreich Garetien",
            },
        },
    ],
    facts: [
        { field: "einwohner", value: "ca. 50.000", provenance: { kind: "wiki" } },
        { field: "synonyms", values: ["Stadt der Städte", "Kaiserstadt"], provenance: { kind: "wiki" } },
    ],
    context: {
        territories: {
            relation: "lies_in",
            chains: [
                [
                    { ref: { kind: "territory", id: "3359118f-bdfe-4569-8277-3f25c2d62463" }, name: "Kaiserreich" },
                    {
                        ref: { kind: "territory", id: "99dacb52-93f1-4698-8746-1dd9d4b55992" },
                        name: "Königreich Garetien",
                    },
                ],
            ],
        },
        landscapes: {
            relation: "lies_in",
            items: [
                {
                    ref: { kind: "area", id: "9188801c-92e6-4fbf-a6d5-794b7433f846" },
                    layer: "derographisch",
                    name: "Aventurien",
                    type: "kontinent",
                },
            ],
        },
        climate: { relation: "lies_in", items: [{ band: "gemaessigt", label: "Gemäßigte Zone" }] },
    },
    counts: { sources: 3 },
    target: { x: 551.625, y: 532.969, zoom: 5 },
};

describe("Darstellung der Karte aus dem Subject (WI-0063 11.1)", () => {
    it("🔴 ein Ort aus der Antwort: goldener Kern an seiner Lage, in der Standardansicht", () => {
        const presented = presentationFromDetail(garethAnswer);
        expect(presented).toEqual({
            place: { id: GARETH_ID, name: "Gareth", subtype: "metropole", x: 551.625, y: 532.969 },
            view: "standard",
        });
    });

    it("🔴 ein Gebiet aus der Antwort: leuchtet in der politischen Ansicht", () => {
        const territory: SubjectDetail = {
            subject: { kind: "territory", id: "159ad4fd-54de-4459-9e89-e0344fc7670c" },
            revision: REVISION,
            title: "Kaisermark Gareth",
            target: { x: 500, y: 500, zoom: 4 },
        };
        const presented = presentationFromDetail(territory);
        expect(presented.view).toBe("political");
        expect(presented.area).toMatchObject({
            kind: "territory",
            id: "159ad4fd-54de-4459-9e89-e0344fc7670c",
            name: "Kaisermark Gareth",
            anchor: { x: 500, y: 500 },
        });
    });

    it("eine Fläche mit Gruppe leuchtet ganz; ein Weg über seine Kette, mit Name und Art", () => {
        const area = presentationFromDetail({
            subject: {
                kind: "area",
                id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11",
                group: ["1b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11"],
            },
            revision: REVISION,
            title: "Archipel der Perlen",
            subtitle: [{ part: "type", key: "inselgruppe" }],
            target: { x: 1, y: 2, zoom: 4 },
        });
        expect(area.area).toMatchObject({
            kind: "landscape",
            group: ["0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11", "1b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11"],
        });
        const path = presentationFromDetail({
            subject: { kind: "path", chain: "Gardel:Flussweg" },
            revision: REVISION,
            title: "Gardel",
            subtitle: [{ part: "type", key: "Flussweg" }],
            target: { x: 1, y: 2, zoom: 4 },
        });
        expect(path.area).toMatchObject({ kind: "path", id: "Gardel:Flussweg", name: "Gardel", type: "Flussweg" });
    });

    it("🔴 ein Klimaband zeigt die Klimaansicht und seine Zone kräftiger (die Hervorhebung der Suche), mit der Landschaftsebene „Klima“", () => {
        expect(
            presentationFromDetail({
                subject: { kind: "climate", band: "gemaessigt" },
                revision: REVISION,
                title: "Gemäßigte Zone",
                target: { x: 512, y: 560, zoom: 3 },
            }),
        ).toEqual({ view: "landscapes", landscape: "klima", climate: "gemaessigt" });
    });

    it("🔴 eine Kraftlinie zeigt die Kraftlinien-Ansicht und leuchtet unter ihrem Namen (WI-0063 P8, hinfliegen, markieren, Panel)", () => {
        expect(
            presentationFromDetail({
                subject: { kind: "powerline", anchor: "669f9371-dfcd-4a05-bdd9-38de68a79ad8" },
                revision: REVISION,
                title: "Basiliuslinie",
                target: { x: 1, y: 2, zoom: 4 },
            }),
        ).toEqual({ view: "powerlines", powerline: { name: "Basiliuslinie" } });
        // Ohne Namen in der Antwort bleibt es beim Ansichtswechsel.
        expect(
            presentationFromDetail({
                subject: { kind: "powerline", anchor: "669f9371-dfcd-4a05-bdd9-38de68a79ad8" },
                revision: REVISION,
                target: { x: 1, y: 2, zoom: 4 },
            }),
        ).toEqual({ view: "powerlines" });
    });

    it("eine Kartenstelle zeigt ihren Tropfen; ein Gipfel hat keine eigene Darstellung", () => {
        expect(presentationFromDetail({ subject: { kind: "mapPoint", x: 1, y: 2 }, revision: REVISION })).toEqual({
            pin: { x: 1, y: 2 },
        });
        expect(
            presentationFromDetail({
                subject: { kind: "peak", id: "159ad4fd-54de-4459-9e89-e0344fc7670c" },
                revision: REVISION,
                target: { x: 1, y: 2, zoom: 5 },
            }),
        ).toEqual({});
    });
});

describe("`SubjectRef` aus Klick, Fläche und Treffer: die Kennung der Fachdomäne, nie der Name", () => {
    const landscape = (extra: Partial<AreaSelection> = {}): AreaSelection => ({
        kind: "landscape",
        id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11",
        name: "Waldwildnis",
        type: "wald",
        anchor: { x: 1, y: 2 },
        ...extra,
    });

    it("Ort, Fläche, Gebiet, Weg", () => {
        expect(subjectRefOfPlace({ id: GARETH_ID })).toEqual({ kind: "place", id: GARETH_ID });
        expect(subjectRefOfPlace({ id: "" })).toBeUndefined();
        expect(subjectRefOfArea(landscape())).toEqual({ kind: "area", id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11" });
        expect(subjectRefOfArea({ ...landscape(), kind: "territory" })).toEqual({
            kind: "territory",
            id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11",
        });
        expect(subjectRefOfArea({ ...landscape(), kind: "path", id: "Gardel:Flussweg" })).toEqual({
            kind: "path",
            chain: "Gardel:Flussweg",
        });
        // Ein Weg ohne gültigen Kettenschlüssel hat keinen Subject.
        expect(subjectRefOfArea({ ...landscape(), kind: "path", id: "Gardel" })).toBeUndefined();
    });

    it("die Gruppe nennt nur die ANDEREN Regionen", () => {
        const id = "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11";
        const other = "1b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11";
        expect(subjectRefOfArea(landscape({ group: [id, other] }))).toEqual({ kind: "area", id, group: [other] });
        expect(subjectRefOfArea(landscape({ group: [id] }))).toEqual({ kind: "area", id });
    });

    it("🔴 Treffer der Suche: Ort, Landschaft mit Region, Weg-Kette; freies Label und Klimazone sind kein Subject", () => {
        const base = { name: "X", x: 1, y: 2, zoom: 5 };
        expect(subjectRefOfHit({ kind: "ort", id: GARETH_ID, ...base })).toEqual({ kind: "place", id: GARETH_ID });
        expect(subjectRefOfHit({ kind: "weg", id: "Gardel:Flussweg", subtype: "Flussweg", ...base })).toEqual({
            kind: "path",
            chain: "Gardel:Flussweg",
        });
        expect(
            subjectRefOfHit({
                kind: "landschaft",
                id: "label",
                region: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11",
                ...base,
            }),
        ).toEqual({ kind: "area", id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11" });
        expect(subjectRefOfHit({ kind: "landschaft", id: "label", ...base })).toBeUndefined();
        expect(subjectRefOfHit({ kind: "klima", id: "gemaessigt", ...base })).toBeUndefined();
    });

    it("die Darstellung aus einem Treffer: der Ort als gewählter Ort, die Landschaft als Fläche", () => {
        const base = { name: "Gareth", x: 551.6, y: 532.9, zoom: 5 };
        expect(presentationOfHit({ kind: "ort", id: GARETH_ID, subtype: "metropole", ...base })).toEqual({
            place: { id: GARETH_ID, name: "Gareth", subtype: "metropole", x: 551.6, y: 532.9 },
        });
        expect(presentationOfHit({ kind: "klima", id: "x", ...base })).toEqual({});
    });

    it("🔴 eine Kartenstelle außerhalb der Karte hat keinen Subject (der Server wiese sie ab)", () => {
        expect(subjectRefOfPoint({ x: 551.6, y: 532.9 })).toEqual({ kind: "mapPoint", x: 551.6, y: 532.9 });
        expect(subjectRefOfPoint({ x: -50, y: 10 })).toBeUndefined();
        expect(subjectRefOfPoint({ x: 10, y: 99999 })).toBeUndefined();
    });
});
