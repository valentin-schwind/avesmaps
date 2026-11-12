import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";
import { tintenVersatz } from "./versalmitte.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * 🔴 IN EINER LEISTE SITZT DIE VERSALHÖHE IN DER MITTE, NICHT DIE ZEILE (Hausregel, Guide §3.2, Rezept `.avm-versalmitte` in
 * `styles/canon.css`).
 *
 * 💣 Warum dieser Wächter: Dieselbe Sache wurde dreimal verlangt - 2026-09-25 „DE | EN einfach nur perfekt vertikal zentrieren sonst
 * nix“, 2026-10-04 „mach den text darin fett und zentrier ihn vertikal exakt mittig“, 2026-10-05 „kannst du bei sowas darauf achten,
 * dass der text immer vertikal zentriert ist?“ (am Bild des Abschnittskopfs „Literatur zu Gareth (85)“). Ohne eine Messung kommt die
 * vierte Runde, denn man sieht einen halben Pixel erst, wenn man danach sucht.
 *
 * Gemessen wird die TINTE im gezeichneten Bild, nicht das Stylesheet: ein Ausschnitt um die Leiste, im Browser auf Schriftpixel
 * untersucht. Gezählt wird nur die ERSTE Glyphe des Textes - ein Großbuchstabe: Umlautpunkte und Unterlängen späterer Buchstaben
 * gehören nicht zur Versalhöhe und verschöben die Messung („Literatur zu Königreich“ wäre sonst 0,9 px anders als „Literatur zu
 * Gareth“).
 *
 * 🪤 Die Grenze ist 0,75 px und nicht 0: Chrome setzt die Grundlinie auf ein ganzes CSS-Pixel, und je nachdem, wo die Leiste steht,
 * fällt sie bis zu 0,5 px vor oder zurück (gemessen 2026-10-05: dieselbe Leiste, drei Panels, Tinte 0,43 px auseinander). Das ist
 * genau der Rundungsfehler, dessentwegen die Regel die VERSALHÖHE schneidet statt die Zeile; mehr lässt sich mit CSS nicht holen.
 * Vor der Regel standen hier 0,9 bis 4,8 px.
 */

test.use({ deviceScaleFactor: 4, viewport: { width: 1280, height: 900 } });

/** Was geöffnet wird und welche Leisten darin stehen. */
const FAELLE = [
    {
        name: "Gareth (Abschnittskopf, Kanon-Pille, Quellen-Reiter)",
        ref: { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" },
        titel: "Gareth",
        leisten: [
            { was: "Abschnittskopf", band: ".info-section__head", text: '[data-testid="info-section-title"]' },
            {
                was: "Kanon-Pille",
                band: '[data-testid="info-header"] [data-testid="info-canon"]',
                text: '[data-testid="info-header"] [data-testid="info-canon"] .info-canon__state',
            },
            { was: "Quellen-Reiter", band: ".info-source__tab", text: ".info-source__tab > span:first-child" },
        ],
    },
    {
        name: "Ein verborgener Ort (beide Pillen nebeneinander)",
        ref: { kind: "place", id: "205a5b21-22ff-419a-866e-1de2aa7428fa" },
        titel: /Ritualplatz/,
        leisten: [
            {
                was: "Kanon-Pille",
                band: '[data-testid="info-header"] [data-testid="info-canon"]',
                text: '[data-testid="info-header"] [data-testid="info-canon"] .info-canon__state',
            },
            {
                was: "Pille Verborgen",
                band: '[data-testid="info-hidden"]',
                text: '[data-testid="info-hidden"] .info-hidden__word',
            },
        ],
    },
    {
        name: "Reichsstraße 2 (der Deckel)",
        ref: { kind: "path", chain: "Reichsstraße 2:Reichsstrasse" },
        titel: /Reichsstraße 2/,
        leisten: [
            {
                was: "Deckel",
                band: '[data-testid="info-lid"] .info-lid__summary',
                text: '[data-testid="info-lid"] .info-lid__foot > *:first-child',
            },
        ],
    },
] as const;

/**
 * Die beiden Arten von Klappbox-Kopfzeile im Routenplaner. Sie sind seit WI-0089 P3 DASSELBE Bauteil
 * (`controls/avm-disclosure.vue`), tragen aber Verschiedenes: die des Planers eine einzeilige Kurzangabe mit Symbolen
 * (`summaryOneLine`, Zeile so hoch wie ein Symbol), die der Routendetails eine umbrechende ohne.
 */
const PLANER_LEISTEN = [
    { was: "Planer-Kopfzeile (Kurzangabe einzeilig, mit Symbolen)", box: '[data-testid="planner-transport"]' },
    { was: "Planer-Kopfzeile (Kurzangabe einzeilig, ohne Symbole)", box: '[data-testid="planner-options"]' },
] as const;

/**
 * Die Deckel der Routendetails, die die Reise Gareth → Greifenfurt trägt: zwei mit Kurzangabe und der eine ohne - an
 * ihm war 2026-10-06 der erste Versuch mit `.avm-versalmitte` gescheitert (−0,66 → −2,19 px), er gehört deshalb dazu.
 */
const DETAIL_LEISTEN = [
    { was: "Routendetails-Deckel (Höhenprofil)", box: '[data-testid="planning-profile"]', kurz: true },
    { was: "Routendetails-Deckel (Reisekosten)", box: '[data-testid="planning-costs"]', kurz: true },
    {
        was: "Routendetails-Deckel (Landschaften und Gebiete, ohne Kurzangabe)",
        box: '[data-testid="route-areas"]',
        kurz: false,
    },
] as const;

async function openPlanner(page: Page): Promise<void> {
    await page.goto("/?route=Gareth~Greifenfurt");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-title")).toBeVisible({ timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
}

/** Zugeklappt messen: nur dann steht die Kurzangabe des Planers überhaupt da (`summaryClosedOnly`). */
async function closeLid(page: Page, box: string): Promise<void> {
    const toggle = page.locator(`${box} .disclosure__summary`).first();
    if ((await toggle.getAttribute("aria-expanded")) === "true") {
        await toggle.click();
        await page.waitForTimeout(400);
    }
}

/**
 * Der Abstand der Grundlinien von Titel und Kurzangabe, gemessen mit einer eingehängten Sonde ohne Ausdehnung.
 * Positiv hieße: die Kurzangabe sitzt tiefer als der Titel.
 */
function grundlinienAbstand(page: Page, box: string): Promise<number> {
    return page.evaluate((box) => {
        const lid = document.querySelector<HTMLElement>(box);
        if (lid === null) throw new Error(`${box} fehlt`);
        const messe = (ziel: Element | null): number => {
            if (ziel === null) throw new Error(`${box}: Feld fehlt`);
            const sonde = document.createElement("span");
            sonde.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
            ziel.append(sonde);
            const y = sonde.getBoundingClientRect().y;
            sonde.remove();
            return y;
        };
        const titel = messe(lid.querySelector(".disclosure__labels > *:first-child .avm-text"));
        const kurz = messe(lid.querySelector(".disclosure__secondary"));
        return Math.round((kurz - titel) * 100) / 100;
    }, box);
}

/**
 * Die Höhe des Kopfes gegen die Haushöhe einer einzeiligen Klappbox (`.avm-klappbox-kopf`), beide am lebenden Dokument
 * gelesen - die Sollzahl kommt aus dem Kanon, nicht aus dem Test (wie in `klappbox-hoehe.spec.ts`).
 */
function kopfGegenHaushoehe(page: Page, box: string): Promise<{ kopf: number; soll: number }> {
    return page.evaluate((box) => {
        const kopf = document.querySelector<HTMLElement>(`${box} .disclosure__summary`);
        if (kopf === null) throw new Error(`${box}: Kopf fehlt`);
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;visibility:hidden;height:calc(var(--icon-sm) + var(--space-4))";
        document.body.append(probe);
        const soll = probe.getBoundingClientRect().height;
        probe.remove();
        const runde = (wert: number): number => Math.round(wert * 100) / 100;
        return { kopf: runde(kopf.getBoundingClientRect().height), soll: runde(soll) };
    }, box);
}

const titelTinte = (page: Page, box: string): Promise<number> =>
    tintenVersatz(page, `${box} .disclosure__summary`, `${box} .disclosure__labels > *:first-child .avm-text`);

/**
 * 🔴 Der Befund des Betreibers vom 2026-10-06: „kann es sein, dass die vertikale zentrierung von ‚Transportmittel…'
 * und ‚Reiseoptionen…' um ein paar pixel zu weit hoch ist?" - gemessen am Bild stimmte es: **2,08 px** am Rechner und
 * **2,11 px** bei 360 px, hell wie dunkel, in beiden Kästen gleich.
 *
 * 💣 Die Ursache war die fehlende zweite Hälfte der Hausregel §3.2: `.disclosure__labels` richtete seine zwei Felder
 * NICHT an der Grundlinie aus. Die Kurzangabe ist im Planer 16 px hoch (so hoch wie ein Symbol, N2), der Titel
 * 13,75 px; gestreckt sitzt jedes Feld am Kopf seines eigenen Zeilenkastens, und der Titel hing 2,00 px über der
 * Grundlinie seiner eigenen Kurzangabe. Deshalb misst dieser Fall BEIDES: die Versalmitte und die gemeinsame
 * Grundlinie - die Grundlinie ist die harte Zusicherung (sie muss exakt stimmen), die Versalmitte die Schranke.
 */
test("🔴 die Kopfzeilen des Planers tragen ihre Versalhöhe mittig und ihre Kurzangabe auf derselben Grundlinie", async ({
    page,
}) => {
    test.setTimeout(240_000);
    for (const groesse of [
        { name: "Rechner", width: 1280, height: 1000 },
        { name: "360 px", width: 360, height: 900 },
    ]) {
        await page.setViewportSize({ width: groesse.width, height: groesse.height });
        for (const schema of ["light", "dark"] as const) {
            await page.emulateMedia({ colorScheme: schema });
            await openPlanner(page);
            for (const leiste of PLANER_LEISTEN) {
                const wo = `${leiste.was}, ${groesse.name}, ${schema}`;
                await expect(page.locator(leiste.box)).toHaveCount(1);
                await closeLid(page, leiste.box);
                const abstand = await grundlinienAbstand(page, leiste.box);
                expect(abstand, `${wo}: Titel und Kurzangabe ${String(abstand)} px auseinander`).toBe(0);
                const versatz = await titelTinte(page, leiste.box);
                expect(Math.abs(versatz), `${wo} um ${String(versatz)} px`).toBeLessThanOrEqual(0.75);
            }
        }
    }
});

/**
 * Die zweite Art: die Deckel der Routendetails. 🔴 Betreiber 2026-10-11 zum Befund aus dem dritten Nachgang von WI-0089
 * (0,72 bis 1,09 px zu hoch, damals nur festgehalten): **„Reiseplaner: reparieren“**.
 *
 * 💣 Gemessen vor der Behebung (2026-10-11, Gareth → Greifenfurt): an der Geometrie **−1,26 px** in jedem Deckel, am
 * Bild je nach Lage −0,81 bis −0,94 px (Rechner) und −1,44 bis −1,56 px (360 px) - der alte Fall mit seiner Schranke
 * 1,25 px war damit selbst rot. Die 1,26 px sind zu drei Vierteln Blink: Der Durchschuss des Zeilenkastens
 * (15,9375 − 11 − 3 = 1,94 px) kommt nicht hälftig über und unter die Schrift, die obere Hälfte wird abgerundet
 * (`floor(0,97) = 0`), die Grundlinie steht bei 11,00 statt 11,97 px. Der Rest ist die Schrift selbst (−0,26) und die
 * Untergrenze `.avm-klappbox-kopf` (−0,03). Die Rechnung steht am Stilblatt von `avm-disclosure.vue`.
 *
 * Behoben mit beiden Hälften der Hausregel am Feld: `.avm-versalmitte` an Titel und Kurzangabe, und gleiches Polster
 * darüber und darunter, `(1lh − 1cap) / 2` - also genau die Zeile, die das Feld vorher hatte. Danach **−0,02 px** an
 * der Geometrie, am Bild höchstens 0,56 px (der Rundungsrest der Grundlinie, siehe oben). Dieser Fall sichert deshalb
 * die Schranke 0,75 px wie bei jeder anderen Leiste zu, dazu die gemeinsame Grundlinie und dass der Kopf genau die
 * Haushöhe behält: Die Behebung durfte die Deckelhöhe NICHT ändern (ein auf die Versalhöhe geschnittener Kasten
 * ohne das Polster hätte sie auf rund 14 px gedrückt).
 */
test("🔴 die Deckel der Routendetails tragen ihre Versalhöhe mittig, behalten ihre Höhe und ihre gemeinsame Grundlinie", async ({
    page,
}) => {
    test.setTimeout(240_000);
    for (const groesse of [
        { name: "Rechner", width: 1280, height: 1000 },
        { name: "360 px", width: 360, height: 900 },
    ]) {
        await page.setViewportSize({ width: groesse.width, height: groesse.height });
        for (const schema of ["light", "dark"] as const) {
            await page.emulateMedia({ colorScheme: schema });
            await openPlanner(page);
            for (const leiste of DETAIL_LEISTEN) {
                const wo = `${leiste.was}, ${groesse.name}, ${schema}`;
                if ((await page.locator(leiste.box).count()) === 0) {
                    throw new Error(`${wo}: der Deckel steht nicht in der Übersicht (andere Route?)`);
                }
                await closeLid(page, leiste.box);
                const hoehe = await kopfGegenHaushoehe(page, leiste.box);
                expect(hoehe.kopf, `${wo}: Kopf ${String(hoehe.kopf)} px statt ${String(hoehe.soll)}`).toBe(hoehe.soll);
                if (leiste.kurz) {
                    const abstand = await grundlinienAbstand(page, leiste.box);
                    expect(abstand, `${wo}: Titel und Kurzangabe ${String(abstand)} px auseinander`).toBe(0);
                }
                const versatz = await titelTinte(page, leiste.box);
                expect(Math.abs(versatz), `${wo} um ${String(versatz)} px`).toBeLessThanOrEqual(0.75);
            }
        }
    }
});

test("🔴 jede Leiste und jede Pille des Infopanels trägt ihre Versalhöhe mittig, hell und dunkel", async ({ page }) => {
    test.setTimeout(240_000);
    await openMap(page);
    for (const schema of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: schema });
        for (const fall of FAELLE) {
            await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), fall.ref);
            await expect(page.getByTestId("info-title")).toHaveText(fall.titel, { timeout: 30_000 });
            await page.evaluate(() => document.fonts.ready);
            // Die Fahrt des Panels und die nachgeladenen Abschnitte abwarten.
            await page.waitForTimeout(900);
            for (const leiste of fall.leisten) {
                const wo = `${fall.name}, ${schema}: ${leiste.was}`;
                if ((await page.locator(leiste.band).count()) === 0) {
                    throw new Error(`${wo}: die Leiste steht nicht im Panel (anderer Datensatz?)`);
                }
                const versatz = await tintenVersatz(page, leiste.band, leiste.text);
                expect(Math.abs(versatz), `${wo} um ${String(versatz)} px`).toBeLessThanOrEqual(0.75);
            }
        }
    }
});

/**
 * Die Schiene der Verwaltung (WI-0127 SYS-1, Guide §13.12, SYS-0001 §7.1): Jeder Eintrag ist eine Zeile mit einem einzelnen
 * Text, also gilt die Hausregel - gleiches Polster oben und unten, der Text auf die Versalhöhe geschnitten. Gemessen an einem
 * gewählten Eintrag (Fläche und goldener Balken) und einem ruhenden, hell und dunkel.
 *
 * 🪤 Der Bereichskopf stand hier mit in der Messung. Seit dem 14.10. trägt diese Schiene keinen mehr (Betreiber: „keine
 * trennlinie, keine gruppierungen“) - sie ist eine durchgehende Liste. Bereichsköpfe gibt es weiter in der Schiene der
 * Medienarten; dort misst `medien.spec.ts` ihren Zustand, die Versalhöhe desselben Bauteils steht hier an den Einträgen.
 */
test("🔴 die Schiene der Verwaltung trägt ihre Versalhöhe mittig: gewählt und ruhend, hell und dunkel", async ({
    page,
}) => {
    await stubAdmin(page);
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-kontenverwaltung").click();
    await expect(page.getByRole("dialog", { name: "Kontenverwaltung" })).toBeVisible();
    const LEISTEN = [
        { was: "Eintrag gewählt", id: "verwaltung-eintrag-personen", text: ".fenster-schiene__name" },
        { was: "Eintrag", id: "verwaltung-eintrag-rollen", text: ".fenster-schiene__name" },
    ] as const;
    for (const schema of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: schema });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        for (const leiste of LEISTEN) {
            const band = `[data-testid="${leiste.id}"]`;
            const versatz = await tintenVersatz(page, band, `${band} ${leiste.text}`);
            expect(Math.abs(versatz), `${leiste.was}, ${schema} um ${String(versatz)} px`).toBeLessThanOrEqual(0.75);
        }
    }
});
