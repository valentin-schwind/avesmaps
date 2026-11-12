import { expect, test, type Page } from "@playwright/test";
import { routeAnswer } from "./route-evidence.ts";
import { openStageGroups } from "./stage-groups.ts";
import { openStagePanel, stageFieldValue } from "./stage-panel.ts";

/**
 * Der Reisebeginn am echten Stack (WI-0038): Feld, Adresse, Sperrhinweise nach Legacys Variante C.
 *
 * 🔴 Die Proben hängen am Datensatz (Satz map154313, ebenso map147359): Der Saljethweg zwischen Greifenfurt und Lowangen ist
 * für Reiter nur von Praios bis Efferd gangbar, zu Fuß ganzjährig; der Golf von Riva nur von Peraine bis
 * Boron, wegen Vereisung (Tafel `meerSperren` im Reisemodell; die Seefahrt fährt frei, ohne Seewege, WI-0046). Varmur liegt auf dem Festland, das Geheimlager des Horasiats erreicht nur die See. Mit
 * einem anderen Satz können die Sätze fehlen - dann zuerst die Daten prüfen.
 */

async function openPlanner(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
}

test("🔴 ohne Reisebeginn der Hinweis auf die Sperrzeit; der Firun leitet um und nennt Weg, Tag und Fenster", async ({
    page,
}) => {
    await openPlanner(page, "?route=Greifenfurt~Lowangen&landTransport=lightRider");
    await expect(page.getByTestId("route-seasonal-ways")).toContainText(
        "Ohne Reisebeginn geplant — auf der Route liegen Sperrzeiten: Saljethweg (befahrbar vom 1. Praios bis zum 30. Efferd)",
    );
    await expect(page.getByTestId("travel-start-day")).toBeDisabled();
    await expect(page.getByTestId("route-departure")).toHaveCount(0);

    // Den Monat wählen: Die Adresse schreibt ihn, das Tagesfeld lebt, die Route rechnet neu.
    await page.getByTestId("options-toggle").click();
    // Beschriftung, Tag und Monat in einer Zeile; das Feld sagt nur „Unbestimmt“ (Betreiber 2026-09-26, Wort seit
    // 2026-10-06: „ich würde es umbennen in ‚unbestimmt‘“).
    await expect(page.getByTestId("travel-start-month")).toHaveText("Unbestimmt");
    // Gemessen wird nach dem Aufklappen: Mitten in der Bewegung stehen die Felder noch versetzt.
    await expect
        .poll(async () => {
            const label = await page.getByText("Reisebeginn:").boundingBox();
            const month = await page.getByTestId("travel-start-month").boundingBox();
            return (
                label !== null &&
                month !== null &&
                label.y >= month.y &&
                label.y + label.height <= month.y + month.height
            );
        })
        .toBe(true);
    await page.getByTestId("travel-start-month").getByRole("button").click();
    const winterAnswer = routeAnswer(page);
    await page.getByRole("option", { name: "Firun (Winter)" }).click();
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toContain("startMonth=firun");
    await expect(page.getByTestId("travel-start-day")).toBeEnabled();
    const winter = await winterAnswer;
    const closures = winter.closures ?? [];
    expect(closures.length, "Voraussetzung: eine echte Sperrumleitung").toBeGreaterThan(0);
    expect(closures.every((closure) => !closure.blocked && !closure.avoided_anyway)).toBe(true);
    expect(closures[0]!.actual!.total_hours).toBeGreaterThan(closures[0]!.unrestricted.total_hours);
    await expect(page.getByTestId("route-closure-head")).toContainText("Wegen einer Sperrung anders geführt");
    await expect(page.getByTestId("route-closure-anyway")).toHaveCount(0);
    await expect(page.getByTestId("route-departure")).toHaveText("1. Firun");
    await expect(page.getByTestId("route-seasonal-ways")).toHaveCount(0);
    // Der Sperrhinweis der Etappe und ihr Zeitraum stehen seit WI-0079 im Infopanel (§4).
    await openStagePanel(page, 0);
    await expect(page.getByTestId("stage-note").first()).toContainText(
        "Wegen Schneemassen unpassierbar: Saljethweg — am 1. Firun, befahrbar vom 1. Praios bis zum 30. Efferd.",
    );
    await expect(stageFieldValue(page, "period")).toContainText("Firun");
});

test("🔴 ist die See zu, geht es an Land weiter: nach Varmur querfeldein, mit Umleitung (Betreiber 2026-09-26)", async ({
    page,
}) => {
    await openPlanner(page, "?route=Riva~Varmur&startMonth=firun");
    await expect(page.getByTestId("route-closure-head")).toContainText("Wegen einer Sperrung anders geführt");
    await expect(page.getByTestId("route-stages")).toContainText("Unwegsames Gelände");
    // 🔴 Seit WI-0087 P4 öffnet eine Reise ZUGEKLAPPT (Betreiber 2026-10-05: „kannst du doch lieber alle
    // etappenzusammenfassungen standardmäßg einklappen“). Wer eine Etappenzeile SEHEN oder anklicken will, klappt
    // selbst auf - `openStagePanel` tut das längst, dieser Fall hatte den Schritt nie bekommen und war dauerhaft rot.
    // 🪤 Dass es so lange unauffällig blieb, liegt an der Zeile darüber: `toContainText` liest auch zugeklappten Text,
    // `toBeVisible` nicht.
    await openStageGroups(page);
    const gesperrt = page.locator("[data-testid=route-stage].stage--closure").first();
    await expect(gesperrt).toBeVisible();
    await gesperrt.locator("img").first().click();
    await expect(page.getByTestId("stage-note").first()).toContainText(
        "Wegen Vereisung unpassierbar: Golf von Riva — am 1. Firun, befahrbar vom 1. Peraine bis zum 30. Boron.",
    );
    await expect(page.getByTestId("route-refusal")).toHaveCount(0);
});

test("🔴 nur über gesperrte Seewege: die Absage im Panel, mit Grund", async ({ page }) => {
    await openPlanner(page, `?route=Riva~${encodeURIComponent("Geheimlager des Horasiats")}&startMonth=firun`);
    await expect(page.getByTestId("route-refusal")).toContainText(
        "Keine offene Route von Riva nach Geheimlager des Horasiats",
    );
    await expect(page.getByTestId("route-refusal")).toContainText("befahrbar vom 1. Peraine bis zum 30. Boron");
    await expect(page.getByTestId("route-refusal")).toContainText("Wegen Vereisung unpassierbar: Golf von Riva");
});

/**
 * 🪤 **Die Reise ist am 2026-10-16 gewechselt, die Zusicherung nicht** (WI-0192 §2.5): Greifenfurt → Lowangen im Tsa
 * trägt den Saljethweg inzwischen auf der wirklichen Route — mit Sperre 343 h, ohne 319,5 h —, also meldet der Server
 * dort den anderen Bericht („anders geführt“) statt `avoided_anyway`. Kein Codefehler: Das Routing-Gate zählt am
 * 2026-10-16 `DATA_CHANGE 46 · REGRESSION 0`, die Daten (`map`, `terrain`, `pathProfiles`, `seaGraph`) sind seit der
 * Basislinie gewandert. Greifenfurt → **Tiefhusen** erfüllt die Voraussetzung wieder: dieselbe Sperre (Saljethweg,
 * Jahreszeit), dasselbe Mittel, derselbe Monat, 28 Etappen — und die Route ist nicht wegen ihr länger.
 */
test("🔴 im Tsa ohnehin gemieden: der Sperrhinweis nennt keine durch die Sperre verursachte Mehrzeit", async ({
    page,
}) => {
    const answer = routeAnswer(page);
    await openPlanner(page, "?route=Greifenfurt~Tiefhusen&landTransport=lightRider&startMonth=tsa&startDay=1");
    const route = await answer;
    const closures = route.closures ?? [];
    expect(closures.length, "Voraussetzung: ohnehin gemiedener gesperrter Weg").toBeGreaterThan(0);
    expect(closures.every((closure) => !closure.blocked && closure.avoided_anyway === true)).toBe(true);
    await expect(page.getByTestId("route-closure-anyway").locator(".closure__text")).toHaveText(
        "Ein Weg, den diese Reise sonst nähme, ist gesperrt — die Route meidet ihn ohnehin.",
    );
    await expect(page.getByTestId("route-closure-head")).toHaveCount(0);
    await expect(page.getByTestId("route-departure")).toHaveText("1. Tsa");
    await openStagePanel(page, 0);
    await expect(page.getByTestId("stage-note").first()).toContainText("Wegen Schneemassen unpassierbar: Saljethweg");
});
