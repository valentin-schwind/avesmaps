import { expect, test, type Page } from "@playwright/test";
import { settleFrame } from "./map-handle.ts";
import { openStagePanel, stageFieldValue } from "./stage-panel.ts";
import { openStageGroups, settleStages, showStages } from "./stage-groups.ts";
import { openPlannerBox } from "./planner-boxes.ts";

/**
 * Die Etappenanzeige des Planers am echten Stack (WI-0079 §9) und das Eiltempo (WI-0078).
 *
 * Geprüft wird, was ein Mensch sieht und tut: die Mediengruppen, die durchgehende Kette, die Stationen der
 * Wegpunkte, das Auf- und Zuklappen, die Auswahl über Liste, Karte und Panelpfeile, die Zustände nach Guide §30.5
 * und die drei Kennzahlen im Panel. Die reine Rechnung prüft `test/stage-list-model.test.ts`.
 *
 * Die Fälle stehen im Satz der Entwicklungsdatenbank: Gareth → Perricum ist eine Landreise, Gareth → Riva führt
 * über Land und Wasser, Gareth → Punin fliegt.
 */

/** Die Klappbox „Transportmittel“ startet zugeklappt; der Haken „Eiltempo“ steht darin (WI-0078 §6a). */
async function openTransportBox(page: Page): Promise<void> {
    await openPlannerBox(page, "transport");
    await expect(page.getByTestId("hurry")).toBeVisible();
}

async function openRoute(page: Page, search: string): Promise<void> {
    await loadRoute(page, search);
    await showStages(page, 20_000);
}

/** Dieselbe Reise, aber OHNE die Gruppen aufzuklappen - für die Fälle, die die Vorgabe selbst prüfen (A9, A11). */
async function loadRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-stages")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("route-station").first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Anfang und Ende der durchgehenden Kette, gemessen an den SICHTBAREN Marken (WI-0079 §1.2): von Markenmitte zu
 * Markenmitte, außer eine Marke nennt einen eigenen Ankerpunkt (`data-chain-anchor`; die Zielnadel nennt ihren Kopf).
 * 🪤 Augenschein genügt hier nicht - geraten wäre sie bei jeder Textlänge woanders.
 */
async function measureChain(page: Page): Promise<{ chains: number; top: number; bottom: number } | null> {
    return page.evaluate(() => {
        const list = document.querySelector<HTMLElement>("[data-testid=route-stages]")!;
        const pieces = [...list.querySelectorAll<HTMLElement>(".stages__chain")];
        if (pieces.length === 0) return null;
        const marks = [...list.querySelectorAll<HTMLElement>(".stages__mark")].filter(
            (mark) => mark.getClientRects().length > 0,
        );
        const at = (mark: HTMLElement): number => {
            const rect = mark.getBoundingClientRect();
            return rect.top + rect.height * Number(mark.dataset["chainAnchor"] ?? "0.5");
        };
        // 🔴 Seit WI-0087 P7 besteht die Kette aus STÜCKEN: gemessen wird vom Anfang des ersten bis zum Ende des
        // letzten. Die Zusicherung ist dieselbe geblieben - von Markenmitte zu Markenmitte.
        const boxen = pieces.map((piece) => piece.getBoundingClientRect());
        const oben = Math.min(...boxen.map((box) => box.top));
        const unten = Math.max(...boxen.map((box) => box.bottom));
        return {
            chains: pieces.length,
            top: oben - at(marks[0]!),
            bottom: unten - at(marks[marks.length - 1]!),
        };
    });
}

test("🔴 die Liste gruppiert nach Medium, die Kette läuft durch, und die Nummern laufen global", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Riva");
    const groups = page.getByTestId("route-stage-group");
    expect(await groups.count()).toBeGreaterThan(0);
    // Eine Gruppe nennt ihr Medium, die Zahl ihrer Etappen, die Distanz und die Reisezeit.
    await expect(groups.first()).toContainText(/Landweg|Flussweg|Seefahrt/);
    await expect(groups.first()).toContainText(/\d+ Etappen?/);

    const numbers = await page
        .getByTestId("route-stage")
        .evaluateAll((rows) => rows.map((row) => row.querySelector(".stage__bead")!.textContent!.trim()));
    expect(numbers).toEqual(numbers.map((_, index) => String(index + 1)));

    const chain = await measureChain(page);
    expect(chain).not.toBeNull();
    expect(chain!.chains, "die Kette besteht aus Stücken - mindestens einem").toBeGreaterThan(0);
    expect(Math.abs(chain!.top)).toBeLessThan(1.5);
    expect(Math.abs(chain!.bottom)).toBeLessThan(1.5);
});

test("Start und Ziel stehen als Stationen in derselben Kette", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Perricum");
    const stations = page.getByTestId("route-station");
    await expect(stations.first()).toContainText("Start");
    await expect(stations.last()).toContainText("Ziel");
    await expect(stations.first().getByTestId("station-name")).toHaveText("Gareth");
    await expect(stations.last().getByTestId("station-name")).toHaveText("Perricum");
});

test("🔴 A11: ein Zwischenziel TEILT die Mediengruppe und bleibt sichtbar, wenn alles zugeklappt ist", async ({
    page,
}) => {
    // Ferdok → Luring → Perricum läuft durchgehend über Land: Luring teilt die Landgruppe in zwei Klappboxen.
    await loadRoute(page, "?route=Ferdok~Luring~Perricum&allowRiver=0&allowSea=0");
    await expect(page.getByTestId("route-stage-group")).toHaveCount(2);
    // 🔴 Keine Gruppe trägt eine Station: Nur so kann keine mit einer Gruppe verschwinden.
    const inGroup = page.getByTestId("route-stage-group").locator("[data-testid=route-station]");
    await expect(inGroup).toHaveCount(0);
    // Zugeklappt (die Vorgabe seit P4) steht das Zwischenziel trotzdem da - der gemeldete Fehler.
    const via = page.getByTestId("route-station").filter({ hasText: "Zwischenziel" });
    await expect(via).toHaveCount(1);
    await expect(via).toBeVisible();
    await expect(via.getByTestId("station-name")).toHaveText("Luring");
    await expect(page.getByTestId("route-stage").first()).toBeHidden();
});

test("🔴 A9: eine frisch geöffnete Reise hat ALLE Mediengruppen zu", async ({ page }) => {
    await loadRoute(page, "?route=Gareth~Perricum");
    const heads = page.locator('[data-testid="route-stage-group"] [aria-expanded]');
    expect(await heads.count()).toBeGreaterThan(0);
    for (const value of await heads.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-expanded")))) {
        expect(value).toBe("false");
    }
    await expect(page.getByTestId("route-stage").first()).toBeHidden();
    // Start und Ziel bleiben sichtbar: Sie stehen auf der obersten Ebene und klappen nicht mit.
    await expect(page.getByTestId("route-station").first()).toBeVisible();
    await expect(page.getByTestId("route-station").last()).toBeVisible();
});

test("🔴 A12: die Kette läuft über die Fuge einer geteilten Gruppe durch, die Zähler stimmen je Box", async ({
    page,
}) => {
    await openRoute(page, "?route=Ferdok~Luring~Perricum&allowRiver=0&allowSea=0");
    const counts = await page
        .getByTestId("route-stage-group")
        .evaluateAll((boxes) => boxes.map((box) => Number(/(\d+)\s+Etappen?/.exec(box.textContent ?? "")?.[1] ?? "0")));
    const rows = await page.getByTestId("route-stage").count();
    expect(counts.length, "die Station hat die Gruppe geteilt").toBe(2);
    expect(
        counts.reduce((sum, value) => sum + value, 0),
        "jede Box zählt ihre eigenen Etappen",
    ).toBe(rows);
    // Die durchgehende Kette, von Markenmitte zu Markenmitte gemessen - über die neue Fuge hinweg.
    const chain = await measureChain(page);
    expect(chain).not.toBeNull();
    expect(chain!.chains, "die Kette besteht aus Stücken - mindestens einem").toBeGreaterThan(0);
    expect(Math.abs(chain!.top)).toBeLessThan(1.5);
    expect(Math.abs(chain!.bottom)).toBeLessThan(1.5);
    // Die Nummern laufen global weiter, nicht je Box neu bei 1.
    const numbers = await page
        .getByTestId("route-stage")
        .evaluateAll((list) => list.map((row) => row.querySelector(".stage__bead")!.textContent!.trim()));
    expect(numbers).toEqual(numbers.map((_, index) => String(index + 1)));
});

test("🔴 A12 zugeklappt: die Kette läuft auch über die zugeklappten Boxen von Station zu Station", async ({ page }) => {
    await loadRoute(page, "?route=Ferdok~Luring~Perricum&allowRiver=0&allowSea=0");
    const chain = await measureChain(page);
    expect(chain).not.toBeNull();
    expect(chain!.chains).toBeGreaterThan(0);
    expect(Math.abs(chain!.top)).toBeLessThan(1.5);
    expect(Math.abs(chain!.bottom)).toBeLessThan(1.5);
});

test("🔴 der Flug ist keine Mediengruppe, sondern eine eigene Liste (§1.4)", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Punin&air=griffin");
    await expect(page.getByTestId("route-flight")).toHaveCount(1);
    await expect(page.getByTestId("route-stage-group")).toHaveCount(0);
    await expect(page.getByTestId("route-flight")).toContainText("Flugreise · Greif");
    await expect(page.getByTestId("route-flight")).toContainText(/\d+ Etappen?/);
});

test("🔴 A10: Gruppen klappen zu und gehen beim Blättern von selbst wieder auf (Betreiber 2026-10-05, F8)", async ({
    page,
}) => {
    await loadRoute(page, "?route=Gareth~Perricum");
    const rows = page.getByTestId("route-stage");
    const firstGroup = rows.first().locator("xpath=ancestor::*[@data-testid='route-stage-group']");
    const nextGroup = rows.nth(1).locator("xpath=ancestor::*[@data-testid='route-stage-group']");
    const firstHead = firstGroup.getByRole("button").first();
    const nextHead = nextGroup.getByRole("button").first();
    await expect(firstHead).toHaveAttribute("aria-expanded", "false");
    await expect(rows.first()).toBeHidden();
    await firstHead.click();
    await expect(firstHead).toHaveAttribute("aria-expanded", "true");
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);
    await openStagePanel(page, 0);
    // openStagePanel öffnet alle Gruppen. Vor dem Blättern alle wieder schließen,
    // damit die ausgewählte Etappe ihre eigene Gruppe nachweislich öffnet.
    for (const group of await page.getByTestId("route-stage-group").all()) {
        const head = group.getByRole("button").first();
        if ((await head.getAttribute("aria-expanded")) === "true") await head.click();
    }
    await expect(nextHead).toHaveAttribute("aria-expanded", "false");
    await expect(rows.nth(1)).toBeHidden();
    await page.getByTestId("info-stage-next").click();
    await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 2 von/);
    await expect(nextHead).toHaveAttribute("aria-expanded", "true");
    await expect(rows.nth(1)).toBeVisible();
    await expect(rows).toHaveCount(count);
});

test("🔴 A1/A4: die Zeile nennt den Wegnamen, und ein Klick darauf öffnet den WEG im Infopanel", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Perricum");
    const named = page.getByTestId("stage-path").first();
    await expect(named).toBeVisible();
    const name = ((await named.textContent()) ?? "").trim();
    expect(name, "ein echter Wegname, nicht die Gattung").not.toBe("");
    await named.click();
    await expect(page.getByTestId("info-title")).toHaveText(name, { timeout: 20_000 });
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.())).toMatchObject({ kind: "path" });
});

test("🔴 A5: ein Klick auf einen Ortsnamen in einer Etappe öffnet das Infopanel - nicht nur die Kamera", async ({
    page,
}) => {
    await openRoute(page, "?route=Gareth~Perricum");
    const link = page.getByTestId("route-stage").first().getByTestId("stage-from");
    const name = ((await link.textContent()) ?? "").trim();
    await link.click();
    await expect(page.getByTestId("info-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("info-title")).toHaveText(name, { timeout: 20_000 });
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.())).toMatchObject({ kind: "place" });
});

test("🔴 A6: ein Etappenende ohne Ort ist kein Knopf - nichts, was ins Leere klickt", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Riva");
    const ends = page.getByTestId("stage-to");
    expect(await ends.count()).toBeGreaterThan(0);
    const kinds = await ends.evaluateAll((list) => list.map((node) => node.tagName.toLowerCase()));
    // Jedes Ende ist entweder ein Knopf (mit Gegenstand) oder schlichter Text - nie ein Knopf ohne Wirkung.
    for (const kind of kinds) expect(["button", "span"]).toContain(kind);
});

test("🔴 A7: ein Wegpunkt nennt Ortsklasse und Gebiet in einer zweiten, gedämpften Zeile", async ({ page }) => {
    await loadRoute(page, "?route=Gareth~Perricum");
    const detail = page.getByTestId("route-station").first().getByTestId("station-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Metropole");
    // Das Gebiet ist ein Objektlink, wie jede Nennung eines Kartenobjekts.
    const territory = detail.getByTestId("station-territory");
    const name = ((await territory.textContent()) ?? "").trim();
    expect(name).not.toBe("");
    await territory.click();
    await expect(page.getByTestId("info-title")).toHaveText(name, { timeout: 20_000 });
    expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.())).toMatchObject({ kind: "territory" });
});

test("Tastatur: die Zeile ist ein Knopf mit Fokusring, Enter und Leertaste wählen", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Perricum");
    const second = page.getByTestId("route-stage").nth(1);
    // 🪤 `:focus-visible` folgt der zuletzt benutzten Eingabeart: Seit die Gruppen zum Aufklappen GEKLICKT werden
    // (P4), gilt der Zeiger als zuletzt benutzt, und ein gesetzter Fokus bekäme keinen Ring. Ein Tastendruck stellt
    // die Lage her, in der ein Mensch hier überhaupt ankommt - mit der Tastatur.
    await page.keyboard.press("Tab");
    await second.focus();
    const ring = await second.evaluate((element) => {
        element.classList.add("focus-probe");
        return getComputedStyle(element).boxShadow;
    });
    expect(ring).not.toBe("none");
    await second.press("Enter");
    await expect(second).toHaveClass(/is-active/);
    await expect(page.getByTestId("info-title")).toHaveText(/^Etappe 2 von/);
});

test("🔴 die Zeile hat keine eigene Kante: Hover und Auswahl färben nur die Fläche (Guide §30.1)", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Perricum");
    const first = page.getByTestId("route-stage").first();
    const kante = await first.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
    });
    expect(kante).toEqual(["0px", "0px", "0px", "0px"]);
    const ruhe = await first.evaluate((element) => getComputedStyle(element).backgroundColor);
    // 🪤 Gezeigt wird auf das BILD der Zeile: Seit WI-0087 P1 ist auch der Wegname in Zeile 2 ein Link, und die Mitte
    // der Zeile liegt über ihm - dort träfe der Klick den Weg, und die Zeile tritt ausdrücklich zurück.
    await first.locator("img").first().hover();
    await expect.poll(() => first.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(ruhe);
    // Steht der Zeiger auf einem Ortsnamen, träfe der Klick den ORT - dann tritt die Zeile zurück.
    await first.getByTestId("stage-from").hover();
    await expect.poll(() => first.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(ruhe);
});

test("🔴 das Infopanel der Etappe trägt die drei Kennzahlen und die heutigen Detailzeilen (§3)", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Perricum");
    await openStagePanel(page, 0);
    const figures = page.getByTestId("stage-figures");
    await expect(figures).toBeVisible();
    await expect(page.getByTestId("stage-figure-distance")).toContainText("Meilen");
    await expect(page.getByTestId("stage-figure-travel")).toContainText("Reisezeit");
    // Kein „Details anzeigen“-Knopf: Wegart und Wege stehen direkt darunter.
    await expect(stageFieldValue(page, "type")).toContainText(/\S/);
    // Die Zahl ist hell, die Einheit gedämpft (Klappbox-Regel, Guide §16.3).
    const töne = await page.getByTestId("stage-figure-travel").evaluate((element) => ({
        zahl: getComputedStyle(element.querySelector(".wert__zahl")!).color,
        einheit: getComputedStyle(element.querySelector(".wert__einheit")!).color,
    }));
    expect(töne.zahl).not.toBe(töne.einheit);
});

test("Eiltempo (WI-0078): der Haken verkürzt die Zeit, ohne die Route zu ändern", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Perricum");
    const zeiten = async (): Promise<string> => (await page.getByTestId("route-figures").innerText()).trim();
    /**
     * Ein Fingerabdruck der gezeichneten Reiselinie: Eiltempo darf sie nicht um ein Pixel verschieben.
     *
     * 🪤 `querySourceFeatures` liefert die Formen der GELADENEN Kacheln - dieselbe Linie steht je Kachel einmal da,
     * und wie viele Kacheln geladen sind, hängt am Bild. Gemessen wird deshalb die MENGE der Formen, sortiert und
     * ohne Wiederholung, und erst, wenn die Karte fertig gezeichnet hat.
     */
    const linie = async (): Promise<string> => {
        await settleFrame(page);
        return page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as {
                querySourceFeatures(source: string): { geometry: unknown }[];
            };
            const formen = map.querySourceFeatures("route").map((feature) => JSON.stringify(feature.geometry));
            return [...new Set(formen)].sort().join("\n");
        });
    };
    const vorher = await zeiten();
    const linieVorher = await linie();
    await openTransportBox(page);
    const haken = page.getByTestId("hurry");
    await haken.check();
    await expect.poll(() => new URL(page.url()).search).toContain("hurry=1");
    await expect.poll(zeiten, { timeout: 20_000 }).not.toBe(vorher);
    expect(await linie(), "die Linie der Reise bleibt dieselbe").toBe(linieVorher);
    // Die Einstellungszeile unter dem Titel nennt es, und betroffene Etappen tragen ihr Etikett.
    await expect(page.getByTestId("route-settings")).toContainText("Eiltempo");
    expect(await page.getByTestId("stage-hurry").count()).toBeGreaterThan(0);
    // 🔴 Der Deckel nennt nur das Ergebnis (Betreiber 2026-10-05), die Rechnung steht im Aufgeklappten.
    const deckel = page.getByTestId("planning-hurry");
    await expect(deckel).toBeVisible();
    await expect(deckel.getByTestId("hurry-toggle")).toHaveText(/^[\d.,]+ (?:Std\.|Tage) Zeitersparnis im Eiltempo$/);
    await page.getByTestId("hurry-toggle").click();
    // 🔴 Seit WI-0087 P11 steht die Rechnung als Tabelle: links die Benennung, rechts der Wert.
    const benennungen = await deckel.getByTestId("route-hurry-line").allInnerTexts();
    const werte = await deckel.getByTestId("route-hurry-value").allInnerTexts();
    expect(benennungen[0], benennungen.join(" | ")).toBe("Geeignet");
    expect(werte[0], werte.join(" | ")).toMatch(/^[\d.,]+ von [\d.,]+ Meilen$/);
    expect(benennungen[1]).toBe("Im Eiltempo gereist");
    expect(werte[1]).toMatch(/^[\d.,]+ von [\d.,]+ Reisetagen$/);
    expect(benennungen.at(-1)).toBe("Daraus die Ersparnis");
    expect(werte.at(-1)).toMatch(/[\d.,]+/);
    // Die Zahl ist hervorgehoben, das Wort nicht - das Rezept der Klappbox, nie eine eigene Farbe.
    expect(await deckel.locator('[data-testid="route-hurry-value"] .wert__zahl').count()).toBeGreaterThan(0);
    await haken.uncheck();
    await expect.poll(zeiten, { timeout: 20_000 }).toBe(vorher);
    await expect(page.getByTestId("stage-hurry")).toHaveCount(0);
});

test("🔴 im Flug gibt es kein Eiltempo - der Haken verschwindet mit dem ganzen Block (§3 Regel 7)", async ({
    page,
}) => {
    await openRoute(page, "?route=Gareth~Punin&air=griffin&hurry=1");
    await openPlannerBox(page, "transport");
    await expect(page.getByTestId("hurry")).toHaveCount(0);
    await expect(page.getByTestId("route-settings")).not.toContainText("Eiltempo");
    await expect(page.getByTestId("planning-hurry")).toHaveCount(0);
});

test("🔴 P7: die Etappennummer hat keinen Grund und keinen Rand - hell wie dunkel", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await openRoute(page, "?route=Ferdok~Luring~Perricum&allowRiver=0&allowSea=0");
        await page.getByTestId("route-stage").nth(10).locator("img").first().click();
        await expect(page.getByTestId("route-stage").nth(10)).toHaveClass(/is-active/);
        // 🪤 Die Ziffer wechselt ihre Farbe über 120 ms. Wer sofort misst, liest einen Zwischenwert - einmal gesehen.
        await settleStages(page);
        // 🔴 Gemessen am GEZEICHNETEN Bild, nicht nur am Stilwert: Eine zurückgekehrte Scheibe fiele sonst nicht auf.
        const beads = await page.evaluate(() => {
            const leer = (value: string): boolean =>
                value === "" ||
                value === "none" ||
                value === "rgba(0, 0, 0, 0)" ||
                value === "transparent" ||
                /^0px/.test(value);
            return [...document.querySelectorAll<HTMLElement>("[data-testid=route-stages] .stage__bead")].map(
                (bead) => {
                    const style = getComputedStyle(bead);
                    return {
                        grund: leer(style.backgroundColor) && leer(style.backgroundImage),
                        rand:
                            leer(style.borderTopWidth) &&
                            leer(style.borderRightWidth) &&
                            leer(style.borderBottomWidth) &&
                            leer(style.borderLeftWidth),
                        schein: leer(style.boxShadow),
                        aktiv: bead.closest(".stage")?.classList.contains("is-active") === true,
                        farbe: style.color,
                        groesse: style.fontSize,
                    };
                },
            );
        });
        expect(beads.length, `${scheme}: es gibt Etappennummern`).toBeGreaterThan(1);
        for (const bead of beads) {
            expect(bead.grund, `${scheme}: kein Grund hinter der Ziffer`).toBe(true);
            expect(bead.rand, `${scheme}: kein Rand um die Ziffer`).toBe(true);
            expect(bead.schein, `${scheme}: kein Schein um die Ziffer`).toBe(true);
            expect(bead.groesse, `${scheme}: die Hausgröße, nicht mehr die Ausnahme 10 px`).toBe("11px");
        }
        // Die gewählte Ziffer trägt einen anderen Ton als die übrigen - und nicht mehr das Gelb.
        const aktiv = beads.find((bead) => bead.aktiv);
        const ruhig = beads.find((bead) => !bead.aktiv);
        expect(aktiv, `${scheme}: eine Etappe ist gewählt`).toBeDefined();
        expect(aktiv?.farbe).not.toBe(ruhig?.farbe);
        expect(aktiv?.farbe, `${scheme}: nicht mehr markerActive (#f0b429)`).not.toBe("rgb(240, 180, 41)");
    }
    await page.emulateMedia({ colorScheme: null });
});

test("🔴 P7: der Verlauf färbt nur Punkte der Kette, keine Fläche hinter der Ziffer", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await openRoute(page, "?route=Ferdok~Luring~Perricum&allowRiver=0&allowSea=0");
        const row = page.getByTestId("route-stage").nth(10);
        await row.locator("img").first().click();
        await expect(row).toHaveClass(/is-active/);
        await settleStages(page);
        const gemessen = await page.evaluate(() => {
            const list = document.querySelector<HTMLElement>("[data-testid=route-stages]")!;
            const aktiv = list.querySelector<HTMLElement>(".stage.is-active")!.getBoundingClientRect();
            const ziffer = list.querySelector<HTMLElement>(".stage.is-active .stage__number")!.getBoundingClientRect();
            const dots = [...list.querySelectorAll<HTMLElement>(".stages__glow")].map((dot) => {
                const box = dot.getBoundingClientRect();
                const style = getComputedStyle(dot);
                return {
                    mitte: box.top + box.height / 2,
                    breite: box.width,
                    hoehe: box.height,
                    rund: style.borderRadius,
                    deckkraft: Number(style.opacity),
                };
            });
            return {
                dots,
                zeile: { von: aktiv.top, bis: aktiv.bottom },
                ziffer: { von: ziffer.top, bis: ziffer.bottom },
                hoehe: aktiv.height,
            };
        });
        // Es leuchtet überhaupt etwas, und zwar über die ganze Zeile verteilt (Form C, nicht nur die Stelle).
        expect(gemessen.dots.length, `${scheme}: der Verlauf hat Punkte`).toBeGreaterThan(2);
        const inZeile = gemessen.dots.filter(
            (dot) => dot.mitte >= gemessen.zeile.von && dot.mitte <= gemessen.zeile.bis,
        );
        expect(inZeile.length, `${scheme}: die Zeile selbst leuchtet, nicht nur ihr Rand`).toBeGreaterThan(1);
        for (const dot of gemessen.dots) {
            // 🔴 Jeder gefärbte Teil ist ein PUNKT: rund und so groß wie ein Kettenpunkt, nie eine Fläche.
            expect(dot.breite, `${scheme}: Punktbreite`).toBeLessThan(4);
            expect(dot.hoehe, `${scheme}: Punkthöhe`).toBeLessThan(4);
            expect(dot.rund, `${scheme}: rund, also ein Punkt`).toBe("50%");
            // Und keiner liegt hinter der Ziffer - dort ist die Lücke.
            expect(
                dot.mitte < gemessen.ziffer.von || dot.mitte > gemessen.ziffer.bis,
                `${scheme}: kein Punkt hinter der Ziffer`,
            ).toBe(true);
        }
        // Der Verlauf läuft aus: Der äußerste Punkt ist durchsichtiger als einer in der Zeile.
        const aussen = Math.min(...gemessen.dots.map((dot) => dot.deckkraft));
        expect(aussen, `${scheme}: der Verlauf läuft aus`).toBeLessThan(1);
    }
    await page.emulateMedia({ colorScheme: null });
});

test("🔴 P10: die Wegart steht neben dem Namen - aber nur, wenn der Name sie nicht selbst nennt", async ({ page }) => {
    await openRoute(page, "?route=Gareth~Perricum");
    const zeilen = await page.getByTestId("route-stage").evaluateAll((rows) =>
        rows.map((row) => ({
            name: row.querySelector("[data-testid=stage-path]")?.textContent?.trim() ?? "",
            zusatz: row.querySelector("[data-testid=stage-path-type]")?.textContent?.trim() ?? "",
        })),
    );
    expect(zeilen.length).toBeGreaterThan(0);
    for (const zeile of zeilen) {
        if (zeile.name === "") {
            // Ohne Namen gibt es auch keinen Zusatz - dort steht die Gattung allein.
            expect(zeile.zusatz, `ohne Namen kein Zusatz: ${JSON.stringify(zeile)}`).toBe("");
            continue;
        }
        if (zeile.zusatz === "") continue;
        // 🔴 Der Zusatz steht NUR, wo der Name die Art nicht enthält - ohne Rücksicht auf die Schreibung.
        const art = zeile.zusatz.replace(/^\(|\)$/g, "");
        expect(
            zeile.name.toLocaleLowerCase().includes(art.toLocaleLowerCase()),
            `„${zeile.name}" nennt „${art}" schon selbst`,
        ).toBe(false);
    }
    // Eine Reichsstraße nennt „Straße" klein geschrieben und bekommt deshalb KEINEN Zusatz.
    const reichsstrasse = zeilen.find((zeile) => /^Reichsstraße/.test(zeile.name));
    if (reichsstrasse) expect(reichsstrasse.zusatz, JSON.stringify(reichsstrasse)).toBe("");
});

test("🔴 P11: die Rechnung des Eiltempos steht als Tabelle, und am Telefon läuft nichts über", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await loadRoute(page, "?route=Gareth~Perricum&hurry=1");
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.count()) > 0 && (await tab.getAttribute("aria-expanded")) === "false") await tab.click();
    const deckel = page.getByTestId("planning-hurry");
    await expect(deckel).toBeVisible({ timeout: 20_000 });
    // Zugeklappt steht nur das Ergebnis da, die Tabelle nicht.
    await expect(deckel.getByTestId("route-hurry-table")).toBeHidden();
    await page.getByTestId("hurry-toggle").click();
    const tabelle = deckel.getByTestId("route-hurry-table");
    await expect(tabelle).toBeVisible();
    // Zu jeder Benennung gehört genau ein Wert, und die Aufzählung der Regel steht als Aufzählung.
    const benennungen = await deckel.getByTestId("route-hurry-line").count();
    const werte = await deckel.getByTestId("route-hurry-value").count();
    expect(benennungen).toBeGreaterThan(2);
    expect(werte).toBe(benennungen);
    await expect(deckel.getByTestId("route-hurry-where").locator("li")).toHaveCount(2);
    const ueberlauf = await page.evaluate(() => {
        const deckel = document.querySelector<HTMLElement>("[data-testid=planning-hurry]")!;
        const teile = [deckel, ...deckel.querySelectorAll<HTMLElement>("dt, dd, p, li")];
        return {
            teile: teile.map((teil) => teil.scrollWidth - teil.clientWidth),
            dokument: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    for (const over of ueberlauf.teile) expect(over).toBeLessThanOrEqual(0);
    expect(ueberlauf.dokument).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 900 });
});

test("🔴 P9: die Teilstrecke im Kopf nennt Namen, keine Wegpunktschlüssel", async ({ page }) => {
    // Drei Wegpunkte, davon einer ein Kartenpunkt: genau die Mischung, in der die Zeile Schlüssel zeigte.
    // 🪤 Ein Kartenpunkt steht im Link als `@x,y` (`pointToken`), nicht als sein Schlüssel `p:<x>:<y>`.
    await openRoute(page, "?route=@592.99,515.80~Dragenfels~Perricum");
    await openStagePanel(page, 0);
    const leg = page.getByTestId("info-stage-leg");
    await expect(leg).toBeVisible({ timeout: 20_000 });
    const text = ((await leg.textContent()) ?? "").trim();
    expect(text, text).toMatch(/^Teilstrecke 1 von 2 · /);
    // 🔴 Kein roher Schlüssel: weder `p:<x>:<y>` noch eine UUID.
    expect(text).not.toMatch(/p:\d/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // Der Kartenpunkt heißt, wie er in der Wegpunkteingabe heißt.
    expect(text).toContain("Kartenpunkt");
});

test("🔴 P8: eine Etappe mit Rast trägt ihr Etikett, eine ohne nicht - und beide stehen neben dem Eiltempo", async ({
    page,
}) => {
    // Eine Fußreise rastet; ohne Rast gäbe es kein Etikett zu sehen.
    await openRoute(page, "?route=Ferdok~Perricum&land=groupFoot&domains=land&startMonth=praios");
    const rows = page.getByTestId("route-stage");
    const alle = await rows.count();
    const mitRast = await page.getByTestId("stage-rest").count();
    expect(mitRast, "auf dieser Reise fällt Rast an").toBeGreaterThan(0);
    expect(mitRast, "aber nicht auf jeder Etappe").toBeLessThan(alle);
    await expect(page.getByTestId("stage-rest").first()).toHaveText(/^(Rast|Rest)$/);
    // 🔴 Mit Eiltempo tragen Etappen beides - das Etikett der Rast verdrängt das des Eiltempos nicht.
    await openRoute(page, "?route=Ferdok~Perricum&land=groupFoot&domains=land&startMonth=praios&hurry=1");
    await expect.poll(() => page.getByTestId("stage-rest").count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const beides = await rows.evaluateAll(
        (list) =>
            list.filter(
                (row) =>
                    row.querySelector("[data-testid=stage-rest]") !== null &&
                    row.querySelector("[data-testid=stage-hurry]") !== null,
            ).length,
    );
    expect(beides, "beide Etiketten an derselben Zeile").toBeGreaterThan(0);
});

test("🔴 P8: am Telefon läuft die Zeile mit beiden Etiketten nicht über", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await loadRoute(page, "?route=Ferdok~Perricum&land=groupFoot&domains=land&startMonth=praios&hurry=1");
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.count()) > 0 && (await tab.getAttribute("aria-expanded")) === "false") await tab.click();
    await expect(page.getByTestId("route-stages")).toBeVisible({ timeout: 20_000 });
    await openStageGroups(page);
    const masse = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>("[data-testid=route-stages]")!;
        const beide = [...list.querySelectorAll<HTMLElement>("[data-testid=route-stage]")].filter(
            (row) =>
                row.querySelector("[data-testid=stage-rest]") !== null &&
                row.querySelector("[data-testid=stage-hurry]") !== null,
        );
        return {
            zeilen: beide.length,
            ueberlauf: beide.map((row) => row.scrollWidth - row.clientWidth),
            dokument: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    expect(masse.zeilen, "es gibt Zeilen mit beiden Etiketten").toBeGreaterThan(0);
    for (const over of masse.ueberlauf) expect(over).toBeLessThanOrEqual(0);
    expect(masse.dokument).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 900 });
});

test("🔴 A13: 360 px - kein seitlicher Überlauf, und der Untertitel bricht sauber", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await loadRoute(page, "?route=Gareth~Perricum");
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.count()) > 0 && (await tab.getAttribute("aria-expanded")) === "false") await tab.click();
    await expect(page.getByTestId("route-stages")).toBeVisible({ timeout: 20_000 });
    await openStageGroups(page);
    const masse = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>("[data-testid=route-stages]")!;
        const parts = [
            ...list.querySelectorAll<HTMLElement>("[data-testid=station-detail], [data-testid=route-stage]"),
        ];
        return {
            listeUeberlauf: list.scrollWidth - list.clientWidth,
            teileUeberlauf: parts.map((part) => part.scrollWidth - part.clientWidth),
            dokument: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            untertitel: parts.filter((part) => part.dataset["testid"] === "station-detail").length,
        };
    });
    expect(masse.untertitel, "die Wegpunkte tragen ihre zweite Zeile").toBeGreaterThan(0);
    expect(masse.listeUeberlauf, "die Liste läuft nicht seitlich über").toBeLessThanOrEqual(0);
    expect(masse.dokument, "die Seite läuft nicht seitlich über").toBeLessThanOrEqual(0);
    for (const over of masse.teileUeberlauf) expect(over).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 900 });
});

test("🔴 P6: Ring und Nadel stanzen die Kette im Ton ihres GRUNDES aus - hell wie dunkel", async ({ page }) => {
    // Beide Themen und beide Breiten: Am Telefon liegt dieselbe Liste in derselben Hülle, und die Stanze muss auch
    // dort den Ton ihres Grundes tragen (der Fehler fiel am Rechner auf, hätte aber überall gestanden).
    for (const { scheme, width } of [
        { scheme: "light", width: 1280 },
        { scheme: "dark", width: 1280 },
        { scheme: "light", width: 360 },
    ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await loadRoute(page, "?route=Gareth~Luring~Perricum");
        if (width < 768) {
            const tab = page.getByTestId("route-planner-tab");
            if ((await tab.count()) > 0 && (await tab.getAttribute("aria-expanded")) === "false") await tab.click();
            await expect(page.getByTestId("route-stages")).toBeVisible({ timeout: 20_000 });
        }
        const measured = await page.evaluate(() => {
            const backdrop = (element: HTMLElement): string => {
                let node: HTMLElement | null = element.parentElement;
                while (node) {
                    const colour = getComputedStyle(node).backgroundColor;
                    if (colour !== "rgba(0, 0, 0, 0)" && colour !== "transparent") return colour;
                    node = node.parentElement;
                }
                return "(keiner)";
            };
            return [...document.querySelectorAll<HTMLElement>("[data-testid=route-stages] .station__mark")].map(
                (mark) => {
                    const style = getComputedStyle(mark);
                    const shadow = /rgba?\([^)]+\)/.exec(style.boxShadow)?.[0];
                    return {
                        kind: mark.classList.contains("station__mark--ziel") ? "ziel" : "wegpunkt",
                        punch: shadow ?? style.backgroundColor,
                        backdrop: backdrop(mark),
                    };
                },
            );
        });
        const wo = `${scheme} ${String(width)} px`;
        expect(measured.length, `${wo}: Ring und Nadel stehen in der Liste`).toBeGreaterThan(1);
        expect(measured.some((mark) => mark.kind === "ziel")).toBe(true);
        for (const mark of measured) {
            expect(mark.punch, `${wo} ${mark.kind}: die Stanze trägt den Ton des Grundes`).toBe(mark.backdrop);
        }
    }
    await page.emulateMedia({ colorScheme: null });
    await page.setViewportSize({ width: 1280, height: 900 });
});

test("🔴 P6: der dunkle Rand des Rings ist so dick wie der der Nadel - EINE Gestalt für beide", async ({ page }) => {
    await loadRoute(page, "?route=Gareth~Luring~Perricum");
    // Gemessen am GEZEICHNETEN Bild: Rand in Einheiten mal dem Maßstab, den `preserveAspectRatio` wirklich wählt.
    const measured = await page.evaluate(() => {
        const svgOf = (kind: string): SVGSVGElement | null =>
            document.querySelector<SVGSVGElement>(`[data-testid=route-stages] .station__mark--${kind} svg`);
        const scaleOf = (svg: SVGSVGElement, width: number, height: number): number => {
            const box = svg.getBoundingClientRect();
            return Math.min(box.width / width, box.height / height);
        };
        const ring = svgOf("wegpunkt");
        const drop = svgOf("ziel");
        if (!ring || !drop) return null;
        const radius = (svg: SVGSVGElement, at: number): number =>
            Number(svg.querySelectorAll("circle")[at]?.getAttribute("r") ?? "0");
        return {
            ring: (radius(ring, 0) - radius(ring, 1)) * scaleOf(ring, 34, 34),
            // Außen- und Innenpfad der Nadel an ihrer breitesten Stelle (15 und 11,5 Einheiten).
            drop: (15 - 11.5) * scaleOf(drop, 30, 51),
        };
    });
    expect(measured).not.toBeNull();
    // Gleich dick auf ein Zehntelpixel genau - vorher trug der Ring rund 60 % mehr (2,65 px gegen 1,63 px).
    expect(Math.abs(measured!.ring - measured!.drop)).toBeLessThan(0.1);
});

test("reduzierte Bewegung: die Gruppe klappt ohne Fahrt", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openRoute(page, "?route=Gareth~Perricum");
    const group = page.getByTestId("route-stage-group").first();
    await group.getByRole("button").first().click();
    expect(await group.evaluate((element) => element.getAnimations().length)).toBe(0);
});
