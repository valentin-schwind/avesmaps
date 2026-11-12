import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { AdminAbgleiche, FreigabeSicht } from "@avesmaps3d/shared";
import { abgleicheServer, abgleicheStand, lauf, zeile } from "./abgleiche-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Production-Zug und Rückweg“ (WI-0144; Betreiber 2026-10-14, wörtlich: „ich will auf der stage den button
 * "Production-Zug holen" … unter "Abgleiche" darf auf der Stage nur "Production-Zug" stehen … ich muss auf der stage im reiter
 * "Production" sehen, dass ein Feature-Release zurückgefahren wurde … Und in Production lassen wir das mal so wie jetzt.“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/abgleiche.test.ts`, `test/freigabe.test.ts` und auf dem Server in `abgleiche-routes.test.ts`,
 * `abgleiche-korridor.test.ts` und `freigabe.test.ts`.
 *
 * Gezeigt wird das Gebaute auf der ECHTEN Karte, in echter Größe und in Nahaufnahme: die eine Zeile der Stage mit ihrem eigenen
 * Knopf, die Rückfrage, die Lagen des Zugs, Production unverändert daneben, und der Rückweg im Reiter „Production“.
 *
 *   npm run review:production-zug
 *
 * Ablage: `review/wi-0144/blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0144");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "run_legacy_sync", "run_legacy_zug"];
const MIT_ZUG = [...BETREIBER, "run_production_pull"];
const MINUTE = 60_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;
const LISTE = ".abgleiche__liste";
const FENSTER = '[data-testid="systemsteuerung-fenster"]';

test.use({ actionTimeout: 30_000 });

// --- Die Stände: Stage (nur der Production-Zug) und Production (unverändert) --------------------------------------

/** Die Stage nach WI-0144: `ABGLEICHE=production:korridor`. Legacy und Medien sind verborgen, der Server schickt sie nicht mit. */
const stage = (patch: Partial<AdminAbgleiche> = {}): AdminAbgleiche =>
    abgleicheStand({
        ausfuehrung: "verborgen",
        zeilen: [
            zeile("production", {
                ausfuehrung: "korridor",
                kreis: "voll",
                letzter: lauf({
                    jobId: "7e570000-0000-4000-8000-0000000000d1",
                    finishedAt: ago(3 * 60 * MINUTE),
                    befunde: null,
                    satz: null,
                }),
            }),
        ],
        ...patch,
    });

/** Production nach WI-0141, unverändert: der ganze Zug gesperrt, die drei Kategorien über den Korridor, Medien aus. */
const production = (): AdminAbgleiche =>
    abgleicheStand({
        zeilen: [
            zeile("legacy", {
                ausfuehrung: "aus",
                kreis: "voll",
                letzter: lauf({ finishedAt: ago(26 * 60 * MINUTE) }),
            }),
            zeile("legacy_landschaften", {
                ausfuehrung: "korridor",
                kreis: "voll",
                letzter: lauf({ jobId: "7e570000-0000-4000-8000-0000000000d2", finishedAt: ago(9 * 60 * MINUTE) }),
            }),
            zeile("legacy_wege", { ausfuehrung: "korridor" }),
            zeile("legacy_orte", { ausfuehrung: "noch_nicht" }),
            zeile("medien", { ausfuehrung: "aus" }),
        ],
    });

interface Opened {
    page: Page;
    close: () => Promise<void>;
}

async function abgleiche(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    stand: AdminAbgleiche = stage(),
    capabilities: string[] = MIT_ZUG,
): Promise<Opened> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    const server = abgleicheServer(stand);
    await stubAdmin(page, {
        capabilities,
        role: "operator",
        person: { passkeyCount: 1 },
        answer: (call) => server.handle(call),
    });
    await page.goto("/?verwaltung=abgleiche");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("abgleiche").waitFor({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    return { page, close: () => context.close() };
}

async function reiter(browser: Browser, baseURL: string, sicht: FreigabeSicht, options: BrowserContextOptions = {}) {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, {
        capabilities: [...MIT_ZUG, "release_to_production"],
        role: "operator",
        person: { passkeyCount: 1 },
        answer: (call) =>
            call.path.startsWith("/api/admin/system/production") ? { status: 200, body: sicht } : undefined,
    });
    await page.goto("/?verwaltung=production");
    await page.getByTestId("production-rollback").waitFor({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    return { page, close: () => context.close() };
}

/** Die Sicht des Reiters „Production“ auf der Stage, mit und ohne Rückweg. */
const FREIGABE: FreigabeSicht = {
    now: new Date().toISOString(),
    datei: {
        schema: 1,
        standAt: ago(4 * MINUTE),
        production: { release: "878c244", commit: "878c244".padEnd(40, "0"), seit: ago(32 * 60 * MINUTE) },
        stage: { release: "e2f28dd", commit: "e2f28dd".padEnd(40, "0"), seit: ago(80 * MINUTE) },
        stageGruen: true,
        stagePruefung: "Proben und Journal grün, 14. Okt. 02:08",
        technik: { migrationen: ["0126"], rechte: [], umgebungswerte: ["ABGLEICHE"] },
        themen: [
            {
                id: "grundlage",
                name: null,
                satz: null,
                unredigiert: false,
                marken: ["migration", "umgebungswert"],
                anzahl: 9,
                bis: "3396055",
            },
            {
                id: "WI-0139",
                name: "Neuigkeiten in Production",
                satz: "Unter „Neuigkeiten“ steht jetzt, was sich auf avesmaps.de getan hat.",
                unredigiert: false,
                marken: [],
                anzahl: 7,
                bis: "b81d356",
            },
            {
                id: "WI-0144",
                name: "Production-Zug",
                satz: "Auf der Stage holt ein Knopf den Stand von Production.",
                unredigiert: false,
                marken: ["migration"],
                anzahl: 4,
                bis: "25bc739",
            },
        ],
    },
    sperre: null,
    laeuft: null,
    frueher: [
        {
            ops: "OPS-000142",
            release: "878c244",
            at: ago(32 * 60 * MINUTE),
            wer: "Rondrikan",
            art: "rollback",
            themen: 0,
        },
        {
            ops: "OPS-000138",
            release: "e2f28dd",
            at: ago(36 * 60 * MINUTE),
            wer: "Rondrikan",
            art: "release",
            themen: 9,
        },
    ],
};

const RUECKWEG = {
    am: ago(32 * 60 * MINUTE),
    von: "e2f28dd",
    auf: "878c244",
    durch: "Rondrikan",
    vorgang: "OPS-000142",
} as const;

const mitRueckweg: FreigabeSicht = {
    ...FREIGABE,
    datei: { ...FREIGABE.datei!, letzterRueckweg: RUECKWEG },
};

test("Abnahmeblatt: Production-Zug und Rückweg (WI-0144)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Buffer> = {};

    // (a) Die Stage in Ruhe: EINE Zeile, (b) die Rückfrage mit ihrem ganzen Satz.
    {
        const { page, close } = await abgleiche(browser, baseURL, { colorScheme: "light" });
        shots["a"] = await page.screenshot();
        await page.getByTestId("abgleich-production-knopf").click();
        await page.waitForTimeout(400);
        shots["b"] = await page.getByTestId("abgleiche").screenshot();
        await close();
    }

    // (c) Die Lagen der Zeile, echte Größe, nur die Liste.
    const lagen: [string, AdminAbgleiche, string[]?][] = [
        [
            "c-wartet",
            stage({
                zeilen: [
                    zeile("production", {
                        ausfuehrung: "korridor",
                        kreis: "voll",
                        letzter: lauf({ finishedAt: ago(3 * 60 * MINUTE), befunde: null, satz: null }),
                        laufend: {
                            jobId: "7e570000-0000-4000-8000-0000000000e1",
                            state: "QUEUED",
                            queuedAt: ago(MINUTE),
                            startedAt: null,
                            phase: null,
                            progress: null,
                            waitReason: "waits_pickup",
                            ausgeloest: { art: "person", name: "Rondrikan" },
                        },
                    }),
                ],
            }),
        ],
        [
            "c-laeuft",
            stage({
                zeilen: [
                    zeile("production", {
                        ausfuehrung: "korridor",
                        kreis: "voll",
                        letzter: lauf({ finishedAt: ago(3 * 60 * MINUTE), befunde: null, satz: null }),
                        laufend: {
                            jobId: "7e570000-0000-4000-8000-0000000000e2",
                            state: "RUNNING",
                            queuedAt: ago(7 * MINUTE),
                            startedAt: ago(6 * MINUTE),
                            phase: "einspielen",
                            progress: 0.5,
                            waitReason: null,
                            ausgeloest: { art: "person", name: "Rondrikan" },
                        },
                    }),
                ],
            }),
        ],
        [
            "c-abgebrochen",
            stage({
                zeilen: [
                    zeile("production", {
                        ausfuehrung: "korridor",
                        kreis: "leer",
                        letzter: lauf({
                            state: "CANCELLED",
                            finishedAt: ago(14 * MINUTE),
                            luecken: null,
                            befunde: null,
                            satz: null,
                            fehler:
                                "Gerade läuft ein Zug oder eine Auslieferung auf der Stage. " +
                                "Bitte in ein paar Minuten noch einmal drücken.",
                        }),
                    }),
                ],
            }),
        ],
        [
            "c-gescheitert",
            stage({
                zeilen: [
                    zeile("production", {
                        ausfuehrung: "korridor",
                        kreis: "leer",
                        letzter: lauf({
                            state: "FAILED",
                            finishedAt: ago(52 * MINUTE),
                            luecken: null,
                            befunde: null,
                            satz: null,
                            fehler:
                                "Production-Zug nicht gelungen (pg_restore: Tafel place fehlt). Production ist " +
                                "unberührt; die Stage-Daten von vorher liegen als Sicherung bereit.",
                        }),
                    }),
                ],
            }),
        ],
        ["c-ohne-recht", stage(), BETREIBER],
    ];
    for (const [key, stand, capabilities] of lagen) {
        const { page, close } = await abgleiche(browser, baseURL, { colorScheme: "light" }, stand, capabilities);
        shots[key] = await page.locator(LISTE).screenshot();
        await close();
    }

    // (d) Der Knopf in doppelter Dichte: Ruhe, Zeigen, Fokus (Guide §30.5); gesperrt steht in (c).
    {
        const { page, close } = await abgleiche(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        const knopf = page.getByTestId("abgleich-production-knopf");
        const bild = async (): Promise<Buffer> => {
            const box = await knopf.boundingBox();
            if (box === null) throw new Error("Knopf nicht sichtbar");
            return page.screenshot({
                clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 },
            });
        };
        shots["d-ruhe"] = await bild();
        await knopf.hover();
        await page.waitForTimeout(300);
        shots["d-zeigen"] = await bild();
        await page.mouse.move(0, 0);
        await knopf.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page.waitForTimeout(300);
        shots["d-fokus"] = await bild();
        await close();
    }

    // (e) 🔴 Production daneben: unverändert. Die Zeile des Production-Zugs steht dort NICHT.
    {
        const { page, close } = await abgleiche(browser, baseURL, { colorScheme: "light" }, production());
        shots["e"] = await page.locator(LISTE).screenshot();
        await close();
    }

    // (f) Der Reiter „Production“ mit dem Rückweg, (g) ohne ihn, (h) die Nahaufnahme des Blocks.
    {
        const { page, close } = await reiter(browser, baseURL, mitRueckweg);
        shots["f"] = await page.locator(FENSTER).screenshot();
        await close();
    }
    {
        const { page, close } = await reiter(browser, baseURL, FREIGABE);
        shots["g"] = await page.locator(FENSTER).screenshot();
        await close();
    }
    {
        const { page, close } = await reiter(browser, baseURL, mitRueckweg, { deviceScaleFactor: 2 });
        shots["h"] = await page.getByTestId("production-rueckweg").screenshot();
        await close();
    }

    // (i) Dunkel, (j) Telefon.
    {
        const { page, close } = await reiter(browser, baseURL, mitRueckweg, { colorScheme: "dark" });
        shots["i"] = await page.locator(FENSTER).screenshot();
        await close();
    }
    {
        const { page, close } = await abgleiche(browser, baseURL, { ...devices["Pixel 7"], colorScheme: "light" });
        shots["j-zeile"] = await page.screenshot();
        await close();
    }
    {
        const { page, close } = await reiter(browser, baseURL, mitRueckweg, {
            ...devices["Pixel 7"],
            colorScheme: "light",
        });
        shots["j-reiter"] = await page.locator(FENSTER).screenshot();
        await close();
    }

    const colour = CANON.colour;
    const img = (key: string, width?: number): string =>
        `<img src="${png(shots[key] as Buffer)}" alt=""${width === undefined ? "" : ` style="width:${String(width)}px"`}>`;
    const fig = (key: string, text: string, width?: number): string => `<div><p>${text}</p>${img(key, width)}</div>`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1280px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 30px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 18px 24px; align-items: flex-start; }
.row > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; max-width: 600px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Production-Zug auf der Stage, und der Rückweg sichtbar (WI-0144)</h1>
<p class="lead">Betreiber 2026-10-14: „ich will auf der stage den button "Production-Zug holen" … unter "Abgleiche" darf auf der Stage nur "Production-Zug" stehen
… ich muss auf der stage im reiter "Production" sehen, dass ein Feature-Release zurückgefahren wurde … Und in Production lassen wir das mal so wie jetzt.“
· Stage-Sitzung, „Rondrikan“ als Betreiber, Stände aus dem Nachbau (gegen den Vertrag gebaut), Karte aus dem lokalen Stapel.</p>

<h2>(a) Die Stage, hell, echte Größe <span>· unter „Abgleiche“ steht genau EINE Zeile, und ihr Knopf heißt „⇄ Production-Zug holen“</span></h2>
${img("a")}

<h2>(b) Ein Druck auf den Knopf <span>· die Rückfrage an der Stelle; sie sagt, dass auch die Testwelt-Änderungen weg sind</span></h2>
${img("b")}

<h2>(c) Die Lagen der Zeile, echte Größe</h2>
<div class="row">
${fig("c-wartet", "Gedrückt: der Auftrag wartet auf Claudios Abholer („wartet auf Abholung“)")}
${fig("c-laeuft", "Claudio spielt ein (Schritt „einspielen“, 50 %)")}
${fig("c-abgebrochen", "Zurückgewiesen, weil gerade ein anderer Zug läuft — Claudios Satz steht in der Zeile")}
${fig("c-gescheitert", "Gescheitert: Production ist unberührt, die Stage-Daten von vorher liegen als Sicherung bereit")}
${fig("c-ohne-recht", "Ein Betreiber ohne das neue Recht: sieht die Zeile, der Knopf steht gesperrt mit Satz")}
</div>

<h2>(d) Der Knopf, doppelte Dichte <span>· Guide §30.5: Ruhe, Zeigen, Fokus über die Tastatur</span></h2>
<div class="row">
${fig("d-ruhe", "Ruhe")}
${fig("d-zeigen", "Zeigen")}
${fig("d-fokus", "Fokus")}
</div>

<h2>(e) 🔴 Production daneben, unverändert <span>· derselbe Eintrag in Production: Legacy-Zug je Kategorie wie heute</span></h2>
<div class="row">
${fig("e", "Die Zeile „Production-Zug“ steht hier NICHT — und dafür musste in Production kein Umgebungswert geändert werden. Eine Quelle, die der Wert nicht nennt, ist verborgen.")}
</div>

<h2>(f) Der Reiter „Production“ auf der Stage, mit Rückweg <span>· echte Größe</span></h2>
${img("f")}

<h2>(g) Derselbe Reiter ohne Rückweg <span>· so sieht er aus, solange nichts zurückgefahren wurde; eine ältere Statusdatei ohne das Feld ebenso</span></h2>
${img("g")}

<h2>(h) Der Rückweg in Nahaufnahme <span>· doppelte Dichte</span></h2>
${img("h", 760)}

<h2>(i) Dunkel</h2>
${img("i", 960)}

<h2>(j) Telefon <span>· Pixel 7 (412 × 915): die Zeile und der Reiter</span></h2>
<div class="row">${fig("j-zeile", "Die Zeile; der Knopf rutscht unter sie und nimmt die ganze Breite", 412)}${fig("j-reiter", "Der Reiter mit dem Rückweg", 412)}</div>

<p class="note"><b>Worauf zu achten ist:</b> Die Stage zeigt nur Production, weil ein einziger Umgebungswert das sagt (<code>ABGLEICHE=production:korridor</code>);
die Legacy- und Medienzeilen sind dort verborgen, nicht gesperrt. Production bleibt unberührt, ohne Änderung an seinem Wert (e).
Der Knopf startet nie sofort, er fragt an der Stelle, und er verlangt den Passkey unmittelbar davor — der Zug ersetzt Kartendaten,
Kacheln und Medien der ganzen Umgebung. Der Rückweg-Block (f, h) steht im Warnton über der Themenliste, auf die sein Satz verweist;
dass die Themen wieder dastehen, rechnet Claudios Werkzeug gegen den dann laufenden Production-Commit.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__production-zug.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__production-zug.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
