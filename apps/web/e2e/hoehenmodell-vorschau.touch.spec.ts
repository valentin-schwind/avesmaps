import { expect, test } from "@playwright/test";
import { hoehenmodellServer, hoehenmodellTestStand } from "./hoehenmodell-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Das Schema neben den Werten von „19 (Test)“ am Telefon (WI-0249 P8): Schema, Schieber und Satz stehen untereinander statt nebeneinander,
 * und keine Vorschau ist breiter als das Fenster. `BILDER` (Ordner) legt die Bilder für die Sichtprüfung dort ab.
 */
test("am Telefon: Schema, Schieber und Satz untereinander, nichts breiter als das Fenster", async ({ page }) => {
    const server = hoehenmodellServer(hoehenmodellTestStand());
    await stubAdmin(page, {
        capabilities: [...ADMIN_CAPABILITIES, "manage_system_settings", "manage_terrain_recipe"],
        role: "operator",
        person: { passkeyCount: 1 },
        answer: (call) => server.handle(call),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-systemsteuerung").tap();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page
        .getByTestId("verwaltung-auswahl")
        .getByRole("combobox", { name: "Bereiche der Verwaltung" })
        .selectOption("hoehenmodell");
    await expect(page.getByTestId("hoehenmodell-test")).toBeVisible();

    const key = "regler:durchhang";
    const karte = page.getByTestId(`hoehenmodell-vorschau-${key}`);
    await karte.scrollIntoViewIfNeeded();
    await expect(page.getByTestId(`hoehenmodell-vorschau-schema-bild-${key}`)).toBeVisible();

    // Am Telefon steht der Schieber unter dem Schema, nicht daneben.
    const schema = await page.getByTestId(`hoehenmodell-vorschau-schema-${key}`).boundingBox();
    const schieber = await page.getByTestId(`hoehenmodell-vorschau-regler-${key}`).boundingBox();
    expect(schema !== null && schieber !== null && schieber.y > schema.y + schema.height - 1).toBe(true);
    expect(schema !== null && schieber !== null && Math.abs(schema.x - schieber.x) < 24).toBe(true);

    const breit = await page.getByTestId("hoehenmodell-test").evaluate((wurzel) => {
        const rand = wurzel.getBoundingClientRect().right;
        return [...wurzel.querySelectorAll<HTMLElement>("*")]
            .filter((el) => el.getBoundingClientRect().right > rand + 1)
            .map((el) => el.className)
            .slice(0, 5);
    });
    expect(breit).toEqual([]);

    const ordner = process.env["BILDER"];
    if (ordner !== undefined) {
        await karte.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${ordner}/telefon-1-durchhang.png` });
        const kopf = page.getByTestId("hoehenmodell-vorschau-regler:prominenz");
        await kopf.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${ordner}/telefon-2-kopf.png` });
        await page.getByTestId("hoehenmodell-test-alle-werte").tap();
        const aeste = page.getByTestId("hoehenmodell-vorschau-n:kammgebirge:struktur.astAbstand");
        await expect(aeste).toBeVisible();
        await aeste.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${ordner}/telefon-3-aeste.png` });
    }
});
