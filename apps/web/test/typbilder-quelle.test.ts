import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_TYPE_IMAGES_PUBLIC_URL } from "@avesmaps3d/shared";
import {
    EINGEBAUTE_MASSE,
    artgrafikVon,
    istEigenesTypbild,
    ladeTypbilder,
    setzeTypbilderFuerTest,
    typbildVon,
    type Typbild,
} from "../src/info-panel/typbilder-quelle";

/**
 * Der Lesepfad der Typbilder für Besucher (WI-0068, Betreiber 2026-10-11). Geprüft wird das, was ein Infopanel kaputt machen würde:
 * eine fehlende Kategorie, eine kaputte Antwort, ein Serverfehler — in jedem Fall muss die eingebaute Grafik stehen bleiben.
 */

const antwort = (körper: unknown, ok = true, status = 200): Response =>
    ({ ok, status, json: () => Promise.resolve(körper) }) as Response;

afterEach(() => {
    setzeTypbilderFuerTest(undefined);
    vi.restoreAllMocks();
});

describe("Typbilder für Besucher", () => {
    it("nimmt das freigegebene Typbild und sonst die eingebaute Grafik", async () => {
        const holen = vi.fn(() =>
            Promise.resolve(
                antwort({
                    schemaVersion: 1,
                    images: { dorf: { url: "/media/abc.webp", width: 1600, height: 900 } },
                }),
            ),
        );
        await ladeTypbilder(holen as unknown as typeof fetch);
        expect(holen).toHaveBeenCalledWith(MEDIA_TYPE_IMAGES_PUBLIC_URL, {
            headers: { accept: "application/json" },
        });
        expect(typbildVon("dorf")).toEqual({ url: "/media/abc.webp", width: 1600, height: 900 });
        expect(istEigenesTypbild("dorf")).toBe(true);
        // Eine Kategorie ohne ★ fehlt in der Antwort: die eingebaute Datei des Releases.
        expect(typbildVon("wald")).toEqual({ url: "/icons/header/wald.webp", ...EINGEBAUTE_MASSE });
        expect(istEigenesTypbild("wald")).toBe(false);
    });

    it("🔴 fragt nur EINMAL, auch bei mehreren Aufrufen", async () => {
        const holen = vi.fn(() => Promise.resolve(antwort({ schemaVersion: 1, images: {} })));
        await Promise.all([
            ladeTypbilder(holen as unknown as typeof fetch),
            ladeTypbilder(holen as unknown as typeof fetch),
            ladeTypbilder(holen as unknown as typeof fetch),
        ]);
        expect(holen).toHaveBeenCalledTimes(1);
    });

    it("🔴 vor dem Laden steht die eingebaute Grafik - es gibt keinen Zustand ohne Bild", () => {
        expect(typbildVon("berggipfel").url).toBe("/icons/header/berggipfel.webp");
    });

    it("🔴 ein Serverfehler ist stumm: die eingebauten Grafiken bleiben", async () => {
        const holen = vi.fn(() => Promise.resolve(antwort({ error: {} }, false, 503)));
        await ladeTypbilder(holen as unknown as typeof fetch);
        expect(typbildVon("dorf").url).toBe("/icons/header/dorf.webp");
    });

    it("🔴 ein Netzfehler ist stumm und wirft nicht", async () => {
        const holen = vi.fn(() => Promise.reject(new TypeError("offline")));
        await expect(ladeTypbilder(holen as unknown as typeof fetch)).resolves.toBeUndefined();
        expect(typbildVon("dorf").url).toBe("/icons/header/dorf.webp");
    });

    it("🔴 wirft unbrauchbare Einträge weg, statt ein kaputtes Bild zu zeigen", async () => {
        const holen = vi.fn(() =>
            Promise.resolve(
                antwort({
                    schemaVersion: 1,
                    images: {
                        // Keine Kategorie des Vertrags.
                        erfunden: { url: "/media/x.webp", width: 10, height: 10 },
                        // Leere Adresse, fehlende und unsinnige Maße.
                        dorf: { url: "", width: 10, height: 10 },
                        wald: { url: "/media/w.webp" },
                        see: { url: "/media/s.webp", width: 0, height: 10 },
                        // Gültig.
                        stadt: { url: "/media/t.webp", width: 800, height: 450 },
                    },
                }),
            ),
        );
        await ladeTypbilder(holen as unknown as typeof fetch);
        expect(typbildVon("dorf").url).toBe("/icons/header/dorf.webp");
        expect(typbildVon("wald").url).toBe("/icons/header/wald.webp");
        expect(typbildVon("see").url).toBe("/icons/header/see.webp");
        expect(typbildVon("stadt").url).toBe("/media/t.webp");
    });

    it("hält eine Antwort ohne `images` aus", async () => {
        const holen = vi.fn(() => Promise.resolve(antwort({ schemaVersion: 1 })));
        await ladeTypbilder(holen as unknown as typeof fetch);
        expect(typbildVon("dorf").url).toBe("/icons/header/dorf.webp");
    });

    it("der Testsetzer füllt die Karte, ohne zu fragen", () => {
        const eintrag: Typbild = { url: "/media/q.webp", width: 100, height: 56 };
        setzeTypbilderFuerTest(new Map([["dorf", eintrag]]));
        expect(typbildVon("dorf")).toEqual(eintrag);
    });
});

/**
 * Typbildpaare (WI-0281, Betreiber 2026-11-05): Der Normalmodus zeigt `images` (KI-Variante, sonst Ohne-KI-Variante), der Modus „Ohne KI“ nur `ohneKi`.
 * 🔴 Im Modus „Ohne KI“ nie die KI-Variante und nie die eingebaute Grafik (die ist KI-erzeugt): sonst der Platzhalter.
 */
describe("Typbilder je Modus: Normalmodus und „Ohne KI“", () => {
    const KI = { url: "/media/sha256/aa/bb/ki.webp", width: 1600, height: 900 };
    const OHNE = { url: "/media/sha256/cc/dd/ohne.webp", width: 1200, height: 675 };
    const holenMit = (körper: unknown) => vi.fn(() => Promise.resolve(antwort(körper)));

    it("🔴 Kleinstadt mit beiden Varianten: der Normalmodus zeigt die KI-Variante, „Ohne KI“ das Nicht-KI-Typbild", async () => {
        await ladeTypbilder(
            holenMit({
                schemaVersion: 1,
                images: { kleinstadt: KI },
                ohneKi: { kleinstadt: OHNE },
            }) as unknown as typeof fetch,
        );
        expect(artgrafikVon("kleinstadt", false)).toEqual({ art: "bild", bild: KI });
        expect(artgrafikVon("kleinstadt", true)).toEqual({ art: "bild", bild: OHNE });
    });

    it("🔴 nur KI: „Ohne KI“ zeigt den Platzhalter, nie die KI-Variante", async () => {
        await ladeTypbilder(
            holenMit({ schemaVersion: 1, images: { krater: KI }, ohneKi: {} }) as unknown as typeof fetch,
        );
        expect(artgrafikVon("krater", false)).toEqual({ art: "bild", bild: KI });
        expect(artgrafikVon("krater", true)).toEqual({ art: "platzhalter" });
    });

    it("nur ohne KI: beide Modi zeigen sie (der Server legt sie im Normalmodus schon in `images`)", async () => {
        await ladeTypbilder(
            holenMit({
                schemaVersion: 1,
                images: { grotte: OHNE },
                ohneKi: { grotte: OHNE },
            }) as unknown as typeof fetch,
        );
        expect(artgrafikVon("grotte", false)).toEqual({ art: "bild", bild: OHNE });
        expect(artgrafikVon("grotte", true)).toEqual({ art: "bild", bild: OHNE });
    });

    it("🔴 keine Variante: der Normalmodus zeigt die eingebaute Grafik, „Ohne KI“ den Platzhalter", async () => {
        await ladeTypbilder(holenMit({ schemaVersion: 1, images: {}, ohneKi: {} }) as unknown as typeof fetch);
        expect(artgrafikVon("wueste", false)).toEqual({
            art: "bild",
            bild: { url: "/icons/header/wueste.webp", ...EINGEBAUTE_MASSE },
        });
        expect(artgrafikVon("wueste", true)).toEqual({ art: "platzhalter" });
    });

    it("🔴 solange die Karte lädt, steht im Modus „Ohne KI“ nur der Grund: kein KI-Bild blitzt auf", () => {
        expect(artgrafikVon("dorf", true)).toEqual({ art: "laedt" });
        expect(artgrafikVon("dorf", false).art).toBe("bild");
    });

    it("🔴 ein Server der Vorversion (ohne `ohneKi`) und ein Fehlschlag: „Ohne KI“ zeigt den Platzhalter", async () => {
        await ladeTypbilder(holenMit({ schemaVersion: 1, images: { dorf: KI } }) as unknown as typeof fetch);
        expect(artgrafikVon("dorf", true)).toEqual({ art: "platzhalter" });
        setzeTypbilderFuerTest(undefined);
        await ladeTypbilder(vi.fn(() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch);
        expect(artgrafikVon("dorf", true)).toEqual({ art: "platzhalter" });
        expect(artgrafikVon("dorf", false).art).toBe("bild");
    });

    it("die Nennung kommt als eine Zeile mit, wo die Rechte sie verlangen (ein Foto unter CC BY)", async () => {
        await ladeTypbilder(
            holenMit({
                schemaVersion: 1,
                images: { kueste: { ...OHNE, credit: { creator: "Rahja", licenseName: "CC BY 4.0" } } },
                ohneKi: { kueste: { ...OHNE, credit: { attribution: "Foto: Rahja, CC BY 4.0" } } },
            }) as unknown as typeof fetch,
        );
        expect(artgrafikVon("kueste", false)).toEqual({ art: "bild", bild: { ...OHNE, credit: "Rahja, CC BY 4.0" } });
        expect(artgrafikVon("kueste", true)).toEqual({
            art: "bild",
            bild: { ...OHNE, credit: "Foto: Rahja, CC BY 4.0" },
        });
    });
});
