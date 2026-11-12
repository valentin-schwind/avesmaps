import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";
import { tintenVersatz } from "./versalmitte.ts";

/**
 * 🔴 EINE EINZEILIGE KLAPPBOX HAT IM GANZEN HAUS DIESELBE KOPFHÖHE (Hausregel `.avm-klappbox-kopf`,
 * `styles/canon.css`, Guide §16.3).
 *
 * Betreiber 2026-10-07, wörtlich: „was mich stört ist, dass klappboxen alle wieder unterschiedlich hoch sind. die
 * sollen eine einheitliche höhe haben (beispiele oneliner), im routenplaner wie im infopanel etc.“
 *
 * 💣 **Warum ein Fall für ALLE Stellen und nicht einer je Fenster.** Gemessen am 2026-10-07 standen drei Höhen
 * nebeneinander — 22,00 px im Planer, 21,94 px in den Routendetails, 16,08 px im Infopanel —, und jede für sich sah
 * richtig aus. Der Fehler war nur im VERGLEICH zu sehen, und genau den prüft hier ein Lauf: Jede einzeilige
 * Klappbox-Kopfzeile des Hauses wird in derselben Sitzung gemessen und gegen DIE EINE Höhe gehalten. Ein Wächter je
 * Fenster hätte den Zustand, über den sich der Betreiber beschwert hat, dreimal grün gemeldet.
 *
 * 🔴 **Die Sollhöhe wird nicht geschrieben, sondern aus dem Kanon gelesen** (`--icon-sm` plus `--space-4` am
 * lebenden Dokument). Eine Zahl im Test wäre die vierte Setzung derselben Höhe; so prüft der Fall die REGEL.
 *
 * 🪤 **Zweizeiliges gehört nicht dazu und darf nicht einrasten.** Der Deckel mit Vorschau („33 Orte auf dem Weg“ /
 * „Trallop → … → Punin“) ist höher als die Untergrenze; der Fall hält fest, dass er es BLEIBT — eine einheitliche
 * Höhe, die der zweiten Zeile den Platz nimmt, wäre keine Lösung (Betreiber 2026-10-06 hat den einzeiligen Kopf UND
 * zweizeilige Lösungen je an ihrer Stelle bestätigt).
 *
 * 🪤 **Und die Versalmitte muss stehen bleiben.** Die Höhe eines Kopfes ist dieselbe Zahl, über die WI-0089 am
 * 2026-10-06 die vertikale Zentrierung gerettet hat; eine Vereinheitlichung, die den Text wieder aus der Mitte
 * schiebt, ist keine. Darum misst dieser Fall an jeder geänderten Art auch die Tinte gegen die Mitte der Leiste
 * (dieselbe Messung wie `leisten-mitte.spec.ts`, aus `versalmitte.ts`).
 *
 * 🪤 Braucht einen Fastify mit dem Lesepfad DIESES Worktrees auf dem Port, den `PORT` nennt, und eine
 * Entwicklungsdatenbank, in der I24 und I25 gelaufen sind (sonst fehlen die Vorkommenszeilen).
 */

test.use({ deviceScaleFactor: 4, viewport: { width: 1280, height: 1000 } });

/** Selem: der Ort mit allen vier Vorkommenszeilen (WI-0091). */
const SELEM = { kind: "place", id: "ec477f34-a34a-578e-9887-05b751f091e4" } as const;
/** Die Reichsstraße 2: trägt den Deckel „Verläuft durch 46 politische Gebiete“ UND den mit Vorschau. */
const STRASSE = { kind: "path", chain: "Reichsstraße 2:Reichsstrasse" } as const;
/** Die Landschaft „Aventurien“: die höchsten Vorkommenszahlen des Bestands (304 · 383 · 445 · 44). */
const AVENTURIEN = { kind: "area", id: "9188801c-92e6-4fbf-a6d5-794b7433f846" } as const;

interface Kopf {
    /** Wo er steht, für die Fehlermeldung. */
    ort: string;
    /** Die Aufschrift, gekürzt. */
    text: string;
    hoehe: number;
    /** Wie viele Zeilen die Aufschrift wirklich braucht. */
    einzeilig: boolean;
}

/**
 * Liest jede sichtbare Klappbox-Kopfzeile der Seite: die der Klappbox (`avm-disclosure`) und die des Deckels
 * (`info-lid`). 🪤 Der Deckel wird über die KLASSE gesucht, nicht über `data-testid="info-lid"` — eine Stelle, die
 * eine eigene Kennung mitgibt (die Vorkommenszeile), überschreibt die des Bauteils, und genau daran war die erste
 * Vermessung dieser Sitzung blind: Sie fand die vier Zeilen aus dem Bildschirmfoto des Betreibers nicht.
 *
 * Einzeilig heißt: Die Aufschrift braucht genau eine Zeile. Das wird am gezeichneten Kasten entschieden
 * (Höhe der Aufschrift gegen die Höhe EINER ihrer Zeilen), nicht am Text — ein Kopf, der eine zweite Zeile trägt,
 * fällt dann von selbst heraus.
 */
async function koepfe(page: Page, ort: string): Promise<Kopf[]> {
    return page.evaluate((ort) => {
        const raus: Kopf[] = [];
        const kurz = (element: Element): string => (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 46);
        for (const box of document.querySelectorAll<HTMLElement>(".disclosure")) {
            const kopf = box.querySelector<HTMLElement>(".disclosure__summary");
            if (kopf === null) continue;
            const felder = kopf.querySelector<HTMLElement>(".disclosure__labels");
            if (felder === null) continue;
            const hoehe = kopf.getBoundingClientRect().height;
            if (hoehe === 0) continue;
            const zeile = Number.parseFloat(getComputedStyle(kopf).lineHeight);
            raus.push({
                ort,
                text: kurz(kopf),
                hoehe: Math.round(hoehe * 100) / 100,
                einzeilig: felder.getBoundingClientRect().height < zeile * 1.5,
            });
        }
        for (const box of document.querySelectorAll<HTMLElement>(".info-lid")) {
            const kopf = box.querySelector<HTMLElement>(".info-lid__summary");
            if (kopf === null) continue;
            const fuss = kopf.querySelector<HTMLElement>(".info-lid__foot");
            if (fuss === null) continue;
            const hoehe = kopf.getBoundingClientRect().height;
            if (hoehe === 0) continue;
            /*
             * Zweizeilig ist der Deckel mit der Vorschau unter der Aufschrift („33 Orte auf dem Weg“ / „Trallop →
             * … → Punin“). Eine umbrechende Aufschrift gibt es seit WI-0098 nicht mehr; bräche sie doch, fiele der
             * Kopf über die Höhe der Reihe trotzdem heraus und der erste Fall würde laut.
             */
            const vorschau = kopf.querySelector<HTMLElement>(".info-lid__preview") !== null;
            const felder = [...fuss.children].map((kind) => kind.getBoundingClientRect().height);
            const umbruch = fuss.getBoundingClientRect().height > Math.max(...felder, 0) * 1.5;
            raus.push({
                ort,
                text: kurz(kopf),
                hoehe: Math.round(hoehe * 100) / 100,
                einzeilig: !vorschau && !umbruch,
            });
        }
        return raus;
    }, ort);
}

/** Die EINE Höhe, aus dem Kanon gelesen: eine Symbolzeile in gleichem Polster oben und unten. */
function sollHoehe(page: Page): Promise<number> {
    return page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;visibility:hidden;height:calc(var(--icon-sm) + var(--space-4))";
        document.body.append(probe);
        const hoehe = probe.getBoundingClientRect().height;
        probe.remove();
        return Math.round(hoehe * 100) / 100;
    });
}

async function openPlanner(page: Page): Promise<void> {
    await page.goto("/?route=Gareth~Greifenfurt");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await expect(page.getByTestId("route-title")).toBeVisible({ timeout: 60_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
}

/** Zugeklappt messen: nur dann steht die Kurzangabe des Planers überhaupt da (`summaryClosedOnly`). */
async function alleZu(page: Page): Promise<void> {
    for (const toggle of await page.locator(".disclosure__summary").all()) {
        if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    }
    await page.waitForTimeout(500);
}

async function openPanel(page: Page, ref: Record<string, unknown>): Promise<void> {
    await openMap(page);
    await page.evaluate((target) => globalThis.avesmapsOpenSubject?.(target), ref);
    await expect(page.getByTestId("info-title")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
}

test("🔴 jede einzeilige Klappbox des Hauses ist genau so hoch wie jede andere - Planer und Infopanel in EINEM Lauf", async ({
    page,
}) => {
    test.setTimeout(600_000);
    for (const groesse of [
        { name: "Rechner", width: 1280, height: 1000 },
        { name: "360 px", width: 360, height: 900 },
    ]) {
        await page.setViewportSize({ width: groesse.width, height: groesse.height });
        for (const schema of ["light", "dark"] as const) {
            await page.emulateMedia({ colorScheme: schema });
            const wo = `${groesse.name}, ${schema}`;
            const alle: Kopf[] = [];

            // 1. Der Routenplaner: die zwei Leisten mit einzeiliger Kurzangabe UND die Deckel der Routendetails.
            await openPlanner(page);
            await alleZu(page);
            const soll = await sollHoehe(page);
            expect(soll, `${wo}: --icon-sm + --space-4`).toBe(22);
            alle.push(...(await koepfe(page, `Planer (${wo})`)));
            for (const id of ["planner-transport", "planner-options"]) {
                expect(await page.locator(`[data-testid="${id}"]`).count(), `${wo}: ${id}`).toBe(1);
            }

            // 2. Das Infopanel, zwei Gegenstände: die vier Vorkommenszeilen und die zwei Arten von Deckel.
            await openPanel(page, SELEM);
            alle.push(...(await koepfe(page, `Panel Selem (${wo})`)));
            await openPanel(page, STRASSE);
            alle.push(...(await koepfe(page, `Panel Reichsstraße 2 (${wo})`)));

            const einzeilig = alle.filter((kopf) => kopf.einzeilig);
            const mehrzeilig = alle.filter((kopf) => !kopf.einzeilig);

            /*
             * 🪤 Der Wächter gegen einen Fall, der nichts findet und trotzdem grün ist: Gemessen am 2026-10-07 standen
             * im Planer fünf und im Panel sechs einzeilige Köpfe (bei 360 px drei weniger, weil die Vorkommenssätze
             * dort umbrechen). Acht ist die Untergrenze, unter der etwas fehlt — die Route, die Lore oder das Panel.
             */
            expect(einzeilig.length, `${wo}: zu wenige einzeilige Klappboxen gefunden`).toBeGreaterThanOrEqual(8);

            // 🔴 Die Zusicherung: EINE Höhe, auf den Pixel, über alle Fenster hinweg.
            for (const kopf of einzeilig) {
                expect(kopf.hoehe, `${kopf.ort} „${kopf.text}" ist ${String(kopf.hoehe)} px hoch`).toBe(soll);
            }

            /*
             * 🔴 Und das Mehrzeilige bleibt mehrzeilig: Die Untergrenze darf es nicht zusammendrücken. Gemessen:
             * der Deckel mit Vorschau 33,47 px, eine umgebrochene Vorkommenszeile bei 360 px 29,38 px.
             */
            expect(mehrzeilig.length, `${wo}: kein mehrzeiliger Kopf im Lauf`).toBeGreaterThanOrEqual(1);
            for (const kopf of mehrzeilig) {
                expect(kopf.hoehe, `${kopf.ort} „${kopf.text}" (mehrzeilig)`).toBeGreaterThan(soll);
            }
        }
    }
});

/**
 * 🔴 EINE EINZEILIGE KLAPPBOX BLEIBT EINZEILIG, AUCH WENN DER TEXT NICHT HINEINPASST.
 *
 * Betreiber 2026-10-07 am Bildschirmfoto der Feldzeile „Waren · 88 Handelswaren gelistet“, wörtlich: **„das darf
 * nicht passieren“** - der Pfeil war dort in eine zweite Zeile unter den Text gerutscht, und der Kopf stand doppelt
 * so hoch wie seine Nachbarn. Eine einheitliche Höhe, die bei langem Text umbricht, ist keine einheitliche Höhe.
 *
 * 💣 Gemessen am 2026-10-07, wo die Breite entsteht: Das Panel ist bis 480 px Fenster 400 px breit und darunter
 * Fenster minus 30; bei 360 px bleiben der Wertespalte 175 px und der Reihe im Deckel 155 px. „445 Pflanzenarten
 * gesehen“ braucht 154,06 px Text, 6 px Abstand und 11 px Pfeil, also 171 px. **Die Feldzeile ist nicht die
 * Ursache** - sie reicht mit `minmax(0, 1fr)` und `min-width: 0` eine harte Grenze herein; die Klappbox ging in die
 * Höhe, statt den Text zu kürzen.
 *
 * Geprüft wird deshalb über eine BREITENREIHE bis 320 px, und zwar dreifach: die Höhe bleibt die eine Höhe, die
 * Reihe bleibt EINE Zeile, und der Text kürzt wirklich (er ist breiter als sein Kasten). Dazu eine Sonde mit der
 * längsten Zeichenfolge, die der Bestand überhaupt hergeben kann.
 */
test("🔴 eine einzeilige Klappbox bleibt einzeilig - sie kürzt den Text, statt den Pfeil umzubrechen", async ({
    page,
}) => {
    test.setTimeout(600_000);
    /*
     * 🔴 Die längste Zeichenfolge des Bestands: Mehr Einträge als es gibt, kann kein Gegenstand zeigen, und
     * `lore_entry` führt am 2026-10-07 2.553 Waren, 1.389 Tierarten, 1.007 Pflanzenarten und 189 Spezies. Die
     * breiteste Aufschrift ist damit die vierstellige Warenzeile - länger wird sie in diesen Daten nie.
     */
    const laengste = "2.553 Handelswaren gelistet";
    for (const schema of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: schema });
        for (const breite of [1280, 768, 480, 414, 390, 360, 320]) {
            await page.setViewportSize({ width: breite, height: 900 });
            await openPanel(page, AVENTURIEN);
            const soll = await sollHoehe(page);
            for (const sonde of [false, true] as const) {
                const befund = await page.evaluate(
                    ({ sonde, laengste }) => {
                        const raus: { text: string; kopf: number; zeilen: number; gekuerzt: boolean }[] = [];
                        for (const lid of document.querySelectorAll<HTMLElement>(".info-lid")) {
                            const kopf = lid.querySelector<HTMLElement>(".info-lid__summary");
                            const fuss = lid.querySelector<HTMLElement>(".info-lid__foot");
                            const text = lid.querySelector<HTMLElement>(".info-lid__summary-text");
                            if (kopf === null || fuss === null || text === null) continue;
                            if (kopf.querySelector(".info-lid__preview") !== null) continue;
                            /*
                             * 🪤 Die Sonde ersetzt NUR den gezeichneten Text, nichts am Erzeugnis: Eine Aufschrift
                             * mit vierstelliger Zahl steht in diesen Daten an keinem Gegenstand, die Obergrenze des
                             * Bestands lässt sie aber zu - und genau sie muss der Kopf aushalten.
                             */
                            if (sonde) text.textContent = laengste;
                            const felder = [...fuss.children].map((kind) => kind.getBoundingClientRect().height);
                            raus.push({
                                text: (text.textContent ?? "").slice(0, 40),
                                kopf: Math.round(kopf.getBoundingClientRect().height * 100) / 100,
                                zeilen: fuss.getBoundingClientRect().height / Math.max(...felder, 1),
                                gekuerzt: text.scrollWidth > text.clientWidth,
                            });
                        }
                        return raus;
                    },
                    { sonde, laengste },
                );
                const wo = `${String(breite)} px, ${schema}${sonde ? ", Sonde" : ""}`;
                expect(befund.length, `${wo}: keine einzeilige Klappbox gefunden`).toBeGreaterThanOrEqual(4);
                for (const kopf of befund) {
                    expect(kopf.kopf, `${wo}: „${kopf.text}" ist ${String(kopf.kopf)} px hoch`).toBe(soll);
                    expect(kopf.zeilen, `${wo}: „${kopf.text}" steht in mehr als einer Zeile`).toBeLessThan(1.5);
                }
                /*
                 * 🔴 Und die Kürzung ist wirklich eine: Ab 360 px Fenster ist die Aufschrift der Sonde breiter als
                 * ihr Kasten (gemessen: 168 px Text in einem 138 px breiten Kasten), steht also mit Auslassungspunkt
                 * da. Ohne diese Zeile wäre der Fall auch grün, wenn der Text einfach aus dem Panel hinausliefe.
                 * 🪤 Bei 480 px greift sie NICHT, und das ist richtig: Dort ist das Panel noch seine vollen 400 px
                 * breit, die Sonde passt hinein, und eine Kürzung wäre dort ein Fehler.
                 */
                if (sonde && breite <= 360) {
                    expect(
                        befund.filter((kopf) => kopf.gekuerzt).length,
                        `${wo}: nichts wurde gekürzt - läuft der Text hinaus?`,
                    ).toBeGreaterThanOrEqual(4);
                }
            }
        }
    }
});

/**
 * 🔴 Die Höhe darf die Versalmitte nicht verschieben (Guide §3.2, Schranke 0,75 px).
 *
 * 💣 Gemessen wird hier der DECKEL des Infopanels, denn nur er ist gewachsen (16,08 → 22,00 px): Die Reihe sitzt
 * jetzt senkrecht zentriert in einem höheren Kopf, und wäre sie oben angeschlagen, hinge die Aufschrift 2,83 px zu
 * hoch — genau der Fehler, den WI-0089 am 2026-10-06 im Planer behoben hat. Die Köpfe des Planers prüft
 * `leisten-mitte.spec.ts` weiter mit denselben Zahlen; dieser Fall deckt die zweite Stelle.
 */
test("🔴 der gewachsene Deckel trägt seine Versalhöhe weiter mittig", async ({ page }) => {
    test.setTimeout(300_000);
    for (const groesse of [
        { name: "Rechner", width: 1280, height: 1000 },
        { name: "360 px", width: 360, height: 900 },
    ]) {
        await page.setViewportSize({ width: groesse.width, height: groesse.height });
        for (const schema of ["light", "dark"] as const) {
            await page.emulateMedia({ colorScheme: schema });
            await page.emulateMedia({ colorScheme: schema, reducedMotion: "reduce" });
            await openPanel(page, STRASSE);
            const versatz = await tintenVersatz(
                page,
                '[data-testid="info-lid"] .info-lid__summary',
                '[data-testid="info-lid"] .info-lid__foot > *:first-child',
            );
            expect(
                Math.abs(versatz),
                `Deckel „Verläuft durch …", ${groesse.name}, ${schema}: ${String(versatz)} px`,
            ).toBeLessThanOrEqual(0.75);
        }
    }
});
