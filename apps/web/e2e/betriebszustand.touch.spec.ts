import { expect, test } from "@playwright/test";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Betriebszustand am Telefon (WI-0127 SYS-5; Blatt WI-0119 A4): die Schiene ist die Auswahl „Betriebszustand“,
 * der Hauptschalter steht zuerst und gestapelt, weil „Eingeschränkt“ nicht in ein Drittel passt; der Satz zu „Wartung“ steht darunter,
 * die Bedeutungen fallen weg, der Kurzstatus folgt. Die Bestätigung bleibt mit Folge und Grund an der Stelle. Sitzung und Verwaltung
 * aus dem Nachbau (`verwaltung-stub.ts`, Begründung in `betriebszustand.spec.ts`).
 */
test("🔴 am Telefon: Auswahl in der Leiste, Hauptschalter zuerst und gestapelt, Bestätigung mit Grund an der Stelle", async ({
    page,
}) => {
    const calls = await stubAdmin(page, {
        capabilities: [...ADMIN_CAPABILITIES, "manage_system_settings", "access_restricted_mode"],
        role: "operator",
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").tap();
    await page.getByTestId("menue-systemsteuerung").tap();
    const fenster = page.getByRole("dialog", { name: "Systemsteuerung" });
    await expect(fenster).toBeVisible();
    const auswahl = page.getByTestId("verwaltung-auswahl").getByRole("combobox", { name: "Bereiche der Verwaltung" });
    // Ohne „Bereich ›“ davor (seit `34593e61`; die Gruppen der Systemsteuerung, Betreiber 2026-10-17, stehen nur in der Schiene).
    await expect(auswahl.locator("option[value='betrieb']")).toHaveText("Betriebszustand");
    await auswahl.selectOption("betrieb");
    await expect(page.getByTestId("betrieb")).toBeVisible();
    await expect(fenster.locator(".avm-fenster__fuss-hinweis")).toHaveText("Fragt einmal nach dem Passkey.");

    // Reihenfolge im Baum: Hauptschalter, dann Kurzstatus (Blatt A4); die Bedeutungen fehlen.
    const haupt = await page.getByTestId("betrieb-hauptschalter").boundingBox();
    const kurz = await page.getByTestId("betrieb-kurzstatus").boundingBox();
    expect(haupt !== null && kurz !== null && haupt.y < kurz.y).toBe(true);
    await expect(page.getByTestId("betrieb-bedeutung")).toHaveCount(0);

    // Gestapelt: drei Segmente untereinander in voller Breite, der Satz zu „Wartung“ darunter.
    const segmente = await Promise.all(
        ["normal", "restricted", "maintenance"].map((value) =>
            page.getByTestId(`betrieb-schalter-${value}`).boundingBox(),
        ),
    );
    const [normal, eingeschraenkt, wartung] = segmente;
    expect(normal && eingeschraenkt && wartung).toBeTruthy();
    expect(Math.abs(normal!.x - eingeschraenkt!.x)).toBeLessThan(1);
    expect(Math.abs(normal!.width - wartung!.width)).toBeLessThan(1);
    expect(normal!.y).toBeLessThan(eingeschraenkt!.y);
    expect(eingeschraenkt!.y).toBeLessThan(wartung!.y);
    const satz = await page
        .getByTestId("betrieb-hauptschalter")
        .getByText("„Wartung“ wird auf dem Server geschaltet.")
        .boundingBox();
    expect(satz !== null && satz.y >= wartung!.y + wartung!.height).toBe(true);
    // „Eingeschränkt“ steht ganz da, ohne „…“.
    const wort = page.getByTestId("betrieb-schalter-restricted").locator(".einzeilig");
    expect(await wort.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    // Kurzstatus untereinander.
    const karte = await page.getByTestId("betrieb-status-karte").boundingBox();
    const anmeldung = await page.getByTestId("betrieb-status-anmeldung").boundingBox();
    expect(karte !== null && anmeldung !== null && Math.abs(karte.x - anmeldung.x) < 1 && karte.y < anmeldung.y).toBe(
        true,
    );

    // Umschalten: Bestätigung an der Stelle, Grund Pflicht, danach wirksam.
    await page.getByTestId("betrieb-schalter-restricted").tap();
    const frage = page.getByTestId("betrieb-frage-mode");
    await expect(frage).toContainText("Betrieb einschränken?");
    await expect(frage.getByRole("button", { name: "Einschränken" })).toBeDisabled();
    await page.getByTestId("betrieb-frage-mode-grund").getByRole("textbox").fill("Wiederherstellung prüfen");
    await frage.getByRole("button", { name: "Einschränken" }).tap();
    await expect(page.getByTestId("betrieb-wirksam")).toContainText("Eingeschränkt");
    expect(calls.filter((call) => call.path === "/api/admin/system/mode").map((call) => call.body)).toEqual([
        expect.objectContaining({ mode: "restricted", reason: "Wiederherstellung prüfen" }),
    ]);

    // Nichts ragt über den Rand.
    const box = await fenster.boundingBox();
    const viewport = page.viewportSize();
    expect(box !== null && viewport !== null && box.width <= viewport.width).toBe(true);
    const rumpf = fenster.getByTestId("fenster-rumpf");
    expect(await rumpf.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
