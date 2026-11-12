import { expect, test, type Page } from "@playwright/test";

/**
 * Der Kurzlink am echten Stack (WI-0034): 🔗 legt ihn an, `?s=<code>` öffnet dieselbe Reise.
 *
 * 🪤 Gemessen wird der ganze Weg: Knopf, Zwischenablage, neue Seite, dieselbe Reise mit denselben
 * Optionen - und danach die lesbare Adresse. Ein Code, der nur in der Datenbank stimmt, wäre die halbe
 * Funktion.
 */

async function openMap(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
}

test("🔴 🔗 legt einen Kurzlink an, und der öffnet dieselbe Reise mit denselben Optionen", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openMap(page, "?route=Gareth~Perricum&pathType=shortest");
    await expect(page.getByTestId("route-title")).toHaveText(/Die Reise von\s+Gareth\s+nach\s+Perricum/);
    const stages = await page.getByTestId("route-stage").count();

    const share = page.getByTestId("route-share");
    await expect(share).toHaveAttribute("aria-label", "Link für diese Route kopieren");
    await share.click();
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Kurzlink kopiert: ");
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toMatch(/^http:\/\/localhost:\d+\/\?s=[2-9a-km-zA-HJ-NP-Z]{8}$/);
    await expect(toast).toContainText(url);
    await expect(page.getByTestId("toast-link")).toHaveAttribute("href", url);

    // Derselbe Zustand ergibt denselben Code.
    await share.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    const fresh = await context.newPage();
    await fresh.goto(url);
    await fresh.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(fresh.getByTestId("route-title")).toHaveText(/Die Reise von\s+Gareth\s+nach\s+Perricum/);
    await expect(fresh.getByTestId("route-stage")).toHaveCount(stages);
    // Danach steht die Reise lesbar in der Adresse, der Kurzlink ist verschwunden.
    await expect.poll(() => new URL(fresh.url()).search).toBe("?route=Gareth~Perricum&pathType=shortest");
});

test("🔴 ein unbekannter Kurzlink wird gemeldet, und die Seite bleibt benutzbar (Kap. 9.57)", async ({ page }) => {
    await openMap(page, "?s=zzzz2222");
    // Der Code steht dabei: Ein Tippfehler beim Abschreiben fällt so auf.
    await expect(page.getByTestId("toast")).toHaveText("Kurzlink nicht gefunden: zzzz2222");
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(page.getByTestId("route-planner-tab")).toBeVisible();
});

test("🔴 Ohne Zwischenablage ist der Link in der Meldung greifbar: ein Klick markiert ihn ganz (Betreiber 2026-09-24)", async ({
    page,
}) => {
    // Wie ohne sichere Verbindung, etwa am Telefon über die Adresse des Rechners: kein navigator.clipboard,
    // und auch Legacys execCommand-Weg scheitert. Dann bleibt nur der Link in der Meldung.
    await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined });
        document.execCommand = () => false;
    });
    await openMap(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("route-title")).toHaveText(/Die Reise von\s+Gareth\s+nach\s+Perricum/);
    await page.getByTestId("route-share").click();
    await expect(page.getByTestId("toast")).toContainText("Kurzlink: ");
    const link = page.getByTestId("toast-link");
    const url = await link.getAttribute("href");
    expect(url).toMatch(/^http:\/\/localhost:\d+\/\?s=[2-9a-km-zA-HJ-NP-Z]{8}$/);
    await expect(link).toHaveText(url ?? "");
    // 🪤 Nicht die ganze Adresse vergleichen. Ihr Hash folgt der Kamera, gebündelt 150 ms nach
    // `moveend` (app.vue), und nach dem Laden der Reise fliegt die Kamera noch in die Reise hinein.
    // Wer die Adresse davor liest, vergleicht einen Zwischenstand (2026-09-27: x=535,7 statt 591,5).
    // Gefragt ist nur, ob der Klick die Seite neu lädt oder zum Kurzlink springt. Beides zeigen die
    // Suche in der Adresse und eine Marke im Fenster, die kein Neuladen überlebt.
    const before = new URL(page.url()).search;
    await page.evaluate(() => {
        (globalThis as { vorDemKlick?: boolean }).vorDemKlick = true;
    });
    await link.click();
    expect(await page.evaluate(() => globalThis.getSelection()?.toString())).toBe(url);
    // Der Klick markiert, er lädt die Seite nicht neu.
    expect(new URL(page.url()).search).toBe(before);
    expect(await page.evaluate(() => (globalThis as { vorDemKlick?: boolean }).vorDemKlick)).toBe(true);
});
