import { afterEach, describe, expect, it, vi } from "vitest";
import { istFortsetzung } from "../src/info-panel/bildbezug";
import { mitReisebildStand } from "../src/info-panel/subject-client";
import { reisebilderStand } from "../src/medien/medien-oeffnen";
import { folgeReisebildStand } from "../src/photobox/reisebilder-frisch";
import { reisebilder } from "../src/photobox/reisebilder-zustand";
import { inhaltsstand, type Inhaltsstand } from "../src/system/inhaltsstand";

/**
 * Neue Reisebilder erscheinen leise (WI-0272; Vali 2026-11-02: „einfach leise das bild in die photobox hinzufügen“): Ein anderer Stand im Takt der Seite fragt Karte und Kopf neu, sonst nichts; das gezeigte Bild
 * des Kopfes springt dabei nicht um, und die Antwort des Ortes trifft nie die 60 s alte aus Nginx.
 */

const setzeStand = async (reisebilderWert: string | undefined): Promise<void> => {
    (inhaltsstand.stand as { value: Inhaltsstand }).value = {
        revision: 1,
        off: new Set(),
        reisebilder: reisebilderWert,
    };
    await Promise.resolve();
};

describe("Neue Reisebilder erscheinen leise", () => {
    afterEach(() => vi.restoreAllMocks());

    it("🔴 ein anderer Stand fragt Karte und Kopf neu; der erste Stand und derselbe Stand tun nichts", async () => {
        vi.spyOn(inhaltsstand, "aus").mockReturnValue(new Set());
        vi.spyOn(inhaltsstand, "lies").mockResolvedValue();
        await setzeStand(undefined);
        const neuLaden = vi.fn();
        const kopfNeu = vi.fn();
        const trennen = reisebilder.verbindeKarte({ schirmVon: () => undefined, zeige: () => undefined, neuLaden });
        const stop = folgeReisebildStand({ kopfNeu });

        await setzeStand("3-7-0");
        expect(neuLaden).not.toHaveBeenCalled();
        expect(kopfNeu).not.toHaveBeenCalled();
        await setzeStand("3-7-0");
        expect(kopfNeu).not.toHaveBeenCalled();

        await setzeStand("4-8-0");
        expect(neuLaden).toHaveBeenCalledTimes(1);
        expect(kopfNeu).toHaveBeenCalledTimes(1);

        stop();
        trennen();
    });

    it("🔴 wer selbst freigibt, wartet nicht auf den Takt: Nach einer Operation an einer Einreichung liest die Seite den Stand sofort", async () => {
        vi.spyOn(inhaltsstand, "aus").mockReturnValue(new Set());
        const lies = vi.spyOn(inhaltsstand, "lies").mockResolvedValue();
        const stop = folgeReisebildStand({ kopfNeu: () => undefined });
        reisebilderStand.value += 1;
        await Promise.resolve();
        expect(lies).toHaveBeenCalledTimes(1);
        stop();
    });

    it("🔴 das gezeigte Bild bleibt stehen, wenn nur hinten eines dazukam; alles andere beginnt von vorn", () => {
        expect(istFortsetzung("wappen,a", "wappen,a,b")).toBe(true);
        expect(istFortsetzung("wappen", "wappen,a")).toBe(true);
        expect(istFortsetzung("wappen,a,b", "wappen,a")).toBe(false);
        expect(istFortsetzung("wappen,a", "wappen,b")).toBe(false);
        expect(istFortsetzung("wappen,a", "anderes,a,b")).toBe(false);
        expect(istFortsetzung("wappen,a", "wappen,a")).toBe(false);
    });

    it("🔴 die Antwort eines Ortes trägt den Stand in der Adresse, andere Arten nicht; ohne Stand bleibt die Adresse", () => {
        const ort = { kind: "place", id: "a" } as const;
        expect(mitReisebildStand("/api/subjects/place/a", ort, "4-8-0")).toBe("/api/subjects/place/a?stand=4-8-0");
        expect(mitReisebildStand("/api/subjects/place/a", ort, undefined)).toBe("/api/subjects/place/a");
        expect(mitReisebildStand("/api/subjects/area/a", { kind: "area", id: "a" }, "4-8-0")).toBe(
            "/api/subjects/area/a",
        );
    });
});
