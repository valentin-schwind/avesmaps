import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import {
    bedieneMedienrouten,
    GARETH,
    MIT_MEDIEN,
    medienQuelle,
    schliesseMedienQuelle,
    stubSitzung,
    type MedienQuelle,
} from "./medien-quelle.ts";

/**
 * Abnahmeblatt „Medienverwaltung, die 3-Spalten-Hülle“ (WI-0068 P3; Vorbild: Mockup `review/wi-0068-mockup/blatt.png` vom 2026-10-09).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/medien-zustand.test.ts`, `test/medien-modell.test.ts`, `test/fenster-huelle.test.ts`, `e2e/medien.spec.ts` und
 * `e2e/medien.touch.spec.ts`.
 *
 * Gezeigt wird das Fenster auf der ECHTEN Karte mit den ECHTEN Medien aus `avesmaps3d_dev` (`medien-quelle.ts`: die Sitzung ist ein
 * Stub, die Antworten rechnen die Abfragen des Servers): am Rechner in echter Größe (1440 × 900) über den Kontext-Einstieg am Wappen
 * von Gareth, der Einstieg im Infopanel doppelt, die Rechte und die Provenienz doppelt und einfach, die Liste dunkel und das Telefon
 * in drei Ebenen.
 *
 *   npm run review:medien
 *
 * Ablage: `review/wi-0068/p3-blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner, etwa den des
 * Hauptcheckouts aus einem Worktree heraus. Braucht `DATABASE_URL` (Umgebung oder `.env`).
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0068");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

interface Geoeffnet {
    page: Page;
    close: () => Promise<void>;
}

async function oeffne(
    browser: Browser,
    baseURL: string,
    quelle: MedienQuelle,
    pfad: string,
    options: BrowserContextOptions,
): Promise<Geoeffnet> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 900 },
        ...options,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(120 + Math.floor(Math.random() * 100))}` },
    });
    const page = await context.newPage();
    await stubSitzung(page, MIT_MEDIEN);
    await bedieneMedienrouten(page, quelle);
    await page.goto(pfad);
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, close: () => context.close() };
}

/** Wartet, bis der Inspector sein Asset zeigt und alle Bilder geladen sind. */
async function ruhig(page: Page): Promise<void> {
    await page
        .getByTestId("medien-pillen")
        .waitFor({ timeout: 20_000 })
        .catch(() => undefined);
    // Die Bilder im sichtbaren Teil sind da (die Kacheln laden faul: was außer Sicht ist, lädt erst beim Rollen).
    await page.waitForFunction(
        () =>
            [...document.querySelectorAll<HTMLImageElement>("[data-testid='medien-fenster'] img")]
                .filter((img) => {
                    const box = img.getBoundingClientRect();
                    return box.bottom > 0 && box.top < innerHeight && box.width > 0;
                })
                .every((img) => img.complete && img.naturalWidth > 0),
        undefined,
        { timeout: 20_000 },
    );
    // `decoding="async"`: geladen ist noch nicht gezeichnet - erst dekodieren, dann ein Bild abwarten.
    await page.evaluate(() =>
        Promise.all(
            [...document.querySelectorAll<HTMLImageElement>("[data-testid='medien-fenster'] img")].map((img) =>
                img.decode().catch(() => undefined),
            ),
        ),
    );
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
}

const png = (shot: Buffer): string => `data:image/png;base64,${shot.toString("base64")}`;

test("Abnahmeblatt: Medienverwaltung, die 3-Spalten-Hülle (WI-0068 P3)", async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const quelle = await medienQuelle();
    test.skip(quelle === undefined, "ohne DATABASE_URL keine echten Medien");
    const q = quelle!;
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Buffer> = {};

    const nav = await q.mediaNavigation(q.db);
    const garethAlle = await q.searchMedia(q.db, { subject: `place:${GARETH}`, sort: "name", limit: 200, offset: 0 });
    const garethWappen = await q.searchMedia(q.db, {
        subject: `place:${GARETH}`,
        role: "coat",
        sort: "name",
        limit: 5,
        offset: 0,
    });
    // Kartenvorschauen hängen an der Karte der Kartensammlung, nicht am Ort: gesucht über den Namen.
    const vorschauen = await q.searchMedia(q.db, {
        q: "Gareth",
        role: "map_preview",
        sort: "name",
        limit: 50,
        offset: 0,
    });
    const wappen = garethWappen.items[0];
    const vorschau = vorschauen.items.find((item) => item.sharedFileCount > 0) ?? vorschauen.items[0];
    if (wappen === undefined || vorschau === undefined) throw new Error("Gareth ohne Wappen oder Kartenvorschau");

    // (a) Rechner, echte Größe: der Kontext-Einstieg - Gareth im Infopanel, Klick auf ⚙ am Wappen.
    {
        const { page, close } = await oeffne(browser, baseURL, q, "/edit", { colorScheme: "light" });
        await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "place", id }), GARETH);
        await page.getByTestId("info-medien-wappen").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(800);
        // (b) Der Einstieg im Infopanel, doppelt: der Knopf am Wappen unter dem Zeiger, der am Kopfbild in Ruhe.
        shots["b-panel"] = await page.getByTestId("info-header").screenshot();
        await page.getByTestId("info-medien-wappen").click();
        await ruhig(page);
        shots["a"] = await page.screenshot();
        await close();
    }
    {
        const { page, close } = await oeffne(browser, baseURL, q, "/edit", {
            colorScheme: "light",
            deviceScaleFactor: 2,
        });
        await page.evaluate((id) => globalThis.avesmapsOpenSubject?.({ kind: "place", id }), GARETH);
        await page.getByTestId("info-medien-wappen").waitFor({ timeout: 20_000 });
        await page.waitForTimeout(800);
        await page.getByTestId("info-medien-wappen").hover();
        await page.waitForTimeout(300);
        shots["b"] = await page.getByTestId("info-header").screenshot();
        await close();
    }

    // (d) Rechte und Provenienz des Wappens: doppelt und in echter Größe.
    for (const [schluessel, dichte] of [
        ["d2", 2],
        ["d1", 1],
    ] as const) {
        const { page, close } = await oeffne(
            browser,
            baseURL,
            q,
            `/edit?medien=${wappen.id}&medien-von=place:${GARETH}`,
            { colorScheme: "light", deviceScaleFactor: dichte },
        );
        await ruhig(page);
        const karten = page.getByTestId("medien-inspektor").locator(".fenster-karte");
        const rechte = karten.filter({ hasText: /^Rechte/ }).first();
        const provenienz = karten.filter({ hasText: /^Provenienz/ }).first();
        await rechte.scrollIntoViewIfNeeded();
        shots[`${schluessel}-rechte`] = await rechte.screenshot();
        await provenienz.scrollIntoViewIfNeeded();
        shots[`${schluessel}-provenienz`] = await provenienz.screenshot();
        await close();
    }

    // (e) Dunkel: der Korb „Rechte ungeklärt“ als Liste im Legacy-Stil, eine Kartenvorschau mit „gleicher Datei“ im Inspector.
    {
        const { page, close } = await oeffne(
            browser,
            baseURL,
            q,
            `/edit?medien=${vorschau.id}&medien-korb=rights_open&medien-ansicht=liste`,
            { colorScheme: "dark" },
        );
        await ruhig(page);
        shots["e"] = await page.screenshot();
        await close();
    }

    // (c) Telefon: drei Ebenen im selben Fenster.
    const telefon: BrowserContextOptions = { ...devices["Pixel 7"], colorScheme: "light" };
    for (const [schluessel, pfad] of [
        ["c1", "/edit?medien"],
        ["c2", `/edit?medien&medien-von=place:${GARETH}`],
        ["c3", `/edit?medien=${vorschau.id}&medien-q=Gareth&medien-rolle=map_preview`],
    ] as const) {
        const { page, close } = await oeffne(browser, baseURL, q, pfad, telefon);
        await page.getByTestId("medien-fenster").waitFor();
        if (schluessel === "c3") await ruhig(page);
        else await page.waitForTimeout(1500);
        shots[schluessel] = await page.screenshot();
        await close();
    }

    const colour = CANON.colour;
    const img = (key: string, width?: number): string =>
        `<img src="${png(shots[key] as Buffer)}" alt=""${width === undefined ? "" : ` style="width:${String(width)}px"`}>`;
    const zahl = (n: number): string => n.toLocaleString("de-DE");
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1480px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 30px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
.row { display: flex; gap: 24px; align-items: flex-start; }
.row > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
.note ul { margin: 6px 0 0; padding-left: 18px; }
</style></head><body>
<h1>Medienverwaltung (MAM) · die 3-Spalten-Hülle (P3), nur lesend</h1>
<p class="lead">WI-0068 P3 · Vorbild: Mockup vom 09.10.2026 · echte Medien aus avesmaps3d_dev (${zahl(nav.total)} Assets, ${zahl(nav.baskets.rights_open)} mit ungeklärten Rechten), Sitzung als Reviewer (Stub), Karte aus dem lokalen Stapel ·
Werkzeugfenster der Breite „medien“ (1240), modal: die Karte ruht.</p>

<h2>(a) Rechner, hell, echte Größe 1440 × 900 <span>· Kontext-Einstieg: ⚙ am Wappen von Gareth → genau dieses Asset, Treffer „verwendet von Gareth“ (${zahl(garethAlle.total)})</span></h2>
${img("a")}

<h2>(b) Der Einstieg im Infopanel <span>· nur Editor-Modus mit „Medienverwaltung öffnen“ (ab Reviewer): ⚙ am Wappen (unter dem Zeiger) und am Kopfbild</span></h2>
<div class="row">
<div><p>doppelte Dichte</p>${img("b", 800)}</div>
<div><p>echte Größe</p>${img("b-panel", 400)}</div>
</div>

<h2>(c) Telefon <span>· Pixel 7: Drill-down Arten → Treffer → Asset im selben Fenster, „‹“ führt zurück; ein Einstieg mit Asset landet auf Ebene 3</span></h2>
<div class="row">
<div><p>Ebene 1: Arten und Körbe, Suche oben</p>${img("c1", 412)}</div>
<div><p>Ebene 2: Treffer „verwendet von Gareth“</p>${img("c2", 412)}</div>
<div><p>Ebene 3: eine Kartenvorschau, „gleiche Datei“</p>${img("c3", 412)}</div>
</div>

<h2>(d) Rechte und Provenienz des Wappens <span>· Urheber (Rechte) und Hochlader (Provenienz) getrennt; private Felder mit „intern“</span></h2>
<div class="row">
<div><p>doppelte Dichte</p>${img("d2-rechte", 752)}${img("d2-provenienz", 752)}</div>
<div><p>echte Größe</p>${img("d1-rechte", 376)}${img("d1-provenienz", 376)}</div>
</div>

<h2>(e) Dunkel <span>· Korb „Rechte ungeklärt“ als Liste im Legacy-Stil (Kreis, Rolle rechts, Unterzeile warnt), eine Kartenvorschau mit „gleicher Datei“</span></h2>
${img("e", 1200)}

<div class="note"><b>Was gebaut ist und was nicht:</b>
<ul>
<li>Nur lesend. „Datei ersetzen“, „Rechte prüfen“ und „Bild offline nehmen“ stehen gesperrt mit „kommt mit P4“ da, damit die Gestalt stimmt.</li>
<li>Galerien als eigene Liste (P6), Kartensammlung (P7), Eingänge (P8) und „Fehlende Derivate“ (P4) stehen gestrichelt in Spalte 1; eine Galerie zeigt der Inspector ihres Bildes samt Folge und Cover.</li>
<li>Der Kreis ○ ◐ ● überträgt Legacys allgemeine Regel („voll = fertig, halb = da, aber nicht verbunden, leer = nicht auf der Karte“) auf Medien: ○ unbenutzt · ◐ verwendet, nicht öffentlich · ● verwendet und öffentlich. 🚩 Vorschlag, Legacy hat keine Medienliste.</li>
<li>Abweichung vom Mockup: Die Treffer stehen nicht nach Rolle gruppiert, sondern in der gewählten Sortierung (Name, zuletzt geändert, Verwendungen, Rechtestand; der Vertrag aus P2 sortiert nicht nach Rolle) - der Filter „Rolle“ trennt sie.</li>
<li>Abweichung vom Mockup: Ohne veröffentlichte Datei bleibt die Vorschau leer (der geschützte Bildweg für private Originale kommt mit P4).</li>
<li>Abweichung vom Mockup: „verwendet von Gareth“ nennt ${zahl(garethAlle.total)} statt 84 Treffer. Das Mockup zählte die Kartenvorschauen und Umschläge mit, deren Karte oder Werk Gareth nennt; die Reverse Usage aus P2 kennt nur die Verwendungen durch Gareth selbst (Wappen, Kopfbilder). Der Weg über Kartensammlung und Literatur gehört zu P5/P7.</li>
<li>Der Einstieg steht im Hauptmenü unter „Redaktion“ (Auftrag, Mockup B). Der in SYS-0001 §6.1 geplante Bereich „Redaktion &amp; Integrationen“ der Verwaltung bleibt WI-0127 (er braucht eine Eintragsart „öffnet ein Fenster“).</li>
</ul></div>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1544, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__medien-blatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__medien-blatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "p3-blatt.png"), fullPage: true });
    await sheetContext.close();
    await schliesseMedienQuelle();
});
