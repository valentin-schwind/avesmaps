import { describe, expect, it } from "vitest";
import type { EditorPowerlineDetail } from "@avesmaps3d/shared";
import type { Aenderung, Teil } from "../src/map/geometrie/geometrie";
import {
    createKraftlinieArt,
    felderAus,
    formAus,
    formNach,
    mitAbschnitt,
    ohneKnoten,
    type KraftlinieForm,
    type KraftlinieStand,
} from "../src/kraftlinieneditor/kraftlinie-art";

/**
 * Die Kraftlinie als Art des gemeinsamen Entwurfs (WI-0205 K6, K8 auf O3; EDIT-0003 T44) ohne Karte und ohne Server.
 *
 * Problemfälle: Felder und Form gehen in zwei Operationen; ein unverändertes Feld reist mit und löscht, was ein anderer gesetzt hat;
 * ein leerer Name wird geschrieben; ein Ende ins Leere wird gespeichert (R4); ein umgehängtes Ende verliert seinen Knoten; der
 * Konflikt übernimmt still fremde Bögen als eigene oder verliert die eigenen; eine Sicherung kommt kaputt zurück.
 */

const A1 = "a1a1a1a1-0000-4000-8000-000000000001";
const A2 = "a1a1a1a1-0000-4000-8000-000000000002";
const GARETH = "c1c1c1c1-0000-4000-8000-000000000001";
const PUNKT = "c1c1c1c1-0000-4000-8000-000000000002";
const PUNIN = "c1c1c1c1-0000-4000-8000-000000000003";
const NEU = "c1c1c1c1-0000-4000-8000-000000000004";

const LINIE: EditorPowerlineDetail = {
    id: A1,
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    segments: [
        { id: A1, from: GARETH, to: PUNKT, curve: 12, labelVisible: true, revision: 3 },
        { id: A2, from: PUNKT, to: PUNIN, curve: null, labelVisible: false, revision: 5 },
    ],
    nodes: [
        { id: GARETH, kind: "place", name: "Gareth", x: 100, y: 100, nodix: true, meets: [] },
        { id: PUNKT, kind: "nodix", x: 150, y: 120, nodix: true, meets: [] },
        { id: PUNIN, kind: "place", name: "Punin", x: 200, y: 100, nodix: true, meets: [] },
    ],
};

const art = createKraftlinieArt();
const start = (): KraftlinieStand => ({ felder: felderAus(LINIE), form: formAus(LINIE) });
const teil = (s: KraftlinieStand, id: string): Teil => s.form!.teile.find((t) => t.objekt === id)!;
const mitBogen = (s: KraftlinieStand, id: string, wert: number): KraftlinieStand => ({
    ...s,
    form: { ...s.form!, teile: s.form!.teile.map((t) => (t.objekt === id ? { ...t, wert } : t)) },
});

describe("Kraftlinie als BearbeitungsArt", () => {
    it("der gelesene Stand: je Abschnitt mit Knoten ein Teil, der Bogen als Wert, die Enden je Abschnitt; Felder aus der Linie", () => {
        const form = formAus(LINIE);
        expect(form.teile.map((t) => [t.objekt, t.wert, t.revision, t.punkte])).toEqual([
            [
                A1,
                12,
                3,
                [
                    { x: 100, y: 100 },
                    { x: 150, y: 120 },
                ],
            ],
            [
                A2,
                undefined,
                5,
                [
                    { x: 150, y: 120 },
                    { x: 200, y: 100 },
                ],
            ],
        ]);
        expect(form.enden).toEqual({ [A1]: { from: GARETH, to: PUNKT }, [A2]: { from: PUNKT, to: PUNIN } });
        expect(felderAus(LINIE)).toEqual({
            name: "Punin–Gareth",
            labelVisible: true,
            description: "",
            wiki: null,
            herkunft: {},
        });
    });

    it("🔴 Felder und Form in EINER Operation; was sich nicht geändert hat, reist nicht mit; nichts geändert: keine", () => {
        const s = start();
        expect(art.operation(LINIE, s, s, "op")).toBeUndefined();
        const jetzt = mitBogen({ ...s, felder: { ...s.felder, description: " Eine Ader. " } }, A2, -20);
        expect(art.operation(LINIE, s, jetzt, "op")).toEqual({
            operationId: "op",
            segments: [
                { id: A1, baseRevision: 3 },
                { id: A2, baseRevision: 5, curve: -20 },
            ],
            description: "Eine Ader.",
        });
        expect(art.geaendert(LINIE, jetzt)).toEqual(["beschreibung", "form"]);
        // Ohne Form (nur Felder bearbeitet) bleibt jeder Abschnitt, wie er ist.
        const nurFelder = { felder: { ...s.felder, labelVisible: false }, form: undefined };
        expect(art.operation(LINIE, s, nurFelder, "op")).toEqual({
            operationId: "op",
            segments: [
                { id: A1, baseRevision: 3 },
                { id: A2, baseRevision: 5 },
            ],
            labelVisible: false,
        });
    });

    it("🔴 Herkunft (WI-0225): ein geändertes Feld mit Herkunft wiki geht als ↺, getippt als Wert; ↺ ist ein Griff der Art", () => {
        const s = start();
        const getippt = { ...s, felder: { ...s.felder, name: "Neu", herkunft: { name: "manual" as const } } };
        expect(art.operation(LINIE, s, getippt, "op")).toMatchObject({ name: "Neu" });
        const zurWiki = {
            ...s,
            felder: {
                ...s.felder,
                name: "Wikiname",
                description: "Wikitext",
                herkunft: { name: "wiki", description: "wiki" },
            },
        } satisfies KraftlinieStand;
        expect(art.operation(LINIE, s, zurWiki, "op")).toMatchObject({
            name: { revert: "wiki" },
            description: { revert: "wiki" },
        });
        expect(art.herkunft?.(zurWiki.felder, "name")).toBe("wiki");
        expect(art.aufWiki).toBeDefined();
    });

    it("🔴 ein leerer Name wird nicht geschrieben; eine geleerte Beschreibung schon (als null)", () => {
        const s = {
            ...start(),
            felder: { name: "Punin–Gareth", labelVisible: true, description: "alt", wiki: null, herkunft: {} },
        };
        const linie = { ...LINIE, description: "alt" };
        expect(art.operation(linie, s, { ...s, felder: { ...s.felder, name: "  " } }, "op")).toBeUndefined();
        expect(art.operation(linie, s, { ...s, felder: { ...s.felder, description: "" } }, "op")).toMatchObject({
            description: null,
        });
    });

    it("🔴 ein Ende an einen Nodix umhängen behält den Abschnitt; ein Ende ins Leere setzt nichts (R4)", () => {
        const s = start();
        const t = teil(s, A1);
        const ins: Aenderung = {
            art: "ziehen",
            stelle: { objekt: A1, nr: 0, index: 1 },
            teile: [{ ...t, punkte: [t.punkte[0]!, { x: 170, y: 170 }] }],
            mitgezogen: [],
            treffer: undefined,
            getrennt: false,
        };
        expect(formNach(s.form!, ins)).toBeUndefined();
        const an: Aenderung = {
            ...ins,
            teile: [{ ...t, punkte: [t.punkte[0]!, { x: 160, y: 140 }] }],
            treffer: {
                ziel: { art: "label", at: { x: 160, y: 140 }, objekt: NEU, name: "Arkanes Tor" },
                at: { x: 160, y: 140 },
                abstand: 2,
            },
        };
        const form = formNach(s.form!, an)!;
        expect(form.enden[A1]).toEqual({ from: GARETH, to: NEU });
        expect(art.operation(LINIE, s, { ...s, form }, "x")?.segments[0]).toEqual({ id: A1, baseRevision: 3, to: NEU });
    });

    it("🔴 auf einen neuen Stand: eigene Bögen und Felder bleiben, fremde kommen dazu, nichts Fremdes gilt als eigen", () => {
        const s = mitBogen({ ...start(), felder: { ...start().felder, name: "Neuer Name" } }, A1, 30);
        const fremd: EditorPowerlineDetail = {
            ...LINIE,
            description: "von Thomas",
            segments: [
                { ...LINIE.segments[0]!, revision: 4 },
                { ...LINIE.segments[1]!, curve: -7, revision: 6 },
            ],
        };
        expect(art.fremde(LINIE, fremd)).toEqual(["beschreibung", "form"]);
        const neu = art.aufNeuenStand(LINIE, fremd, s);
        expect(neu.felder).toEqual({
            name: "Neuer Name",
            labelVisible: true,
            description: "von Thomas",
            wiki: null,
            herkunft: {},
        });
        expect(teil(neu, A1).wert).toBe(30);
        expect(teil(neu, A2).wert).toBe(-7);
        // Geschrieben wird gegen den neuen Stand: der eigene Bogen und der Name, nicht der fremde Bogen.
        expect(art.operation(fremd, neu, neu, "op")).toEqual({
            operationId: "op",
            segments: [
                { id: A1, baseRevision: 4, curve: 30 },
                { id: A2, baseRevision: 6 },
            ],
            name: "Neuer Name",
        });
    });

    it("🔴 R5: Herausnehmen in der Mitte verbindet die Nachbarn (B–C–D ohne C ist B–D), der kleinere Abschnitt bleibt", () => {
        const raus = ohneKnoten(formAus(LINIE), PUNKT);
        expect("form" in raus).toBe(true);
        const form = (raus as { form: KraftlinieForm }).form;
        expect(form.enden).toEqual({ [A1]: { from: GARETH, to: PUNIN } });
        expect(form.teile.map((t) => [t.objekt, t.punkte, t.wert])).toEqual([
            [
                A1,
                [
                    { x: 100, y: 100 },
                    { x: 200, y: 100 },
                ],
                12,
            ],
        ]);
        // Fertig: der eine hängt um, der andere entfällt, in EINER Operation.
        expect(art.operation(LINIE, start(), { ...start(), form }, "op")).toEqual({
            operationId: "op",
            segments: [
                { id: A1, baseRevision: 3, to: PUNIN },
                { id: A2, baseRevision: 5, remove: true },
            ],
        });
    });

    it("🔴 R5: an einem Ende geht der Abschnitt mit; der letzte Abschnitt bleibt; ein fremder Knoten tut nichts", () => {
        const raus = ohneKnoten(formAus(LINIE), GARETH);
        expect((raus as { form: KraftlinieForm }).form.enden).toEqual({ [A2]: { from: PUNKT, to: PUNIN } });
        const einer = (raus as { form: KraftlinieForm }).form;
        expect(ohneKnoten(einer, PUNIN)).toEqual({ grund: "letzter" });
        expect(ohneKnoten(formAus(LINIE), NEU)).toEqual({ grund: "fremd" });
    });

    it("🔴 Nodix anfügen: ein neuer Abschnitt mit vorläufiger Kennung, „Fertig“ schreibt ihn als add, herausgenommen wieder weg", () => {
        const form = mitAbschnitt(
            formAus(LINIE),
            { id: PUNIN, x: 200, y: 100 },
            { id: NEU, name: "Arkanes Tor", kind: "label", x: 260, y: 90 },
            LINIE.name,
        )!;
        expect(form.enden["neu-1"]).toEqual({ from: PUNIN, to: NEU });
        expect(form.knoten?.[NEU]).toMatchObject({ name: "Arkanes Tor", kind: "label" });
        const s = start();
        expect(art.operation(LINIE, s, { ...s, form }, "op")).toMatchObject({ add: [{ from: PUNIN, to: NEU }] });
        expect(art.geaendert(LINIE, { ...s, form })).toEqual(["form"]);
        // Wieder herausgenommen: Der angefügte geht mit (Ende), nichts bleibt zu schreiben.
        const zurueck = (ohneKnoten(form, NEU) as { form: KraftlinieForm }).form;
        expect(art.operation(LINIE, s, { ...s, form: zurueck }, "op")).toBeUndefined();
        expect(
            mitAbschnitt(formAus(LINIE), { id: NEU, x: 0, y: 0 }, { id: NEU, name: "", kind: "nodix", x: 0, y: 0 }, ""),
        ).toBeUndefined();
    });

    it("die Sicherung im Browser: JSON hin und zurück; Kaputtes kommt nicht zurück", () => {
        const s = mitBogen(start(), A1, 5);
        const zurueck = art.sicherung!.ein(JSON.parse(JSON.stringify(art.sicherung!.aus(s))));
        expect(zurueck).toEqual(s);
        expect(art.sicherung!.ein({ felder: { name: 3 } })).toBeUndefined();
        expect(art.sicherung!.ein(null)).toBeUndefined();
    });
});
