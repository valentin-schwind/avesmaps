import { expect, test, type Page } from "@playwright/test";
import "./map-handle";
import { showStages } from "./stage-groups.ts";
import { openStagePanel, stageFieldValue } from "./stage-panel.ts";

/**
 * Deutsch, Englisch, Französisch, Niederländisch und Italienisch am echten Stack (WI-0032, WI-0158,
 * WI-0165, WI-0167):
 * `?lang=en` aus Legacys Links, der Sprachschalter ohne Neuladen, und die Reise bleibt dabei stehen.
 *
 * Seit WI-0156 ist der Schalter eine Pille, die aufklappt (`lang`), und die Sprachen stehen als
 * Einträge darin (`lang-de`, `lang-en`, `lang-fr`, `lang-nl`, `lang-it`). Die Browsersprache entscheidet,
 * wo nichts anderes gilt; `playwright.config.ts` stellt dafür `de-DE` ein, vier Tests hier stellen
 * Englisch, Französisch, Niederländisch und Italienisch.
 */

async function open(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
}

/** Die Pille aufklappen und eine Sprache wählen. */
async function waehleSprache(
    page: Page,
    code: "de" | "en" | "fr" | "nl" | "it" | "es" | "pl" | "da" | "sv",
): Promise<void> {
    await page.getByTestId("lang").click();
    await page.getByTestId(`lang-${code}`).click();
    // Die Tafel lädt erst bei Bedarf (WI-0235); `lang` an <html> wechselt erst, wenn sie da ist und die Sprache gilt.
    await expect(page.locator("html")).toHaveAttribute("lang", code);
}

test("🔴 Legacys `?lang=en` öffnet die Seite auf Englisch - und bleibt in der Adresse, wie es kam", async ({
    page,
}) => {
    await open(page, "?route=Gareth~Perricum&lang=en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("route-title")).toHaveText(/The journey from\s+Gareth\s+to\s+Perricum/);
    await expect(page.getByTestId("route-add")).toHaveText("Add destination");
    // 🪤 Seit WI-0087 P1 nennt die Zeile den WEGNAMEN, wo es einen gibt - und Namen werden nicht übersetzt. Die
    // übersetzte Wegart steht im Infopanel der Etappe; dort wird sie geprüft, nicht mehr an der Zeile.
    await showStages(page);
    await openStagePanel(page, 0);
    await expect(stageFieldValue(page, "type")).toHaveText(/Imperial road|Road|Way|Path|Track/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("lang")).toHaveText("EN");
    await expect(page.getByTestId("lang")).toHaveAttribute("aria-label", "Language: English");
    // `lang` wird nie geschrieben: Die Reise steht in der Adresse, die Sprache nur, wenn sie mitkam.
    await expect.poll(() => page.evaluate(() => globalThis.location.search)).toContain("lang=en");
});

test("🔴 Die Hinweise auf Englisch: Rechtstexte übersetzt, und ein Satz sagt, welche Fassung gilt", async ({
    page,
}) => {
    await open(page, "?route=Gareth~Perricum&lang=en");
    await page.getByTestId("notes-open").click();
    await page.getByTestId("notes-copyright").locator("summary").click();
    await expect(page.getByTestId("notes-copyright")).toContainText("registered trademarks of Ulisses Spiele GmbH");
    await expect(page.getByTestId("notes-translation-note")).toContainText("the German version applies");
    await page.getByTestId("notes").getByTestId("fenster-schliessen").click();
    // Auf Deutsch die deutsche Fassung, ohne den Satz über die Übersetzung.
    await waehleSprache(page, "de");
    await page.getByTestId("notes-open").click();
    await page.getByTestId("notes-copyright").locator("summary").click();
    await expect(page.getByTestId("notes-copyright")).toContainText("eingetragene Marken der Ulisses Spiele GmbH");
    await expect(page.getByTestId("notes-translation-note")).toHaveCount(0);
});

test("🔴 Der Sprachschalter schaltet ohne Neuladen, die Reise bleibt, und die Wahl übersteht das Neuladen", async ({
    page,
}) => {
    await open(page, "?route=Gareth~Perricum");
    await expect(page.getByTestId("route-title")).toHaveText(/Die Reise von\s+Gareth\s+nach\s+Perricum/);
    const stages = await page.getByTestId("route-stage").count();
    // Wie weit es ist, hängt am Geländestand (WI-0049 S5a: mit Steigung 359 statt 356 Meilen). Geprüft
    // wird der Sprachwechsel: dieselbe Zahl, englisch geschrieben.
    await expect(page.getByTestId("player-miles-left")).toHaveText(/^noch \d+$/);
    const left = ((await page.getByTestId("player-miles-left").textContent()) ?? "").replace(/\D/g, "");
    await page.evaluate(() => {
        (globalThis as { noReload?: boolean }).noReload = true;
    });
    await waehleSprache(page, "en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("route-title")).toHaveText(/The journey from\s+Gareth\s+to\s+Perricum/);
    await expect(page.getByTestId("route-stage")).toHaveCount(stages);
    await expect(page.getByTestId("player-miles")).toHaveText("0.0 miles");
    await expect(page.getByTestId("player-miles-left")).toHaveText(`${left} to go`);
    // Kein Neuladen: Was die Seite sich gemerkt hat, ist noch da.
    expect(await page.evaluate(() => (globalThis as { noReload?: boolean }).noReload)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("avesmaps-lang"))).toBe("en");

    await page.reload();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-title")).toHaveText(/The journey from/);
    await waehleSprache(page, "de");
    await expect(page.getByTestId("route-title")).toHaveText(/Die Reise von/);
});

/**
 * 🔴 Betreiber 2026-10-15 (WI-0156): „mach dass die sprache sich standardmäßig dem browser anpasst, default ist sonst
 * DE“. Geprüft am echten Browser, weil nur er `navigator.languages` wirklich setzt.
 */
test.describe("Ein englischer Browser", () => {
    test.use({ locale: "en-GB" });

    test("🔴 bekommt Englisch, ohne `?lang=` und ohne gespeicherte Wahl", async ({ page }) => {
        await open(page, "");
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.getByTestId("lang")).toHaveText("EN");
        // Die eigene Wahl schlägt den Browser und übersteht das Neuladen.
        await waehleSprache(page, "de");
        await page.reload();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
    });

    test("🔴 `?lang=de` schlägt den Browser", async ({ page }) => {
        await open(page, "?lang=de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
    });
});

test("🔴 Die Sprachen stehen unter ihrem eigenen Namen, die gewählte ist markiert", async ({ page }) => {
    await open(page, "");
    await page.getByTestId("lang").click();
    const menue = page.getByTestId("lang-menue");
    await expect(menue).toHaveAttribute("aria-label", "Sprache");
    await expect(menue.getByTestId("lang-de")).toHaveText("Deutsch");
    await expect(menue.getByTestId("lang-en")).toHaveText("English");
    await expect(menue.getByTestId("lang-fr")).toHaveText("Français");
    await expect(menue.getByTestId("lang-nl")).toHaveText("Nederlands");
    await expect(menue.getByTestId("lang-it")).toHaveText("Italiano");
    await expect(menue.getByTestId("lang-es")).toHaveText("Español");
    await expect(menue.getByTestId("lang-pl")).toHaveText("Polski");
    await expect(menue.getByTestId("lang-da")).toHaveText("Dansk");
    await expect(menue.getByTestId("lang-sv")).toHaveText("Svenska");
    await expect(menue.getByTestId("lang-de")).toHaveAttribute("aria-checked", "true");
    await expect(menue.getByTestId("lang-en")).toHaveAttribute("aria-checked", "false");
    await expect(menue.getByTestId("lang-fr")).toHaveAttribute("aria-checked", "false");
    await expect(menue.getByTestId("lang-nl")).toHaveAttribute("aria-checked", "false");
    await expect(menue.getByTestId("lang-it")).toHaveAttribute("aria-checked", "false");
    await expect(menue.getByTestId("lang-es")).toHaveAttribute("aria-checked", "false");
    await expect(menue.getByTestId("lang-pl")).toHaveAttribute("aria-checked", "false");
    await expect(menue.getByTestId("lang-da")).toHaveAttribute("aria-checked", "false");
    await expect(menue.getByTestId("lang-sv")).toHaveAttribute("aria-checked", "false");
    // Esc schließt, ohne etwas zu wählen.
    await page.keyboard.press("Escape");
    await expect(menue).toHaveCount(0);
    await expect(page.getByTestId("lang")).toHaveText("DE");
});

/**
 * 🔴 Französisch (WI-0158): Die Tafel steht, also steht die Sprache im Schalter und der Browser darf sie wählen.
 * Geprüft werden die Sätze des Planers, die Zahl mit Komma und dass die Wegart im Infopanel übersetzt ist.
 */
test.describe("Ein französischer Browser", () => {
    test.use({ locale: "fr-FR" });

    test("🔴 bekommt Französisch, und der Planer spricht es", async ({ page }) => {
        await open(page, "?route=Gareth~Perricum");
        await expect(page.locator("html")).toHaveAttribute("lang", "fr");
        await expect(page.getByTestId("lang")).toHaveText("FR");
        await expect(page.getByTestId("lang")).toHaveAttribute("aria-label", "Langue : Français");
        await expect(page.getByTestId("route-title")).toHaveText(/Le voyage de\s+Gareth\s+à\s+Perricum/);
        await expect(page.getByTestId("route-add")).toHaveText("Ajouter une destination");
        // Zahlen mit Komma, und „noch“ heißt „reste“. Die Meile heißt „lieue“ (Glossar der französischen DSA-Ausgabe, 7cfdc31ae).
        await expect(page.getByTestId("player-miles")).toHaveText(/^0,0 lieues$/);
        await expect(page.getByTestId("player-miles-left")).toHaveText(/^reste \d+$/);
        // Namen werden nie übersetzt, die Wegart schon.
        await showStages(page);
        await openStagePanel(page, 0);
        await expect(stageFieldValue(page, "type")).toHaveText(/Route impériale|Route|Chemin|Sentier/);
        await page.keyboard.press("Escape");
    });

    test("🔴 `?lang=de` schlägt den Browser, und die eigene Wahl schlägt beide", async ({ page }) => {
        await open(page, "?lang=de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await waehleSprache(page, "fr");
        await expect(page.locator("html")).toHaveAttribute("lang", "fr");
        expect(await page.evaluate(() => localStorage.getItem("avesmaps-lang"))).toBe("fr");
    });
});

/**
 * 🔴 Niederländisch (WI-0165): Die Tafel steht, also steht die Sprache im Schalter und der Browser darf sie wählen.
 * Geprüft werden die Sätze des Planers, die Zahl mit Komma wie im Deutschen und die Wegart im Infopanel.
 */
test.describe("Ein niederländischer Browser", () => {
    test.use({ locale: "nl-NL" });

    test("🔴 bekommt Niederländisch, und der Planer spricht es", async ({ page }) => {
        await open(page, "?route=Gareth~Perricum");
        await expect(page.locator("html")).toHaveAttribute("lang", "nl");
        await expect(page.getByTestId("lang")).toHaveText("NL");
        await expect(page.getByTestId("lang")).toHaveAttribute("aria-label", "Taal: Nederlands");
        await expect(page.getByTestId("route-title")).toHaveText(/De reis van\s+Gareth\s+naar\s+Perricum/);
        await expect(page.getByTestId("route-add")).toHaveText("Doel toevoegen");
        // Zahlen wie im Deutschen (Komma, Punkt als Tausendertrenner), und „noch“ heißt „nog“.
        await expect(page.getByTestId("player-miles")).toHaveText(/^0,0 mijl$/);
        await expect(page.getByTestId("player-miles-left")).toHaveText(/^nog \d+$/);
        // Namen werden nie übersetzt, die Wegart schon. 🪤 „Etappe“ heißt im Niederländischen gleich,
        // deshalb trägt `stage-panel.ts` kein neues Wort.
        await showStages(page);
        await openStagePanel(page, 0);
        await expect(stageFieldValue(page, "type")).toHaveText(/Rijksweg|Straatweg|Weg|Pad|Bergpas/);
        await page.keyboard.press("Escape");
    });

    test("🔴 `?lang=de` schlägt den Browser, und die eigene Wahl schlägt beide", async ({ page }) => {
        await open(page, "?lang=de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await waehleSprache(page, "nl");
        await expect(page.locator("html")).toHaveAttribute("lang", "nl");
        expect(await page.evaluate(() => localStorage.getItem("avesmaps-lang"))).toBe("nl");
    });
});

/**
 * 🔴 Italienisch (WI-0167): Die Tafel steht, also steht die Sprache im Schalter und der Browser darf sie wählen.
 * Geprüft werden die Sätze des Planers, die Zahl mit Komma und die Wegart im Infopanel.
 */
test.describe("Ein italienischer Browser", () => {
    test.use({ locale: "it-IT" });

    test("🔴 bekommt Italienisch, und der Planer spricht es", async ({ page }) => {
        await open(page, "?route=Gareth~Perricum");
        await expect(page.locator("html")).toHaveAttribute("lang", "it");
        await expect(page.getByTestId("lang")).toHaveText("IT");
        await expect(page.getByTestId("lang")).toHaveAttribute("aria-label", "Lingua: Italiano");
        await expect(page.getByTestId("route-title")).toHaveText(/Il viaggio da\s+Gareth\s+a\s+Perricum/);
        await expect(page.getByTestId("route-add")).toHaveText("Aggiungere una destinazione");
        // Zahlen mit Komma, und „noch“ heißt „ancora“.
        await expect(page.getByTestId("player-miles")).toHaveText(/^0,0 miglia$/);
        await expect(page.getByTestId("player-miles-left")).toHaveText(/^ancora \d+$/);
        // Namen werden nie übersetzt, die Wegart schon. 🪤 „Etappe“ heißt „Tappa“; das Wort steht
        // deshalb in `stage-panel.ts`.
        await showStages(page);
        await openStagePanel(page, 0);
        await expect(stageFieldValue(page, "type")).toHaveText(/Strada imperiale|Strada|Via|Sentiero|Passo montano/);
        await page.keyboard.press("Escape");
    });

    test("🔴 `?lang=de` schlägt den Browser, und die eigene Wahl schlägt beide", async ({ page }) => {
        await open(page, "?lang=de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await waehleSprache(page, "it");
        await expect(page.locator("html")).toHaveAttribute("lang", "it");
        expect(await page.evaluate(() => localStorage.getItem("avesmaps-lang"))).toBe("it");
    });
});

/**
 * 🔴 Spanisch (WI-0170): Die Tafel steht, also steht die Sprache im Schalter und der Browser darf sie wählen.
 * Geprüft werden die Sätze des Planers, die Zahl mit Komma und dass die Wegart im Infopanel übersetzt ist.
 */
test.describe("Ein spanischer Browser", () => {
    test.use({ locale: "es-ES" });

    test("🔴 bekommt Spanisch, und der Planer spricht es", async ({ page }) => {
        await open(page, "?route=Gareth~Perricum");
        await expect(page.locator("html")).toHaveAttribute("lang", "es");
        await expect(page.getByTestId("lang")).toHaveText("ES");
        await expect(page.getByTestId("lang")).toHaveAttribute("aria-label", "Idioma: Español");
        await expect(page.getByTestId("route-title")).toHaveText(/El viaje de\s+Gareth\s+a\s+Perricum/);
        await expect(page.getByTestId("route-add")).toHaveText("Añadir un destino");
        // Zahlen mit Komma, und „noch“ heißt „quedan“.
        await expect(page.getByTestId("player-miles")).toHaveText(/^0,0 millas$/);
        await expect(page.getByTestId("player-miles-left")).toHaveText(/^quedan \d+$/);
        // Namen werden nie übersetzt, die Wegart schon. 🪤 „Etappe“ heißt „Etapa“; das Wort steht
        // deshalb in `stage-panel.ts`.
        await showStages(page);
        await openStagePanel(page, 0);
        await expect(stageFieldValue(page, "type")).toHaveText(/Calzada imperial|Calzada|Camino|Senda|Paso de montaña/);
        await page.keyboard.press("Escape");
    });

    test("🔴 `?lang=de` schlägt den Browser, und die eigene Wahl schlägt beide", async ({ page }) => {
        await open(page, "?lang=de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await waehleSprache(page, "es");
        await expect(page.locator("html")).toHaveAttribute("lang", "es");
        expect(await page.evaluate(() => localStorage.getItem("avesmaps-lang"))).toBe("es");
    });
});

/**
 * 🔴 Polnisch (WI-0174): die siebte Tafel - und die erste Sprache mit DREI Zählformen. Darum steht hier neben den
 * Sätzen des Planers eine Zählprobe: „1 etap“, „2 etapy“, „5 etapów“ kommen aus `tPlural` (WI-0173), nicht aus
 * einer Zahlenbedingung im Aufrufer.
 */
test.describe("Ein polnischer Browser", () => {
    test.use({ locale: "pl-PL" });

    test("🔴 bekommt Polnisch, und der Planer spricht es", async ({ page }) => {
        await open(page, "?route=Gareth~Perricum");
        await expect(page.locator("html")).toHaveAttribute("lang", "pl");
        await expect(page.getByTestId("lang")).toHaveText("PL");
        await expect(page.getByTestId("lang")).toHaveAttribute("aria-label", "Język: Polski");
        await expect(page.getByTestId("route-title")).toHaveText(/Podróż z\s+Gareth\s+do\s+Perricum/);
        await expect(page.getByTestId("route-add")).toHaveText("Dodać cel");
        // Zahlen mit Komma, und „noch“ heißt „jeszcze“.
        await expect(page.getByTestId("player-miles")).toHaveText(/^0,0 mil$/);
        await expect(page.getByTestId("player-miles-left")).toHaveText(/^jeszcze \d+$/);
        // Namen werden nie übersetzt, die Wegart schon. 🪤 „Etappe“ heißt „Etap“; das Wort steht
        // deshalb in `stage-panel.ts`.
        await showStages(page);
        await openStagePanel(page, 0);
        await expect(stageFieldValue(page, "type")).toHaveText(
            /Gościniec cesarski|Gościniec|Droga|Ścieżka|Przełęcz górska/,
        );
        await page.keyboard.press("Escape");
    });

    test("🔴 `?lang=de` schlägt den Browser, und die eigene Wahl schlägt beide", async ({ page }) => {
        await open(page, "?lang=de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await waehleSprache(page, "pl");
        await expect(page.locator("html")).toHaveAttribute("lang", "pl");
        expect(await page.evaluate(() => localStorage.getItem("avesmaps-lang"))).toBe("pl");
    });
});

/**
 * 🔴 Dänisch (WI-0210): die achte Tafel. Zählformen wie im Deutschen, darum steht hier keine Zählprobe, sondern
 * dieselbe Runde wie bei den übrigen Sprachen: Sätze des Planers, Zahl mit Komma, Wegart im Infopanel.
 */
test.describe("Ein dänischer Browser", () => {
    test.use({ locale: "da-DK" });

    test("🔴 bekommt Dänisch, und der Planer spricht es", async ({ page }) => {
        await open(page, "?route=Gareth~Perricum");
        await expect(page.locator("html")).toHaveAttribute("lang", "da");
        await expect(page.getByTestId("lang")).toHaveText("DA");
        await expect(page.getByTestId("lang")).toHaveAttribute("aria-label", "Sprog: Dansk");
        await expect(page.getByTestId("route-title")).toHaveText(/Rejsen fra\s+Gareth\s+til\s+Perricum/);
        await expect(page.getByTestId("route-add")).toHaveText("Tilføj mål");
        // Zahlen mit Komma, und „noch“ heißt „endnu“.
        await expect(page.getByTestId("player-miles")).toHaveText(/^0,0 mil$/);
        await expect(page.getByTestId("player-miles-left")).toHaveText(/^endnu \d+$/);
        // Namen werden nie übersetzt, die Wegart schon. 🪤 „Etappe“ heißt „Etape“; das Wort steht
        // deshalb in `stage-panel.ts`.
        await showStages(page);
        await openStagePanel(page, 0);
        await expect(stageFieldValue(page, "type")).toHaveText(/Rigsvej|Landevej|Vej|Sti|Bjergpas/);
        await page.keyboard.press("Escape");
    });

    test("🔴 `?lang=de` schlägt den Browser, und die eigene Wahl schlägt beide", async ({ page }) => {
        await open(page, "?lang=de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await waehleSprache(page, "da");
        await expect(page.locator("html")).toHaveAttribute("lang", "da");
        expect(await page.evaluate(() => localStorage.getItem("avesmaps-lang"))).toBe("da");
    });
});

/**
 * 🔴 Schwedisch (WI-0211): die neunte Tafel, und vorerst die letzte. Zählformen wie im Deutschen.
 */
test.describe("Ein schwedischer Browser", () => {
    test.use({ locale: "sv-SE" });

    test("🔴 bekommt Schwedisch, und der Planer spricht es", async ({ page }) => {
        await open(page, "?route=Gareth~Perricum");
        await expect(page.locator("html")).toHaveAttribute("lang", "sv");
        await expect(page.getByTestId("lang")).toHaveText("SV");
        await expect(page.getByTestId("lang")).toHaveAttribute("aria-label", "Språk: Svenska");
        await expect(page.getByTestId("route-title")).toHaveText(/Resan från\s+Gareth\s+till\s+Perricum/);
        await expect(page.getByTestId("route-add")).toHaveText("Lägg till mål");
        // Zahlen mit Komma, und „noch“ heißt „ännu“.
        await expect(page.getByTestId("player-miles")).toHaveText(/^0,0 mil$/);
        await expect(page.getByTestId("player-miles-left")).toHaveText(/^ännu \d+$/);
        // Namen werden nie übersetzt, die Wegart schon. 🪤 „Etappe“ heißt „Etapp“; das Wort steht
        // deshalb in `stage-panel.ts`.
        await showStages(page);
        await openStagePanel(page, 0);
        await expect(stageFieldValue(page, "type")).toHaveText(/Riksväg|Landsväg|Väg|Stig|Bergspass/);
        await page.keyboard.press("Escape");
    });

    test("🔴 `?lang=de` schlägt den Browser, und die eigene Wahl schlägt beide", async ({ page }) => {
        await open(page, "?lang=de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await waehleSprache(page, "sv");
        await expect(page.locator("html")).toHaveAttribute("lang", "sv");
        expect(await page.evaluate(() => localStorage.getItem("avesmaps-lang"))).toBe("sv");
    });
});

test("🔴 Das Kürzel steht senkrecht genau in der Mitte der Pille (Betreiber 2026-09-25)", async ({ page }) => {
    // Zentriert wird die Versalhöhe, nicht die Zeile: Mit gerundeter Ober- und Unterlänge saßen die
    // Buchstaben bis zu einem Gerätepixel zu hoch („DE | EN einfach nur perfekt vertikal zentrieren“).
    await open(page, "");
    for (const sprache of ["de", "en", "fr", "nl", "it", "es"] as const) {
        if (sprache !== "de") await waehleSprache(page, sprache);
        const placement = await page.getByTestId("lang").evaluate((button) => {
            const label = button.querySelector(".lang-toggle__label")!.getBoundingClientRect();
            const box = button.getBoundingClientRect();
            return { offset: label.top + label.height / 2 - (box.top + box.height / 2), capHeight: label.height };
        });
        expect(Math.abs(placement.offset), sprache).toBeLessThan(0.05);
        // Geschnitten auf Versalhöhe (8 px Schrift: rund 6,2 px), sonst zentrierte er die ganze Zeile.
        expect(placement.capHeight, sprache).toBeGreaterThan(5.5);
        expect(placement.capHeight, sprache).toBeLessThan(7);
    }
});
