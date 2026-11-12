import { expect, test, type Page } from "@playwright/test";
import {
    DRUNIDET as DRUNIDET_ORT,
    ergaenzeEintrag,
    gegend,
    kennung,
    probeEintrag,
    stelleEintrag,
    stelleLeuchten,
    WIKI_ZEILE,
} from "./eintrag-stub.ts";
import { openMap } from "./map-handle.ts";

/**
 * Die Infobox eines Vorkommens (WI-0257 S3b, neu gebaut mit WI-0260 nach dem abgenommenen Entwurf, Fassung 2).
 *
 * Zwei Hälften:
 * - **Der Weg dorthin** (die ersten beiden Fälle): Der Name eines Vorkommens in der Infobox eines Orts öffnet seine Infobox (Betreiber 2026-10-30: „wenn ich da auf ein ding draufklicke kommt keine infobox dazu“), nicht den
 *   Wiki-Artikel in einem neuen Tab; der Artikel steht im Quellenkasten. Braucht einen Fastify mit dem Lesepfad dieses Checkouts und eine Entwicklungsdatenbank mit Vorkommen; der Ort ist Drunidet, der dichteste Fall des
 *   Bestands (110 Tierarten in einer Reihe; `externe-links.spec.ts`).
 * - **Die Infobox selbst** (`describe` darunter): Die Antwort des Servers wird GESTELLT (`eintrag-stub.ts`, neues Format), damit Kopf, Kurzbeschreibung, Liste, Kürzung, Felder und Quellen nicht vom Server abhängen, der
 *   gerade läuft. Was die Oberfläche beim Leuchten fragt, schreibt `stelleLeuchten` auf; welche Gegenden wirklich leuchten, prüft `vorkommen-suche.spec.ts` an der Karte.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const DRUNIDET = { kind: "place", id: DRUNIDET_ORT } as const;
const EINTRAG_ID = "96c1ad48-d7e9-4a0d-b35c-ab5897669a6b";

/** Öffnet Drunidet und klappt die Tierarten auf; liefert den ersten Namen der Reihe. */
async function ersterTiername(page: Page): Promise<{ name: string; link: ReturnType<Page["locator"]> }> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), DRUNIDET);
    await expect(page.getByTestId("info-title")).toBeVisible({ timeout: 30_000 });
    const zeile = page.locator('[data-field="lore:fauna"]');
    await zeile.waitFor({ timeout: 30_000 });
    await zeile.locator("button").first().click();
    await expect(zeile.getByTestId("info-lore-sheet").first()).toBeAttached({ timeout: 30_000 });
    const link = zeile.getByTestId("info-lore-names").getByTestId("info-link").first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    return { name: (await link.innerText()).trim(), link };
}

test("🔴 der Name einer Tierart öffnet die Infobox des Vorkommens - ohne neuen Tab, mit dem Namen als Titel", async ({
    page,
}) => {
    await ergaenzeEintrag(page);
    const neueSeiten: string[] = [];
    page.context().on("page", (neue) => neueSeiten.push(neue.url()));
    const { name, link } = await ersterTiername(page);
    expect(name.length).toBeGreaterThan(0);
    await link.click();
    const infobox = page.getByTestId("info-eintrag");
    await expect(infobox).toBeVisible({ timeout: 30_000 });
    // Titel sofort: der Name der Zeile, schon bevor die Antwort der Infobox da ist, und danach derselbe.
    await expect(page.getByTestId("info-title")).toHaveText(name);
    await expect(infobox).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
    await expect(page.getByTestId("info-title")).toHaveText(name);
    await expect(page.getByTestId("info-subtitle")).toContainText("Fauna");
    expect(neueSeiten).toEqual([]);
});

test("🔴 der Wiki-Artikel steht im Quellenkasten des Vorkommens: ein Anker nach draußen mit ↗", async ({ page }) => {
    await ergaenzeEintrag(page);
    const { link } = await ersterTiername(page);
    await link.click();
    await expect(page.getByTestId("info-eintrag")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
    const kasten = page.getByTestId("info-source");
    await expect(kasten).toBeVisible({ timeout: 30_000 });
    const anker = kasten.locator('a[target="_blank"]').first();
    await expect(anker).toHaveAttribute("href", /^https:\/\/de\.wiki-aventurica\.de\//u);
    const pfeil = await anker.evaluate((element) => getComputedStyle(element, "::after").content);
    expect(pfeil).toContain("↗");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Öffnet den Eintrag mit der gestellten Antwort und wartet, bis er steht (`stand`: wie sein Panel ihn nennt). */
async function oeffneEintrag(page: Page, titel = "Sikrami", stand = "ready"): Promise<void> {
    await openMap(page);
    await oeffneNochEinen(page, EINTRAG_ID, titel);
    await expect(page.getByTestId("info-eintrag")).toHaveAttribute("data-status", stand, { timeout: 30_000 });
}

/** Öffnet einen weiteren Eintrag (eine andere Kennung: dieselbe Auswahl öffnete nichts neu). */
async function oeffneNochEinen(page: Page, id: string, titel = "Sikrami"): Promise<void> {
    await page.evaluate(
        (ziel) =>
            globalThis.avesmapsOpenSubject?.({ kind: "loreEntry", id: ziel.id }, { known: { title: ziel.titel } }),
        { id, titel },
    );
}

/** Eine eigene Kennung je Fall, die der der Probe ähnelt. */
const andereKennung = (n: number): string => `${EINTRAG_ID.slice(0, -2)}${String(n).padStart(2, "0")}`;

/** Die Zeilen einer Gruppe nach ihrem Namen. */
const zeilen = (page: Page) => page.getByTestId("info-eintrag-zeile");
/** Namen ohne Ziffern: Die Liste zeigt keine Zahl, und der Fall prüft das am ganzen Abschnitt. */
const buchstaben = (n: number): string =>
    `${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(97 + Math.floor(n / 26))}`;

test.describe("🔴 die Infobox nach dem Entwurf (Fassung 2)", () => {
    test("der Kopf ist der der Standard-Infobox: Typbild 16:9 der Kategorie, daneben das Zeichen im neutralen Feld, Untertitel mit Gegenstandstyp", async ({
        page,
    }) => {
        await stelleEintrag(page, (id) => probeEintrag(id));
        await stelleLeuchten(page);
        await oeffneEintrag(page);

        const bild = page.getByTestId("info-header-image");
        await expect(bild).toHaveAttribute("data-graphic", "ware");
        await expect.poll(() => bild.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const masse = await bild.boundingBox();
        expect(masse).not.toBeNull();
        expect((masse?.width ?? 0) / (masse?.height ?? 1)).toBeCloseTo(16 / 9, 1);
        // Die Beschriftung bleibt „Typbild“, auch wo die Datei über die Medienverwaltung wechselt.
        await expect(page.getByTestId("info-header-bildbezug")).toHaveAttribute("data-bezug", "typbild");

        await expect(page.getByTestId("info-title")).toHaveText("Sikrami");
        await expect(page.getByTestId("info-subtitle")).toHaveText("Ware · Hartwurst · profan");

        // Das Zeichen der Art: ein neutrales Feld (Fläche, Rand und Schrift aus dem Kanon), kein Grün; links vom Titel.
        const zeichen = page.getByTestId("info-eintrag-zeichen");
        await expect(zeichen).toBeVisible();
        await expect(zeichen.locator("svg.editor-zeichen")).toBeVisible();
        const farben = await zeichen.evaluate((el) => {
            const probe = document.createElement("div");
            probe.style.cssText =
                "background-color: var(--color-panel-soft); border: 1px solid var(--color-border-strong); color: var(--color-text-strong)";
            document.body.append(probe);
            const soll = getComputedStyle(probe);
            const ist = getComputedStyle(el);
            const gleich = {
                grund: ist.backgroundColor === soll.backgroundColor,
                rand: ist.borderTopColor === soll.borderTopColor,
                schrift: ist.color === soll.color,
            };
            probe.remove();
            return gleich;
        });
        expect(farben).toEqual({ grund: true, rand: true, schrift: true });
        const lage = await page.evaluate(() => {
            const feld = document.querySelector('[data-testid="info-eintrag-zeichen"]')?.getBoundingClientRect();
            const titel = document.querySelector('[data-testid="info-title"]')?.getBoundingClientRect();
            return { feldRechts: feld?.right ?? 0, titelLinks: titel?.left ?? 0 };
        });
        expect(lage.feldRechts).toBeLessThanOrEqual(lage.titelLinks);
    });

    test("jede der vier Arten trägt ihr Typbild und ihr Zeichen: Flora, Fauna, Ware, Spezies", async ({ page }) => {
        const arten = ["flora", "fauna", "ware", "spezies"] as const;
        let art: (typeof arten)[number] = "flora";
        await stelleEintrag(page, (id) => probeEintrag(id, { kind: art, name: "Probe", typ: null }));
        await stelleLeuchten(page);
        await openMap(page);
        for (const kind of arten) {
            art = kind;
            await oeffneNochEinen(page, andereKennung(arten.indexOf(kind)), "Probe");
            await expect(page.getByTestId("info-eintrag-zeichen")).toHaveAttribute("data-kind", kind, {
                timeout: 30_000,
            });
            await expect(page.getByTestId("info-header-image")).toHaveAttribute("data-graphic", kind);
            await expect
                .poll(() =>
                    page.getByTestId("info-header-image").evaluate((el) => (el as HTMLImageElement).naturalWidth),
                )
                .toBeGreaterThan(0);
        }
    });

    test("die Feldtafel steht gleich unter dem Kopf - „Beschreibung“ mit dem ersten Satz -, die Lizenz leise und sichtbar mit Link darunter; ohne Kurzbeschreibung keine Beschreibung und keine Lizenzzeile", async ({
        page,
    }) => {
        // WI-0257 S5 (Vali 2026-10-30: „der erste satz reicht“): Die Kurzbeschreibung steht nicht mehr als Absatz da, sondern ihr erster Satz als Feld; „z. B.“ beendet ihn nicht.
        await stelleEintrag(page, (id) =>
            probeEintrag(id, {
                kurzbeschreibung:
                    "Die Sikrami ist eine haltbare Hartwurst, z. B. als Proviant für lange Reisen geschätzt. Sie stammt aus dem Lieblichen Feld.",
            }),
        );
        await stelleLeuchten(page);
        await oeffneEintrag(page);

        const kurz = page.getByTestId("info-eintrag-kurz").locator('[data-field="beschreibung"] dd');
        await expect(kurz).toHaveText(
            "Die Sikrami ist eine haltbare Hartwurst, z. B. als Proviant für lange Reisen geschätzt.",
        );
        await expect(page.getByTestId("info-eintrag-kurz").locator("dt").first()).toHaveText("Beschreibung");
        // Darunter in derselben Tafel die weiteren Namen; weiter unten stehen sie nicht noch einmal.
        await expect(page.getByTestId("info-eintrag-kurz").locator('[data-field="weitere"]')).toContainText(
            "Sikramwurst",
        );
        await expect(page.getByTestId("info-facts")).toHaveCount(1);
        const lizenz = page.getByTestId("info-eintrag-lizenz");
        // CC BY-SA verlangt die Namensnennung: das Wiki (Artikel), seine Autoren (Liste im Wiki) und die Lizenz (Zusammenfassung), alle drei in einem neuen Tab, mit ↗.
        await expect(lizenz).toHaveText("Text: Wiki Aventurica (Autoren) · CC BY-SA 3.0");
        for (const [name, href] of [
            ["Wiki Aventurica", WIKI_ZEILE.url],
            ["Autoren", "https://de.wiki-aventurica.de/wiki/Sikrami?action=credits"],
            ["CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/deed.de"],
        ] as const) {
            const link = lizenz.getByRole("link", { name, exact: true });
            await expect(link, name).toHaveAttribute("href", href);
            await expect(link, name).toHaveAttribute("target", "_blank");
            await expect(link, name).toHaveAttribute("rel", /noopener/u);
            expect(await link.evaluate((el) => getComputedStyle(el, "::after").content), name).toContain("↗");
        }
        await expect(lizenz.getByRole("link")).toHaveCount(3);

        // Reihenfolge von oben nach unten: Kopf, Kurzbeschreibung, Lizenz, „Wo es vorkommt“.
        const unten = await page.evaluate(() => {
            const ende = (id: string): number =>
                document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().bottom ?? NaN;
            const anfang = (id: string): number =>
                document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? NaN;
            return {
                kopf: ende("info-header"),
                kurz: anfang("info-eintrag-kurz"),
                kurzEnde: ende("info-facts"),
                lizenz: anfang("info-eintrag-lizenz"),
                wo: anfang("info-eintrag-wo"),
            };
        });
        expect(unten.kurz).toBeGreaterThanOrEqual(unten.kopf);
        expect(unten.lizenz).toBeGreaterThanOrEqual(unten.kurzEnde);
        expect(unten.wo).toBeGreaterThan(unten.lizenz);
        // Direkt darunter: kein Abschnitt dazwischen.
        expect(unten.kurz - unten.kopf).toBeLessThan(40);

        // Der Eintrag ohne Kurzbeschreibung (WikiSync noch nicht gelaufen) zeigt weder Text noch Lizenz.
        await page.unroute(/\/api\/search\/eintrag\?/u);
        await stelleEintrag(page, (id) => probeEintrag(id, { kurzbeschreibung: null }));
        await oeffneNochEinen(page, andereKennung(99));
        await expect(page.getByTestId("info-eintrag")).toHaveAttribute("data-status", "ready");
        await expect(page.getByTestId("info-eintrag-wo")).toBeVisible();
        await expect(page.locator('[data-field="beschreibung"]')).toHaveCount(0);
        await expect(page.getByTestId("info-eintrag-lizenz")).toHaveCount(0);
    });

    test("🔴 die Unterseite „Liste“ im Wiki (WI-0299): Langschwert verlinkt sie unter der Feldtafel mit ↗, Sikrami ohne Liste zeigt keine Zeile", async ({
        page,
    }) => {
        // OPS-000104 (Meldung eines Editors): Varianten und Einzelexemplare stehen im Wiki auf der Unterseite; der Server nennt sie nur, wo der WikiSync sie im Dump gefunden hat.
        await stelleEintrag(page, (id) =>
            probeEintrag(id, {
                name: "Langschwert",
                wiki: { ...WIKI_ZEILE, url: "https://de.wiki-aventurica.de/wiki/Langschwert", title: "Langschwert" },
                liste: "https://de.wiki-aventurica.de/wiki/Langschwert/Liste",
                kurzbeschreibung: "Das Langschwert ist ein zweischneidiges Schwert.",
            }),
        );
        await stelleLeuchten(page);
        await oeffneEintrag(page);

        const link = page.getByTestId("info-eintrag-liste-wiki");
        await expect(link).toHaveText("Varianten und Einzelexemplare im Wiki");
        await expect(link).toHaveAttribute("href", "https://de.wiki-aventurica.de/wiki/Langschwert/Liste");
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/u);
        expect(await link.evaluate((el) => getComputedStyle(el, "::after").content)).toContain("↗");
        // Zwischen der Feldtafel und der Lizenzzeile.
        const lage = await page.evaluate(() => {
            const rechteck = (id: string): DOMRect | undefined =>
                document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
            return {
                tafel: rechteck("info-facts")?.bottom ?? NaN,
                link: rechteck("info-eintrag-liste-wiki")?.top ?? NaN,
                lizenz: rechteck("info-eintrag-lizenz")?.top ?? NaN,
            };
        });
        expect(lage.link).toBeGreaterThanOrEqual(lage.tafel);
        expect(lage.lizenz).toBeGreaterThan(lage.link);
        // Fokus: der Ring des Hauses.
        await link.focus();
        expect(await link.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");

        // Sikrami hat keine Liste: keine Zeile, kein toter Link.
        await page.unroute(/\/api\/search\/eintrag\?/u);
        await stelleEintrag(page, (id) => probeEintrag(id));
        await oeffneNochEinen(page, andereKennung(98));
        await expect(page.getByTestId("info-eintrag")).toHaveAttribute("data-status", "ready");
        await expect(page.getByTestId("info-eintrag-lizenz")).toBeVisible();
        await expect(page.getByTestId("info-eintrag-liste-wiki")).toHaveCount(0);
    });

    test("„Wo es vorkommt“: ‚Alle zeigen‘, dann Herkunft, Verbreitung und Orte - ohne Zahlen und ohne Pillen; ‚Auch genannt‘ darunter", async ({
        page,
    }) => {
        await stelleEintrag(page, (id) => probeEintrag(id));
        await stelleLeuchten(page);
        await oeffneEintrag(page);

        const wo = page.getByTestId("info-eintrag-wo");
        await expect(wo.getByRole("heading", { level: 3 })).toHaveText("Wo es vorkommt");
        await expect(page.getByTestId("info-eintrag-alle")).toContainText("Alle zeigen");
        await expect(page.getByTestId("info-eintrag-gruppe")).toHaveText(["Herkunft", "Verbreitung", "Orte"]);
        await expect(zeilen(page)).toHaveCount(5);
        // Jede Zeile nennt Namen und Art, sonst nichts.
        await expect(zeilen(page).filter({ hasText: "Liebliches Feld" })).toContainText("Region");
        await expect(zeilen(page).filter({ hasText: "Grafschaft Sikram" })).toContainText("Grafschaft");
        await expect(zeilen(page).filter({ hasText: "Radoleth" })).toContainText("Stadt");
        // Keine Zahl im ganzen Abschnitt, keine Pille.
        expect(await wo.innerText()).not.toMatch(/\d/u);
        await expect(page.getByTestId("info-eintrag-chip")).toHaveCount(0);
        await expect(page.getByTestId("info-eintrag-auch")).toHaveText("Auch genannt: Güldenland");
        // „Genannt in“ gibt es nicht mehr.
        await expect(page.getByText("Genannt in")).toHaveCount(0);
    });

    test("acht Zeilen je Gruppe, „Weitere anzeigen“ bis vierzig, dann sagt ein Satz, wo der Rest steht", async ({
        page,
    }) => {
        await stelleEintrag(page, (id) =>
            probeEintrag(id, {
                kind: "fauna",
                typ: null,
                wo: {
                    gegenden: [
                        ...Array.from({ length: 3 }, (_, i) => gegend(id, i + 1, `Genannt ${buchstaben(i)}`)),
                        ...Array.from({ length: 50 }, (_, i) =>
                            gegend(id, i + 10, `Regel ${buchstaben(i)}`, { relation: "regel" }),
                        ),
                    ],
                    orte: [],
                    auchGenannt: [],
                    // Der Server schickt höchstens sechzig je Beziehung; was darüber leuchtet, nennt `weitere`.
                    weitere: 2_740,
                },
            }),
        );
        await stelleLeuchten(page);
        await oeffneEintrag(page);

        await expect(page.getByTestId("info-eintrag-gruppe")).toHaveText(["Gegenden", "Weitere nach Lebensraum"]);
        // Die kurze Gruppe braucht keinen Knopf; die lange zeigt acht Zeilen.
        await expect(page.getByTestId("info-eintrag-mehr")).toHaveCount(1);
        await expect(zeilen(page)).toHaveCount(3 + 8);
        await expect(page.getByTestId("info-eintrag-rest")).toHaveCount(0);

        const mehr = page.getByTestId("info-eintrag-mehr");
        await expect(mehr).toHaveText("Weitere anzeigen");
        await mehr.click();
        await expect(mehr).toHaveText("Weniger anzeigen");
        await expect(mehr).toHaveAttribute("aria-expanded", "true");
        await expect(zeilen(page)).toHaveCount(3 + 40);
        // Die Zahl steht nur im Satz: zehn Zeilen über vierzig und die 2.740, die der Server nicht geschickt hat.
        await expect(page.getByTestId("info-eintrag-rest")).toContainText(
            "2.750 weitere Gegenden, die zum Lebensraum passen",
        );
        await expect(page.getByTestId("info-eintrag-rest")).toContainText("„Alle zeigen“ zeigt sie auf der Karte");
        for (const text of await zeilen(page).allInnerTexts()) expect(text).not.toMatch(/\d/u);
        // Der Satz trennt nicht von selbst („Gegen-den“).
        await expect(page.getByTestId("info-eintrag-rest")).toHaveCSS("hyphens", "manual");

        await mehr.click();
        await expect(zeilen(page)).toHaveCount(3 + 8);
        await expect(page.getByTestId("info-eintrag-rest")).toHaveCount(0);
    });

    test("🔴 eine Gegend wählen: sie leuchtet in der Farbe der Auswahlliste mit ●, kein Gelb; ein zweiter Klick nimmt es zurück; ‚Alle zeigen‘ wechselt", async ({
        page,
    }) => {
        await stelleEintrag(page, (id) => probeEintrag(id));
        const fragen = await stelleLeuchten(page);
        await oeffneEintrag(page);

        const windhag = zeilen(page).filter({ hasText: "Windhag" });
        await expect(windhag).toHaveAttribute("aria-pressed", "false");
        await windhag.click();
        // Gefragt wird die Anfrage dieser Gegend (`ziel`): der Eintrag, zugeschnitten auf ihre Landschaft.
        await expect.poll(() => fragen.anfragen.length, { timeout: 15_000 }).toBe(1);
        expect(fragen.anfragen[0]).toEqual({ eintrag: EINTRAG_ID, landschaften: [kennung(3)] });
        await expect(windhag).toHaveAttribute("aria-pressed", "true");
        await expect(windhag.locator(".info-eintrag__marke")).toHaveText("●");

        // Die Farbe der Auswahlliste („Hier liegen N Flächen“), nicht das Gelb der alten Pillen; die Zeile selbst bleibt ohne Fläche
        // (die Hoverwäsche geht in 120 ms zurück).
        await page.mouse.move(0, 0);
        await expect
            .poll(() => windhag.evaluate((el) => getComputedStyle(el).backgroundColor))
            .toBe("rgba(0, 0, 0, 0)");
        const farbe = await windhag.evaluate((el) => {
            const probe = document.createElement("span");
            probe.style.color = "var(--color-list-selection-text)";
            document.body.append(probe);
            const soll = getComputedStyle(probe).color;
            probe.remove();
            const name = getComputedStyle(el.querySelector(".info-eintrag__row-name")!).color;
            const grund = getComputedStyle(el).backgroundColor;
            return { soll, name, grund, marke: getComputedStyle(el.querySelector(".info-eintrag__marke")!).color };
        });
        expect(farbe.name).toBe(farbe.soll);
        expect(farbe.marke).toBe(farbe.soll);
        expect(farbe.grund).toBe("rgba(0, 0, 0, 0)");
        // Eine andere Zeile bleibt in der Schriftfarbe.
        const andere = zeilen(page).filter({ hasText: "Grafschaft Sikram" });
        await expect(andere).toHaveAttribute("aria-pressed", "false");
        expect(await andere.locator(".info-eintrag__row-name").evaluate((el) => getComputedStyle(el).color)).not.toBe(
            farbe.soll,
        );

        // Eine andere Gegend löst die erste ab.
        await andere.click();
        await expect(andere).toHaveAttribute("aria-pressed", "true");
        await expect(windhag).toHaveAttribute("aria-pressed", "false");
        await expect.poll(() => fragen.anfragen.length).toBe(2);
        expect(fragen.anfragen[1]).toEqual({ eintrag: EINTRAG_ID, gebiet: kennung(2) });

        // „Alle zeigen“ fragt den ganzen Eintrag und löst die Gegend ab.
        const alle = page.getByTestId("info-eintrag-alle");
        await alle.click();
        await expect(alle).toHaveAttribute("aria-pressed", "true");
        await expect(andere).toHaveAttribute("aria-pressed", "false");
        await expect.poll(() => fragen.anfragen.length).toBe(3);
        expect(fragen.anfragen[2]).toEqual({ eintrag: EINTRAG_ID });

        // Ein zweiter Klick auf die gewählte Zeile nimmt das Leuchten zurück (keine neue Frage).
        await alle.click();
        await expect(alle).toHaveAttribute("aria-pressed", "false");
        expect(fragen.anfragen).toHaveLength(3);
    });

    test("ein Ort öffnet wie ein Objektlink: sein Panel geht auf, in einem Tab bleibt alles", async ({ page }) => {
        await stelleEintrag(page, (id) => probeEintrag(id));
        await stelleLeuchten(page);
        const neueSeiten: string[] = [];
        page.context().on("page", (neue) => neueSeiten.push(neue.url()));
        await oeffneEintrag(page);

        await zeilen(page).filter({ hasText: "Drunidet" }).click();
        await expect
            .poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()), { timeout: 15_000 })
            .toMatchObject({ kind: "place", id: DRUNIDET_ORT });
        await expect(page.getByTestId("info-title")).toHaveText("Drunidet", { timeout: 30_000 });
        expect(neueSeiten).toEqual([]);
    });

    test("die Felder unter der Beschreibung: Lebensraum, weitere Namen und der Kontinent, wo er nicht Aventurien ist", async ({
        page,
    }) => {
        await stelleEintrag(page, (id) =>
            probeEintrag(id, {
                kind: "fauna",
                typ: null,
                lebensraum: "Wald und Hügelland",
                weitereNamen: ["Grubenwurm", "Tunnelwurm"],
                kontinent: "Myranor/Güldenland",
            }),
        );
        await stelleLeuchten(page);
        await oeffneEintrag(page);

        const felder = page.getByTestId("info-facts");
        await expect(felder.locator('[data-field="lebensraum"]')).toContainText("Wald und Hügelland");
        await expect(felder.locator('[data-field="weitere"]')).toContainText("Grubenwurm, Tunnelwurm");
        await expect(felder.locator('[data-field="kontinent"]')).toContainText("Myranor / Güldenland");
        await expect(page.getByText("Genannt in")).toHaveCount(0);

        // Aventurien ist kein Feld, und ein Eintrag ohne Lebensraum und weitere Namen hat nur die Beschreibung.
        await page.unroute(/\/api\/search\/eintrag\?/u);
        await stelleEintrag(page, (id) => {
            const eintrag = probeEintrag(id, { kontinent: "Aventurien" });
            delete eintrag.weitereNamen;
            return eintrag;
        });
        await oeffneNochEinen(page, andereKennung(98));
        await expect(page.getByTestId("info-title")).toHaveText("Sikrami");
        await expect(page.getByTestId("info-eintrag")).toHaveAttribute("data-status", "ready");
        await expect(page.getByTestId("info-fact")).toHaveCount(1);
        await expect(page.locator('[data-field="beschreibung"]')).toHaveCount(1);
    });

    test("der Quellenkasten trägt die Wikizeile und die Publikationen des Eintrags, ohne Wartezeile", async ({
        page,
    }) => {
        await stelleEintrag(page, (id) => probeEintrag(id));
        await stelleLeuchten(page);
        await oeffneEintrag(page);

        const kasten = page.getByTestId("info-source");
        await expect(kasten).toBeVisible();
        await expect(kasten.getByTestId("info-source-label")).toHaveText("Quelle:");
        await expect(kasten.locator('a[target="_blank"]').first()).toHaveAttribute("href", WIKI_ZEILE.url);
        await expect(kasten.getByTestId("info-sources-loading")).toHaveCount(0);
        await expect(kasten.getByTestId("info-sources-tab-described")).toContainText("(2)");
        await expect(kasten.getByTestId("info-sources-tab-mentioned")).toContainText("(1)");
        await kasten.getByTestId("info-sources-tab-described").click();
        const liste = kasten.getByTestId("info-sources-list");
        await expect(liste).toContainText("Aventurisches Bestiarium");
        await expect(liste).toContainText("S. 32, 33");
        await expect(liste).toContainText("Zoo-Botanica Aventurica");
        await expect(liste).not.toContainText("Aventurischer Bote 140");
        await kasten.getByTestId("info-sources-tab-mentioned").click();
        await expect(liste).toContainText("Aventurischer Bote 140");
    });

    test("nennt der Eintrag nur Aventurien, sagt das Panel „Überall“; hat er keinen Ort, sagt es das", async ({
        page,
    }) => {
        await stelleEintrag(page, (id) =>
            probeEintrag(id, {
                nurKontinent: true,
                gegenden: 0,
                orte: 0,
                wo: { gegenden: [], orte: [], auchGenannt: [] },
            }),
        );
        await stelleLeuchten(page);
        await oeffneEintrag(page);
        await expect(page.getByTestId("info-eintrag-ueberall")).toContainText("Überall in Aventurien");
        await expect(page.getByTestId("info-eintrag-ueberall")).toContainText(
            "Keine genauere Gegend bekannt. Aventurien leuchtet als Umriss.",
        );
        await expect(page.getByTestId("info-eintrag-alle")).toHaveCount(0);
        await expect(zeilen(page)).toHaveCount(0);

        await page.unroute(/\/api\/search\/eintrag\?/u);
        await stelleEintrag(page, (id) =>
            probeEintrag(id, {
                kartenbezug: false,
                gegenden: 0,
                orte: 0,
                wo: { gegenden: [], orte: [], auchGenannt: ["Güldenland"] },
            }),
        );
        await oeffneNochEinen(page, andereKennung(97));
        await expect(page.getByTestId("info-eintrag-kein-ort")).toHaveText("Noch kein Ort auf der Karte.");
        await expect(page.getByTestId("info-eintrag-alle")).toHaveCount(0);
        // Was das Wiki nennt, ohne dass es auf der Karte liegt, steht trotzdem da.
        await expect(page.getByTestId("info-eintrag-auch")).toContainText("Güldenland");
    });

    test("ein Eintrag, den es nicht gibt, zeigt seinen Satz; der Kopf mit dem Namen bleibt", async ({ page }) => {
        await stelleEintrag(page, () => null);
        await oeffneEintrag(page, "Verschwunden", "missing");
        await expect(page.getByTestId("info-missing")).toBeVisible();
        await expect(page.getByTestId("info-title")).toHaveText("Verschwunden");
    });
});
