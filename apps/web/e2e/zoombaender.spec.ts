import { expect, test, type Page } from "@playwright/test";
import { zoombaenderServer, zoombaenderStand, type ZoombaenderServer } from "./zoombaender-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Reiter „Zoombänder“ (WI-0221) im Browser gegen den Nachbau (`zoombaender-stub.ts`). Vorlage ist der abgenommene Entwurf Fassung 4
 * (Betreiber 2026-10-18: „das mockup ist das interaktive blatt“). Die echten Routen prüft `apps/server/test/zoombaender.test.ts`.
 */

const MIT_RECHT = [...ADMIN_CAPABILITIES, "manage_display_settings"];

async function oeffnen(page: Page, server: ZoombaenderServer, capabilities: string[] = MIT_RECHT) {
    await stubAdmin(page, {
        capabilities,
        role: "admin",
        person: { passkeyCount: 1 },
        answer: (call) => server.handle(call),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-zoombaender").click();
    await expect(page.getByTestId("zoombaender")).toBeVisible();
}

test("🔴 sechs Panele nach Wirkort; Orte mit Legacys gespeichertem Stand; Herrschaftsgebiete ohne Anfasser", async ({
    page,
}) => {
    await oeffnen(page, zoombaenderServer());
    for (const panel of ["orte", "wege", "landschaften", "gebiete", "kraftlinien", "gelaende"])
        await expect(page.getByTestId(`zoombaender-panel-${panel}`)).toBeVisible();
    await expect(page.getByTestId("zoombaender-vonbis-orte.dorf.name")).toHaveText("5 bis 8");
    await expect(page.getByTestId("zoombaender-vonbis-wege.Pfad.name")).toHaveText("0 bis 8");
    await expect(page.getByTestId("zoombaender-panel-gebiete").getByRole("slider")).toHaveCount(0);
    // Vorlage Fassung 4: der Verweis in den Gebietseditor, als Tiefer Link wie das Verb im Editorpanel.
    await expect(page.getByTestId("zoombaender-zum-gebietseditor")).toHaveAttribute("href", "/edit?tab=gebietseditor");
    await expect(page.getByTestId("zoombaender-uebernehmen")).toBeDisabled();
    await expect(page.getByTestId("zoombaender-zustand")).toHaveText("Alle Spannen stehen auf der Vorgabe.");
});

test("🔴 verstellen im Entwurf, Übernehmen schickt alle Spannen in EINEM Schreibweg", async ({ page }) => {
    const server = zoombaenderServer();
    await oeffnen(page, server);
    await page.getByTestId("zoombaender-spur-orte.dorf.name-griff-von").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("zoombaender-vonbis-orte.dorf.name")).toHaveText("4 bis 8");
    await page.getByTestId("zoombaender-spur-wege.Pfad.name-griff-bis").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("zoombaender-folge-wege.Pfad.name")).toHaveText(
        "Wirkt beim nächsten Laden der Karte.",
    );
    await expect(page.getByTestId("zoombaender-zustand")).toHaveText("Geändert, noch nicht übernommen: 2");
    await page.getByTestId("zoombaender-uebernehmen").click();
    await expect.poll(() => server.posts.length).toBe(1);
    expect(server.posts[0]?.["aenderungen"]).toEqual([
        { id: "orte.dorf.name", spanne: { von: 4, bis: 8 } },
        { id: "wege.Pfad.name", spanne: { von: 0, bis: 6 } },
    ]);
    await expect(page.getByTestId("zoombaender-zustand")).toHaveText(
        "Von der Vorgabe abweichend: 2 · alles übernommen",
    );
    await expect(page.getByTestId("verwaltung-eintrag-zoombaender")).toContainText("2 verstellt");
});

test("↺ setzt die Zeile auf die Vorgabe; übernommen heißt das: die Abweichung weg", async ({ page }) => {
    const server = zoombaenderServer(
        zoombaenderStand([
            {
                id: "orte.dorf.name",
                spanne: { von: 3, bis: 8 },
                changedAt: new Date().toISOString(),
                changedBy: "Rondrikan",
            },
        ]),
    );
    await oeffnen(page, server);
    await expect(page.getByTestId("zoombaender-vonbis-orte.dorf.name")).toHaveText("3 bis 8");
    await page.getByTestId("zoombaender-zurueck-orte.dorf").click();
    await expect(page.getByTestId("zoombaender-vonbis-orte.dorf.name")).toHaveText("5 bis 8");
    await page.getByTestId("zoombaender-uebernehmen").click();
    await expect.poll(() => server.posts.at(-1)?.["aenderungen"]).toEqual([{ id: "orte.dorf.name", spanne: null }]);
    await expect(page.getByTestId("zoombaender-zurueck-orte.dorf")).toBeDisabled();
});

test("Vorschau: eine Bandzahl im Kopf wählt das Band; Zeilen ohne etwas zu sehen treten zurück", async ({ page }) => {
    await oeffnen(page, zoombaenderServer());
    await page.getByTestId("zoombaender-kopf-orte-0").locator('[data-band="0"]').click();
    await expect(page.getByTestId("zoombaender-vorschau")).toContainText("(ganz Aventurien)");
    await expect(page.getByTestId("zoombaender-zeile-orte.dorf")).toHaveClass(/zoombaender__zeile--blass/);
    await expect(page.getByTestId("zoombaender-zeile-orte.metropole")).not.toHaveClass(/zoombaender__zeile--blass/);
});

test("ohne das Recht: ansehen ja, verstellen nicht", async ({ page }) => {
    await oeffnen(page, zoombaenderServer(), ADMIN_CAPABILITIES);
    await expect(page.getByTestId("zoombaender-nur-lesen")).toBeVisible();
    await expect(page.getByTestId("zoombaender-uebernehmen")).toBeDisabled();
    await expect(page.getByTestId("zoombaender-spur-orte.dorf.name-griff-von")).toHaveCount(0);
});
