import { expect, test, type Page } from "@playwright/test";
import { ergaenzeEintrag } from "./eintrag-stub.ts";
import { openMap } from "./map-handle.ts";
import { mockBackend, repo } from "./status-fixtures.ts";

/**
 * 🔴 JEDER LINK, DER DIE SEITE VERLÄSST, TRÄGT EIN ↗ — UND NUR DER.
 *
 * Die Regel steht zweimal im Guide. §13.13: „Ein Pfeil ↗ heißt: das führt aus Avesmaps hinaus. Ohne ihn sieht ein
 * Wiki-Link aus wie ein Sprung auf die Karte, und der Unterschied ist für den Redakteur wesentlich." (CANON)
 * §13.42, Ausführungsvorschrift: „Einmal, zentral — nie von Hand je Verweis. … Handgetippt bleibt er nirgends
 * vollständig." (CANON)
 *
 * 🔴 Betreiber 2026-10-07, wörtlich: „kannst du bei allein externen links immer das symbol ↗ verwenden ich glaub es
 * steht in den regeln, aber du hast jetzt bei den vorkommen (alles wiki-links ↗ nicht rangemacht - war schon in
 * legacy falsch)"
 *
 * 🪤 Seit 2026-10-30 sind die Vorkommensnamen KEINE Wiki-Links mehr: Sie öffnen die Infobox des Vorkommens (`loreEntry`), der
 * Artikel steht in deren Quellenkasten. Die Regel gilt dort (Fall 1); Fall 3 und 4 halten fest, dass ein Name ohne Ziel Text bleibt und
 * dass der Pfeil in einer langen Reihe von Wiki-Ankern (Stätten, oder eine gestellte Antwort) an seinem Namen hängt.
 *
 * 💣 **WARUM EIN FALL FÜR DAS GANZE HAUS UND NICHT EINER JE FENSTER.** Vor WI-0107 stand der Pfeil an sechs Stellen
 * einzeln und fehlte an sieben anderen. Jede dieser sieben Stellen sah für sich richtig aus — der Fehler war nur im
 * VERGLEICH zu sehen. Ein Wächter je Fenster hätte den Zustand, über den sich der Betreiber beschwert hat, sechsmal
 * grün gemeldet und die siebte Stelle nie gesehen. Hier läuft EIN Lauf durch alle Stellen, an denen ein Anker nach
 * draußen führt, und fragt jeden einzeln.
 *
 * 🔴 **Gefragt wird nicht nach einer Liste von Bauteilen, sondern nach der REGEL**, und die hat zwei Hälften:
 * (1) jeder sichtbare `a[target="_blank"]` MIT Text zeigt den Pfeil, jeder OHNE Text (ein Umschlagbild, ein
 * Markenzeichen) zeigt keinen — das ist §13.13; (2) **kein einziger trägt ihn im TEXT** — das ist §13.42, und ohne
 * diese zweite Hälfte wäre der Fall mit sechs handgetippten Pfeilen grün gewesen. Ein Anker, den morgen jemand neu
 * baut, fällt damit von selbst in den Fall — eine eingetragene Liste hätte ihn nicht gekannt.
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Worktrees auf dem Port, den `PORT` nennt (Vite liest daraus das
 * Proxyziel), und eine Entwicklungsdatenbank mit Quellen, Literatur und Vorkommen. Eigene Ports dieser Sitzung:
 *   $env:PORT="3277"; $env:E2E_PORT="5277"; npx playwright test e2e/externe-links.spec.ts
 */

/** Gareth: Quellenkasten mit ⓘ-Tafel, Publikationstafel, Literaturstreifen, Kartensammlung und Urheberzeile. */
const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } as const;
/** Der Hain der Weißen Maid: vier Quellenzeilen, davon eine mit Adresse und eine ohne (nur Text). */
const HAIN = { kind: "place", id: "46f2556a-88df-4a2c-bbb9-58cd36e6e176" } as const;
/** 🔴 Drunidet: der dichteste Fall des Bestands — 110 Tierarten in EINER kommagetrennten Reihe (WI-0099, WI-0104). */
const DRUNIDET = { kind: "place", id: "9a04121d-6f4d-533e-9207-05738e16bdf0" } as const;

/** Ein Fund: ein sichtbarer Anker, der die Seite verlässt. */
interface Fund {
    /** Wo er steht, für die Fehlermeldung. */
    ort: string;
    /** Woran man ihn im Quelltext findet. */
    wo: string;
    /** Sein sichtbarer Text, gekürzt. */
    text: string;
    /** Trägt er den Pfeil aus der Hausregel — an sich selbst oder an dem Kind, in dem sein Text steht? */
    pfeil: boolean;
    /** Oder steht er von Hand im Text? Das ist genau das, was der Guide verbietet. */
    handgetippt: boolean;
}

/**
 * Liest alle sichtbaren Anker mit `target="_blank"` der Seite und fragt je Anker, ob der Pfeil gezeichnet ist.
 *
 * 🪤 Gefragt wird am BERECHNETEN Wert, nicht am Markup: Der Pfeil ist erzeugter Inhalt (`::after`) und steht in
 * keinem `innerText`. 🪤 Und er darf an einem KIND hängen: Wo der Text des Ankers in einem eigenen Element steht
 * (die Kachel der Kartensammlung), trägt dieses Element den Pfeil — am Anker stünde er als eigene Zeile darunter.
 */
async function anker(page: Page, ort: string): Promise<Fund[]> {
    return page.evaluate((ort) => {
        const pfeilAn = (element: Element): boolean =>
            (getComputedStyle(element, "::after").content || "").includes("↗");
        const sichtbar = (element: Element): boolean => {
            const box = element.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) return false;
            return getComputedStyle(element).visibility !== "hidden";
        };
        const wo = (element: Element): string =>
            `${element.tagName.toLowerCase()}${element.className === "" ? "" : `.${String(element.className).split(/\s+/).join(".")}`}`;
        const raus: Fund[] = [];
        for (const element of document.querySelectorAll<HTMLElement>('a[target="_blank"]')) {
            if (!sichtbar(element)) continue;
            const kind = [...element.querySelectorAll("*")].some(pfeilAn);
            const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
            raus.push({
                ort,
                wo: wo(element),
                text: text.slice(0, 40),
                pfeil: pfeilAn(element) || kind,
                handgetippt: text.endsWith("↗"),
            });
        }
        return raus;
    }, ort);
}

async function openSubject(page: Page, ref: Record<string, unknown>): Promise<void> {
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await expect(page.getByTestId("info-title")).toBeVisible({ timeout: 30_000 });
}

/** Klappt die Vorkommenszeile einer Art auf und wartet auf das Register (die Namen kommen verzögert). */
async function expandLore(page: Page, kind: string): Promise<void> {
    const row = page.locator(`[data-field="lore:${kind}"]`);
    await row.waitFor({ timeout: 30_000 });
    await row.locator("button").first().click();
    await expect(row.getByTestId("info-lore-sheet").first()).toBeAttached({ timeout: 30_000 });
}

test.describe("🔴 der Pfeil nach draußen", () => {
    test("Fall 1: JEDER externe Link des Hauses trägt ihn — in EINEM Lauf über alle Stellen", async ({ page }) => {
        const funde: Fund[] = [];
        const je = new Map<string, number>();
        const sammeln = async (ort: string): Promise<void> => {
            const neu = await anker(page, ort);
            je.set(ort, neu.length);
            funde.push(...neu);
        };

        await openMap(page);

        // --- Das Infopanel: Quellenkasten, ⓘ-Tafel, Publikationen, Literatur, Kartensammlung, Urheberzeile -------
        await openSubject(page, GARETH);
        const box = page.getByTestId("info-source");
        await box.waitFor({ timeout: 30_000 });
        await box.getByTestId("info-source-info").first().click();
        await expect(page.getByTestId("info-source-rights").first()).toBeVisible({ timeout: 30_000 });
        const reiter = box.getByTestId("info-sources-pub").getByRole("button").first();
        if ((await reiter.count()) > 0) {
            await reiter.click();
            await expect(box.getByTestId("info-sources-list")).toBeVisible({ timeout: 30_000 });
        }
        await page.locator('[data-section="literature"]').waitFor({ timeout: 30_000 });
        await page.getByTestId("info-literature-strip").waitFor({ timeout: 30_000 });
        await page.locator('[data-section="citymaps"]').waitFor({ timeout: 30_000 });
        await page.getByTestId("info-citymaps-strip").waitFor({ timeout: 30_000 });
        await sammeln("Gareth, Infopanel");

        // --- Die Katalogfenster (WI-0118): zugeklappte Zeilen mit ihren Links, und ein aufgeklappter Eintrag mit Bild --------
        // Seit dort jeder Link nach draußen steht, die Kacheln im Streifen aber keiner mehr ist, gehören die Fenster in DIESEN Lauf:
        // Ein Anker, den morgen jemand neu baut, fällt von selbst in die Regel.
        for (const [abschnitt, tile, fenster] of [
            ["citymaps", "info-action-citymapsAll", "citymaps-window"],
            ["literature", "info-action-literatureAll", "literature-window"],
        ] as const) {
            await page.locator(`[data-section="${abschnitt}"]`).getByTestId(tile).click();
            const katalog = page.getByTestId(fenster);
            await expect(katalog.getByTestId("catalog-row").first()).toBeVisible({ timeout: 30_000 });
            await sammeln(`Gareth, Fenster ${abschnitt} (zugeklappt)`);
            await katalog
                .getByTestId("catalog-row")
                .filter({ hasNot: page.getByTestId("info-spoiler") })
                .nth(1)
                .getByTestId("catalog-row-toggle")
                .click();
            await expect(katalog.locator('[data-testid="catalog-row"][data-open]')).toHaveCount(1);
            await sammeln(`Gareth, Fenster ${abschnitt} (aufgeklappt)`);
            await page.keyboard.press("Escape");
            await expect(katalog).toBeHidden();
        }

        // --- Vier Quellenzeilen, davon eine ohne Adresse (die bleibt Text und ist hier gar kein Anker) -----------
        await openSubject(page, HAIN);
        await page.getByTestId("info-source").waitFor({ timeout: 30_000 });
        await sammeln("Hain der Weißen Maid, Quellenzeilen");

        // --- Die Vorkommensnamen: die Stelle, die der Betreiber 2026-10-07 gemeldet hat ----------------------------
        // Seit 2026-10-30 führt ein Name nicht mehr auf den Wiki-Artikel hinaus, sondern öffnet die Infobox des Vorkommens (`loreEntry`); der Artikel steht dort im Quellenkasten.
        // Die Station ist darum DIESER Quellenkasten, erreicht über den Namen - der Pfeil gehört dorthin, wo der Link jetzt steht.
        await ergaenzeEintrag(page);
        await openSubject(page, DRUNIDET);
        await expandLore(page, "fauna");
        await page
            .locator('[data-field="lore:fauna"] [data-testid="info-lore-names"] [data-testid="info-link"]')
            .first()
            .click();
        await expect(page.getByTestId("info-eintrag")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
        await page.getByTestId("info-source").waitFor({ timeout: 30_000 });
        await sammeln("Vorkommen, Quellenkasten");

        // --- Das Fenster „Hinweise": Lizenz, Datenquellen, Technik, Discord, Markenzeichen ----------------------
        await page.getByTestId("notes-open").click();
        const fenster = page.getByRole("dialog", { name: /Hinweise/ });
        await expect(fenster).toBeVisible({ timeout: 30_000 });
        for (const deckel of await fenster.locator("details > summary").all()) await deckel.click();
        await sammeln("Hinweise");
        await fenster.getByTestId("fenster-schliessen").click();

        // --- Die Statusseite: die Fundstellen des Überblicks ----------------------------------------------------
        await mockBackend(page, { repo: repo(true) });
        await page.goto("/status.html");
        await page.getByTestId("status-reiter-overview").click();
        await expect(page.getByTestId("overview-tab")).toBeVisible({ timeout: 30_000 });
        await sammeln("Statusseite, Überblick");

        // 💣 Ohne diese Schranke wäre der Fall auf einer leeren Seite grün. Jede Station muss wirklich Anker
        // geliefert haben, und die dichteste trägt dreistellig viele.
        for (const [ort, zahl] of je) expect(zahl, `keine externen Links gefunden: ${ort}`).toBeGreaterThan(0);
        // Der Quellenkasten des Vorkommens trägt den Wiki-Artikel (eine Zeile, ein Anker).
        expect(je.get("Vorkommen, Quellenkasten") ?? 0).toBeGreaterThanOrEqual(1);

        // 🔴 Erste Hälfte der Regel (§13.13): Was hinausführt und Text hat, ZEIGT den Pfeil.
        const ohne = funde.filter((fund) => fund.text !== "" && !fund.pfeil && !fund.handgetippt);
        expect(ohne.map((fund) => `${fund.ort} · ${fund.wo} · „${fund.text}"`)).toEqual([]);

        // 🔴 Zweite Hälfte (§13.42): „Einmal, zentral — nie von Hand je Verweis.“ Ein Pfeil, der IM TEXT steht,
        // ist genau die Stelle, die die nächste vergisst. Er darf nirgends mehr vorkommen.
        const vonHand = funde.filter((fund) => fund.handgetippt);
        expect(vonHand.map((fund) => `${fund.ort} · ${fund.wo} · „${fund.text}"`)).toEqual([]);

        // 🪤 Die Gegenrichtung gehört dazu: Ein Anker OHNE Text hat nichts, woran der Pfeil hängen könnte
        // (Legacys eigene, enge Ausnahme). Er darf ihn deshalb NICHT tragen.
        const zuviel = funde.filter((fund) => fund.text === "" && fund.pfeil);
        expect(zuviel.map((fund) => `${fund.ort} · ${fund.wo}`)).toEqual([]);
    });

    test("Fall 2: ein Link, der die Seite NICHT verlässt, bekommt keinen — Objektlink und Treppe", async ({ page }) => {
        await openMap(page);
        await openSubject(page, GARETH);
        // Die Treppe „Liegt in": jede Stufe ist ein Objektlink. 🔴 Es ist ein `<button>`, kein `<a>` — er führt
        // nirgends hin, er öffnet ein Subject. Legacy sagt es an seinem Gegenstück wörtlich
        // (css/features/lore.css): „Sieht aber aus wie ein Link … kein ↗, das steht für ‚verlässt die Seite'."
        // 🪤 Die Treppe kommt mit der Detailantwort, nicht mit dem Titel: Erst warten, dann zählen - unter Last
        // war der Panelkopf sonst schon da und die Treppe noch nicht (einmal rot im Volllauf, seriell grün).
        const stufen = page.getByTestId("info-stairs").getByTestId("info-link");
        await stufen.first().waitFor({ timeout: 30_000 });
        expect(await stufen.count()).toBeGreaterThan(0);
        const gezeichnet = await page.evaluate(() =>
            [...document.querySelectorAll('[data-testid="info-link"]')].map((element) => ({
                art: element.tagName.toLowerCase(),
                nach: getComputedStyle(element, "::after").content,
            })),
        );
        for (const link of gezeichnet) {
            expect(link.art).toBe("button");
            expect(link.nach).not.toContain("↗");
        }
    });

    test("Fall 3: ein Vorkommensname OHNE Ziel bleibt Text und bekommt keinen Pfeil; seine Nachbarn sind Objektlinks ohne", async ({
        page,
    }) => {
        /*
         * 🔴 **Der Fall kommt aus einer gestellten Antwort**: Der Server gibt heute JEDEM Vorkommen ein Ziel (die Infobox des Vorkommens,
         * `loreEntry`; vorher der Wiki-Artikel, `WIKI_HOST` in `subjects/sections/lore.ts` als Schleuse gegen `javascript:…`). Der Vertrag
         * (`LoreEntryView`) lässt einen Namen ohne `ref` und `url` aber zu, und dann darf dort weder ein Pfeil ohne Link noch ein toter Knopf
         * stehen. Gestellt wird nur das Ziel EINES Eintrags; Panel, Modell und Bauteil sind die echten.
         * Die Nachbarn sind Objektlinks (`<button>`, kein Anker): Sie führen nicht hinaus, also tragen sie keinen Pfeil.
         */
        let ohneArtikel = "";
        await page.route("**/api/subjects/place/*/lore*", async (route) => {
            const response = await route.fetch();
            const answer = (await response.json()) as {
                rows: { kind: string; groups: { entries: { name: string; url?: string; ref?: unknown }[] }[] }[];
            };
            for (const row of answer.rows) {
                if (row.kind !== "fauna") continue;
                const erste = row.groups[0]?.entries[0];
                if (erste === undefined) continue;
                delete erste.url;
                delete erste.ref;
                ohneArtikel = erste.name;
            }
            await route.fulfill({ response, json: answer });
        });
        await openMap(page);
        await openSubject(page, DRUNIDET);
        await expandLore(page, "fauna");
        expect(ohneArtikel.length).toBeGreaterThan(0);
        const gemessen = await page.evaluate((name) => {
            const bloecke = [...document.querySelectorAll('[data-field="lore:fauna"] [data-testid="info-lore-names"]')];
            const links = bloecke.flatMap((block) => [...block.querySelectorAll("a.info-lore__wiki")]);
            const knoepfe = bloecke.flatMap((block) => [...block.querySelectorAll('[data-testid="info-link"]')]);
            const ersteSeite = bloecke[0];
            return {
                /** Steht der Name überhaupt da? */
                steht: bloecke.some((block) => (block.textContent ?? "").includes(name)),
                /** Als Anker? Als Knopf? Beides wäre falsch - er hat kein Ziel. */
                alsAnker: links.some((link) => (link.textContent ?? "").trim() === name),
                alsKnopf: knoepfe.some((knopf) => (knopf.textContent ?? "").trim() === name),
                /** Kein Name der Reihe führt noch auf einen Wiki-Artikel hinaus. */
                wikiAnker: links.length,
                /** Die Nachbarn im selben Block sind Objektlinks auf die Infobox ihres Vorkommens - Knöpfe, ohne Pfeil. */
                nachbarn: knoepfe.length,
                pfeilAmNachbarn: knoepfe.map((knopf) => getComputedStyle(knopf, "::after").content),
                /** Und im rohen Text des Blocks steht kein Pfeil. */
                roh: ersteSeite?.textContent ?? "",
            };
        }, ohneArtikel);
        expect(gemessen.steht).toBe(true);
        expect(gemessen.alsAnker).toBe(false);
        expect(gemessen.alsKnopf).toBe(false);
        expect(gemessen.roh).not.toContain("↗");
        expect(gemessen.wikiAnker).toBe(0);
        expect(gemessen.nachbarn).toBeGreaterThan(100);
        expect(gemessen.pfeilAmNachbarn.filter((nach) => nach.includes("↗"))).toEqual([]);
    });

    test("Fall 4: das geschützte Leerzeichen hält den Pfeil an seinem Namen — gemessen gegen ein gewöhnliches", async ({
        page,
    }) => {
        /*
         * 🪤 110 Pfeile in einer kommagetrennten Reihe sind etwas anderes als einer in einer Quellenzeile: Die Reihe
         * trägt `overflow-wrap: anywhere` (WI-0099, gegen Namen, die breiter sind als die Spalte), und damit darf
         * Chromium zwischen JE ZWEI Zeichen umbrechen - auch zwischen einem Namen und seinem Pfeil. Dann steht der
         * Pfeil allein am Anfang der nächsten Zeile.
         *
         * 🔴 Die Hausregel setzt deshalb ein GESCHÜTZTES Leerzeichen (`\a0`), und dieser Fall hält fest, dass es
         * wirklich eines ist UND dass es wirkt: Dieselbe Seite wird zweimal gemessen, einmal wie gebaut und einmal
         * mit einem gewöhnlichen Leerzeichen davor. Verglichen wird, nicht gegen eine erfundene Zahl geprüft -
         * ganz verhindern kann `\a0` den Umbruch gegen `anywhere` nicht, und eine Schwelle wäre geraten.
         * Die absoluten Zahlen stehen als Befund im Work Item und auf dem Blatt.
         *
         * 🪤 Die Reihe der 110 Tierarten besteht seit 2026-10-30 aus Objektlinks auf die Infobox des Vorkommens, nicht mehr aus Wiki-Ankern. Das Bauteil kann beides (Stätten
         * tragen weiter Wiki-Anker), und die Hausregel gegen den abgerissenen Pfeil gilt dem Anker: Darum stellt dieser Fall die Antwort so, wie sie vor dem 2026-10-30 war - jeder Name
         * mit seiner Wiki-Adresse, ohne `ref`. Panel, Modell und Bauteil sind die echten.
         */
        await page.route("**/api/subjects/place/*/lore*", async (route) => {
            const response = await route.fetch();
            const answer = (await response.json()) as {
                rows: { groups: { entries: { name: string; url?: string; ref?: unknown }[] }[] }[];
            };
            for (const row of answer.rows) {
                for (const gruppe of row.groups) {
                    for (const eintrag of gruppe.entries) {
                        eintrag.url = `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(eintrag.name)}`;
                        delete eintrag.ref;
                    }
                }
            }
            await route.fulfill({ response, json: answer });
        });
        await openMap(page);
        await openSubject(page, DRUNIDET);
        await expandLore(page, "fauna");

        const abgerissen = async (): Promise<number> =>
            page.evaluate(() => {
                const bloecke = [
                    ...document.querySelectorAll('[data-field="lore:fauna"] [data-testid="info-lore-names"]'),
                ];
                let zahl = 0;
                for (const link of bloecke.flatMap((block) => [...block.querySelectorAll("a.info-lore__wiki")])) {
                    // Jedes Bruchstück des Ankers ist ein Rechteck; das LETZTE ist der Pfeil. Liegt es tiefer als
                    // das Bruchstück davor, hat der Umbruch ihn von seinem Namen gerissen.
                    const stuecke = [...link.getClientRects()];
                    const letztes = stuecke.at(-1);
                    const davor = stuecke.at(-2);
                    if (stuecke.length > 1 && (letztes?.top ?? 0) > (davor?.top ?? 0) + 1) zahl += 1;
                }
                return zahl;
            });

        const schutz = await page.evaluate(() => {
            const link = document.querySelector('[data-field="lore:fauna"] a.info-lore__wiki');
            return link === null ? "" : getComputedStyle(link, "::after").content;
        });
        expect(schutz).toContain(" ");

        const mitSchutz = await abgerissen();
        // 🪤 Kein Warten nötig: `getClientRects()` erzwingt den Umbau, das Stilblatt wirkt im selben Zug.
        const tag = await page.addStyleTag({ content: 'a[target="_blank"]::after { content: " \\2197" / ""; }' });
        const ohneSchutz = await abgerissen();
        await tag.evaluate((element: Element) => element.remove());

        expect(ohneSchutz).toBeGreaterThan(mitSchutz);
    });
});
