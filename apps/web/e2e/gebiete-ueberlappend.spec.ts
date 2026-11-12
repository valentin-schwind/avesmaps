import { expect, test, type Page } from "@playwright/test";
import {
    chooseView,
    clickMap,
    EDITOR_MODE,
    openMap,
    settleFrame,
    showPlace,
    type AreaSelectionHandle,
} from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Überlappende Herrschaftsgebiete gezielt wählen (Thomas 2026-10-19, 5.4: „Wird ein neues Herrschaftsgebiet innerhalb eines bereits
 * vorhandenen Herrschaftsgebietes angelegt, lässt es sich anschließend teilweise nicht mehr auf der Karte auswählen“; Betreiber „A …
 * jetzt bauen“). Wie bei den Landschaften: Der erste Klick nimmt das kleinste Gebiet, ein zweiter an derselben Stelle das nächste
 * (Durchklicken), und „Hier liegen n Flächen“ bietet jedes an, im Editor mit seinen Handgriffen.
 *
 * Am echten Stack, mit zwei Paaren aus den Daten (Legacy-Import): Norburg liegt ganz in „Freies Land an Born und Walsach“ (Band 4 bis 6),
 * Baronie Kevûns Brück und Baronie Rumpenfels überlappen sich an einem Rand (Band 5 und 6). 💣 Braucht abgeleitete Gebiete
 * (`npm run derive:territories`).
 */
const NORBURG = { x: 691.4, y: 756.48 };
const RANDUEBERLAPPUNG = { x: 658.2, y: 652.876 };
const FREIES_LAND = "Freies Land an Born und Walsach";

const auswahl = (page: Page): Promise<AreaSelectionHandle | undefined> =>
    page.evaluate(() => globalThis.avesmapsAreaSelection?.());
const liste = (page: Page) => page.getByTestId("area-choices");

/** Was die Karte an der Stelle als Gebiete zeichnet (Namen). */
async function gebieteAn(page: Page, punkt: { x: number; y: number }): Promise<string[]> {
    return page.evaluate((pt) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(pt));
        return [
            ...new Set(
                map
                    .queryRenderedFeatures([at.x, at.y], { layers: ["territory-fill"] })
                    .map((f) => String(f.properties["name"])),
            ),
        ];
    }, punkt);
}

/** Die Stelle in Bildpunkten der Karte, wie `clickMap` sie nimmt. */
async function klickeAuf(page: Page, punkt: { x: number; y: number }): Promise<void> {
    const at = await page.evaluate((pt) => {
        const map = globalThis.avesmapsMap!;
        const p = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(pt));
        return { x: Math.round(p.x), y: Math.round(p.y) };
    }, punkt);
    await clickMap(page, at);
}

async function politisch(page: Page, punkt: { x: number; y: number }, zoom: number, pfad = "/"): Promise<void> {
    // Der Hinweis zum Drehen und Neigen gilt als gesehen: Er steht sonst beim ersten Besuch über der Karte.
    await page.addInitScript(() => {
        try {
            globalThis.localStorage.setItem("avesmaps3d.hinweis-3d", "gesehen");
        } catch {
            // ohne Speicher steht er eben
        }
    });
    await openMap(page, pfad);
    await chooseView(page, "political");
    await showPlace(page, punkt, zoom);
    await settleFrame(page);
}

test("🔴 ein Gebiet ganz in einem anderen: der erste Klick nimmt das innere, der zweite das äußere, die Liste bietet beide", async ({
    page,
}) => {
    await politisch(page, NORBURG, 6.2);
    expect(await gebieteAn(page, NORBURG)).toEqual(expect.arrayContaining(["Norburg", FREIES_LAND]));

    await klickeAuf(page, NORBURG);
    await expect.poll(async () => (await auswahl(page))?.name).toBe("Norburg");
    await expect(liste(page)).toContainText("Hier liegen 2 Flächen");
    await expect(liste(page).getByTestId("area-choice")).toHaveText([/Norburg/, new RegExp(FREIES_LAND)]);

    // Durchklicken: an derselben Stelle das nächstgrößere, dann wieder das innere.
    await page.waitForTimeout(450);
    await klickeAuf(page, NORBURG);
    await expect.poll(async () => (await auswahl(page))?.name).toBe(FREIES_LAND);
    await page.waitForTimeout(450);
    await klickeAuf(page, NORBURG);
    await expect.poll(async () => (await auswahl(page))?.name).toBe("Norburg");

    // Aus der Liste direkt das äußere.
    await liste(page).getByTestId("area-choice").filter({ hasText: FREIES_LAND }).click();
    await expect.poll(async () => (await auswahl(page))?.name).toBe(FREIES_LAND);
});

test("🔴 zwei Gebiete, die sich am Rand überlappen: beide stehen in der Liste und sind wählbar", async ({ page }) => {
    await politisch(page, RANDUEBERLAPPUNG, 7.2);
    const dort = await gebieteAn(page, RANDUEBERLAPPUNG);
    expect(dort).toEqual(expect.arrayContaining(["Baronie Kevûns Brück", "Baronie Rumpenfels"]));

    await klickeAuf(page, RANDUEBERLAPPUNG);
    await expect(liste(page)).toContainText("Hier liegen 2 Flächen");
    const erst = (await auswahl(page))?.name;
    const anders = erst === "Baronie Rumpenfels" ? "Baronie Kevûns Brück" : "Baronie Rumpenfels";
    await liste(page).getByTestId("area-choice").filter({ hasText: anders }).click();
    await expect.poll(async () => (await auswahl(page))?.name).toBe(anders);
});

test("🔴 im Editor: dieselbe Liste mit den Handgriffen je Gebiet, und das innere bleibt mit dem ersten Klick erreichbar", async ({
    page,
}) => {
    await stubAdmin(page, {
        capabilities: ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await politisch(page, NORBURG, 6.2, EDITOR_MODE);
    await klickeAuf(page, NORBURG);
    await expect.poll(async () => (await auswahl(page))?.name).toBe("Norburg");
    const eintraege = liste(page).getByTestId("area-choice");
    await expect(eintraege).toHaveText([/Norburg/, new RegExp(FREIES_LAND)]);
    await eintraege.filter({ hasText: FREIES_LAND }).click();
    await expect.poll(async () => (await auswahl(page))?.name).toBe(FREIES_LAND);
});
