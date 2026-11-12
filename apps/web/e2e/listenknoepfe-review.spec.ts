import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Locator, type Page } from "@playwright/test";
import { bedieneMedienrouten, MIT_MEDIEN, medienQuelle, schliesseMedienQuelle, stubSitzung } from "./medien-quelle.ts";
import { fenster, oeffneOrtseditor } from "./ortseditor-stub.ts";

/**
 * Abnahmeblatt „Filter und Sortierung als Zeichen“ (Betreiber 2026-10-11: „generell will ich immer allein das sortierung-symbol und
 * das filter-symbol, um platz zu sparen. beim draufklicken öffnet sich das menü mit den optionen.“). Der Trichter ist das gemeinsame
 * Bauteil `controls/avm-filterknopf.vue`; die Sortierung ist der Menüknopf des Hauses (`controls/avm-menueknopf.vue`, wie die MAM ihn
 * seit 6fc7ecf7 in der Medienverwaltung nutzt) mit den Zeichen aus `controls/avm-sortierzeichen.vue`. Gezeigt in zwei ECHTEN Listen: der
 * Ortsliste im Ortseditor (Liste aus `ortseditor-stub.ts`) und der Medienverwaltung (echte Medien aus `avesmaps3d_dev`).
 *
 * 💣 An den Listen ändert dieser Lauf NICHTS im Code: Er liest ihre Filterabschnitte und Ordnungen aus der Seite, setzt die Knöpfe an die
 * Stelle der alten (eine eigene Vue-App aus derselben Vue-Quelle wie die Seite) und fotografiert. Die Knöpfe sind nicht an die Liste
 * verdrahtet: Filtern und Ordnen ändert die Zeilen nicht. Umbauen tun die Besitzer der Listen nach der Abnahme.
 *
 * Ablage: `review/listenknoepfe/blatt-2.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/listenknoepfe");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

type Zeichen = "name" | "menge" | "zeit" | "haken" | "zustand";
interface Abschnitt {
    id: string;
    titel: string;
    art: "eins" | "mehrere";
    werte: { wert: string; text: string; zahl?: number }[];
}
interface Ordnung {
    wert: string;
    text: string;
    zeichen: Zeichen;
    umgekehrt?: boolean;
}
type Vue = {
    createApp: (wurzel: unknown) => { mount: (element: Element) => void };
    h: (...args: unknown[]) => unknown;
    ref: <T>(wert: T) => { value: T };
};

/** Holt Vue aus derselben Quelle wie die Seite (sonst zwei Vue in einer Seite) und die Bauteile, über den Entwicklungsserver. */
async function bereite(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const quelle = await (await fetch("/src/controls/avm-filterknopf.vue")).text();
        const url = /from\s+"(\/node_modules\/\.vite\/deps\/vue\.js\?v=[^"]+)"/.exec(quelle)?.[1];
        if (url === undefined) throw new Error("Vue-Quelle der Seite nicht gefunden");
        const laden = (pfad: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ pfad);
        (globalThis as Record<string, unknown>)["__listenknoepfe"] = {
            vue: await laden(url),
            filter: (await laden("/src/controls/avm-filterknopf.vue"))["default"],
            menue: (await laden("/src/controls/avm-menueknopf.vue"))["default"],
            zeichen: (await laden("/src/controls/avm-sortierzeichen.vue"))["default"],
        };
    });
}

/** Setzt einen Trichter (und, mit `ordnungen`, einen Sortierknopf) an die Stelle alter Bedienelemente. */
async function setzeEin(
    page: Page,
    ziel: { filterAlt: string; sortierAlt?: string; sortierNach?: string },
    daten: { abschnitte: Abschnitt[]; wahl: Record<string, string[]>; ordnungen?: Ordnung[] },
    kennung: string,
): Promise<void> {
    await page.evaluate(
        ({ ziel, daten, kennung }) => {
            const { vue, filter, menue, zeichen } = (globalThis as Record<string, unknown>)["__listenknoepfe"] as {
                vue: Vue;
                filter: unknown;
                menue: unknown;
                zeichen: unknown;
            };
            const platz = (): HTMLSpanElement => {
                const span = document.createElement("span");
                span.style.display = "contents";
                return span;
            };
            const filterAlt = document.querySelector(ziel.filterAlt);
            if (!filterAlt) throw new Error("alter Filter fehlt");
            const filterPlatz = platz();
            filterAlt.replaceWith(filterPlatz);
            const wahl = vue.ref(daten.wahl);
            vue.createApp({
                render: () =>
                    vue.h(filter, {
                        abschnitte: daten.abschnitte,
                        wahl: wahl.value,
                        testid: `${kennung}-neu-filter`,
                        onSetze: (id: string, werte: string[]) => {
                            wahl.value = { ...wahl.value, [id]: werte };
                        },
                        onLoesen: () => {
                            wahl.value = {};
                        },
                    }),
            }).mount(filterPlatz);
            const ordnungen = daten.ordnungen;
            if (ordnungen === undefined || ziel.sortierAlt === undefined) return;
            const sortierPlatz = platz();
            document.querySelector(ziel.sortierNach ?? "body")?.append(sortierPlatz);
            document.querySelector(ziel.sortierAlt)?.remove();
            const wert = vue.ref(ordnungen[0]?.wert ?? "");
            const art = (gesucht: string): { art: string; umgekehrt: boolean } => {
                const ordnung = ordnungen.find((eintrag) => eintrag.wert === gesucht);
                return { art: ordnung?.zeichen ?? "name", umgekehrt: ordnung?.umgekehrt === true };
            };
            vue.createApp({
                render: () =>
                    vue.h(
                        menue,
                        {
                            optionen: ordnungen.map(({ wert, text }) => ({ wert, text })),
                            modelValue: wert.value,
                            "onUpdate:modelValue": (neu: string) => {
                                wert.value = neu;
                            },
                            bezeichnung: `Sortierung: ${ordnungen.find((eintrag) => eintrag.wert === wert.value)?.text ?? ""}`,
                            menueBezeichnung: "Sortierung",
                            imFenster: true,
                            testid: `${kennung}-neu-sortierung`,
                        },
                        { zeichen: ({ wert: gezeigt }: { wert: string }) => vue.h(zeichen, art(gezeigt)) },
                    ),
            }).mount(sortierPlatz);
        },
        { ziel, daten, kennung },
    );
    // Der Zeiger steht noch über dem alten Trichter, den das Lesen geklickt hat: weg damit, sonst zeigt der neue Knopf Hover.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
}

/** Die Zeichenfamilie und ein Menü mit Richtung als eigener Ordnung, als Tafel über der Karte (nur für die Nahaufnahme). */
async function zeigeFamilie(page: Page): Promise<void> {
    await page.evaluate(() => {
        const { vue, menue, zeichen } = (globalThis as Record<string, unknown>)["__listenknoepfe"] as {
            vue: Vue;
            menue: unknown;
            zeichen: unknown;
        };
        const tafel = document.createElement("div");
        tafel.setAttribute("data-familie", "");
        tafel.style.cssText =
            "position:fixed;left:24px;top:24px;z-index:5000;display:flex;gap:18px;align-items:center;padding:12px 16px;border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-panel);color:var(--color-text);font-size:var(--font-size-small)";
        // Im modalen Fenster der Medienverwaltung: alles außerhalb ist träge.
        const wurzel = document.querySelector("dialog[open]") ?? document.body;
        wurzel.append(tafel);
        const familie: [string, boolean, string][] = [
            ["name", false, "Name"],
            ["menge", false, "Menge, Größe"],
            ["zeit", false, "Zeit, neueste zuerst"],
            ["zeit", true, "Zeit, älteste zuerst"],
            ["haken", false, "Rechtestand"],
            ["zustand", false, "Zustand ◐"],
        ];
        for (const [art, umgekehrt, text] of familie) {
            const zelle = document.createElement("span");
            zelle.style.cssText = "display:inline-flex;align-items:center;gap:6px;color:var(--color-text-muted)";
            const glyph = document.createElement("span");
            zelle.append(glyph);
            zelle.append(document.createTextNode(text));
            tafel.append(zelle);
            vue.createApp({ render: () => vue.h(zeichen, { art, umgekehrt }) }).mount(glyph);
        }
        const knopfPlatz = document.createElement("span");
        knopfPlatz.setAttribute("data-richtung", "");
        knopfPlatz.style.cssText = "position:fixed;left:24px;top:90px;z-index:5000";
        wurzel.append(knopfPlatz);
        const ordnungen = [
            { wert: "neu", text: "zuletzt geändert, neueste zuerst", art: "zeit", umgekehrt: false },
            { wert: "alt", text: "zuletzt geändert, älteste zuerst", art: "zeit", umgekehrt: true },
            { wert: "name", text: "Name", art: "name", umgekehrt: false },
        ];
        const wert = vue.ref("neu");
        vue.createApp({
            render: () =>
                vue.h(
                    menue,
                    {
                        optionen: ordnungen.map(({ wert, text }) => ({ wert, text })),
                        modelValue: wert.value,
                        "onUpdate:modelValue": (neu: string) => {
                            wert.value = neu;
                        },
                        bezeichnung: "Sortierung",
                        menueBezeichnung: "Sortierung",
                        imFenster: true,
                        testid: "familie-richtung",
                    },
                    {
                        zeichen: ({ wert: gezeigt }: { wert: string }) => {
                            const ordnung = ordnungen.find((eintrag) => eintrag.wert === gezeigt) ?? ordnungen[0];
                            return vue.h(zeichen, { art: ordnung?.art, umgekehrt: ordnung?.umgekehrt });
                        },
                    },
                ),
        }).mount(knopfPlatz);
    });
}

/** Die Ortsliste: Facetten aus dem alten Filterblatt, die Maske als Abschnitt mit einer Wahl, die Ordnungen aus der alten Klappliste. */
async function leseOrtsliste(page: Page, kennung: string): Promise<{ abschnitte: Abschnitt[]; ordnungen: Ordnung[] }> {
    await page.getByTestId(`${kennung}-filter`).click();
    await page.getByTestId(`${kennung}-filter-blatt`).waitFor();
    const daten = await page.evaluate((kennung) => {
        const blatt = document.querySelector(`[data-testid="${kennung}-filter-blatt"]`);
        const abschnitte = [...(blatt?.querySelectorAll("fieldset") ?? [])].map((satz) => {
            const id = (satz.getAttribute("data-testid") ?? "").replace(`${kennung}-facette-`, "");
            return {
                id,
                titel: satz.querySelector("legend")?.textContent?.trim() ?? id,
                werte: [...satz.querySelectorAll("label")].map((label) => ({
                    wert: (label.querySelector("input")?.getAttribute("data-testid") ?? "").replace(
                        `${kennung}-facette-${id}-`,
                        "",
                    ),
                    text: label.querySelector(".liste-filter__wert")?.textContent?.trim() ?? "",
                    zahl: Number(label.querySelector(".liste-filter__zahl")?.textContent ?? "0"),
                })),
            };
        });
        // Die Klapplisten tragen ihren Namen im Wort („Sortierung: Name“); im Menü steht er schon darüber.
        const optionen = (testid: string): { wert: string; text: string }[] =>
            [...document.querySelectorAll<HTMLOptionElement>(`[data-testid="${testid}"] option`)].map((option) => ({
                wert: option.value,
                text: (option.textContent?.trim() ?? "").replace(/^(Sortierung|Maske):\s*/, ""),
            }));
        return {
            abschnitte,
            maske: optionen(`${kennung}-maske`).slice(1),
            sortierung: optionen(`${kennung}-sortierung`),
        };
    }, kennung);
    await page.keyboard.press("Escape");
    const abschnitte: Abschnitt[] = daten.abschnitte.map((abschnitt) => ({ ...abschnitt, art: "mehrere" }));
    if (daten.maske.length > 0) abschnitte.push({ id: "maske", titel: "Maske", art: "eins", werte: daten.maske });
    const zeichen = (text: string): Zeichen =>
        /größe/i.test(text) ? "menge" : /zustand/i.test(text) ? "zustand" : "name";
    return {
        abschnitte,
        ordnungen: daten.sortierung.map((option) => ({ ...option, zeichen: zeichen(option.text) })),
    };
}

/** Die Medienverwaltung: Abschnitte aus ihrem Trichter (je eine Wahl). Ihre Sortierung ist schon der Menüknopf (6fc7ecf7). */
async function leseMedien(page: Page): Promise<Abschnitt[]> {
    await page.getByTestId("medien-filter").click();
    await page.getByTestId("medien-filter-blatt").waitFor();
    const abschnitte = await page.evaluate(() => {
        const blatt = document.querySelector('[data-testid="medien-filter-blatt"]');
        return [...(blatt?.querySelectorAll("fieldset") ?? [])].map((satz) => {
            const id = (satz.getAttribute("data-testid") ?? "").replace("medien-filter-", "");
            return {
                id,
                titel: satz.querySelector("legend")?.textContent?.trim() ?? id,
                werte: [...satz.querySelectorAll("label")]
                    .map((label) => ({
                        wert: (label.querySelector("input")?.getAttribute("data-testid") ?? "").replace(
                            `medien-filter-${id}-`,
                            "",
                        ),
                        text: label.textContent?.trim() ?? "",
                    }))
                    .filter((eintrag) => eintrag.wert !== "alle"),
            };
        });
    });
    await page.keyboard.press("Escape");
    return abschnitte.map((abschnitt) => ({ ...abschnitt, art: "eins" }));
}

const zweiGesetzt = (abschnitte: Abschnitt[], mehrere: boolean): Record<string, string[]> => {
    if (mehrere) {
        const erster = abschnitte.find((abschnitt) => abschnitt.werte.length >= 2);
        return erster ? { [erster.id]: erster.werte.slice(0, 2).map((eintrag) => eintrag.wert) } : {};
    }
    const wahl: Record<string, string[]> = {};
    for (const abschnitt of abschnitte.slice(0, 2)) {
        const erster = abschnitt.werte[0];
        if (erster) wahl[abschnitt.id] = [erster.wert];
    }
    return wahl;
};

interface Bild {
    buf: Buffer;
    breite: number;
}
const bilder: Record<string, Bild> = {};
const merke = (key: string, buf: Buffer, breite: number): void => {
    bilder[key] = { buf, breite };
};

/** Ein Ausschnitt um ein Element und, wenn offen, sein Blatt, in den Rand der Seite geschnitten. */
async function ausschnitt(page: Page, umriss: Locator, extra: string | undefined, rand = 12): Promise<Buffer> {
    const kasten = await page.evaluate(
        ({ extra }) => {
            const blatt = extra === undefined ? null : document.querySelector(extra);
            return blatt ? blatt.getBoundingClientRect().toJSON() : null;
        },
        { extra },
    );
    const box = await umriss.boundingBox({ timeout: 10_000 });
    if (!box) throw new Error("Umriss ohne Lage");
    let { x, y, width, height } = box;
    if (kasten) {
        const rechts = Math.max(x + width, kasten.right);
        const unten = Math.max(y + height, kasten.bottom);
        x = Math.min(x, kasten.left);
        y = Math.min(y, kasten.top);
        width = rechts - x;
        height = unten - y;
    }
    const seite = page.viewportSize() ?? { width: 1440, height: 900 };
    const clip = { x: Math.max(0, x - rand), y: Math.max(0, y - rand), width: 0, height: 0 };
    clip.width = Math.min(seite.width, x + width + rand) - clip.x;
    clip.height = Math.min(seite.height, y + height + rand) - clip.y;
    return page.screenshot({ clip });
}

async function oeffneMedien(
    browser: Browser,
    baseURL: string,
    q: NonNullable<Awaited<ReturnType<typeof medienQuelle>>>,
    pfad: string,
    options: BrowserContextOptions,
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubSitzung(page, MIT_MEDIEN);
    await bedieneMedienrouten(page, q);
    await page.goto(pfad);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId("medien-fenster").waitFor();
    await page.getByTestId("medien-filter").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    // Die Leiste der Treffer: der nächste Vorfahr der Suche, der auch die Sortierung trägt; markiert, bevor der Trichter wechselt.
    await page.evaluate(() => {
        let element = document.querySelector('[data-testid="medien-suche"]')?.parentElement ?? null;
        while (element && !element.querySelector('[data-testid="medien-sortierung"]')) element = element.parentElement;
        element?.setAttribute("data-blatt-leiste", "");
    });
    return { page, close: () => context.close() };
}

async function oeffneOrte(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
): Promise<{ page: Page; close: () => Promise<void>; kennung: string }> {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, ...options });
    const page = await context.newPage();
    await oeffneOrtseditor(page);
    await fenster(page).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const kennung = (await fenster(page).locator(".liste").first().getAttribute("data-testid")) ?? "";
    await page.getByTestId(`${kennung}-filter`).waitFor();
    await page.waitForTimeout(800);
    return { page, close: () => context.close(), kennung };
}

test("Abnahmeblatt: Filter und Sortierung als Zeichen", async ({ browser }, testInfo) => {
    test.setTimeout(420_000);
    const quelle = await medienQuelle();
    test.skip(quelle === undefined, "ohne DATABASE_URL keine echten Medien");
    const q = quelle!;
    const baseURL = String(testInfo.project.use.baseURL);

    // Rechner, hell und dunkel: die Medienverwaltung. Ihre Sortierung ist echt (MAM, 6fc7ecf7); eingesetzt wird nur der Trichter.
    for (const schema of ["light", "dark"] as const) {
        const { page, close } = await oeffneMedien(browser, baseURL, q, "/edit?medien", {
            colorScheme: schema,
            deviceScaleFactor: 2,
        });
        const zeile = page.locator("[data-blatt-leiste]");
        if (schema === "light") merke("medien-vorher", await ausschnitt(page, zeile, undefined), 700);
        const abschnitte = await leseMedien(page);
        await bereite(page);
        await setzeEin(
            page,
            { filterAlt: ".medien-filter" },
            { abschnitte, wahl: zweiGesetzt(abschnitte, false) },
            "medien",
        );
        const filterKnopf = page.getByTestId("medien-neu-filter");
        if (schema === "light") {
            merke("medien-zu", await ausschnitt(page, zeile, undefined), 700);
            merke("nah-filter-aktiv", await filterKnopf.screenshot(), 0);
            const sortKnopf = page.getByTestId("medien-sortierung");
            merke("nah-sort-ruhe", await sortKnopf.screenshot(), 0);
            await sortKnopf.hover();
            await page.waitForTimeout(250);
            merke("nah-sort-hover", await sortKnopf.screenshot(), 0);
            await page.mouse.move(0, 0);
            await page.evaluate(() => {
                const feld = document.querySelector<HTMLElement>('[data-testid="medien-suche"]');
                (feld?.matches("input") ? feld : feld?.querySelector<HTMLElement>("input"))?.focus();
            });
            await page.keyboard.press("Tab");
            await page.waitForTimeout(250);
            merke("nah-filter-fokus", await filterKnopf.screenshot(), 0);
            await filterKnopf.click();
            await page.getByTestId("medien-neu-filter-loesen").click();
            // „Filter lösen“ verschwindet mit dem letzten Filter, der Fokus mit ihm: Esc ginge an das Fenster. Zu über den Knopf.
            await filterKnopf.click();
            await page.mouse.move(0, 0);
            await page.waitForTimeout(250);
            merke("nah-filter-ruhe", await filterKnopf.screenshot(), 0);
            await filterKnopf.click();
            for (const abschnitt of abschnitte.slice(0, 2)) {
                const wert = abschnitt.werte[0]?.wert;
                if (wert !== undefined) await page.getByTestId(`medien-neu-filter-${abschnitt.id}-${wert}`).check();
            }
            await page.mouse.move(0, 0);
            await page.waitForTimeout(300);
            merke("medien-filter", await ausschnitt(page, zeile, '[data-testid="medien-neu-filter-blatt"]'), 700);
            await filterKnopf.click();
            // Die Familie der Sortierzeichen und die Richtung als eigene Ordnung, über der Karte.
            await zeigeFamilie(page);
            merke("familie", await page.locator("[data-familie]").screenshot(), 690);
            await page.getByTestId("familie-richtung").click();
            await page.waitForTimeout(300);
            merke(
                "richtung",
                await ausschnitt(page, page.locator("[data-richtung]"), '[data-testid="familie-richtung-menue"]'),
                360,
            );
            await page.keyboard.press("Escape");
        }
        await page.getByTestId("medien-sortierung").click();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        merke(`medien-sort-${schema}`, await ausschnitt(page, zeile, '[data-testid="medien-sortierung-menue"]'), 700);
        await close();
    }

    // Rechner, hell und dunkel: die Ortsliste im Ortseditor.
    for (const schema of ["light", "dark"] as const) {
        const { page, close, kennung } = await oeffneOrte(browser, baseURL, {
            colorScheme: schema,
            deviceScaleFactor: 2,
        });
        const kopfZeile = page.locator(`[data-testid="${kennung}"] .liste__zeile`).first();
        const bilanz = `[data-testid="${kennung}-bilanz"]`;
        if (schema === "light") merke("orte-vorher", await ausschnitt(page, kopfZeile, bilanz), 460);
        const { abschnitte, ordnungen } = await leseOrtsliste(page, kennung);
        await bereite(page);
        await setzeEin(
            page,
            {
                filterAlt: `[data-testid="${kennung}"] .liste-filter`,
                sortierAlt: `[data-testid="${kennung}"] .liste__zeile--halb`,
                sortierNach: `[data-testid="${kennung}"] .liste__zeile`,
            },
            { abschnitte, wahl: zweiGesetzt(abschnitte, true), ordnungen },
            kennung,
        );
        if (schema === "light") {
            merke("orte-zu", await ausschnitt(page, kopfZeile, bilanz), 460);
            await page.getByTestId(`${kennung}-neu-sortierung`).click();
            await page.mouse.move(0, 0);
            await page.waitForTimeout(300);
            merke(
                "orte-sort",
                await ausschnitt(page, kopfZeile, `[data-testid="${kennung}-neu-sortierung-menue"]`),
                460,
            );
            await page.keyboard.press("Escape");
        }
        await page.getByTestId(`${kennung}-neu-filter`).click();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        merke(
            `orte-filter-${schema}`,
            await ausschnitt(page, kopfZeile, `[data-testid="${kennung}-neu-filter-blatt"]`),
            560,
        );
        if (schema === "light") merke("orte-echt", await page.screenshot(), 720);
        await close();
    }

    // Telefon: die Treffer der Medienverwaltung, hell mit offenem Trichter, dunkel mit offener Sortierung.
    for (const schema of ["light", "dark"] as const) {
        const { page, close } = await oeffneMedien(browser, baseURL, q, "/edit?medien&medien-q=Gareth", {
            ...devices["Pixel 7"],
            colorScheme: schema,
        });
        const abschnitte = await leseMedien(page);
        await bereite(page);
        await setzeEin(
            page,
            { filterAlt: ".medien-filter" },
            { abschnitte, wahl: zweiGesetzt(abschnitte, false) },
            "medien",
        );
        await page.getByTestId(schema === "light" ? "medien-neu-filter" : "medien-sortierung").click();
        await page.waitForTimeout(400);
        merke(`telefon-${schema}`, await page.screenshot(), 300);
        await close();
    }
    await schliesseMedienQuelle();

    mkdirSync(OUTPUT, { recursive: true });
    const colour = CANON.colour;
    const png = (key: string): string => {
        const bild = bilder[key];
        if (!bild) return "";
        const breite = bild.breite > 0 ? ` style="width:${String(bild.breite)}px"` : "";
        return `<img src="data:image/png;base64,${bild.buf.toString("base64")}" alt=""${breite}>`;
    };
    const nah = (key: string, text: string): string =>
        `<figure class="nah">${png(key)}<figcaption>${text}</figcaption></figure>`;
    const zelle = (key: string, text: string): string => `<figure>${png(key)}<figcaption>${text}</figcaption></figure>`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1560px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.ersetzt { margin: 6px 0 12px; padding: 8px 12px; border-left: 3px solid ${colour["accentStrong"]}; background: ${colour["panelSoft"]}; font-size: 13.5px; }
.lead { margin: 0 0 18px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1450px; }
h2 { margin: 26px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.row { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; }
figure { margin: 0; }
figcaption { margin-top: 5px; font-size: 12.5px; color: ${colour["textMuted"]}; max-width: 720px; }
figure.nah img { height: 76px; width: auto !important; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
th, td { text-align: left; vertical-align: top; padding: 5px 8px; border-bottom: 1px solid ${colour["border"]}; }
th { color: ${colour["accentStrong"]}; font-weight: 400; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11.5px; }
td.ok { color: ${colour["accentStrong"]}; }
ol.punkte { margin: 6px 0 0; padding-left: 22px; font-size: 13.5px; }
ol.punkte li { margin: 0 0 6px; }
ol.punkte b { font-weight: 400; color: ${colour["accentStrong"]}; }
.note { margin: 14px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
</style></head><body>
<h1>Filter und Sortierung: nur Zeichen, ein Klick öffnet das Menü</h1>
<p class="ersetzt">Ersetzt das Blatt von vorhin. Unterschied: Die Sortierung ist jetzt der Menüknopf, den die Medienverwaltung schon hat. Der Knopf zeigt das Zeichen der gewählten Ordnung, im Menü hat jede Ordnung ihr Zeichen. Eine Richtung ist kein zweites Menü mehr, sondern eine eigene Ordnung, etwa „neueste zuerst“ und „älteste zuerst“; beim umgekehrten zeigt der Pfeil nach oben. Der Trichter bleibt, wie er war. Die Suche nimmt den Rest der Zeile.</p>
<p class="lead">Der Trichter ist das gemeinsame Bauteil <code>controls/avm-filterknopf.vue</code>: daneben die Zahl der gesetzten Filter, im Blatt Abschnitte mit einer Wahl („alle“ zuerst) oder mit Kästchen samt Trefferzahl, unten „Filter lösen“. Die Sortierung ist <code>controls/avm-menueknopf.vue</code> mit den Zeichen aus <code>controls/avm-sortierzeichen.vue</code>, einer Familie aus den Zeichen von „Innerorts ordnen“ und der Medienverwaltung. Beide Menüs bleiben in einem Fenster im Fenster und gehen auf der Seite ihres Knopfs auf. In der Ortsliste sind die Knöpfe nur für dieses Blatt eingesetzt; die Liste selbst ist noch nicht umgebaut.</p>

<h2>Die Knöpfe und die Zeichen <span>· doppelte Dichte</span></h2>
<div class="row">
${nah("nah-filter-ruhe", "Trichter, nichts gesetzt")}
${nah("nah-filter-aktiv", "Trichter, zwei gesetzt")}
${nah("nah-filter-fokus", "Trichter, Fokus über die Tastatur")}
${nah("nah-sort-ruhe", "Sortierung „Name“, Ruhe")}
${nah("nah-sort-hover", "Sortierung, Zeiger darüber")}
</div>
<div class="row" style="margin-top:14px">
${zelle("familie", "die Familie der Sortierzeichen: links der Pfeil, rechts wonach")}
${zelle("richtung", "Richtung als eigene Ordnung: zwei Einträge, beim umgekehrten zeigt der Pfeil nach oben")}
</div>

<h2>Medienverwaltung <span>· Rechner, echte Medien · Sortierung schon gebaut (MAM), Trichter eingesetzt</span></h2>
<div class="row">
${zelle("medien-vorher", "heute: Trichter mit ▾, Sortierung als Zeichen mit Menü")}
${zelle("medien-zu", "nachher: Suche (Rest der Zeile) · Trichter (2) · Sortierzeichen · Ansicht")}
</div>
<div class="row" style="margin-top:14px">
${zelle("medien-filter", "Trichter offen: sechs Abschnitte, je eine Wahl, „alle“ zuerst")}
${zelle("medien-sort-light", "Sortierung offen: vier Ordnungen, jede mit ihrem Zeichen")}
${zelle("medien-sort-dark", "dasselbe dunkel")}
</div>

<h2>Ortsliste im Ortseditor <span>· Rechner · vorher zwei Zeilen, nachher eine</span></h2>
<div class="row">
${zelle("orte-vorher", "vorher: „▽ Filter (n) ▾“, darunter Sortierung und Maske als Klapplisten")}
${zelle("orte-zu", "nachher: Suche · Trichter (2) · Sortierzeichen; die Maske ist ein Abschnitt im Trichter")}
${zelle("orte-sort", "Sortierung offen: Name (A–Z), Ortsgröße (Balken), Zustand (◐)")}
</div>
<div class="row" style="margin-top:14px">
${zelle("orte-filter-light", "Trichter offen: Kästchen mit Trefferzahl, die Maske als Wahl mit „alle“")}
${zelle("orte-filter-dark", "dasselbe dunkel")}
</div>

<h2>Telefon und echte Größe <span>· Pixel 7, Medienverwaltung: Trichter offen (hell), Sortierung offen (dunkel)</span></h2>
<div class="row">
${zelle("telefon-light", "hell")}
${zelle("telefon-dark", "dunkel")}
${zelle("orte-echt", "Rechner hell, Ortseditor mit offenem Trichter (halbe Größe)")}
</div>

<h2>Zur Entscheidung <span>· je mit Empfehlung</span></h2>
<ol class="punkte">
<li><b>Ortsliste:</b> Die „Maske“ (alle Arten, Siedlungen, Bauwerke und Stätten) wird ein Abschnitt im Trichter statt einer eigenen Klappliste. Empfehlung: ja, sie filtert.</li>
<li><b>Eine Familie für die Sortierzeichen:</b> <code>avm-sortierzeichen.vue</code> für jede Liste; die Medienverwaltung und „Innerorts ordnen“ ziehen ihre eigenen Zeichendateien darauf um, die Formen bleiben dieselben. Empfehlung: ja.</li>
<li><b>Zeichen der Ortsliste:</b> Name A–Z, Ortsgröße die Balken, Zustand der halbe Kreis ◐ der Liste. Empfehlung: ja.</li>
<li><b>Innerorts ordnen:</b> entspricht der Regel schon (Menüknopf mit Zeichen je Ordnung); es bekommt nur die Zeichen aus der Familie. Empfehlung: ja.</li>
<li><b>Kanal:</b> Die Reiter Offen, Zur Abnahme, Archiv bleiben Reiter; Kategorie, Priorität und Zuständig wandern in den Trichter. Empfehlung: ja.</li>
</ol>

<h2>Bestandsaufnahme <span>· wo es heute Filter und Sortierung gibt</span></h2>
<table>
<tr><th>Liste</th><th>Filter heute</th><th>Sortierung heute</th><th>Besitzer</th><th>Umbau</th></tr>
${BESTAND.map(
    (zeile) =>
        `<tr><td>${zeile.liste}<br><code>${zeile.datei}</code></td><td>${zeile.filter}</td><td${zeile.sortierung.startsWith("✓") ? ' class="ok"' : ""}>${zeile.sortierung}</td><td>${zeile.besitzer}</td><td>${zeile.umbau}</td></tr>`,
).join("\n")}
</table>
<p class="note">Nur Suche, nichts umzubauen: Infopanel „Vorkommen“, Personen, Wappen- und Titelbildwahl, Legacy-Namen. Keine Liste sortiert über Spaltenköpfe.</p>
</body></html>`;
    const seite = await browser.newPage({ viewport: { width: 1624, height: 900 } });
    await seite.setContent(html);
    await seite.evaluate(() => document.fonts.ready);
    writeFileSync(resolve(OUTPUT, "blatt-2.png"), await seite.screenshot({ fullPage: true }));
    await seite.close();
});

/** Aus der Bestandsaufnahme vom 2026-10-11 (gelesen im Code, Stand `origin/master` nach 6fc7ecf7). */
const BESTAND = [
    {
        liste: "Ortsliste im Ortseditor",
        datei: "editor-liste/editor-liste.vue",
        filter: "Textknopf „▽ Filter (n) ▾“, Blatt mit Kästchen und Trefferzahl; dazu „Maske“ als Klappliste",
        sortierung: "Klappliste mit Text (Name, Ortsgröße, Zustand)",
        besitzer: "Ortseditor (WI-0126/0128)",
        umbau: "Besitzer",
    },
    {
        liste: "Medienverwaltung, Treffer",
        datei: "medien/medien-treffer.vue",
        filter: "Trichter mit Zahl und ▾, Blatt mit sechs Abschnitten (je eine Wahl)",
        sortierung: "✓ Menüknopf mit Zeichen je Ordnung (6fc7ecf7)",
        besitzer: "MAM (WI-0068)",
        umbau: "Besitzer: nur der Trichter",
    },
    {
        liste: "Literatur",
        datei: "catalog/catalog-filter-bar.vue",
        filter: "Filterleiste über mehrere Zeilen: Chips, drei Klapplisten, Zeitraum, Schalter",
        sortierung: "Wörter als Links („neueste zuerst · nach Art · …“) in eigener Zeile",
        besitzer: "Kataloge (WI-0118, ohne Besitzer)",
        umbau: "Claudia",
    },
    {
        liste: "Kartensammlung",
        datei: "catalog/catalog-filter-bar.vue",
        filter: "dieselbe Leiste: Schalter „farbig“, „kostenlos“, Zeitraum, …",
        sortierung: "keine (fest: Typ, dann Name)",
        besitzer: "Kataloge (WI-0118, ohne Besitzer)",
        umbau: "Claudia",
    },
    {
        liste: "Infopanel, Stätten (Innerorts)",
        datei: "info-panel/info-lore-row.vue",
        filter: "nur Suche",
        sortierung: "✓ Menüknopf mit Zeichen je Ordnung",
        besitzer: "Infopanel (WI-0122, ohne Besitzer)",
        umbau: "Claudia: Zeichen aus der Familie",
    },
    {
        liste: "Betreiber-Kanal, Vorgänge",
        datei: "auth/kanal-liste.vue",
        filter: "Reiter mit Zahl, zwei Klapplisten (Kategorie, Priorität), Segmente „Zuständig“",
        sortierung: "keine",
        besitzer: "Kanal (WI-0124)",
        umbau: "Besitzer (Reiter bleiben)",
    },
    {
        liste: "Protokoll (Systemsteuerung, Kontenverwaltung)",
        datei: "auth/verwaltung-fenster.vue",
        filter: "Segmente „Art der Einträge“ (Telefon: Klappliste), zwei Klapplisten „Wer“ und „Zeitraum“",
        sortierung: "keine (neueste oben)",
        besitzer: "SYS (WI-0127)",
        umbau: "Besitzer",
    },
    {
        liste: "Editorpanel, Änderungen",
        datei: "editor-panel/editor-aenderungen.vue",
        filter: "Kästchen „Nur meine Änderungen“",
        sortierung: "keine (neueste zuerst)",
        besitzer: "Ortseditor (WI-0128 E17)",
        umbau: "Besitzer",
    },
    {
        liste: "Systemsteuerung, Versionen",
        datei: "auth/verwaltung-versionen.vue",
        filter: "Schalter-Link „Auch Doku zeigen (n)“ unter der Liste",
        sortierung: "keine",
        besitzer: "Versionen (WI-0137, Claudia)",
        umbau: "Claudia",
    },
];
