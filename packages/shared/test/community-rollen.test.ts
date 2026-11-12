import { describe, expect, it } from "vitest";
import { SONDERROLLEN_NAMEN } from "../src/auth/sonderrollen.ts";
import {
    ROLLEN_JE_ART,
    artDesObjekts,
    leseRollenGlocke,
    rollenDesBezugs,
    rollenGlockeDazu,
    rollenGlockeText,
    type RollenGlocke,
} from "../src/community-rollen.ts";
import { FEHLT_ARTEN } from "../src/community.ts";

/** Die Tafel „Zuweisen beim Eingang“ und der Text der Glocke `community_rolle` (WI-0279; Vali 2026-11-11). */
describe("Meldungen an Sonderrollen", () => {
    it("🔴 die Tafel nennt nur Rollen des Katalogs und kennt jede Art des Meldeformulars", () => {
        for (const rollen of Object.values(ROLLEN_JE_ART))
            for (const rolle of rollen) expect(SONDERROLLEN_NAMEN).toContain(rolle);
        // Jede Art, die das Meldeformular kennt (seit 0338 auch Insel, Landschaft, Herrschaft, Sprache), steht in der Tafel.
        for (const art of FEHLT_ARTEN) expect(Object.keys(ROLLEN_JE_ART)).toContain(art);
        expect(rollenDesBezugs(null, "insel")).toEqual(["derograph", "topograph"]);
        expect(rollenDesBezugs(null, "sprache")).toEqual(["linguist"]);
    });

    it("die Art eines Objekts: Flussweg ist Fluss, Seeweg Gewässer, Flächen nach Typ, Gipfel ist Gebirge", () => {
        expect(artDesObjekts("place", "Stadt")).toBe("ort");
        expect(artDesObjekts("path", "Flussweg")).toBe("fluss");
        expect(artDesObjekts("path", "Seeweg")).toBe("gewaesser");
        expect(artDesObjekts("path", "Reichsstrasse")).toBe("weg");
        expect(artDesObjekts("area", "gebirge")).toBe("gebirge");
        expect(artDesObjekts("area", "Huegelland")).toBe("gebirge");
        expect(artDesObjekts("area", "inselgruppe")).toBe("insel");
        expect(artDesObjekts("area", "see")).toBe("gewaesser");
        expect(artDesObjekts("area", "wald")).toBe("landschaft");
        expect(artDesObjekts("area", null)).toBe("landschaft");
        expect(artDesObjekts("territory", null)).toBe("herrschaft");
        expect(artDesObjekts("peak", "berggipfel")).toBe("gebirge");
        expect(artDesObjekts("powerline", null)).toBe("kraftlinie");
    });

    it("Objekt und „Etwas fehlt“ ergeben die Vereinigung, in der Folge des Katalogs", () => {
        expect(rollenDesBezugs(null, "fluss")).toEqual(["derograph", "odologe"]);
        expect(rollenDesBezugs({ objektArt: "peak", typ: null }, "gewaesser")).toEqual(["derograph", "topograph"]);
        expect(rollenDesBezugs({ objektArt: "territory", typ: null }, null)).toEqual(["politologe", "regionalkanzler"]);
        expect(rollenDesBezugs({ objektArt: "place", typ: "Dorf" }, "anderes")).toEqual([]);
        expect(rollenDesBezugs(null, "unbekannt")).toEqual([]);
    });

    it("🔴 der Text der Glocke: Rolle und Nummern, gebündelt ohne Doppelte, nie über 300 Zeichen", () => {
        const eins = { rolle: "derograph", nummern: ["COM-000072"], anzahl: 1 };
        expect(rollenGlockeText(eins)).toBe("derograph COM-000072");
        expect(leseRollenGlocke("derograph COM-000072")).toEqual(eins);
        const zwei = rollenGlockeDazu(eins, "COM-000075");
        expect(rollenGlockeText(zwei)).toBe("derograph COM-000072 COM-000075");
        expect(rollenGlockeDazu(zwei, "COM-000075")).toBe(zwei);
        let viele: RollenGlocke = eins;
        for (let i = 100; i < 160; i += 1) viele = rollenGlockeDazu(viele, `COM-000${String(i)}`);
        expect(rollenGlockeText(viele).length).toBeLessThanOrEqual(300);
        expect(viele.anzahl).toBe(61);
        expect(leseRollenGlocke(rollenGlockeText(viele))).toEqual(viele);
        // Was kein solcher Text ist, liest sich nicht.
        expect(leseRollenGlocke("COM-000072")).toBeUndefined();
        expect(leseRollenGlocke("derograph")).toBeUndefined();
        expect(leseRollenGlocke(null)).toBeUndefined();
    });
});
