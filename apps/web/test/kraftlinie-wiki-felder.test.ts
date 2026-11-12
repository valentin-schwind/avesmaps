import { describe, expect, it } from "vitest";
import type { EditorPowerlineDetail, WikiArtikel } from "@avesmaps3d/shared";
import type { KraftlinieFelder } from "../src/kraftlinieneditor/kraftlinie-art";
import {
    allesAufWiki,
    aufWiki,
    eigeneWerte,
    herkunftDerLinie,
    kraftlinieWikiLage,
    nurWiki,
    wikiFelderAus,
} from "../src/kraftlinieneditor/kraftlinie-wiki-felder";

/**
 * Die Wiki-Felder der Kraftlinie (WI-0205 an WI-0225, Design Guide §13.8, Modell c mit Herkunft je Abschnitt). Problemfälle: ohne Artikel
 * streicht etwas durch; eine leere eigene Beschreibung heißt „weicht ab“, obwohl Besucher den Wiki-Text sehen (Legacy: „Handgetipptes
 * schlägt Wiki“); ↺ setzt einen leeren Namen oder vergisst die Herkunft; ein Abschnitt mit manual zählt als „folgt dem Wiki“; was nur das
 * Wiki führt, bekommt ein ↺; ein leerer Wiki-Wert steht als Zeile da.
 */

const ARTIKEL: WikiArtikel = {
    key: "basiliuslinie",
    url: "https://de.wiki-aventurica.de/wiki/Basiliuslinie",
    name: "Basiliuslinie",
    werte: {
        name: "Basiliuslinie",
        description: "Die Basiliuslinie ist eine mächtige Kraftlinie.",
        staerke: "kontinental",
        affinitaet: null,
        laenge: "",
        regionen: "Kosch · Almada",
    },
};

const felder = (teil: Partial<KraftlinieFelder> = {}): KraftlinieFelder => ({
    name: "Basiliuslinie",
    labelVisible: true,
    description: "",
    wiki: ARTIKEL,
    herkunft: {},
    ...teil,
});

const linie = (teil: Partial<EditorPowerlineDetail> = {}): EditorPowerlineDetail => ({
    id: "c8c8c8c8-0000-4000-8000-000000000001",
    name: "Basiliuslinie",
    circle: "voll",
    shape: "strang",
    segments: [
        {
            id: "c8c8c8c8-0000-4000-8000-000000000001",
            from: "a",
            to: "b",
            curve: null,
            labelVisible: true,
            revision: 1,
        },
        {
            id: "c8c8c8c8-0000-4000-8000-000000000002",
            from: "b",
            to: "c",
            curve: null,
            labelVisible: true,
            revision: 1,
        },
    ],
    nodes: [],
    article: ARTIKEL,
    ...teil,
});

describe("Wiki-Felder der Kraftlinie", () => {
    it("🔴 ohne Artikel haben Name und Beschreibung kein Gegenstück, und nichts steht nur lesend da", () => {
        const ohne = felder({ wiki: null, description: "Eigener Text" });
        expect(kraftlinieWikiLage(ohne, "name").zustand).toBe("ohne");
        expect(kraftlinieWikiLage(ohne, "description").zustand).toBe("ohne");
        expect(eigeneWerte(ohne)).toBe(0);
        expect(nurWiki(ohne)).toEqual([]);
    });

    it("🔴 die Herkunft der Linie: wiki nur, wenn alle Abschnitte wiki tragen; ein manual macht manual", () => {
        const [a, b] = linie().segments;
        expect(
            herkunftDerLinie(
                linie({
                    segments: [
                        { ...a!, herkunft: { name: "wiki" } },
                        { ...b!, herkunft: { name: "wiki" } },
                    ],
                }),
            ),
        ).toEqual({ name: "wiki" });
        expect(
            herkunftDerLinie(
                linie({
                    segments: [
                        { ...a!, herkunft: { name: "wiki" } },
                        { ...b!, herkunft: { name: "manual" } },
                    ],
                }),
            ),
        ).toEqual({ name: "manual" });
        expect(herkunftDerLinie(linie({ segments: [{ ...a!, herkunft: { name: "wiki" } }, b!] }))).toEqual({});
    });

    it("🔴 der Name: gleich ist still, abweichend braun mit ↺; ↺ setzt den Wiki-Namen und die Herkunft wiki", () => {
        expect(kraftlinieWikiLage(felder(), "name")).toMatchObject({ zustand: "gleich", zurueck: false });
        expect(kraftlinieWikiLage(felder({ herkunft: { name: "wiki" } }), "name").zustand).toBe("folgt");
        const anders = felder({ name: "Elfenfaden", herkunft: { name: "manual" } });
        expect(kraftlinieWikiLage(anders, "name")).toMatchObject({
            zustand: "weicht",
            wikiText: "Basiliuslinie",
            zurueck: true,
        });
        const zurueck = aufWiki(anders, "name");
        expect(zurueck).toMatchObject({ name: "Basiliuslinie", herkunft: { name: "wiki" } });
        expect(kraftlinieWikiLage(zurueck, "name").zustand).toBe("folgt");
    });

    it("🔴 kennt das Wiki keinen Namen, ist er unbekannt: ↺ setzt keinen leeren Namen", () => {
        const ohneName = felder({ name: "Elfenfaden", wiki: { ...ARTIKEL, werte: { ...ARTIKEL.werte, name: null } } });
        expect(kraftlinieWikiLage(ohneName, "name").zustand).toBe("unbekannt");
        expect(aufWiki(ohneName, "name")).toBe(ohneName);
    });

    it("🔴 eine leere eigene Beschreibung folgt dem Wiki: der Entwurf führt den Wiki-Text mit Herkunft wiki, ↺ still", () => {
        const aus = wikiFelderAus(linie());
        expect(aus).toMatchObject({
            description: "Die Basiliuslinie ist eine mächtige Kraftlinie.",
            herkunft: { description: "wiki" },
        });
        const lage = kraftlinieWikiLage(felder(aus), "description");
        expect(lage).toMatchObject({ zustand: "folgt", zurueck: false });
        expect(eigeneWerte(felder(aus))).toBe(0);
    });

    it("🔴 eine eigene Beschreibung weicht ab; ↺ setzt den Wiki-Text mit Herkunft wiki", () => {
        const aus = wikiFelderAus(
            linie({
                description: "Auch Elfenfaden genannt.",
                segments: linie().segments.map((a) => ({ ...a, herkunft: { description: "manual" } })),
            }),
        );
        expect(aus).toMatchObject({ description: "Auch Elfenfaden genannt.", herkunft: { description: "manual" } });
        const eigen = felder(aus);
        expect(kraftlinieWikiLage(eigen, "description")).toMatchObject({ zustand: "weicht", zurueck: true });
        const zurueck = aufWiki(eigen, "description");
        expect(zurueck).toMatchObject({
            description: "Die Basiliuslinie ist eine mächtige Kraftlinie.",
            herkunft: { description: "wiki" },
        });
        expect(kraftlinieWikiLage(zurueck, "description").zustand).toBe("folgt");
    });

    it("🔴 kennt das Wiki keine Beschreibung, steht „(leer)“ durchgestrichen hinter einer eigenen; ↺ leert sie", () => {
        const ohneText = felder({
            description: "Eigener Text",
            wiki: { ...ARTIKEL, werte: { ...ARTIKEL.werte, description: null } },
        });
        expect(kraftlinieWikiLage(ohneText, "description")).toMatchObject({ zustand: "weicht", wikiText: null });
        expect(aufWiki(ohneText, "description")).toMatchObject({ description: "", herkunft: { description: "wiki" } });
    });

    it("🔴 ohne Schreibrecht lesend: kein ↺, der abweichende Wiki-Wert bleibt als Auskunft", () => {
        const lage = kraftlinieWikiLage(felder({ name: "Elfenfaden" }), "name", true);
        expect(lage).toMatchObject({ zustand: "lesend", abweichend: true, wikiText: "Basiliuslinie", zurueck: false });
        expect(lage.mitZurueck).toBe(false);
    });

    it("🔴 „↺ Alles auf Wiki-Werte“ zählt beide Felder und setzt beide in EINEM Aufruf", () => {
        const beide = felder({ name: "Elfenfaden", description: "Eigener Text", herkunft: { name: "manual" } });
        expect(eigeneWerte(beide)).toBe(2);
        const zurueck = allesAufWiki(beide);
        expect(zurueck).toMatchObject({
            name: "Basiliuslinie",
            description: "Die Basiliuslinie ist eine mächtige Kraftlinie.",
            herkunft: { name: "wiki", description: "wiki" },
        });
        expect(eigeneWerte(zurueck)).toBe(0);
    });

    it("🔴 was nur das Wiki führt, steht lesend ohne ↺; ein leerer Wert fehlt", () => {
        const werte = nurWiki(felder());
        expect(werte.map((w) => [w.schluessel, w.wert])).toEqual([
            ["staerke", "kontinental"],
            ["regionen", "Kosch · Almada"],
        ]);
        for (const w of werte)
            expect(w.lage).toMatchObject({ zustand: "lesend", mitZurueck: false, abweichend: false });
    });
});
