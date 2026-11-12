import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { locale } from "../src/i18n/i18n.ts";
import {
    copyOptions,
    DEFAULT_OPTIONS,
    TRANSPORT_ICONS,
    transportLabel,
    transportShortLabel,
} from "../src/route-planner/planner-model.ts";
import { readPlannerLink } from "../src/route-planner/planner-link.ts";
import { restrictionHints } from "../src/route-planner/route-client.ts";

/**
 * Die Transportmittel im Planer (WI-0069): Namen in beiden Sprachen, Bilder im Format der übrigen, alte Links. Die
 * Namen tragen keine Reisestunden (Betreiber 2026-10-03); wie lange ein Schiff fährt, sagen die Routendetails.
 */

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");
const ALL = [...new Set(Object.values(AVENTURIA_TRAVEL_MODEL.transportmittel.wert).flat())];

afterEach(() => {
    locale.value = "de";
});

/** Breite, Höhe und Kodierung eines WebP aus seinem Kopf (RIFF, erster Block). */
function webpHeader(path: string): { chunk: string; width: number; height: number } {
    const bytes = readFileSync(join(publicDir, path));
    const chunk = bytes.toString("latin1", 12, 16);
    if (chunk !== "VP8L") return { chunk, width: 0, height: 0 };
    const bits = bytes.readUInt32LE(21);
    return { chunk, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}

describe("Namen", () => {
    it("🔴 jedes Mittel hat seinen Namen und seinen kurzen Namen, deutsch und englisch", () => {
        for (const transport of ALL) {
            for (const table of [de, en] as Record<string, string>[]) {
                expect(table[`planner.transport.opt.${transport}`], transport).toBeTruthy();
                expect(table[`transportInfo.mode.${transport}`], transport).toBeTruthy();
            }
        }
    });

    it("🔴 die Namen des Betreibers; caravan bleibt Kennung und heißt Kamelkarawane", () => {
        expect(AVENTURIA_TRAVEL_MODEL.transportmittel.wert.land.map(transportLabel)).toEqual([
            "Reisegruppe zu Fuß",
            "Wanderer mit leichtem Gepäck",
            "Reisegruppe zu Pferd",
            "Einzelreiter mit leichtem Gepäck",
            "Kamelkarawane",
            "Karren",
            "Fuhrwerk",
            "Kutsche",
            "Schlitten",
        ]);
        expect(AVENTURIA_TRAVEL_MODEL.transportmittel.wert.river.map(transportLabel)).toEqual([
            "Flusssegler",
            "Flusskahn",
            "Flussgaleere",
            "Ruderboot",
        ]);
    });

    it("🔴 Schiffe ohne Zahlen und Klammern: „die zahl steht nicht dran“ (Betreiber 2026-10-03)", () => {
        expect(AVENTURIA_TRAVEL_MODEL.transportmittel.wert.sea.map(transportLabel)).toEqual([
            "Lastensegler",
            "Schnellsegler",
            "Galeere",
            "Kurierdromone",
            "Ruderboot",
        ]);
        expect(new Set(ALL.map(transportLabel)).size).toBe(ALL.length);
        for (const transport of ALL) {
            for (const table of [de, en] as Record<string, string>[]) {
                for (const key of [`planner.transport.opt.${transport}`, `transportInfo.mode.${transport}`]) {
                    expect(table[key], key).not.toMatch(/[\d(){}]/);
                }
            }
        }
        // Auf dem Wasser sind Name und kurzer Name dieselben: „Schnellsegler = Schnellsegler“.
        const { river, sea } = AVENTURIA_TRAVEL_MODEL.transportmittel.wert;
        for (const ship of [...river, ...sea]) expect(transportShortLabel(ship), ship).toBe(transportLabel(ship));
        locale.value = "en";
        expect(AVENTURIA_TRAVEL_MODEL.transportmittel.wert.sea.map(transportLabel)).toEqual([
            "Cargo sailer",
            "Fast sailer",
            "Galley",
            "Courier dromon",
            "Rowing boat",
        ]);
    });
});

describe("Bilder", () => {
    it("🔴 jedes Mittel hat ein Bild im Format der übrigen: 80 × 80, verlustfreies WebP, kein 404", () => {
        for (const transport of ALL) {
            const icon = TRANSPORT_ICONS[transport];
            expect(icon, transport).toMatch(/^\/icons\/route\/[A-Za-z]+\.webp$/);
            expect(existsSync(join(publicDir, icon ?? "")), transport).toBe(true);
            expect(webpHeader(icon ?? ""), transport).toEqual({ chunk: "VP8L", width: 80, height: 80 });
        }
    });

    it("jedes Mittel hat sein eigenes Bild", () => {
        const icons = ALL.map((transport) => TRANSPORT_ICONS[transport]);
        expect(new Set(icons).size).toBe(ALL.length);
        expect(Object.keys(TRANSPORT_ICONS).sort()).toEqual([...ALL].sort());
    });
});

describe("Alte Links", () => {
    it("🔴 Links mit caravan, fastShip und galley öffnen dieselbe Wahl wie vorher", () => {
        const link = readPlannerLink("?route=Gareth~Perricum&landTransport=caravan&seaTransport=fastShip");
        expect(link.options.transports).toEqual({ land: "caravan", river: "riverSailer", sea: "fastShip" });
        expect(readPlannerLink("?route=A~B&seaTransport=galley").options.transports.sea).toBe("galley");
        expect(
            readPlannerLink("?route=A~B&landTransport=sleigh&riverTransport=riverGalley").options.transports,
        ).toEqual({ land: "sleigh", river: "riverGalley", sea: "cargoShip" });
    });
});

describe("Warum ein Mittel keinen Weg fand", () => {
    it("der Schlitten nennt Reisebeginn und Schnee, das Ruderboot den Binnensee - die übrigen schweigen", () => {
        expect(restrictionHints(DEFAULT_OPTIONS)).toEqual([]);
        const options = copyOptions(DEFAULT_OPTIONS);
        options.transports = { land: "sleigh", river: "riverSailer", sea: "rowboat" };
        expect(restrictionHints(options)).toEqual([
            "Schlitten fährt nur mit Reisebeginn: im Winter auf Schnee oder Eis, im Gebirge über der Schneegrenze immer.",
            "Ruderboot fährt nur auf Flüssen und Binnenseen, nie aufs Meer.",
        ]);
        options.enabled = { land: false, river: true, sea: false };
        expect(restrictionHints(options)).toEqual([]);
    });
});
