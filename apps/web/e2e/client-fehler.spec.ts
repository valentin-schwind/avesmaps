import { expect, test, type Page, type Request } from "@playwright/test";
import { CLIENT_FEHLER_ARTEN, GRAFIK_KLASSEN } from "@avesmaps3d/shared";
import { openMap } from "./map-handle.ts";

/**
 * Fehler im Browser erfassen (WI-0202): Ein künstlicher Fehler erzeugt **genau eine** bereinigte Meldung.
 *
 * 🔴 **Warum im Browser:** Die Bereinigung prüft Vitest (`client-fehler.test.ts`), die Annahme der Server
 * (`besucher-diagnosen.test.ts`). Ob der Fänger am Fenster hängt, die Grenze je Seite hält und die Meldung wirklich hinausgeht,
 * sieht nur die Naht im Browser (dieselbe Lehre wie `besuch-zaehlung.spec.ts`).
 */

interface Koerper {
    ereignisse: { metrik: string; dimension?: string }[];
    fehler?: { art: string; name: string; meldung: string; stellen: string[]; grafik?: string }[];
}

function horchen(page: Page): Koerper[] {
    const koerper: Koerper[] = [];
    page.on("request", (anfrage: Request) => {
        if (!anfrage.url().endsWith("/api/besuch") || anfrage.method() !== "POST") return;
        const roh = anfrage.postData();
        if (roh !== null) koerper.push(JSON.parse(roh) as Koerper);
    });
    return koerper;
}

const diagnosen = (koerper: readonly Koerper[]) => koerper.flatMap((eintrag) => eintrag.fehler ?? []);
const zaehlungen = (koerper: readonly Koerper[]) =>
    koerper.flatMap((eintrag) => eintrag.ereignisse).filter((ereignis) => ereignis.metrik === "client_fehler");

test("🔴 ein künstlicher Fehler erzeugt genau eine bereinigte Meldung, auch dreimal geworfen", async ({ page }) => {
    const koerper = horchen(page);
    await openMap(page);

    // Dreimal derselbe Fehler aus einem Zeitgeber: unbehandelt, nach dem Start, mit Eingabe, Zahl und Adresse.
    await page.evaluate(() => {
        for (let mal = 0; mal < 3; mal += 1) {
            setTimeout(() => {
                throw new TypeError(
                    "Ort 'Gareth Stadt' bei 51.23 nicht gefunden, siehe https://avesmaps.de/#map=8/51.2/7.1&q=gareth",
                );
            }, 0);
        }
    });

    await expect.poll(() => diagnosen(koerper).length, { timeout: 15_000 }).toBe(1);
    // Die Fänger schicken nach einer Sekunde; was danach noch käme, wäre eine zweite Meldung.
    await page.waitForTimeout(2_500);
    expect(diagnosen(koerper)).toHaveLength(1);
    expect(zaehlungen(koerper)).toEqual([{ metrik: "client_fehler", dimension: "unbehandelt" }]);

    const [diagnose] = diagnosen(koerper);
    expect(diagnose).toMatchObject({
        art: "unbehandelt",
        name: "TypeError",
        meldung: "Ort '<text>' bei # nicht gefunden, siehe <adresse>",
    });
    expect(CLIENT_FEHLER_ARTEN).toContain(diagnose?.art);
    expect(GRAFIK_KLASSEN).toContain(diagnose?.grafik);
    // Nur Stellen im eigenen Bündel; der Code aus `evaluate` ist keins.
    for (const stelle of diagnose?.stellen ?? []) expect(stelle).toMatch(/^(assets|src)\//);

    // Nichts davon verlässt den Browser: keine Eingabe, keine Zahl, keine Adresse, kein Kartenausschnitt.
    const gesendet = JSON.stringify(koerper.filter((eintrag) => eintrag.fehler !== undefined));
    for (const verboten of ["Gareth", "51.23", "avesmaps.de", "#map=", "q=gareth", location()]) {
        expect(gesendet).not.toContain(verboten);
    }

    function location(): string {
        return new URL(page.url()).host;
    }
});

test("ein abgebrochener Abruf ist kein Fehler", async ({ page }) => {
    const koerper = horchen(page);
    await openMap(page);
    await page.evaluate(() => {
        void Promise.reject(new DOMException("überholt", "AbortError"));
    });
    await page.waitForTimeout(2_500);
    expect(diagnosen(koerper)).toEqual([]);
    expect(zaehlungen(koerper)).toEqual([]);
});
