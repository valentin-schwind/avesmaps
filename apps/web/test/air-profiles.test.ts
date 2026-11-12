import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isMessageKey, locale } from "../src/i18n/i18n.ts";
import {
    AIR_ALTITUDE_LIMITS,
    AIR_GROUPS,
    AIR_PROFILES,
    AIR_SPEED_LIMITS,
    airGroupLabel,
    airProfileLabel,
    airProfilesOf,
    airSummary,
    airValues,
    clampAirValue,
    copyAirChoice,
    DEFAULT_AIR_CHOICE,
    selectedAir,
} from "../src/route-planner/air-profiles.ts";
import { TRANSPORT_ICONS } from "../src/route-planner/planner-model.ts";

/**
 * Die vorbereiteten Flugmittel (WI-0050): was das Zielbild des Betreibers festlegt, wie es heißt und
 * dass die Bilder das Format der bestehenden Transportbilder haben.
 */

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");

afterEach(() => {
    locale.value = "de";
});

/** Breite, Höhe und Kodierung eines WebP aus seinem Kopf (RIFF, erster Block). */
function webpHeader(path: string): { chunk: string; width: number; height: number } {
    const bytes = readFileSync(join(publicDir, path));
    const chunk = bytes.toString("latin1", 12, 16);
    if (chunk !== "VP8L") return { chunk, width: 0, height: 0 };
    // VP8L: Signaturbyte 0x2f, dann 14 Bit Breite-1 und 14 Bit Höhe-1.
    const bits = bytes.readUInt32LE(21);
    return { chunk, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}

describe("Die Flugmittel (Zielbild des Betreibers, 2026-09-27)", () => {
    it("🔴 zwölf Profile in vier Gruppen, in der Reihenfolge und mit den Werten des Zielbilds und des Nachtrags", () => {
        expect(AIR_GROUPS.map((group) => [airGroupLabel(group), airProfilesOf(group).map((p) => p.id)])).toEqual([
            ["Fluggeräte", ["witchFlight", "flyingCarpet", "airship"]],
            ["Flugreittiere", ["flyingLizard", "hippogriff", "giantAuk", "skySteed", "westwindDragon"]],
            ["Beschworene Wesen", ["airDjinn", "karakil", "irrhalk"]],
            ["Außergewöhnlich", ["griffin"]],
        ]);
        expect(
            AIR_PROFILES.map(
                (profile) => `${airProfileLabel(profile.id)}: ${airValues(profile.speedMph, profile.altitudePaces)}`,
            ),
        ).toEqual([
            "Hexenfluggerät: 40 Meilen/h · 100 Schritt",
            "Fliegender Teppich: 35 Meilen/h · 150 Schritt",
            // Nachtrag des Betreibers: Bahalyr, 100 Meilen am Tag bei 8 Reisestunden; die Höhe ist geschätzt.
            "Luftschiff: 12,5 Meilen/h · 1.000 Schritt",
            "Flugechse: 30 Meilen/h · 200 Schritt",
            "Hippogriff: 40 Meilen/h · 400 Schritt",
            "Riesenalk: 38 Meilen/h · 400 Schritt",
            "Himmelsross: 45 Meilen/h · 500 Schritt",
            "Westwinddrache: 50 Meilen/h · 600 Schritt",
            "Luftdschinn: 25 Meilen/h · 300 Schritt",
            "Karakil: 45 Meilen/h · 400 Schritt",
            "Irrhalk: 80 Meilen/h · 700 Schritt",
            "Greif: 50 Meilen/h · 800 Schritt",
        ]);
    });

    it("jedes Flugmittel und jede Gruppe heißt auf Deutsch und Englisch", () => {
        for (const profile of AIR_PROFILES) expect(isMessageKey(`planner.air.opt.${profile.id}`)).toBe(true);
        locale.value = "en";
        expect(airProfileLabel("griffin")).toBe("Griffin");
        expect(airGroupLabel("summoned")).toBe("Summoned beings");
        expect(airValues(80, 700)).toBe("80 miles/h · 700 paces");
        expect(airValues(12.5, 1000)).toBe("12.5 miles/h · 1,000 paces");
    });

    it("🔴 jedes Bild hat Größe und Format der bestehenden Transportbilder: 80 × 80, verlustfreies WebP", () => {
        const reference = webpHeader(TRANSPORT_ICONS["horseCarriage"] ?? "");
        expect(reference).toEqual({ chunk: "VP8L", width: 80, height: 80 });
        for (const profile of AIR_PROFILES) {
            expect(profile.icon).toMatch(/^\/icons\/route\/[A-Za-z]+\.webp$/);
            expect(webpHeader(profile.icon), profile.id).toEqual(reference);
        }
        expect(new Set(AIR_PROFILES.map((profile) => profile.icon)).size).toBe(AIR_PROFILES.length);
    });
});

describe("Die Wahl im Flug", () => {
    it("genau eines ist gewählt, vorgegeben das Hexenfluggerät; die Kopie teilt nichts", () => {
        expect(selectedAir(DEFAULT_AIR_CHOICE)).toMatchObject({
            name: "Hexenfluggerät",
            speedMph: 40,
            altitudePaces: 100,
        });
        const copy = copyAirChoice(DEFAULT_AIR_CHOICE);
        copy.custom.speedMph = 99;
        expect(DEFAULT_AIR_CHOICE.custom.speedMph).toBe(40);
    });

    it("das eigene Flugmittel heißt, wie man es nennt - leer „Eigenes Flugmittel“, mit dem neutralen Bild", () => {
        const choice = copyAirChoice(DEFAULT_AIR_CHOICE);
        choice.profile = "custom";
        // 🔴 Das neutrale Bild kam am 2026-10-05 vom Betreiber; vorher blieb die Zeile bildlos.
        expect(airSummary(choice)).toEqual([
            { icon: "/icons/route/EigenesFluggeraet.webp", text: "Eigenes Flugmittel" },
            { text: "40 Meilen/h · 250 Schritt" },
        ]);
        choice.custom = { name: "  Besen  ", speedMph: 60, altitudePaces: 1200 };
        expect(airSummary(choice).map((part) => part.text)).toEqual(["Besen", "60 Meilen/h · 1.200 Schritt"]);
        expect(airSummary(DEFAULT_AIR_CHOICE)[0]).toEqual({
            icon: "/icons/route/Hexenflug.webp",
            text: "Hexenfluggerät",
        });
    });

    it("das Tempo trägt eine Nachkommastelle, die Höhe ganze Schritt; Unlesbares behält den alten Wert", () => {
        expect(clampAirValue(12.54, AIR_SPEED_LIMITS, 40)).toBe(12.5);
        expect(clampAirValue(12.6, AIR_ALTITUDE_LIMITS, 250)).toBe(13);
        expect(clampAirValue(0, AIR_SPEED_LIMITS, 40)).toBe(1);
        expect(clampAirValue(100_000, AIR_SPEED_LIMITS, 40)).toBe(999);
        expect(clampAirValue(Number.NaN, AIR_SPEED_LIMITS, 40)).toBe(40);
    });
});
