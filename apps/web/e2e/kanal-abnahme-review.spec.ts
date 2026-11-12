import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { kanalServer, kanalVorgaenge, stubKanal } from "./kanal-stub.ts";
import { sicherungServer, sicherungStand } from "./sicherung-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Betreiber-Kanal, gebaut“ (WI-0124, KANAL-0001 K3 bis K5). Anders als die Mockup-Blätter 1 und 2 zeigt es die GEBAUTE
 * Oberfläche: die echte Systemsteuerung auf der echten Karte, der Kanal aus dem Nachbau `kanal-stub.ts` (erfundene Vorgänge), Sitzung aus
 * `verwaltung-stub.ts` (Stage, „Rondrikan“ als Betreiber).
 *
 * 💣 Dieser Lauf prüft NICHTS; die Zusicherungen stehen in `kanal.spec.ts` und `kanal.touch.spec.ts`.
 *
 *   npm run review:kanal-abnahme
 *
 * Ablage: `review/wi-0124-mockup/blatt-3.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0124-mockup");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };
const BETREIBER = [
    ...ADMIN_CAPABILITIES,
    "manage_system_settings",
    "use_operator_channel",
    "run_backup",
    "request_restore",
];
const FENSTER = '[data-testid="systemsteuerung-fenster"]';
const FOTO = fileURLToPath(new URL("./fixtures/kanal-foto-gps.jpg", import.meta.url));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

test.use({ actionTimeout: 30_000 });

/** Die Vorgänge des Nachbaus, dazu für den Rest OPS-000098 sein Fix-Bericht aus zwei Runden. */
function vorgaenge() {
    const alle = kanalVorgaenge();
    const rest = alle.find((v) => v.ops === "OPS-000098")!;
    Object.assign(rest, {
        runde: 2,
        prioritaet: "hoch",
        alleNachweise: [
            {
                runde: 2,
                station: "fix_committed",
                commit: "b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621",
                release: null,
                notiz: null,
                von: { art: "claudia" },
                at: ago(94 * DAY),
            },
            {
                runde: 2,
                station: "auf_stage",
                commit: null,
                release: "20260710T093012Z-b7e2d41",
                notiz: null,
                von: { art: "claudio" },
                at: ago(93 * DAY),
            },
            {
                runde: 2,
                station: "claudia_nachgeprueft",
                commit: null,
                release: null,
                notiz: null,
                von: { art: "claudia" },
                at: ago(93 * DAY),
            },
            {
                runde: 2,
                station: "betreiber_abnahme",
                commit: null,
                release: null,
                notiz: null,
                von: null,
                at: ago(92 * DAY),
            },
        ],
        aenderungen: [
            {
                id: 12,
                runde: 1,
                agent: "claudio",
                klasse: "A",
                art: "code",
                was: "Infopanel: technische Namen wie „See-321“ werden nicht mehr als Titel gezeigt",
                dateien: ["apps/web/src/info-panel/titel.ts"],
                commit: "4fc6962e1b0d7a3c5f8e9d2b4a6c8e0f1a3b5c7d",
                release: "20260702T081500Z-4fc6962",
                tests: "Unit 3, Browser 1",
                ruecknahme: "Revert 4fc6962",
                at: ago(99 * DAY),
                nachpruefung: "nachbessern",
                nachgeprueftAt: ago(98 * DAY),
                nachpruefungNotiz: "Prüfung gehört ins geteilte Paket",
                beobachtungen: [
                    {
                        ergebnis: "fallback",
                        text: "42 Platzhalter griffen weiter auf den Kartennamen zurück",
                        at: ago(98 * DAY),
                    },
                ],
            },
            {
                id: 19,
                runde: 2,
                agent: "claudia",
                klasse: "B",
                art: "code",
                was: "Platzhalterregel im geteilten Paket, Paritätsfall See-321 ergänzt",
                dateien: ["packages/shared/src/x.ts"],
                commit: "b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621",
                release: "20260710T093012Z-b7e2d41",
                tests: "Unit 5, Parität 1, Browser 1",
                ruecknahme: "Revert b7e2d41",
                at: ago(94 * DAY),
                nachpruefung: "ok",
                nachgeprueftAt: ago(93 * DAY),
                nachpruefungNotiz: null,
                beobachtungen: [{ ergebnis: "unauffaellig", text: null, at: ago(93 * DAY) }],
            },
        ],
    });
    return alle;
}

interface Bild {
    buf: Buffer;
    dichte: number;
}
const shots: Record<string, Bild> = {};
const merke = (key: string, buf: Buffer, dichte: number): void => {
    shots[key] = { buf, dichte };
};

async function oeffne(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.3.${String(20 + Math.floor(Math.random() * 200))}` },
    });
    const page = await context.newPage();
    await stubAdmin(page, { capabilities: BETREIBER, role: "operator", sicherung: sicherungServer(sicherungStand()) });
    await stubKanal(page, kanalServer(vorgaenge()));
    await page.goto("/edit");
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await page.locator(FENSTER).waitFor();
    return { page, close: () => context.close() };
}

async function ruhe(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
}

async function rahmen(page: Page, selektor: string, rand = 10) {
    return page.evaluate(
        ({ s, r }) => {
            const e = document.querySelector(s);
            if (e === null) throw new Error(`nichts zu sehen: ${s}`);
            const b = e.getBoundingClientRect();
            const x = Math.max(0, Math.floor(b.left - r));
            const y = Math.max(0, Math.floor(b.top - r));
            return {
                x,
                y,
                width: Math.ceil(Math.min(innerWidth, b.right + r) - x),
                height: Math.ceil(Math.min(innerHeight, b.bottom + r) - y),
            };
        },
        { s: selektor, r: rand },
    );
}

test("Abnahmeblatt: Betreiber-Kanal, gebaut (WI-0124, KANAL-0001 K3)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);

    // Rechner hell, echte Größe.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        await page.getByTestId("verwaltung-eintrag-claudio").click();
        await page.getByTestId("kanal-zeile-OPS-000134").waitFor();
        await ruhe(page);
        merke("a1", await page.screenshot(), 1);
        await page.getByTestId("kanal-reiter-abnahme").click();
        await page.getByTestId("kanal-zeile-OPS-000127").click();
        await page.getByTestId("kanal-vorgang-OPS-000127").waitFor();
        await ruhe(page);
        merke("b1", await page.screenshot(), 1);
        await page.getByTestId("kanal-wieder").click();
        await page.getByTestId("kanal-kommentar").fill("Am Telefon steht der Name noch.");
        await page.getByTestId("kanal-wieder-frage").scrollIntoViewIfNeeded();
        await ruhe(page);
        merke("b2", await page.screenshot({ clip: await rahmen(page, '[data-testid="kanal-wieder-frage"]') }), 1);
        await page.getByTestId("kanal-wieder-frage").getByRole("button", { name: "Abbrechen" }).click();
        await page.getByTestId("kanal-abnehmen").click();
        await page.getByTestId("kanal-ende").waitFor();
        await page.getByTestId("kanal-loeschen").click();
        await page.getByTestId("kanal-loeschen-frage").scrollIntoViewIfNeeded();
        await ruhe(page);
        merke("c1", await page.screenshot(), 1);
        await page.getByTestId("kanal-zurueck").click();
        await page.getByTestId("kanal-reiter-archiv").click();
        await page.getByTestId("kanal-zeile-OPS-000098").waitFor();
        await ruhe(page);
        merke("d1", await page.screenshot(), 1);
        await page.getByTestId("kanal-zeile-OPS-000098").click();
        await page.getByTestId("kanal-vorgang-OPS-000098").waitFor();
        await ruhe(page);
        merke("d2", await page.screenshot(), 1);
        await page.getByTestId("kanal-zurueck").click();
        await page.getByTestId("kanal-melden").click();
        await page.getByTestId("kanal-melden-formular").waitFor();
        await page.getByTestId("kanal-kategorie-stoerung").click();
        await page.getByTestId("kanal-titel").fill("Stage lädt keine Kacheln");
        await page
            .getByTestId("kanal-nachricht")
            .fill("Seit dem Neuladen bleibt die Karte bei Gareth grau, nur die Beschriftungen kommen.");
        await ruhe(page);
        merke("e1", await page.screenshot(), 1);
        await page.getByTestId("verwaltung-eintrag-protokoll-system").click();
        await page.getByTestId("protokoll-filter").click();
        await page.getByTestId("protokoll-filter-art-aenderungen").check();
        await page.keyboard.press("Escape");
        await page.getByTestId("berichte-tafel").waitFor();
        await ruhe(page);
        merke("f1", await page.screenshot(), 1);
        await close();
    }

    // Nahaufnahmen hell, doppelte Dichte: Nachweis-Leiste und Fix-Bericht.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light", deviceScaleFactor: 2 });
        await page.getByTestId("verwaltung-eintrag-claudio").click();
        await page.getByTestId("kanal-reiter-abnahme").click();
        await page.getByTestId("kanal-zeile-OPS-000127").click();
        await page.getByTestId("kanal-nachweise").waitFor();
        await ruhe(page);
        merke("b3", await page.screenshot({ clip: await rahmen(page, '[data-testid="kanal-nachweise"]', 8) }), 2);
        merke("b4", await page.screenshot({ clip: await rahmen(page, '[data-testid="kanal-fixbericht"]', 8) }), 2);
        await close();
    }

    // Bilder (K4): ein Telefonfoto anhängen (der Browser verkleinert), die Vorschau zeigt ein Bild der Karte, entfernen fragt.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        const karte = await page.screenshot({ clip: { x: 300, y: 160, width: 600, height: 800 } });
        await page.route("**/api/kanal/bilder/*", (route) =>
            route.request().method() === "GET"
                ? route.fulfill({ status: 200, contentType: "image/png", body: karte })
                : route.fallback(),
        );
        await page.getByTestId("verwaltung-eintrag-claudio").click();
        await page.getByTestId("kanal-zeile-OPS-000134").click();
        await page.getByTestId("kanal-bild-datei").setInputFiles(FOTO);
        await page.locator("[data-testid^='kanal-bild-entfernen-']").waitFor();
        await page.locator(".verlauf__eintrag").last().scrollIntoViewIfNeeded();
        await ruhe(page);
        merke("j1", await page.screenshot(), 1);
        await page.locator("[data-testid^='kanal-bild-entfernen-']").click();
        await page.locator("[data-testid^='kanal-bild-frage-']").scrollIntoViewIfNeeded();
        await ruhe(page);
        merke("j2", await page.screenshot({ clip: await rahmen(page, ".verlauf__eintrag:last-child", 8) }), 1);
        await page.getByTestId("kanal-zurueck").click();
        await page.getByTestId("kanal-melden").click();
        await page.getByTestId("kanal-bild-anhaengen-datei").setInputFiles(FOTO);
        await page.getByTestId("kanal-bilder-gewaehlt").waitFor();
        await ruhe(page);
        merke("j3", await page.screenshot({ clip: await rahmen(page, ".kasten--gestrichelt", 8) }), 1);
        await close();
    }

    // Backups: Wiederherstellung beantragen (K5), echte Größe.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "light" });
        await page.getByTestId("verwaltung-eintrag-backup").click();
        await page.getByTestId("wiederherstellung-beantragen").click();
        await page
            .getByTestId("wiederherstellung-grund")
            .fill("Nach dem Import fehlen 200 Orte im Süden; Stand von heute Nacht zurück.");
        await ruhe(page);
        merke("i1", await page.screenshot(), 1);
        await page
            .getByTestId("wiederherstellung-frage")
            .getByRole("button", { name: "Mit Passkey beantragen" })
            .click();
        await page.getByTestId("wiederherstellung-stand").waitFor();
        await ruhe(page);
        merke("i2", await page.screenshot({ clip: await rahmen(page, '[data-testid="sicherung"] .fenster-karte') }), 1);
        await close();
    }

    // Rechner dunkel.
    {
        const { page, close } = await oeffne(browser, baseURL, { colorScheme: "dark" });
        await page.getByTestId("verwaltung-eintrag-claudio").click();
        await page.getByTestId("kanal-zeile-OPS-000134").click();
        await page.getByTestId("kanal-vorgang-OPS-000134").waitFor();
        await ruhe(page);
        merke("g1", await page.screenshot({ clip: await rahmen(page, FENSTER, 0) }), 1);
        await close();
    }

    // Telefon (Pixel 7), hell und dunkel: Liste als Karten und ein Vorgang.
    for (const thema of ["hell", "dunkel"] as const) {
        const { page, close } = await oeffne(browser, baseURL, {
            ...devices["Pixel 7"],
            colorScheme: thema === "hell" ? "light" : "dark",
        });
        await page
            .getByTestId("verwaltung-auswahl")
            .getByRole("combobox", { name: "Bereiche der Verwaltung" })
            .selectOption("claudio");
        await page.getByTestId("kanal-zeile-OPS-000134").waitFor();
        await ruhe(page);
        merke(`h1-${thema}`, await page.screenshot({ scale: "css" }), 1);
        await page.getByTestId("kanal-zeile-OPS-000134").tap();
        await page.getByTestId("kanal-vorgang-OPS-000134").waitFor();
        await ruhe(page);
        merke(`h2-${thema}`, await page.screenshot({ scale: "css" }), 1);
        await close();
    }

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1484, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__kanal-abnahme.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: blatt(baseURL) }),
    );
    await sheet.goto("/__kanal-abnahme.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt-3.png"), fullPage: true });
    await sheetContext.close();
});

function img(key: string, faktor = 1): string {
    const bild = shots[key];
    if (bild === undefined) throw new Error(`Bild fehlt: ${key}`);
    const breite = Math.round((bild.buf.readUInt32BE(16) / bild.dichte) * faktor);
    return `<img src="data:image/png;base64,${bild.buf.toString("base64")}" alt="" style="width:${String(breite)}px">`;
}
const fig = (key: string, text: string, faktor = 1): string =>
    `<figure>${img(key, faktor)}<figcaption>${text}</figcaption></figure>`;

function blatt(baseURL: string): string {
    const colour = CANON.colour;
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1420px; }
h1 { margin: 0 0 4px; font-size: 24px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 14px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1240px; }
h2 { margin: 34px 0 6px; padding-top: 18px; border-top: 1px solid ${colour["border"]}; font-size: 19px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 16px 24px; align-items: flex-start; margin-bottom: 14px; }
figure { display: table; margin: 0; }
figcaption { display: table-caption; caption-side: bottom; margin: 5px 0 0; font-size: 12px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 6px; }
.box { padding: 10px 16px; border: 1px solid ${colour["successSoftBorder"]}; border-radius: 8px; background: ${colour["successSoft"]}; font-size: 13px; }
.box ul { margin: 4px 0 0; padding-left: 18px; }
.note { margin: 10px 0 0; padding: 8px 14px; border-left: 3px solid ${colour["accent"]}; border-radius: 4px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1240px; }
.quellen { margin-top: 26px; font-size: 11px; color: ${colour["textMuted"]}; max-width: 1340px; }
</style></head><body>

<h1>Betreiber-Kanal · gebaut (WI-0124, KANAL-0001 K3)</h1>
<p class="lead">Die gebaute Oberfläche, nicht mehr das Mockup: echte Systemsteuerung auf der echten Karte, Stage, angemeldet „Rondrikan“ als Betreiber. Die Vorgänge kommen aus einem Nachbau des
Servers und sind erfunden. Rechner 1280 × 900 in echter Größe, Nahaufnahmen doppelt, Telefon Pixel 7, hell und dunkel.</p>
<div class="box"><b>Kurz gesagt</b><ul>
<li>„Claudia &amp; Claudio“ steht in der Systemsteuerung vor dem Protokoll, <b>nur für Betreiber</b>, mit der Zahl „zur Abnahme“ in der Schiene.</li>
<li>Drei Reiter: Offen, Zur Abnahme, Archiv. Melden mit Kategorie, Priorität, Titel und Nachricht; Abnehmen, Wieder öffnen mit Kommentar, „Meldung jetzt löschen“ nach der Abnahme.</li>
<li>Im Protokoll die Gruppe <b>„Fix-Berichte“</b>: jede Änderung von Claudia und Claudio, dauerhaft; die OPS-Nummer öffnet den Vorgang.</li>
<li><b>„Wiederherstellung beantragen“</b> unter „Backups“ (K5): mit Passkey, wird ein dringender Vorgang für Claudio; aus der App wird nie zurückgespielt.</li>
<li><b>Bilder</b> (K4) beim Melden und bei jeder Antwort: Der Browser verkleinert auf 2560 px und schickt das Bild ohne Ortsangabe; „Bild entfernen“ geht jederzeit.</li>
</ul></div>

<h2>(a) Liste „Offen“ <span>· echte Größe</span></h2>
<div class="row">${fig("a1", "Oben, wann Claudio zuletzt abgeholt hat; darunter Reiter, Filter und die Vorgänge mit Priorität, Status und Zuständigem.")}</div>

<h2>(b) Ein Vorgang zur Abnahme <span>· echte Größe und Nahaufnahmen</span></h2>
<div class="row">${fig("b1", "Kopf mit OPS-Nummer und Status, die Nachweis-Leiste der laufenden Runde, Verlauf, rechts Kontext und Fix-Bericht; unten Abnehmen und Wieder öffnen.")}</div>
<div class="row">
${fig("b3", "Nachweis-Leiste: drei von vier Stationen (Nahaufnahme).", 0.9)}
${fig("b4", "Fix-Bericht mit Beobachtung und Nachprüfung (Nahaufnahme).", 0.9)}
</div>
<div class="row">${fig("b2", "Wieder öffnen fragt an der Stelle; ohne Kommentar bleibt der Knopf gesperrt.")}</div>

<h2>(c) Abgenommen, „Meldung jetzt löschen“ <span>· echte Größe</span></h2>
<div class="row">${fig("c1", "Nach dem Abnehmen: bis wann Meldung und Bilder bleiben, der Knopf für früher und seine Frage mit dem, was bleibt.")}</div>

<h2>(d) Archiv und Rest <span>· echte Größe</span></h2>
<div class="row">
${fig("d1", "Das Archiv: rechts die Aufbewahrung; ein gelöschter Vorgang steht leiser mit dem Kurztitel da.")}
</div>
<div class="row">${fig("d2", "Der Rest: keine Person, kein Text der Meldung; die Nachweise und der Fix-Bericht beider Runden bleiben.")}</div>

<h2>(e) Vorgang melden <span>· echte Größe</span></h2>
<div class="row">${fig("e1", "Kategorie als Karten mit „zuerst sieht …“, Priorität, Titel und Nachricht; rechts freiwillige Angaben und was ohnehin mitgeht.")}</div>

<h2>(f) Protokoll › Fix-Berichte <span>· echte Größe</span></h2>
<div class="row">${fig("f1", "Neueste oben; Handgriffe ohne Vorgang nennen ihren Grund. Wer und Zeitraum fallen hier weg, die Einträge laufen nie ab.")}</div>

<h2>(g) Dunkel <span>· echte Größe</span></h2>
<div class="row">${fig("g1", "Ein Vorgang in Arbeit mit Claudios Rückfrage.")}</div>

<h2>(j) Bilder <span>· echte Größe</span></h2>
<div class="row">${fig("j1", "Ein Telefonfoto (4032 × 3024, hochkant gehalten, mit Ortsangabe) angehängt: Der Browser hat es aufrecht auf 1920 × 2560 verkleinert und ohne Metadaten geschickt. Die Vorschau öffnet die Ansicht in voller Größe; hier zeigt sie ein Bildschirmfoto der Oberfläche.")}</div>
<div class="row">
${fig("j2", "„Bild entfernen“ fragt an der Stelle.")}
${fig("j3", "Beim Melden: die gewählten Bilder, hochgeladen erst mit dem Vorgang.")}
</div>

<h2>(i) Backups › Wiederherstellung beantragen <span>· echte Größe</span></h2>
<div class="row">${fig("i1", "Neben „Sicherung jetzt“: welche Sicherung, welcher Umfang, Grund (Pflicht); beantragt wird mit Passkey. Nur mit dem Recht „Wiederherstellung anstoßen“.")}</div>
<div class="row">${fig("i2", "Danach steht der Antrag mit seiner OPS-Nummer in der Karte, bis Claudio ihn bearbeitet; für Betreiber öffnet die Nummer den Vorgang im Kanal.")}</div>

<h2>(h) Telefon <span>· Pixel 7</span></h2>
<div class="row">
${fig("h1-hell", "Liste als Karten, hell")}
${fig("h2-hell", "Vorgang, hell")}
${fig("h1-dunkel", "Liste als Karten, dunkel")}
${fig("h2-dunkel", "Vorgang, dunkel")}
</div>
<p class="note">Abweichungen vom abgenommenen Mockup: keine.</p>

<p class="quellen">Quellen: project-control/planning/KANAL-0001-betreiber-kanal-bauplan.md §3.1, §8, K3 · Blätter review/wi-0124-mockup/blatt-teil-1..3.png und blatt-2*.png ·
Bauteile apps/web/src/auth/kanal-*.vue, verwaltung-kanal.vue, Route GET /api/kanal/aenderungen. Erzeugt mit npm run review:kanal-abnahme (apps/web/e2e/kanal-abnahme-review.spec.ts).</p>
</body></html>`;
}
