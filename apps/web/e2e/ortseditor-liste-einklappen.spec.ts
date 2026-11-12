import { expect, test, type Page } from "@playwright/test";
import { GRATENFELS, GRATENFELS_LAGE, fenster, langeListe, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Die einklappbare Ortsliste (WI-0128 P1; Betreiberpräzisierung 2026-10-13, Abschnitt 2.4 des Abschlussauftrags).
 *
 * 🔴 Die harte Zusicherung ist Geometrie: Die Liste zieht sich von ihrer LINKEN Kante her nach rechts zusammen. Der Pfeilknopf an
 * der Trennlinie, die Spalte „Ortseigenschaften“ und die rechte Fensterkante bleiben pixelgenau stehen — auch WÄHREND der Bewegung.
 * Nur die linke Fensterkante wandert, und zwar um genau die Listenbreite; die Karte gewinnt denselben Platz.
 */

/** Was gemessen wird: der Pfeil, die Eigenschaftenspalte und das Fenster, alles in Bildschirmkoordinaten. */
interface Masse {
    schalterX: number;
    eigenschaftenX: number;
    eigenschaftenBreite: number;
    fensterLinks: number;
    fensterRechts: number;
}

const SCHALTER = '[data-testid$="-listenschalter"]';
const EIGENSCHAFTEN = '[data-testid$="-eigenschaften-spalte"]';

async function miss(page: Page, nr = 0): Promise<Masse> {
    return page.evaluate(
        ([schalterSel, eigenschaftenSel, index]) => {
            const dialoge = [
                ...document.querySelectorAll<HTMLElement>('dialog[data-lage][open][data-testid^="ortseditor-"]'),
            ];
            const dialog = dialoge[index as number];
            if (!dialog) throw new Error("kein Ortseditor offen");
            const schalter = dialog.querySelector(schalterSel as string)?.getBoundingClientRect();
            const spalte = dialog.querySelector(eigenschaftenSel as string)?.getBoundingClientRect();
            if (!schalter || !spalte) throw new Error("Schalter oder Eigenschaftenspalte fehlt");
            const box = dialog.getBoundingClientRect();
            return {
                schalterX: schalter.x,
                eigenschaftenX: spalte.x,
                eigenschaftenBreite: spalte.width,
                fensterLinks: box.left,
                fensterRechts: box.right,
            };
        },
        [SCHALTER, EIGENSCHAFTEN, nr] as const,
    );
}

/** Die Kanonbreite der Ortsliste, wie die Oberfläche sie wirklich zeichnet. */
const listenBreite = (page: Page): Promise<number> =>
    page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--avm-fenster-inspektor")),
    );

/** Wartet, bis der Übergang durch ist (Hülle: 220 ms). */
const ruhig = (page: Page): Promise<void> => page.waitForTimeout(400);

/** Löst das Fenster und zieht es weit nach links, damit das Editorpanel rechts frei liegt (wie in `ortseditor.spec.ts`). */
async function loeseUndRaeume(page: Page, zielX = 40): Promise<void> {
    await fenster(page).getByTestId("fenster-loesen").click();
    await expect(fenster(page)).toHaveAttribute("data-lage", "geloest");
    const kopf = fenster(page).locator(".avm-fenster__kopf");
    const box = (await kopf.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(zielX, box.y + box.height / 2 + 180, { steps: 8 });
    await page.mouse.up();
}

/**
 * Zwei sichtbare Ortseditoren: Das Verb öffnet immer AM vordersten Fenster (D19), also wird das erste erst gelöst, zur Seite
 * gezogen und abgelegt; danach öffnet das Verb ein zweites, und „▣ Hervorholen“ bringt das erste zurück.
 */
async function zweiFenster(page: Page): Promise<void> {
    await loeseUndRaeume(page);
    const kennung = (await fenster(page).getAttribute("data-testid"))!.replace("ortseditor-", "");
    await fenster(page).getByTestId("fenster-ablegen").click();
    await expect(fenster(page)).toHaveCount(0);
    // 🪤 Erst das zweite Fenster öffnen und das erste hervorholen, DANN zur Seite ziehen: Ein angedocktes Fenster deckt das
    // Editorpanel mit „Offene Bearbeitungen“ zu, und der Kasten wäre nicht mehr anklickbar.
    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page)).toHaveCount(1);
    await page.getByTestId(`bearbeitung-${kennung}`).click();
    await expect(fenster(page)).toHaveCount(2);
    // Das hervorgeholte Fenster liegt vorn und erbt dieselbe gemerkte Stelle: nach rechts damit, dann stehen beide nebeneinander.
    const kopf = fenster(page).nth(1).locator(".avm-fenster__kopf");
    const box = (await kopf.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(page.viewportSize()!.width - 500, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
}

function stehtStill(vorher: Masse, nachher: Masse): void {
    expect(Math.abs(nachher.schalterX - vorher.schalterX)).toBeLessThanOrEqual(1);
    expect(Math.abs(nachher.eigenschaftenX - vorher.eigenschaftenX)).toBeLessThanOrEqual(1);
    expect(Math.abs(nachher.eigenschaftenBreite - vorher.eigenschaftenBreite)).toBeLessThanOrEqual(1);
    expect(Math.abs(nachher.fensterRechts - vorher.fensterRechts)).toBeLessThanOrEqual(1);
}

for (const bild of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
]) {
    test(`🔴 angedockt ${String(bild.width)} × ${String(bild.height)}: « zieht nur die linke Kante ein, » kehrt es genau um`, async ({
        page,
    }) => {
        await page.setViewportSize(bild);
        await oeffneOrtseditor(page);
        const breite = await listenBreite(page);
        const offen = await miss(page);

        await fenster(page).locator(SCHALTER).click();
        await ruhig(page);
        const zu = await miss(page);
        stehtStill(offen, zu);
        expect(zu.fensterLinks - offen.fensterLinks).toBeGreaterThanOrEqual(breite - 1);
        expect(zu.fensterLinks - offen.fensterLinks).toBeLessThanOrEqual(breite + 1);
        await expect(fenster(page).locator(SCHALTER)).toHaveAttribute("aria-expanded", "false");
        await expect(fenster(page).locator(SCHALTER)).toHaveAttribute("aria-label", "Ortsliste ausklappen");

        await fenster(page).locator(SCHALTER).click();
        await ruhig(page);
        const wieder = await miss(page);
        stehtStill(offen, wieder);
        expect(Math.abs(wieder.fensterLinks - offen.fensterLinks)).toBeLessThanOrEqual(1);
        await expect(fenster(page).locator(SCHALTER)).toHaveAttribute("aria-expanded", "true");
        await expect(fenster(page).locator(SCHALTER)).toHaveAttribute("aria-label", "Ortsliste einklappen");
    });
}

test("🔴 auch WÄHREND der Bewegung wandern Pfeil und Eigenschaften keinen Pixel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await oeffneOrtseditor(page);
    const proben = await page.evaluate(
        async ([schalterSel, eigenschaftenSel]) => {
            const dialog = document.querySelector<HTMLElement>('dialog[data-lage][open][data-testid^="ortseditor-"]');
            if (!dialog) throw new Error("kein Ortseditor offen");
            const schalter = dialog.querySelector<HTMLElement>(schalterSel);
            const spalte = dialog.querySelector<HTMLElement>(eigenschaftenSel);
            if (!schalter || !spalte) throw new Error("Schalter oder Eigenschaftenspalte fehlt");
            const gemessen: { t: number; schalterX: number; spalteX: number; spalteBreite: number; links: number }[] =
                [];
            const nimm = (t: number): void => {
                const s = schalter.getBoundingClientRect();
                const e = spalte.getBoundingClientRect();
                gemessen.push({
                    t,
                    schalterX: s.x,
                    spalteX: e.x,
                    spalteBreite: e.width,
                    links: dialog.getBoundingClientRect().left,
                });
            };
            nimm(0);
            schalter.click();
            const start = performance.now();
            await new Promise<void>((fertig) => {
                const schlag = (): void => {
                    const t = performance.now() - start;
                    nimm(t);
                    if (t >= 400) fertig();
                    else requestAnimationFrame(schlag);
                };
                requestAnimationFrame(schlag);
            });
            return gemessen;
        },
        [SCHALTER, EIGENSCHAFTEN] as const,
    );

    // Anfang, Mitte und Ende müssen wirklich vorkommen, sonst misst der Test eine Bewegung, die schon vorbei war.
    expect(proben.length).toBeGreaterThan(5);
    expect(proben.some((p) => p.t > 60 && p.t < 180)).toBe(true);
    const spanne = (werte: number[]): number => Math.max(...werte) - Math.min(...werte);
    expect(spanne(proben.map((p) => p.schalterX))).toBeLessThanOrEqual(1);
    expect(spanne(proben.map((p) => p.spalteX))).toBeLessThanOrEqual(1);
    expect(spanne(proben.map((p) => p.spalteBreite))).toBeLessThanOrEqual(1);
    // Und die linke Kante hat sich in derselben Zeit wirklich bewegt (sonst stünde alles still, weil nichts geschah).
    expect(spanne(proben.map((p) => p.links))).toBeGreaterThan(100);
});

test("🔴 gelöst: rechte Fensterkante und Eigenschaften bleiben, die linke Kante wandert", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await oeffneOrtseditor(page);
    await page.getByTestId("fenster-loesen").click();
    await expect(fenster(page)).toHaveAttribute("data-lage", "geloest");
    const breite = await listenBreite(page);
    const offen = await miss(page);

    await fenster(page).locator(SCHALTER).click();
    await ruhig(page);
    const zu = await miss(page);
    stehtStill(offen, zu);
    expect(zu.fensterLinks - offen.fensterLinks).toBeGreaterThanOrEqual(breite - 1);

    await fenster(page).locator(SCHALTER).click();
    await ruhig(page);
    stehtStill(offen, await miss(page));
    expect(Math.abs((await miss(page)).fensterLinks - offen.fensterLinks)).toBeLessThanOrEqual(1);
});

test("🔴 ein eingeklappt verschobenes gelöstes Fenster klappt an der neuen Stelle richtig wieder auf", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await oeffneOrtseditor(page);
    await page.getByTestId("fenster-loesen").click();
    const breiteOffen = (await fenster(page).boundingBox())!.width;
    await fenster(page).locator(SCHALTER).click();
    await ruhig(page);

    const kopf = fenster(page).locator(".avm-fenster__kopf");
    const box = (await kopf.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await ruhig(page);
    const verschoben = await miss(page);

    await fenster(page).locator(SCHALTER).click();
    await ruhig(page);
    const auf = await miss(page);
    // Die rechte Kante bleibt der Anker, die Breite ist wieder die ganze, nichts ist negativ.
    expect(Math.abs(auf.fensterRechts - verschoben.fensterRechts)).toBeLessThanOrEqual(1);
    expect(Math.abs((await fenster(page).boundingBox())!.width - breiteOffen)).toBeLessThanOrEqual(1);
    expect(auf.fensterLinks).toBeGreaterThanOrEqual(0);
});

test("🔴 zwei Ortseditoren klappen unabhängig; Suche, Wahl und Rollstand der Liste überleben", async ({ page }) => {
    // Breit genug, dass zwei Ortseditoren nebeneinander stehen, ohne einander zu verdecken (960 + 960).
    await page.setViewportSize({ width: 1920, height: 1000 });
    await oeffneOrtseditor(page, { liste: langeListe() });
    await zweiFenster(page);

    // 🪤 Feste Kennungen statt `nth(…)`: Ein Klick holt sein Fenster nach vorn, und die Reihenfolge im DOM wechselt dabei.
    const kennungen = await fenster(page).evaluateAll((liste) =>
        liste.map((element) => element.getAttribute("data-testid")!),
    );
    const [erstes, zweites] = kennungen.map((id) => page.getByTestId(id));
    await erstes!.locator(SCHALTER).click();
    await ruhig(page);
    await expect(erstes!.locator(SCHALTER)).toHaveAttribute("aria-expanded", "false");
    await expect(zweites!.locator(SCHALTER)).toHaveAttribute("aria-expanded", "true");

    // Suche, Wahl und Rollstand im offenen Fenster: Sie überstehen das Ein- und Ausklappen dieses Fensters.
    const suche = zweites!.locator('[data-testid$="-orte-leiste-suche"] input');
    await suche.fill("Aarhain 1");
    const rolle = zweites!.locator('[data-testid$="-liste"] .fenster-spalte__inhalt');
    await zweites!.locator('[data-testid$="-orte-zeile"]', { hasText: /^Aarhain 100/ }).click();
    await rolle.evaluate((element) => (element.scrollTop = 60));
    const rolleVorher = await rolle.evaluate((element) => element.scrollTop);
    await zweites!.locator(SCHALTER).click();
    await ruhig(page);
    await zweites!.locator(SCHALTER).click();
    await ruhig(page);
    await expect(suche).toHaveValue("Aarhain 1");
    await expect(zweites!.locator('[data-testid$="-orte-zeile"][aria-selected="true"]')).toHaveCount(1);
    expect(await rolle.evaluate((element) => element.scrollTop)).toBe(rolleVorher);
    // Und das eingeklappte Fenster daneben blieb eingeklappt.
    await expect(erstes!.locator(SCHALTER)).toHaveAttribute("aria-expanded", "false");
});

test("🔴 der Schalter geht mit der Tastatur, und die eingezogene Liste nimmt keinen Fokus mehr", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await oeffneOrtseditor(page);
    const schalter = fenster(page).locator(SCHALTER);
    await schalter.focus();
    await page.keyboard.press("Enter");
    await ruhig(page);
    await expect(schalter).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await ruhig(page);
    await expect(schalter).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Enter");
    await ruhig(page);
    // Eingezogen ist die Spalte `inert`: Weder Suche noch Zeilen sind erreichbar.
    await expect(fenster(page).locator('[data-testid$="-liste"]')).toHaveAttribute("inert", "");
    expect(
        await fenster(page)
            .locator('[data-testid$="-orte-leiste-suche"]')
            .evaluate((element) => {
                (element as HTMLElement).focus();
                return document.activeElement === element;
            }),
    ).toBe(false);
});

test("🔴 der Knopf bewegt die Kamera nicht und der nächste Ortseditor geht so auf wie der letzte", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await oeffneOrtseditor(page);
    const vorher = await page.evaluate(() => {
        const handle = (globalThis as unknown as { mapHandle?: { map: { getCenter(): unknown; getZoom(): number } } })
            .mapHandle;
        return handle ? { mitte: JSON.stringify(handle.map.getCenter()), zoom: handle.map.getZoom() } : undefined;
    });
    await fenster(page).locator(SCHALTER).click();
    await ruhig(page);
    const nachher = await page.evaluate(() => {
        const handle = (globalThis as unknown as { mapHandle?: { map: { getCenter(): unknown; getZoom(): number } } })
            .mapHandle;
        return handle ? { mitte: JSON.stringify(handle.map.getCenter()), zoom: handle.map.getZoom() } : undefined;
    });
    expect(nachher).toEqual(vorher);

    // Die Stellung ist die Vorgabe des NÄCHSTEN Fensters (Browser-Speicher, keine neue Spalte).
    await loeseUndRaeume(page);
    await fenster(page).getByTestId("fenster-ablegen").click();
    await expect(fenster(page)).toHaveCount(0);
    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page)).toHaveCount(1);
    await expect(fenster(page).locator(SCHALTER)).toHaveAttribute("aria-expanded", "false");
});

test("🔴 bei reduzierter Bewegung springt die Liste ohne Übergang", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await oeffneOrtseditor(page);
    const breite = await listenBreite(page);
    const offen = await miss(page);
    await fenster(page).locator(SCHALTER).click();
    // Ein Bild später muss es schon durch sein.
    await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
    const zu = await miss(page);
    stehtStill(offen, zu);
    expect(zu.fensterLinks - offen.fensterLinks).toBeGreaterThanOrEqual(breite - 1);
});

test("🔴 ein ungespeicherter Entwurf und die Lage überleben das Einklappen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    const leer = { value: null, origin: null, wiki: null };
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                publicId: GRATENFELS,
                revision: 3,
                name: "Gratenfels",
                subtype: "stadt",
                kind: null,
                position: GRATENFELS_LAGE,
                active: true,
                hidden: false,
                ruined: false,
                nodix: false,
                seaport: false,
                underground: false,
                withdrawn: false,
                approximate: false,
                sourceSystem: "legacy",
                fields: { description: leer, einwohner: leer, lage: leer, oberhaupt: leer },
                wiki: null,
                pathEnds: [],
            }),
        }),
    );
    await oeffneOrtseditor(page);
    await zeile(page, "Gratenfels").click();
    const einwohner = fenster(page)
        .locator('[data-testid$="-feld-einwohner"]')
        .locator("xpath=descendant-or-self::*[self::input or self::textarea]")
        .first();
    await einwohner.fill("2.500");
    const status = fenster(page).locator('[data-testid$="-status"]');
    await expect(status).toHaveText("Ungespeichert: Einwohner");

    await fenster(page).locator(SCHALTER).click();
    await ruhig(page);
    // 🔴 Der Entwurf gehört dem Fenster, nicht der Liste: Er steht noch da, während die Liste eingezogen ist.
    await expect(einwohner).toHaveValue("2.500");
    await expect(status).toHaveText("Ungespeichert: Einwohner");

    // Ablegen und hervorholen: Der Schalter bleibt, wo er war, und der Entwurf auch.
    const kennung = (await fenster(page).getAttribute("data-testid"))!.replace("ortseditor-", "");
    await fenster(page).getByTestId("fenster-ablegen").click();
    await expect(fenster(page)).toHaveCount(0);
    await page.getByTestId(`bearbeitung-${kennung}`).click();
    await expect(fenster(page)).toHaveCount(1);
    await expect(fenster(page).locator(SCHALTER)).toHaveAttribute("aria-expanded", "false");
    await expect(einwohner).toHaveValue("2.500");

    await fenster(page).locator(SCHALTER).click();
    await ruhig(page);
    await expect(einwohner).toHaveValue("2.500");
    await expect(status).toHaveText("Ungespeichert: Einwohner");
});
