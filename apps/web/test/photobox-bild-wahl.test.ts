import { describe, expect, it, vi } from "vitest";
import { erzeugeBildWahl, type BildHalter } from "../src/photobox/bild-wahl.ts";
import type { BildErgebnis, GewaehltesBild } from "../src/photobox/bild.ts";
import { ENTSTEHUNG_ZEICHEN, LINIEN_ZEICHEN, NUTZUNG_ZEICHEN } from "../src/photobox/reisebild-zeichen.ts";
import { PHOTOBOX_CREATION_KINDS, PHOTOBOX_USAGE_GRANTS } from "@avesmaps3d/shared";

/**
 * Die Wahl des Bildes im Formular „Eigenes Bild hinzufügen“ ohne Browser (WI-0272, Entwurf 8): lesen, die Vorschau samt Freigabe, der Grund, wenn es nicht geht; dazu die Zeichen des Formulars.
 * Wie das Bild vorbereitet wird, steht in `photobox-formular.test.ts` („das Bild: nur vier Formate …“).
 */

const BILD: GewaehltesBild = {
    datei: { name: "reisebild.webp", dataBase64: "AAAA" },
    breite: 64,
    hoehe: 48,
    anzeigeName: "Urlaub mit Oma IMG_0042.png",
};
const datei = (name = "a.png"): File => new File(["x"], name, { type: "image/png" });

function aufbau(ergebnis: BildErgebnis | Promise<BildErgebnis> = { ok: true, bild: BILD }) {
    const halter: BildHalter = { bild: undefined };
    const urls: string[] = [];
    const frei: string[] = [];
    const bereite = vi.fn(() => Promise.resolve(ergebnis));
    const wahl = erzeugeBildWahl(halter, {
        bereite,
        erzeugeUrl: () => {
            const url = `blob:vorschau-${String(urls.length + 1)}`;
            urls.push(url);
            return url;
        },
        gibUrlFrei: (url) => frei.push(url),
    });
    return { halter, wahl, urls, frei, bereite };
}

describe("die Wahl des Bildes", () => {
    it("🔴 ein gewähltes Bild liegt im Entwurf, die Vorschau gehört dem Fenster, nicht dem Formular", async () => {
        const { halter, wahl, urls } = aufbau();
        expect(wahl.laedt.value).toBe(false);
        const gelesen = wahl.waehle(datei());
        expect(wahl.laedt.value).toBe(true);
        await gelesen;
        expect(wahl.laedt.value).toBe(false);
        expect(halter.bild).toBe(BILD);
        expect(wahl.vorschauUrl.value).toBe(urls[0]);
        expect(wahl.fehler.value).toBeUndefined();
    });

    it("während gelesen wird, tut ein zweiter Aufruf nichts; ohne Datei auch nicht", async () => {
        const { wahl, bereite } = aufbau();
        const erste = wahl.waehle(datei());
        await wahl.waehle(datei("b.png"));
        await wahl.waehle(undefined);
        await erste;
        expect(bereite).toHaveBeenCalledTimes(1);
    });

    it("ein anderes Bild gibt die alte Vorschau frei, „Entfernen“ die letzte und leert den Entwurf", async () => {
        const { halter, wahl, urls, frei } = aufbau();
        await wahl.waehle(datei());
        await wahl.waehle(datei("b.png"));
        expect(urls).toHaveLength(2);
        expect(frei).toEqual([urls[0]]);
        expect(wahl.vorschauUrl.value).toBe(urls[1]);
        wahl.entferne();
        expect(halter.bild).toBeUndefined();
        expect(wahl.vorschauUrl.value).toBeUndefined();
        expect(frei).toEqual([urls[0], urls[1]]);
        wahl.entferne();
        expect(frei).toHaveLength(2);
    });

    it("🔴 ein Bild, das nicht geht, nennt seinen Grund und lässt das gewählte stehen; die nächste Wahl räumt den Grund weg", async () => {
        const { halter, wahl, bereite, urls } = aufbau();
        await wahl.waehle(datei());
        expect(halter.bild).toBe(BILD);

        bereite.mockImplementationOnce(() => Promise.resolve({ ok: false, grund: "zu_gross" }));
        await wahl.waehle(datei("gross.png"));
        expect(wahl.fehler.value).toBe("photobox.bild.fehler.zuGross");
        expect(halter.bild).toBe(BILD);
        expect(wahl.vorschauUrl.value).toBe(urls[0]);
        expect(wahl.laedt.value).toBe(false);

        bereite.mockImplementationOnce(() => Promise.resolve({ ok: false, grund: "kein_bild" }));
        await wahl.waehle(datei("karte.svg"));
        expect(wahl.fehler.value).toBe("photobox.bild.fehler.keinBild");

        await wahl.waehle(datei("gut.png"));
        expect(wahl.fehler.value).toBeUndefined();
        expect(urls).toHaveLength(2);
    });

    it("gibFrei räumt die Vorschau weg, wenn das Fenster geht", async () => {
        const { wahl, urls, frei } = aufbau();
        await wahl.waehle(datei());
        wahl.gibFrei();
        expect(frei).toEqual([urls[0]]);
        expect(wahl.vorschauUrl.value).toBeUndefined();
    });
});

describe("die Zeichen des Formulars", () => {
    it("jede Art und jede Nutzung hat ein Linienzeichen, und jedes Zeichen hat Formen", () => {
        for (const art of PHOTOBOX_CREATION_KINDS)
            expect(LINIEN_ZEICHEN[ENTSTEHUNG_ZEICHEN[art]].length, art).toBeGreaterThan(0);
        for (const nutzung of PHOTOBOX_USAGE_GRANTS)
            expect(LINIEN_ZEICHEN[NUTZUNG_ZEICHEN[nutzung]].length, nutzung).toBeGreaterThan(0);
        for (const [name, formen] of Object.entries(LINIEN_ZEICHEN)) expect(formen.length, name).toBeGreaterThan(0);
    });

    it("die Zeichen sind Daten (Pfade, Kreise, Rechtecke), nie ein HTML-Text", () => {
        for (const formen of Object.values(LINIEN_ZEICHEN)) {
            for (const form of formen) {
                if (form.art === "pfad") expect(form.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/u);
            }
        }
    });
});
