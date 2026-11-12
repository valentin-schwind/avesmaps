import { expect, test, type Page } from "@playwright/test";
import { lidLines } from "./disclosure-lines.ts";
import { ergaenzeEintrag } from "./eintrag-stub.ts";

/**
 * „Vorkommen unterwegs“ (WI-0257 S4, S5) am echten Stapel: die Klappbox der Routendetails mit allem, was auf der Reise vorkommt, Reiter je Art, Suche, die Liste mit „ab Etappe N“ und der Gegend, die
 * Mehrfachauswahl (färbt die Etappen aller gewählten, alle leuchten zusammen, je in ihrer Farbe; die Kamera fliegt zum hinzugenommenen), der Sammelscreen „Ausgewählte Vorkommen“ im Infopanel und der Abstand der Klappboxen.
 *
 * 🪤 Gelesen wird, was die Oberfläche zeigt UND die KARTE zeichnet (Quelle `such-leuchten`) und die KAMERA tut, nicht nur die Liste. Die Daten sind die der lokalen Datenbank: die Reise Burg Eichstein → Nardesfels-Gegend
 * (`@452.84,590.76~@492.50,564.96`, 13 Etappen, die erste führt querfeldein durch Wald). Dass jeder Eintrag auch im Panel seiner Etappen steht, prüft der Servertest (`vorkommen-panel.test.ts`) in der Welt der Tests.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const REISE = "/?route=@452.84,590.76~@492.50,564.96";

async function openRoute(page: Page): Promise<void> {
    await page.goto(REISE);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await expect(page.getByTestId("route-unterwegs")).toBeVisible({ timeout: 60_000 });
}

/** Klappt die Box auf und wartet, bis ihre Liste da ist. */
async function openBox(page: Page): Promise<void> {
    await page.getByTestId("unterwegs-toggle").click();
    await expect(page.getByTestId("unterwegs-eintrag").first()).toBeVisible();
}

/** Die Reiter der Box, in ihrer Reihenfolge: Art und Zahl. */
async function reiter(page: Page): Promise<{ kind: string; text: string }[]> {
    return page
        .getByTestId("route-unterwegs")
        .getByRole("tab")
        .evaluateAll((els) =>
            els.map((el) => ({
                kind: (el.getAttribute("data-testid") ?? "").replace("unterwegs-reiter-", ""),
                text: (el.textContent ?? "").replace(/\s+/gu, " ").trim(),
            })),
        );
}

/** Die Etappen der Liste, die als Treffer gefärbt sind (ihre Nummern, ab 1), in Reihenfolge. */
async function getroffeneEtappen(page: Page): Promise<number[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[data-testid=route-stage].stage--treffer")].map(
            (row) => Number(row.dataset["stage"]) + 1,
        ),
    );
}

/**
 * Was die Karte leuchten lässt: die Zahl der Merkmale der eigenen Quelle, die ganzen Gegenden über den Filter und die Kamera. Gewählte Vorkommen leuchten seit S5 je in
 * ihrer Farbe (`vorkommen-leuchten`, ganze Gegenden je Stufe `vorkommen-ganz-<n>-fuellung`); gezählt wird auch das Gold der Suche (`such-leuchten`).
 */
async function karte(page: Page): Promise<{ merkmale: number; ganz: number; zoom: number; mitte: [number, number] }> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as import("maplibre-gl").Map;
        const merkmale = ["such-leuchten", "vorkommen-leuchten"].reduce((summe, id) => {
            const quelle = map.getSource(id) as import("maplibre-gl").GeoJSONSource | undefined;
            const daten = quelle?.serialize().data as { features?: unknown[] } | undefined;
            return summe + (daten?.features?.length ?? 0);
        }, 0);
        const ganz = map
            .getLayersOrder()
            .filter((id) => id === "such-leuchten-ganz-fuellung" || /^vorkommen-ganz-\d+-fuellung$/u.test(id))
            .reduce((summe, id) => {
                const filter = map.getFilter(id);
                const dritte = Array.isArray(filter) ? (filter[2] as unknown) : undefined;
                const liste = Array.isArray(dritte) && dritte[0] === "literal" ? dritte[1] : dritte;
                return summe + (Array.isArray(liste) ? liste.length : 0);
            }, 0);
        const mitte = map.getCenter();
        return { merkmale, ganz, zoom: map.getZoom(), mitte: [mitte.lng, mitte.lat] };
    });
}

test("🔴 die Box steht als letzte der Routendetails; der Deckel nennt je Art Zeichen und Zahl, die Wörter der Infobox stehen im title", async ({
    page,
}) => {
    await openRoute(page);
    const boxen = page.getByTestId("route-planning").locator(":scope > details");
    await expect(boxen.last()).toHaveAttribute("data-testid", "route-unterwegs");
    const deckel = page.getByTestId("unterwegs-toggle");
    // Zeichen statt Wörter (Betreiber 2026-10-29, Antwortknopf): hinter dem Titel je Art das Kategoriezeichen der Liste mit der Zahl, in der Reihenfolge der Infobox.
    await expect(deckel).toHaveText(/^Vorkommen unterwegs:\s*\d+\s*\d+\s*\d+\s*\d+$/u);
    const zahlen = page.getByTestId("unterwegs-zahlen");
    const arten = await zahlen
        .locator("[data-kind]")
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset["kind"]));
    expect(arten).toEqual(["ware", "fauna", "flora", "spezies"].filter((kind) => arten.includes(kind)));
    await expect(zahlen.locator(".editor-zeichen")).toHaveCount(arten.length);
    // Die Wörter der Infobox, Einzahl und Mehrzahl richtig: als title der Kurzangabe und als Name des Bildes für den Screenreader.
    const worte = /^\d+ Handelswaren?, \d+ Tierarten?, \d+ Pflanzenarten?, \d+ Spezies$/u;
    await expect(deckel.locator(".disclosure__secondary")).toHaveAttribute("title", worte);
    await expect(zahlen).toHaveAttribute("role", "img");
    await expect(zahlen).toHaveAttribute("aria-label", worte);
    // Nie die Wörter der Gruppen („68 Fauna · 100 Flora“, Betreiber 2026-10-29: „klingt komisch“).
    await expect(deckel.locator(".disclosure__secondary")).not.toHaveAttribute("title", /\d+ (Fauna|Flora|Waren)\b/u);
    // Einzeilig am Rechner, nichts abgeschnitten (die Regel der Deckel).
    const [lid] = await lidLines(deckel);
    expect(lid?.lines, lid?.text).toBe(1);
    expect(lid?.clipped, lid?.text).toBe(false);
    // Der Titel ist hell wie bei den anderen Klappboxen (`--color-text-strong`), die Kurzangabe gedämpft.
    const farben = await page.evaluate(() => {
        const titel = (box: string): string | undefined => {
            const el = document.querySelector<HTMLElement>(`[data-testid="${box}"] summary .avm-text--titel`);
            return el ? getComputedStyle(el).color : undefined;
        };
        return { unterwegs: titel("route-unterwegs"), kosten: titel("planning-costs") };
    });
    expect(farben.unterwegs).toBeDefined();
    expect(farben.unterwegs).toBe(farben.kosten);
});

test("🔴 dieselbe Kopfzeile wie die anderen Klappboxen: gleiche Höhe, gleiche Schrift", async ({ page }) => {
    await openRoute(page);
    const mass = await page.evaluate(() => {
        const kopf = (box: string): { hoehe: number; schrift: string; groesse: string } | undefined => {
            const el = document.querySelector<HTMLElement>(`[data-testid="${box}"] > summary`);
            if (!el) return undefined;
            const stil = getComputedStyle(el);
            return {
                hoehe: Math.round(el.getBoundingClientRect().height),
                schrift: stil.fontFamily,
                groesse: stil.fontSize,
            };
        };
        return { unterwegs: kopf("route-unterwegs"), gebiete: kopf("route-areas") };
    });
    expect(mass.unterwegs?.schrift).toBe(mass.gebiete?.schrift);
    expect(mass.unterwegs?.groesse).toBe(mass.gebiete?.groesse);
    // Einzeilig wie die anderen Deckel: dieselbe Höhe, das Zeichen zieht die Zeile nicht auf.
    expect(mass.unterwegs?.hoehe).toBe(mass.gebiete?.hoehe);
});

test("🔴 mehr Abstand zwischen den kleinen Klappboxen der Routendetails: mindestens 10 px, überall derselbe", async ({
    page,
}) => {
    await openRoute(page);
    const abstaende = await page.evaluate(() => {
        const boxen = [...document.querySelectorAll<HTMLElement>('[data-testid="route-planning"] > details')];
        return boxen.slice(1).map((box, at) => {
            const davor = (boxen[at] as HTMLElement).getBoundingClientRect();
            return Math.round((box.getBoundingClientRect().top - davor.bottom) * 10) / 10;
        });
    });
    expect(abstaende.length).toBeGreaterThanOrEqual(2);
    for (const abstand of abstaende) expect(abstand).toBeGreaterThanOrEqual(10);
    expect(new Set(abstaende).size).toBe(1);
});

test("🔴 „Gegenden“ statt „Flächen“: der Deckel der Landschaften und Gebiete nennt kein Wort „Fläche“", async ({
    page,
}) => {
    await openRoute(page);
    const deckel = page.getByTestId("areas-toggle");
    await expect(deckel).toHaveText(/^\d+ (?:Gegend|Gegenden) und \d+ (?:politisches Gebiet|politische Gebiete)$/u);
    await expect(deckel).not.toContainText(/Fläche/u);
});

test("🔴 aufgeklappt: Reiter je Art mit Zeichen, Wort und Zahl; die Zeilen mit Kreis, „ab Etappe N“ und der Gegend - nie ein automatischer Name", async ({
    page,
}) => {
    await openRoute(page);
    await openBox(page);
    // Die Reihenfolge der Infobox (Waren, Fauna, Flora, Spezies); eine Art ohne Eintrag hat keinen Reiter.
    const liste = await reiter(page);
    const arten = liste.map((eintrag) => eintrag.kind);
    expect(arten).toEqual(["ware", "fauna", "flora", "spezies"].filter((kind) => arten.includes(kind)));
    expect(arten.length).toBeGreaterThanOrEqual(3);
    const wort: Record<string, RegExp> = {
        ware: /^Waren \d+$/u,
        fauna: /^Fauna \d+$/u,
        flora: /^Flora \d+$/u,
        spezies: /^Spezies \d+$/u,
    };
    for (const { kind, text } of liste) expect(text, kind).toMatch(wort[kind] as RegExp);
    await expect(page.getByTestId("route-unterwegs").getByRole("tab").locator(".editor-zeichen")).toHaveCount(
        arten.length,
    );
    // Sichtbar steht das Wort nur am offenen Reiter, die übrigen zeigen Zeichen und Zahl (Vali 2026-10-31); im Namen des Reiters bleibt es.
    const woerter = page.getByTestId("route-unterwegs").getByTestId("unterwegs-reiter-wort");
    const breiten = await woerter.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(breiten.filter((breite) => breite > 2)).toHaveLength(1);
    await expect(
        page.getByTestId("route-unterwegs").getByRole("tab", { selected: true }).getByTestId("unterwegs-reiter-wort"),
    ).not.toHaveClass(/is-verdeckt/u);
    // Die Zahl im Reiter ist die Zahl im Deckel.
    const deckel = await page
        .getByTestId("unterwegs-zahlen")
        .locator("[data-kind]")
        .evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
    expect(liste.map((eintrag) => eintrag.text.replace(/\D+/gu, ""))).toEqual(deckel);
    // Die kleine Leiste rollt nicht.
    const rollt = await page
        .getByTestId("route-unterwegs")
        .locator(".fenster-reiter__rolle")
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(rollt).toBe(false);
    const zeilen = page.getByTestId("unterwegs-eintrag");
    const zahl = await zeilen.count();
    expect(zahl).toBeGreaterThan(0);
    for (let at = 0; at < Math.min(zahl, 12); at += 1) {
        const zeile = zeilen.nth(at);
        await expect(zeile.getByTestId("unterwegs-kreis")).toHaveAttribute("aria-pressed", "false");
        await expect(zeile).toContainText(/ab Etappe \d+/u);
        const gegend = zeile.getByTestId("unterwegs-gegend");
        if ((await gegend.count()) > 0)
            await expect(gegend).not.toHaveText(/(?:Wald|Fläche|See|Berg|Wüste|Sumpf)-\d+$/u);
    }
    // Keine stille Kappung: Ein Reiter mit mehr als zwölf zeigt „… und N weitere“, und ein Klick bringt alle, so viele, wie der Reiter nennt.
    const lang = liste.find((eintrag) => Number(eintrag.text.replace(/\D+/gu, "")) > 12);
    if (lang !== undefined) {
        await page.getByTestId(`unterwegs-reiter-${lang.kind}`).click();
        const mehr = page.getByTestId("unterwegs-mehr");
        await expect(mehr).toHaveText(/^… und \d+ weitere$/u);
        await expect(zeilen).toHaveCount(12);
        await mehr.click();
        await expect(zeilen).toHaveCount(Number(lang.text.replace(/\D+/gu, "")));
        await expect(mehr).toHaveText("weniger zeigen");
    }
});

test("🔴 ein Klick auf ein Zeichen im Deckel öffnet die Box auf dem Reiter dieser Art", async ({ page }) => {
    await openRoute(page);
    const zeichen = page.getByTestId("unterwegs-deckel-art");
    const letztes = zeichen.last();
    const kind = await letztes.getAttribute("data-kind");
    await letztes.click();
    await expect(page.getByTestId("unterwegs-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId(`unterwegs-reiter-${String(kind)}`)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("unterwegs-eintrag").first()).toHaveAttribute("data-kind", String(kind));
});

test("🔴 die Suche sucht im aktiven Reiter in Name und Gegend, die Trefferzahl steht im Reiter, Esc leert", async ({
    page,
}) => {
    await openRoute(page);
    await openBox(page);
    const feld = page.getByTestId("unterwegs-suche").locator("input");
    await expect(feld).toHaveAttribute("placeholder", /auf der Route suchen$|^Suchen …$/u);
    const zeilen = page.getByTestId("unterwegs-eintrag");
    const vorher = await zeilen.count();
    const name = ((await zeilen.first().getByTestId("unterwegs-name").textContent()) ?? "").trim();
    await feld.fill(name);
    await expect(zeilen.first().getByTestId("unterwegs-name")).toHaveText(name);
    const treffer = await zeilen.count();
    expect(treffer).toBeLessThanOrEqual(vorher);
    const aktiv = page.getByTestId("route-unterwegs").getByRole("tab", { selected: true });
    await expect(aktiv.getByTestId("unterwegs-reiter-zahl")).toHaveText(String(treffer));
    await feld.fill("zzqxj");
    await expect(page.getByTestId("unterwegs-leer")).toBeVisible();
    await expect(aktiv.getByTestId("unterwegs-reiter-zahl")).toHaveText("0");
    await feld.press("Escape");
    await expect(feld).toHaveValue("");
    await expect(zeilen).toHaveCount(vorher);
});

test("🔴 Etappe 1 (querfeldein durch Wald) ist nicht leer: Einträge „ab Etappe 1“", async ({ page }) => {
    await openRoute(page);
    await openBox(page);
    let gefunden = 0;
    for (const { kind } of await reiter(page)) {
        await page.getByTestId(`unterwegs-reiter-${kind}`).click();
        gefunden += await page
            .getByTestId("unterwegs-eintrag")
            .filter({ hasText: /ab Etappe 1(?!\d)/u })
            .count();
    }
    expect(gefunden).toBeGreaterThan(0);
});

test("🔴 der Kreis wählt: die Etappen färben sich, der Eintrag leuchtet, das Kästchen nennt die Etappen - die Kamera fliegt hin", async ({
    page,
}) => {
    await openRoute(page);
    await openBox(page);
    const eintrag = page.getByTestId("unterwegs-eintrag").first();
    const id = await eintrag.getAttribute("data-eintrag");
    expect(id).toBeTruthy();
    const kameraVorher = await karte(page);
    expect(kameraVorher.merkmale + kameraVorher.ganz).toBe(0);
    const frage = page.waitForResponse((antwort) =>
        antwort.url().includes(`/api/search/leuchten?eintrag=${String(id)}`),
    );
    await eintrag.getByTestId("unterwegs-kreis").click();
    expect((await frage).ok()).toBe(true);
    await expect(eintrag.getByTestId("unterwegs-kreis")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("unterwegs-kaestchen")).toHaveCount(1);
    await expect(page.getByTestId("unterwegs-kaestchen")).toContainText(/Etappen? \d/u);
    await expect.poll(async () => (await getroffeneEtappen(page)).length).toBeGreaterThan(0);
    // Die gefärbten Etappen tragen nur die Fläche, keinen farbigen Randbalken (Hausregel): kein Schatten an Zeile und Gruppenkopf.
    const schatten = await page.evaluate(() =>
        [
            ...document.querySelectorAll<HTMLElement>(
                "[data-testid=route-stage].stage--treffer, .group--treffer > .group__head",
            ),
        ].map((el) => getComputedStyle(el).boxShadow),
    );
    expect(schatten.length).toBeGreaterThan(0);
    for (const wert of schatten) expect(wert).toBe("none");
    const getroffen = await getroffeneEtappen(page);
    const gezeigt = await page.getByTestId("unterwegs-kaestchen").innerText();
    for (const nummer of getroffen) expect(gezeigt).toContain(String(nummer));
    await expect
        .poll(async () => (await karte(page)).merkmale + (await karte(page)).ganz, { timeout: 20_000 })
        .toBeGreaterThan(0);
    // Hinzunehmen fliegt zum Eintrag (Vali 2026-10-30: „doch ein klick auf die auswahl bei den vorkommen unterwegs kann auch dahinfliegen“).
    await expect
        .poll(
            async () => {
                const nachher = await karte(page);
                return (
                    Math.abs(nachher.zoom - kameraVorher.zoom) > 0.01 ||
                    Math.abs(nachher.mitte[0] - kameraVorher.mitte[0]) > 0.001 ||
                    Math.abs(nachher.mitte[1] - kameraVorher.mitte[1]) > 0.001
                );
            },
            { timeout: 20_000 },
        )
        .toBe(true);
});

test("🔴 Mehrfachauswahl: Kreis und Zeile legen dazu, ein zweiter Klick nimmt heraus, „alle entfernen“ leert - gefärbt sind die Etappen aller", async ({
    page,
}) => {
    await openRoute(page);
    await openBox(page);
    const zeilen = page.getByTestId("unterwegs-eintrag");
    await zeilen.nth(0).getByTestId("unterwegs-kreis").click();
    await expect.poll(async () => (await getroffeneEtappen(page)).length).toBeGreaterThan(0);
    const eine = (await getroffeneEtappen(page)).length;
    // Ein Klick auf die Zeile außerhalb des Namens legt den Eintrag ebenso dazu.
    await zeilen
        .nth(1)
        .getByText(/ab Etappe/u)
        .click();
    await zeilen.nth(2).getByTestId("unterwegs-kreis").click();
    await expect(page.getByTestId("unterwegs-kaestchen")).toHaveCount(3);
    await expect(page.getByTestId("unterwegs-wahl")).toContainText("Ausgewählte Vorkommen (3)");
    await expect(page.getByTestId("unterwegs-kreis").and(page.locator("[aria-pressed=true]"))).toHaveCount(3);
    expect((await getroffeneEtappen(page)).length).toBeGreaterThanOrEqual(eine);
    // Je Eintrag eine Farbe in der Reihenfolge der Wahl, als farbige Plakette vor dem Namen (S5); auf der Karte leuchtet jeder in ihr und trägt seinen Namen.
    const plaetze = (): Promise<(string | null)[]> =>
        page
            .getByTestId("unterwegs-kaestchen")
            .getByTestId("vorkommen-plakette")
            .evaluateAll((punkte) => punkte.map((punkt) => punkt.getAttribute("data-platz")));
    expect(await plaetze()).toEqual(["1", "2", "3"]);
    await expect
        .poll(() => page.evaluate(() => globalThis.avesmapsMap?.getLayer("vorkommen-namen") !== undefined))
        .toBe(true);
    await expect
        .poll(async () => (await karte(page)).merkmale + (await karte(page)).ganz, { timeout: 20_000 })
        .toBeGreaterThan(0);
    // Ein zweiter Klick nimmt einen heraus.
    await zeilen.nth(1).getByTestId("unterwegs-kreis").click();
    await expect(page.getByTestId("unterwegs-kaestchen")).toHaveCount(2);
    await expect(zeilen.nth(1).getByTestId("unterwegs-kreis")).toHaveAttribute("aria-pressed", "false");
    // Die übrigen behalten ihre Farbe.
    expect(await plaetze()).toEqual(["1", "3"]);
    // Der Name eines Kästchens ist ein Link: die Infobox des Eintrags (die Kamera fliegt hin).
    const zweiter = page.getByTestId("unterwegs-kaestchen-name").nth(1);
    const zweiterName = (await zweiter.innerText()).trim();
    await zweiter.click();
    await expect(page.getByTestId("info-title")).toHaveText(zweiterName, { timeout: 30_000 });
    // „alle entfernen“: nichts gefärbt, nichts leuchtet.
    await page.getByTestId("unterwegs-alle-entfernen").click();
    await expect(page.getByTestId("unterwegs-wahl")).toHaveCount(0);
    await expect.poll(async () => (await getroffeneEtappen(page)).length).toBe(0);
    await expect.poll(async () => (await karte(page)).merkmale + (await karte(page)).ganz).toBe(0);
});

test("das ✕ eines Kästchens nimmt den Eintrag aus der Auswahl", async ({ page }) => {
    await openRoute(page);
    await openBox(page);
    await page.getByTestId("unterwegs-kreis").first().click();
    await expect(page.getByTestId("unterwegs-wahl")).toBeVisible();
    await page.getByTestId("unterwegs-beenden").click();
    await expect(page.getByTestId("unterwegs-wahl")).toHaveCount(0);
    await expect.poll(async () => (await getroffeneEtappen(page)).length).toBe(0);
});

test("ein Klick in die freie Karte beendet das Leuchten, und mit ihm die Wahl", async ({ page }) => {
    await openRoute(page);
    await openBox(page);
    await page.getByTestId("unterwegs-kreis").first().click();
    await expect
        .poll(async () => (await karte(page)).merkmale + (await karte(page)).ganz, { timeout: 20_000 })
        .toBeGreaterThan(0);
    // Esc löscht die Auswahl der Karte wie ein Leerklick (`clearPresentation`).
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await karte(page)).merkmale + (await karte(page)).ganz).toBe(0);
    await expect(page.getByTestId("unterwegs-kreis").first()).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await getroffeneEtappen(page)).length).toBe(0);
});

test("🔴 genau eine Frage je Route: die Box fragt nicht je Etappe, und sie fährt mit den Landschaften (WI-0292)", async ({
    page,
}) => {
    // Seit WI-0292 trägt die Frage nach den Landschaften den Körper von Unterwegs mit; `/api/route/unterwegs` fragt der Planer nur noch, wo die Antwort ihn nicht mitbringt.
    const fragen: string[] = [];
    page.on("request", (anfrage) => {
        const url = new URL(anfrage.url()).pathname;
        if (url === "/api/route/unterwegs") fragen.push("einzeln");
        else if (url === "/api/route/landscapes" && (anfrage.postData() ?? "").includes('"unterwegs"'))
            fragen.push("mit den Landschaften");
    });
    await openRoute(page);
    await openBox(page);
    await page.waitForTimeout(500);
    expect(fragen).toEqual(["mit den Landschaften"]);
});

test("🔴 der Name öffnet die Infobox und ändert die Auswahl nicht; ab zwei gewählten zeigt das Panel den Sammelscreen, die Infobox von dort den Rückweg", async ({
    page,
}) => {
    await ergaenzeEintrag(page);
    await openRoute(page);
    await openBox(page);
    await expect(page.getByTestId("info-eintrag")).toHaveCount(0);
    const zeilen = page.getByTestId("unterwegs-eintrag");
    // Der Name: die Infobox, keine Wahl.
    const name = ((await zeilen.nth(1).getByTestId("unterwegs-name").innerText()) ?? "").trim();
    await zeilen.nth(1).getByTestId("unterwegs-name").click();
    await expect(page.getByTestId("info-title")).toHaveText(name, { timeout: 30_000 });
    await expect(page.getByTestId("unterwegs-wahl")).toHaveCount(0);
    // Ein gewählter: seine Infobox, das Leuchten steht und bleibt.
    const erster = ((await zeilen.nth(0).getByTestId("unterwegs-name").innerText()) ?? "").trim();
    await zeilen.nth(0).getByTestId("unterwegs-kreis").click();
    await expect(page.getByTestId("info-title")).toHaveText(erster);
    await expect(page.getByTestId("info-eintrag")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
    await expect
        .poll(async () => (await karte(page)).merkmale + (await karte(page)).ganz, { timeout: 20_000 })
        .toBeGreaterThan(0);
    await expect(page.getByTestId("info-eintrag-zurueck")).toHaveCount(0);
    // Zwei gewählt: der Sammelscreen mit beiden, das Leuchten bleibt.
    await zeilen.nth(2).getByTestId("unterwegs-kreis").click();
    const sammel = page.getByTestId("vorkommen-sammel");
    await expect(sammel).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText("Ausgewählte Vorkommen");
    // Der Kopf nennt die Reise, die Leiste die Zahl (Fassung 2).
    await expect(page.getByTestId("info-subtitle")).toHaveText(/^Unterwegs · .+ bis .+$/u);
    await expect(page.getByTestId("vorkommen-sammel-eintrag")).toHaveCount(2);
    await expect(page.getByTestId("vorkommen-sammel-anzahl")).toHaveText("2 gewählt");
    await expect(page.getByTestId("vorkommen-sammel-lizenz")).toHaveCount(1);
    await expect
        .poll(async () => (await karte(page)).merkmale + (await karte(page)).ganz, { timeout: 20_000 })
        .toBeGreaterThan(0);
    // Aus dem Sammelscreen die Infobox: mit dem Rückweg zwischen Bild und Titel; die Wahl bleibt.
    // Die Zeilen stehen entlang der Route; der Name führt in die Infobox, der Pfeil klappt auf.
    await expect(page.getByTestId("vorkommen-sammel-kurz").first()).toHaveText(/^(ab|nur) Etappe \d+/u);
    await page.getByTestId("vorkommen-sammel-klappe").first().click();
    await expect(page.getByTestId("vorkommen-sammel-mehr")).toHaveCount(1);
    await page.getByTestId("vorkommen-sammel-name").filter({ hasText: erster }).click();
    await expect(page.getByTestId("info-title")).toHaveText(erster);
    await expect(page.getByTestId("info-eintrag-zurueck")).toHaveText(/Ausgewählte Vorkommen \(2\)/u);
    await expect(page.getByTestId("unterwegs-kaestchen")).toHaveCount(2);
    await page.getByTestId("info-eintrag-zurueck").click();
    await expect(sammel).toBeVisible();
    // Das ✕ einer Karte: bleibt einer, zeigt das Panel dessen Infobox.
    await page.getByTestId("vorkommen-sammel-entfernen").first().click();
    await expect(page.getByTestId("vorkommen-sammel")).toHaveCount(0);
    await expect(page.getByTestId("info-eintrag")).toBeVisible();
    await expect(page.getByTestId("unterwegs-kaestchen")).toHaveCount(1);
});
