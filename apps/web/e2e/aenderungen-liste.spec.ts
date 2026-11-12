import { expect, test, type Locator, type Page } from "@playwright/test";
import { RECHTE, ZEITZONE, dritterTagesKopf, op, stubs, type ListenStubs } from "./aenderungen-liste-stub.ts";
import { oeffneOrtseditor } from "./ortseditor-stub.ts";

/**
 * Die Neugestaltung von „Änderungen“ (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`, vom Betreiber am 2026-11-01 abgenommen und gewählt: „↺ in der Zeile -> B“, „Wiki- und Importläufe -> A“,
 * „Tagesköpfe -> An“). Der Server antwortet gestellt (`aenderungen-liste-stub.ts`: eine feste Uhr, vier Tage, Läufe, eine Rücknahme, eine Serie).
 *
 * Geprüft wird, was nur ein Browser zeigt: die Tagesköpfe, die Zeile in höchstens zwei Zeilen, das Bündel der Läufe, das ↺ beim Überfahren (und dass es nur fragt), das flache Detail mit der Griffleiste in EINER
 * Zeile, die Legende als Filter. Die Rücknahme selbst und die Karte haben ihre eigenen Specs (`aenderungen-ruecknahme.spec.ts`, `aenderungen-lage.spec.ts`).
 */
test.use({ viewport: { width: 1920, height: 1080 }, timezoneId: ZEITZONE });

async function oeffneAenderungen(page: Page): Promise<ListenStubs> {
    const gestellt = await stubs(page);
    await oeffneOrtseditor(page, { rechte: RECHTE, verb: false });
    await page.getByTestId("editorpanel-reiter-aenderungen").click();
    await expect(page.getByTestId("editorpanel-aenderung").first()).toBeVisible();
    return gestellt;
}

const zeileVon = (eintrag: Locator): Locator => eintrag.getByTestId("editorpanel-aenderung-zeile");
const hoehe = async (ort: Locator): Promise<number> => (await ort.boundingBox())!.height;

test("🔴 Tagesköpfe stehen über den Zeilen ihres Tages; die Zeile trägt nur die Uhrzeit, ohne Zeitzone", async ({
    page,
}) => {
    await oeffneAenderungen(page);
    await expect(page.getByTestId("editorpanel-aenderungen-tag")).toHaveText(["Heute", "Gestern", dritterTagesKopf()]);

    const erste = page.getByTestId("editorpanel-aenderung").first();
    await expect(erste).toContainText("Luring geändert");
    await expect(zeileVon(erste).locator("time")).toHaveText("13:02");
    await expect(zeileVon(erste)).not.toContainText("UTC");
    // Der Kopf klebt oben: Er bleibt sichtbar, wenn die Liste weiterrollt.
    const kopf = page.getByTestId("editorpanel-aenderungen-tag").first();
    expect(await kopf.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
});

test("🔴 jede Zeile höchstens zwei Zeilen, alle gleich gebaut: Person (der Anzeigename, auch bei der eigenen), Felder, „n Objekte“ nur bei mehr als einem; keine Pille, keine Kennung", async ({
    page,
}) => {
    await oeffneAenderungen(page);
    const alle = page.getByTestId("editorpanel-aenderung");

    // Die eigene Änderung trägt den Namen wie jede andere (keine Anrede, kein „(eigene Änderung)“).
    await expect(zeileVon(alle.nth(0))).toContainText("Rondrikan");
    await expect(zeileVon(alle.nth(0))).not.toContainText("eigene Änderung");
    await expect(zeileVon(alle.nth(1))).toContainText("Thomas");
    await expect(zeileVon(alle.nth(1))).toContainText("Einwohner, Beschreibung");
    // Kein Wort für den Zustand, keine Kennung in der Zeile: Der Zustand ist der Kreis, sein Wort steht im Tooltip.
    await expect(zeileVon(alle.nth(0)).getByRole("img", { name: "wirksam (rücknehmbar)" })).toBeVisible();
    await expect(zeileVon(alle.nth(0))).not.toContainText("rücknehmbar");
    await expect(zeileVon(alle.nth(0))).not.toContainText("…");

    // Höchstens zwei Zeilen (zwei Textzeilen und das Polster), auch mit langem Feldtext.
    for (const n of [0, 1]) expect(await hoehe(zeileVon(alle.nth(n)))).toBeLessThan(56);
});

test("🔴 Wiki- und Importläufe stehen je Tag als EINE gedämpfte Zeile und klappen zu den Läufen auf", async ({
    page,
}) => {
    await oeffneAenderungen(page);
    const wiki = page.getByTestId("editorpanel-aenderung-buendel").filter({ hasText: "Wiki-Abgleich" });
    await expect(wiki).toContainText("Wiki-Abgleich · 2 Läufe · 610 Felder");
    await expect(page.getByTestId("editorpanel-aenderung-buendel").filter({ hasText: "Import" })).toContainText(
        "Import · 1 Lauf · 3 Objekte",
    );
    // Gebündelt heißt: die Läufe stehen nicht einzeln in der Liste.
    await expect(page.getByTestId("editorpanel-aenderung").filter({ hasText: "WikiSync: 608 Felder" })).toHaveCount(0);
    await expect(wiki.getByRole("img", { name: "nicht rücknehmbar" })).toBeVisible();

    await wiki.getByTestId("editorpanel-aenderung-buendel-zeile").click();
    const laeufe = wiki.getByTestId("editorpanel-aenderung");
    await expect(laeufe).toHaveCount(2);
    // Mit Person (ein Mensch löste die Läufe aus), ohne Etikett (das Bündel sagt die Quelle).
    await expect(laeufe.first()).toContainText("Rondrikan");
    await expect(zeileVon(laeufe.first()).locator(".zk__etikett")).toHaveCount(0);
    // Ein Lauf ist eine Zeile wie jede andere: aufklappbar, mit dem Grund, warum es kein ↺ gibt.
    await zeileVon(laeufe.first()).click();
    await expect(laeufe.first().getByTestId("aenderung-detail-grund")).toContainText("eigene Wege");
});

test("🔴 ↺ erscheint beim Überfahren am Zeilenende, öffnet die Zeile und stellt nur die Rückfrage: Es schreibt nie", async ({
    page,
}) => {
    const { vorschau, zurueck } = await oeffneAenderungen(page);
    const erste = page.getByTestId("editorpanel-aenderung").first();
    const ruck = erste.getByTestId("editorpanel-aenderung-zeile-ruck");
    // Zuerst unsichtbar (Deckkraft 0), beim Überfahren da.
    await expect(ruck).toHaveCSS("opacity", "0");
    await zeileVon(erste).hover();
    await expect(ruck).toHaveCSS("opacity", "1");
    // Eine Zeile ohne Angebot (Original einer Rücknahme) trägt keins.
    await expect(
        page
            .getByTestId("editorpanel-aenderung")
            .filter({ hasText: "Rommilys geändert" })
            .getByTestId("editorpanel-aenderung-zeile-ruck"),
    ).toHaveCount(0);

    await ruck.click();
    await expect(zeileVon(erste)).toHaveAttribute("aria-expanded", "true");
    const frage = erste.getByTestId("editorpanel-aenderung-ruecknahme-frage");
    await expect(frage).toBeVisible();
    expect(vorschau).toEqual([{ members: [op(1)] }]);
    expect(zurueck).toEqual([]);
});

test("🔴 das Detail ist flach: Griffleiste in EINER Zeile (↺ als einziges Wort, ⊕ ⚙ ⌕ als Zeichen), Tafel, unten Zeitpunkt mit Zeitzone, Vorgang und Kennung", async ({
    page,
}) => {
    await oeffneAenderungen(page);
    const erste = page.getByTestId("editorpanel-aenderung").first();
    await zeileVon(erste).click();
    const detail = erste.getByTestId("editorpanel-aenderung-detail");
    await expect(detail).toBeVisible();

    // Flach: keine Rundung, keine eigene Kante ringsum, links die Schiene in der Akzentfarbe.
    const stil = await detail.evaluate((el) => {
        const s = getComputedStyle(el);
        return { radius: s.borderTopLeftRadius, links: s.borderLeftWidth, oben: s.borderTopWidth };
    });
    expect(stil).toEqual({ radius: "0px", links: "3px", oben: "0px" });

    // Die Griffleiste: ein Wortknopf, drei Zeichen; alle in einer Zeile.
    const ruecknehmen = detail.getByTestId("editorpanel-aenderung-ruecknahme");
    await expect(ruecknehmen).toHaveText("↺ Zurücknehmen");
    const karte = detail.getByTestId("editorpanel-aenderung-karte");
    const sprung = detail.getByTestId("editorpanel-aenderung-sprung");
    const nur = detail.getByTestId("editorpanel-aenderung-nur-objekt");
    await expect(karte).toHaveAttribute("aria-label", "Auf der Karte zeigen");
    await expect(sprung).toHaveAttribute("aria-label", "Im Objektverlauf zeigen");
    await expect(nur).toHaveAttribute("aria-label", "Nur dieses Objekt zeigen");
    await expect(karte).toHaveText("⊕");
    const ys = await Promise.all(
        [ruecknehmen, karte, sprung, nur].map(async (knopf) => (await knopf.boundingBox())!.y),
    );
    for (const y of ys) expect(Math.abs(y - ys[0]!)).toBeLessThan(3);

    // Die Tafel: − vorher (gestrichelt), + nachher; unten der Fuß.
    await expect(detail.locator(".verlauf__felder")).toContainText("Beschreibung");
    await expect(detail.locator(".verlauf__felder s")).toContainText("Südwestlich von Gareth");
    const fuss = detail.locator(".aenderung-detail__fuss");
    await expect(fuss).toContainText("UTC");
    await expect(fuss).toContainText("Vorgang");
    await expect(detail.getByTestId("aenderung-detail-kennung")).toContainText(op(1).slice(0, 8));
    await expect(detail.getByTestId("editorpanel-aenderung-kennung-kopieren")).toHaveAttribute(
        "aria-label",
        "Kennung kopieren",
    );
});

test("🔴 ein langer Wert steht in zwei Zeilen mit „mehr“ und „weniger“; was hineinpasst, trägt keinen Knopf", async ({
    page,
}) => {
    await oeffneAenderungen(page);
    const kuslik = page.getByTestId("editorpanel-aenderung").filter({ hasText: "Kuslik" });
    await zeileVon(kuslik).click();
    const mehr = kuslik.getByRole("button", { name: "mehr" });
    await expect(mehr).toHaveCount(1);
    const nachher = kuslik.locator(".wechsel__nachher .wechsel__t").filter({ hasText: "Große Hafenstadt" });
    const zu = (await nachher.boundingBox())!.height;
    await mehr.click();
    await expect(kuslik.getByRole("button", { name: "weniger" })).toBeVisible();
    expect((await nachher.boundingBox())!.height).toBeGreaterThan(zu);
    await kuslik.getByRole("button", { name: "weniger" }).click();
    expect((await nachher.boundingBox())!.height).toBeCloseTo(zu, 0);
    // Der kurze Wert (Einwohner) hat keins.
    await expect(kuslik.getByRole("button", { name: "mehr" })).toHaveCount(1);
});

test("🔴 eine Rücknahme und ihr Original verweisen aufeinander; die Rücknahme ist selbst rücknehmbar", async ({
    page,
}) => {
    await oeffneAenderungen(page);
    const original = page.getByTestId("editorpanel-aenderung").filter({ hasText: "Rommilys geändert" });
    await expect(original.getByRole("img", { name: "zurückgenommen" })).toBeVisible();
    await zeileVon(original).click();
    await expect(original.getByTestId("aenderung-detail-zurueck-durch")).toContainText("Zurückgenommen durch");
    await expect(original.getByTestId("aenderung-detail-grund-original")).toContainText("falscher Ort");
    // ⊘ gibt es hier nicht: ○, und kein ↺ am Original.
    await expect(original.getByTestId("editorpanel-aenderung-ruecknahme")).toHaveCount(0);

    const ruecknahme = page
        .getByTestId("editorpanel-aenderung")
        .filter({ hasText: "Rommilys: Änderung zurückgenommen" });
    await expect(zeileVon(ruecknahme)).toContainText("Rücknahme");
    await zeileVon(ruecknahme).click();
    await expect(ruecknahme.getByTestId("editorpanel-aenderung-ruecknahme")).toHaveText("↺ Rücknahme zurücknehmen");
});

test("🔴 eine Serie ist dieselbe Zeile; aufgeklappt ihr Detail mit „↺ Serie zurücknehmen“ und die Mitglieder an einer Schiene", async ({
    page,
}) => {
    await oeffneAenderungen(page);
    const serie = page.getByTestId("editorpanel-aenderung-serie");
    await expect(serie).toContainText("Havena — 3 Änderungen");
    const kopf = serie.getByTestId("editorpanel-aenderung-serie-zeile");
    await expect(kopf.getByRole("img", { name: "teils zurückgenommen (1 von 3)" })).toBeVisible();
    await expect(kopf).toContainText("15:05–15:20");

    await kopf.click();
    await expect(serie.getByTestId("editorpanel-aenderung-serien-detail")).toBeVisible();
    await expect(serie.getByTestId("editorpanel-aenderung-ruecknahme")).toContainText("Serie zurücknehmen");
    // Die Mitglieder: Zwei-Zeilen-Zeilen, ohne Person (die Kopfzeile nennt sie).
    const mitglieder = serie.locator("ol.schiene").getByTestId("editorpanel-aenderung");
    await expect(mitglieder).toHaveCount(3);
    await expect(mitglieder.first()).toContainText("Schritt 3/3");
    await expect(zeileVon(mitglieder.first())).not.toContainText("Rondrikan");
    // Ein Mitglied klappt für sich auf, die Serie bleibt offen.
    await zeileVon(mitglieder.nth(1)).click();
    await expect(mitglieder.nth(1).getByTestId("editorpanel-aenderung-detail")).toBeVisible();
    await expect(serie.getByTestId("editorpanel-aenderung-serien-detail")).toBeVisible();
});

test("🔴 die Legende zählt und filtert auf Klick; „teils zurückgenommen“ zeigt nur Serien", async ({ page }) => {
    const { fragen } = await oeffneAenderungen(page);
    const legende = page.getByTestId("editorpanel-aenderungen-legende");
    await expect(legende).toBeVisible();
    await expect(legende.getByTestId("editorpanel-aenderungen-legende-ruecknehmbar")).toContainText("wirksam");
    await expect(legende.getByTestId("editorpanel-aenderungen-legende-teils")).toContainText("teils zurückgenommen");
    await expect(legende.getByTestId("editorpanel-aenderungen-legende-teils")).toContainText("1");

    // Ein Zustand des Servers filtert dort.
    await legende.getByTestId("editorpanel-aenderungen-legende-bereits_zurueckgenommen").click();
    await expect.poll(() => fragen.some((url) => url.includes("status=bereits_zurueckgenommen"))).toBe(true);
    await expect(legende.getByTestId("editorpanel-aenderungen-legende-bereits_zurueckgenommen")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await legende.getByTestId("editorpanel-aenderungen-legende-bereits_zurueckgenommen").click();

    // ◐ kennt der Server nicht: Die Liste zeigt dann nur die Serien, von denen einige zurück sind.
    await legende.getByTestId("editorpanel-aenderungen-legende-teils").click();
    await expect(page.getByTestId("editorpanel-aenderung-serie")).toHaveCount(1);
    await expect(page.getByTestId("editorpanel-aenderung")).toHaveCount(0);
});

test("🔴 die Leiste ist EINE Zeile: Suche links, rechts „Meine | Alle“, Trichter und ↻ als Zeichen", async ({
    page,
}) => {
    await oeffneAenderungen(page);
    const suche = page.getByTestId("editorpanel-aenderungen-leiste-suche");
    const meine = page.getByTestId("aenderungen-wer-reiter-meine");
    const alle = page.getByTestId("aenderungen-wer-reiter-alle");
    const trichter = page.getByTestId("editorpanel-aenderungen-filter");
    const neu = page.getByTestId("editorpanel-aenderungen-neu");
    const boxen = await Promise.all([suche, meine, alle, trichter, neu].map((ort) => ort.boundingBox()));
    const mitten = boxen.map((box) => box!.y + box!.height / 2);
    for (const y of mitten) expect(Math.abs(y - mitten[0]!)).toBeLessThan(4);
    // Von links nach rechts: Suche, Meine, Alle, Trichter, ↻.
    for (let i = 1; i < boxen.length; i += 1)
        expect(boxen[i]!.x).toBeGreaterThanOrEqual(boxen[i - 1]!.x + boxen[i - 1]!.width - 1);
    await expect(neu).toHaveAttribute("aria-label", "Neu laden");
    await expect(neu).toHaveText("↻");
    await expect(alle).toHaveAttribute("aria-pressed", "true");
    // „Meine“ blendet die Person überall aus.
    await meine.click();
    await expect(meine).toHaveAttribute("aria-pressed", "true");
    await expect(zeileVon(page.getByTestId("editorpanel-aenderung").first())).not.toContainText("Rondrikan");
    await expect(zeileVon(page.getByTestId("editorpanel-aenderung").nth(1))).not.toContainText("Thomas");
});
