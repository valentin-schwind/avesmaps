import { describe, expect, it } from "vitest";
import { AVENTURIA_SERIES, LEGAL_NOTICES } from "@avesmaps3d/shared";
import { nennungLage, nennungSchrift, nennungText, umbreche } from "../src/screenshot/nennung";

/** Die Nennung im Screenshot (WI-0274): Logo, Nennung der Kartenserie und Adresse der Fan-Richtlinie in jedem Bild. */

const ADRESSE = LEGAL_NOTICES.project.fanGuidelinesUri;
const miss = (text: string): number => text.length * 6;
/** 480 × 138, das DSA-Fanprojekt-Logo. */
const LOGO = 480 / 138;

describe("Der Text der Nennung", () => {
    const serie = AVENTURIA_SERIES.series[0];
    if (!serie) throw new Error("Katalog ohne Serie");

    it("🔴 nennt in jeder Serie das Fanprojekt und die Adresse der Fan-Richtlinie, nicht das Wiki", () => {
        expect(ADRESSE).toBe("https://ulisses-spiele.de/fan-richtlinie/");
        for (const s of AVENTURIA_SERIES.series) {
            for (const [deutsch, fan] of [
                [true, /Fanprojekt/],
                [false, /fan project/],
            ] as const) {
                const text = nennungText(s, deutsch);
                expect(text).toMatch(fan);
                expect(text).toContain(ADRESSE);
                expect(text).not.toContain("wiki-aventurica");
            }
        }
    });

    it("fällt bei einer Serie ohne Nennung auf die Vorgabe zurück, statt das Fanprojekt zu verlieren", () => {
        const leer = { attribution: " ", en: { ...serie.en, attribution: "" } };
        expect(nennungText(leer, true)).toMatch(/Fanprojekt/);
        expect(nennungText(leer, false)).toMatch(/fan project/);
    });
});

describe("Der Umbruch", () => {
    const text = nennungText(
        {
            attribution: "Kartenmaterial © Ulisses Spiele · Bearbeitung: Avesmaps",
            en: { origin: "", derivation: "", permission: "", attribution: "" },
        },
        true,
    );

    it("bleibt in einer Zeile, wenn Platz ist", () => {
        expect(umbreche(text, 10_000, miss)).toEqual([text]);
    });

    it("🔴 hält jede Zeile in der Breite und verliert kein Zeichen, auch bei schmalen Bildern", () => {
        for (const breite of [400, 240, 150, 90, 40]) {
            const zeilen = umbreche(text, breite, miss);
            for (const zeile of zeilen) expect(miss(zeile)).toBeLessThanOrEqual(breite);
            expect(zeilen.join("").replaceAll(" ", "")).toBe(text.replaceAll(" ", ""));
        }
    });

    it("beginnt keine Zeile mit dem Trenner", () => {
        for (const breite of [400, 240, 150]) {
            for (const zeile of umbreche(text, breite, miss)) expect(zeile.startsWith("·")).toBe(false);
        }
    });

    it("trennt die Adresse nur nach einem Schrägstrich, solange das Stück passt", () => {
        const zeilen = umbreche(ADRESSE, 120, miss);
        expect(zeilen.length).toBeGreaterThan(1);
        expect(zeilen.every((zeile) => zeile.endsWith("/"))).toBe(true);
        expect(zeilen.join("")).toBe(ADRESSE);
    });
});

describe("Die Lage von Logo und Text", () => {
    const text = nennungText(
        AVENTURIA_SERIES.series[0] ?? {
            attribution: "",
            en: { origin: "", derivation: "", permission: "", attribution: "" },
        },
        true,
    );
    const groß = { links: 100, rechts: 2400, unten: 1200 };

    it("🔴 steht unten rechts ganz in der Fläche, das Logo im Kasten und lesbar hoch", () => {
        for (const innen of [groß, { links: 0, rechts: 196, unten: 196 }]) {
            const lage = nennungLage(innen, text, 11, LOGO, miss);
            expect(lage.x + lage.w).toBeLessThan(innen.rechts);
            expect(lage.y + lage.h).toBeLessThan(innen.unten);
            expect(lage.x).toBeGreaterThanOrEqual(innen.links);
            expect(lage.logo).toBeDefined();
            expect(lage.logo?.h).toBeGreaterThanOrEqual(28);
            expect(lage.logo?.x ?? 0).toBeGreaterThanOrEqual(lage.x);
            expect((lage.logo?.y ?? 0) + (lage.logo?.h ?? 0)).toBeLessThanOrEqual(lage.y + lage.h);
        }
    });

    it("stellt das Logo neben den Text, wenn Platz ist, sonst darüber", () => {
        const breit = nennungLage(groß, text, 13, LOGO, miss);
        expect(breit.zeilen).toHaveLength(1);
        expect(breit.textX).toBeGreaterThan((breit.logo?.x ?? 0) + (breit.logo?.w ?? 0));

        const schmal = nennungLage({ links: 0, rechts: 196, unten: 196 }, text, 11, LOGO, miss);
        expect(schmal.textX).toBe(schmal.logo?.x);
        expect(schmal.textY).toBeGreaterThan((schmal.logo?.y ?? 0) + (schmal.logo?.h ?? 0));
    });

    it("kommt ohne Logo aus, wenn es nicht geladen werden konnte", () => {
        const lage = nennungLage(groß, text, 13, undefined, miss);
        expect(lage.logo).toBeUndefined();
        expect(lage.textX).toBe(lage.x + 5);
    });
});

describe("Die Schriftgröße", () => {
    it("ist wie der Rahmen 11 px und wächst in großen Bildern bis 16 px", () => {
        expect(nennungSchrift(320, 180)).toBe(11);
        expect(nennungSchrift(2300, 1170)).toBe(13);
        expect(nennungSchrift(9000, 9000)).toBe(16);
    });
});
