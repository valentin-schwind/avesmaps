import { afterEach, describe, expect, it, vi } from "vitest";
import { hashDesWechsels, hashZiel, installHashFolgen, type HashZiel } from "../src/map/hash-folgen";

/** Ein geänderter Hash im offenen Tab liest dieselben Angaben wie beim Laden (`map/hash-folgen.ts`). */
describe("hashZiel", () => {
    const serien = ["modern", "original"];

    it("🔴 nur die Wahl: Ansicht und Ebene, kein Ausschnitt", () => {
        const ziel = hashZiel("#view=landscapes&layer=alle", serien, "modern");
        expect(ziel.wahl).toEqual({ view: "landscapes", landscape: "alle" });
        expect(ziel.lage).toBeUndefined();
    });

    it("ein voller Link: Wahl und Ausschnitt", () => {
        const ziel = hashZiel("#x=452.750&y=687.000&z=5.00&series=modern&view=landscapes&layer=alle", serien, "modern");
        expect(ziel.wahl).toMatchObject({ view: "landscapes", landscape: "alle", series: "modern" });
        expect(ziel.lage).toMatchObject({ center: { x: 452.75, y: 687 }, zoom: 5 });
    });

    it("Unbekanntes bleibt draußen: eine fremde Ansicht und eine unbekannte Serie", () => {
        const ziel = hashZiel("#view=mond&series=gibtsnicht", serien, "modern");
        expect(ziel.wahl).toEqual({});
    });
});

/**
 * Der Hash des Wechsels kommt aus dem Ereignis, nicht aus `location.hash` (Fund im Release-Test 2026-10-24): Die Karte schreibt ihre Lage
 * gebündelt per `replaceState`; fällt das zwischen Setzen und `hashchange`, stünde in `location.hash` wieder die alte Lage.
 */
describe("hashDesWechsels", () => {
    it("nimmt den Teil ab # aus der Adresse des Wechsels", () => {
        expect(hashDesWechsels("http://localhost:4178/edit#x=450.000&y=560.000&z=7.50", "#alt")).toBe(
            "#x=450.000&y=560.000&z=7.50",
        );
    });

    it("eine Adresse ohne Hash heißt: kein Hash", () => {
        expect(hashDesWechsels("http://localhost:4178/edit", "#alt")).toBe("");
    });

    it("ohne Adresse (ein Ereignis ohne newURL) gilt der Hash von jetzt", () => {
        expect(hashDesWechsels(undefined, "#jetzt")).toBe("#jetzt");
        expect(hashDesWechsels("", "#jetzt")).toBe("#jetzt");
    });
});

describe("installHashFolgen", () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Ein Fenster, das nur `hashchange` kennt; `location.hash` ist schon wieder der alte Hash der Karte (sie hat zurückgeschrieben). */
    function fensterMitRueckgeschriebenemHash(): { senden(newURL: string | undefined): void; hoerer(): number } {
        const hoerer = new Set<(ereignis: Event) => void>();
        vi.stubGlobal("addEventListener", (art: string, f: (ereignis: Event) => void) => {
            if (art === "hashchange") hoerer.add(f);
        });
        vi.stubGlobal("removeEventListener", (art: string, f: (ereignis: Event) => void) => {
            if (art === "hashchange") hoerer.delete(f);
        });
        vi.stubGlobal("location", { hash: "#x=349.044&y=504.000&z=2.50&series=modern&view=political&layer=alle" });
        return {
            senden: (newURL) => {
                for (const f of hoerer) f({ newURL } as unknown as Event);
            },
            hoerer: () => hoerer.size,
        };
    }

    it("🔴 liest den Hash des Wechsels, auch wenn die Karte ihre alte Lage schon zurückgeschrieben hat", () => {
        const fenster = fensterMitRueckgeschriebenemHash();
        const ziele: HashZiel[] = [];
        const ab = installHashFolgen(
            ["modern", "original"],
            () => "modern",
            (ziel) => ziele.push(ziel),
        );
        fenster.senden("http://localhost:4178/edit#x=450.000&y=560.000&z=7.50&view=political");
        expect(ziele).toHaveLength(1);
        expect(ziele[0]?.lage).toMatchObject({ center: { x: 450, y: 560 }, zoom: 7.5 });
        expect(ziele[0]?.wahl.view).toBe("political");
        ab();
        expect(fenster.hoerer()).toBe(0);
    });

    it("ohne newURL fällt es auf den Hash von jetzt zurück", () => {
        const fenster = fensterMitRueckgeschriebenemHash();
        const ziele: HashZiel[] = [];
        installHashFolgen(
            ["modern", "original"],
            () => "modern",
            (ziel) => ziele.push(ziel),
        );
        fenster.senden(undefined);
        expect(ziele[0]?.lage).toMatchObject({ center: { x: 349.044, y: 504 }, zoom: 2.5 });
    });
});
