import type { SubjectDetail } from "@avesmaps3d/shared";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { MEDIA_PUBLIC_URL_PATTERN } from "@avesmaps3d/shared";
import { expectActionBandShape } from "./aktionsband.ts";
import { openMap } from "./map-handle.ts";

/**
 * Die Gestalt des Infopanels am echten Stack (WI-0063 P6, Design Guide §16, Betreiber: „aussehn wie legacy“): Kopf, Aktionsband,
 * „Liegt in“, Feldliste, Quellenkasten, Quellen. Was das Modell daraus macht, prüft `test/panel-model.test.ts`; hier steht, was der
 * Browser zeichnet, misst und tut.
 *
 * Die Referenzfälle sind Gareth (reich), „Felden (Gareth)“ (ein Dorf, das knapp bleibt), „Hügel der Brinaskquelle“ (kein eigener
 * Artikel, aber Kontext), die Reichsstraße 3 (langer Verlauf) und die Kraftlinie „Arteria Magica“ (Kraftlinien haben auf der Karte
 * noch keinen Besitzer: Sie öffnen nur über die Öffnungsnaht, `avesmapsOpenSubject`).
 */

const GARETH = "80558060-4299-54aa-b520-814b10819885";
const FELDEN = "5acdf435-80fc-4a34-980f-41020b31a8d3";
const HUEGEL = "8b98caaf-4fa9-4e48-9d12-d04a7c6653bc";
const WALDWILDNIS = "edeca957-c8b1-45ad-a000-c8547ac845d6";
const ARTERIA = "669f9371-dfcd-4a05-bdd9-38de68a79ad8";
const RIVA = "05b35f8c-2a47-5f3d-84bd-576afcb7be16";
/** Orte mit Quellen von Hand: Wiki + drei Quellen + eine Publikation; zwei Quellen eines Wirts (Garetien-Wiki) samt 29 Belegen; keine Wikizeile, zwei Quellen. */
const HAIN = "46f2556a-88df-4a2c-bbb9-58cd36e6e176";
const ESLAMSGRUND = "bb7df0b2-842d-530c-95d6-ef5f325bcda9";
const SELLACH = "bda5b251-3111-4f5b-beb7-10e8fa5db8ac";
const HEADER_DORF = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons", "header", "dorf.webp");

/** Öffnet ein Subject über die Öffnungsnaht und wartet, bis das Panel seinen Namen trägt. */
async function open(page: Page, ref: Record<string, unknown>, title: string | RegExp): Promise<void> {
    await openMap(page);
    await page.evaluate((subject) => globalThis.avesmapsOpenSubject?.(subject), ref);
    await expect(page.getByTestId("info-title")).toHaveText(title, { timeout: 20_000 });
    // Die Fahrt des Panels (0,22 s) abwarten, dann messen.
    await expect.poll(async () => Math.round((await page.getByTestId("info-panel").boundingBox())?.x ?? 0)).toBe(880);
}

const labelsOf = (page: Page): Promise<string[]> => page.getByTestId("info-fact-label").allTextContents();

/** Die Quellenfrage eines Subjects: `GET /api/subjects/{kind}/{id}/sources`. */
const isSourcesRequest = (url: string): boolean => /\/api\/subjects\/[a-z]+\/[^/?]+\/sources/.test(url);

test("🔴 Gareth: Kopf mit den eigenen Bildern, Name, Untertitel mit Herrschaft als Link, Kanon-Etikett", async ({
    page,
}) => {
    const answer = page.waitForResponse(
        (response) => response.url().endsWith(`/api/subjects/place/${GARETH}`) && response.ok(),
    );
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const detail = (await (await answer).json()) as SubjectDetail;
    expect(detail.counts?.staetten ?? 0, "Voraussetzung: der importierte Ort hat Stätten").toBeGreaterThan(0);
    // Das Bild: 16:9 und 385 px breit (Guide §16.1).
    const media = await page.getByTestId("info-media").boundingBox();
    expect(Math.round(media?.width ?? 0)).toBe(385);
    expect(Math.round(((media?.width ?? 0) / (media?.height ?? 1)) * 100)).toBe(178);
    const image = page.getByTestId("info-header-image");
    // 🔴 Seit dem Medienzug (MEDIA-M8 bis M10) hat Gareth EIGENE Bilder; die Grafik der Ortsgröße ist nur noch der Rückfall
    // für Orte ohne eigenes Bild (Guide §16.1). Darum steht hier eine Medienadresse und kein `data-graphic`.
    await expect(image).toHaveAttribute("src", new RegExp(MEDIA_PUBLIC_URL_PATTERN));
    expect(await image.getAttribute("data-graphic")).toBeNull();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    // Mehrere eigene Bilder: der Kopf blättert, und je Bild steht eine Marke.
    await expect(page.getByTestId("info-header-mark").first()).toBeVisible();
    await expect(page.getByTestId("info-subtitle")).toContainText("Metropole · Hauptstadt von");
    // Freigegeben (Betreiber 2026-10-04): „Hauptstadt von A, B, C“ in EINER Angabe, „Hauptstadt von“ steht nur einmal.
    expect((await page.getByTestId("info-subtitle").textContent())?.match(/Hauptstadt von/g)).toHaveLength(1);
    const realms = page.getByTestId("info-subtitle").getByTestId("info-link");
    await expect(realms).toHaveCount(3);
    // Jede Herrschaft ist ein Link, der das Gebiet öffnet.
    await realms.first().click();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("territory");
});

test("🔴 das Kanon-Etikett: eine ganze Pille bei „offiziell“, Gold, gut lesbar", async ({ page }) => {
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const pill = page.getByTestId("info-header").getByTestId("info-canon");
    await expect(pill).toHaveAttribute("data-state", "official");
    await expect(pill).toHaveText("Offiziell");
    expect(await pill.evaluate((element) => getComputedStyle(element).textTransform)).toBe("uppercase");
    // Die Schrift steht auf dem 9-px-Wort des Etiketts (die benannte Ausnahme des Kanons).
    expect(await pill.locator(".info-canon__state").evaluate((element) => getComputedStyle(element).fontSize)).toBe(
        "9px",
    );
});

test("🔴 Gareth: Legacys Felder in seiner Reihenfolge, dann die freigegebenen; der Rest der Beschreibung hinter der „…“-Pille", async ({
    page,
}) => {
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(page.getByTestId("info-facts")).toBeVisible();
    // 🪤 Nachgezogen am 2026-10-06 (WI-0091 Nachtrag 2), NICHT die Regel geändert: Seit die Vorkommen dem ENTHALTENSEIN
    // folgen (Betreiber: „etwas kommt in einer region vor -> es wird da gelistet“), trägt Gareth seine vier Zeilen
    // (Waren 14, Fauna 9, Flora 8, Spezies 1) aus den Flächen, in denen es liegt. Vorher hatte es keine. Ihr Platz in
    // Legacys Tabelle ist unverändert: nach der Handelszone, vor der Klimazone (`legacy-rows.ts`).
    // Seit dem Stättenimport steht die freigegebene Stättenzeile vor den Vorkommen.
    expect(await labelsOf(page)).toEqual([
        "Beschreibung",
        "Oberhaupt",
        "Einwohner",
        "Verkehrswege",
        "Handelszone",
        "Innerorts",
        "Waren",
        "Fauna",
        "Flora",
        "Spezies",
        "Klimazone",
        "Lage",
        "Regionen",
    ]);
    // Zuerst der erste Satz, wie Legacy; die runde „…“-Pille zeigt den ganzen Text, „«“ kürzt ihn wieder (Betreiber 2026-10-04).
    const row = page.getByTestId("info-fact").first();
    const description = row.getByTestId("info-fact-text");
    const lead = ((await description.textContent()) ?? "").trim();
    expect(lead.endsWith(".")).toBe(true);
    expect(lead.split(/(?<=\.)\s/).length).toBe(1);
    const more = row.getByTestId("info-fact-more").getByRole("button");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toHaveText("…");
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(more).toHaveText("«");
    const full = ((await description.textContent()) ?? "").trim();
    expect(full.startsWith(lead)).toBe(true);
    expect(full.length).toBeGreaterThan(lead.length);
    expect(full).not.toMatch(/ ,/);
    await more.click();
    await expect(description).toHaveText(lead);
    // Feldzeile: Beschriftung 96 px, der Wert füllt.
    const first = page.getByTestId("info-fact").first();
    const columns = await first.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" "));
    expect(columns[0]).toBe("96px");
});

test("🔴 die Verkehrswege eines Orts sind Links auf die Wege: Riva", async ({ page }) => {
    await open(page, { kind: "place", id: RIVA }, "Riva");
    const row = page.getByTestId("info-fact").filter({ hasText: "Verkehrswege" });
    // Die Linkziele des Wiki-Quelltextes treffen über ihren Wiki-Key zwei Wege und das Meer „Golf von Riva“ (eine Landschaft).
    await expect(row.getByTestId("info-link")).toHaveCount(3);
    await row.getByTestId("info-link").first().click();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("path");
});

test("🔴 „Liegt in“: die Herrschaft als Treppe, jede Stufe einen Schritt eingerückt, ein Link auf das Gebiet", async ({
    page,
}) => {
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const rows = page.getByTestId("info-stairs-row");
    await expect(page.getByTestId("info-lies-in").locator("h3")).toHaveText("Liegt in");
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    const offsets = await rows.evaluateAll((elements) =>
        elements.map((element) => element.querySelector("button")?.getBoundingClientRect().left ?? 0),
    );
    // Jede Stufe liegt weiter rechts als ihre Elternstufe, in gleichen Schritten (14 px = `--space-12`).
    for (let index = 1; index < offsets.length; index += 1) {
        expect(Math.round((offsets[index] ?? 0) - (offsets[index - 1] ?? 0))).toBe(14);
    }
    await rows.nth(1).getByTestId("info-link").click();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("territory");
});

test("🔴 Wikizeile: „Quelle:“ über der Zeile „Wiki Aventurica ↗“ mit ⓘ-Tafel (Kanon, Lizenz mit Link, Adresse) und Kanon-Pille", async ({
    page,
}) => {
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const box = page.getByTestId("info-source");
    // Eine Zeile in der ersten Zone: „Quelle:“ im Singular, als eigene Zeile über ihr (Legacy `.fs-src-label`).
    await expect(box.getByTestId("info-source-label")).toHaveText("Quelle:");
    await expect(box.getByTestId("info-source-row")).toHaveCount(1);
    const link = box.getByTestId("info-source-title").getByRole("link");
    await expect(link).toHaveText(/Wiki Aventurica/);
    await expect(link).toHaveAttribute("href", "https://de.wiki-aventurica.de/wiki/Gareth");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(box.getByTestId("info-canon")).toHaveAttribute("data-state", "official");
    // Die Tafel ist zu, bis das ⓘ sie öffnet; sie trägt Lizenz (als Link) und Adresse.
    const info = box.getByTestId("info-source-info");
    await expect(info).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("info-source-rights")).toHaveCount(0);
    await info.click();
    await expect(info).toHaveAttribute("aria-expanded", "true");
    // Die Tafel steht in IHRER Zeile, nicht unter der Liste.
    await expect(box.getByTestId("info-source-row").getByTestId("info-source-rights")).toHaveCount(1);
    const rights = page.getByTestId("info-source-rights");
    await expect(rights).toContainText("Offiziell");
    await expect(rights.locator("[data-rights=license] a")).toHaveText(/CC BY-SA 3\.0/);
    await expect(rights.locator("[data-rights=license] a")).toHaveAttribute(
        "href",
        "https://creativecommons.org/licenses/by-sa/3.0/",
    );
    await expect(rights.locator("[data-rights=address] a")).toHaveAttribute(
        "href",
        "https://de.wiki-aventurica.de/wiki/Gareth",
    );
    await info.click();
    await expect(page.getByTestId("info-source-rights")).toHaveCount(0);
});

test("🔴 ein Dorf ohne Wiki bleibt knapp: Name, Art, Aktionen - keine leere Zeile, kein Quellenkasten, keine Sektion", async ({
    page,
}) => {
    await open(page, { kind: "place", id: FELDEN }, "Felden (Gareth)");
    await expect(page.getByTestId("info-subtitle")).toContainText("Dorf");
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", "dorf");
    await expect(page.getByTestId("info-actions")).toBeVisible();
    await expect(page.getByTestId("info-source")).toHaveCount(0);
    await expect(page.getByTestId("info-section")).toHaveCount(0);
    await expect(page.getByTestId("info-canon")).toHaveCount(0);
    // Keine Zeile ohne Inhalt, keine Beschriftung ohne Wert.
    for (const value of await page.getByTestId("info-fact-value").allTextContents()) expect(value.trim()).not.toBe("");
    expect(await labelsOf(page)).not.toContain("Beschreibung");
    // Es füllt keine Restfläche: Der Inhalt endet, das Panel bleibt, wie es ist.
    // 🪤 Die Schranke ist am 2026-10-06 von 700 auf 900 nachgezogen (WI-0091 Nachtrag 2), die Zusicherung nicht: Seit die
    // Vorkommen dem ENTHALTENSEIN folgen, trägt auch ein Dorf ohne Wiki die Zeilen der Flächen, in denen es liegt -
    // gemessen 796,8 px statt vorher knapp unter 700. Das ist der gewollte Inhalt, kein Füllen. Was die Datei wirklich
    // zusichert, steht in den Zeilen darüber: keine leere Zeile, kein Quellenkasten, keine Sektion, keine Beschreibung.
    const content = await page.locator(".info-content").boundingBox();
    expect(content?.height ?? 0).toBeLessThan(900);
});

test("🔴 Hügel und See sind keine leere Titelbox: Gebiet, Landschaften und Klima als Kontext", async ({ page }) => {
    await open(page, { kind: "area", id: HUEGEL }, "Hügel der Brinaskquelle");
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", "huegel");
    await expect(page.getByTestId("info-lies-in")).toBeVisible();
    expect(await labelsOf(page)).toEqual(expect.arrayContaining(["Regionen", "Klimazone"]));
    // Kein Artikel, keine Quellen: weder Kasten noch Abschnitt.
    await expect(page.getByTestId("info-source")).toHaveCount(0);
    await expect(page.getByTestId("info-section")).toHaveCount(0);
});

test("🔴 Waldwildnis: Lage, Staat, Beschreibung; die Herrschaft als Baum mit Anteilen; Nachbarn als freigegebener Zusatz dahinter", async ({
    page,
}) => {
    // 🪤 Name und Anteile sind Träger, nicht die Aussage: Die Waldwildnis wurde in den Daten geteilt (Bestand 2026-10-29: diese Kennung heißt
    // „Westliche Waldwildnis“, die östliche Hälfte hat eine eigene), und mit der Fläche änderten sich ihre Anteile (vorher 83 %). Das Panel
    // muss zeigen, was die Antwort des Servers nennt; welche Kennung welchen Namen trägt, entscheidet die Datenbank.
    const answer = page.waitForResponse(
        (response) => response.url().endsWith(`/api/subjects/area/${WALDWILDNIS}`) && response.ok(),
    );
    await open(page, { kind: "area", id: WALDWILDNIS }, /Waldwildnis$/);
    const detail = (await (await answer).json()) as SubjectDetail;
    expect(detail.title, "Voraussetzung: die Kennung nennt eine Waldwildnis (Urwald)").toMatch(/Waldwildnis$/);
    await expect(page.getByTestId("info-title")).toHaveText(detail.title ?? "");
    const anteil = detail.context?.territories?.chains[0]?.[0]?.share;
    expect(anteil, "Voraussetzung: die Waldwildnis überlappt Herrschaftsgebiete mit Anteil").toBeDefined();
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", "urwald");
    const labels = await labelsOf(page);
    expect(labels).toEqual(expect.arrayContaining(["Lage", "Staat", "Beschreibung", "Nachbarn"]));
    expect(labels.indexOf("Nachbarn")).toBeGreaterThan(labels.indexOf("Beschreibung"));
    // Die Nachbarn stehen in EINER Zeile, nach Name gruppiert (Betreiber 2026-10-04).
    expect(labels.filter((label) => label.startsWith("Nachbar"))).toEqual(["Nachbarn"]);
    // Mehr als vier Gebiete: ein Deckel, dessen Kopf die Beziehung samt Zahl nennt; keine eigene Überschrift.
    const liesIn = page.getByTestId("info-lies-in");
    await expect(liesIn.locator("h3")).toHaveCount(0);
    await expect(liesIn.getByTestId("info-lid-summary")).toHaveText(/^Erstreckt sich über \d+ politische Gebiete$/);
    await liesIn.getByTestId("info-lid").getByRole("button").first().click();
    // Der Anteil, den der Server dem ersten Gebiet gibt, auf ganze Prozent gerundet (`percentOf`).
    await expect(liesIn).toContainText(`(${String(Math.round((anteil ?? 0) * 100))} %)`);
});

test("🔴 ein Weg: Anzeigen fliegt zur ganzen Gruppe, der lange Verlauf steht im Deckel", async ({ page }) => {
    await open(page, { kind: "path", chain: "Reichsstraße 3:Reichsstrasse" }, "Reichsstraße 3");
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", "reichsstrasse");
    // 🚩 Nachgezogen in WI-0110: Die Soll-Liste nannte sechs Felder und bekam zehn - die vier Vorkommenszeilen kamen mit
    // WI-0103 dazu (Betreiber 2026-10-07: „Wege sollen abgeleitete Vorkommen haben“), die Liste hier nie. Sie stehen am
    // Weg AM ENDE der Legacy-Tabelle (`LEGACY_ROWS.path`), vor dem freigegebenen Zusatzfeld „Art“.
    expect(await labelsOf(page)).toEqual([
        "Lage",
        "Länge",
        "Führt durch",
        "Verlauf",
        "Beschreibung",
        "Waren",
        "Fauna",
        "Flora",
        "Spezies",
        "Art",
    ]);
    // Der Deckel zeigt zuerst seine Zusammenfassung und die Vorschau - er klappt auf Klick auf.
    const lid = page.getByTestId("info-fact").filter({ hasText: "Verlauf" }).getByTestId("info-lid");
    await expect(lid.getByTestId("info-lid-count")).toHaveText(/^\d+$/);
    await expect(lid.getByTestId("info-lid-preview")).toContainText("→ … →");
    // Der Knopf des Deckels steht vor seinem Inhalt; die Stationen darin sind Links (Knöpfe) und zählen hier nicht (WI-0063 27.12).
    const summary = lid.getByRole("button").first();
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(lid.getByTestId("info-lid-preview")).toHaveCount(0);
    // „Anzeigen“: Die Kamera fliegt zur ganzen Straße (nie ein Sprung).
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 20_000 });
    await page.evaluate(() => globalThis.avesmapsMap!.jumpTo({ zoom: 4 }));
    const before = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    await page.getByTestId("info-action-show").click();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 20_000 });
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getZoom())).not.toBe(before);
});

test("🔴 eine Kraftlinie: ihre Grafik, die ganze Beschreibung, Anzeigen und das gesperrte Vorschlagen - kein „Link teilen“", async ({
    page,
}) => {
    await open(page, { kind: "powerline", anchor: ARTERIA }, "Arteria Magica");
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", "kraftlinien");
    await expect(page.getByTestId("info-subtitle")).toHaveText("Kraftlinie");
    await expect(page.getByTestId("info-action-show")).toBeVisible();
    await expect(page.getByTestId("info-action-share")).toHaveCount(0);
    // Legacys Tabelle der Kraftlinie beginnt mit der Gestalt aus den Segmenten (P7: „Verbindet“, „Verläuft über“, „Abschnitte“, wo es sie
    // gibt - die Arteria Magica hat zwei Enden und mehrere Segmente), dann folgen Stärke, Regionen, Beschreibung und die Zusatzfelder.
    const labels = await labelsOf(page);
    const shape = ["Verbindet", "Verläuft über", "Abschnitte"];
    expect(labels.filter((label) => !shape.includes(label))).toEqual([
        "Stärke",
        "Regionen",
        "Beschreibung",
        "Verlauf",
        "Führt durch",
    ]);
    expect(labels.slice(0, 2)).toEqual(expect.arrayContaining(["Verbindet"]));
    expect(labels.indexOf("Stärke")).toBeGreaterThan(labels.lastIndexOf("Abschnitte"));
    // Die Kraftlinie zeigt ihre Beschreibung ganz, wie Legacy: keine Pille.
    await expect(page.getByTestId("info-fact-more")).toHaveCount(0);
});

test("🔴 „Änderungen vorschlagen“ öffnet das Meldeformular zum Objekt und sendet nichts (WI-0268 C2; bis dahin gesperrt, WI-0063 4.1)", async ({
    page,
}) => {
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const suggest = page.getByTestId("info-action-suggest");
    await expect(suggest).toBeEnabled();
    // Keine Sperre mehr, also auch keine Erklärung als Zeile.
    await expect(page.getByTestId("info-actions-note")).toHaveCount(0);
    // Nichts Schreibendes beim Öffnen: Das Formular sendet erst „Absenden“. Die anonyme Besucherstatistik (`/api/besuch`) ist keine Meldestelle des Klicks.
    const schreibend: string[] = [];
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (request.method() !== "GET" && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/besuch"))
            schreibend.push(`${request.method()} ${url.pathname}`);
    });
    await suggest.click();
    const fenster = page.getByTestId("community-meldung-fenster");
    await expect(fenster).toBeVisible();
    await expect(fenster).toContainText("Änderung vorschlagen: Gareth");
    await page.waitForTimeout(400);
    expect(schreibend).toEqual([]);
    // Die Auswahl der Karte bleibt der Ort.
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("place");
});

test("🔴 „Reiseziel hinzufügen“ legt einen Wegpunkt an und wird zu „Reiseziel entfernen“ - und zurück", async ({
    page,
}) => {
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const toggle = page.getByTestId("info-action-addDestination");
    await expect(toggle).toContainText("Reiseziel hinzufügen");
    // Die Hauptaktion ist gefüllt, die Karte zeigt es in der Planerzeile.
    await toggle.click();
    await expect(page.getByTestId("info-action-removeDestination")).toContainText("Reiseziel entfernen");
    await expect(page.getByTestId("info-action-addDestination")).toHaveCount(0);
    await expect(page.getByTestId("waypoint-input").first()).toHaveValue("Gareth");
    // Ein zweiter Klick auf dieselbe Kachel nimmt ihn wieder heraus.
    await page.getByTestId("info-action-removeDestination").click();
    await expect(page.getByTestId("info-action-addDestination")).toBeVisible();
    await expect(page.getByTestId("waypoint-input").first()).toHaveValue("");
});

test("🔴 „Link teilen“ kopiert Legacys Adresse (`?siedlung=`) und meldet es mit dem Link in der Meldung", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    await page.getByTestId("info-action-share").click();
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Link zu dieser Stelle in die Zwischenablage kopiert.");
    await expect(toast).toContainText("?siedlung=Gareth");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copied).searchParams.get("siedlung")).toBe("Gareth");
});

test("🔴 Gareth: Wikizeile und Publikationen stehen in EINEM Kasten - die Reiter ohne Klick, ein Trenner dazwischen, kein Abschnitt „Quellen zu …“", async ({
    page,
}) => {
    const sourceRequests: string[] = [];
    page.on("request", (request) => {
        if (isSourcesRequest(request.url())) sourceRequests.push(request.url());
    });
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const box = page.getByTestId("info-source");
    await expect(box).toHaveCount(1);
    // 🪤 Der Kasten ist KEIN Abschnitt: Abschnitte gibt es im Panel (die Katalogabschnitte, P8), einen „Quellen zu …“ nie.
    await expect(page.getByTestId("info-section-title").filter({ hasText: /Quellen zu/ })).toHaveCount(0);
    await expect(page.getByTestId("info-panel")).not.toContainText("Quellen zu");
    // Legacy zeigt die Reiter sofort: Die Liste kommt in EINER Frage, ohne dass jemand klickt.
    const pub = box.getByTestId("info-sources-pub");
    await expect(pub).toBeVisible();
    await expect(pub.locator(".info-source__publabel")).toHaveText("Publikationen:");
    expect(sourceRequests).toHaveLength(1);
    // Die Zahlen der Reiter sind die der Liste, die der Server liefert; eine Gesamtzahl gibt es nicht.
    const body = (await (await page.request.get(`/api/subjects/place/${GARETH}/sources`)).json()) as {
        sources: { referenceKind?: string }[];
    };
    const mentioned = body.sources.filter((entry) => entry.referenceKind === "erwaehnung").length;
    const described = body.sources.filter(
        (entry) => entry.referenceKind !== undefined && entry.referenceKind !== "erwaehnung",
    ).length;
    expect(described).toBeGreaterThan(0);
    expect(mentioned).toBeGreaterThan(0);
    const describedTab = box.getByTestId("info-sources-tab-described");
    const mentionedTab = box.getByTestId("info-sources-tab-mentioned");
    await expect(describedTab).toHaveText(new RegExp(`^Beschrieben\\s*\\(${String(described)}\\)$`));
    await expect(mentionedTab).toHaveText(new RegExp(`^Erwähnt\\s*\\(${String(mentioned)}\\)$`));
    await expect(mentionedTab).toHaveAttribute("title", "nur Erwähnung");
    // Die Reihenfolge im Kasten: Aufschrift, Wikizeile, Trenner, Publikationen.
    const top = async (id: string): Promise<number> => (await box.getByTestId(id).boundingBox())?.y ?? -1;
    const order = [await top("info-source-label"), await top("info-source-row"), await top("info-source-divider")];
    expect(order[0]).toBeLessThan(order[1] ?? 0);
    expect(order[1]).toBeLessThan(order[2] ?? 0);
    expect(order[2]).toBeLessThan(await top("info-sources-pub"));
    // Der Trenner läuft über die volle Kastenbreite (innerhalb des 1-px-Rands), er ist kein Rahmen.
    const frame = await box.boundingBox();
    const line = await box.getByTestId("info-source-divider").boundingBox();
    expect(Math.abs((line?.x ?? 0) - ((frame?.x ?? 0) + 1))).toBeLessThan(1.5);
    expect(Math.abs((line?.x ?? 0) + (line?.width ?? 0) - ((frame?.x ?? 0) + (frame?.width ?? 0) - 1))).toBeLessThan(
        1.5,
    );
    // Die Reiter klappen die Liste auf (WI-0254 §12): unter „Beschrieben“ die Gruppen mit Kopf und Zahl, innerhalb des Kastens.
    await expect(describedTab).toHaveAttribute("aria-expanded", "false");
    await expect(box.getByTestId("info-sources-list")).toHaveCount(0);
    await describedTab.click();
    await expect(describedTab).toHaveAttribute("aria-expanded", "true");
    const list = box.getByTestId("info-sources-list");
    await expect(list.getByTestId("info-source-pub-row")).toHaveCount(described);
    const heads = list.getByTestId("info-source-group");
    expect(await heads.count()).toBeGreaterThan(0);
    const groupCounts = await heads.evaluateAll((nodes) =>
        nodes.map((node) => Number(node.querySelector(".info-source-list__n")?.textContent ?? "NaN")),
    );
    expect(groupCounts.reduce((sum, n) => sum + n, 0)).toBe(described);
    const wrap = await list.boundingBox();
    expect(wrap?.x ?? 0).toBeGreaterThanOrEqual((frame?.x ?? 0) + 1 - 0.5);
    expect((wrap?.x ?? 0) + (wrap?.width ?? 0)).toBeLessThanOrEqual((frame?.x ?? 0) + (frame?.width ?? 0) - 1 + 0.5);
    // Ein zweiter Klick auf denselben klappt zu, der andere Reiter wechselt (Legacy `avesmapsToggleSourceTab`).
    await describedTab.click();
    await expect(list).toHaveCount(0);
    await describedTab.click();
    await mentionedTab.click();
    await expect(describedTab).toHaveAttribute("aria-expanded", "false");
    await expect(mentionedTab).toHaveAttribute("aria-expanded", "true");
    await expect(list.getByTestId("info-source-pub-row")).toHaveCount(mentioned);
    // „Erwähnt“ hat keinen Kopf: Die Zeilen stehen für sich.
    await expect(list.getByTestId("info-source-group")).toHaveCount(0);
    // Lange Seitenangaben stehen gekürzt, die volle Angabe im Titel der Zeile.
    const shortened = list.locator(".info-source-list__pages.is-shortened[title]").first();
    await expect(shortened).toContainText("ff.");
    expect(((await shortened.getAttribute("title")) ?? "").split(",").length).toBeGreaterThan(3);
    await mentionedTab.click();
    await expect(list).toHaveCount(0);
    // Mit der Tastatur: Fokus auf den Reiter, Eingabe klappt auf.
    await describedTab.focus();
    await page.keyboard.press("Enter");
    await expect(list).toBeVisible();
});

test("🔴 Quellen von Hand sind eigene Zeilen der ersten Zone: Wikizeile zuerst, je ⓘ-Tafel in der eigenen Zeile und Halbpille aus Kanon und Art", async ({
    page,
}) => {
    await open(page, { kind: "place", id: HAIN }, "Hain der Weißen Maid");
    const box = page.getByTestId("info-source");
    await expect(box.getByTestId("info-source-label")).toHaveText("Quellen:");
    const rows = box.getByTestId("info-source-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toHaveAttribute("data-kind", "wiki");
    for (const index of [1, 2, 3]) await expect(rows.nth(index)).toHaveAttribute("data-kind", "direct");
    // Titel mit Link; wo es keine Adresse gibt, steht nur Text. Seiten als „S. …“, ein Bereich bleibt, wie er ist.
    await expect(rows.nth(1).getByTestId("info-source-title").getByRole("link")).toHaveAttribute("href", /f-shop\.de/);
    await expect(rows.nth(2).getByTestId("info-source-title")).toContainText("Die Grafschaft Heldentrutz");
    await expect(rows.nth(2).getByTestId("info-source-title").getByRole("link")).toHaveCount(0);
    await expect(rows.nth(1).getByTestId("info-source-pages")).toHaveText("S. 100");
    await expect(rows.nth(3).getByTestId("info-source-pages")).toHaveText("S. 22-23");
    // Die Halbpille: Kanon links, die Art der Quelle rechts - die Wikizeile bleibt eine ganze Pille.
    await expect(rows.nth(0).getByTestId("info-canon").locator(".info-canon__by")).toHaveCount(0);
    const pill = rows.nth(1).getByTestId("info-canon");
    await expect(pill).toHaveAttribute("data-state", "official");
    await expect(pill.locator(".info-canon__by")).toHaveText("Regionalspielhilfe");
    // Das ⓘ öffnet die Tafel IN der Zeile; die anderen bleiben zu.
    await rows.nth(1).getByTestId("info-source-info").click();
    await expect(rows.nth(1).getByTestId("info-source-rights")).toHaveCount(1);
    await expect(box.getByTestId("info-source-rights")).toHaveCount(1);
    await expect(rows.nth(1).locator("[data-rights=kanon]")).toContainText("Offiziell");
    await expect(rows.nth(1).locator("[data-rights=address] a")).toHaveAttribute("href", /f-shop\.de/);
    // Die Zonen: Trenner, dann die Publikation als EIN Reiter (der mit Inhalt).
    await expect(box.getByTestId("info-source-divider")).toHaveCount(1);
    await expect(box.locator(".info-source__tab")).toHaveCount(1);
});

test("🔴 steht der Wirt vorn (Belegstelle), wandert der Titel der Seite hinter das ⓘ; Lizenz mit Link und Nennung stehen in der Tafel, die Notiz nicht im Kasten", async ({
    page,
}) => {
    await open(page, { kind: "place", id: ESLAMSGRUND }, "Eslamsgrund");
    const box = page.getByTestId("info-source");
    const rows = box.getByTestId("info-source-row");
    await expect(rows).toHaveCount(3);
    for (const index of [1, 2]) {
        await expect(rows.nth(index).getByTestId("info-source-title")).toContainText("Garetien-Wiki");
        await expect(rows.nth(index).getByTestId("info-canon").locator(".info-canon__by")).toHaveText("Briefspiel");
        await expect(rows.nth(index).getByTestId("info-canon")).toHaveAttribute("data-state", "unofficial");
    }
    await rows.nth(1).getByTestId("info-source-info").click();
    const rights = rows.nth(1).getByTestId("info-source-rights");
    await expect(rights.locator("[data-rights=kanon]")).toContainText("Fanmaterial (Briefspiel)");
    await expect(rights.locator("[data-rights=license] a")).toHaveText(/CC BY-NC-SA 3\.0/);
    await expect(rights.locator("[data-rights=license] a")).toHaveAttribute(
        "href",
        "https://creativecommons.org/licenses/by-nc-sa/3.0/",
    );
    await expect(rights.locator("[data-rights=title]")).toHaveText("Garetien : Reichsstadt Eslamsgrund");
    await expect(rights.locator("[data-rights=address] a")).toHaveAttribute("href", /garetien\.de/);
    await rows.nth(2).getByTestId("info-source-info").click();
    await expect(rows.nth(2).locator("[data-rights=attribution]")).toHaveText("VolkoV / garetien.de");
    // Legacy zeigt die Notiz einer Quelle im Infopanel nicht; hier ist sie die Adresse der Importseite.
    await expect(box).not.toContainText("MapSVG");
});

test("🔴 ohne Wiki bleiben die Quellen von Hand: „Quellen:“, kein Trenner und keine Publikationen darunter", async ({
    page,
}) => {
    await open(page, { kind: "place", id: SELLACH }, "Sellach");
    const box = page.getByTestId("info-source");
    await expect(box.getByTestId("info-source-label")).toHaveText("Quellen:");
    const rows = box.getByTestId("info-source-row");
    await expect(rows).toHaveCount(2);
    for (const index of [0, 1]) await expect(rows.nth(index)).toHaveAttribute("data-kind", "direct");
    // Die Art „sonstiges“ ist das zweite Feld der Halbpille wie jede andere.
    await expect(rows.nth(0).getByTestId("info-canon").locator(".info-canon__by")).toHaveText("Sonstiges");
    await expect(box.getByTestId("info-source-divider")).toHaveCount(0);
    await expect(box.getByTestId("info-sources-pub")).toHaveCount(0);
    await expect(box.getByTestId("info-sources-loading")).toHaveCount(0);
});

/**
 * Öffnet ein Subject bei einer bestimmten Fensterbreite. 🪤 `open` wartet auf die Lage des Panels am Rechner (x = 880);
 * schmal liegt es anders (Fenster minus Rand), gemeinsam ist nur: Angekommen steht seine rechte Kante am Fensterrand.
 */
async function openAt(page: Page, breite: number, ref: Record<string, unknown>, title: string): Promise<void> {
    await page.setViewportSize({ width: breite, height: 900 });
    await openMap(page);
    await page.evaluate((subject) => globalThis.avesmapsOpenSubject?.(subject), ref);
    await expect(page.getByTestId("info-title")).toHaveText(title, { timeout: 20_000 });
    await expect
        .poll(async () => {
            const panel = await page.getByTestId("info-panel").boundingBox();
            return Math.round((panel?.x ?? 0) + (panel?.width ?? 0));
        })
        .toBe(breite);
}

/**
 * 🪤 Am Rechner UND bei 360 px. Bei 360 px brach die Publikationszeile bis zum 2026-10-11 in zwei Reihen um, und weil die
 * wartende Zeile nicht wissen kann, ob ein oder zwei Reiter kommen, wuchs der Kasten beim Eintreffen um **24,53 px**
 * (WI-0102 F1). Seit dem Entscheid „Telefon: mit ... abschneiden“ bleibt sie einzeilig; gemessen danach 0,00 px auf
 * beiden Breiten.
 */
test("🔴 bis die Liste da ist, steht die Wikizeile schon - und der Kasten springt nicht, wenn sie eintrifft (Rechner und 360 px)", async ({
    page,
}) => {
    for (const breite of [1280, 360]) {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route("**/api/subjects/place/*/sources", async (route) => {
            await gate;
            await route.continue();
        });
        await openAt(page, breite, { kind: "place", id: GARETH }, "Gareth");
        const box = page.getByTestId("info-source");
        await expect(box.getByTestId("info-sources-loading")).toBeVisible();
        await expect(box.getByTestId("info-source-title")).toContainText("Wiki Aventurica");
        await expect(box.getByTestId("info-source-divider")).toHaveCount(1);
        const waiting = (await box.boundingBox())?.height ?? 0;
        release();
        await expect(box.getByTestId("info-sources-pub")).toBeVisible();
        await expect(box.getByTestId("info-sources-loading")).toHaveCount(0);
        const sprung = ((await box.boundingBox())?.height ?? 0) - waiting;
        expect(Math.abs(sprung), `${String(breite)} px: der Kasten springt um ${String(sprung)} px`).toBeLessThan(1.5);
        await page.unroute("**/api/subjects/place/*/sources");
    }
});

/**
 * 🔴 DIE PUBLIKATIONSZEILE IST EINE ZEILE, AUF JEDER BREITE (Betreiber 2026-10-11 zu WI-0102 F1: „Telefon: mit ...
 * abschneiden“). Sie braucht 292,68 px; bei 360 px Fenster bleiben ihr 261. Gekürzt wird nach der Hausrezeptur
 * (`.einzeilig`, WI-0098 §5): nur die Aufschrift „Publikationen:“ gibt nach und endet mit „…“, der volle Text steht im
 * `title`. Die Reiter sind Knöpfe mit einer Zahl und kürzen nie.
 *
 * Am Rechner ist nichts gekürzt - dort hat sich nichts geändert.
 */
test("🔴 die Publikationszeile bleibt bei 360 px EINE Zeile: die Aufschrift kürzt mit „…“, die Reiter bleiben ganz", async ({
    page,
}) => {
    for (const breite of [1280, 360]) {
        await openAt(page, breite, { kind: "place", id: GARETH }, "Gareth");
        const pub = page.getByTestId("info-source").getByTestId("info-sources-pub");
        await expect(pub).toBeVisible();
        const zeile = await pub.evaluate((element) => {
            const label = element.querySelector<HTMLElement>(".info-source__publabel");
            if (label === null) throw new Error("Aufschrift fehlt");
            const stil = getComputedStyle(label);
            // 🪤 Oberkanten, nicht Mitten: `.einzeilig` verlängert den Kasten der Aufschrift nach unten um den
            // Unterlängenraum (und nimmt ihn im Fluss zurück), seine Mitte liegt darum 1,79 px tiefer als die Schrift.
            const kinder = [...element.children].map((kind) => kind.getBoundingClientRect().top);
            const reiter = [...element.querySelectorAll<HTMLElement>(".info-source__tab")];
            return {
                hoehe: element.getBoundingClientRect().height,
                reiterHoehe: Math.max(...reiter.map((tab) => tab.getBoundingClientRect().height)),
                oberkanten: kinder,
                gekuerzt: label.scrollWidth > label.clientWidth,
                textOverflow: stil.textOverflow,
                whiteSpace: stil.whiteSpace,
                text: label.textContent?.trim() ?? "",
                title: label.title,
                reiterGanz: reiter.every((tab) => tab.scrollWidth <= tab.clientWidth),
            };
        });
        const wo = `${String(breite)} px`;
        // EINE Reihe: so hoch wie ein Reiter, und alle Felder beginnen auf derselben Höhe (gemessen 0,56 px Unterschied
        // zwischen Aufschrift und Reiter, beide senkrecht zentriert; eine zweite Reihe läge 24,53 px tiefer).
        expect(zeile.hoehe, `${wo}: die Zeile ist ${String(zeile.hoehe)} px hoch`).toBe(zeile.reiterHoehe);
        for (const oben of zeile.oberkanten) expect(Math.abs(oben - (zeile.oberkanten[0] ?? 0)), wo).toBeLessThan(1);
        // Gekürzt wird über die Hausklasse: Auslassungspunkt am Ende, ungebrochen, der volle Text im DOM und im `title`.
        expect(zeile.textOverflow, wo).toBe("ellipsis");
        expect(zeile.whiteSpace, wo).toBe("nowrap");
        expect(zeile.text, wo).toBe("Publikationen:");
        expect(zeile.title, wo).toBe("Publikationen:");
        expect(zeile.reiterGanz, `${wo}: ein Reiter ist gekürzt`).toBe(true);
        await expect(pub.getByTestId("info-sources-tab-described")).toHaveText(/^Beschrieben\s*\(\d+\)$/);
        await expect(pub.getByTestId("info-sources-tab-mentioned")).toHaveText(/^Erwähnt\s*\(\d+\)$/);
        // Am Rechner passt alles, bei 360 px ist die Kürzung eine echte (der Text ist breiter als sein Kasten).
        expect(zeile.gekuerzt, `${wo}: Aufschrift gekürzt?`).toBe(breite === 360);
    }
});

test("🔴 wechselt das Subject, gilt die späte Antwort des alten nicht - und ein Ort ohne Quellen fragt gar nicht erst", async ({
    page,
}) => {
    const sourceRequests: string[] = [];
    page.on("request", (request) => {
        if (isSourcesRequest(request.url())) sourceRequests.push(request.url());
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route("**/api/subjects/place/*/sources", async (route) => {
        await gate;
        await route.continue();
    });
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(page.getByTestId("info-sources-loading")).toBeVisible();
    await page.evaluate((subject) => globalThis.avesmapsOpenSubject?.(subject), { kind: "place", id: FELDEN });
    await expect(page.getByTestId("info-title")).toHaveText("Felden (Gareth)");
    release();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("info-source")).toHaveCount(0);
    expect(sourceRequests).toHaveLength(1);
    expect(sourceRequests[0]).toContain(GARETH);
});

test("🔴 ein Fehler der Quellenliste zerstört den Rest nicht: die Wikizeile bleibt, eine kleine Zeile und „Noch einmal versuchen“", async ({
    page,
}) => {
    await page.route("**/api/subjects/place/*/sources", (route) =>
        route.fulfill({ status: 503, headers: { "retry-after": "0" }, json: { error: "busy" } }),
    );
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(page.getByTestId("info-sources-error")).toHaveText("Die Quellen konnten nicht geladen werden.");
    // Kasten, Kopf, Aktionen und Felder stehen unverändert.
    await expect(page.getByTestId("info-source-row")).toHaveCount(1);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    await expect(page.getByTestId("info-actions")).toBeVisible();
    await expect(page.getByTestId("info-facts")).toBeVisible();
    await page.unroute("**/api/subjects/place/*/sources");
    await page.getByTestId("info-sources-retry").click();
    await expect(page.getByTestId("info-sources-pub")).toBeVisible();
    await expect(page.getByTestId("info-sources-error")).toHaveCount(0);
});

test("🔴 die eigenen Bilder: eine Folge mit Blätterpfeilen und Seitenmarken, das Wappen links neben Name und Untertitel", async ({
    page,
}) => {
    const sha = (digit: string): string => digit.repeat(64);
    const view = (digit: string, role: "header" | "coat") => ({
        id: `00000000-0000-4000-8000-00000000000${digit}`,
        role,
        url: `/media/sha256/${digit.repeat(2)}/${digit.repeat(2)}/${sha(digit)}.webp`,
        width: 800,
        height: 450,
        mimeType: "image/webp",
    });
    // Das Medium liefert der Media Core erst mit MEDIA-M7: Hier steht die Antwort, die er liefern wird.
    await page.route(`**/api/subjects/place/${GARETH}`, async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
            response,
            json: {
                ...body,
                media: {
                    coat: view("4", "coat"),
                    header: [view("1", "header"), view("2", "header"), view("3", "header")],
                },
            },
        });
    });
    await page.route("**/media/sha256/**", (route) =>
        route.fulfill({ status: 200, contentType: "image/webp", path: HEADER_DORF }),
    );
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    // Mehrere eigene Bilder ersetzen die Grafik der Art; die Pfeile sind runde 32-px-Scheiben, die Marken liegende Striche.
    const image = page.getByTestId("info-header-image");
    await expect(image).toHaveAttribute("src", /\/media\/sha256\/11/);
    await expect(image).not.toHaveAttribute("data-graphic", /.+/);
    const next = page.getByTestId("info-header-next");
    const prev = page.getByTestId("info-header-prev");
    const box = await next.boundingBox();
    expect([Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)]).toEqual([32, 32]);
    expect(await next.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("50%");
    expect(await next.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(24, 18, 12, 0.46)");
    const marks = page.getByTestId("info-header-mark");
    await expect(marks).toHaveCount(3);
    const widths = async (): Promise<number[]> =>
        marks.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().width)));
    await expect.poll(widths).toEqual([15, 6, 6]);
    expect(await marks.first().evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(6);
    await next.click();
    await expect(image).toHaveAttribute("src", /\/media\/sha256\/22/);
    await expect.poll(widths).toEqual([6, 15, 6]);
    await prev.click();
    await prev.click();
    // Es blättert im Kreis.
    await expect(image).toHaveAttribute("src", /\/media\/sha256\/33/);
    // Das Wappen links neben Name und Untertitel, 130 × 130, nie im Bildbereich.
    const coat = page.getByTestId("info-coat");
    const coatBox = await coat.boundingBox();
    const mediaBox = await page.getByTestId("info-media").boundingBox();
    const titleBox = await page.getByTestId("info-title").boundingBox();
    expect([Math.round(coatBox?.width ?? 0), Math.round(coatBox?.height ?? 0)]).toEqual([130, 130]);
    expect(coatBox?.y ?? 0).toBeGreaterThanOrEqual((mediaBox?.y ?? 0) + (mediaBox?.height ?? 0));
    expect((coatBox?.x ?? 0) + (coatBox?.width ?? 0)).toBeLessThanOrEqual(titleBox?.x ?? 0);
});

test("ein einziges eigenes Bild hat weder Pfeile noch Marken", async ({ page }) => {
    await page.route(`**/api/subjects/place/${GARETH}`, async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
            response,
            json: {
                ...body,
                media: {
                    header: [
                        {
                            id: "00000000-0000-4000-8000-000000000001",
                            role: "header",
                            url: `/media/sha256/aa/aa/${"a".repeat(64)}.webp`,
                            width: 800,
                            height: 450,
                            mimeType: "image/webp",
                        },
                    ],
                },
            },
        });
    });
    await page.route("**/media/sha256/**", (route) =>
        route.fulfill({ status: 200, contentType: "image/webp", path: HEADER_DORF }),
    );
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("src", /\/media\/sha256\/aa/);
    await expect(page.getByTestId("info-header-next")).toHaveCount(0);
    await expect(page.getByTestId("info-header-mark")).toHaveCount(0);
});

test("🔴 jede Aktionskachel trägt die Mindestliste: Hover färbt die Fläche (nie die Deckkraft), Fokus ist der goldene Ring, 120 ms", async ({
    page,
}) => {
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const share = page.getByTestId("info-action-share");
    const style = (name: string): Promise<string> =>
        share.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), name);
    const rest = await style("background-color");
    await share.hover();
    await expect.poll(() => style("background-color")).not.toBe(rest);
    expect(await style("opacity")).toBe("1");
    expect(await style("transition-duration")).toContain("0.12s");
    // Die Tastatur zeigt den Ring (`:focus-visible`): von der Kachel davor mit Tab auf diese.
    await page.mouse.move(0, 0);
    await page.getByTestId("info-action-addDestination").focus();
    await page.keyboard.press("Tab");
    await expect(share).toBeFocused();
    expect(await style("box-shadow")).not.toBe("none");
    // Das Band: gleich breite Spalten in der entschiedenen Zahl (`aktionsband.ts`).
    await expectActionBandShape(page);
});

test("🔴 hell und dunkel: Das Panel kippt mit, das Bild und das Etikett bleiben lesbar", async ({ page }) => {
    await open(page, { kind: "place", id: GARETH }, "Gareth");
    const surface = (): Promise<string> =>
        page.getByTestId("info-panel").evaluate((element) => getComputedStyle(element).backgroundColor);
    const light = await surface();
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect.poll(surface).not.toBe(light);
    const pill = page.getByTestId("info-header").getByTestId("info-canon").locator(".info-canon__state");
    const colours = await pill.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.color];
    });
    expect(colours[0]).not.toBe(colours[1]);
    await expect(page.getByTestId("info-header-image")).toBeVisible();
});

test("🔴 Englisch: Aktionen, „Liegt in“ und Quellen heißen wie bei Legacy", async ({ page }) => {
    await page.goto(`/?siedlung=Gareth&lang=en`);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 30_000 });
    await expect(page.getByTestId("info-action-addDestination")).toContainText("Add destination");
    await expect(page.getByTestId("info-action-share")).toContainText("Share link");
    await expect(page.getByTestId("info-action-suggest")).toContainText("Suggest a change");
    await expect(page.getByTestId("info-lies-in").locator("h3")).toHaveText("Located in");
    // Der Quellenkasten: „Source:“ über der Wikizeile, darunter „Publications:“ mit den Reitern, kein Abschnitt „Sources for Gareth“.
    await expect(page.getByTestId("info-source-label")).toHaveText("Source:");
    await expect(page.getByTestId("info-sources-pub")).toContainText("Publications:", { timeout: 20_000 });
    await expect(page.getByTestId("info-sources-tab-described")).toContainText("Described");
    await expect(page.getByTestId("info-sources-tab-mentioned")).toContainText("Mentioned");
    await expect(page.getByTestId("info-section-title").filter({ hasText: /Sources for/ })).toHaveCount(0);
    await expect(page.getByTestId("info-panel")).not.toContainText("Sources for");
});

test("🔴 eine freie Kartenstelle: Reiseziel, Link teilen mit `?pin=`, Entfernen; die Gegend darunter", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, { kind: "mapPoint", x: 551.6, y: 520.5 }, "Was ist hier?");
    await expect(page.getByTestId("info-subtitle")).toContainText("x 551,60");
    await expect(page.getByTestId("info-lies-in").locator("h3")).toHaveText("An dieser Stelle");
    const punktLabels = await labelsOf(page);
    expect(punktLabels).toEqual(expect.arrayContaining(["Regionen", "Klimazone"]));
    // 🔴 WI-0110 (Editoren 2026-10-08: „‚Was ist hier‘ -> Vorkommen anzeigen?“): die vier Zeilen stehen zwischen den
    // Landschaften und der Klimazone - Legacys eigener Platz („Klimazone steht IMMER direkt unter Flora“).
    expect(punktLabels).toEqual(expect.arrayContaining(["Waren", "Fauna", "Flora", "Spezies"]));
    expect(punktLabels.indexOf("Waren")).toBeGreaterThan(punktLabels.indexOf("Regionen"));
    expect(punktLabels.indexOf("Klimazone")).toBeGreaterThan(punktLabels.indexOf("Spezies"));
    // Der Satz steht zugeklappt wie aufgeklappt; aufgeklappt kommt der Inhalt OHNE zweite Frage (die Antwort reiste mit).
    const fauna = page.locator('[data-field="lore:fauna"]');
    await expect(fauna.getByTestId("info-lid-summary")).toHaveText(/^\d+ Tierart(en)? beobachtet$/);
    await fauna.locator("button").first().click();
    await expect(fauna.getByTestId("info-lore-group").first()).toBeAttached({ timeout: 30_000 });
    // 🔴 „Aus der Region“ steht auch als einzige Gruppe (Betreiber 2026-10-07), „Direkt von hier“ nie: eine Koordinate
    // ist kein Lore-Ziel (`lore_place_target` kennt Ort, Gebiet, Region, Gipfel - keine Koordinate).
    await expect(fauna).toContainText("Aus der Region");
    await expect(fauna).not.toContainText("Direkt von hier");
    await expect(fauna.getByTestId("info-lore-everywhere")).toBeAttached();
    // Der Pfeil nach draußen (`4db5b67e`) steht auch hier - erzeugter Inhalt, also am berechneten Wert gefragt.
    const pfeile = await fauna.evaluate((row) =>
        [...row.querySelectorAll<HTMLElement>('a[target="_blank"]')].map((link) =>
            (getComputedStyle(link, "::after").content || "").includes("↗"),
        ),
    );
    expect(pfeile.length).toBeGreaterThan(0);
    expect(pfeile.every(Boolean)).toBe(true);
    await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", /.+/);
    await page.getByTestId("info-action-share").click();
    await expect(page.getByTestId("toast")).toContainText("Link zur markierten Stelle");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copied).searchParams.get("pin")).toBe("520.500,551.600");
    // Als Reiseziel hinzufügen, danach „entfernen“ an derselben Stelle.
    await page.getByTestId("info-action-addDestination").click();
    await expect(page.getByTestId("info-action-removeDestination")).toBeVisible();
    // „Entfernen“ beendet die Auswahl und nimmt den Tropfen mit.
    await page.getByTestId("info-action-removePoint").click();
    await expect(page.getByTestId("info-panel")).toBeHidden();
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.())).toBeUndefined();
});

/**
 * 🔴 Die Staatsinfobox eines Gebiets (WI-0063 27.18, Gebietsexport E4, Legacy `createRegionWikiInfoBoxMarkup`) am echten Stack: die
 * benannten Fälle aus dem Work Item, gemessen am Bestand `avesmaps3d_dev` (nur gelesen).
 */
const TOBRIEN = "ecba0ad4-bed6-4d24-be5c-0b6e5dc2b65d";
const ALT_GARETH = "de38a3d0-2f1f-4f64-9a1d-2c304add3672";
const JANDRASKAN = "12d33897-fc56-493a-97b0-153828ffa904";
const KOSCH = "850e5a8e-12c9-45e3-9d1d-3fb692b50869";
/** Baronie Lyngwyn: die Hauptstadt heißt im Gebietsexport „Lyngwyn“, der Ort „Lyngwyn (Havena)“ (Bestand 2026-10-29). */
const LYNGWYN = "18d66799-0f39-40fb-ba3d-cf81c4423b1f";

/** Die Zeilen der Infobox, deren Beschriftung kein anderes Feld des Panels trägt (ohne Status, Kartenzeitraum, Vorkommen, Klima). */
const STAATSINFOBOX = [
    "Herrschaftsform",
    "Oberhaupt",
    "Gründung",
    "Auflösung",
    "Gründer",
    "Hauptstadt",
    "Herrschaftssitz",
    "Sprache",
    "Währung",
    "Einwohnerzahl",
    "Handelszone",
    "Geographisch",
    "Handelswaren",
];
const ZUSATZFELDER = ["Kontinent", "Politisch", "Wappenbeschreibung", "Zugehörigkeit (roh)"];
const rowOf = (page: Page, label: string): ReturnType<Page["getByTestId"]> =>
    page
        .getByTestId("info-fact")
        .filter({ has: page.getByTestId("info-fact-label").getByText(label, { exact: true }) });

/** Die Textzeile dieses Feldes aus der Antwort des Servers: Wert und, wo der Server einen aktiven Ort kennt, sein Verweis. */
const textFactOf = (
    detail: SubjectDetail,
    field: string,
): { value: string; ref?: { kind: string; id: string } } | undefined =>
    (detail.facts ?? []).find((fact) => fact.field === field) as
        { value: string; ref?: { kind: string; id: string } } | undefined;

test("🔴 Gebiet mit vielen Feldern (Herzogtum Tobrien): die Zeilen der Staatsinfobox in Legacys Folge, ohne Zusatzfelder", async ({
    page,
}) => {
    const answer = page.waitForResponse(
        (response) => response.url().endsWith(`/api/subjects/territory/${TOBRIEN}`) && response.ok(),
    );
    await open(page, { kind: "territory", id: TOBRIEN }, "Herzogtum Tobrien");
    const detail = (await (await answer).json()) as SubjectDetail;
    // Die Voraussetzung: die Antwort trägt die Zusatzfelder (verborgen), und genau sie erscheinen nicht.
    expect((detail.facts ?? []).filter((fact) => fact.legacyHidden === true).map((fact) => fact.field)).toEqual([
        "continent",
        "zugehoerigkeitRoh",
    ]);
    await expect(page.getByTestId("info-facts")).toBeVisible();
    const labels = await labelsOf(page);
    // Die Folge der Infobox: Status, die Felder, Kartenzeitraum, Handelswaren - eine Zeile ohne Inhalt (die Handelszone) fehlt.
    expect(labels.filter((label) => [...STAATSINFOBOX, "Status", "Kartenzeitraum"].includes(label))).toEqual([
        "Status",
        "Herrschaftsform",
        "Oberhaupt",
        "Gründung",
        "Auflösung",
        "Gründer",
        "Hauptstadt",
        "Herrschaftssitz",
        "Sprache",
        "Währung",
        "Einwohnerzahl",
        "Geographisch",
        "Kartenzeitraum",
        "Handelswaren",
    ]);
    for (const hidden of ZUSATZFELDER) expect(labels, hidden).not.toContain(hidden);
    // Die Klimazone steht am Ende (Legacys Platz), hinter den Handelswaren.
    expect(labels.indexOf("Klimazone")).toBeGreaterThan(labels.indexOf("Handelswaren"));
    // Werte wie in der Datenbank, verbatim.
    await expect(rowOf(page, "Herrschaftsform")).toContainText("Feudalherrschaft");
    await expect(rowOf(page, "Gründung")).toContainText("590 BF");
    await expect(rowOf(page, "Einwohnerzahl")).toContainText("80000 (1040 BF)");
    await expect(rowOf(page, "Handelswaren")).toContainText("Holz, Vieh, Pferde");
    // Hauptstadt und Herrschaftssitz stehen mit dem Text des Gebietsexports da. Der Verweis kommt vom Server, aus der Kennung des Ortes,
    // und nur, wenn der Ort aktiv und nicht verborgen ist: Tobriens Hauptstadt Ysilia ist in den Daten stillgelegt (Bestand 2026-10-29,
    // vorher ein Link), also bleibt sie Text; der Herrschaftssitz Perainefurten ist ein Link. Der Fall mit Hauptstadt als Link, deren Text
    // vom Ortsnamen abweicht, steht im Fall der Baronie Lyngwyn.
    const capitalFact = textFactOf(detail, "capital");
    const seatFact = textFactOf(detail, "seat");
    expect(capitalFact?.value, "Voraussetzung: Tobrien nennt seine Hauptstadt, mit Zusatz „(nominell)“").toMatch(
        /\(nominell\)$/,
    );
    expect(seatFact?.ref?.kind, "Voraussetzung: der Herrschaftssitz verweist auf einen aktiven Ort").toBe("place");
    await expect(rowOf(page, "Hauptstadt")).toContainText(capitalFact?.value ?? "");
    await expect(rowOf(page, "Hauptstadt").getByTestId("info-link")).toHaveCount(
        capitalFact?.ref === undefined ? 0 : 1,
    );
    const seat = rowOf(page, "Herrschaftssitz").getByTestId("info-link");
    await expect(seat).toHaveText(seatFact?.value ?? "");
    // Sonst ist nichts verlinkt: X1 führt für Staatsartikel keine Feldlinks.
    await expect(rowOf(page, "Herrschaftsform").getByTestId("info-link")).toHaveCount(0);
    await expect(rowOf(page, "Oberhaupt").getByTestId("info-link")).toHaveCount(0);
    await seat.click();
    await expect
        .poll(() => page.evaluate(() => JSON.stringify(globalThis.avesmapsSelectedSubject?.())))
        .toBe(JSON.stringify({ kind: "place", id: seatFact?.ref?.id }));
});

test("🔴 Gebiet mit abweichendem Hauptstadttext (Baronie Lyngwyn): der Link trägt den Text des Gebietsexports, nicht den Ortsnamen, und öffnet den Ort", async ({
    page,
}) => {
    const answer = page.waitForResponse(
        (response) => response.url().endsWith(`/api/subjects/territory/${LYNGWYN}`) && response.ok(),
    );
    await open(page, { kind: "territory", id: LYNGWYN }, "Baronie Lyngwyn");
    const capitalFact = textFactOf((await (await answer).json()) as SubjectDetail, "capital");
    expect(capitalFact?.ref?.kind, "Voraussetzung: die Hauptstadt verweist auf einen aktiven Ort").toBe("place");
    const ortsname = (await (
        await page.request.get(`/api/subjects/place/${capitalFact?.ref?.id ?? ""}`)
    ).json()) as SubjectDetail;
    expect(ortsname.title, "Voraussetzung: der Ort heißt anders als der Text des Gebietsexports").not.toBe(
        capitalFact?.value,
    );
    const capital = rowOf(page, "Hauptstadt").getByTestId("info-link");
    await expect(capital).toHaveText(capitalFact?.value ?? "");
    await capital.click();
    await expect
        .poll(() => page.evaluate(() => JSON.stringify(globalThis.avesmapsSelectedSubject?.())))
        .toBe(JSON.stringify({ kind: "place", id: capitalFact?.ref?.id }));
});

test("🔴 Gebiet mit langen Texten (Fürstentum Kosch): Klammern, Strichpunkte und ein Zusatz in der Währung stehen ungekürzt", async ({
    page,
}) => {
    await open(page, { kind: "territory", id: KOSCH }, "Fürstentum Kosch");
    await expect(rowOf(page, "Währung")).toContainText("neben Dukaten noch Zwergentaler");
    await expect(rowOf(page, "Einwohnerzahl")).toContainText("80000 (davon fast 20000 Zwerge; 1041 BF)");
    await expect(rowOf(page, "Oberhaupt")).toContainText("(Königin Rohaja von Gareth nur der Titulatur nach)");
    await expect(rowOf(page, "Hauptstadt").getByTestId("info-link")).toHaveText("Angbar");
});

test("🔴 ein eigener Knoten ohne Wiki-Key (Alt-Gareth): nur seine eigene Sprache; das Zusatzfeld „Politisch“ und die Wikizeile fehlen", async ({
    page,
}) => {
    await open(page, { kind: "territory", id: ALT_GARETH }, "Alt-Gareth");
    const labels = await labelsOf(page);
    expect(labels.filter((label) => STAATSINFOBOX.includes(label))).toEqual(["Sprache"]);
    await expect(rowOf(page, "Sprache")).toContainText("Garethi");
    for (const hidden of ZUSATZFELDER) expect(labels, hidden).not.toContain(hidden);
    await expect(page.getByTestId("info-source-label")).toHaveCount(0);
});

test("🔴 ein Gebiet ohne Detailzeile (Baronie Jandraskan): keine Zeile der Staatsinfobox, kein Platzhalter", async ({
    page,
}) => {
    await open(page, { kind: "territory", id: JANDRASKAN }, "Baronie Jandraskan (Teilgebiet)");
    const labels = await labelsOf(page);
    expect(labels.filter((label) => [...STAATSINFOBOX, ...ZUSATZFELDER].includes(label))).toEqual([]);
});

test("Englisch: die Staatsinfobox heißt wie in Legacy (Form of government, Founded, Dissolution, Currency, Population, Geography, Trade goods)", async ({
    page,
}) => {
    await page.goto("/?lang=en");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.evaluate((subject) => globalThis.avesmapsOpenSubject?.(subject), { kind: "territory", id: TOBRIEN });
    await expect(page.getByTestId("info-title")).toHaveText("Herzogtum Tobrien", { timeout: 30_000 });
    const labels = await labelsOf(page);
    for (const label of [
        "Form of government",
        "Ruler",
        "Founded",
        "Dissolution",
        "Founder",
        "Capital",
        "Seat",
        "Language",
        "Currency",
        "Population",
        "Geography",
        "Map period",
        "Trade goods",
    ]) {
        expect(labels, label).toContain(label);
    }
});
