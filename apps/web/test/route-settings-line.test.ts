import { afterEach, describe, expect, it } from "vitest";
import type { RouteResponse } from "@avesmaps3d/shared";
import { locale } from "../src/i18n/i18n.ts";
import { AIR_PROFILES } from "../src/route-planner/air-profiles.ts";
import {
    copyOptions,
    DEFAULT_OPTIONS,
    DOMAINS,
    transportLabel,
    transportShortLabel,
    TRANSPORTS,
    type PlannerOptions,
} from "../src/route-planner/planner-model.ts";
import { settingsLine, settingsParts } from "../src/route-planner/route-settings-line.ts";

/**
 * Die Einstellungszeile unter dem Reisetitel (Betreiber 2026-10-04): nur, was die Route wählt - Routenart und Umsteigen,
 * im Flug „Flug“ -, getrennt mit „ · “. Sie leitet sich aus den Optionen des Planers ab; nur die Antwort sagt, ob die Reise ein
 * Flug ist. Nicht darin stehen Transportmittel („die transportmittel kannst du weglassen“), der Reisebeginn („datum braucht
 * es nicht, da steht schon drunter“) und die Reisestunden („lasst das 8.0/Tag auch weg, steht ja ein paar zeilen drüber“).
 */

afterEach(() => {
    locale.value = "de";
});

type Fixture = Pick<RouteResponse, "air" | "hurry">;
const surface: Fixture = {};
/** Eine Reise, auf der das Eiltempo wirklich greift: nur dann nennt die Zeile es als Einstellung. */
const eilende: Fixture = { hurry: { distance_units: 80, saved_hours: 4.2, hurried_hours: 9.5 } };
const flight = (profile: string): Fixture => ({
    air: { profile, speed_mph: 40, altitude_schritt: 100, max_above_ground_schritt: 1000, ceiling_schritt: 5000 },
});
const withOptions = (change: (options: PlannerOptions) => void): PlannerOptions => {
    const options = copyOptions(DEFAULT_OPTIONS);
    change(options);
    return options;
};

describe("Einstellungszeile: Landreise", () => {
    it("🔴 nennt die Routenart, deutsch und englisch, mit Legacys Wörtern", () => {
        expect(settingsLine(surface, DEFAULT_OPTIONS)).toBe("Schnellste Route");
        expect(
            settingsLine(
                surface,
                withOptions((o) => (o.optimize = "shortest")),
            ),
        ).toBe("Kürzeste Route");
        locale.value = "en";
        expect(settingsLine(surface, DEFAULT_OPTIONS)).toBe("Fastest route");
        expect(
            settingsLine(
                surface,
                withOptions((o) => (o.optimize = "shortest")),
            ),
        ).toBe("Shortest route");
    });

    it("🔴 eine Landreise mit Fluss und Meer sagt dasselbe: Transportmittel stehen nicht in der Zeile", () => {
        const options = withOptions((o) => {
            o.transports = { land: "lightRider", river: "riverBarge", sea: "galley" };
        });
        expect(settingsParts(surface, options)).toEqual(["Schnellste Route"]);
    });

    it("🔴 keine Domäne und kein Transportmittel taucht je auf, auch nicht „ohne Meer“, in beiden Sprachen", () => {
        const names = (): string[] =>
            DOMAINS.flatMap((domain) =>
                TRANSPORTS[domain].flatMap((id) => [transportLabel(id), transportShortLabel(id)]),
            );
        for (const language of ["de", "en"] as const) {
            locale.value = language;
            for (const domainOff of [null, ...DOMAINS]) {
                const options = withOptions((o) => {
                    o.transports = { land: "caravan", river: "riverGalley", sea: "courierDromone" };
                    if (domainOff) o.enabled[domainOff] = false;
                });
                const line = settingsLine(surface, options);
                for (const name of names()) expect(line, `${language}: ${name}`).not.toContain(name);
                expect(line).not.toMatch(/\b(ohne|without)\b/);
            }
        }
    });
});

describe("Einstellungszeile: Kürzeste Route, Umsteigen minimieren", () => {
    const options = withOptions((o) => {
        o.optimize = "shortest";
        o.minimizeTransfers = true;
    });

    it("🔴 deutsch: die Routenart zuerst, dann Umsteigen", () => {
        expect(settingsLine(surface, options)).toBe("Kürzeste Route · Umsteigen minimieren");
    });

    it("🔴 englisch", () => {
        locale.value = "en";
        expect(settingsLine(surface, options)).toBe("Shortest route · Minimize transfers");
    });

    it("ein Wechsel der Routenart oder von Umsteigen ändert die Zeile", () => {
        const fastest = copyOptions(options);
        fastest.optimize = "fastest";
        expect(settingsLine(surface, fastest)).toBe("Schnellste Route · Umsteigen minimieren");

        const direct = copyOptions(options);
        direct.minimizeTransfers = false;
        expect(settingsLine(surface, direct)).toBe("Kürzeste Route");
    });
});

describe("Einstellungszeile: Reisebeginn und Reisestunden stehen nicht darin", () => {
    it("🔴 mit Reisebeginn und anderen Reisestunden sagt die Zeile dasselbe, deutsch und englisch, an Land und im Flug", () => {
        const timed = withOptions((o) => {
            o.optimize = "shortest";
            o.minimizeTransfers = true;
            o.departure = { month: "firun", day: 15 };
            o.hoursPerDay = 10;
        });
        expect(settingsLine(surface, timed)).toBe("Kürzeste Route · Umsteigen minimieren");
        expect(settingsLine(flight("griffin"), timed)).toBe("Flug");
        locale.value = "en";
        expect(settingsLine(surface, timed)).toBe("Shortest route · Minimize transfers");
        expect(settingsLine(flight("griffin"), timed)).toBe("Flight");
        for (const line of [settingsLine(surface, timed), settingsLine(flight("griffin"), timed)]) {
            expect(line).not.toMatch(/Firun|ab |from |h\/Tag|h\/day|\d/);
        }
    });
});

describe("Einstellungszeile: Eiltempo (WI-0078)", () => {
    it("🔴 steht hinten, nachdem Routenart und Umsteigen genannt sind (Betreiber 2026-10-05, F7 = B)", () => {
        expect(
            settingsParts(
                eilende,
                withOptions((o) => {
                    o.minimizeTransfers = true;
                    o.hurry = true;
                }),
            ),
        ).toEqual(["Schnellste Route", "Umsteigen minimieren", "Eiltempo"]);
    });

    it("🔴 eilt die Reise nirgends, sagt die Zeile das statt nur „Eiltempo“ (Betreiber 2026-10-06)", () => {
        expect(
            settingsParts(
                surface,
                withOptions((o) => (o.hurry = true)),
            ),
        ).toEqual(["Schnellste Route", "Eiltempo nicht möglich"]);
    });

    it("englisch ebenso", () => {
        locale.value = "en";
        expect(
            settingsParts(
                surface,
                withOptions((o) => (o.hurry = true)),
            ),
        ).toEqual(["Fastest route", "Forced pace not possible"]);
    });

    it("ohne Haken steht es nicht da", () => {
        expect(settingsParts(surface, DEFAULT_OPTIONS)).not.toContain("Eiltempo");
    });

    it("🔴 im Flug nennt die Zeile es nie - dort gibt es kein Eiltempo (§3 Regel 7)", () => {
        const eilig = withOptions((o) => (o.hurry = true));
        expect(settingsLine(flight(AIR_PROFILES[0]?.id ?? "griffin"), eilig)).toBe("Flug");
    });

    it("englisch: das Wort der englischen Tafel", () => {
        locale.value = "en";
        expect(
            settingsParts(
                eilende,
                withOptions((o) => (o.hurry = true)),
            ),
        ).toEqual(["Fastest route", "Forced march"]);
    });
});

describe("Einstellungszeile: Flug", () => {
    it("🔴 „Flug“ steht an der Stelle der Routenart, ohne Flugmittel, deutsch und englisch", () => {
        expect(settingsLine(flight("griffin"), DEFAULT_OPTIONS)).toBe("Flug");
        locale.value = "en";
        expect(settingsLine(flight("griffin"), DEFAULT_OPTIONS)).toBe("Flight");
    });

    it("🔴 kein Flugmittel taucht auf: weder ein Profil noch das eigene mit seinem Namen", () => {
        for (const profile of AIR_PROFILES) {
            expect(settingsLine(flight(profile.id), DEFAULT_OPTIONS), profile.id).toBe("Flug");
        }
        expect(settingsLine(flight("custom"), DEFAULT_OPTIONS)).toBe("Flug");
    });

    it("🔴 verschweigt, was im Flug nicht gilt: Routenart und Umsteigen", () => {
        const options = withOptions((o) => {
            o.optimize = "shortest";
            o.minimizeTransfers = true;
            o.enabled.sea = false;
            o.transports.land = "lightRider";
        });
        expect(settingsLine(flight("witchFlight"), options)).toBe("Flug");
    });

    it("ob die Reise ein Flug ist, sagt die Antwort (`air`), nicht der Zustand des Planers: eine Landroute bleibt eine", () => {
        expect(settingsParts(surface, DEFAULT_OPTIONS)).toEqual(["Schnellste Route"]);
    });
});

describe("Einstellungszeile: was nicht darin steht", () => {
    it("🔴 die Unterbringung ändert die Zeile nie (sie ändert nur die Kosten, und die nennt der Kostenkasten)", () => {
        const luxury = withOptions((o) => {
            o.lodging = "zimmer";
        });
        expect(settingsLine(surface, luxury)).toBe(settingsLine(surface, DEFAULT_OPTIONS));
    });

    it("die Zeile ist ein Text mit „ · “ dazwischen und ohne Zeilenumbruch", () => {
        const line = settingsLine(
            surface,
            withOptions((o) => {
                o.minimizeTransfers = true;
            }),
        );
        expect(line).not.toMatch(/[\n\r]/);
        expect(line.split(" · ")).toHaveLength(2);
    });
});
