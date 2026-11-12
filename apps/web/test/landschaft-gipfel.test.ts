import { describe, expect, it, vi } from "vitest";
import type { EditorPeakDetail } from "@avesmaps3d/shared";
import { createGipfelArt, gipfelFelder } from "../src/landschaftseditor/gipfel-art.ts";
import { createLandmarkeSetzen } from "../src/landschaftseditor/landmarke-setzen.ts";
import { LANDMARKE, ORT } from "../src/map/geometrie/arten.ts";

// Der Modus des Geometrie-Moduls braucht eine Karte; hier zählt nur, was das Setzen mit ihm tut.
const modus = vi.hoisted(() => ({
    eingabe: undefined as undefined | { handbewegung: (a: unknown) => void; teile: () => unknown[] },
    aus: vi.fn(),
    sperre: vi.fn(),
    aktualisiere: vi.fn(),
}));
vi.mock("../src/map/geometrie/modus.ts", () => ({
    installGeometrieModus: (_map: unknown, _interaction: unknown, eingabe: typeof modus.eingabe) => {
        modus.eingabe = eingabe;
        return {
            aus: modus.aus,
            sperre: modus.sperre,
            aktualisiere: modus.aktualisiere,
            markiere: vi.fn(),
            abbrechen: vi.fn(),
        };
    },
}));

/**
 * Der Gipfel als Art des Fensterrumpfs (WI-0178 P2, EDIT-0003 T55): Name, Höhe, Anzeige und Lage im EINEN Entwurf, „Fertig“ als EINE
 * Operation `peak.update`. Ohne Server.
 */
const D: EditorPeakDetail = {
    id: "c8c8c8c8-0000-4000-8000-000000000001",
    name: "Probezinne",
    subtype: "berggipfel",
    height: 3200,
    showName: true,
    position: [530, 515],
    revision: 4,
};

describe("Gipfel im Fensterrumpf (P2)", () => {
    const art = createGipfelArt({ lies: vi.fn(), schreibe: vi.fn(), lege: vi.fn(), entferne: vi.fn() });
    const stand = (felder: Partial<ReturnType<typeof gipfelFelder>>) => ({
        felder: { ...gipfelFelder(D), ...felder },
        form: undefined,
    });

    it("🔴 „Fertig“ schreibt nur, was sich änderte, gegen die Revision; ohne Änderung nichts", () => {
        const start = stand({});
        expect(art.operation(D, start, stand({}), "op")).toBeUndefined();
        expect(art.operation(D, start, stand({ hoehe: 3400, x: 531, y: 516 }), "op")).toEqual({
            operationId: "op",
            baseRevision: 4,
            changes: { height: 3400, position: [531, 516] },
        });
        expect(art.operation(D, start, stand({ name: " Hohe Zinne ", anzeigen: false }), "op")?.changes).toEqual({
            name: "Hohe Zinne",
            showName: false,
        });
        expect(art.geaendert(D, stand({ hoehe: 1, x: 0 }))).toEqual(["hoehe", "lage"]);
    });

    it("ein leerer Name und eine Höhe außerhalb der Grenzen sperren „Fertig“ mit Grund", () => {
        expect(art.pruefe?.(D, stand({}))).toBeUndefined();
        expect(art.pruefe?.(D, stand({ name: "  " }))).toBeTruthy();
        expect(art.pruefe?.(D, stand({ hoehe: 70000 }))).toBeTruthy();
        expect(art.pruefe?.(D, stand({ hoehe: 12.5 }))).toBeTruthy();
    });

    it("🔴 Konflikt: die eigenen Änderungen auf den neuen Stand, alles andere vom neuen Stand", () => {
        const jetzt: EditorPeakDetail = { ...D, name: "Fremdname", height: 2900, revision: 5 };
        const neu = art.aufNeuenStand(D, jetzt, stand({ hoehe: 3500 }));
        expect(neu.felder).toEqual({
            name: "Fremdname",
            art: "berggipfel",
            merkmale: [],
            hoehe: 3500,
            anzeigen: true,
            x: 530,
            y: 515,
        });
        expect(art.fremde(D, jetzt)).toEqual(["name", "hoehe"]);
    });

    it("die Sicherung im Browser nimmt nur einen vollständigen Stand", () => {
        const s = stand({ hoehe: 3333 });
        expect(art.sicherung?.ein(art.sicherung.aus(s))).toEqual(s);
        expect(art.sicherung?.ein({ felder: { name: "x" } })).toBeUndefined();
    });
});

describe("Landmarkenart und Merkmale im Entwurf (WI-0271 L4)", () => {
    const art = createGipfelArt({ lies: vi.fn(), schreibe: vi.fn(), lege: vi.fn(), entferne: vi.fn() });
    const stand = (felder: Partial<ReturnType<typeof gipfelFelder>>) => ({
        felder: { ...gipfelFelder(D), ...felder },
        form: undefined,
    });

    it("🔴 ein Wechsel zu einer Art ohne Gelände schickt keine Höhe (der Server leert sie); Merkmale in der Folge des Katalogs", () => {
        const start = stand({});
        expect(art.operation(D, start, stand({ art: "hoehle", hoehe: 3200 }), "op")?.changes).toEqual({
            subtype: "hoehle",
        });
        expect(art.operation(D, start, stand({ merkmale: ["verborgen", "heilig"] }), "op")?.changes).toEqual({
            merkmale: ["heilig", "verborgen"],
        });
        // Zurück zum Berggipfel mit Höhe: die Höhe geht mit.
        const hoehle: EditorPeakDetail = {
            id: D.id,
            name: D.name,
            subtype: "hoehle",
            merkmale: ["heilig"],
            showName: D.showName,
            position: D.position,
            revision: D.revision,
        };
        expect(
            art.operation(
                hoehle,
                stand({ art: "hoehle", hoehe: undefined }),
                stand({ art: "berggipfel", hoehe: 900 }),
                "op",
            )?.changes,
        ).toEqual({ subtype: "berggipfel", height: 900 });
        // Dieselben Merkmale in anderer Folge sind keine Änderung.
        expect(
            art.geaendert(hoehle, { felder: { ...gipfelFelder(hoehle), merkmale: ["heilig"] }, form: undefined }),
        ).toEqual([]);
    });

    it("eine Höhe außerhalb der Grenzen sperrt nur bei Berg und Vulkan", () => {
        expect(art.pruefe?.(D, stand({ hoehe: 70000 }))).toBeTruthy();
        expect(art.pruefe?.(D, stand({ art: "quelle", hoehe: 70000 }))).toBeUndefined();
    });

    it("die Sicherung nimmt nur einen Stand mit bekannter Art", () => {
        const s = stand({ art: "grotte", merkmale: ["magisch"] });
        expect(art.sicherung?.ein(art.sicherung.aus(s))).toEqual(s);
        expect(art.sicherung?.ein({ felder: { ...s.felder, art: "pass" } })).toBeUndefined();
    });
});

describe("EINE Punkt-Strategie (WI-0271 L4)", () => {
    it("Ort und Landmarke sind dieselbe Art mit einer Option: nur der Ort rastet an Wegenden ein und zieht sie mit", () => {
        expect([ORT.teilart, LANDMARKE.teilart]).toEqual(["punkt", "punkt"]);
        expect([ORT.mitziehen, LANDMARKE.mitziehen]).toEqual([true, false]);
        const stelle = { objekt: "x", nr: 0, index: 0 };
        const teil = { objekt: "x", name: "x", nr: 0, art: "punkt" as const, punkte: [{ x: 1, y: 1 }], revision: 1 };
        expect([ORT.ziele(stelle, teil), LANDMARKE.ziele(stelle, teil)]).toEqual([["ecke"], []]);
        expect([ORT.loesen, LANDMARKE.loesen]).toEqual([undefined, false]);
    });
});

describe("„▲ Landmarke setzen ›“ (WI-0271 L4, G4: gespeichert erst mit „Fertig“)", () => {
    const quittung = {
        operationId: "op-1",
        status: "applied" as const,
        environment: "development" as const,
        affected: [{ kind: "peak", id: "c8c8c8c8-0000-4000-8000-000000000009", revision: 1 }],
        derivedWork: [],
        warnings: [],
        mapRevision: 4711,
        publicId: "c8c8c8c8-0000-4000-8000-000000000009",
        name: "Gipfel-007",
    };

    const karte = () => ({ map: {} as never, interaction: {} as never });

    it("🔴 der Start legt nichts an; Ziehen verschiebt den Punkt; „Fertig“ legt ihn als EINE Operation an und öffnet sein Fenster", async () => {
        const lege = vi.fn(() => Promise.resolve({ ok: true as const, quittung }));
        const geaendert = vi.fn();
        const gesetzt = vi.fn();
        const melde = vi.fn();
        const setzer = createLandmarkeSetzen({
            karte,
            daten: { lege },
            fangradius: () => 12,
            geaendert,
            gesetzt,
            melde,
            neueKennung: () => "op-1",
        });
        setzer.starte("hoehle", { x: 512.5, y: 640 });
        expect(setzer.laufend.value).toEqual({ art: "hoehle", x: 512.5, y: 640, sendet: false });
        expect(lege).not.toHaveBeenCalled();
        modus.eingabe?.handbewegung({ art: "ziehen", teile: [{ punkte: [{ x: 520, y: 650 }] }] });
        expect(setzer.laufend.value).toMatchObject({ x: 520, y: 650 });
        expect(await setzer.fertig()).toBe(true);
        expect(lege).toHaveBeenCalledTimes(1);
        expect(lege).toHaveBeenCalledWith({ operationId: "op-1", position: [520, 650], subtype: "hoehle" });
        expect(geaendert).toHaveBeenCalledWith(4711);
        expect(gesetzt).toHaveBeenCalledWith({ publicId: quittung.publicId, name: "Gipfel-007" });
        expect(melde).toHaveBeenCalledWith(expect.stringContaining("Gipfel-007"), "success");
        expect(setzer.laufend.value).toBeUndefined();
        expect(modus.aus).toHaveBeenCalled();
    });

    it("🔴 WI-0271 L7: aus einem Wiki-Kandidaten trägt der Entwurf den Kandidaten, und „Fertig“ schickt `wikiKandidat` mit", async () => {
        const lege = vi.fn(() =>
            Promise.resolve({ ok: true as const, quittung: { ...quittung, name: "Drachenhöhle" } }),
        );
        const setzer = createLandmarkeSetzen({
            karte,
            daten: { lege },
            fangradius: () => 12,
            geaendert: vi.fn(),
            gesetzt: vi.fn(),
            melde: vi.fn(),
            neueKennung: () => "op-2",
        });
        const kandidat = { id: "b7000000-0000-4000-8000-000000000001", name: "Drachenhöhle" };
        setzer.starte("hoehle", { x: 500, y: 600 }, kandidat);
        expect(setzer.laufend.value).toEqual({ art: "hoehle", x: 500, y: 600, sendet: false, kandidat });
        expect(await setzer.fertig()).toBe(true);
        expect(lege).toHaveBeenCalledWith({
            operationId: "op-2",
            position: [500, 600],
            subtype: "hoehle",
            wikiKandidat: kandidat.id,
        });
    });

    it("„Verwerfen“ lässt nichts zurück; ein Fehler des Servers kommt als Hinweis, der Entwurf bleibt", async () => {
        const lege = vi.fn(() =>
            Promise.resolve({
                ok: false as const,
                status: 400,
                fehler: { code: "validation_failed", message: "Der Gipfel liegt außerhalb der Karte." },
            }),
        );
        const gesetzt = vi.fn();
        const melde = vi.fn();
        const setzer = createLandmarkeSetzen({
            karte,
            daten: { lege },
            fangradius: () => 12,
            geaendert: vi.fn(),
            gesetzt,
            melde,
        });
        setzer.starte("quelle", { x: -5, y: -5 });
        expect(await setzer.fertig()).toBe(false);
        expect(gesetzt).not.toHaveBeenCalled();
        expect(melde).toHaveBeenCalledWith("Der Gipfel liegt außerhalb der Karte.", "warning");
        expect(setzer.laufend.value).toMatchObject({ art: "quelle", sendet: false });
        expect(setzer.verwerfe()).toBe(true);
        expect(setzer.laufend.value).toBeUndefined();
        expect(setzer.verwerfe()).toBe(false);
        expect(lege).toHaveBeenCalledTimes(1);
    });
});
