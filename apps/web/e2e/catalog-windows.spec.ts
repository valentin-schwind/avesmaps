import { expect, test, type Locator, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die Katalogfenster „Kartensammlung von …“ und „Literatur zu …“ (WI-0118, Betreiber 2026-10-09: „ein Klick auf eine Karte oder eine
 * Literatur soll immer den jeweiligen Eintrag im Verzeichnis vergrößert darstellen. Größer als das aktuell bei legacy stattfindet. … Hier
 * sollten die Informationen stehen, die wir haben, inkl. Links zu woanders“; „Externe Links immer mit Symbol ↗“).
 *
 * Die benannten Fälle des Auftrags: Die Knöpfe unter den Streifen öffnen das Fenster · ein Klick auf eine Kachel öffnet es bei diesem Eintrag,
 * vergrößert · Filter erscheinen nur, wenn sie die Liste teilen · ↗ an jedem externen Link · „Karte vorschlagen“ öffnet das Fenster der Besucher · Rhôndur zeigt
 * sein Vollbild · am Telefon läuft nichts über.
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Worktrees auf dem Port, den `PORT` nennt (Vite liest daraus das Proxyziel), und eine
 * Entwicklungsdatenbank mit Kartensammlung, Literatur und Medien. Die Fälle fragen Gareth (12 Karten, 110 Werke) und Rhôndur (eine Karte
 * mit Vollbild) am Bestand, nie genaue Zahlen: Der Bestand wächst mit jedem Zug.
 *   $env:PORT="3296"; $env:E2E_PORT="4296"; npx playwright test e2e/catalog-windows.spec.ts --workers=1
 */

const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } as const;
const RHONDUR = { kind: "place", id: "59e6983c-536d-5ecd-b070-8f30ead6468d" } as const;
/** Eine Karte aus der Gareth-Box: Vorschau, Art, Zeichner, Auflösung und eine kostenpflichtige Fundstelle (Bestand 2026-10-09). */
const BOX = "Gareth-Karte aus der Gareth-Box";
/** Ein Werk mit Umschlag, Schlagwort, Schwierigkeit und drei Links (Bestand). */
const WERK = "Tal der Finsternis";

async function openPlace(
    page: Page,
    ref: Record<string, unknown>,
    section: "citymaps" | "literature",
): Promise<Locator> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    const panel = page.locator(`[data-section="${section}"]`);
    await panel.waitFor({ timeout: 30_000 });
    // Die Kacheln stehen erst, wenn die Liste da ist.
    await panel.getByTestId(section === "citymaps" ? "info-action-citymapsAll" : "info-action-literatureAll").waitFor({
        timeout: 30_000,
    });
    return panel;
}

const windowOf = (page: Page, section: "citymaps" | "literature"): Locator =>
    page.getByTestId(section === "citymaps" ? "citymaps-window" : "literature-window");

/** Die Zeilen des Fensters. */
const rowsOf = (window: Locator): Locator => window.getByTestId("catalog-row");

/**
 * Die Zeilen ohne Deckel: Der Deckel fängt den Klick ab, eine Zeile mit ihm lässt sich nicht aufklappen.
 * 🪤 Der innere Locator muss von der SEITE kommen, nicht vom Fenster: Playwright sucht ihn relativ zur Zeile, und ein `window`-Locator
 * suchte das Fenster IN der Zeile - gefunden würde nie etwas, und der Filter ließe jede Zeile durch.
 */
const rowsWithoutVeil = (window: Locator): Locator =>
    rowsOf(window).filter({ hasNot: window.page().getByTestId("info-spoiler") });

async function openWindow(page: Page, panel: Locator, section: "citymaps" | "literature"): Promise<Locator> {
    await panel.getByTestId(section === "citymaps" ? "info-action-citymapsAll" : "info-action-literatureAll").click();
    const window = windowOf(page, section);
    await expect(window).toBeVisible({ timeout: 15_000 });
    await expect(rowsOf(window).first()).toBeVisible({ timeout: 30_000 });
    return window;
}

/** Die Kachel im Streifen, die diesen Titel trägt. */
const tileOf = (panel: Locator, section: "citymaps" | "literature", title: string): Locator =>
    panel
        .getByTestId(section === "citymaps" ? "info-citymaps-card" : "info-literature-card")
        .filter({ hasText: title })
        .first();

/** Alle sichtbaren Anker nach draußen in einem Teil der Seite - mit dem, was die Hausregel am gezeichneten Bild verlangt. */
async function externalLinks(
    scope: Locator,
): Promise<{ text: string; arrow: boolean; typed: boolean; href: string; rel: string }[]> {
    return scope.evaluate((root) =>
        [...root.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')]
            .filter((element) => {
                const box = element.getBoundingClientRect();
                return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
            })
            .map((element) => {
                const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
                return {
                    text,
                    arrow: (getComputedStyle(element, "::after").content || "").includes("↗"),
                    typed: text.endsWith("↗"),
                    href: element.getAttribute("href") ?? "",
                    rel: element.getAttribute("rel") ?? "",
                };
            }),
    );
}

test.describe("🔴 die Knöpfe unter den Streifen öffnen das Fenster", () => {
    test("„Kartensammlung anzeigen“: das Fenster heißt wie der Abschnitt, steht ohne offenen Eintrag da, und Escape schließt nur das Fenster", async ({
        page,
    }) => {
        const panel = await openPlace(page, GARETH, "citymaps");
        // Die drei Knöpfe stehen UNTER dem Streifen (Legacy: Kartensammlung anzeigen, Karte vorschlagen).
        const band = panel.getByTestId("info-catalog-actions");
        await expect(band.getByRole("button")).toHaveText([/Kartensammlung anzeigen/, /Karte vorschlagen/]);
        const strip = await panel.getByTestId("info-citymaps-strip").boundingBox();
        const bandBox = await band.boundingBox();
        expect((bandBox?.y ?? 0) > (strip?.y ?? 0) + (strip?.height ?? 0) - 1).toBe(true);

        const tile = panel.getByTestId("info-action-citymapsAll");
        await tile.click();
        const window = windowOf(page, "citymaps");
        await expect(window).toBeVisible();
        await expect(page.getByRole("dialog", { name: "Kartensammlung von Gareth" })).toBeVisible();
        // Die Zahl steht hinter dem Titel, nicht am anderen Ende der Leiste.
        const title = await window.locator("h2").boundingBox();
        const count = await window.locator(".avm-fenster__zusatz").boundingBox();
        expect(Math.abs((count?.x ?? 0) - ((title?.x ?? 0) + (title?.width ?? 0)))).toBeLessThan(24);
        // 🔴 Die Liste steht zu: kein Eintrag ist vergrößert, solange niemand einen gewählt hat.
        await expect(rowsOf(window).first()).toBeVisible({ timeout: 30_000 });
        expect(await rowsOf(window).count()).toBeGreaterThan(3);
        await expect(window.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(0);
        // Der Fokus steht auf ✕ (die Hülle), und Escape schließt NUR das Fenster: Panel und Auswahl bleiben.
        await expect(window.getByTestId("fenster-schliessen")).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(window).toBeHidden();
        await expect(page.getByTestId("info-title")).toBeVisible();
        await expect(tile).toBeFocused();
    });

    test("„Literatur anzeigen“ öffnet „Literatur zu Gareth“ mit der Zahl der offenen Werke", async ({ page }) => {
        const panel = await openPlace(page, GARETH, "literature");
        await expect(panel.getByTestId("info-catalog-actions").getByRole("button")).toHaveText([/Literatur anzeigen/]);
        const window = await openWindow(page, panel, "literature");
        await expect(page.getByRole("dialog", { name: "Literatur zu Gareth" })).toBeVisible();
        // Dieselbe Zahl wie die Überschrift im Panel: ein verdecktes Werk zählt nicht mit.
        const heading = (await panel.getByTestId("info-section-count").innerText()).trim();
        await expect(window.locator(".avm-fenster__zusatz")).toHaveText(heading);
        await expect(window.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(0);
    });

    test("🔴 „Karte vorschlagen“ ist seit WI-0275 offen - im Panel und im Fuß geht das Fenster der Besucher AUF, ohne einen Request; „+ Neuer Fundort“ bleibt gesperrt", async ({
        page,
    }) => {
        const panel = await openPlace(page, GARETH, "citymaps");
        const suggest = panel.getByTestId("info-action-citymapsSuggest");
        await expect(suggest).toBeEnabled();
        await expect(suggest).not.toHaveAttribute("data-locked", "");
        await expect(panel.getByTestId("info-catalog-actions-note")).toHaveCount(0);
        // Das Öffnen des Formulars fragt nur, ob der Server Vorschläge annimmt (`GET …/stand`); geschrieben wird erst beim Absenden.
        const requests: string[] = [];
        // Die anonyme Besucherstatistik (`POST /api/besuch`) ist keine Meldestelle: Sie meldet etwa die Zoomstufe, sobald
        // die Karte nach dem Flug zu Gareth ruht — seit WI-0166 startet die Karte weiter draußen, also fliegt sie hierher.
        page.on("request", (request) => {
            if (request.method() !== "GET" && !new URL(request.url()).pathname.startsWith("/api/besuch"))
                requests.push(`${request.method()} ${request.url()}`);
        });
        await suggest.click();
        const formular = page.getByTestId("kartenvorschlag-fenster");
        await expect(formular).toBeVisible();
        await expect(formular).toContainText("Für die Kartensammlung von Gareth.");
        await page.keyboard.press("Escape");
        await expect(formular).toBeHidden();

        const window = await openWindow(page, panel, "citymaps");
        const foot = window.getByTestId("catalog-suggest");
        await expect(foot).toBeEnabled();
        await expect(foot).toContainText("Karte vorschlagen");
        await foot.click();
        // Das Fenster liegt ÜBER der Sammlung; schließt es, steht die Sammlung wieder da.
        await expect(page.getByTestId("kartenvorschlag-fenster")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("kartenvorschlag-fenster")).toBeHidden();
        await expect(window).toBeVisible();

        // Die ersten Zeilen tragen einen Deckel (er fängt den Klick ab): Wir nehmen die erste ohne.
        await rowsWithoutVeil(window).first().getByTestId("catalog-row-toggle").click();
        const add = window.getByTestId("catalog-add-source");
        await expect(add).toBeVisible();
        await expect(add).toBeDisabled();
        await expect(add).toHaveText("+ Neuer Fundort");
        expect(requests).toEqual([]);
    });
});

/**
 * Zeichner und Auflösung der Karte `BOX`, wie der Lesepfad sie liefert (derselbe Pfad, aus dem der Infopanel seine Kacheln und das Fenster seine
 * Zeilen füllt). 🪤 Der Zeichner ist ein Personenfeld: Der Abzug (WI-0251, `config/abzug/regeln.json`, `public.citymap.author`) ersetzt ihn
 * durch „(entfernt)“, sobald die lokale Entwicklungsdatenbank aus einem Abzug stammt. Ein fest eingetragener Name (der Zeichner aus dem Bestand vom
 * 2026-10-09) hing daran, WELCHE Datenbank unter dem Test liegt; die Aussage ist: Das Fenster zeigt die Angaben, die der Eintrag hat.
 * Was der Eintrag hat, steht deshalb als Voraussetzung vorn und wird dem Fenster als Erwartung vorgelegt.
 */
async function angabenDerBox(page: Page): Promise<{ author: string; resolution: string }> {
    const response = await page.request.get(`/api/subjects/place/${GARETH.id}/citymaps`);
    expect(response.ok(), "Voraussetzung: der Lesepfad der Kartensammlung von Gareth antwortet").toBe(true);
    const body = (await response.json()) as {
        maps: { title: string; author?: string | null; widthPx?: number | null; heightPx?: number | null }[];
    };
    const karte = body.maps.find((map) => map.title === BOX);
    expect(karte, `Voraussetzung: die Kartensammlung von Gareth enthält „${BOX}“`).toBeDefined();
    const author = karte?.author ?? "";
    expect(author.trim(), `Voraussetzung: „${BOX}“ hat einen Zeichner (gleich welchen)`).not.toBe("");
    const width = karte?.widthPx ?? 0;
    const height = karte?.heightPx ?? 0;
    expect(
        width > 0 && height > 0,
        `Voraussetzung: „${BOX}“ hat eine Auflösung (Bestand 2026-10-09: 4.635 × 3.278 px)`,
    ).toBe(true);
    const zahl = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
    return { author, resolution: `${zahl.format(width)} × ${zahl.format(height)} px` };
}

test.describe("🔴 ein Klick auf eine Kachel öffnet das Verzeichnis bei diesem Eintrag, vergrößert", () => {
    test("Karte: die Kachel führt nicht nach draußen, das Fenster zeigt sie größer als Legacys 248 × 174 - nie über die Pixel der Datei hinaus", async ({
        page,
    }) => {
        const erwartet = await angabenDerBox(page);
        const panel = await openPlace(page, GARETH, "citymaps");
        await panel.getByTestId("info-citymaps-strip").waitFor();
        const tile = tileOf(panel, "citymaps", BOX);
        // Die Kachel ist ein Knopf, kein Anker: Sie verlässt die Seite nicht mehr.
        await expect(tile.getByTestId("info-citymaps-link")).toHaveJSProperty("tagName", "BUTTON");
        expect(await tile.locator("a").count()).toBe(0);
        await tile.getByTestId("info-citymaps-link").click();

        const window = windowOf(page, "citymaps");
        await expect(window).toBeVisible();
        const open = window.locator('[data-testid="catalog-row"][data-open]');
        await expect(open).toHaveCount(1);
        await expect(open.getByTestId("catalog-row-title")).toHaveText(BOX);
        // Alle Angaben, die wir haben: Art, Typ, Farbe, Offiziell, Zeichner, Auflösung - und die Fundstellen mit ↗.
        const entry = open.getByTestId("catalog-entry");
        await expect(entry).toContainText("Derographisch");
        await expect(entry.locator("dt", { hasText: /^Zeichner$/ })).toHaveCount(1);
        await expect(entry).toContainText(erwartet.author);
        await expect(entry).toContainText(erwartet.resolution);
        await expect(open.getByTestId("catalog-link-paid").first()).toHaveText("(kostenpflichtig)");

        const image = open.getByTestId("catalog-entry-image");
        await expect(image).toBeVisible();
        await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true);
        const size = await image.evaluate((element) => {
            const picture = element as HTMLImageElement;
            const box = picture.getBoundingClientRect();
            return { w: box.width, h: box.height, nw: picture.naturalWidth, nh: picture.naturalHeight };
        });
        // 🔴 Größer als Legacy (248 × 174) und nie hochskaliert: höchstens die Pixel der Datei, die Vorschau ist höchstens 400 px breit.
        expect(size.w * size.h).toBeGreaterThan(248 * 174);
        expect(size.w).toBeLessThanOrEqual(size.nw + 1);
        expect(size.h).toBeLessThanOrEqual(size.nh + 1);
        expect(size.nw).toBeLessThanOrEqual(400);
        // Das Seitenverhältnis bleibt.
        expect(Math.abs(size.w / size.h - size.nw / size.nh)).toBeLessThan(0.02);
    });

    test("Literatur: Umschlag UND Titel öffnen dasselbe Fenster beim selben Werk; kein Anker mehr im Streifen", async ({
        page,
    }) => {
        const panel = await openPlace(page, GARETH, "literature");
        await panel.getByTestId("info-literature-strip").waitFor();
        const card = tileOf(panel, "literature", WERK);
        expect(await card.locator("a").count()).toBe(0);
        await card.getByTestId("info-literature-title").click();
        const window = windowOf(page, "literature");
        const open = window.locator('[data-testid="catalog-row"][data-open]');
        await expect(open).toHaveCount(1);
        await expect(open.getByTestId("catalog-row-title")).toHaveText(WERK);
        await expect(open.getByTestId("catalog-entry")).toContainText("DSA3");
        // Alle Links: Wiki Aventurica und die Titelsuche der Nationalbibliothek stehen immer da.
        await expect(open.getByTestId("catalog-link")).toContainText(["Wiki Aventurica", "Dt. Nationalbibliothek"]);
        const cover = open.getByTestId("catalog-entry-image");
        await expect(cover).toBeVisible();
        const size = await cover.evaluate((element) => {
            const picture = element as HTMLImageElement;
            const box = picture.getBoundingClientRect();
            return { h: box.height, nh: picture.naturalHeight };
        });
        expect(size.h).toBeLessThanOrEqual(size.nh + 1);
        await page.keyboard.press("Escape");
        await expect(window).toBeHidden();

        // Der Umschlag führt an dieselbe Stelle.
        await card.getByTestId("info-literature-cover").click();
        await expect(
            window.locator('[data-testid="catalog-row"][data-open]').getByTestId("catalog-row-title"),
        ).toHaveText(WERK);
    });

    test("🔴 eine Zeile ist offen, die übrigen zu - der Akkordeon wie in Legacy; Tastatur und `aria-expanded` stimmen", async ({
        page,
    }) => {
        const panel = await openPlace(page, GARETH, "citymaps");
        const window = await openWindow(page, panel, "citymaps");
        const toggles = rowsOf(window).getByTestId("catalog-row-toggle");
        // Eine offene Zeile ist nicht die erste (die ersten tragen oft einen Deckel): Wir nehmen die ersten zwei ohne Deckel.
        const free = rowsWithoutVeil(window);
        const first = free.nth(0).getByTestId("catalog-row-toggle");
        const second = free.nth(1).getByTestId("catalog-row-toggle");
        await expect(first).toHaveAttribute("aria-expanded", "false");
        await first.focus();
        await page.keyboard.press("Enter");
        await expect(first).toHaveAttribute("aria-expanded", "true");
        await second.click();
        await expect(second).toHaveAttribute("aria-expanded", "true");
        await expect(first).toHaveAttribute("aria-expanded", "false");
        await expect(window.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(1);
        // Ein zweiter Klick auf dieselbe Zeile klappt sie zu.
        await second.click();
        await expect(window.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(0);
        expect(await toggles.count()).toBeGreaterThan(3);
    });
});

test.describe("🔴 Filter erscheinen nur, wenn sie die Liste teilen", () => {
    test("eine einzelne Karte hat keine Leiste - Rhôndur", async ({ page }) => {
        const panel = await openPlace(page, RHONDUR, "citymaps");
        const window = await openWindow(page, panel, "citymaps");
        expect(await rowsOf(window).count()).toBe(1);
        await expect(window.getByTestId("catalog-filters")).toHaveCount(0);
        await expect(window.getByTestId("fenster-leiste")).toHaveCount(0);
    });

    test("Gareths Karten: Farbe, kostenlos, offiziell und Spoiler teilen die Liste; der Filter schränkt ein, „Spoiler“ nimmt die Deckel weg", async ({
        page,
    }) => {
        const panel = await openPlace(page, GARETH, "citymaps");
        const window = await openWindow(page, panel, "citymaps");
        const bar = window.getByTestId("catalog-filters");
        await expect(bar).toBeVisible();
        // Filter und Sortierung sind je ein Zeichen (Guide §13.45): alles steht im Blatt hinter dem Trichter.
        const trichter = bar.getByTestId("catalog-filter");
        await trichter.click();
        const blatt = window.getByTestId("catalog-filter-blatt");
        const labels = await blatt.locator("label").allInnerTexts();
        expect(labels.map((text) => text.trim())).toEqual(
            expect.arrayContaining(["farbig", "kostenlos", "offiziell", "Spoiler (Spielinhalte)"]),
        );

        const total = await rowsOf(window).count();
        const count = window.locator(".avm-fenster__zusatz");
        await expect(count).toHaveText(`(${String(total)})`);
        const farbig = blatt.getByTestId("catalog-filter-eigenschaften-colour");
        await farbig.check();
        await expect(window.getByTestId("catalog-filter-zahl")).toHaveText("1");
        const filtered = await rowsOf(window).count();
        expect(filtered).toBeGreaterThan(0);
        expect(filtered).toBeLessThan(total);
        await expect(count).toHaveText(`(${String(filtered)} von ${String(total)})`);
        await farbig.uncheck();
        await expect(rowsOf(window)).toHaveCount(total);

        // 🔴 „Spoiler“ ist kein Filter: Die Zahl der Zeilen bleibt, die Deckel verschwinden.
        const veils = window.getByTestId("info-spoiler");
        const before = await veils.count();
        expect(before).toBeGreaterThan(0);
        await blatt.getByTestId("catalog-filter-inhalt-spoiler").check();
        await expect(veils).toHaveCount(0);
        await expect(rowsOf(window)).toHaveCount(total);
    });

    test("Gareths Literatur: Art als Chips, Auswahlfelder, Genre am Komma getrennt; Sortierung ordnet um, die Rolle geht nicht ein", async ({
        page,
    }) => {
        const panel = await openPlace(page, GARETH, "literature");
        const window = await openWindow(page, panel, "literature");
        const bar = window.getByTestId("catalog-filters");
        await bar.getByTestId("catalog-filter").click();
        const blatt = window.getByTestId("catalog-filter-blatt");
        // Art als Kästchen, DSA-Version, Schwierigkeit und Genre als Wahl mit „alle“ zuerst, der Zeitraum von–bis.
        expect(await blatt.getByTestId("catalog-filter-type").locator("input[type=checkbox]").count()).toBeGreaterThan(
            1,
        );
        await expect(blatt.getByTestId("catalog-filter-edition")).toBeVisible();
        // Die Wahl „Genre“ bietet EIN Schlagwort an, keine Aufzählung mit Kommas.
        const genre = blatt.getByTestId("catalog-filter-genre");
        const options = (await genre.locator("label").allInnerTexts()).map((text) => text.trim());
        expect(options[0]).toBe("alle");
        expect(options.length).toBeGreaterThan(2);
        for (const option of options) expect(option).not.toContain(",");

        const total = await rowsOf(window).count();
        await genre.locator("input[type=radio]").nth(1).check();
        const filtered = await rowsOf(window).count();
        expect(filtered).toBeGreaterThan(0);
        expect(filtered).toBeLessThan(total);
        await blatt.getByTestId("catalog-filter-genre-alle").check();
        await expect(rowsOf(window)).toHaveCount(total);
        await page.keyboard.press("Escape");

        const titles = async (): Promise<string[]> =>
            (await rowsOf(window).getByTestId("catalog-row-title").allInnerTexts()).map((text) => text.trim());
        const newest = await titles();
        await bar.getByTestId("catalog-sort").click();
        await page.getByTestId("catalog-sort-menue").getByRole("menuitemradio", { name: "alphabetisch" }).click();
        const alpha = await titles();
        expect(alpha).toHaveLength(total);
        // Der Titel eines verdeckten Werks ist unsichtbar (der Deckel verbirgt ihn): Geordnet werden alle, gezählt werden die offenen.
        const sichtbar = alpha.filter((title) => title !== "");
        expect(sichtbar.length).toBeGreaterThan(10);
        expect(sichtbar).toEqual([...sichtbar].sort((left, right) => left.localeCompare(right, "de")));
        expect(alpha).not.toEqual(newest);
        // Dieselbe Menge, nur anders geordnet.
        expect([...alpha].sort()).toEqual([...newest].sort());
    });

    test("🔴 die Suche links in der Leiste: Titel und Reihe, jedes Wort zählt, Esc leert sie, ohne das Fenster zu schließen", async ({
        page,
    }) => {
        // Betreiber 2026-10-11: „Trichter und Sortierzeichen statt Filterzeilen -> sollten immer rechtsbündig sein. idealerweise ist auch
        // immer eine suchmaske nach freitext links von den beiden“.
        const panel = await openPlace(page, GARETH, "literature");
        const window = await openWindow(page, panel, "literature");
        const leiste = window.getByTestId("catalog-filters");
        const suche = leiste.getByTestId("catalog-filters-suche").locator("input");
        // Links die Suche, rechts der Trichter und das Sortierzeichen.
        const [feld, trichter, sortierung] = await Promise.all(
            [suche, leiste.getByTestId("catalog-filter"), leiste.getByTestId("catalog-sort")].map((locator) =>
                locator.boundingBox(),
            ),
        );
        expect(feld!.x).toBeLessThan(trichter!.x);
        expect(trichter!.x).toBeLessThan(sortierung!.x);

        const total = await rowsOf(window).count();
        const ersterTitel = (await rowsWithoutVeil(window).first().getByTestId("catalog-row-title").innerText()).trim();
        const wort = ersterTitel.split(/s+/).find((teil) => teil.length >= 5) ?? ersterTitel;
        await suche.fill(wort.toUpperCase());
        await expect(rowsOf(window).first()).toBeVisible();
        const gefunden = await rowsOf(window).count();
        expect(gefunden).toBeGreaterThan(0);
        expect(gefunden).toBeLessThan(total);
        await suche.press("Escape");
        await expect(suche).toHaveValue("");
        await expect(rowsOf(window)).toHaveCount(total);
        await expect(window).toBeVisible();
    });

    test("🔴 ein einzelnes Werk braucht weder Filter noch Sortierung (gestellte Antwort: Panel, Modell und Fenster sind die echten)", async ({
        page,
    }) => {
        await page.route("**/api/subjects/place/*/literature*", async (route) => {
            const response = await route.fetch();
            const answer = (await response.json()) as Record<string, unknown>;
            await route.fulfill({
                response,
                json: {
                    ...answer,
                    works: [
                        {
                            id: "80000000-0000-4000-8000-0000000000a1",
                            title: "Das einzige Werk",
                            productType: "gruppenabenteuer",
                            role: "start",
                            edition: "DSA5",
                            links: [{ label: "Wiki Aventurica", url: "https://example.org/w", paid: false }],
                        },
                    ],
                },
            });
        });
        const panel = await openPlace(page, GARETH, "literature");
        const window = await openWindow(page, panel, "literature");
        expect(await rowsOf(window).count()).toBe(1);
        await expect(window.getByTestId("catalog-filters")).toHaveCount(0);
        await expect(window.getByTestId("catalog-sort")).toHaveCount(0);
    });

    test("🔴 die Leiste steht, wenn der Rumpf rollt - nur die Liste scrollt", async ({ page }) => {
        const panel = await openPlace(page, GARETH, "literature");
        const window = await openWindow(page, panel, "literature");
        const bar = window.getByTestId("fenster-leiste");
        const before = await bar.boundingBox();
        const moved = await window.getByTestId("fenster-rumpf").evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            return element.scrollTop;
        });
        expect(moved).toBeGreaterThan(100);
        const after = await bar.boundingBox();
        expect(after?.y).toBe(before?.y);
        await expect(bar).toBeInViewport();
    });
});

test.describe("🔴 jeder externe Link trägt ↗ - aus der Hausregel, nie von Hand", () => {
    for (const section of ["citymaps", "literature"] as const) {
        test(`Fenster ${section}: jeder sichtbare Anker mit Text zeigt den Pfeil, keiner trägt ihn im Text, der Bildlink trägt keinen`, async ({
            page,
        }) => {
            const panel = await openPlace(page, GARETH, section);
            const window = await openWindow(page, panel, section);
            // Zugeklappt stehen die Links neben dem Namen; aufgeklappt im Eintrag. Beides gehört zur Regel.
            const zugeklappt = await externalLinks(window);
            expect(zugeklappt.length).toBeGreaterThan(3);
            const free = rowsWithoutVeil(window);
            await free.nth(1).getByTestId("catalog-row-toggle").click();
            await expect(window.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(1);
            const aufgeklappt = await externalLinks(window);
            expect(aufgeklappt.length).toBeGreaterThan(0);
            for (const link of [...zugeklappt, ...aufgeklappt]) {
                expect(link.href, link.text).toMatch(/^https?:\/\/|^\/media\//);
                // Jeder Link nach draußen trägt `noopener noreferrer`: Das Ziel erfährt weder das Fenster noch die Herkunft.
                expect(link.rel, link.text).toContain("noopener");
                expect(link.typed, `von Hand getippt: ${link.text}`).toBe(false);
                if (link.text !== "") expect(link.arrow, `ohne ↗: ${link.text}`).toBe(true);
                else expect(link.arrow, `Bildlink mit ↗: ${link.href}`).toBe(false);
            }
        });
    }

    test("🔴 „(kostenpflichtig)“ steht nur bei einem bekannten Ja: Läden zahlen, Wiki und Nationalbibliothek nicht", async ({
        page,
    }) => {
        const panel = await openPlace(page, GARETH, "literature");
        const window = await openWindow(page, panel, "literature");
        const lines = await window.locator(".links__zeile").evaluateAll((items) =>
            items.map((item) => ({
                label: (item.querySelector("a")?.textContent ?? "").trim(),
                paid: item.querySelector('[data-testid="catalog-link-paid"]') !== null,
            })),
        );
        expect(lines.length).toBeGreaterThan(10);
        for (const line of lines) {
            if (/Ulisses eBook|F-Shop/.test(line.label)) expect(line.paid, line.label).toBe(true);
            else expect(line.paid, line.label).toBe(false);
        }
    });
});

test.describe("🔴 Rhôndur zeigt sein Vollbild", () => {
    test("das Vollbild steht groß, ein Klick darauf öffnet die Datei in voller Größe im neuen Tab, und die Zeile darunter trägt ↗", async ({
        page,
        context,
    }) => {
        const panel = await openPlace(page, RHONDUR, "citymaps");
        const window = await openWindow(page, panel, "citymaps");
        await rowsOf(window).first().getByTestId("catalog-row-toggle").click();
        const image = window.getByTestId("catalog-entry-image");
        await expect(image).toBeVisible();
        await expect(image).toHaveAttribute("data-kind", "full");
        await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true);
        const size = await image.evaluate((element) => {
            const picture = element as HTMLImageElement;
            const box = picture.getBoundingClientRect();
            return { w: box.width, nw: picture.naturalWidth, nh: picture.naturalHeight };
        });
        expect(size.nw).toBe(1240);
        expect(size.nh).toBe(896);
        // Groß: viel mehr als die Vorschau (400 px) - und nie über die 1240 px der Datei hinaus.
        expect(size.w).toBeGreaterThan(500);
        expect(size.w).toBeLessThanOrEqual(1241);

        const caption = window.getByTestId("catalog-entry-full-link");
        await expect(caption).toHaveText("Vollbild öffnen");
        await expect(caption).toHaveAttribute("target", "_blank");
        expect(await caption.evaluate((element) => getComputedStyle(element, "::after").content)).toContain("↗");
        await expect(window.locator(".eintrag__masse")).toHaveText("(1.240 × 896 px)");

        const imageLink = window.getByTestId("catalog-entry-image-link");
        const href = (await imageLink.getAttribute("href")) ?? "";
        expect(href).toMatch(/^\/media\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/);
        expect(await caption.getAttribute("href")).toBe(href);
        // Der Bildlink hat keinen Text und deshalb keinen Pfeil; die Unterschrift trägt ihn.
        expect(await imageLink.evaluate((element) => getComputedStyle(element, "::after").content)).not.toContain("↗");
        const [popup] = await Promise.all([context.waitForEvent("page"), imageLink.click()]);
        await popup.waitForLoadState("domcontentloaded");
        expect(new URL(popup.url()).pathname).toBe(href);
        await popup.close();
    });

    test("🔴 mehrere Versionen (WI-0287 Stufe 2): Reiter mit Bezeichnung, die Kopfzeile nennt die Zahl, eine Version ohne öffentliches Vollbild zeigt die Vorschau (gestellte Antwort: Panel, Modell und Fenster sind die echten)", async ({
        page,
    }) => {
        // Eine Karte mit zwei Versionen: die erste mit Vollbild, die zweite ohne öffentliches. Gestellt ganz, damit der Fall nicht vom Stand der Entwicklungsdatenbank
        // abhängt (die Spalten der Versionen kommen mit Migration 0321); Subjekt und Revision kommen von der Literatur desselben Ortes.
        const bild = (role: string, farbe: string) => ({
            id: "80000000-0000-4000-8000-0000000002a1",
            role,
            url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${farbe}"/></svg>`)}`,
            width: 800,
            height: 600,
            mimeType: "image/svg+xml",
        });
        await page.route("**/api/subjects/place/*/citymaps*", async (route) => {
            const literatur = await route.fetch({ url: route.request().url().replace("/citymaps", "/literature") });
            const { subject, revision } = (await literatur.json()) as { subject: unknown; revision: number };
            const full = bild("map_full", "#8a6");
            await route.fulfill({
                json: {
                    subject,
                    revision,
                    maps: [
                        {
                            id: "80000000-0000-4000-8000-0000000002a0",
                            title: "Karte von Rhôndur",
                            preview: bild("map_preview", "#68a"),
                            full,
                            fulls: [{ label: "Für Spieler", view: full }, { label: "SL-Version" }],
                        },
                    ],
                },
            });
        });
        const panel = await openPlace(page, RHONDUR, "citymaps");
        const window = await openWindow(page, panel, "citymaps");
        await rowsOf(window).first().getByTestId("catalog-row-toggle").click();
        await expect(window.getByTestId("catalog-row-versions")).toHaveText("2 Versionen");
        const reiter = window.getByRole("tab");
        await expect(reiter).toHaveText(["Für Spieler", "SL-Version"]);
        await expect(reiter.first()).toHaveAttribute("aria-selected", "true");
        const image = window.getByTestId("catalog-entry-image");
        await expect(image).toHaveAttribute("data-kind", "full");

        await reiter.nth(1).click();
        await expect(reiter.nth(1)).toHaveAttribute("aria-selected", "true");
        await expect(image).toHaveAttribute("data-kind", "preview");
        await expect(window.getByTestId("catalog-entry-full-link")).toHaveCount(0);
        await expect(window.getByRole("tabpanel")).toBeVisible();
    });

    test("die Vorschau-Kachel im Panel öffnet das Fenster beim Vollbild - ohne Umweg", async ({ page }) => {
        const panel = await openPlace(page, RHONDUR, "citymaps");
        await panel.getByTestId("info-citymaps-link").first().click();
        const window = windowOf(page, "citymaps");
        const open = window.locator('[data-testid="catalog-row"][data-open]');
        await expect(open).toHaveCount(1);
        await expect(open.getByTestId("catalog-entry-image")).toHaveAttribute("data-kind", "full");
    });
});

test.describe("Englisch, Dunkel und der Rest der Hülle", () => {
    test("Englisch: Legacys Wortlaut („Show all“, „Map collection of“, „Suggest a map“)", async ({ page }) => {
        await page.goto("/?lang=en");
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 30_000,
        });
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
        const panel = page.locator('[data-section="citymaps"]');
        await panel.getByTestId("info-action-citymapsAll").waitFor({ timeout: 30_000 });
        await expect(panel.getByTestId("info-action-citymapsAll")).toHaveText("Show all");
        await expect(panel.getByTestId("info-action-citymapsSuggest")).toHaveText("Suggest a map");
        await panel.getByTestId("info-action-citymapsAll").click();
        const window = windowOf(page, "citymaps");
        await expect(page.getByRole("dialog", { name: "Map collection of Gareth" })).toBeVisible();
        await expect(window.getByTestId("catalog-foot-hint")).toHaveText(
            "Maps are external content. Preview only with a free licence or permission.",
        );
        await window.getByTestId("catalog-filter").click();
        await expect(window.getByTestId("catalog-filter-blatt").getByText("colour", { exact: true })).toBeVisible();
    });

    test("🔴 die Urheberzeile steht im Fuß, wo Bilder stehen - nur der Satz, kein Link (Betreiber 2026-10-09)", async ({
        page,
    }) => {
        for (const section of ["citymaps", "literature"] as const) {
            const panel = await openPlace(page, GARETH, section);
            const window = await openWindow(page, panel, section);
            const line = window.getByTestId("info-catalog-credit");
            await expect(line).toHaveText("Bilder © Ulisses Spiele bzw. der jeweiligen Rechteinhaber");
            await expect(line.locator("a")).toHaveCount(0);
            // Sie steht im Fuß des Fensters, nicht im Rumpf.
            await expect(window.locator("footer").getByTestId("info-catalog-credit")).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(window).toBeHidden();
        }
    });

    test("Dunkel: das Fenster kippt mit dem Thema, der Schleier nicht", async ({ browser, baseURL }) => {
        const context = await browser.newContext({
            baseURL: String(baseURL),
            colorScheme: "dark",
            extraHTTPHeaders: { "x-forwarded-for": "10.77.0.77" },
        });
        const page = await context.newPage();
        const panel = await openPlace(page, GARETH, "literature");
        const window = await openWindow(page, panel, "literature");
        const colours = await window.evaluate((element) => ({
            box: getComputedStyle(element).backgroundColor,
            body: getComputedStyle(document.body).backgroundColor,
        }));
        expect(colours.box).not.toBe("rgb(255, 253, 249)");
        const luminance = (rgb: string): number => {
            const [r = 255, g = 255, b = 255] = (rgb.match(/\d+/g) ?? []).map(Number);
            return (r + g + b) / 3;
        };
        expect(luminance(colours.box)).toBeLessThan(90);
        await context.close();
    });

    test("das Bild, das nicht lädt, fällt aus der Zeile: kein Rahmen, kein Platzhalter (MEDIA-M12)", async ({
        page,
    }) => {
        await page.route("**/media/sha256/**", (route) => route.abort());
        const panel = await openPlace(page, GARETH, "citymaps");
        const window = await openWindow(page, panel, "citymaps");
        await expect.poll(() => window.locator("img.klein").count()).toBe(0);
        await expect(window.getByTestId("catalog-list")).toBeVisible();
        // 🪤 Die Urheberzeile fragt, was die Liste TRÄGT, nicht was der Browser geladen hat: Ein Bild, das nicht lädt, ist ein Unfall und keine Aussage über die Rechte.
        await expect(window.getByTestId("info-catalog-credit")).toBeVisible();
    });
});

test.describe("am Telefon (360 px)", () => {
    test.use({ viewport: { width: 360, height: 760 } });

    for (const section of ["citymaps", "literature"] as const) {
        test(`Fenster ${section}: volle Breite mit 14 px Rand, nichts läuft waagerecht über, die Leiste bricht um`, async ({
            page,
        }) => {
            const panel = await openPlace(page, GARETH, section);
            const window = await openWindow(page, panel, section);
            const free = rowsWithoutVeil(window);
            await free.nth(1).getByTestId("catalog-row-toggle").click();
            await expect(window.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(1);
            await page.waitForTimeout(400);
            const fit = await window.evaluate((dialog) => {
                const box = dialog.getBoundingClientRect();
                const rumpf = dialog.querySelector<HTMLElement>('[data-testid="fenster-rumpf"]');
                const leiste = dialog.querySelector<HTMLElement>('[data-testid="fenster-leiste"]');
                return {
                    left: Math.round(box.left),
                    right: Math.round(globalThis.innerWidth - box.right),
                    pageOverflow: document.documentElement.scrollWidth > globalThis.innerWidth,
                    rumpfOverflow: (rumpf?.scrollWidth ?? 0) > (rumpf?.clientWidth ?? 0) + 1,
                    leisteOverflow: (leiste?.scrollWidth ?? 0) > (leiste?.clientWidth ?? 0) + 1,
                    leisteHeight: Math.round(leiste?.getBoundingClientRect().height ?? 0),
                    viewport: globalThis.innerHeight,
                };
            });
            expect(fit.left).toBeGreaterThanOrEqual(14);
            expect(fit.right).toBeGreaterThanOrEqual(14);
            expect(fit.pageOverflow).toBe(false);
            expect(fit.rumpfOverflow).toBe(false);
            expect(fit.leisteOverflow).toBe(false);
            // Die Leiste verdrängt die Liste nicht: höchstens 40 % der Höhe.
            expect(fit.leisteHeight).toBeLessThanOrEqual(Math.round(fit.viewport * 0.4) + 1);
        });
    }
});
