import { describe, expect, it } from "vitest";
import type { ReisebildKarte } from "@avesmaps3d/shared";
import { de } from "../src/i18n/de.ts";
import { ansichtZeile, ortBezug } from "../src/photobox/reisebild-ansicht-modell.ts";
import type { Uebersetzer } from "../src/photobox/stelle-text.ts";

/**
 * Die Zeile der Bildansicht der Reisebilder (WI-0272 S4, Aufgabe 30): die Texte je Eingabe, ohne Browser.
 *
 * Problemfälle: ohne Namen steht eine leere Nennung statt „anonym“; ein KI-Bild heißt nur „Foto“ oder gar nichts; die Lizenz steht ohne CC BY oder fehlt bei CC BY; ein Datum, das die Antwort gar nicht trägt,
 * taucht auf; eine Blickrichtung falsch herum (0 ist Norden, im Uhrzeigersinn); die Stelle fehlt, obwohl der Ort bekannt ist, oder sie steht mit einem erfundenen Ort.
 */

/** Der deutsche Text, Parameter eingesetzt: Es gilt, was der Besucher liest. */
const uebersetze: Uebersetzer = (key, params) => {
    const roh = (de as Record<string, string>)[key] ?? key;
    return roh.replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? `{${name}}`));
};

const bild = (extra: Partial<ReisebildKarte> = {}): ReisebildKarte => ({
    id: "00000000-0000-4000-8000-000000000001",
    lage: { x: 551.625, y: 532.969 },
    datei: { url: "/media/published/a.webp", breite: 2048, hoehe: 1365 },
    beschreibung: "Die Reichsstraße im Abendlicht",
    entstehung: "drawing",
    ...extra,
});

const gareth = {
    id: "00000000-0000-4000-8000-0000000000aa",
    name: "Gareth",
    subtype: "metropole",
    lage: { x: 551.625, y: 532.969 },
};

describe("Zeile der Bildansicht", () => {
    it("🔴 ohne Namen steht „anonym“ in der Nennung, mit Namen der Name", () => {
        expect(ansichtZeile(bild(), uebersetze).nennung).toBe("Bild von anonym");
        expect(ansichtZeile(bild({ name: "   " }), uebersetze).nennung).toBe("Bild von anonym");
        expect(ansichtZeile(bild({ name: "Avesmaps-Beispiel" }), uebersetze).nennung).toBe(
            "Bild von Avesmaps-Beispiel",
        );
    });

    it("Titel ist die Beschreibung; die Entstehung kommt aus der Tafel des Formulars", () => {
        const z = ansichtZeile(bild(), uebersetze);
        expect(z.titel).toBe("Die Reichsstraße im Abendlicht");
        expect(z.teile[0]).toBe("Gemalt oder gezeichnet");
        expect(ansichtZeile(bild({ entstehung: "photo" }), uebersetze).teile[0]).toBe("Foto");
        expect(ansichtZeile(bild({ entstehung: "avesmaps_capture" }), uebersetze).teile[0]).toBe("Avesmaps-Aufnahme");
    });

    it("🔴 ein KI-Bild heißt ausdrücklich „KI-Bild“", () => {
        expect(ansichtZeile(bild({ entstehung: "ai_generated" }), uebersetze).teile[0]).toBe("KI-Bild");
    });

    it("die Stelle aus dem Ort des Bildes: im Ort oder in Himmelsrichtung; ohne Ort fehlt der Teil", () => {
        const im = ansichtZeile(bild({ ort: gareth }), uebersetze);
        expect(im.teile).toContain("in Gareth");
        const ostlich = ansichtZeile(bild({ lage: { x: 580, y: 533 }, ort: gareth }), uebersetze);
        expect(ostlich.teile.some((t) => t.includes("östlich von Gareth"))).toBe(true);
        // Ohne Ort und ohne nächsten Ort: nur die Entstehung.
        expect(ansichtZeile(bild(), uebersetze).teile).toEqual(["Gemalt oder gezeichnet"]);
        // Der nächste Ort ersetzt den fehlenden.
        const naechster = ortBezug(bild({ ort: gareth }))!;
        expect(ansichtZeile(bild(), uebersetze, naechster).teile).toContain("in Gareth");
    });

    it("die Blickrichtung: 0 ist Norden, 2 Osten, 7 Nordwesten; ohne Angabe kein Teil", () => {
        const blick = (n: number): string | undefined =>
            ansichtZeile(bild({ blickrichtung: n }), uebersetze).teile.find((t) => t.startsWith("Blick nach"));
        expect(blick(0)).toBe("Blick nach Norden");
        expect(blick(2)).toBe("Blick nach Osten");
        expect(blick(7)).toBe("Blick nach Nordwesten");
        expect(ansichtZeile(bild(), uebersetze).teile.some((t) => t.startsWith("Blick"))).toBe(false);
    });

    it("🔴 die Lizenz steht nur bei CC BY, mit Adresse, wo der Server sie nennt; kein Datum", () => {
        expect(ansichtZeile(bild(), uebersetze).lizenz).toBeUndefined();
        const mit = ansichtZeile(
            bild({ lizenz: { name: "CC BY 4.0", uri: "https://creativecommons.org/licenses/by/4.0/" } }),
            uebersetze,
        );
        expect(mit.lizenz).toEqual({
            text: "Lizenz: CC BY 4.0",
            uri: "https://creativecommons.org/licenses/by/4.0/",
        });
        expect(ansichtZeile(bild({ lizenz: { name: "CC BY 4.0" } }), uebersetze).lizenz).toEqual({
            text: "Lizenz: CC BY 4.0",
        });
        const alles = JSON.stringify(ansichtZeile(bild({ ort: gareth, blickrichtung: 3 }), uebersetze));
        expect(alles).not.toMatch(/\b20\d\d\b/u);
    });
});
