import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * WI-0088: Das Infopanel bleibt ruhig, während sein Inhalt kommt — am echten Stack gemessen.
 *
 * P1 (A1–A10): Das Panel geht sofort auf und zeigt sofort, was die Karte weiß; der eintreffende Inhalt wird EINGEBLENDET, nicht
 * gesetzt. Der Name, den die Karte kannte, blinkt dabei nie. Die Regel dahinter prüft `test/panel-arrival.test.ts` ohne Browser.
 *
 * P2 (B1–B5): Die Abstände der Abschnitte. Zwischen zwei Köpfen keine Luft, zwischen einem Kopf und SEINEM Inhalt Luft.
 *
 * 🪤 Gemessen wird der ZUSTAND, nicht das Ereignis. Zwei Anläufe über `animationstart` waren unter Last rot und allein grün: Die
 * Einblendung ist 140 ms kurz, und wenn Chromium unter sechs Arbeitern kein Bild in dieser Zeit liefert, kommt das Ereignis nicht
 * verlässlich (zuvor ging sogar der Lauscher bei einem Neuladen von Vite verloren und `[]` sah aus wie „nichts bewegt“). Die Marke
 * `is-arriving` beziehungsweise `data-arriving` bleibt dagegen stehen, und was sie in CSS bedeutet, sagt `getComputedStyle`. Damit
 * ist jede Zusicherung dieses Pakets ohne Rennen prüfbar - auch die wichtigste: dass die Marke KEINE Fläche trifft, in der der
 * Name steht.
 */

const GARETH = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
const KAISERREICH = { kind: "territory", id: "3359118f-bdfe-4569-8277-3f25c2d62463" };
const DETAIL = "**/api/subjects/place/**";

/** Eine Fläche, die die Marke „trifft gerade ein“ trägt. */
interface Marked {
    /** Woran man sie erkennt: `data-testid`, sonst die Klassen. */
    what: string;
    /** Steht die Titelzeile IN dieser Fläche? */
    coversTitle: boolean;
    /** Bewegt sich diese Fläche selbst? Der Kopf trägt die Marke nur als Haken für seine neuen Teile. */
    moves: boolean;
    /** Was die Marke in CSS bewirkt. */
    animation: string;
    opacity: string;
}

/** Welche Flächen gerade als „eintreffend“ markiert sind - der Zustand, nicht ein Ereignis. */
function marked(page: Page): Promise<Marked[]> {
    return page.evaluate(() => {
        const title = document.querySelector('[data-testid="info-title"]');
        const panel = document.querySelector('[data-testid="info-panel"]');
        const nodes = [...(panel?.querySelectorAll(".is-arriving, [data-arriving]") ?? [])];
        return nodes.map((node) => {
            const style = getComputedStyle(node);
            return {
                what: (node as HTMLElement).dataset["testid"] ?? node.className.toString(),
                coversTitle: title !== null && node.contains(title),
                moves: style.animationName !== "none",
                animation: `${style.animationName} ${style.animationDuration}`,
                opacity: style.opacity,
            };
        });
    });
}

const markedWhat = async (page: Page): Promise<string[]> => (await marked(page)).map((entry) => entry.what);

/**
 * Die Bausteine des HAUPTMODELLS. Die Katalogabschnitte holen ihre Listen für sich (A9) und tragen ihre Marke nach eigenem
 * Takt - sie gehören nicht in eine Aussage über die Detailantwort.
 */
const MAIN_BLOCKS = ["info-header", "info-actions", "info-lies-in", "info-facts", "info-source", "info-section"];

const markedMain = async (page: Page): Promise<string[]> =>
    (await markedWhat(page)).filter((what) => MAIN_BLOCKS.some((block) => what.includes(block)));

/** Was die Marke an dieser Fläche in CSS bedeutet - ohne den Rauschanteil des Namens-Suffix von Vue. */
async function fade(page: Page, selector: string): Promise<string> {
    const style = await page
        .locator(selector)
        .first()
        .evaluate((element) => {
            const computed = getComputedStyle(element);
            return `${computed.animationName}|${computed.animationDuration}|${computed.animationTimingFunction}`;
        });
    return style.replace(/-[0-9a-f]{8}\|/, "|");
}

/**
 * Hält die Detailantwort fest, bis der Test sie freigibt - die „langsame Antwort“ (A2).
 *
 * 🪤 Eine FESTE Verzögerung wäre ein Rennen: Unter Last brauchten die Zusicherungen auf den Wartezustand länger als die
 * Verzögerung, und die Antwort war schon da, ehe sie gemessen wurde. Das Tor macht die Reihenfolge zur Zusicherung.
 */
async function holdDetail(page: Page): Promise<() => void> {
    let release = (): void => {};
    const gate = new Promise<void>((done) => {
        release = () => done();
    });
    await page.route(DETAIL, async (route) => {
        await gate;
        await route.continue();
    });
    return release;
}

interface SectionMeasure {
    heading: string;
    open: boolean;
    marginTop: number;
    borderTop: number;
    headPadTop: number;
    headPadBottom: number;
    bodyPadTop: number | null;
    bodyPadBottom: number | null;
    /** Versalkasten des Kopfes (`.avm-versalmitte` schneidet auf die Versalhöhe). */
    capTop: number;
    capBottom: number;
    headTop: number;
    headBottom: number;
    contentTop: number | null;
}

/** Die Abschnitte, wie der Browser sie wirklich setzt. */
function measureSections(page: Page): Promise<SectionMeasure[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="info-section"]')].map((section) => {
            const head = section.querySelector(".info-section__head") as HTMLElement;
            const cap = section.querySelector('[data-testid="info-section-title"]') as HTMLElement;
            const body = section.querySelector(".info-section__body");
            const first = body?.firstElementChild ?? null;
            const cs = getComputedStyle(section);
            const ch = getComputedStyle(head);
            const cb = body === null ? null : getComputedStyle(body);
            const px = (value: string): number => Number.parseFloat(value);
            return {
                heading: cap.textContent?.trim() ?? "",
                open: section.classList.contains("is-open"),
                marginTop: px(cs.marginTop),
                borderTop: px(cs.borderTopWidth),
                headPadTop: px(ch.paddingTop),
                headPadBottom: px(ch.paddingBottom),
                bodyPadTop: cb === null ? null : px(cb.paddingTop),
                bodyPadBottom: cb === null ? null : px(cb.paddingBottom),
                capTop: cap.getBoundingClientRect().top,
                capBottom: cap.getBoundingClientRect().bottom,
                headTop: head.getBoundingClientRect().top,
                headBottom: head.getBoundingClientRect().bottom,
                contentTop: first === null ? null : first.getBoundingClientRect().top,
            };
        }),
    );
}

/** Klappt jeden Abschnitt in den gewünschten Zustand. */
async function setSections(page: Page, open: boolean[]): Promise<void> {
    const heads = page.locator(".info-section__head");
    for (let at = 0; at < open.length; at += 1) {
        const expanded = (await heads.nth(at).getAttribute("aria-expanded")) === "true";
        if (expanded !== open[at]) await heads.nth(at).click();
    }
    await expect(page.locator(".info-section.is-open")).toHaveCount(open.filter(Boolean).length);
}

/**
 * Öffnet Gareth und wartet, bis die Katalogabschnitte (Kartensammlung, Literatur) und die Bewertungszeile im Kopf stehen. Die Bewertungen sind seit WI-0269 C10 kein
 * Abschnitt am Ende mehr, sondern der Reiter „Bewertungen“; die Zeile unter OFFIZIELL ist das Zeichen, dass ihre Sektion eingetroffen ist.
 */
async function openGareth(page: Page): Promise<void> {
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
    await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 30_000 });
    await expect(page.getByTestId("info-bewertungszeile")).toBeVisible({ timeout: 30_000 });
}

test.describe("P1: der eintreffende Inhalt wird eingeblendet, nicht gesetzt", () => {
    test("A2: Die Antwort kommt langsam - Panel steht sofort offen mit dem Namen und der Ladezeile, dann blendet der Inhalt ein", async ({
        page,
    }) => {
        await openMap(page);
        const antwort = await holdDetail(page);
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref, { known: { title: "Gareth" } }), GARETH);

        // Sofort offen, mit dem Namen der Karte und der Wartezeile - ohne auf das Netz zu warten.
        await expect(page.locator(".info-panel")).toHaveClass(/is-open/, { timeout: 2000 });
        await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 2000 });
        await expect(page.getByTestId("info-loading")).toBeVisible({ timeout: 2000 });
        await expect(page.getByTestId("info-facts")).toHaveCount(0);
        expect(await markedMain(page)).toEqual([]);

        // Dann der Inhalt - und zwar eingeblendet: Jeder Baustein, der NEU dazukommt, trägt die Marke.
        antwort();
        await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
        expect(await markedWhat(page)).toEqual(
            expect.arrayContaining(["info-header", "info-actions", "info-facts", "info-source"]),
        );
        // Und was die Marke bedeutet: eine reine Deckkraft, 140 ms, dieselbe Kurve wie das Kartenschild (§30.8).
        expect(await fade(page, '[data-testid="info-facts"]')).toBe("info-arrive|0.14s|ease");
        expect(await fade(page, '[data-testid="info-subtitle"]')).toBe("info-header-arrive|0.14s|ease");
        // 🪤 Sie endet bei voller Deckkraft: Eine Fläche, die auf einem Zwischenwert stehen bleibt, hieße „gesperrt“ (§30.2).
        await expect.poll(() => page.getByTestId("info-facts").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
        // Der Übergang verzögert die Bedienung nicht: Ein Abschnittskopf wirkt sofort.
        await page.locator(".info-section__head").first().click();
        await expect(page.locator(".info-section").first()).not.toHaveClass(/is-open/);
    });

    test("🔴 A3: Der Name der Karte ist der Name der Antwort - er bleibt stehen und wird nicht neu eingeblendet", async ({
        page,
    }) => {
        await openMap(page);
        const antwort = await holdDetail(page);
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref, { known: { title: "Gareth" } }), GARETH);
        await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 2000 });
        // Dasselbe DOM-Element muss es nach der Antwort noch sein, sonst wäre es neu gezeichnet.
        await page.getByTestId("info-title").evaluate((element) => {
            (element as HTMLElement & { __mark?: string }).__mark = "vor der Antwort";
        });

        antwort();
        await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("info-title")).toHaveText("Gareth");
        expect(
            await page
                .getByTestId("info-title")
                .evaluate((element) => (element as HTMLElement & { __mark?: string }).__mark),
        ).toBe("vor der Antwort");

        // 🔴 Keine Fläche, in der der Name steht, darf sich BEWEGEN - auch kein Vorfahr. Genau das war am 2026-10-06 so: Die
        // Klasse `is-arriving` saß am Kopf selbst, und der Name blendete mit ein, ohne selbst animiert zu sein.
        const flächen = await marked(page);
        expect(flächen.filter((entry) => entry.moves).length).toBeGreaterThan(0);
        expect(flächen.filter((entry) => entry.coversTitle && entry.moves)).toEqual([]);
        // Der Kopf trägt die Marke als ATTRIBUT: ein Haken für seine neuen Teile, keine Bewegung an ihm selbst.
        expect(await fade(page, '[data-testid="info-header"]')).toBe("none|0s|ease");
        expect(await fade(page, '[data-testid="info-title"]')).toBe("none|0s|ease");
        expect(await fade(page, '[data-testid="info-subtitle"]')).toBe("info-header-arrive|0.14s|ease");
    });

    test("A1: Die Antwort kommt schnell (aus dem Cache) - kein Sprung, und nichts blendet ein", async ({ page }) => {
        await openGareth(page);
        // Dazwischen ein anderer Gegenstand, damit die zweite Öffnung von Gareth wirklich eine neue ist.
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), KAISERREICH);
        await expect(page.getByTestId("info-title")).not.toHaveText("Gareth", { timeout: 30_000 });
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
        await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 30_000 });
        // Die Antwort lag im kurzen Cache: Es gab kein Bild mit Wartezeile, also hat die Bewegung nichts zu überbrücken.
        await expect(page.getByTestId("info-loading")).toHaveCount(0);
        await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
        expect(await markedMain(page)).toEqual([]);
    });

    test("🔴 A4/A5: Der Platz des Kopfbildes ist vorher reserviert - die Höhe des Kopfbereichs ändert sich beim Eintreffen nicht", async ({
        page,
    }) => {
        await openMap(page);
        const antwort = await holdDetail(page);
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref, { known: { title: "Gareth" } }), GARETH);
        await expect(page.getByTestId("info-media")).toBeVisible({ timeout: 2000 });
        // A5: Vor der Antwort gibt es gar kein Bild - nur den Platzhaltergrund in seinem 16:9-Kasten.
        await expect(page.getByTestId("info-header-image")).toHaveCount(0);
        const before = await page.getByTestId("info-media").evaluate((e) => e.getBoundingClientRect().height);
        antwort();
        await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("info-header-image")).toHaveCount(1);
        const after = await page.getByTestId("info-media").evaluate((e) => e.getBoundingClientRect().height);
        expect(before).toBeGreaterThan(0);
        expect(after).toBeCloseTo(before, 1);
    });

    test("🔴 A6: Ein zweiter Gegenstand, geöffnet während der erste lädt, gewinnt - die späte Antwort des ersten wird verworfen", async ({
        page,
    }) => {
        await openMap(page);
        const antwortGareth = await holdDetail(page);
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref, { known: { title: "Gareth" } }), GARETH);
        await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 2000 });
        // Der zweite Gegenstand (eigener Endpunkt, nicht festgehalten) kommt dazwischen und gewinnt.
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), KAISERREICH);
        await expect
            .poll(() => page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind), { timeout: 30_000 })
            .toBe("territory");
        await expect(page.getByTestId("info-title")).not.toHaveText("", { timeout: 30_000 });
        const second = String(await page.getByTestId("info-title").textContent());
        expect(second).not.toBe("Gareth");
        // JETZT erst darf die Antwort des ersten eintreffen - genau der Fall, der das Panel umschreiben könnte.
        antwortGareth();
        await page.waitForTimeout(3000);
        await expect(page.getByTestId("info-title")).toHaveText(second);
        expect(await page.evaluate(() => globalThis.avesmapsSelectedSubject?.()?.kind)).toBe("territory");
    });

    test("A7: Die Antwort schlägt fehl - Fehlerbild wie bisher, kein Dauerladen", async ({ page }) => {
        await openMap(page);
        await page.route(DETAIL, (route) => route.fulfill({ status: 500, body: "{}" }));
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref, { known: { title: "Gareth" } }), GARETH);
        await expect(page.getByTestId("info-error")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("info-retry")).toBeVisible();
        await expect(page.getByTestId("info-loading")).toHaveCount(0);
        await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    });

    test("A9: Ein Katalogabschnitt lädt nach - er blendet für sich ein und hält das Panel nicht auf", async ({
        page,
    }) => {
        await openMap(page);
        let release = (): void => {};
        const liste = new Promise<void>((done) => {
            release = () => done();
        });
        await page.route("**/api/subjects/place/*/literature*", async (route) => {
            await liste;
            await route.continue();
        });
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), GARETH);
        // Das Panel ist fertig, während SEIN Abschnitt noch lädt (die übrigen gehen ihren eigenen Gang).
        const literature = page.locator('[data-section="literature"]');
        await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
        await expect(literature.getByTestId("info-catalog-loading")).toBeVisible();
        release();
        await expect(page.getByTestId("info-literature-strip")).toBeVisible({ timeout: 30_000 });
        // Die Liste trägt ihre eigene Marke, mit der eigenen Rezeptur des Abschnitts.
        await expect(literature.locator(".is-arriving")).toHaveCount(1);
        expect(await fade(page, '[data-section="literature"] .is-arriving')).toBe("info-catalog-arrive|0.14s|ease");
    });
});

test.describe("A8: reduzierte Bewegung", () => {
    test.use({ reducedMotion: "reduce" });

    test("🔴 kein Übergang, der Inhalt ist sofort da", async ({ page }) => {
        await openMap(page);
        const antwort = await holdDetail(page);
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref, { known: { title: "Gareth" } }), GARETH);
        await expect(page.getByTestId("info-loading")).toBeVisible({ timeout: 2000 });
        antwort();
        await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
        // Die Marke steht - aber sie bedeutet hier nichts mehr.
        expect(await markedWhat(page)).toEqual(expect.arrayContaining(["info-facts"]));
        for (const entry of await marked(page)) {
            expect(entry.animation, entry.what).toBe("none 0s");
            expect(entry.opacity, entry.what).toBe("1");
        }
        expect(await fade(page, '[data-testid="info-subtitle"]')).toBe("none|0s|ease");
    });
});

/**
 * P2: die Abstände. Gemessen am 2026-10-06 VOR der Änderung: 41 px von Versalunterkante zu Versaloberkante zwischen zwei
 * zugeklappten Köpfen, 14 px von der Versalunterkante zum Inhalt eines offenen Abschnitts. Die Sprossen des Kanons:
 * `--space-10` = 12 px, `--space-12` = 14 px.
 */
test.describe("P2: zwischen zwei Köpfen keine Luft, zwischen Kopf und Inhalt Luft", () => {
    test("🔴 B1: zugeklappte Abschnitte stehen dicht und gleichmäßig", async ({ page }) => {
        await openGareth(page);
        await setSections(page, [false, false]);
        const sections = await measureSections(page);
        // Kartensammlung und Literatur (die Bewertungen sind seit WI-0269 C10 der Reiter, kein Abschnitt).
        expect(sections.length).toBeGreaterThanOrEqual(2);
        // Zwischen zwei Abschnitten kein Außenabstand: Die Trennlinie genügt.
        for (const section of sections.slice(1)) expect(section.marginTop).toBe(0);
        const gaps = sections
            .slice(1)
            .map((section, at) => section.capTop - (sections[at] as SectionMeasure).capBottom);
        // Gleichmäßig, und genau die eigene Polsterung der beiden Köpfe plus die Linie: 14 + 1 + 14.
        for (const gap of gaps) expect(gap).toBeCloseTo(29, 1);
        expect(new Set(gaps.map((gap) => gap.toFixed(2))).size).toBe(1);
    });

    test("🔴 B2: ein aufgeklappter Abschnitt hat sichtbare Luft zwischen Kopf und erstem Inhalt", async ({ page }) => {
        await openGareth(page);
        await setSections(page, [true, false]);
        const [section] = await measureSections(page);
        const open = section as SectionMeasure;
        // Der Rumpf trägt oben dieselbe Sprosse wie unten (`--space-10` = 12 px).
        expect(open.bodyPadTop).toBe(12);
        expect(open.bodyPadTop).toBe(open.bodyPadBottom);
        // Von der Versalunterkante des Kopfes zum Inhalt: 14 (Polster des Kopfes) + 12 (Polster des Rumpfs).
        expect((open.contentTop as number) - open.capBottom).toBeCloseTo(26, 1);
    });

    test("B3: ein aufgeklappter Abschnitt unter einem zugeklappten - beides zugleich richtig", async ({ page }) => {
        await openGareth(page);
        await setSections(page, [false, true]);
        const sections = await measureSections(page);
        const [first, middle] = sections as [SectionMeasure, SectionMeasure];
        expect(middle.open).toBe(true);
        expect(first.open).toBe(false);
        // Oben die dichte Fuge, im aufgeklappten die Luft unter dem Kopf.
        expect(middle.capTop - first.capBottom).toBeCloseTo(29, 1);
        expect((middle.contentTop as number) - middle.capBottom).toBeCloseTo(26, 1);
        expect(middle.marginTop).toBe(0);
    });

    test("🔴 B4: der Hover-Grund deckt den Kopf oben wie unten gleich viel", async ({ page }) => {
        await openGareth(page);
        await setSections(page, [false, false]);
        const head = page.locator(".info-section__head").first();
        await head.hover();
        const wash = await head.evaluate((element) => {
            const cap = element.querySelector('[data-testid="info-section-title"]') as HTMLElement;
            const box = element.getBoundingClientRect();
            const inner = cap.getBoundingClientRect();
            return { above: inner.top - box.top, below: box.bottom - inner.bottom };
        });
        expect(wash.above).toBeCloseTo(wash.below, 1);
        expect(wash.above).toBeCloseTo(14, 1);
    });
});

test.describe("Am Telefon, 360 px", () => {
    test.use({ viewport: { width: 360, height: 780 } });

    test("A10/B5: gleiches Verhalten und gleiches Bild, kein Überlauf", async ({ page }) => {
        await openMap(page);
        const antwort = await holdDetail(page);
        await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref, { known: { title: "Gareth" } }), GARETH);
        await expect(page.getByTestId("info-title")).toHaveText("Gareth", { timeout: 5000 });
        await expect(page.getByTestId("info-loading")).toBeVisible({ timeout: 5000 });
        antwort();
        await expect(page.getByTestId("info-facts")).toBeVisible({ timeout: 30_000 });
        expect(await markedWhat(page)).toEqual(expect.arrayContaining(["info-facts"]));
        expect(await fade(page, '[data-testid="info-facts"]')).toBe("info-arrive|0.14s|ease");

        await expect(page.getByTestId("info-bewertungszeile")).toBeVisible({ timeout: 30_000 });
        await setSections(page, [false, true]);
        const sections = await measureSections(page);
        const [first, middle] = sections as [SectionMeasure, SectionMeasure];
        expect(middle.capTop - first.capBottom).toBeCloseTo(29, 1);
        expect((middle.contentTop as number) - middle.capBottom).toBeCloseTo(26, 1);
        // Kein waagerechter Überlauf im Panel.
        const overflow = await page
            .getByTestId("info-panel")
            .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
    });
});
