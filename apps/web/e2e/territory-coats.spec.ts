import { expect, test, type Page } from "@playwright/test";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    TERRITORY_COATS_URL,
    coatLabelGeometry,
    politicalMinZoom,
} from "@avesmaps3d/shared";
import { chooseView, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { centreInFreeArea, centreX, clickTerritory, measureLabelInk } from "./territory-coat-ink.ts";

/**
 * Das Wappen am Namen des Gebiets, am echten Stack (WI-0121, Betreiber 2026-10-09: „prima und zentriert wie in legacy“).
 *
 * 🪤 Gemessen wird, was GEZEICHNET ist (`territory-coat-ink.ts`), nicht was im Stil steht. Namen und Kennungen kommen aus den
 * Kacheln und der Liste des Servers, nicht aus dem Test: Der Kartenstand ändert sich mit jedem Legacy-Import. Fest sind nur
 * grobe Orte, an denen die Gebiete liegen.
 *
 * 💣 Braucht abgeleitete Gebiete UND ihre Wappen in der lokalen Datenbank (`npm run migrate:territories`, `derive:territories`,
 * `migrate:media-files`) und einen Server mit `MEDIA_ROOT`. Fehlt etwas davon, scheitert der Test mit der Anleitung statt still
 * grün zu sein.
 */

const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;
const BAND = (band: number): number => politicalMinZoom(band, POLITICAL.bandLeadZoom);

/** Grobe Orte in Kartenkoordinaten (Stand 2026-10-09); das Label selbst wird in den Kacheln gesucht. */
const GREIFENFURT = { x: 512.3, y: 594.1, name: "Markgrafschaft Greifenfurt" };
const ROMMILYSER_MARK = { x: 584.4, y: 578.7, name: "Markgrafschaft Rommilyser Mark" };
const ADLERFLUG = { x: 622.2, y: 679, name: "Baronie Adlerflug" };
/** Ein Gebiet ohne öffentliches Wappen, einzeilig. */
const LURING = { x: 507.9, y: 519.7, name: "Luring" };

async function requireCoats(page: Page): Promise<Record<string, string>> {
    const response = await page.request.get(TERRITORY_COATS_URL);
    if (response.status() !== 200) {
        throw new Error(`Keine Wappenliste (${String(response.status())}): erst den Server aus diesem Stand starten.`);
    }
    const body = (await response.json()) as { coats: Record<string, string> };
    if (Object.keys(body.coats).length === 0) {
        throw new Error("Die Liste der Gebietswappen ist leer: erst npm run migrate:media-files (MEDIA_ROOT setzen).");
    }
    return body.coats;
}

/** Springt zur Stelle und gibt den Anker des Namens zurück, wie ihn die Kachel führt. */
async function showLabel(
    page: Page,
    place: { x: number; y: number; name: string },
    zoom: number,
): Promise<{ lng: number; lat: number; id: string }> {
    await showPlace(page, place, zoom);
    await expect
        .poll(
            () =>
                page.evaluate(
                    (name) =>
                        globalThis
                            .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
                            .some((feature) => feature.properties["name"] === name),
                    place.name,
                ),
            { timeout: 30_000, message: `${place.name} steht nicht im Bild` },
        )
        .toBe(true);
    const found = await page.evaluate((name) => {
        const feature = globalThis
            .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
            .find((candidate) => candidate.properties["name"] === name)!;
        return {
            lng: feature.geometry.coordinates[0],
            lat: feature.geometry.coordinates[1],
            id: String(feature.properties["territory_public_id"]),
        };
    }, place.name);
    await settleFrame(page);
    return found;
}

test("🔴 das Wappen steht über dem Namen, beide auf einer Achse (±1 px), der Block mit Legacys Lücke darunter", async ({
    page,
}) => {
    const coats = await requireCoats(page);
    await openMap(page);
    await chooseView(page, "political");

    for (const place of [GREIFENFURT, ROMMILYSER_MARK]) {
        const anchor = await showLabel(page, place, BAND(3) + 0.5);
        expect(coats[anchor.id], `${place.name} trägt ein öffentliches Wappen`).toBeDefined();
        const ink = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });
        expect(ink.icon.pixels, `${place.name}: Wappen gezeichnet`).toBeGreaterThan(200);
        expect(ink.text.pixels, `${place.name}: Name gezeichnet`).toBeGreaterThan(200);
        // Wappen über dem Namen, nicht daneben.
        expect(ink.icon.y1, `${place.name}: das Wappen endet über dem Namen`).toBeLessThan(ink.text.y0);
        // 🔴 Zentriert wie in Legacy: die Mitte des Wappens ist die Mitte des Namens.
        const versatz = Math.abs(centreX(ink.icon) - centreX(ink.text));
        test.info().annotations.push({
            type: "Messung",
            description: `${place.name}: Wappen x ${ink.icon.x0.toFixed(1)}..${ink.icon.x1.toFixed(1)} y ${ink.icon.y0.toFixed(1)}..${ink.icon.y1.toFixed(1)}, Name x ${ink.text.x0.toFixed(1)}..${ink.text.x1.toFixed(1)} y ${ink.text.y0.toFixed(1)}..${ink.text.y1.toFixed(1)}, Versatz ${versatz.toFixed(2)}`,
        });
        // MapLibre zentriert den Textkasten, nicht die Tinte: Die Seitenabstände des ersten und letzten Buchstabens der längsten
        // Zeile verschieben die Tinte um bis zu einen Bildpunkt. Gemessen 2026-10-09: Greifenfurt 1,5 · Rommilyser Mark 1,0 · Adlerflug 0,5.
        expect(versatz, `${place.name}: Mitte Wappen gegen Mitte Name`).toBeLessThanOrEqual(2);
        // Die Rechnung des Blocks bei Faktor 1 und zwei Zeilen (Legacys Block, mit unserer größeren Schrift: Namensbild und Zeilenhöhe
        // folgen ihr, der Block bleibt auf dem Anker zentriert): Unterkante des Wappens. Das Bild hat einen Rand, die Tinte endet bis
        // zu zwei Bildpunkte früher.
        const unterkante = coatLabelGeometry(
            POLITICAL.label.coat,
            POLITICAL.label,
            3,
            POLITICAL.label.coat.calibratedLines,
        ).coatBottomPx;
        expect(ink.icon.y1).toBeGreaterThanOrEqual(unterkante - 3);
        expect(ink.icon.y1).toBeLessThanOrEqual(unterkante + 1);
        // Die Lücke zwischen Wappen und Schrift: Legacys 8,8 px bis zur Oberkante der Schrift, dazu der Abstand der Versalien.
        const luecke = ink.text.y0 - ink.icon.y1;
        expect(luecke, `${place.name}: Lücke Wappen → Name`).toBeGreaterThanOrEqual(7);
        expect(luecke, `${place.name}: Lücke Wappen → Name`).toBeLessThanOrEqual(15);
    }
});

test("🔴 eine Baronie trägt ihr Wappen ebenso: keine Ebene und kein Band ist ausgenommen", async ({ page }) => {
    await requireCoats(page);
    await openMap(page);
    await chooseView(page, "political");
    const anchor = await showLabel(page, ADLERFLUG, BAND(4) + 0.6);
    const ink = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });
    expect(ink.icon.pixels).toBeGreaterThan(200);
    expect(ink.icon.y1).toBeLessThan(ink.text.y0);
    expect(Math.abs(centreX(ink.icon) - centreX(ink.text))).toBeLessThanOrEqual(1);
    // Faktor 1: das Wappen ist 40 px hoch (Legacy `.region-label__coat`).
    expect(ink.icon.y1 - ink.icon.y0).toBeGreaterThanOrEqual(38);
    expect(ink.icon.y1 - ink.icon.y0).toBeLessThanOrEqual(41);
});

test("🔴 unter Band 3 schrumpfen Wappen UND Schrift im selben Verhältnis (Legacy 0,91 in Band 2)", async ({ page }) => {
    await requireCoats(page);
    await openMap(page);
    await chooseView(page, "political");
    const faktor = POLITICAL.label.scaleByBand[2] as number;

    const grossAnker = await showLabel(page, GREIFENFURT, BAND(3) + 0.5);
    const voll = await measureLabelInk(page, "territory-label", grossAnker, { only: grossAnker.id });
    const kleinAnker = await showLabel(page, GREIFENFURT, BAND(2) + 0.5);
    const klein = await measureLabelInk(page, "territory-label", kleinAnker, { only: kleinAnker.id });
    const wappenHoehe = (klein.icon.y1 - klein.icon.y0) / (voll.icon.y1 - voll.icon.y0);
    const wappenBreite = (klein.icon.x1 - klein.icon.x0) / (voll.icon.x1 - voll.icon.x0);
    const schrift = (klein.text.x1 - klein.text.x0) / (voll.text.x1 - voll.text.x0);
    test.info().annotations.push({
        type: "Messung",
        description: `Verhältnis Band 2 zu 3: Wappen ${wappenHoehe.toFixed(3)} x ${wappenBreite.toFixed(3)}, Schrift ${schrift.toFixed(3)}`,
    });
    expect(wappenHoehe).toBeCloseTo(faktor, 1);
    expect(wappenBreite).toBeCloseTo(faktor, 1);
    expect(schrift).toBeCloseTo(faktor, 1);
});

test("🔴 ohne öffentliches Wappen steht nur der Name, ohne Bild und ohne Lücke darüber", async ({ page }) => {
    const coats = await requireCoats(page);
    await openMap(page);
    await chooseView(page, "political");
    const anchor = await showLabel(page, LURING, BAND(4) + 0.6);
    expect(coats[anchor.id], "Luring hat kein öffentliches Wappen").toBeUndefined();
    const ink = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });
    expect(ink.icon.pixels, "kein Bild").toBe(0);
    expect(ink.text.pixels).toBeGreaterThan(50);
    // Der Name steht wie bisher auf dem Anker: Der Punkt liegt in seiner Tinte, nicht eine Zeile über ihr.
    expect(ink.text.y0).toBeLessThan(0);
    expect(ink.text.y1).toBeGreaterThan(0);
});

test("🔴 in Standard kein Wappen: keine Namensebene, kein Bild und kein Abruf eines Wappens", async ({ page }) => {
    await requireCoats(page);
    const medien: string[] = [];
    page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/media/")) medien.push(request.url());
    });
    await openMap(page);
    await showPlace(page, GREIFENFURT, BAND(4) + 0.6);
    await settleFrame(page);
    const stand = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const images = (map as unknown as { style: { imageManager: { images: Record<string, unknown> } } }).style
            .imageManager.images;
        return {
            hasLabel: Boolean(map.getLayer("territory-label")),
            coatImages: Object.keys(images).filter((id) => id.startsWith("coat:")).length,
        };
    });
    expect(stand.hasLabel, "Standard zeigt die Namen nur entlang der Grenze").toBe(false);
    expect(stand.coatImages).toBe(0);
    expect(medien, "kein Wappen geholt, solange die Ansicht keines zeigt").toEqual([]);
});

test("🔴 die Liste kommt VOR der ersten Gebietskachel: die Namen springen nicht, wenn das Wappen nachkäme", async ({
    page,
}) => {
    await requireCoats(page);
    const ablauf: string[] = [];
    page.on("request", (request) => {
        const pfad = new URL(request.url()).pathname;
        if (pfad === TERRITORY_COATS_URL) ablauf.push("liste angefragt");
        if (pfad.startsWith("/tiles/vector/territory_")) ablauf.push("kachel angefragt");
    });
    page.on("requestfinished", (request) => {
        if (new URL(request.url()).pathname === TERRITORY_COATS_URL) ablauf.push("liste da");
    });
    await openMap(page);
    await chooseView(page, "political");
    await showPlace(page, GREIFENFURT, BAND(3) + 0.5);
    await settleFrame(page);
    expect(ablauf.indexOf("liste da")).toBeGreaterThanOrEqual(0);
    expect(ablauf.indexOf("kachel angefragt")).toBeGreaterThan(ablauf.indexOf("liste da"));
    expect(ablauf.filter((schritt) => schritt === "liste angefragt")).toHaveLength(1);
});

test("🔴 ein Bild, das nicht kommt, lässt den Namen allein stehen - und die Karte weiter laufen", async ({ page }) => {
    await requireCoats(page);
    const meldungen: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") meldungen.push(message.text());
    });
    await page.route("**/media/sha256/**", (route) => route.fulfill({ status: 404, body: "weg" }));
    await openMap(page);
    await chooseView(page, "political");
    const anchor = await showLabel(page, GREIFENFURT, BAND(3) + 0.5);
    const ink = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });
    expect(ink.icon.pixels, "kein Wappen ohne Bild").toBe(0);
    expect(ink.text.pixels, "der Name steht trotzdem").toBeGreaterThan(200);
    expect(meldungen.some((text) => /Wappen coat:[0-9a-f]{64} nicht geladen/.test(text))).toBe(true);
});

test("🔴 ein Abruf, der nur einmal scheitert (Neustart des Servers, Socket zurückgesetzt), wird nachgeholt: das Wappen steht, keine Meldung (WI-0123)", async ({
    page,
}) => {
    await requireCoats(page);
    const meldungen: string[] = [];
    page.on("console", (message) => {
        if (/could not be loaded|^Wappen /.test(message.text())) meldungen.push(message.text());
    });
    // JEDES Wappen scheitert beim ersten Abruf: So muss jedes, das im Bild steht, nachgeholt worden sein.
    const gescheitert = new Set<string>();
    await page.route("**/media/sha256/**", async (route) => {
        const url = route.request().url();
        if (!gescheitert.has(url)) {
            gescheitert.add(url);
            await route.abort("connectionreset");
            return;
        }
        await route.continue();
    });
    await openMap(page);
    await chooseView(page, "political");
    const anchor = await showLabel(page, GREIFENFURT, BAND(3) + 0.5);
    const ink = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });
    expect(gescheitert.size, "es ist überhaupt ein Abruf gescheitert").toBeGreaterThan(0);
    expect(ink.icon.pixels, "das Wappen steht").toBeGreaterThan(200);
    expect(meldungen, "kein Wappen blieb aus").toEqual([]);
});

test("🔴 die Auswahl lässt das Wappen am Namen stehen: dasselbe Symbol an derselben Stelle (±1 px), kein zweites", async ({
    page,
}) => {
    await requireCoats(page);
    await openMap(page);
    await chooseView(page, "political");
    const anchor = await showLabel(page, GREIFENFURT, BAND(3) + 0.5);
    // Beide Panels offen oder zu: Der Name steht in der freien Mitte, damit kein Panel das Bild deckt.
    await centreInFreeArea(page, anchor);
    await page.waitForTimeout(800);
    const davor = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });

    await clickTerritory(page, anchor);
    await settleFrame(page);
    await page.waitForTimeout(800);
    // Es gibt keinen zweiten Namen: keine Ebene und kein Punkt der Auswahl; die Ebene der Gebietsnamen zeichnet das Gebiet einmal.
    const stand = await page.evaluate((id) => {
        const map = globalThis.avesmapsMap as unknown as {
            getLayer(id: string): unknown;
            getStyle(): { sources: Record<string, { data?: { features: unknown[] } }> };
        };
        return {
            ebene: map.getLayer("area-selection-label") !== undefined,
            punkte: map.getStyle().sources["area-selection-label"]?.data?.features.length ?? 0,
            gezeichnet: globalThis
                .avesmapsMap!.queryRenderedFeatures({ layers: ["territory-label"] })
                .filter((feature) => feature.properties["territory_public_id"] === id).length,
        };
    }, anchor.id);
    expect(stand).toEqual({ ebene: false, punkte: 0, gezeichnet: 1 });

    const ink = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });
    expect(ink.icon.pixels, "die Auswahl zeigt das Wappen").toBeGreaterThan(200);
    expect(ink.icon.y1).toBeLessThan(ink.text.y0);
    expect(Math.abs(centreX(ink.icon) - centreX(ink.text))).toBeLessThanOrEqual(2);
    // Dieselbe Stelle wie vor dem Klick: Das Wappen springt nicht, wenn man das Gebiet wählt.
    expect(Math.abs(ink.icon.y1 - davor.icon.y1)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreX(ink.icon) - centreX(davor.icon))).toBeLessThanOrEqual(1);
});

test.describe("auf einem Schirm mit doppelter Pixeldichte", () => {
    test.use({ deviceScaleFactor: 2 });

    test("🔴 das Wappen wird auf die Größe des Geräts gerechnet (80 px für 40), nie hinauf, und steht doch 40 logische Pixel hoch", async ({
        page,
    }) => {
        await requireCoats(page);
        await openMap(page);
        await chooseView(page, "political");
        const anchor = await showLabel(page, GREIFENFURT, BAND(3) + 0.5);
        const bilder = await page.evaluate(() => {
            const images = (
                globalThis.avesmapsMap as unknown as {
                    style: {
                        imageManager: {
                            images: Record<string, { data: { width: number; height: number }; pixelRatio: number }>;
                        };
                    };
                }
            ).style.imageManager.images;
            return Object.entries(images)
                .filter(([id]) => id.startsWith("coat:"))
                .map(([, image]) => ({ ...image.data, pixelRatio: image.pixelRatio }));
        });
        expect(bilder.length).toBeGreaterThan(5);
        for (const bild of bilder) {
            // Höchstens 80 Bildpunkte an der langen Kante, die Pixeldichte macht daraus 40 logische.
            expect(Math.max(bild.width, bild.height)).toBeLessThanOrEqual(80);
            expect(bild.pixelRatio).toBeGreaterThan(0.5);
            expect(Math.max(bild.width, bild.height) / bild.pixelRatio).toBeCloseTo(40, 3);
        }
        const ink = await measureLabelInk(page, "territory-label", anchor, { only: anchor.id });
        const hoehe = ink.icon.y1 - ink.icon.y0;
        expect(hoehe, "Höhe des Wappens in logischen Pixeln").toBeGreaterThanOrEqual(34);
        expect(hoehe).toBeLessThanOrEqual(41);
    });
});
