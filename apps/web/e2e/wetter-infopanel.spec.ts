import { expect, test } from "@playwright/test";
import { WETTER_SYMBOL_VORGABEN, wetterWikiAdresse } from "@avesmaps3d/shared";
import { openMap } from "./map-handle.ts";
import { iconMitte, stubWetterInfopanel, zuIcon } from "./wetter-infopanel-stub.ts";

/**
 * Das Infopanel eines Wetter-Icons (WI-0288; Betreiber 2026-11-08: „ja infopanel bauen“), nur in PC-Größe und mit echter Grafikkarte (ANGLE über D3D11): Die Icons stehen
 * nur, solange das Wetter läuft. 🔴 Kein Test schreibt in eine Datenbank: Wetter und Detailantwort kommen aus Nachbauten (`wetter-infopanel-stub.ts`), jede schreibende
 * Anfrage an `/api` endet im Browser.
 *
 * Problemfälle: Ein Klick auf ein Icon mit Verweis öffnet nichts oder den Ort darunter; der Kopf zeigt das Bild einer anderen Art; der Verweis auf den Artikel fehlt; ein Icon
 * ohne Verweis fragt nach einem Panel.
 */

test.use({
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] },
});
test.setTimeout(240_000);

const WIND = WETTER_SYMBOL_VORGABEN[0]!;
const PASSAT = WETTER_SYMBOL_VORGABEN[1]!;
const ARTIKEL = {
    titel: "Probewind (Wind)",
    art: "Wind",
    region: "Probeküste",
    beschreibung: "Ein erfundener Wind für die Probe.",
};

test("🔴 ein Klick auf ein Icon mit Wiki-Verweis öffnet sein Infopanel mit Typbild und Wiki-Link; ein Icon ohne Verweis öffnet nichts", async ({
    page,
}) => {
    const server = await stubWetterInfopanel(page, { [WIND.id]: ARTIKEL });
    await openMap(page);

    // Ohne Verweis: Der Klick gehört der Karte darunter, nach einem Panel des Icons fragt niemand.
    await zuIcon(page, PASSAT);
    const passat = await iconMitte(page, PASSAT.id);
    await page.mouse.click(passat.x, passat.y);
    await page.waitForTimeout(800);
    expect(server.gefragt).toEqual([]);
    await expect(page.getByTestId("info-title").filter({ hasText: PASSAT.name! })).toHaveCount(0);

    // Mit Verweis: das Panel des Icons.
    await zuIcon(page, WIND);
    const wind = await iconMitte(page, WIND.id);
    await page.mouse.move(wind.x, wind.y);
    await page.mouse.click(wind.x, wind.y);
    await expect(page.getByTestId("info-title")).toHaveText(WIND.name!);
    expect(server.gefragt).toEqual([WIND.id]);
    await expect(page.getByTestId("info-subtitle")).toHaveText("Wind");
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", "wind");
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("src", /\/icons\/header\/wind\.webp$/u);
    await expect(page.getByText("Probeküste")).toBeVisible();
    await expect(
        page.getByTestId("info-source").locator(`a[href="${wetterWikiAdresse(ARTIKEL.titel)}"]`),
    ).toBeVisible();
    // Das offene Icon trägt den Ton der Auswahl.
    await expect(page.locator(`[data-wetter-icon="${WIND.id}"]`)).toHaveClass(/ws-sel/u);
});
