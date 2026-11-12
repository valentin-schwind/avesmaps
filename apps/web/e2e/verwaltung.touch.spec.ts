import { expect, test } from "@playwright/test";
import { MITTAG, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Verwaltung am Telefon (WI-0120 A10; Mockup `07-handy`): Personen als Karten mit Feldzeilen, die Summe über den Karten, der
 * kurze Fußsatz. Sperren fragt auch hier an Ort und Stelle nach dem Grund. Die Schiene ist am Telefon eine Auswahl in der Leiste
 * (WI-0127 SYS-1, Blatt WI-0119 Fassung 2, A4).
 */
test("🔴 am Telefon: die Schiene ist eine Auswahl der Einträge in der Leiste, je Fenster seine Einträge (SYS-15)", async ({
    page,
}) => {
    await stubAdmin(page);
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-kontenverwaltung").tap();
    const konten = page.getByRole("dialog", { name: "Kontenverwaltung" });
    await expect(konten).toBeVisible();
    await expect(page.getByTestId("fenster-schiene")).toHaveCount(0);
    const auswahl = page.getByTestId("verwaltung-auswahl").getByRole("combobox", { name: "Bereiche der Verwaltung" });
    // Seit `34593e61` (Betreiber 2026-10-14: „keine trennlinie, keine gruppierungen“) steht kein „Bereich ›“ mehr vor dem Eintrag.
    await expect(auswahl.locator("option")).toHaveText([
        "Personen (7)",
        "Einladungen (2)",
        "Rollen & Rechte",
        "Protokoll",
    ]);
    await auswahl.selectOption("einladungen");
    await expect(page.getByTestId("verwaltung-einladungen")).toBeVisible();
    const box = await konten.boundingBox();
    const viewport = page.viewportSize();
    expect(box !== null && viewport !== null && box.width <= viewport.width).toBe(true);

    // Die Systemsteuerung in der Reihenfolge der vier Gruppen (Betreiber 2026-10-17, WI-0127 §23). Am Telefon ohne Gruppennamen vor dem
    // Reiter, damit die Auswahl kurz bleibt.
    await page.getByTestId("verwaltung-schliessen").tap();
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-systemsteuerung").tap();
    const system = page.getByRole("dialog", { name: "Systemsteuerung" });
    await expect(system).toBeVisible();
    await expect(system.getByTestId("fenster-leiste")).toContainText("Warteschlange");
    await expect(auswahl.locator("option")).toHaveText([
        "Betriebszustand",
        "Systemzustand",
        "Warteschlange",
        "Backups",
        "Protokoll",
        "Umgebungen",
        "Versionen",
        "Datenabgleich",
        "Kartenserien",
        "Medieninhalte",
        "Höhenmodell",
        "Standardwerte",
        "Wegfindung",
        "Zoombänder",
        "Neuigkeiten",
        "Mailpostfach",
    ]);
    // „Claudia & Claudio“ ist der Betreiber-Kanal (KANAL-0001 K3); ein Admin hat ihn nicht in der Auswahl.
    await expect(auswahl.locator("option[value='claudio']")).toHaveCount(0);
    // Die Statusseite steht als Ansicht in der Auswahl, nicht mehr als Verweis daneben.
    await expect(page.getByTestId("verwaltung-eintrag-statusseite")).toHaveCount(0);
    await auswahl.selectOption("backup");
    await expect(page.getByTestId("verwaltung-backup")).toContainText("Eine Sicherung ist ein Geheimnis.");
});

test("🔴 am Telefon: Personen als Karten, Sperren mit Grund in der Karte", async ({ page }) => {
    // Feste Uhr: „gestern“ ist ein Kalendertag, die Sperre von vor 25 Stunden hieße kurz nach Mitternacht „vor 2 Tagen“.
    const calls = await stubAdmin(page, { uhr: MITTAG });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-kontenverwaltung").tap();
    const fenster = page.getByRole("dialog", { name: "Kontenverwaltung" });
    await expect(fenster).toBeVisible();
    await expect(page.getByTestId("personen-tabelle")).toHaveCount(0);
    await expect(page.getByTestId("personen-summe")).toHaveText("7 Personen · 6 aktiv · 1 gesperrt");
    await expect(fenster.locator(".avm-fenster__fuss-hinweis")).toHaveText("Wirkt sofort, ohne „Speichern“.");

    const karte = page.getByTestId("person-a1b2c3d4-0000-4000-8000-000000000001");
    await expect(karte).toContainText("Gesperrt:");
    await expect(karte).toContainText("gestern · Rondrikan");
    await expect(karte.getByRole("button", { name: "Entsperren" })).toBeVisible();

    const box = await fenster.boundingBox();
    const viewport = page.viewportSize();
    expect(box !== null && viewport !== null && box.width <= viewport.width).toBe(true);

    await page.getByTestId("person-sperren-a1b2c3d4-0000-4000-8000-000000000007").tap();
    const grund = page.getByTestId("person-sperren-grund").getByRole("textbox");
    await grund.fill("Verdacht auf Fremdzugriff");
    await page.getByTestId("person-sperren-frage").getByRole("button", { name: "Sperren" }).tap();
    await expect(page.getByTestId("person-sperren-frage")).toBeHidden();
    expect(calls.filter((call) => call.path === "/api/admin/people/lock").map((call) => call.body)).toEqual([
        expect.objectContaining({
            personId: "a1b2c3d4-0000-4000-8000-000000000007",
            reason: "Verdacht auf Fremdzugriff",
        }),
    ]);
});
