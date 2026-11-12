import { describe, expect, it } from "vitest";
import { FLAECHE } from "../src/map/geometrie/arten";
import { bildVon, MARKE_FEHLER_PX } from "../src/map/geometrie/bild";
import {
    abgelehntSatz,
    formFehlerMarken,
    formUngueltigAus,
    formUngueltigSatz,
    type Ablehnung,
} from "../src/map/geometrie/form-ungueltig";
import { t } from "../src/i18n/i18n";

/**
 * Eine ungültige Form beim Speichern (Vali 2026-11-09: „Ja, bauen“ auf die Frage, ob der Editor die Stelle markieren soll). Der Server
 * schickt `form_ungueltig` mit Art, Stelle und Fläche (`landscape-reshape.ts`); die Leiste sagt es in der Sprache der Oberfläche, und
 * „Ecken bearbeiten“ markiert die Stelle, bis der abgelehnte Stand nicht mehr steht. Erwartet wird über `t(key, params)`.
 */

const SATZ = "Die Form schneidet sich selbst, oder ein Loch liegt über ihrem Rand.";
const abgelehnt = (details?: Record<string, unknown>): Ablehnung & { satz: string } => ({
    art: "abgelehnt",
    satz: SATZ,
    details,
});
const form = (weiter: Record<string, unknown> = {}): Record<string, unknown> => ({
    field: "areas",
    areaId: "a1",
    reason: "form_ungueltig",
    art: "schneidet_sich",
    landschaft: { id: "r1", name: "Ilminsauen", eigene: true },
    stelle: { x: 410.5, y: 233.25 },
    ...weiter,
});

describe("formUngueltigAus", () => {
    it("🔴 liest Art, Stelle, Name und ob es die eigene Fläche ist", () => {
        expect(formUngueltigAus(abgelehnt(form()))).toEqual({
            art: "schneidet_sich",
            stelle: { x: 410.5, y: 233.25 },
            name: "Ilminsauen",
            eigene: true,
        });
        expect(
            formUngueltigAus(abgelehnt(form({ landschaft: { id: "r2", name: "Waldauen", eigene: false } })))?.eigene,
        ).toBe(false);
    });

    it("🔴 ohne Stelle (Server vor diesem Release), mit anderem Code oder ohne Ablehnung gibt es keine", () => {
        expect(formUngueltigAus(abgelehnt({ field: "areas", areaId: "a1", reason: "form_ungueltig" }))).toBeUndefined();
        expect(formUngueltigAus(abgelehnt(form({ stelle: { x: "1", y: 2 } })))).toBeUndefined();
        expect(formUngueltigAus(abgelehnt(form({ reason: "ecke_ausserhalb" })))).toBeUndefined();
        expect(formUngueltigAus({ art: "bereit" })).toBeUndefined();
        expect(formUngueltigAus(undefined)).toBeUndefined();
    });

    it("eine unbekannte Art gilt als „sonst“", () => {
        expect(formUngueltigAus(abgelehnt(form({ art: "neu_im_server" })))?.art).toBe("sonst");
    });
});

describe("Ring unter drei Ecken und umgezeichneter Nachbar (Vali 2026-11-10)", () => {
    it("🔴 beide Gründe tragen Stelle und Fläche, beim Gebiet als `gebiet`", () => {
        const ring = form({ reason: "ring_unter_drei", art: undefined });
        expect(formUngueltigAus(abgelehnt(ring))).toMatchObject({ art: "zu_wenig_ecken", name: "Ilminsauen" });
        const nachbar = form({
            reason: "nachbar_umgezeichnet",
            art: undefined,
            landschaft: undefined,
            gebiet: { id: "t2", name: "Baronie Ost", eigene: false },
        });
        expect(formUngueltigAus(abgelehnt(nachbar))).toEqual({
            art: "nachbar_umgezeichnet",
            stelle: { x: 410.5, y: 233.25 },
            name: "Baronie Ost",
            eigene: false,
        });
    });

    it("🔴 die Sätze sagen, was zu tun ist; am umgezeichneten Nachbarn ohne den Zusatz zum Mitziehen", () => {
        expect(abgelehntSatz(abgelehnt(form({ reason: "ring_unter_drei" })))).toBe(
            t("formentwurf.ungueltig.zuWenigEcken", { name: "Ilminsauen" }),
        );
        const nachbar = form({ reason: "nachbar_umgezeichnet", landschaft: { name: "Aelderwald", eigene: false } });
        expect(abgelehntSatz(abgelehnt(nachbar))).toBe(
            t("formentwurf.ungueltig.nachbarUmgezeichnet", { name: "Aelderwald" }),
        );
    });
});

describe("Satz in Leiste und Fuß", () => {
    it.each([
        ["schneidet_sich", "formentwurf.ungueltig.schneidetSich"],
        ["beruehrt_sich", "formentwurf.ungueltig.beruehrtSich"],
        ["loch_ueber_rand", "formentwurf.ungueltig.lochUeberRand"],
        ["sonst", "formentwurf.ungueltig.sonst"],
    ] as const)("🔴 %s nennt die Fläche und was zu tun ist", (art, key) => {
        expect(abgelehntSatz(abgelehnt(form({ art })))).toBe(t(key, { name: "Ilminsauen" }));
    });

    it("🔴 ein mitgezogener Nachbar sagt dazu, warum er dabei ist, am Telefon mit der Geste des Fingers", () => {
        const nachbar = formUngueltigAus(
            abgelehnt(form({ landschaft: { id: "r2", name: "Waldauen", eigene: false } })),
        )!;
        expect(formUngueltigSatz(nachbar)).toBe(
            `${t("formentwurf.ungueltig.schneidetSich", { name: "Waldauen" })} ${t("formentwurf.ungueltig.nachbar", { name: "Waldauen" })}`,
        );
        expect(formUngueltigSatz(nachbar, true)).toContain(
            t("formentwurf.ungueltig.nachbarFinger", { name: "Waldauen" }),
        );
    });

    it("🔴 jede andere Ablehnung behält den Satz des Servers", () => {
        expect(abgelehntSatz(abgelehnt({ reason: "ecke_ausserhalb" }))).toBe(SATZ);
        expect(abgelehntSatz(abgelehnt())).toBe(SATZ);
    });
});

describe("Marke an der Stelle", () => {
    it("🔴 steht nur, solange der abgelehnte Stand steht", () => {
        const f = formUngueltigAus(abgelehnt(form()))!;
        const stand = { form: [] };
        expect(formFehlerMarken(f, stand, stand)).toEqual([{ at: { x: 410.5, y: 233.25 }, art: "fehler" }]);
        // Der nächste Schritt, ↶ oder Verwerfen ersetzen den Stand.
        expect(formFehlerMarken(f, stand, { form: [] })).toEqual([]);
        expect(formFehlerMarken(undefined, stand, stand)).toEqual([]);
    });

    it("🔴 wird ein roter Ring, größer als jeder andere", () => {
        const bild = bildVon(
            FLAECHE,
            {
                teile: [],
                nachbarn: [],
                mitgezogen: [],
                andock: [],
                marken: [{ at: { x: 1, y: 2 }, art: "fehler" }],
            },
            10,
        );
        expect(bild.ringe).toEqual([{ at: { x: 1, y: 2 }, art: "fehler", radius: MARKE_FEHLER_PX }]);
        expect(MARKE_FEHLER_PX).toBeGreaterThan(17);
    });
});
