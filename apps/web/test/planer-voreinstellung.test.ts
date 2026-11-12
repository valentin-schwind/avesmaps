import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, CALENDAR_MONTHS, karteneinstellungVorgaben } from "@avesmaps3d/shared";
import { ladeStartansicht } from "../src/map/start-view.ts";
import { DEFAULT_AIR_CHOICE } from "../src/route-planner/air-profiles.ts";
import { readPlannerLink, tragtPlanerangaben, writePlannerLink } from "../src/route-planner/planner-link.ts";
import { DEFAULT_OPTIONS } from "../src/route-planner/planner-model.ts";
import { planerVoreinstellung } from "../src/route-planner/planner-presets.ts";
import { createPlanner } from "../src/route-planner/use-planner.ts";

/**
 * Das Panel „Routenplaner“ der Karteneinstellungen am Planer (WI-0166; Betreiber 2026-10-15: „so dass alte Links gleich
 * bleiben“). Geprüft wird die Zusicherung selbst: Die Voreinstellung bestimmt nur den Start eines Besuchs OHNE Angaben des
 * Planers in der Adresse; jeder Link wird gegen die FESTE Vorgabe gelesen, und ein Link, der auf einer Seite mit
 * Voreinstellung entsteht, trägt seine Abweichungen selbst.
 */

const LAND_ANDERS = AVENTURIA_TRAVEL_MODEL.transportmittel.wert.land.find(
    (mittel) => mittel !== DEFAULT_OPTIONS.transports.land,
)!;
const FLUG_ANDERS = "griffin";

/** Eine Voreinstellung, in der jeder Wert des Panels von der festen Vorgabe abweicht. */
const VOREINSTELLUNG = {
    ...karteneinstellungVorgaben(),
    planerReiseart: "air",
    planerFlugmittel: FLUG_ANDERS,
    planerFlussErlaubt: false,
    planerLandTransport: LAND_ANDERS,
    planerRoutenwahl: "shortest",
    planerUmstiegeMinimieren: true,
    planerEiltempo: true,
    planerReisestunden: 10.5,
    planerReisebeginn: { monat: CALENDAR_MONTHS[3]!, tag: 12 },
    planerUnterbringung: "zimmer",
};

const stille = {
    showOnMap: () => undefined,
    fitRoute: () => undefined,
    showPlace: () => undefined,
    notify: () => undefined,
    writeAddress: () => undefined,
};

async function setzeVoreinstellung(werte: object): Promise<void> {
    const antwort = (async () =>
        new Response(JSON.stringify({ revision: 3, ...werte }), { status: 200 })) as unknown as typeof fetch;
    await ladeStartansicht(antwort);
}

describe("Die Voreinstellung des Planers", () => {
    it("🔴 die Vorgaben der Tafel SIND die festen Vorgaben des Planers: ohne Verstellung ändert sich nichts", () => {
        expect(planerVoreinstellung(karteneinstellungVorgaben())).toEqual({
            options: DEFAULT_OPTIONS,
            mode: "surface",
            air: DEFAULT_AIR_CHOICE,
        });
    });

    it("jeder Wert des Panels kommt an seiner Stelle im Planer an", () => {
        const start = planerVoreinstellung(VOREINSTELLUNG);
        expect(start.mode).toBe("air");
        expect(start.air.profile).toBe(FLUG_ANDERS);
        expect(start.options).toEqual({
            optimize: "shortest",
            minimizeTransfers: true,
            hurry: true,
            enabled: { land: true, river: false, sea: true },
            transports: { ...DEFAULT_OPTIONS.transports, land: LAND_ANDERS },
            hoursPerDay: 10.5,
            departure: { month: CALENDAR_MONTHS[3], day: 12 },
            lodging: "zimmer",
        });
    });

    it("was der Planer nicht kennt, fällt auf die feste Vorgabe zurück", () => {
        const start = planerVoreinstellung({
            ...karteneinstellungVorgaben(),
            planerLandTransport: "Drachenreiter",
            planerFlugmittel: "custom",
            planerUnterbringung: "Palast",
            planerRoutenwahl: "irgendwie",
        });
        expect(start.options.transports.land).toBe(DEFAULT_OPTIONS.transports.land);
        expect(start.options.lodging).toBe(DEFAULT_OPTIONS.lodging);
        expect(start.options.optimize).toBe(DEFAULT_OPTIONS.optimize);
        expect(start.air.profile).toBe(DEFAULT_AIR_CHOICE.profile);
    });
});

describe("🔴 Alte Links bleiben gleich", () => {
    it("ein neuer Besuch ohne Angaben in der Adresse beginnt mit der Voreinstellung", async () => {
        await setzeVoreinstellung(VOREINSTELLUNG);
        const planner = createPlanner(stille);
        await planner.restore("", true);
        expect(planner.options.hurry).toBe(true);
        expect(planner.options.transports.land).toBe(LAND_ANDERS);
        expect(planner.mode.value).toBe("air");
        // Auch ein fremder Parameter (Wiki-Verweis) ist keine Angabe des Planers.
        await planner.restore("?siedlung=Gareth", true);
        expect(planner.options.optimize).toBe("shortest");
    });

    it("🔴 eine Adresse MIT Angaben wird gegen die feste Vorgabe gelesen, nicht gegen die Voreinstellung", async () => {
        await setzeVoreinstellung(VOREINSTELLUNG);
        const planner = createPlanner(stille);
        // Ein alter Link, der nur „Eiltempo“ sagt: Alles andere ist die feste Vorgabe von damals, wie in jedem Release.
        await planner.restore("?hurry=1", true);
        expect(planner.options).toEqual({ ...DEFAULT_OPTIONS, hurry: true });
        expect(planner.mode.value).toBe("surface");
        expect(tragtPlanerangaben("?route=Gareth~Punin")).toBe(true);
        expect(tragtPlanerangaben("?siedlung=Gareth")).toBe(false);
        expect(tragtPlanerangaben("?s=abc")).toBe(false);
    });

    it("🔴 ein Link, der auf einer Seite mit Voreinstellung entsteht, trägt sie selbst und öffnet überall dasselbe", () => {
        const start = planerVoreinstellung(VOREINSTELLUNG);
        const link = writePlannerLink(["Gareth", "Punin"], start.options);
        expect(link).toContain("hurry=1");
        expect(link).toContain("pathType=shortest");
        expect(link).toContain(`landTransport=${LAND_ANDERS}`);
        expect(link).toContain("allowRiver=0");
        expect(readPlannerLink(`?${link}`).options).toEqual(start.options);
    });
});
