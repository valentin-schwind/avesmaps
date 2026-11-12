import { expect, test } from "@playwright/test";
import { openOverview, settingsLine } from "./route-settings-line.ts";
import { openPlannerBox } from "./planner-boxes.ts";

/**
 * 🔴 Die Einstellungszeile unter dem Reisetitel am Rechner (Betreiber 2026-10-04: „könnte man einen one line unter den
 * reisetitel in der reiseübersicht mit den wichtigsten einstellungen?“). Danach „die transportmittel kannst du weglassen“,
 * „A aber datum braucht es nicht, da steht schon drunter“ und „lasst das 8.0/Tag auch weg, steht ja ein paar zeilen
 * drüber“: Die Zeile nennt nur Routenart und Umsteigen, im Flug „Flug“; kein Transportmittel, kein Reisebeginn, keine
 * Reisestunden. Sie ist EINE Zeile, am Ende gekürzt, wenn der Platz nicht reicht (Regel A), und der volle Text steht im DOM
 * und im `title`. Gemessen: Das Panel gibt ihr 292 px Text; die längste Zeile, „Schnellste Route · Umsteigen minimieren“,
 * ist 205 px breit.
 */

/** Die Reise des Betreibers: Kürzeste Route, Einzelreiter, Galeere, eine Landreise. */
const OPERATOR_ROUTE =
    "?route=@395.53,712.67~@539.63,620.53&pathType=shortest&landTransport=lightRider&seaTransport=galley";
/** Mit Umsteigen, Reisebeginn und anderen Reisestunden: Nur Routenart und Umsteigen stehen in der Zeile. */
const TIMED = "?route=Gareth~Perricum&pathType=shortest&minimizeTransfers=1&startMonth=firun&startDay=15&restHours=14";

test("🔴 die Zeile steht unter dem Titel, ist EINE Zeile, ohne Transportmittel und nicht abgeschnitten", async ({
    page,
}) => {
    const line = await openOverview(page, OPERATOR_ROUTE);
    // Einzelreiter und Galeere stehen nicht darin, die Reisestunden auch nicht.
    await expect(line).toHaveText("Kürzeste Route");
    const measured = await settingsLine(page);
    expect(measured.lines).toBe(1);
    expect(measured.height).toBeLessThan(measured.lineHeight * 1.5);
    expect(measured.belowTitle).toBe(true);
    expect(measured.truncated).toBe(false);
    expect(measured.title).toBe(measured.text);
});

test("🔴 Umsteigen steht in der Zeile, Reisebeginn und Reisestunden nicht (sie stehen darunter und darüber)", async ({
    page,
}) => {
    const line = await openOverview(page, TIMED);
    await expect(line).toHaveText("Kürzeste Route · Umsteigen minimieren");
    // Der Reisebeginn steht bei „Abreise“, die Reisestunden in der zugeklappten Leiste „Reiseoptionen“.
    await expect(page.getByTestId("route-departure")).toHaveText("15. Firun");
    // Seit dem 2026-10-06 nennt die Leiste alle drei Einstellungen des Kastens, in seiner Reihenfolge.
    await expect(page.getByTestId("planner-options").locator(".disclosure__secondary")).toHaveText(
        "10,0 h/Tag · ab 15. Firun · Gemeinschaftszimmer",
    );
    const measured = await settingsLine(page);
    expect(measured.lines).toBe(1);
    expect(measured.belowTitle).toBe(true);
    expect(measured.truncated).toBe(false);
    expect(measured.text).not.toMatch(/Firun|h\/Tag|\d/);
    expect(measured.title).toBe(measured.text);
});

test("🔴 ein Klick auf „Kürzeste“ ändert die Zeile, ebenso Umsteigen; Reisestunden und Reisebeginn nicht", async ({
    page,
}) => {
    const line = await openOverview(page, "?route=Gareth~Perricum");
    await expect(line).toHaveText("Schnellste Route");

    await openPlannerBox(page, "transport");
    await page.getByTestId("optimize-shortest").check();
    await expect(line).toHaveText("Kürzeste Route");

    await page.getByTestId("minimize-transfers").check();
    await expect(line).toHaveText("Kürzeste Route · Umsteigen minimieren");

    // Ein Medium auszuschalten ändert die Zeile nicht: Transportmittel und „ohne Meer“ stehen nicht darin.
    await page.getByTestId("allow-sea").uncheck();
    await expect
        .poll(() => page.evaluate(() => globalThis.location.search))
        .toBe("?route=Gareth~Perricum&pathType=shortest&minimizeTransfers=1&allowSea=0");
    await expect(line).toHaveText("Kürzeste Route · Umsteigen minimieren");

    await page.getByTestId("optimize-fastest").check();
    await expect(line).toHaveText("Schnellste Route · Umsteigen minimieren");

    // Reisestunden und Reisebeginn ändern die Route, aber nicht die Zeile: Sie stehen bei den Optionen und den Kennzahlen.
    await openPlannerBox(page, "options");
    const hours = page.getByTestId("hours-per-day");
    await hours.fill("10");
    await hours.press("Tab");
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toContain("restHours=14");
    await page.getByTestId("travel-start-month").getByRole("button").click();
    await page.getByRole("option", { name: "Firun (Winter)" }).click();
    await expect(page.getByTestId("route-departure")).toHaveText("1. Firun");
    await expect(line).toHaveText("Schnellste Route · Umsteigen minimieren");
});

test("🔴 ein Flug heißt „Flug“, ohne Flugmittel, Routenart, Transportmittel, Reisebeginn und Reisestunden", async ({
    page,
}) => {
    const line = await openOverview(page, "?route=Gareth~Perricum&air=griffin");
    await expect(line).toHaveText("Flug");
    const measured = await settingsLine(page);
    expect(measured.lines).toBe(1);
    expect(measured.truncated).toBe(false);
    expect(measured.title).toBe("Flug");

    // Auch mit Reisebeginn und anderen Stunden: Er steht bei „Abreise“; die Routenart gehört im Flug nicht dazu.
    const dated = await openOverview(
        page,
        "?route=Gareth~Perricum&air=griffin&pathType=shortest&startMonth=firun&startDay=15&restHours=14",
    );
    await expect(dated).toHaveText("Flug");
    await expect(page.getByTestId("route-departure")).toHaveText("15. Firun");
});

test("🔴 englisch: Legacys Wörter, dieselbe Zeile", async ({ page }) => {
    const flight = await openOverview(page, "?route=Gareth~Perricum&lang=en&air=griffin&startMonth=firun&startDay=15");
    await expect(flight).toHaveText("Flight");
    const longest = await openOverview(page, `${TIMED}&lang=en`);
    await expect(longest).toHaveText("Shortest route · Minimize transfers");
});

test("🔴 die geteilte Reise mit Kurzlink zeigt dieselbe Zeile", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const line = await openOverview(page, `${OPERATOR_ROUTE}&startMonth=firun&startDay=15`);
    await expect(line).toHaveText("Kürzeste Route");
    const original = await settingsLine(page);

    await page.getByTestId("route-share").click();
    await expect(page.getByTestId("toast")).toContainText("Kurzlink kopiert: ");
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toMatch(/\/\?s=[2-9a-km-zA-HJ-NP-Z]{8}$/);

    const fresh = await context.newPage();
    await fresh.goto(url);
    await fresh.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(fresh.getByTestId("route-settings")).toBeVisible({ timeout: 20_000 });
    expect((await settingsLine(fresh)).text).toBe(original.text);
    // Der Reisebeginn reist mit dem Kurzlink, und zwar bei „Abreise“.
    await expect(fresh.getByTestId("route-departure")).toHaveText("15. Firun");
});
