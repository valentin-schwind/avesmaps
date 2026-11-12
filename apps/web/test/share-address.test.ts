import { describe, expect, it } from "vitest";
import { readObjectLink } from "@avesmaps3d/shared";
import { shareAddress, wikiPageOf } from "../src/info-panel/share-address.ts";

/**
 * „Link teilen“ (WI-0063 P6; Legacy `buildShareLinkPath`, `js/map-features/map-features-share-pin.js`): die Adresse, die dasselbe Subject wieder öffnet -
 * dieselbe, auf die die Wiki Aventurica verlinkt (AGENTS.md „Links von Legacy bleiben gültig“).
 */

const BASE = "https://avesmaps.test/";
const ID = "80558060-4299-54aa-b520-814b10819885";

describe("🔴 Legacys Parameter je Art, mit dem Seitenteil der Wiki-Adresse", () => {
    it("Ort `siedlung`, Gebiet `staat`, Landschaft und Gipfel `region`, Weg `strasse`, Fluss und Seeweg `fluss`", () => {
        const wikiUrl = "https://de.wiki-aventurica.de/wiki/Gareth";
        expect(shareAddress(BASE, { kind: "place", id: ID }, { wikiUrl })).toBe(`${BASE}?siedlung=Gareth`);
        expect(shareAddress(BASE, { kind: "territory", id: ID }, { wikiUrl })).toBe(`${BASE}?staat=Gareth`);
        expect(shareAddress(BASE, { kind: "area", id: ID }, { wikiUrl })).toBe(`${BASE}?region=Gareth`);
        expect(shareAddress(BASE, { kind: "peak", id: ID }, { wikiUrl })).toBe(`${BASE}?region=Gareth`);
        expect(
            shareAddress(
                BASE,
                { kind: "path", chain: "Gardel:Reichsstrasse" },
                { wikiUrl, pathSubtype: "Reichsstrasse" },
            ),
        ).toBe(`${BASE}?strasse=Gareth`);
        expect(
            shareAddress(BASE, { kind: "path", chain: "Gardel:Flussweg" }, { wikiUrl, pathSubtype: "Flussweg" }),
        ).toBe(`${BASE}?fluss=Gareth`);
        expect(shareAddress(BASE, { kind: "path", chain: "Meer:Seeweg" }, { wikiUrl, pathSubtype: "Seeweg" })).toBe(
            `${BASE}?fluss=Gareth`,
        );
    });

    it("die Prozentkodierung des Seitenteils bleibt, wie Legacy sie lässt", () => {
        expect(wikiPageOf("https://de.wiki-aventurica.de/wiki/Al%27Anfa")).toBe("Al%27Anfa");
        expect(wikiPageOf("https://de.wiki-aventurica.de/wiki/K%C3%B6nigreich_Garetien?action=raw#x")).toBe(
            "K%C3%B6nigreich_Garetien",
        );
        expect(wikiPageOf("https://de.wiki-aventurica.de/")).toBeUndefined();
        expect(wikiPageOf(undefined)).toBeUndefined();
    });

    it("🔴 die Adresse ist ein Objektlink, den die Anwendung selbst wieder liest - mit demselben Schlüssel", () => {
        const url = new URL(
            shareAddress(
                BASE,
                { kind: "place", id: ID },
                { wikiUrl: "https://de.wiki-aventurica.de/wiki/Al%27Anfa" },
            ) ?? "",
        );
        expect(readObjectLink((name) => url.searchParams.get(name))).toMatchObject({
            param: "siedlung",
            value: "Al'Anfa",
        });
    });
});

describe("ohne Wiki-Adresse: `place` nur, wo Legacy es tat", () => {
    it("ein Ort und ein Gipfel teilen über ihre Kennung", () => {
        expect(shareAddress(BASE, { kind: "place", id: ID })).toBe(`${BASE}?place=${ID}`);
        expect(shareAddress(BASE, { kind: "peak", id: ID })).toBe(`${BASE}?place=${ID}`);
    });

    it("🔴 Gebiet, Landschaft und Weg ohne Wiki-Adresse haben keinen Link (kein `?place=`-Rückfall: Er löst nur Orte und Labels auf)", () => {
        expect(shareAddress(BASE, { kind: "territory", id: ID })).toBeUndefined();
        expect(shareAddress(BASE, { kind: "area", id: ID })).toBeUndefined();
        expect(shareAddress(BASE, { kind: "path", chain: "Gardel:Flussweg" })).toBeUndefined();
    });

    it("eine Kraftlinie hat keinen Link, auch mit Wiki-Adresse; Etappe und Klima auch nicht", () => {
        const wikiUrl = "https://de.wiki-aventurica.de/wiki/Arteria_Magica";
        expect(shareAddress(BASE, { kind: "powerline", anchor: ID }, { wikiUrl })).toBeUndefined();
        expect(shareAddress(BASE, { kind: "routeStage", index: 0, routeKey: "a~b" })).toBeUndefined();
        expect(shareAddress(BASE, { kind: "climate", band: "tropisch" })).toBeUndefined();
    });
});

describe("eine freie Kartenstelle teilt `?pin=` in Legacys Reihenfolge", () => {
    it("lat vor lng, also y vor x, mit drei Stellen", () => {
        expect(shareAddress(BASE, { kind: "mapPoint", x: 551.6, y: 520.5 })).toBe(`${BASE}?pin=520.500,551.600`);
    });
});
