import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser } from "@playwright/test";
import type { FreigabeFortschritt, FreigabeSicht, ReleaseTestSicht, UmgebungenStand } from "@avesmaps3d/shared";
import { STAGE_SHA, oeffne, PRODUCTION_ROUTE, SICHT, STAGE_ROUTE, TEST, type Lage } from "./umgebungen-leiste-stub.ts";

/**
 * Abnahmebilder der Leiste „Lokal → Stage → Production“ in „Umgebungen“ (WI-0248; Vali: „je nachdem wo man ist, soll die jeweilige umgebung
 * markiert sein … die 3 boxen in allen ansichten da und sogar gleich groß“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt Bilder vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in `umgebungen-leiste.spec.ts` und
 * `test/umgebungen-leiste.test.ts`.
 *
 * Gezeigt wird je Umgebung (Stage, Production, Lokal) die Ansicht in 1920×1080, 1280×800, 900×1000 und am Telefon, dazu einzelne Lagen (dunkel,
 * Nachweis rot, Freigabe läuft, Lokal erreichbar, Release-Test läuft oder rot, Production mit früheren Auslieferungen).
 *
 *   npm run review:umgebungen-leiste
 *
 * Ablage: `review/umgebungen-leiste/*.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/umgebungen-leiste");

const GROESSEN = [
    { name: "1920", options: { viewport: { width: 1920, height: 1080 } } },
    { name: "1280", options: { viewport: { width: 1280, height: 800 } } },
    { name: "900", options: { viewport: { width: 900, height: 1000 } } },
    { name: "telefon", options: devices["Pixel 7"] },
] as const;

type Optionen = Parameters<Browser["newContext"]>[0];

const FORTSCHRITT: FreigabeFortschritt = {
    zustand: "laeuft",
    phase: "migrieren",
    fertig: [
        { phase: "abgeholt", ms: 3_000 },
        { phase: "vorbereiten", ms: 41_000 },
    ],
    beginn: "2026-10-24T07:59:20.000Z",
    phaseSeit: "2026-10-24T08:00:04.000Z",
    ende: null,
    fehlerCode: null,
    fehler: null,
};

const LOKAL_ROUTE: UmgebungenStand = {
    ...STAGE_ROUTE,
    lokal: { adresse: "https://rechner.tail0000.ts.net", imMenue: "erreichbar" },
};

test("Blatt: Leiste Lokal → Stage → Production", async ({ browser, baseURL }) => {
    test.setTimeout(600_000);
    mkdirSync(OUTPUT, { recursive: true });

    const schuss = async (
        name: string,
        lage: Lage,
        options: Optionen,
        weiter: { unten?: boolean; mitte?: number; lokalOk?: boolean } = {},
    ) => {
        const context = await browser.newContext({ baseURL: baseURL!, ...options });
        const page = await context.newPage();
        const adresse = lage.route?.lokal?.adresse;
        if (adresse !== undefined) {
            // Die Probe ins Tailnet: `no-cors`, jede Antwort zählt als erreichbar; ohne Antwort bricht sie ab.
            await page.route(`${adresse}/**`, (route) =>
                weiter.lokalOk === true ? route.fulfill({ status: 200, body: "" }) : route.abort("failed"),
            );
        }
        await oeffne(page, lage);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(700);
        if (weiter.unten === true)
            await page
                .locator('[data-testid="systemsteuerung-fenster"] [data-testid="fenster-rumpf"]')
                .evaluate((el) => (el.scrollTop = el.scrollHeight));
        if (weiter.mitte !== undefined)
            await page
                .locator(`[data-testid="systemsteuerung-fenster"] [data-testid="fenster-rumpf"]`)
                .evaluate((el, y) => (el.scrollTop = y), weiter.mitte);
        await page.waitForTimeout(150);
        await page.screenshot({ path: resolve(OUTPUT, `${name}.png`) });
        await context.close();
    };

    const lagen: [string, Lage][] = [
        ["stage", { environment: "staging", sicht: SICHT, route: STAGE_ROUTE }],
        [
            "production",
            {
                environment: "production",
                sicht: { ...SICHT, datei: null, frueher: [], sperre: "nicht_eingerichtet" } as FreigabeSicht,
                route: PRODUCTION_ROUTE,
            },
        ],
        ["lokal", { environment: "development", test: TEST }],
    ];
    for (const [ort, lage] of lagen) {
        for (const groesse of GROESSEN) await schuss(`${ort}-${groesse.name}`, lage, groesse.options);
    }
    // Der untere Teil der Ansicht (Gleise, Themen, Panel, Release-Test-Karte) in der mittleren Größe.
    await schuss("stage-1280-unten", lagen[0]![1], GROESSEN[1].options, { unten: true });
    await schuss("lokal-1280-unten", lagen[2]![1], GROESSEN[1].options, { unten: true });
    await schuss("stage-telefon-unten", lagen[0]![1], GROESSEN[3].options, { unten: true });
    await schuss("stage-telefon-mitte", lagen[0]![1], GROESSEN[3].options, { mitte: 640 });
    await schuss("stage-telefon-mitte2", lagen[0]![1], GROESSEN[3].options, { mitte: 1200 });
    await schuss("production-telefon-mitte", lagen[1]![1], GROESSEN[3].options, { mitte: 640 });
    await schuss("lokal-telefon-mitte", lagen[2]![1], GROESSEN[3].options, { mitte: 640 });

    // Einzelne Lagen.
    const m1280 = GROESSEN[1].options;
    await schuss("stage-dunkel", lagen[0]![1], { ...m1280, colorScheme: "dark" });
    await schuss("lokal-dunkel", lagen[2]![1], { ...m1280, colorScheme: "dark" });
    await schuss(
        "stage-rot",
        {
            environment: "staging",
            sicht: {
                ...SICHT,
                sperre: "stage_rot",
                datei: { ...SICHT.datei!, stageGruen: false, nachweis: "rot" },
            } as FreigabeSicht,
            route: STAGE_ROUTE,
        },
        m1280,
    );
    await schuss(
        "stage-laeuft",
        {
            environment: "staging",
            sicht: {
                ...SICHT,
                sperre: "laeuft",
                laeuft: {
                    ops: "OPS-000142",
                    art: "release",
                    status: "neu",
                    seit: "2026-10-24T07:58:00.000Z",
                    fortschritt: FORTSCHRITT,
                },
            } as FreigabeSicht,
            route: STAGE_ROUTE,
        },
        m1280,
    );
    await schuss("stage-lokal-ok", { environment: "staging", sicht: SICHT, route: LOKAL_ROUTE }, m1280, {
        lokalOk: true,
    });
    await schuss("stage-lokal-aus", { environment: "staging", sicht: SICHT, route: LOKAL_ROUTE }, m1280);
    await schuss(
        "production-liste",
        {
            environment: "production",
            sicht: { ...SICHT, datei: null, sperre: "nicht_eingerichtet" } as FreigabeSicht,
            route: PRODUCTION_ROUTE,
        },
        m1280,
    );
    const lokalMit = (lauf: Partial<NonNullable<ReleaseTestSicht["lauf"]>>): Lage => ({
        environment: "development",
        test: { ...TEST, lauf: { ...TEST.lauf!, sha: STAGE_SHA, ...lauf } },
    });
    await schuss(
        "lokal-laeuft",
        lokalMit({ zustand: "laeuft", lebt: true, fortschritt: 0.35, start: new Date().toISOString() }),
        m1280,
    );
    await schuss("lokal-rot", lokalMit({ zustand: "rot", ende: new Date().toISOString() }), m1280);
    await schuss("lokal-gruen", lokalMit({ zustand: "gruen", ende: new Date().toISOString() }), m1280);
});
