import { expect, test, type Page } from "@playwright/test";
import { stubReisebilder, stubReisebilderKarte, type KartenAttrappe, type KartenBild } from "./reisebild-stub.ts";
import { chooseView, freeSpot, GARETH, openMap, selectedPlace, showPlace } from "./map-handle.ts";

/**
 * Knopf und Leiste der Reisebilder (WI-0272 S4, Aufgabe 28): der Knopf im Eckbund, die Leiste über die ganze Breite am unteren Rand, was über ihr steht (Eckbund, Maßstab, Infobox, Planer), das
 * Verschieben der Karte (Kacheln bleiben im DOM), „Bild machen“, Esc, andere Ansichten und eine Kachel, deren Datei fehlt. Der Lesepfad ist eine Attrappe (`reisebild-stub.ts`); das Telefon prüft
 * `reisebild-leiste.touch.spec.ts`.
 *
 * Problemfälle: die Leiste deckt Eckbund, Maßstab, Infobox oder Planer; sie ist nicht so breit wie das Fenster; die Karte bewegt sich beim Öffnen; die Zahl im Knopf weicht von den Kacheln ab; beim
 * Verschieben werden alle Kacheln neu gebaut; die Leiste bleibt in einer anderen Ansicht oder kommt nicht zurück; Esc schließt die Leiste vor der Infobox; „Bild machen“ springt die Kamera zur Mitte, bevor
 * die Stelle gewählt ist; eine Kachel mit fehlender Datei bleibt als leeres Feld stehen.
 */

const ID = (n: number): string => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

const frei = (n: number, dx: number, dy: number, mehr: Partial<KartenBild> = {}): KartenBild => ({
    id: ID(n),
    lage: { x: GARETH.x + dx, y: GARETH.y + dy },
    ...mehr,
});

interface Kasten {
    readonly x: number;
    readonly y: number;
    readonly breite: number;
    readonly hoehe: number;
}

async function kasten(page: Page, auswahl: string): Promise<Kasten> {
    const box = await page.locator(auswahl).first().boundingBox();
    if (box === null) throw new Error(`kein Kasten für ${auswahl}`);
    return { x: box.x, y: box.y, breite: box.width, hoehe: box.height };
}

const unterkante = (k: Kasten): number => k.y + k.hoehe;

async function zahlImKnopf(page: Page): Promise<number> {
    const text =
        (await page
            .getByTestId("reisebilder-knopf-zahl")
            .textContent()
            .catch(() => null)) ?? "";
    return text === "" ? 0 : Number.parseInt(text, 10);
}

const kachelAnzahl = (page: Page): Promise<number> => page.getByTestId("reisebild-kachel").count();

async function aufbau(page: Page, bilder: KartenBild[], zoom = 5): Promise<KartenAttrappe> {
    await stubReisebilder(page);
    const attrappe = await stubReisebilderKarte(page, bilder);
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, zoom);
    await expect(page.getByTestId("reisebilder-knopf")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => zahlImKnopf(page), { timeout: 15_000 }).toBeGreaterThan(0);
    return attrappe;
}

const GROESSEN = [
    { breite: 1920, hoehe: 1080 },
    { breite: 1280, hoehe: 800 },
];

for (const groesse of GROESSEN) {
    test(`🔴 ${String(groesse.breite)} × ${String(groesse.hoehe)}: zu bis zum Klick; die Leiste geht über die ganze Breite; Eckbund, Maßstab, Infobox und Planer stehen darüber; die Karte bewegt sich nicht`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: groesse.breite, height: groesse.hoehe });
        await aufbau(page, [frei(1, 40, 25), frei(2, 45, 22), frei(3, 35, 28)]);
        await expect(page.getByTestId("reisebilder-leiste")).toBeHidden();
        const vorher = await page.evaluate(() => ({
            zoom: globalThis.avesmapsMap!.getZoom(),
            mitte: globalThis.avesmapsMap!.getCenter(),
        }));

        await page.getByTestId("reisebilder-knopf").click();
        await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
        await expect(page.getByTestId("reisebilder-knopf")).toHaveAttribute("aria-expanded", "true");
        await page.waitForTimeout(450);
        const leiste = await kasten(page, '[data-testid="reisebilder-leiste"]');
        expect(Math.abs(leiste.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(leiste.breite - groesse.breite)).toBeLessThanOrEqual(1);
        expect(Math.abs(unterkante(leiste) - groesse.hoehe)).toBeLessThanOrEqual(1);

        const bund = await kasten(page, ".corner");
        expect(unterkante(bund)).toBeLessThanOrEqual(leiste.y + 1);
        const massstab = await kasten(page, '[data-testid="scale-bar"]');
        expect(unterkante(massstab)).toBeLessThanOrEqual(leiste.y + 1);

        // Die Karte bewegt sich beim Öffnen nicht.
        const nachher = await page.evaluate(() => ({
            zoom: globalThis.avesmapsMap!.getZoom(),
            mitte: globalThis.avesmapsMap!.getCenter(),
        }));
        expect(nachher.zoom).toBeCloseTo(vorher.zoom, 6);
        expect(nachher.mitte.lng).toBeCloseTo(vorher.mitte.lng, 6);
        expect(nachher.mitte.lat).toBeCloseTo(vorher.mitte.lat, 6);

        // Infobox: Gareth wählen. Ihre Unterkante steht über der Leiste, die Leiste bleibt ganz breit.
        await showPlace(page, GARETH, 5);
        const ort = await page.evaluate((p) => {
            const map = globalThis.avesmapsMap!;
            const am = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
            const rahmen = map.getCanvas().getBoundingClientRect();
            return { x: rahmen.left + am.x, y: rahmen.top + am.y };
        }, GARETH);
        await page.mouse.click(ort.x, ort.y);
        await expect.poll(async () => (await selectedPlace(page))?.name, { timeout: 15_000 }).toBe("Gareth");
        await expect(page.getByTestId("info-panel")).toBeVisible();
        await page.waitForTimeout(450);
        const info = await kasten(page, '[data-testid="info-panel"]');
        expect(unterkante(info)).toBeLessThanOrEqual(leiste.y + 1);
        const mitInfo = await kasten(page, '[data-testid="reisebilder-leiste"]');
        expect(Math.abs(mitInfo.breite - groesse.breite)).toBeLessThanOrEqual(1);

        // Planer.
        await page.getByTestId("route-planner-tab").click();
        await page.waitForTimeout(450);
        const planer = await kasten(page, ".planner-stack");
        expect(unterkante(planer)).toBeLessThanOrEqual(leiste.y + 1);
    });
}

test("Die Zahl im Knopf ist die Zahl der Kacheln", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [frei(1, 40, 25), frei(2, 45, 22), frei(3, 35, 28), frei(4, -45, -30)]);
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await expect.poll(async () => (await kachelAnzahl(page)) === (await zahlImKnopf(page))).toBe(true);
    expect(await kachelAnzahl(page)).toBeGreaterThan(0);
});

test("🔴 Verschieben: bleibende Kacheln bleiben im DOM (derselbe Knoten), kommende kommen, gehende gehen, erst nach Ruhe", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const attrappe = await aufbau(page, [frei(1, 40, 25)]);
    // Die Bilder liegen zwei Bildschirmbreiten auseinander: nach der Verschiebung bleibt das erste im Bild, das zweite kommt.
    const proEinheit = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const proj = globalThis.avesmapsRenderProjection!;
        const a = map.project(proj.toRenderLngLat({ x: 0, y: 0 }));
        const b = map.project(proj.toRenderLngLat({ x: 10, y: 0 }));
        return Math.abs(b.x - a.x) / 10;
    });
    const viertel = 300 / proEinheit;
    attrappe.bilder.push(frei(2, 40 + viertel, 25), frei(3, 40 - viertel, 25));
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await expect.poll(() => kachelAnzahl(page), { timeout: 15_000 }).toBeGreaterThan(0);
    // Ein Zeichen am Knoten des ersten Bildes.
    await page.evaluate((id) => {
        document.querySelector(`[data-bild-id="${id}"]`)?.setAttribute("data-knoten", "alt");
    }, ID(1));
    await page.evaluate((versatz) => {
        const map = globalThis.avesmapsMap!;
        map.jumpTo({
            center: map.unproject([map.getCanvas().clientWidth / 2 + versatz, map.getCanvas().clientHeight / 2]),
        });
    }, 200);
    // Gleich nach der Bewegung ist noch Ruhe nötig: Die Leiste zeigt noch den alten Stand.
    await expect
        .poll(async () => page.locator('[data-bild-id="' + ID(1) + '"]').getAttribute("data-knoten"), {
            timeout: 10_000,
        })
        .toBe("alt");
    await expect.poll(() => kachelAnzahl(page), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("Andere Ansicht: Knopf und Leiste weg; zurück: die Leiste kommt wieder", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [frei(1, 40, 25), frei(2, 45, 22)]);
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await chooseView(page, "landscapes");
    await expect(page.getByTestId("reisebilder-knopf")).toBeHidden();
    await expect(page.getByTestId("reisebilder-leiste")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--avm-reisebilder-leiste"))).toBe(
        "0px",
    );
    await chooseView(page, "standard");
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible({ timeout: 20_000 });
});

test("🔴 Esc: erst die Infobox, dann die Leiste", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [frei(1, 40, 25)]);
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await showPlace(page, GARETH, 5);
    const ort = await page.evaluate((p) => {
        const map = globalThis.avesmapsMap!;
        const am = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + am.x, y: rahmen.top + am.y };
    }, GARETH);
    await page.mouse.click(ort.x, ort.y);
    await expect(page.getByTestId("info-panel")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("info-panel")).toBeHidden();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("reisebilder-leiste")).toBeHidden();
});

test("„Bild machen“: der Wählmodus steht, die Kamera fliegt nicht; ein Klick auf die Karte setzt die Stelle und das Formular steht", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [frei(1, 40, 25)]);
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    const vorher = await page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    await page.getByTestId("reisebild-neu").click();
    await expect(page.getByTestId("reisebild-fenster")).toBeVisible();
    // Gewählt wird noch: Das Fenster ist eingeklappt, die Kamera ist an ihrem Platz.
    await page.waitForTimeout(800);
    const mitte = await page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    expect(mitte.lng).toBeCloseTo(vorher.lng, 5);
    expect(mitte.lat).toBeCloseTo(vorher.lat, 5);
    const spot = await freeSpot(page, { x: 420, y: 160 });
    await page.mouse.click(spot.x, spot.y);
    await expect(page.getByTestId("reisebild-fenster")).toBeVisible();
    await expect(page.getByTestId("reisebild-fenster")).toContainText("Eigenes Bild hinzufügen");
});

test("🔴 Eine Kachel, deren Datei fehlt (404), verschwindet still und kommt nicht wieder", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubReisebilder(page);
    const attrappe = await stubReisebilderKarte(page, [frei(1, 40, 25, { fehlt: true }), frei(2, 45, 22)]);
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 5);
    await expect(page.getByTestId("reisebilder-knopf")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await expect.poll(async () => page.locator('[data-bild-id="' + ID(1) + '"]').count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => kachelAnzahl(page)).toBe(1);
    const abrufe = attrappe.abrufe;
    await page.waitForTimeout(1_500);
    expect(await page.locator('[data-bild-id="' + ID(1) + '"]').count()).toBe(0);
    expect(attrappe.abrufe).toBeLessThanOrEqual(abrufe + 1);
});

// --- Vorschaubilder und Linie zur Stelle (Aufgabe 29) ---------------------------------------------------------------

/** Die Bildkennungen der Quelle `quelle`, je Gruppe einmal (eine GeoJSON-Quelle liefert dasselbe Merkmal aus mehreren Kacheln), samt Stelle auf der Seite. */
async function symbole(
    page: Page,
    quelle: "photobox-bilder" | "photobox-fahnen",
): Promise<{ schluessel: string; bild: string; x: number; y: number }[]> {
    return page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const einmal = new Map(map.querySourceFeatures(id).map((m) => [String(m.properties["schluessel"]), m]));
        return [...einmal.values()].map((m) => {
            const [lng, lat] = (m.geometry as unknown as { coordinates: [number, number] }).coordinates;
            const am = map.project({ lng, lat });
            return {
                schluessel: String(m.properties["schluessel"]),
                bild: String(m.properties["bild"]),
                x: rahmen.left + am.x,
                y: rahmen.top + am.y,
            };
        });
    }, quelle);
}

const gareth = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Gareth",
    subtype: "metropole",
    lage: { x: GARETH.x, y: GARETH.y },
};

test("🔴 Offen sind die Symbole Vorschaubilder, zu wieder Zeichen; die Fahne ebenso", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [frei(1, 40, 25), frei(2, 0.5, 0.5, { ort: gareth })], 7);
    await expect
        .poll(async () => (await symbole(page, "photobox-bilder")).map((s) => s.bild))
        .toEqual(["photobox-zeichen-1"]);

    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await expect
        .poll(
            async () => (await symbole(page, "photobox-bilder")).map((s) => s.bild.startsWith("photobox-vorschau-40-")),
            {
                timeout: 15_000,
            },
        )
        .toEqual([true]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("reisebilder-leiste")).toBeHidden();
    await expect
        .poll(async () => (await symbole(page, "photobox-bilder")).map((s) => s.bild), { timeout: 15_000 })
        .toEqual(["photobox-zeichen-1"]);

    // Die Fahne am Ort: zu die Pille, offen der kleine Abzug (30).
    await showPlace(page, GARETH, 5);
    await expect
        .poll(async () => (await symbole(page, "photobox-fahnen")).map((s) => s.bild), { timeout: 15_000 })
        .toEqual(["photobox-fahne-1"]);
    await page.getByTestId("reisebilder-knopf").click();
    await expect
        .poll(
            async () => (await symbole(page, "photobox-fahnen")).map((s) => s.bild.startsWith("photobox-vorschau-30-")),
            { timeout: 15_000 },
        )
        .toEqual([true]);
});

test("🔴 Hover in beide Richtungen: die Kachel zieht die Linie zum Symbol, das Symbol hebt die Kachel hervor", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aufbau(page, [frei(1, 40, 25)], 7);
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-leiste")).toBeVisible();
    await expect.poll(() => kachelAnzahl(page), { timeout: 15_000 }).toBe(1);
    await page.waitForTimeout(500);
    const kachel = page.getByTestId("reisebild-kachel").first();
    const kachelBox = (await kachel.boundingBox())!;
    const linie = page.getByTestId("reisebilder-linie");
    await expect(linie).toHaveCount(0);

    await kachel.hover();
    await expect(linie).toBeVisible();
    const lies = async (): Promise<{ von: { x: number; y: number }; bis: { x: number; y: number } }> => {
        const d = (await linie.locator("path").first().getAttribute("d")) ?? "";
        const [a, b, c, e] = d.match(/-?\d+(\.\d+)?/g)!.map(Number) as [number, number, number, number];
        return { von: { x: a, y: b }, bis: { x: c, y: e } };
    };
    const erste = await lies();
    // Von der Oberkante der Kachelmitte.
    expect(Math.abs(erste.von.x - (kachelBox.x + kachelBox.width / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(erste.von.y - kachelBox.y)).toBeLessThanOrEqual(2);
    // Zum Symbol (endet 17 px vor seiner Mitte).
    const symbol = (await symbole(page, "photobox-bilder"))[0]!;
    expect(Math.abs(Math.hypot(erste.bis.x - symbol.x, erste.bis.y - symbol.y) - 17)).toBeLessThanOrEqual(2);

    // Verschieben zieht die Linie mit.
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        map.jumpTo({ center: map.unproject([map.getCanvas().clientWidth / 2 + 30, map.getCanvas().clientHeight / 2]) });
    });
    await expect.poll(async () => (await lies()).bis.x, { timeout: 5_000 }).not.toBeCloseTo(erste.bis.x, 0);

    // Weg von der Kachel: keine Linie.
    await page.mouse.move(5, 5);
    await expect(linie).toHaveCount(0);

    // Das Symbol hovern hebt die Kachel hervor (und zieht keine Linie).
    const jetzt = (await symbole(page, "photobox-bilder"))[0]!;
    await page.mouse.move(jetzt.x, jetzt.y);
    await expect(kachel).toHaveClass(/is-hervor/);
    await expect(linie).toHaveCount(0);
    await page.mouse.move(5, 5);
    await expect(kachel).not.toHaveClass(/is-hervor/);
});

test("🔴 „Ohne KI“: KI-Bilder gehen aus Leiste und Zahl, der Filter bleibt nach dem Neuladen und lässt sich wieder ausschalten", async ({
    page,
}) => {
    await aufbau(page, [
        frei(1, 40, 25),
        frei(2, 45, 22, { entstehung: "ai_generated" }),
        frei(3, 35, 28, { entstehung: "ai_generated" }),
    ]);
    await page.getByTestId("reisebilder-knopf").click();
    await expect.poll(() => kachelAnzahl(page)).toBe(3);
    const filter = page.getByTestId("reisebilder-ohne-ki");
    await expect(filter).toHaveAttribute("aria-pressed", "false");

    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => kachelAnzahl(page)).toBe(1);
    await expect.poll(() => zahlImKnopf(page)).toBe(1);
    await expect(page.getByTestId("reisebilder-knopf-filter")).toBeVisible();

    // Der Wiederbesuch: dieselbe Seite neu geöffnet, der Browserspeicher bleibt.
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 5);
    await expect.poll(() => zahlImKnopf(page), { timeout: 15_000 }).toBe(1);
    await page.getByTestId("reisebilder-knopf").click();
    await expect(page.getByTestId("reisebilder-ohne-ki")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => kachelAnzahl(page)).toBe(1);

    await page.getByTestId("reisebilder-ohne-ki").click();
    await expect.poll(() => kachelAnzahl(page)).toBe(3);
    expect(await page.evaluate(() => localStorage.getItem("avesmaps.reisebilder.ohne-ki"))).toBeNull();
});

test("🔴 „Reisebilder ausblenden“: Die Karte verliert ihre Symbole, die Leiste behält die Kacheln, auch nach dem Wiederbesuch", async ({
    page,
}) => {
    await aufbau(page, [frei(1, 40, 25)]);
    await expect.poll(async () => (await symbole(page, "photobox-bilder")).length).toBe(1);
    await page.getByTestId("reisebilder-knopf").click();
    await expect.poll(() => kachelAnzahl(page)).toBe(1);

    const schalter = page.getByTestId("reisebilder-ausblenden");
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    await schalter.click();
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await symbole(page, "photobox-bilder")).length).toBe(0);
    await expect.poll(() => kachelAnzahl(page)).toBe(1);

    // Der Wiederbesuch: dieselbe Seite neu geöffnet, der Browserspeicher bleibt.
    await openMap(page);
    await showPlace(page, { x: GARETH.x + 40, y: GARETH.y + 25 }, 5);
    await expect.poll(() => zahlImKnopf(page), { timeout: 15_000 }).toBe(1);
    expect(await symbole(page, "photobox-bilder")).toHaveLength(0);
    await expect(page.getByTestId("reisebilder-knopf-filter")).toBeVisible();

    await page.getByTestId("reisebilder-knopf").click();
    await page.getByTestId("reisebilder-ausblenden").click();
    await expect.poll(async () => (await symbole(page, "photobox-bilder")).length, { timeout: 15_000 }).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("avesmaps.reisebilder.ausgeblendet"))).toBeNull();
});

test("„Ohne KI“ ohne Treffer: Die Leiste sagt es und bietet das Ausschalten an", async ({ page }) => {
    await aufbau(page, [frei(1, 40, 25, { entstehung: "ai_generated" })]);
    await page.getByTestId("reisebilder-knopf").click();
    await page.getByTestId("reisebilder-ohne-ki").click();
    await expect(page.getByTestId("reisebilder-leer-ohne-ki")).toBeVisible();
    await page.getByTestId("reisebilder-filter-aus").click();
    await expect(page.getByTestId("reisebilder-leer-ohne-ki")).toBeHidden();
    await expect.poll(() => kachelAnzahl(page)).toBe(1);
});
