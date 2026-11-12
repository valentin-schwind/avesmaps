import { expect, test, type Page } from "@playwright/test";
import { AVENTURIA_POLITICAL_CARTOGRAPHY, politicalMinZoom } from "@avesmaps3d/shared";
import { GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * Die Bänder der Herrschaftsgebiete am Telefon (WI-0062, Betreiber 2026-09-30: „kannst du fürs handy 4 und für desktop 5
 * machen?“): Der Vorzug hängt am Gerät. Am Telefon (grober Zeiger, kurze Bildschirmseite bis 600 px) beginnen die
 * Baronien (Band 4) bei Zoom 4, am Rechner bei Zoom 5 (`territories.spec.ts`).
 */

const TELEFON_VORZUG = AVENTURIA_POLITICAL_CARTOGRAPHY.bandLeadZoomPhone;
const RECHNER_VORZUG = AVENTURIA_POLITICAL_CARTOGRAPHY.bandLeadZoom;

interface BandKarte {
    getPaintProperty(layer: string, property: string): unknown;
    style: { getGlobalState(): Record<string, number> };
}

async function requireTerritories(page: Page): Promise<void> {
    const antwort = await page.request.get("/api/territories/current");
    if (antwort.status() !== 200) {
        throw new Error(
            "Keine abgeleiteten Herrschaftsgebiete: erst npm run derive:territories, danach Martin neu starten.",
        );
    }
}

async function politischGewaehlt(page: Page): Promise<void> {
    await page.getByTestId("fan-toggle").tap();
    await page.getByTestId("fan-view-political").tap();
    await expect(page.getByTestId("fan-menu")).toBeHidden();
    await expect(page.getByTestId("fan-toggle")).toContainText("Politisch");
}

/** Das Band der Ansicht (globaler Zustand des Stils). */
async function band(page: Page): Promise<number> {
    return page.evaluate(
        () => (globalThis.avesmapsMap as unknown as BandKarte).style.getGlobalState()["territoryBand"] as number,
    );
}

/** Wo das Band 1 in den Stufen der Grenzbreiten beginnt: das erste Stufenpaar des Ausdrucks (`["step", ["zoom"], a, ab, b, …]`). */
async function ersteStufe(page: Page): Promise<number> {
    return page.evaluate(() => {
        const ausdruck = (globalThis.avesmapsMap as unknown as BandKarte).getPaintProperty(
            "territory-border-outer",
            "line-width",
        ) as unknown[];
        return ausdruck[3] as number;
    });
}

async function gezeichneteNamen(page: Page): Promise<string[]> {
    await page.waitForFunction(
        () => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["territory-fill"] }).length ?? 0) > 0,
        undefined,
        { timeout: 30_000 },
    );
    return page.evaluate(() => [
        ...new Set(
            globalThis
                .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-fill"] })
                .map((feature) => String(feature.properties["name"])),
        ),
    ]);
}

test("🔴 am Telefon kommen die Baronien ab Zoom 4 (am Rechner erst ab 5)", async ({ page }) => {
    await requireTerritories(page);
    await openMap(page);
    expect(await page.evaluate(() => globalThis.matchMedia("(pointer: coarse)").matches), "grober Zeiger").toBe(true);
    await politischGewaehlt(page);
    const beginn = politicalMinZoom(4, TELEFON_VORZUG);
    expect(beginn, "die Baronien beginnen am Telefon bei Zoom 4").toBe(4);
    expect(politicalMinZoom(4, RECHNER_VORZUG), "am Rechner bei Zoom 5").toBe(5);

    // Knapp darunter: Band 3, Provinzen, keine Baronie.
    await showPlace(page, GARETH, beginn - 0.1);
    expect(await band(page)).toBe(3);
    expect((await gezeichneteNamen(page)).filter((name) => name.startsWith("Baronie"))).toEqual([]);
    // Ab Zoom 4: Band 4 mit Baronien (am Rechner wäre hier noch Band 3).
    await showPlace(page, GARETH, beginn + 0.1);
    expect(await band(page)).toBe(4);
    expect((await gezeichneteNamen(page)).filter((name) => name.startsWith("Baronie")).length).toBeGreaterThan(0);
    // Die Stufen der Grenzbreiten liegen auf derselben Abbildung: Band 1 beginnt am Telefon bei Zoom 1.
    expect(await ersteStufe(page)).toBe(politicalMinZoom(1, TELEFON_VORZUG));
});

test("🔴 ein Wechsel über die Telefongrenze (Fenstergröße bei grobem Zeiger) baut die Stufen neu und führt das Band nach", async ({
    page,
}) => {
    await requireTerritories(page);
    await openMap(page);
    await politischGewaehlt(page);
    // Am Telefon: Zoom 4,5 ist Band 4, und Band 1 beginnt bei Zoom 1.
    await showPlace(page, GARETH, 4.5);
    expect(await band(page)).toBe(4);
    expect(await ersteStufe(page)).toBe(politicalMinZoom(1, TELEFON_VORZUG));

    // Aufgezogen auf über 600 px Kurzseite ist es kein Telefon mehr: Vorzug des Rechners, Zoom 4,5 ist Band 3.
    await page.setViewportSize({ width: 900, height: 700 });
    await expect.poll(() => band(page), { timeout: 15_000 }).toBe(3);
    await expect.poll(() => ersteStufe(page), { timeout: 15_000 }).toBe(politicalMinZoom(1, RECHNER_VORZUG));

    // Und zurück: wieder das Telefon.
    await page.setViewportSize({ width: 412, height: 915 });
    await expect.poll(() => band(page), { timeout: 15_000 }).toBe(4);
    await expect.poll(() => ersteStufe(page), { timeout: 15_000 }).toBe(politicalMinZoom(1, TELEFON_VORZUG));
});
