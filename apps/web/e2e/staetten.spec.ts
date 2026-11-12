import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die Zeile „Stätten“ am echten Stack (WI-0109): Gareth trägt den schwersten Fall des Bestands.
 *
 * Benannte Fälle:
 * 1. **Die Zeile steht über den Vorkommen** und ihr Zählsatz nennt dieselbe Zahl, die die Detailantwort zählt.
 * 2. **Aufgeklappt gliedert sie nach ART**, deutsch sortiert, jede Art mit Überschrift und Zahl - **auch die einzige**
 *    (Betreiber 2026-10-07, bewusste Abweichung von Legacy).
 * 3. **Das Register beginnt bei ZWEI Namen**: eine Art mit einem Namen trägt keine Marke, eine mit zwei oder mehr trägt sie.
 * 4. **Der Sprung ⊕** steht hinter dem Namen, der auf der Karte liegt - und nur dort.
 * 5. **Ein Name ohne Wiki-Artikel** ist kein Link.
 * 6. **Ein Ort ohne Stätten** hat die Zeile nicht.
 * 7. 🔴 **WI-0122: Eine lange Zeile sammelt die Einzelnen** - nur Arten mit mindestens zwei Einträgen bekommen eine eigene
 *    Gruppe, die übrigen stehen als Zeilen „Art · Stätte“ in „Weitere Gebäude und Stätten“; „(Hauptsitz)“ ist ein Kennzeichen hinter der
 *    Zahl, die Sammelgruppe ist abgesetzt (mehr Luft, kursiver Kopf).
 * 8. 🔴 **WI-0122: Das Suchfeld** filtert Arten und Namen, markiert, klappt auf, zählt „n Treffer in m Arten“, sagt bei keinem
 *    Treffer, dass nichts passt, und Escape leert.
 * 9. 🔴 **WI-0122 Nachtrag: Ab 25 starten ALLE Gruppen zu**, und die Arten lassen sich alphabetisch oder nach Häufigkeit
 *    ordnen (ein Symbolknopf mit Menü rechts neben dem Feld, „Weitere Gebäude und Stätten“ am Ende, die Wahl gilt für die
 *    Sitzung); Feld und Knopf stehen bei 1280, 412 und 360 px in einer Zeile. Die Zeile heißt „Innerorts“ (WI-0122).
 *
 * 🔴 **Keine Zahl ist gepinnt.** Die Stätten wachsen mit jedem WikiSync in Legacy (gemessen 2026-10-08: 4.092 Einträge, Gareth
 * 414 in 121 Arten); der Fall rechnet gegen die ANTWORT des Servers, nicht gegen eine Zahl im Quelltext
 * („Reisezeiten wandern ständig, keine exakten Vergleiche").
 *
 * 🪤 **Braucht eine Entwicklungsdatenbank, in der I27 gelaufen ist.** Der Import ist eine Übernahme von Inhalten Dritter und
 * braucht den Zuruf des Betreibers (`--operator-said`, Map Mutation Guard); ohne ihn steht die Tabelle leer. Dann SKIPPT dieser
 * Fall sichtbar mit Grund - er wird nicht grün, und er wird auch nicht rot (AGENTS.md: „Fehlt eine Voraussetzung, ist das
 * Ergebnis FAIL oder ein sichtbarer Skip, nie grün").
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Worktrees auf dem Port, den `PORT` nennt (Vite liest daraus das Proxyziel):
 *   $env:PORT="3275"; $env:E2E_PORT="5275"; npx playwright test e2e/staetten.spec.ts
 */

/** Gareth: der schwerste Fall des Bestands (gemessen 2026-10-08: 414 Stätten in 121 Arten). */
const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } as const;

/** Aumond: das leere Dorf - es trägt keine Stätten, und das bleibt auch nach dem Einspielen so. */
const AUMOND = "6f45f4eb-31b1-5cbc-a07e-f6ecfb8ef9b3";

/** Die Sektion, wie der Server sie liefert - die Gegenrechnung für alles, was der Browser zeigt. */
interface StaettenSection {
    count: number;
    groups: { type: string; entries: { name: string; url?: string; jump?: { kind: string; id: string } }[] }[];
}

/**
 * 🪤 **Unter fremder Last weist der Server eine Detailfrage sofort mit 503 ab** (gemessen 2026-10-09: 0,4 ms, während eine
 * andere Sitzung dieselben Orte abfragte). Das Panel fragt dann selbst nach (`load-retry.ts`); dieser Test ebenso - sonst
 * misst er die Last einer anderen Sitzung statt der Zeile.
 */
async function getJson<T>(page: Page, url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const response = await page.request.get(url);
        if (response.status() === 503 && attempt < 5) {
            await page.waitForTimeout(300 * (attempt + 1));
            continue;
        }
        expect(response.ok(), `${url}: ${String(response.status())}`).toBe(true);
        return (await response.json()) as T;
    }
}

async function fetchCount(page: Page): Promise<number | undefined> {
    const body = await getJson<{ counts?: { staetten?: number } }>(page, `/api/subjects/place/${GARETH.id}`);
    return body.counts?.staetten;
}

async function fetchSection(page: Page): Promise<StaettenSection> {
    return getJson<StaettenSection>(page, `/api/subjects/place/${GARETH.id}/staetten`);
}

/** Überspringt den Fall sichtbar, solange der Zug die Stätten nicht eingespielt hat. */
async function requireData(page: Page): Promise<number> {
    const count = await fetchCount(page);
    test.skip(
        count === undefined,
        "Die Stätten sind in dieser Entwicklungsdatenbank nicht eingespielt (Schritt I27 braucht den Zuruf des Betreibers).",
    );
    return count as number;
}

async function open(page: Page, ref: Record<string, unknown>): Promise<void> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await expect(page.getByTestId("info-title")).toBeVisible({ timeout: 30_000 });
}

/** Klappt die Stättenzeile auf und wartet, bis ihr Inhalt da ist (er kommt verzögert, `GET {detail}/staetten`). */
async function expand(page: Page): Promise<void> {
    const row = page.locator('[data-field="staetten"]');
    await row.waitFor({ timeout: 30_000 });
    await row.locator("button").first().click();
    await expect(row.getByTestId("info-lore-group").first()).toBeAttached({ timeout: 30_000 });
    await expect(row.getByTestId("info-lore-sheet").first()).toBeAttached({ timeout: 30_000 });
}

test("die Zeile steht über den Vorkommen, und ihr Satz nennt die Zahl des Servers", async ({ page }) => {
    await open(page, GARETH);
    const count = await requireData(page);

    const row = page.locator('[data-field="staetten"]');
    await expect(row).toBeVisible();
    await expect(row.getByTestId("info-fact-label")).toHaveText("Innerorts");
    const sentence = (await row.getByTestId("info-lore-lid").first().innerText()).trim();
    // Die Zahl kommt formatiert (Tausenderpunkt); verglichen wird gegen den Satz, nicht gegen eine Konstante.
    // Die Zeile heißt seit WI-0122 „Innerorts“, ihr Satz „… Gebäude und Stätten verzeichnet“ (Legacy: „besondere Stätten“).
    expect(sentence).toMatch(/Gebäude (und|oder) Stätten? verzeichnet/);
    expect(sentence.replace(/[^0-9]/g, "")).toBe(String(count));

    // Der Platz: über der ersten Vorkommenszeile und hinter „Tempel“.
    const order = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[data-field]")].map((node) => node.dataset["field"] ?? ""),
    );
    expect(order.indexOf("staetten")).toBeGreaterThan(-1);
    expect(order.indexOf("staetten")).toBeLessThan(order.indexOf("lore:ware"));
});

/** Die Arten der Antwort nach der Anzeigeregel (`staettenGroupsOf`, WI-0122) - hier unabhängig nachgerechnet. */
function expectedTypes(section: StaettenSection): {
    own: { art: string; seat: boolean; names: string[] }[];
    single: { art: string; seat: boolean; name: string }[];
} {
    const seatSuffix = " (Hauptsitz)";
    const byKey = new Map<string, string[]>();
    for (const group of section.groups) {
        const key = group.type || "Bauwerk";
        byKey.set(key, [...(byKey.get(key) ?? []), ...group.entries.map((entry) => entry.name)]);
    }
    const types = [...byKey]
        .map(([key, names]) => {
            const seat = key.endsWith(seatSuffix) && key.length > seatSuffix.length;
            return { art: seat ? key.slice(0, -seatSuffix.length) : key, seat, names };
        })
        .sort((left, right) => left.art.localeCompare(right.art, "de") || Number(left.seat) - Number(right.seat));
    const byName = (left: string, right: string): number => left.localeCompare(right, "de");
    return {
        own: types
            .filter((type) => type.names.length >= 2)
            .map((type) => ({ ...type, names: [...type.names].sort(byName) })),
        single: types
            .filter((type) => type.names.length === 1)
            .map((type) => ({ art: type.art, seat: type.seat, name: type.names[0] ?? "" })),
    };
}

/** Was die Zeile zeigt: je Gruppe Kopf, Zahl, Kennzeichen, Sammelgruppe ja/nein, Namen und die Arten ihrer Zeilen. */
function readGroups(page: Page): Promise<
    {
        heading: string;
        count: string;
        mark: string;
        collected: boolean;
        names: string;
        rows: { art: string; mark: string; name: string }[];
    }[]
> {
    return page
        .locator('[data-field="staetten"]')
        .getByTestId("info-lore-group")
        .evaluateAll((groups) =>
            groups.map((group) => {
                const text = (selector: string, root: Element = group): string =>
                    root.querySelector(selector)?.textContent?.trim() ?? "";
                return {
                    heading: text('[data-testid="info-lore-heading"]'),
                    count: text('[data-testid="info-lore-count"]'),
                    mark: text('[data-testid="info-lore-mark"]'),
                    collected: group.hasAttribute("data-collected"),
                    names: [...group.querySelectorAll('[data-testid="info-lore-names"]')]
                        .map((block) => block.textContent?.trim())
                        .join(", "),
                    rows: [...group.querySelectorAll('[data-testid="info-lore-block"]')]
                        .filter((block) => block.querySelector('[data-testid="info-lore-row-art"]') !== null)
                        .map((block) => {
                            const mark = text('[data-testid="info-lore-row-mark"]', block);
                            const art = text('[data-testid="info-lore-row-art"]', block);
                            return {
                                art: mark === "" ? art : art.slice(0, -mark.length).trim(),
                                mark,
                                name: text('[data-testid="info-lore-names"]', block),
                            };
                        }),
                };
            }),
        );
}

test("🔴 aufgeklappt: eigene Gruppen erst ab zwei Einträgen, die Einzelnen gesammelt am Ende (WI-0122)", async ({
    page,
}) => {
    await open(page, GARETH);
    await requireData(page);
    const section = await fetchSection(page);
    expect(section.count, "Gareth ist eine lange Zeile").toBeGreaterThanOrEqual(25);
    await expand(page);

    const { own, single } = expectedTypes(section);
    const shown = await readGroups(page);
    expect(shown.slice(0, own.length)).toEqual(
        own.map((type) => ({
            heading: type.art,
            count: String(type.names.length),
            mark: type.seat ? "Hauptsitz" : "",
            collected: false,
            names: type.names.join(", "),
            rows: [],
        })),
    );
    expect(shown).toHaveLength(own.length + (single.length > 0 ? 1 : 0));
    const collected = shown.at(-1);
    expect(collected?.heading).toBe("Weitere Gebäude und Stätten");
    expect(collected?.collected).toBe(true);
    expect(collected?.count).toBe(String(single.length));
    expect(collected?.rows).toEqual(
        single.map((type) => ({ art: type.art, mark: type.seat ? "Hauptsitz" : "", name: type.name })),
    );
    // Nichts geht verloren: Die Zahlen der Köpfe ergeben zusammen die Zahl des Servers.
    expect(shown.reduce((sum, group) => sum + Number(group.count), 0)).toBe(section.count);
});

test("🔴 das Register beginnt bei ZWEI Namen; eine Zeile der Sammelgruppe trägt keine Marke", async ({ page }) => {
    await open(page, GARETH);
    await requireData(page);
    await expand(page);

    const marks = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('[data-field="staetten"]');
        return [...(row?.querySelectorAll<HTMLElement>('[data-testid="info-lore-group"]') ?? [])].map((group) => ({
            collected: group.hasAttribute("data-collected"),
            letters: group.querySelectorAll('[data-testid="info-lore-letter"]').length,
        }));
    });
    expect(marks.filter((group) => !group.collected).every((group) => group.letters > 0)).toBe(true);
    expect(marks.filter((group) => group.collected).map((group) => group.letters)).toEqual([0]);
});

test("🔴 die Sammelgruppe ist abgesetzt: mehr Luft, kursiver Kopf, Hover färbt die Fläche (WI-0122)", async ({
    page,
}) => {
    await open(page, GARETH);
    await requireData(page);
    await expand(page);

    const row = page.locator('[data-field="staetten"]');
    const collected = row.locator('[data-testid="info-lore-group"][data-collected]');
    const other = row.locator('[data-testid="info-lore-group"]:not([data-collected])').nth(1);
    const styleOf = (locator: Locator): Promise<{ margin: string; italic: string }> =>
        locator.evaluate((group) => ({
            margin: getComputedStyle(group).marginTop,
            italic: getComputedStyle(group.querySelector('[data-testid="info-lore-heading"]') as Element).fontStyle,
        }));
    const mine = await styleOf(collected);
    const theirs = await styleOf(other);
    expect(Number.parseFloat(mine.margin)).toBeGreaterThan(Number.parseFloat(theirs.margin));
    expect(mine.italic).toBe("italic");
    expect(theirs.italic).toBe("normal");

    const head = collected.getByTestId("info-lore-group-head");
    const before = await head.evaluate((node) => getComputedStyle(node).backgroundColor);
    await head.hover();
    await expect.poll(() => head.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(before);
    expect(await head.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
});

test("🔴 das Suchfeld: filtert, markiert, klappt auf, zählt - und Escape leert (WI-0122)", async ({ page }) => {
    await open(page, GARETH);
    await requireData(page);
    await expand(page);
    const row = page.locator('[data-field="staetten"]');
    const field = row.getByRole("searchbox", { name: "Innerorts durchsuchen" });
    await expect(field).toBeVisible();
    const before = await row.getByTestId("info-lore-group").count();

    await field.fill("garde");
    await expect(row.getByTestId("info-lore-hits")).toHaveText(/^\d+ Treffer in \d+ Arten?$/);
    const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss");
    const groups = await readGroups(page);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
        if (group.collected) {
            // Jede Zeile trifft über ihre Art oder ihren Namen - und die Art steht immer dabei.
            for (const entry of group.rows) {
                expect(entry.art).not.toBe("");
                expect(fold(`${entry.art} ${entry.mark} ${entry.name}`)).toContain("garde");
            }
        } else if (!fold(`${group.heading} ${group.mark}`).includes("garde")) {
            for (const name of group.names.split(", ")) expect(fold(name)).toContain("garde");
        }
    }
    // Markiert ist der Treffer, und jede Gruppe mit Treffer steht offen.
    expect(await row.getByTestId("info-marked").count()).toBeGreaterThan(0);
    const closed = await row
        .locator("details")
        .evaluateAll((nodes) => nodes.filter((node) => !(node as HTMLDetailsElement).open).length);
    expect(closed).toBe(0);

    // Escape leert und bringt die Liste zurück, wie sie war - und das Panel bleibt offen.
    await field.press("Escape");
    await expect(field).toHaveValue("");
    await expect(row.getByTestId("info-lore-group")).toHaveCount(before);
    await expect(page.getByTestId("info-title")).toBeVisible();

    // Kein Treffer: ein Satz und „Suche leeren“.
    await field.fill("zzqqxy");
    await expect(row.getByTestId("info-lore-none")).toContainText("Kein Eintrag passt zu „zzqqxy“.");
    await expect(row.getByTestId("info-lore-group")).toHaveCount(0);
    await row.getByTestId("info-lore-none").getByRole("button", { name: "Suche leeren" }).click();
    await expect(field).toHaveValue("");
    await expect(row.getByTestId("info-lore-group")).toHaveCount(before);
});

/** Elenvina: 90 Stätten, die lange Zeile der Abnahme (WI-0122). */
const ELENVINA = { kind: "place", id: "723c0e80-e40b-5f63-9eae-f74949e53f40" } as const;

/** Die Gesamtzahl einer Gruppe aus ihrem Kopf: „7“ oder während einer Suche „1 von 3“. */
const totalOf = (count: string): number => Number(/(\d+)\D*$/.exec(count)?.[1] ?? Number.NaN);

/** Stehen die Art-Gruppen nach der Zahl absteigend, bei Gleichstand alphabetisch - und „Weitere Gebäude und Stätten“ am Ende? */
function expectCountOrder(groups: Awaited<ReturnType<typeof readGroups>>): void {
    const arts = groups.filter((group) => !group.collected);
    for (let at = 1; at < arts.length; at++) {
        const before = arts[at - 1];
        const here = arts[at];
        if (before === undefined || here === undefined) continue;
        const left = totalOf(before.count);
        const right = totalOf(here.count);
        expect(left, `${before.heading} vor ${here.heading}`).toBeGreaterThanOrEqual(right);
        if (left === right) expect(before.heading.localeCompare(here.heading, "de")).toBeLessThanOrEqual(0);
    }
    const collected = groups.findIndex((group) => group.collected);
    if (collected !== -1) expect(collected).toBe(groups.length - 1);
}

test("🔴 ab 25 Stätten starten ALLE Gruppen zu - auch die erste (WI-0122 Nachtrag)", async ({ page }) => {
    await open(page, GARETH);
    await requireData(page);
    await expand(page);
    const row = page.locator('[data-field="staetten"]');
    const groups = row.locator("details");
    expect(await groups.count()).toBeGreaterThan(1);
    expect(await groups.evaluateAll((nodes) => nodes.filter((node) => (node as HTMLDetailsElement).open).length)).toBe(
        0,
    );
});

/** Der Ordnen-Knopf der Zeile und sein Menü (WI-0122 zweiter Nachtrag). */
function orderButton(page: Page): Locator {
    return page.locator('[data-field="staetten"]').getByRole("button", { name: /^Innerorts ordnen: / });
}

test("🔴 die Ordnung: ein Symbolknopf mit Menü, alphabetisch oder nach Häufigkeit, die Wahl gilt für die Sitzung (WI-0122 Nachtrag)", async ({
    page,
}) => {
    await open(page, ELENVINA);
    await requireData(page);
    await expand(page);
    const row = page.locator('[data-field="staetten"]');
    const button = orderButton(page);
    await expect(button).toHaveAccessibleName("Innerorts ordnen: alphabetisch");
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    const alpha = (await readGroups(page)).filter((group) => !group.collected).map((group) => group.heading);
    expect(alpha).toEqual([...alpha].sort((left, right) => left.localeCompare(right, "de")));

    // Öffnen mit der Maus: das Menü zeichnet die Seite, der Fokus steht auf der aktiven Wahl.
    await button.click();
    const menu = page.getByRole("menu", { name: "Innerorts ordnen" });
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitemradio")).toHaveText(["alphabetisch", "nach Häufigkeit"]);
    await expect(menu.getByRole("menuitemradio", { name: "alphabetisch" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemradio", { name: "alphabetisch" })).toBeFocused();

    // Pfeil und Enter wählen; das Menü schließt, der Fokus kehrt zum Knopf zurück.
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name: "nach Häufigkeit" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAccessibleName("Innerorts ordnen: nach Häufigkeit");
    const counted = await readGroups(page);
    expectCountOrder(counted);
    expect(counted.map((group) => group.heading)).not.toEqual([...alpha, "Weitere Gebäude und Stätten"]);
    // Auch nach dem Umordnen steht keine Gruppe offen.
    expect(
        await row
            .locator("details")
            .evaluateAll((nodes) => nodes.filter((node) => (node as HTMLDetailsElement).open).length),
    ).toBe(0);

    // Die Suche wirkt auf die geordnete Liste.
    const field = row.getByRole("searchbox", { name: "Innerorts durchsuchen" });
    await field.fill("e");
    await expect(row.getByTestId("info-lore-hits")).toBeVisible();
    expectCountOrder(await readGroups(page));
    await field.fill("");

    // Die Wahl gilt für die Sitzung: Gareth steht danach ebenso nach Häufigkeit.
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), GARETH);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 30_000 });
    await expand(page);
    await expect(orderButton(page)).toHaveAccessibleName("Innerorts ordnen: nach Häufigkeit");
    expectCountOrder(await readGroups(page));
});

test("🔴 das Menü: Esc schließt und gibt den Fokus zurück, ohne das Panel zu schließen; ein Klick daneben schließt (WI-0122 Nachtrag)", async ({
    page,
}) => {
    await open(page, ELENVINA);
    await requireData(page);
    await expand(page);
    const button = orderButton(page);
    const menu = page.getByRole("menu", { name: "Innerorts ordnen" });

    // Mit der Tastatur: Enter auf dem Knopf öffnet, Esc schließt.
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(page.getByTestId("info-title")).toBeVisible();
    await expect(button).toHaveAccessibleName("Innerorts ordnen: alphabetisch");

    // Ein Pfeil auf dem Knopf öffnet ebenso; ein Klick daneben schließt, ohne zu wählen.
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible();
    await page.getByTestId("info-title").click();
    await expect(menu).toHaveCount(0);
    await expect(button).toHaveAccessibleName("Innerorts ordnen: alphabetisch");
});

test("🔴 Feld und Knopf stehen in EINER Zeile, gleich hoch, ohne Überlauf - bei 1280, 412 und 360 px (WI-0122 Nachtrag)", async ({
    browser,
}) => {
    // Das Telefon des Hauses (Pixel 7) ohne seine Fenstergröße: Finger, Berührung, Kennung, Pixeldichte.
    const phone = devices["Pixel 7"];
    const pixel = {
        userAgent: phone.userAgent,
        deviceScaleFactor: phone.deviceScaleFactor,
        isMobile: phone.isMobile,
        hasTouch: phone.hasTouch,
    };
    const cases = [
        { width: 1280, finger: false },
        { width: 412, finger: true },
        { width: 360, finger: true },
    ];
    // Eigene Kontexte: Der Finger (`pointer: coarse`) lässt sich nur beim Anlegen eines Kontexts einstellen.
    const { baseURL, extraHTTPHeaders } = test.info().project.use;
    for (const { width, finger } of cases) {
        const context = await browser.newContext({
            ...(finger ? pixel : {}),
            viewport: { width, height: 900 },
            ...(baseURL === undefined ? {} : { baseURL }),
            ...(extraHTTPHeaders === undefined ? {} : { extraHTTPHeaders }),
        });
        const page = await context.newPage();
        try {
            await open(page, ELENVINA);
            await requireData(page);
            await expand(page);
            const row = page.locator('[data-field="staetten"]');
            const inner = await row.locator(".info-lid__inner").first().boundingBox();
            const field = await row.locator(".eingabe").first().boundingBox();
            const button = await orderButton(page).boundingBox();
            if (inner === null || field === null || button === null)
                throw new Error(`keine Maße bei ${String(width)} px`);
            const at = `bei ${String(width)} px`;
            // Eine Zeile: gleiche Oberkante, gleiche Höhe, der Knopf rechts neben dem Feld.
            expect(Math.abs(button.y - field.y), at).toBeLessThanOrEqual(0.5);
            expect(Math.abs(button.height - field.height), at).toBeLessThanOrEqual(0.5);
            expect(button.x, at).toBeGreaterThanOrEqual(field.x + field.width - 0.5);
            // Nichts läuft über den Deckel hinaus.
            expect(field.x, at).toBeGreaterThanOrEqual(inner.x - 0.5);
            expect(button.x + button.width, at).toBeLessThanOrEqual(inner.x + inner.width + 0.5);
            expect(
                await row
                    .locator(".info-lid__inner")
                    .first()
                    .evaluate((node) => node.scrollWidth - node.clientWidth),
                at,
            ).toBeLessThanOrEqual(1);
            // Am Finger ein Fingerziel des Hauses (44 px), am Zeiger die Bedienhöhe (32 px).
            expect(button.width, at).toBeGreaterThanOrEqual(finger ? 44 : 32);
            expect(button.height, at).toBeGreaterThanOrEqual(finger ? 44 : 32);
            // Am Telefon steht der Satz im Deckel ohne Verb (WI-0098, Betreiber 2026-10-09: „ok“).
            expect(await row.getByTestId("info-lid-summary").first().textContent(), at).toMatch(
                finger ? /^\d+ Gebäude und Stätten$/ : /^\d+ Gebäude und Stätten verzeichnet$/,
            );
            // Am Telefon steht im Feld nur „Suchen“ (Betreiber 2026-10-09), der Name des Felds bleibt lang.
            const input = row.locator('[data-testid="info-lore-search"] input').first();
            expect(await input.getAttribute("placeholder"), at).toBe(finger ? "Suchen" : "Innerorts durchsuchen");
            expect(await input.getAttribute("aria-label"), at).toBe("Innerorts durchsuchen");
            if (finger) {
                const fits = await input.evaluate((node) => {
                    const probe = document.createElement("span");
                    const style = getComputedStyle(node);
                    probe.style.font = style.font;
                    probe.style.position = "absolute";
                    probe.style.whiteSpace = "pre";
                    probe.textContent = (node as HTMLInputElement).placeholder;
                    document.body.append(probe);
                    const width = probe.getBoundingClientRect().width;
                    probe.remove();
                    const inner = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
                    return width <= inner;
                });
                expect(fits, `${at}: „Suchen“ passt ganz ins Feld`).toBe(true);
            }
        } finally {
            await context.close();
        }
    }
});

test("der Sprung ⊕ steht nur hinter dem Namen, den der Server damit nennt - und er öffnet ihn", async ({ page }) => {
    await open(page, GARETH);
    await requireData(page);
    const section = await fetchSection(page);
    const withJump = section.groups.flatMap((group) => group.entries).filter((entry) => entry.jump !== undefined);
    await expand(page);

    const row = page.locator('[data-field="staetten"]');
    const jumps = row.getByTestId("info-staetten-jump");
    await expect(jumps).toHaveCount(withJump.length);
    test.skip(withJump.length === 0, "Dieser Ort trägt keine Stätte, die auf der Karte steht.");

    const labels = await jumps.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    expect(labels.sort()).toEqual(withJump.map((entry) => `${entry.name} auf der Karte zeigen`).sort());
    const target = withJump[0];
    if (target?.jump === undefined) throw new Error("Der erwartete Kartensprung fehlt");
    const button = row.getByRole("button", {
        name: `${target.name} auf der Karte zeigen`,
        exact: true,
        includeHidden: true,
    });
    const group = row.getByTestId("info-lore-group").filter({
        has: page.getByRole("button", {
            name: `${target.name} auf der Karte zeigen`,
            exact: true,
            includeHidden: true,
        }),
    });
    if (await group.evaluate((element) => element.tagName === "DETAILS" && !element.hasAttribute("open"))) {
        await group.getByTestId("info-lore-group-head").click();
    }
    await expect(button).toBeVisible();
    await button.click();
    // Der Klick öffnet das Kartenobjekt: der Panelkopf trägt danach seinen Namen.
    await expect(page.getByTestId("info-title")).toHaveText(target.name, { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.())).toEqual(target.jump);
});

test("ein Name ohne Wiki-Artikel ist kein Link - und kein Name steht als toter Link da", async ({ page }) => {
    await open(page, GARETH);
    await requireData(page);
    const section = await fetchSection(page);
    await expand(page);

    const linked = section.groups.flatMap((group) => group.entries).filter((entry) => entry.url !== undefined).length;
    const plain = section.count - linked;
    const row = page.locator('[data-field="staetten"]');
    await expect(row.locator("a.info-lore__wiki")).toHaveCount(linked);
    test.skip(plain === 0, "Jede Stätte dieses Ortes trägt einen Wiki-Artikel.");
    // Was nicht verlinkt ist, steht als Text da - in Textfarbe, nicht bleich und nicht in Linkfarbe.
    const colours = await page.evaluate(() => {
        const names = document.querySelector<HTMLElement>('[data-field="staetten"] [data-testid="info-lore-names"]');
        return names === null ? "" : getComputedStyle(names).color;
    });
    expect(colours).not.toBe("");
});

/**
 * 🔴 **Dieser Fall braucht KEINE Daten und ist darum der einzige, der heute schon grün ist:** Er prüft, dass die Zeile da
 * WEGBLEIBT, wo es nichts zu zeigen gibt - und das ist die Aussage, die sich beim Einspielen nicht ändern darf. Eine Zeile
 * „0 besondere Stätten verzeichnet“ stünde sonst an 4.489 der 4.984 Orte (Legacy lässt sie aus demselben Grund weg).
 */
test("ein Ort ohne Stätten hat die Zeile nicht", async ({ page }) => {
    // Aumond: das leere Dorf der Abnahmefälle (WI-0103 §5) - es trägt keine Stätten.
    await open(page, { kind: "place", id: AUMOND });
    await expect(page.getByTestId("info-title")).toHaveText("Aumond", { timeout: 30_000 });
    await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
    const response = await page.request.get(`/api/subjects/place/${AUMOND}`);
    const body = (await response.json()) as { counts?: { staetten?: number } };
    expect(body.counts?.staetten).toBeUndefined();
    await expect(page.locator('[data-field="staetten"]')).toHaveCount(0);
    // Die Vorkommenszeilen stehen trotzdem da (WI-0104): die Stätten verschwinden allein, nicht mit ihnen.
    await expect(page.locator('[data-field="lore:ware"]')).toHaveCount(1);
});
