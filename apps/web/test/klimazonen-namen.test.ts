import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@avesmaps3d/shared";
import { locale, LOCALES, t, type MessageKey } from "../src/i18n/i18n.ts";
import { CLIMATE_ZONE_KEYS, climateZoneKeysMatching, climateZoneName } from "../src/map/climate-zones.ts";
import { fetchSearch, hitName } from "../src/search/search-client.ts";

/**
 * Die Namen der acht Klimazonen (WI-0171, Betreiber 2026-10-15: „übersetzen, auch der Name vom Server“).
 *
 * 🔴 Geprüft wird die eine Regel: WELCHE Zone es ist, sagt der Schlüssel der Daten - WIE sie heißt, die Sprachtafel.
 * Der deutsche `label` des Servers bleibt der Stamm und der Rückfall, nie der angezeigte Name.
 */

afterEach(() => {
    locale.value = "de";
    vi.unstubAllGlobals();
});

describe("Der Name einer Klimazone", () => {
    it("🔴 kommt aus der Sprachtafel, nicht vom Server", () => {
        locale.value = "de";
        expect(climateZoneName("gemaessigt", "Vom Server")).toBe(t("climate.zone.gemaessigt"));
        locale.value = "nl";
        expect(climateZoneName("gemaessigt", "Vom Server")).toBe(t("climate.zone.gemaessigt"));
    });

    it("🪤 fällt auf den Namen des Servers zurück, und ohne ihn auf den lesbaren Schlüssel", () => {
        // Eine neunte Zone, die die Tafel nicht kennt: erfunden wird nichts.
        expect(climateZoneName("aequatorial", "Äquatoriale Zone")).toBe("Äquatoriale Zone");
        expect(climateZoneName("aequatorial")).toBe("aequatorial");
        expect(climateZoneName("sehr_feucht")).toBe("sehr feucht");
        expect(climateZoneName("aequatorial", null)).toBe("aequatorial");
    });

    it("🔴 jede der acht Zonen der Karte hat einen Satz in der Tafel", () => {
        expect(CLIMATE_ZONE_KEYS).toHaveLength(8);
        for (const band of CLIMATE_ZONE_KEYS) {
            // Ohne Satz käme der lesbare Schlüssel zurück - und der trägt kein Leerzeichen weniger als der Schlüssel.
            expect(climateZoneName(band), band).not.toBe(band.replace(/_/g, " "));
        }
    });
});

describe("Jede Tafel nennt die Zonen in ihrer eigenen Sprache", () => {
    const schluessel = (band: string): MessageKey => `climate.zone.${band}` as MessageKey;

    const namenIn = (sprache: (typeof LOCALES)[number]): string[] => {
        locale.value = sprache;
        return CLIMATE_ZONE_KEYS.map((band) => t(schluessel(band)));
    };

    /**
     * 🔴 **Der Wächter in der NEUEN Richtung** (WI-0171): Seit dem Betreiberentscheid vom 2026-10-15 ist eine Tafel
     * falsch, die hier den DEUTSCHEN Wortlaut trägt - das Gegenstück zu „`lang.name.*` ist in allen Tafeln gleich“.
     *
     * 💣 Vorher sah das niemand: Der Typ erzwingt, dass jede Tafel jeden SCHLÜSSEL trägt, nie, in welcher Sprache
     * sein Text steht. Genau so blieben `en`, `nl`, `it` und `es` monatelang auf dem deutschen Wortlaut stehen,
     * während `fr` schon übersetzt war - und die Zonentabelle im ⓘ nannte eine Zone anders als die Karte daneben.
     *
     * 🪤 Der Fall läuft über `LOCALES`, nicht über eine Liste hier: Eine siebte Tafel ist damit vom ersten Tag an
     * mitgeprüft. Eine Sprache, die eine Zone wirklich wie das Deutsche nennt, braucht hier eine benannte Ausnahme -
     * und bis dahin ist die Gleichheit ein Befund, keine Übersetzung.
     */
    it("🔴 keine Tafel trägt an diesen acht Zeilen den deutschen Wortlaut", () => {
        const deutsch = namenIn("de");
        for (const sprache of LOCALES.filter((eine) => eine !== "de")) {
            const eigene = namenIn(sprache);
            const gleich = eigene.filter((name, index) => name === deutsch[index]);
            expect(gleich, `${sprache}: diese Zonen stehen noch deutsch da`).toEqual([]);
        }
    });

    it("🔴 und in jeder Tafel heißt jede Zone anders als ihre Nachbarn", () => {
        for (const sprache of LOCALES) {
            const eigene = namenIn(sprache);
            expect(new Set(eigene).size, `${sprache}: zwei Zonen tragen denselben Namen`).toBe(
                CLIMATE_ZONE_KEYS.length,
            );
        }
    });

    it("🪤 die Namen tragen keine Leerzeichen an den Rändern und keine leeren Werte", () => {
        for (const sprache of LOCALES) {
            for (const name of namenIn(sprache)) {
                expect(name, sprache).toBe(name.trim());
                expect(name, sprache).not.toBe("");
            }
        }
    });
});

describe("Welche Zonen die Suche mitschickt", () => {
    it("🔴 die, deren Name in der Sprache der Seite passt", () => {
        locale.value = "de";
        expect(climateZoneKeysMatching("Gemäßigte")).toEqual(["gemaessigt"]);
        // Teiltreffer wie das ILIKE des Servers: „Polare Zone“ steckt in „Subpolare Zone“.
        expect(climateZoneKeysMatching("polare zone")).toEqual(["polar", "subpolar"]);
    });

    it("🔴 in einer anderen Sprache sind es die Namen DIESER Tafel", () => {
        locale.value = "nl";
        const name = t("climate.zone.gemaessigt");
        expect(climateZoneKeysMatching(name)).toEqual(["gemaessigt"]);
    });

    it("🪤 nichts, wo nichts passt - der Server bekommt dann keine Liste", () => {
        expect(climateZoneKeysMatching("Gareth")).toEqual([]);
        expect(climateZoneKeysMatching("   ")).toEqual([]);
    });

    it("🔴 hängt sie an die Anfrage, und ohne Treffer gar nichts", async () => {
        const gerufen: string[] = [];
        vi.stubGlobal("fetch", (url: string) => {
            gerufen.push(url);
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ query: "x", hits: [], truncated: false }),
            } as Response);
        });
        locale.value = "nl";
        await fetchSearch(t("climate.zone.gemaessigt"));
        await fetchSearch("Gareth");
        expect(gerufen[0]).toContain("&climate=gemaessigt");
        expect(gerufen[1]).not.toContain("climate=");
    });
});

describe("Der Name im Suchtreffer", () => {
    const treffer = (kind: SearchHit["kind"], id: string, name: string): SearchHit => ({
        kind,
        id,
        name,
        x: 512,
        y: 650,
        zoom: 2,
    });

    it("🔴 eine Klimazone heißt wie in der Tafel, jeder andere Treffer behält seinen Namen", () => {
        locale.value = "nl";
        expect(hitName(treffer("klima", "gemaessigt", "Gemäßigte Zone"))).toBe(t("climate.zone.gemaessigt"));
        // Ortsnamen sind Kartendaten und werden nie übersetzt.
        expect(hitName(treffer("ort", "7", "Gareth"))).toBe("Gareth");
    });
});
