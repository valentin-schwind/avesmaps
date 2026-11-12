import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Die Fensterhülle am Beispiel „ⓘ Transportmittel“ (WI-0045, Design Guide §12.6).
 *
 * 🪤 Geprüft wird, was der Besucher erlebt: wohin der Fokus geht, was schließt, was rollt, welche
 * Farbe eine Zelle wirklich hat. Die Regel „jedes Fenster ist die Hülle“ hält `test/fenster-huelle.test.ts`.
 */

async function openPlanner(page: Page, search = ""): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-planner-tab")).toHaveAttribute("aria-expanded", "true");
}

async function openInfo(page: Page): Promise<Locator> {
    await page.getByTestId("transport-info-open").click();
    const fenster = page.getByRole("dialog", { name: "Transportmittel" });
    await expect(fenster).toBeVisible();
    return fenster;
}

/**
 * Wie die Karten im Mauerwerk des sichtbaren Reiters liegen (`FensterMauer`, WI-0076, Betreiber 2026-10-04: „boxen in
 * flexiblen höhen“): wie viele Spalten, ob zwischen zwei Karten einer Spalte nur der Takt liegt, wie viele Karten höher
 * sind als ihr Inhalt, und ob alle gleich breit sind - eine über zwei Spalten gebrochene Karte wäre breiter.
 */
function mauerwerk(fenster: Locator): Promise<{
    spalten: number;
    nurTakt: boolean;
    zuHoch: number;
    gleichBreit: boolean;
    hoehen: number;
}> {
    return fenster.evaluate((element) => {
        const mauer = [...element.querySelectorAll<HTMLElement>(".fenster-mauer")].find(
            (m) => m.getClientRects().length > 0,
        )!;
        const takt = Number.parseFloat(getComputedStyle(mauer).columnGap);
        const karten = [...mauer.querySelectorAll<HTMLElement>(":scope > .fenster-karte")].map((karte) => {
            const stil = getComputedStyle(karte);
            const inhalt = Math.max(...[...karte.children].map((kind) => kind.getBoundingClientRect().bottom));
            const rand = Number.parseFloat(stil.paddingBottom) + Number.parseFloat(stil.borderBottomWidth);
            return { lage: karte.getBoundingClientRect(), leer: karte.getBoundingClientRect().bottom - inhalt - rand };
        });
        const spalten = new Map<number, DOMRect[]>();
        for (const { lage } of karten) {
            const links = Math.round(lage.left);
            spalten.set(links, [...(spalten.get(links) ?? []), lage]);
        }
        const luecken = [...spalten.values()].flatMap((spalte) =>
            spalte
                .sort((a, b) => a.top - b.top)
                .slice(1)
                .map((lage, i) => lage.top - spalte[i]!.bottom),
        );
        const breiten = karten.map(({ lage }) => lage.width);
        return {
            spalten: spalten.size,
            nurTakt: luecken.every((luecke) => Math.abs(luecke - takt) <= 1),
            zuHoch: karten.filter(({ leer }) => leer > 1).length,
            gleichBreit: Math.max(...breiten) - Math.min(...breiten) <= 1,
            hoehen: new Set(karten.map(({ lage }) => Math.round(lage.height))).size,
        };
    });
}

/**
 * Wie eine Tafel gezeichnet ist (WI-0076, Betreiber 2026-10-04: „Tabelle B“): Kopfband, die ersten beiden Datenzeilen
 * (Zebra), Achse und Wert. Gruppenzeilen zählen nicht als Datenzeilen.
 */
function tafelBild(tafel: Locator): Promise<Record<string, string>> {
    return tafel.evaluate((table) => {
        const stil = (element: Element | null | undefined): CSSStyleDeclaration | undefined =>
            element ? getComputedStyle(element) : undefined;
        const zeilen = [...table.querySelectorAll("tbody tr")].filter(
            (zeile) => !zeile.querySelector(':scope > th[scope="rowgroup"]'),
        );
        const zelle = zeilen[0]?.querySelector("td");
        const zahl = table.querySelector("tbody .wert__zahl");
        return {
            kopf: stil(table.querySelector("thead th"))?.backgroundColor ?? "",
            kopfSchrift: stil(table.querySelector("thead th"))?.color ?? "",
            achse: stil(zeilen[0]?.querySelector("th"))?.color ?? "",
            zeile1: stil(zelle)?.backgroundColor ?? "",
            zeile2: stil(zeilen[1]?.querySelector("td"))?.backgroundColor ?? "",
            zahl: stil(zahl)?.color ?? "",
            ziffern: stil(zahl)?.fontVariantNumeric ?? "",
            ausrichtung: stil(zelle)?.textAlign ?? "",
        };
    });
}

/** Eine CSS-Variable, wie die Seite sie gerade auflöst - als rgb(), vergleichbar mit getComputedStyle. */
function resolvedColour(page: Page, variable: string): Promise<string> {
    return page.evaluate((name) => {
        const probe = document.createElement("i");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
    }, variable);
}

test("🔴 ⓘ öffnet das Blatt: Titel, Fokus auf ✕, Escape schließt, der Fokus kehrt zum ⓘ zurück", async ({ page }) => {
    await openPlanner(page);
    const fenster = await openInfo(page);
    await expect(fenster).toHaveClass(/avm-fenster--blatt/);
    await expect(fenster.getByTestId("fenster-schliessen")).toBeFocused();
    // Der Klick auf das ⓘ klappt die Gruppe nicht mit (Legacy map-features-planner-groups.js).
    await expect(page.getByTestId("transport-toggle")).toHaveAttribute("aria-expanded", "true");
    // Modal: der Rest der Seite nimmt keinen Fokus an.
    const fremd = await page.evaluate(() => {
        document.querySelector<HTMLElement>('[data-testid="route-add"]')?.focus();
        return document.activeElement?.getAttribute("data-testid");
    });
    expect(fremd).toBe("fenster-schliessen");

    await page.keyboard.press("Escape");
    await expect(fenster).toBeHidden();
    await expect(page.getByTestId("transport-info-open")).toBeFocused();
    // 🪤 Und es geht ein zweites Mal auf - der Zustand ist beim Schließen mitgegangen.
    await page.keyboard.press("Enter");
    await expect(fenster).toBeVisible();
    await fenster.getByTestId("fenster-schliessen").click();
    await expect(fenster).toBeHidden();
    await expect(page.getByTestId("transport-info-open")).toBeFocused();
});

test("🔴 Die Reiter: „Im Gebirge“ zeigt das Kurvenbild, die Tastatur wechselt, jedes Öffnen beginnt bei „Zu Land und Wasser“", async ({
    page,
}) => {
    // WI-0049, Betreiber 2026-09-28: „ein neues tab mit dem steigungsgraph und sehr einfachen erklärungen“.
    await openPlanner(page);
    const fenster = await openInfo(page);
    const land = fenster.getByRole("tab", { name: "Zu Land und Wasser", exact: true });
    const gebirge = fenster.getByRole("tab", { name: "Im Gebirge", exact: true });
    await expect(land).toHaveAttribute("aria-selected", "true");
    await expect(fenster.getByTestId("transport-info-table")).toBeVisible();

    await gebirge.click();
    await expect(gebirge).toHaveAttribute("aria-selected", "true");
    await expect(fenster.getByTestId("transport-info-table")).toHaveCount(0);
    const bild = fenster.getByTestId("transport-info-steigungsbild");
    await expect(bild).toBeVisible();
    await expect(bild.locator("path[data-familie]")).toHaveCount(3);
    await expect(fenster.getByTestId("transport-info-steigungsbeispiel")).toContainText("Zu Fuß doppelt so lang");
    // Das Bild zeichnet in seiner Breite: Es steht nicht über die Karte hinaus.
    const breite = await bild.evaluate((svg) => [svg.getBoundingClientRect().width, svg.parentElement!.clientWidth]);
    expect(breite[0]).toBeLessThanOrEqual(breite[1]! + 0.5);

    // Tastatur nach WAI-ARIA: ← zum Nachbarn, nur der aktive Reiter liegt in der Tab-Reihenfolge.
    await gebirge.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(land).toBeFocused();
    await expect(land).toHaveAttribute("aria-selected", "true");
    await expect(gebirge).toHaveAttribute("tabindex", "-1");

    await gebirge.click();
    await page.keyboard.press("Escape");
    await expect(fenster).toBeHidden();
    await page.getByTestId("transport-info-open").click();
    await expect(land).toHaveAttribute("aria-selected", "true");
});

test("🔴 Reiter „In der Luft“: Im Flug öffnet ⓘ gleich dort, mit Bild, allen Flugmitteln und zehnfacher Höhe über Grund", async ({
    page,
}) => {
    // WI-0051, Betreiber 2026-09-28: „du machst den reiter für flug“.
    await openPlanner(page, "?route=Gareth~Punin&air=griffin");
    const fenster = await openInfo(page);
    const flug = fenster.getByRole("tab", { name: "In der Luft", exact: true });
    await expect(flug).toHaveAttribute("aria-selected", "true");
    const bild = fenster.getByTestId("transport-info-flugbild");
    await expect(bild).toBeVisible();
    await expect(bild.getByTestId("transport-info-flugbahn")).toHaveCount(1);
    const breite = await bild.evaluate((svg) => [svg.getBoundingClientRect().width, svg.parentElement!.clientWidth]);
    expect(breite[0]).toBeLessThanOrEqual(breite[1]! + 0.5);
    const tafel = fenster.getByTestId("transport-info-flugmittel");
    await expect(tafel.locator("tr[data-flugmittel]")).toHaveCount(12);
    await expect(tafel.locator('tr[data-flugmittel="griffin"] td')).toHaveText(["50", "800", "8.000"]);
    await expect(tafel.locator('tr[data-flugmittel="witchFlight"] td')).toHaveText(["40", "100", "1.000"]);
    // Betreiber 2026-10-04: Die dritte Spalte ist die Höhe über Grund, die absolute Grenze steht in den Regeln.
    await expect(tafel.getByRole("columnheader", { name: "Höchstens über Grund" })).toBeVisible();
    await expect(fenster.getByText("Höher als 5.000 Schritt über dem Meer fliegt keines")).toBeVisible();
    // F4 (Betreiber 2026-10-04): Höhe kostet Zeit, die Werte kommen aus dem Reisemodell (50 Schritt Strecke je Schritt
    // Aufstieg, in der größten Höhe 90 Prozent länger je Meile). Seit WI-0076 eine gerahmte Karte mit Aufschrift und
    // Aufzählung; der Wert der Flugmittel heißt „Flughöhe“ (Betreiber 2026-10-04).
    const regel = fenster.getByTestId("transport-info-regel-height");
    await expect(regel).toBeVisible();
    await expect(regel.locator(".fenster-karte__titel")).toHaveText("Höhe kostet Zeit");
    await expect(regel.locator("li")).toHaveCount(3);
    await expect(regel).toContainText("(mindestens 200 Schritt)");
    await expect(regel).toContainText("wie 50 Schritt Strecke");
    await expect(regel).toContainText("bis zu 90 Prozent");
    await expect(regel).toContainText("Darum fliegt es lieber durchs Tal oder an einem Gipfel vorbei als darüber.");
    await expect(regel).toContainText("„+x Std. über üblicher Flughöhe“");
    await expect(tafel.getByRole("columnheader", { name: "Flughöhe" })).toBeVisible();
    // Das Beispiel der Regel „Wie hoch?“ trägt den Namen aus der Tafel (WI-0076).
    await expect(
        fenster.getByText("beim Hexenfluggerät mit 100 Schritt Flughöhe also höchstens 1.000 Schritt"),
    ).toBeVisible();

    // Über Land und Wasser öffnet ⓘ wie bisher bei der Tempotafel.
    await page.keyboard.press("Escape");
    await expect(fenster).toBeHidden();
    await openPlanner(page);
    const land = await openInfo(page);
    await expect(land.getByRole("tab", { name: "Zu Land und Wasser", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
    );
});

test("🔴 Schleier: ein Klick daneben schließt, Markieren über den Rand hinaus nicht", async ({ page }) => {
    await openPlanner(page);
    const fenster = await openInfo(page);
    const box = (await fenster.boundingBox())!;
    const rumpf = (await fenster.getByTestId("fenster-rumpf").boundingBox())!;
    // Druck im Fenster, Loslassen auf dem Schleier: bleibt offen (Legacy, Owner 02.09.2026).
    await page.mouse.move(rumpf.x + 40, rumpf.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + box.height - 10, { steps: 4 });
    await page.mouse.up();
    await expect(fenster).toBeVisible();
    // Druck und Loslassen auf dem Schleier: zu.
    await page.mouse.click(box.x - 60, box.y + box.height - 10);
    await expect(fenster).toBeHidden();
    await expect(page.getByTestId("transport-info-open")).toBeFocused();
});

test("🔴 Kopf steht, nur der Rumpf rollt; die Tafel rollt waagerecht für sich (Guide §12.2, §17.9)", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await openPlanner(page);
    const fenster = await openInfo(page);
    const lage = await fenster.evaluate((element) => {
        const rumpf = element.querySelector<HTMLElement>(".avm-fenster__rumpf")!;
        const kopf = element.querySelector<HTMLElement>(".avm-fenster__kopf")!;
        const vorher = kopf.getBoundingClientRect().top;
        rumpf.scrollTop = rumpf.scrollHeight;
        return {
            rumpfRollt: rumpf.scrollHeight > rumpf.clientHeight,
            huelleRollt: element.scrollHeight > element.clientHeight,
            kopfBleibt: kopf.getBoundingClientRect().top === vorher,
            imBild: element.getBoundingClientRect().bottom <= innerHeight,
        };
    });
    expect(lage).toEqual({ rumpfRollt: true, huelleRollt: false, kopfBleibt: true, imBild: true });
    await expect(fenster.getByText("Geographia Aventurica S. 113–141")).toBeInViewport();
});

test("🔴 Die Tafel zeigt das Tempo, mit dem die Route rechnet, und färbt aus dem Kanon", async ({ page }) => {
    await openPlanner(page);
    const fenster = await openInfo(page);
    const tafel = fenster.getByTestId("transport-info-table");
    // Kopf: Wegtyp + neun Landmittel (WI-0069); Zeilen: Tagesleistung und sieben Wegarten.
    await expect(tafel.locator("thead th")).toHaveCount(10);
    await expect(tafel.locator("tbody tr")).toHaveCount(8);
    await expect(fenster.getByTestId("transport-info-day-miles").locator("td")).toHaveText([
        "30",
        "40",
        "35",
        "50",
        "30",
        "25",
        "30",
        "50",
        "50",
    ]);
    // Die Einleitung rechnet ihr Beispiel aus derselben Tafel (WI-0076): Gruppe zu Fuß 4,12 und 1,5 Meilen/h.
    await expect(
        fenster.getByText(
            "Eine Gruppe zu Fuß schafft auf der Reichsstraße 4,1 Meilen in der Stunde, auf einem Gebirgspass nur 1,5.",
            {
                exact: false,
            },
        ),
    ).toBeVisible();
    const strasse = tafel.locator("tbody tr").nth(2);
    await expect(strasse.locator("th")).toHaveText("Straße");
    // Gruppe zu Fuß auf der Straße: 4,4625 in der Tafel des Modells, ÷ 1,19 = 3,75 Meilen je Stunde (30 Meilen in 8 Stunden).
    await expect(strasse.locator("td").nth(0)).toHaveText("3,75");
    // Die Kutsche fährt nie querfeldein, Karren und Fuhrwerk nie einen Pfad: ein Strich, keine Zahl.
    const querfeldein = tafel.locator("tbody tr").nth(7).locator("td").nth(7);
    await expect(querfeldein).toHaveText("–");
    await expect(querfeldein).toHaveAttribute("data-tier", "nie");
    await expect(tafel.locator("tbody tr").nth(4).locator("td").nth(5)).toHaveText("–");
    // Die Schiffe mit ihren Reisestunden aus dem Modell: die Galeere 8, die Kurierdromone 24 ohne Rast.
    const meer = fenster.getByTestId("transport-info-sea");
    await expect(meer.locator('tr[data-transport="galley"] td').nth(0)).toHaveText("70");
    await expect(meer.locator('tr[data-transport="galley"] td').nth(1)).toHaveText("8");
    await expect(meer.locator('tr[data-transport="courierDromone"] td').nth(1)).toContainText("24");
    await expect(meer.locator('tr[data-transport="courierDromone"] td').nth(1)).toContainText("ohne Rast");
    await expect(fenster.getByTestId("transport-info-river").locator('tr[data-transport="riverGalley"] td')).toHaveText(
        ["75", "12", "6,25", "2,92"],
    );

    const zelle = tafel.locator('td[data-tier="schnell"]').first();
    const farbe = await zelle.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(farbe).toBe(await resolvedColour(page, "--color-tier-fast-bg"));
    expect(farbe).toBe("rgb(210, 229, 173)");
    // Der Schleier und die Hülle aus dem Kanon (§12.1, §12.4).
    const huelle = await fenster.evaluate((element) => ({
        schleier: getComputedStyle(element, "::backdrop").backgroundColor,
        radius: getComputedStyle(element).borderRadius,
        kopfPolster: getComputedStyle(element.querySelector(".avm-fenster__kopf")!).padding,
        rumpfPolster: getComputedStyle(element.querySelector(".avm-fenster__rumpf")!).padding,
        breite: Math.round(element.getBoundingClientRect().width),
    }));
    expect(huelle).toEqual({
        schleier: "rgba(20, 16, 12, 0.56)",
        radius: "10px",
        kopfPolster: "6px 14px",
        rumpfPolster: "8px 14px",
        breite: 940,
    });
});

test("🔴 Telefon: die Landtafel mit neun Mitteln rollt in sich, die Seite nicht, die Wegtypen bleiben stehen (WI-0069)", async ({
    page,
}) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openPlanner(page);
    const fenster = await openInfo(page);
    const lage = await fenster.evaluate((element) => {
        const tafel = element.querySelector<HTMLElement>('[data-testid="transport-info-table"]')!.parentElement!;
        const kopf = element.querySelector<HTMLElement>('[data-testid="transport-info-table"] tbody th')!;
        const vorher = kopf.getBoundingClientRect().left;
        tafel.scrollLeft = tafel.scrollWidth;
        return {
            tafelRollt: tafel.scrollWidth > tafel.clientWidth,
            seiteRollt: document.documentElement.scrollWidth > innerWidth,
            fensterImBild: element.getBoundingClientRect().right <= innerWidth,
            wegtypBleibt: Math.abs(kopf.getBoundingClientRect().left - vorher) < 1,
            meerPasst: (() => {
                const meer = element.querySelector<HTMLElement>('[data-testid="transport-info-sea"]')!.parentElement!;
                return meer.scrollWidth <= meer.clientWidth;
            })(),
        };
    });
    expect(lage).toEqual({
        tafelRollt: true,
        seiteRollt: false,
        fensterImBild: true,
        wegtypBleibt: true,
        meerPasst: true,
    });
});

test("Dunkel: Hülle und Ampel kippen mit, der Schleier bleibt (Guide §23)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPlanner(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const fenster = await openInfo(page);
    const werte = await fenster.evaluate((element) => ({
        flaeche: getComputedStyle(element).backgroundColor,
        schleier: getComputedStyle(element, "::backdrop").backgroundColor,
        schnell: getComputedStyle(element.querySelector('td[data-tier="schnell"]')!).backgroundColor,
    }));
    expect(werte).toEqual({
        flaeche: "rgb(49, 46, 38)",
        schleier: "rgba(20, 16, 12, 0.56)",
        schnell: "rgb(63, 83, 38)",
    });
});

for (const dunkel of [false, true]) {
    test(`🔴 Tafeln im Kopfband (${dunkel ? "dunkel" : "hell"}): Band, Zebra, Achsen gedämpft, Zahlen hell und rechts`, async ({
        page,
    }) => {
        // WI-0076, Betreiber 2026-10-04: „Tabelle B“. Alle Regeln in FensterTafel, die Werte über AvmText/AvmWert.
        if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
        await openPlanner(page);
        if (dunkel) await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        const [band, karte, fenster2, gedaempft, hell, gold, transparent] = [
            await resolvedColour(page, "--color-disclosure-bg"),
            await resolvedColour(page, "--color-panel"),
            await resolvedColour(page, "--color-panel-soft"),
            await resolvedColour(page, "--color-text-muted"),
            await resolvedColour(page, "--color-text-strong"),
            await resolvedColour(page, "--color-accent-strong"),
            "rgba(0, 0, 0, 0)",
        ];
        const auf = (zebra: string) => ({
            kopf: band,
            kopfSchrift: gedaempft,
            achse: gedaempft,
            zeile1: transparent,
            zeile2: zebra,
            zahl: hell,
            ziffern: expect.stringContaining("tabular-nums") as unknown as string,
            ausrichtung: "right",
        });

        const fenster = await openInfo(page);
        // Fluss: eine Liste auf einer Karte; die zweite Zeile liegt auf der anderen Fläche des Fensters.
        expect(await tafelBild(fenster.getByTestId("transport-info-river"))).toEqual(auf(karte));
        // Die Tempotafel: Das Band rahmt beide Achsen, die Ecke ist gedämpft wie jede Achse, die Tagesleistung hell.
        const matrix = await fenster.getByTestId("transport-info-table").evaluate((table) => ({
            ecke: getComputedStyle(table.querySelector("thead th")!).color,
            eckeBand: getComputedStyle(table.querySelector("thead th")!).backgroundColor,
            zeilenkopf: getComputedStyle(table.querySelector("tbody tr:nth-child(2) th")!).backgroundColor,
            tag: getComputedStyle(table.querySelector("tbody tr:first-child .wert__zahl")!).color,
            ampel: getComputedStyle(table.querySelector('td[data-tier="schnell"]')!).color,
            mittig: getComputedStyle(table.querySelector('td[data-tier="schnell"]')!).textAlign,
        }));
        expect(matrix).toEqual({
            ecke: gedaempft,
            eckeBand: band,
            zeilenkopf: band,
            tag: hell,
            ampel: await resolvedColour(page, "--color-tier-fast-text"),
            mittig: "center",
        });

        await fenster.getByRole("tab", { name: "In der Luft", exact: true }).click();
        const flug = fenster.getByTestId("transport-info-flugmittel");
        expect(await tafelBild(flug)).toEqual(auf(karte));
        // Die Gruppe goldbraun; das Zebra zählt in jeder Gruppe neu (Gruppenzeilen zählen nicht).
        const gruppe = await flug.evaluate(
            (table) => getComputedStyle(table.querySelector('th[scope="rowgroup"]')!).color,
        );
        expect(gruppe).toBe(gold);
        await page.keyboard.press("Escape");
        await expect(fenster).toBeHidden();

        // Die Geldtafel: Zahl hell, Münze gedämpft.
        await page.getByTestId("options-info-open").click();
        const optionen = page.getByRole("dialog", { name: "Reiseoptionen" });
        await expect(optionen).toBeVisible();
        const geld = optionen.getByTestId("options-info-lodging");
        expect(await tafelBild(geld)).toEqual(auf(karte));
        expect(
            await geld
                .locator(".wert__einheit")
                .first()
                .evaluate((einheit) => getComputedStyle(einheit).color),
        ).toBe(gedaempft);
        await page.keyboard.press("Escape");
        await expect(optionen).toBeHidden();

        // Die Tasten in „Hinweise“: dieselbe Tafel, direkt auf dem Fenster - das Zebra nimmt dort die Fläche der Karte.
        await page.getByTestId("notes-open").click();
        const hinweise = page.getByRole("dialog", { name: "Hinweise" });
        await expect(hinweise).toBeVisible();
        await hinweise.getByTestId("notes-controls").locator("summary").click();
        const tasten = await tafelBild(hinweise.locator(".bedienung table").first());
        expect(tasten).toMatchObject({ kopf: band, kopfSchrift: gedaempft, achse: gedaempft, zeile2: fenster2 });
    });
}

test("Englisch: dieselbe Hülle, Legacys Wortlaut", async ({ page }) => {
    await openPlanner(page, "?lang=en");
    await page.getByTestId("transport-info-open").click();
    const fenster = page.getByRole("dialog", { name: "Transport" });
    await expect(fenster).toBeVisible();
    await expect(fenster.getByTestId("fenster-schliessen")).toHaveAttribute("aria-label", "Close");
    await expect(fenster.getByText("Overland travel")).toBeVisible();
    await expect(
        fenster.getByTestId("transport-info-table").locator("tbody tr").nth(2).locator("td").nth(0),
    ).toHaveText("3.87");
});

test("Verschieben am Kopf, Doppelklick holt es zurück; am Titel wird nichts markiert", async ({ page }) => {
    await openPlanner(page);
    const fenster = await openInfo(page);
    const vorher = (await fenster.boundingBox())!;
    const titel = (await fenster.locator(".avm-fenster__titel").boundingBox())!;
    await page.mouse.move(titel.x + 200, titel.y + titel.height / 2);
    await page.mouse.down();
    await page.mouse.move(titel.x + 280, titel.y + titel.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    const nachher = (await fenster.boundingBox())!;
    expect(Math.round(nachher.x - vorher.x)).toBe(80);
    expect(Math.round(nachher.y - vorher.y)).toBe(40);
    await expect(fenster).toBeVisible();
    expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");

    await page.mouse.dblclick(titel.x + 280, titel.y + titel.height / 2 + 40);
    const zurueck = (await fenster.boundingBox())!;
    expect(Math.round(zurueck.x)).toBe(Math.round(vorher.x));
    expect(Math.round(zurueck.y)).toBe(Math.round(vorher.y));
});

test("🔴 ⓘ Reiseoptionen (Stufe B): dieselbe Hülle, fünf Karten mit Wirkungsklasse, Zahlen der Route", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlanner(page);
    await page.getByTestId("options-info-open").click();
    const fenster = page.getByRole("dialog", { name: "Reiseoptionen" });
    await expect(fenster).toBeVisible();
    await expect(fenster).toHaveClass(/avm-fenster--blatt/);
    await expect(fenster.getByTestId("fenster-schliessen")).toBeFocused();
    await expect(page.getByTestId("options-toggle")).toHaveAttribute("aria-expanded", "true");

    // Fünf Karten; nur was den Weg ändert, trägt „sucht neu“ - bei uns auch der Reisebeginn (WI-0038 E2).
    const karten = fenster.locator(".fenster-karte");
    await expect(karten).toHaveCount(5);
    const etiketten = await karten.evaluateAll((liste) =>
        liste.map((karte) => [
            karte.querySelector(".fenster-karte__titel > span")?.textContent?.trim(),
            karte.querySelector(".etikett")?.textContent?.trim(),
        ]),
    );
    expect(etiketten).toEqual([
        ["Schnellste · Kürzeste", "sucht neu"],
        ["Umsteigen minimieren", "sucht neu"],
        ["Unterbringung", "kostet"],
        ["Reisestunden pro Tag", "rechnet"],
        ["Reisebeginn", "sucht neu"],
    ]);
    // Das Tempo der Route (÷ Zeitfaktor), nicht Legacys 1,54–3,07.
    await expect(fenster.getByText("Gebirgspass 1,29–2,58 Meilen/h", { exact: false })).toBeVisible();
    // Die Abzüge je Bodenzustand aus der Bodentafel, als Aufzählung (WI-0076), die Kutschfahrt mit ihrem Preis.
    await expect(fenster.getByRole("listitem").filter({ hasText: "leichter Schnee" })).toHaveText(
        "aufgeweichter Boden, Tauboden und leichter Schnee: −0,1",
    );
    await expect(fenster.getByRole("listitem").filter({ hasText: "Tiefschnee und Eis" })).toHaveText(
        "Tiefschnee und Eis: −0,2",
    );
    await expect(fenster.getByText("die Kutschfahrt 4 D je 100 Meilen", { exact: false })).toBeVisible();
    await expect(fenster.getByTestId("options-info-lodging").locator("tbody tr")).toHaveCount(4);
    await expect(fenster.getByTestId("options-info-climate").locator("tbody tr")).toHaveCount(5);

    // Zwei Spalten Mauerwerk am Rechner, und die Geldtafel passt hinein, statt zu rollen. Seit WI-0076 (Absätze und
    // Aufzählungen, Betreiber 2026-10-04: „bisschen wall-of-text“) rollt bei 900 px Höhe der Rumpf, nie die Hülle (§12.2).
    expect((await mauerwerk(fenster)).spalten).toBe(2);
    const lage = await fenster.evaluate((element) => {
        const geld = element.querySelector<HTMLElement>(".fenster-tafel")!;
        const rumpf = element.querySelector<HTMLElement>(".avm-fenster__rumpf")!;
        return {
            geldRollt: geld.scrollWidth > geld.clientWidth,
            huelleRollt: element.scrollHeight > element.clientHeight,
            rumpfWaagerecht: rumpf.scrollWidth > rumpf.clientWidth,
        };
    });
    expect(lage).toEqual({ geldRollt: false, huelleRollt: false, rumpfWaagerecht: false });

    await page.keyboard.press("Escape");
    await expect(fenster).toBeHidden();
    await expect(page.getByTestId("options-info-open")).toBeFocused();
});

test("ⓘ Reiseoptionen: unter zwei Lesespalten eine Spalte, der Rumpf rollt, das Fenster nicht", async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 800 });
    await openPlanner(page);
    await page.getByTestId("options-info-open").click();
    const fenster = page.getByRole("dialog", { name: "Reiseoptionen" });
    await expect(fenster).toBeVisible();
    expect((await mauerwerk(fenster)).spalten).toBe(1);
    const lage = await fenster.evaluate((element) => {
        const rumpf = element.querySelector<HTMLElement>(".avm-fenster__rumpf")!;
        return {
            rumpfRollt: rumpf.scrollHeight > rumpf.clientHeight,
            rumpfWaagerecht: rumpf.scrollWidth > rumpf.clientWidth,
            huelleRollt: element.scrollHeight > element.clientHeight,
        };
    });
    expect(lage).toEqual({ rumpfRollt: true, rumpfWaagerecht: false, huelleRollt: false });
});

test("🔴 Karten wie Mauerwerk: jede so hoch wie ihr Inhalt, keine Leerfläche darunter, in allen Reitern und Reiseoptionen", async ({
    page,
}) => {
    // WI-0076, Betreiber 2026-10-04: „ich meinte eigentlich boxen in flexiblen höhen“. Eine Lösung für beide Fenster.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPlanner(page);
    const fenster = await openInfo(page);
    const erwartet = { spalten: 2, nurTakt: true, zuHoch: 0, gleichBreit: true };
    for (const name of ["Zu Land und Wasser", "Im Gebirge", "In der Luft"]) {
        await fenster.getByRole("tab", { name, exact: true }).click();
        const { hoehen, ...lage } = await mauerwerk(fenster);
        expect(lage, name).toEqual(erwartet);
        // Keine Angleichung: Die Karten sind verschieden hoch.
        expect(hoehen, name).toBeGreaterThan(1);
    }
    await page.keyboard.press("Escape");
    await expect(fenster).toBeHidden();

    await page.getByTestId("options-info-open").click();
    const optionen = page.getByRole("dialog", { name: "Reiseoptionen" });
    await expect(optionen).toBeVisible();
    const { hoehen, ...lage } = await mauerwerk(optionen);
    expect(lage).toEqual(erwartet);
    expect(hoehen).toBeGreaterThan(1);
});

test("Englisch: ⓘ Reiseoptionen, Aufschriften in Legacys Wortlaut", async ({ page }) => {
    await openPlanner(page, "?lang=en");
    await page.getByTestId("options-info-open").click();
    const fenster = page.getByRole("dialog", { name: "Travel options" });
    await expect(fenster).toBeVisible();
    // Genau die Aufschrift der Karte: Seit WI-0076 nennt auch die Einleitung „Minimize transfers“ (im Kasten „Transport“).
    await expect(fenster.getByText("Minimize transfers", { exact: true })).toBeVisible();
    await expect(fenster.locator(".etikett").first()).toHaveText("re-searches");
});

test("🔴 „Hinweise“ (Stufe B): die Hülle in der Breite `lesen`, Logo, zwei Kacheln, Abschnitte zugeklappt", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlanner(page);
    await page.getByTestId("notes-open").click();
    const fenster = page.getByRole("dialog", { name: "Hinweise" });
    await expect(fenster).toBeVisible();
    await expect(fenster).toHaveClass(/avm-fenster--blatt/);
    await expect(fenster.getByTestId("fenster-schliessen")).toBeFocused();
    await expect(fenster.locator(".avm-fenster__zeichen")).toHaveCount(0);
    expect(Math.round((await fenster.boundingBox())!.width)).toBe(860);

    // Das Logo ist geladen und steht in voller Farbe (§13.42).
    const logo = fenster.locator(".wappen__bild");
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((bild: HTMLImageElement) => bild.naturalWidth)).toBeGreaterThan(0);

    // Die Kacheln: Discord beschriftet, drei Kanäle als Zeichen mit Namen, „Neuigkeiten“ gesperrt.
    await expect(fenster.getByRole("link", { name: "Zur Community" })).toHaveAttribute(
        "href",
        "https://discord.gg/BSHEEpn6UX",
    );
    for (const name of ["Instagram", "Facebook", "Mastodon"]) {
        await expect(fenster.getByRole("link", { name, exact: true })).toHaveAttribute("target", "_blank");
    }
    await expect(fenster.getByTestId("notes-channel-mastodon")).toHaveAttribute("rel", /\bme\b/);
    await expect(fenster.getByTestId("notes-news")).toBeEnabled();

    // Zugeklappt ist die Liste das Inhaltsverzeichnis; ein Klick klappt auf, der Text bleibt derselbe.
    //
    // 🪤 Die Zahl ist bewusst genau und wandert mit dem Fenster: Sie hält fest, dass JEDER Abschnitt ein `<details>`
    // ist und keiner als flacher Block daneben rutscht. Sie stand bis 2026-10-06 auf 6 (WI-0045 Stufe B) und war
    // damit ein halbes Jahr lang falsch, weil zwei Entscheidungen Abschnitte hinzugefügt haben, ohne diesen Fall
    // nachzuziehen: WI-0084 („Avespfade bekommt einen eigenen Abschnitt, die Datenquellen kehren zurück") und
    // WI-0085 („Urheberrecht, Technik, Haftung, Datenschutz und Impressum"). Wer einen Abschnitt anlegt, zählt hier neu.
    // Seit 2026-10-13 sind es zehn: "Kartenmaterial" und "Kartenserien" wurden zu "Karten auf Avesmaps" (b4c6499a), und
    // dieser Fall zählte weiter zwölf und griff zu zwei Kennungen, die es nicht mehr gab - rot seit dem Tag.
    // Seit 2026-11-04 elf: die Hinweise als ein Dokument, mit den Häufigen Fragen und den Reisebildern.
    const abschnitte = fenster.locator("details");
    await expect(abschnitte).toHaveCount(11);
    expect(await abschnitte.evaluateAll((liste) => liste.filter((d) => (d as HTMLDetailsElement).open).length)).toBe(0);
    await fenster.getByTestId("notes-maps").locator("summary").click();
    const lizenz = fenster.locator("a[href*='Kartenpaket/Lizenz']").first();
    await expect(lizenz).toBeVisible();
    await expect(lizenz).toHaveText("Lizenzvereinbarung zum Ulisses-Kartenpaket");

    // Nur der Rumpf rollt, auch mit offenen Abschnitten.
    await fenster.getByTestId("notes-privacy").locator("summary").click();
    const lage = await fenster.evaluate((element) => ({
        huelleRollt: element.scrollHeight > element.clientHeight,
        imBild: element.getBoundingClientRect().bottom <= innerHeight,
    }));
    expect(lage).toEqual({ huelleRollt: false, imBild: true });

    await page.keyboard.press("Escape");
    await expect(fenster).toBeHidden();
    await expect(page.getByTestId("notes-open")).toBeFocused();
});

test("„Hinweise“: Abschnittszeile mit Lasur und 120 ms, das Dreieck kippt - ohne Bewegung ohne Übergang", async ({
    page,
}) => {
    await openPlanner(page);
    await page.getByTestId("notes-open").click();
    const kopf = page.getByTestId("notes-project").locator("summary");
    expect(await kopf.evaluate((element) => getComputedStyle(element).transitionDuration)).toContain("0.12s");
    await kopf.hover();
    await expect
        .poll(() => kopf.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(await resolvedColour(page, "--color-hover-wash"));
    await kopf.click();
    await expect
        .poll(() => kopf.evaluate((element) => getComputedStyle(element, "::before").transform))
        .not.toBe("none");

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await kopf.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
    expect(await kopf.evaluate((element) => getComputedStyle(element, "::before").transitionDuration)).toBe("0s");
});

/**
 * WI-0120 A12 (Betreiber 2026-10-09: „ja, ergänzen, 1 wie empfohlen, 2 mit Link“): Der Datenschutz nennt Konten, Protokoll und
 * das Auflösen, und unter den Konten steht der Verweis auf Discords eigene Datenschutzerklärung, gebaut wie jeder Verweis nach
 * draußen im Haus: ↗ aus dem Kanon, neues Fenster, ohne Referrer.
 */
test("🔴 „Hinweise“, Datenschutz: Konten, Protokoll, Auflösen und der Verweis auf Discord mit ↗", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlanner(page);
    await page.getByTestId("notes-open").click();
    const fenster = page.getByRole("dialog", { name: "Hinweise" });
    const datenschutz = fenster.getByTestId("notes-privacy");
    await datenschutz.locator("summary").click();
    for (const marke of ["Konten", "Sitzungen und Protokoll", "Konto auflösen"]) {
        await expect(datenschutz.locator("h4", { hasText: marke }).first()).toBeVisible();
    }
    const discord = datenschutz.locator("a[href='https://discord.com/privacy']").first();
    await expect(discord).toBeVisible();
    await expect(discord).toHaveText("Datenschutzerklärung von Discord");
    await expect(discord).toHaveAttribute("href", "https://discord.com/privacy");
    expect(await discord.evaluate((element) => getComputedStyle(element, "::after").content)).toContain("↗");
    // Dieselben Attribute wie der Verweis auf die Lizenz und jeder andere `FensterVerweis`.
    const anderer = datenschutz.locator("a[href^='https://de.wikipedia.org']").first();
    for (const name of ["target", "rel", "class"]) {
        expect(await discord.getAttribute(name), name).toBe(await anderer.getAttribute(name));
    }
    await expect(discord).toHaveAttribute("target", "_blank");
    await expect(discord).toHaveAttribute("rel", "noopener noreferrer");
});

test("Englisch: „Hinweise“ in Legacys Wortlaut, die Rechtstexte in der englischen Fassung", async ({ page }) => {
    await openPlanner(page, "?lang=en");
    await page.getByTestId("notes-open").click();
    const fenster = page.getByRole("dialog", { name: "Notices" });
    await expect(fenster).toBeVisible();
    await expect(fenster.getByText("Chat and follow")).toBeVisible();
    await expect(fenster.getByText("Non-commercial fan project", { exact: true })).toBeVisible();
    await expect(fenster.getByTestId("notes-translation-note")).toContainText("the German version applies");
});

test("Zustände des ✕ (Guide §30.5): Hover-Lasur, Fokusring, Übergang - und ohne Bewegung keiner", async ({ page }) => {
    await openPlanner(page);
    const fenster = await openInfo(page);
    const knopf = fenster.getByTestId("fenster-schliessen");
    const ruhe = await knopf.evaluate((element) => ({
        flaeche: getComputedStyle(element).backgroundColor,
        uebergang: getComputedStyle(element).transitionDuration,
    }));
    expect(ruhe.flaeche).toBe("rgba(0, 0, 0, 0)");
    expect(ruhe.uebergang).toContain("0.12s");
    // Fokus per Tastatur: der goldene Ring, kein blauer Browserring.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(knopf).toBeFocused();
    // Der Ring kommt mit 120 ms Übergang - gelesen wird der Endzustand, nicht das erste Bild.
    await expect
        .poll(() => knopf.evaluate((element) => getComputedStyle(element).boxShadow))
        .toContain("0px 0px 0px 3px");
    await knopf.hover();
    await expect
        .poll(() => knopf.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(await resolvedColour(page, "--color-hover-wash"));

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await knopf.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
});
