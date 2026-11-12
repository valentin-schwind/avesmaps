import { expect, test, type Page } from "@playwright/test";
import { RECHTE, ZEITZONE, dritterTagesKopf, stubs } from "./aenderungen-liste-stub.ts";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Neugestaltung von „Änderungen“ am Telefon (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`): Das ↺ am Zeilenende gibt es dort NIE (kein Überfahren, kein Platz); die Zeile bleibt in zwei Zeilen; das Detail ersetzt
 * die Liste („‹ Zur Liste“, der Ablauf von B9), und seine Griffleiste steht auch bei 400 px in EINER Zeile.
 */
test.use({ timezoneId: ZEITZONE });

async function oeffneListe(page: Page): Promise<void> {
    await stubAdmin(page, { capabilities: RECHTE, role: "editor" });
    await stubs(page);
    await openMap(page, `${EDITOR_MODE}?tab=aenderungen`);
    await page.getByTestId("editor-panel-tab").tap();
    await expect(page.getByTestId("editor-panel")).toBeVisible();
    await expect(page.getByTestId("editorpanel-aenderung").first()).toBeVisible();
}

test("🔴 Telefon: kein ↺ am Zeilenende; Tagesköpfe, Zeilen in höchstens zwei Zeilen, die Suche als Lupe", async ({
    page,
}) => {
    await oeffneListe(page);
    await expect(page.getByTestId("editorpanel-aenderungen-tag")).toHaveText(["Heute", "Gestern", dritterTagesKopf()]);
    // Das ↺ der Vorlage (Variante B) steht beim Überfahren; am Telefon gibt es keins, auch nach dem Antippen der Zeile nicht.
    await expect(page.getByTestId("editorpanel-aenderung-zeile-ruck")).toHaveCount(0);
    const erste = page.getByTestId("editorpanel-aenderung").first().getByTestId("editorpanel-aenderung-zeile");
    expect((await erste.boundingBox())!.height).toBeLessThan(60);
    // Suche, „Meine | Alle“, Trichter und ↻ stehen in derselben Zeile.
    // Passt ein kurzes „Suchen …“ neben die Zeichen, steht es als Feld da; sonst als Lupe (`AvmListenleiste`): In beiden Fällen in derselben Zeile.
    const lupe = page
        .getByTestId("editorpanel-aenderungen-leiste-lupe")
        .or(page.getByTestId("editorpanel-aenderungen-leiste-suche"));
    await expect(lupe).toBeVisible();
    const boxen = await Promise.all(
        [
            lupe,
            page.getByTestId("aenderungen-wer-reiter-alle"),
            page.getByTestId("editorpanel-aenderungen-filter"),
            page.getByTestId("editorpanel-aenderungen-neu"),
        ].map((ort) => ort.boundingBox()),
    );
    const mitten = boxen.map((box) => box!.y + box!.height / 2);
    for (const y of mitten) expect(Math.abs(y - mitten[0]!)).toBeLessThan(4);
});

test("🔴 Telefon: das Detail ersetzt die Liste, die Griffleiste steht in EINER Zeile, ‹ Zur Liste bringt die Liste zurück", async ({
    page,
}) => {
    await oeffneListe(page);
    await page.getByTestId("editorpanel-aenderung").first().getByTestId("editorpanel-aenderung-zeile").tap();
    const telefon = page.getByTestId("editorpanel-aenderungen-telefon-detail");
    await expect(telefon).toBeVisible();
    await expect(page.getByTestId("editorpanel-aenderungen-zur-liste")).toHaveText("‹ Zur Liste");

    const detail = telefon.getByTestId("editorpanel-aenderung-detail");
    const knoepfe = [
        detail.getByTestId("editorpanel-aenderung-ruecknahme"),
        detail.getByTestId("editorpanel-aenderung-karte"),
        detail.getByTestId("editorpanel-aenderung-sprung"),
        detail.getByTestId("editorpanel-aenderung-nur-objekt"),
    ];
    const boxen = await Promise.all(knoepfe.map((knopf) => knopf.boundingBox()));
    for (const box of boxen) expect(Math.abs(box!.y - boxen[0]!.y)).toBeLessThan(3);
    // Nichts ragt über den Rand: kein Seitwärtsrollen im Detail.
    expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    await page.getByTestId("editorpanel-aenderungen-zur-liste").tap();
    await expect(telefon).toHaveCount(0);
    await expect(page.getByTestId("editorpanel-aenderung").first()).toBeVisible();
});

test("🔴 Telefon: eine Serie zeigt ihr Detail mit den Mitgliedern; ein Mitglied klappt darin für sich auf", async ({
    page,
}) => {
    await oeffneListe(page);
    await page.getByTestId("editorpanel-aenderung-serie").getByTestId("editorpanel-aenderung-serie-zeile").tap();
    const telefon = page.getByTestId("editorpanel-aenderungen-telefon-detail");
    await expect(telefon.getByTestId("editorpanel-aenderung-serien-detail")).toBeVisible();
    const mitglieder = telefon.locator("ol.schiene").getByTestId("editorpanel-aenderung");
    await expect(mitglieder).toHaveCount(3);
    await mitglieder.nth(1).getByTestId("editorpanel-aenderung-zeile").tap();
    await expect(mitglieder.nth(1).getByTestId("editorpanel-aenderung-detail")).toBeVisible();
});
