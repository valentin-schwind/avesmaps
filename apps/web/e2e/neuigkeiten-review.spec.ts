import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { NewsListe, NewsPflege } from "@avesmaps3d/shared";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Neuigkeiten“ (WI-0139; Betreiber 2026-10-13: „es wird auch zeit bei "Production" den "Neuigkeiten-Kanal" fürs frontend
 * freizuschalten“, dazu „erst entwurf, wie empfohlen“ und „benachrichtungen sollen für nutzer nicht verschwinden, wenn sie was gelesen
 * haben, soll es ausgegraut oder in archiv“).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/neuigkeiten.test.ts` und auf dem Server in `test/news.test.ts`.
 *
 * Gezeigt wird das Gebaute auf der ECHTEN Karte: das Fenster, wie ein Besucher es sieht (zwei Einträge seit dem letzten Öffnen neu, die
 * übrigen leiser), die Pflege in der Systemsteuerung mit den drei Zuständen, dunkel und am Telefon.
 *
 *   npm run review:neuigkeiten
 *
 * Ablage: `review/wi-0139/blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/wi-0139");

/**
 * Legacys wirkliche Einträge (die fünf jüngsten aus `config/news/legacy-seed.json`, Claudios Abzug vom 2026-10-13). 🔴 Erfundene
 * Beispiele hätten das Blatt geschönt: Erst an den echten sieht man lange Texte, Zeilenumbrüche und eine URL mitten im Satz.
 */
const EINTRAEGE = [
    {
        id: 112,
        datum: "2026-10-10",
        titel: "Suche nach Art",
        text: "Die Suche findet Orte und Stätten jetzt auch über ihre Art. Wer „Magierakademie“, „Festung“ oder „Tempel“ eintippt, bekommt passende Treffer – und die Trefferzeile sagt dazu, um was für einen Ort es sich handelt.",
        rubrik: "karte",
    },
    {
        id: 111,
        datum: "2026-10-09",
        titel: "Schnee und Eis",
        text: "Neu auf Avesmaps: Die Landschaftsansicht zeigt jetzt Gletscher, Flach- und Steilküsten sowie Schnee- und Eislandschaften. So erkennt ihr auf einen Blick, wo Aventurien vereist ist und wie sich seine Küsten unterscheiden. Schaut vorbei: https://avesmaps.de",
        rubrik: "community",
    },
    {
        id: 110,
        datum: "2026-10-06",
        titel: "Performanceprobleme",
        text: "Avesmaps ruckelt – was ist da los?\nGestern erreichten uns mehrere Anfragen und Beschwerden, dass Avesmaps langsam lädt und die generelle Performance schlecht sei. \nDies hatte zwei Gründe:\n1) Die Neuigkeiten von Avespfade haben viele neue User auf unsere Seite geführt. Gestern haben uns 1400 individuelle IPs (also einzelne Fans) besucht – ein neuer Rekord für uns! Das hat aber auch dazu geführt, dass die Bandbreite unserer Server an ihre Grenzen kam.\n2) Während wir im Hintergrund an der Karte basteln, hat unsere Hardware einiges zu arbeiten. Auch das belastet den Server und braucht Rechenpower.\nGestern kamen diese beiden Gründe – hohes Useraufkommen und eifrige Editoren – zusammen, besonders in den Abendstunden nach Feierabend. Das hat dazu geführt, dass unsere Website in die Knie ging.\nWir arbeiten stets daran, die Performance von Avesmaps zu verbessern. Im Gegensatz zu Avespfade bieten wir mehr und ausgefeiltere Features. Diese brauchen aber auch mehr Leistung hinter den Kulissen. Mit neuen Updates und dem geplanten Relaunch werden sich die Geschwindigkeit und Nutzerfreundlichkeit von Avesmaps verbessern. Dennoch kann es leider immer wieder dazu kommen, dass die Karte hängt und hakelt, besonders wenn daran gearbeitet wird. Wir bitten dies zu entschuldigen. \nAvesmaps ist ein fortlaufendes Projekt, das ständig verbessert und ausgebaut wird. Möchtest du mithelfen, den nächsten Meilenstein zu erreichen? Dann komm auf unseren Discord und melde dich als Editor! Den Link dazu findest du in unserem Profil.",
        rubrik: "community",
    },
    {
        id: 109,
        datum: "2026-10-05",
        titel: "Eine Ära geht zu Ende. Avespfade verabschiedet sich.",
        text: "Heute hat uns die Nachricht erreicht, dass die Betreiber von Avespfade.de beschlossen haben, ihre Website nach göttergefälligen zwölf Jahren in den wohlverdienten Ruhestand zu schicken. Das ganze Team von Avesmaps.de sagt danke für diese Zeit. Avespfade war eine unermessliche Hilfe für Spieler, Meisterinnen und Autor:innen – und ohne wäre Avesmaps nicht möglich gewesen. Es erfüllt uns daher mit großer Freude, dass der Staffelstab der Derografie an Avesmaps weitergegeben wird. Wir sind uns der großen Verantwortung bewusst, die damit einhergeht.\nIn diesem Zuge kündigen wir hiermit den baldigen Relaunch von Avesmaps an. Seid gespannt auf mehr Features, neue Grafik und verbesserte Performance. Aber: Um das zu erreichen, muss viel angepasst und vorbereitet werden. Dafür brauchen wir EURE Hilfe! Kommt auf unseren Discord und werdet Editoren, sodass Avesmaps der würdige Nachfolger werden kann, den Avespfade verdient.\nDen Link findet ihr in unserem Profil.",
        rubrik: "community",
    },
    {
        id: 108,
        datum: "2026-10-04",
        titel: "Gletscher, Küsten und Schneelandschaften auf der Karte",
        text: "Die Landschaftsansicht kennt fünf neue Geländearten: Gletscher, Flachküste und Steilküste sowie Schnee- und Eislandschaften. Damit lassen sich Eisregionen und Küstenformen im Norden und Süden Aventuriens genauer unterscheiden.",
        rubrik: "karte",
    },
];

const PFLEGE: NewsPflege = {
    entwuerfe: 1,
    eintraege: [
        {
            id: 113,
            datum: "2026-10-13",
            titel: "Die Suche findet auch Teilwörter",
            text: "Wer „gareth“ eingibt, findet jetzt auch „Gareths Hafen“.",
            rubrik: "karte",
            zustand: "entwurf",
            nurStage: false,
            herkunft: "routine",
            quelle: "production:20261013T190000Z-9f1c4a2",
            erstelltAt: "2026-10-13T19:00:00.000Z",
            freigegebenAt: null,
            freigegebenVon: null,
        },
        {
            id: 112,
            datum: "2026-10-13",
            titel: EINTRAEGE[0]!.titel,
            text: EINTRAEGE[0]!.text,
            rubrik: EINTRAEGE[0]!.rubrik,
            zustand: "sichtbar",
            nurStage: false,
            herkunft: "routine",
            quelle: "production:20261013T120000Z-3a32fcd",
            erstelltAt: "2026-10-13T12:00:00.000Z",
            freigegebenAt: "2026-10-13T12:40:00.000Z",
            freigegebenVon: "Rondrikan",
        },
        {
            id: 110,
            datum: "2026-10-12",
            titel: "Der Planer rechnet Flussquerungen neu",
            text: "Ein Satz, der so nie hätte erscheinen sollen.",
            rubrik: "routenplaner",
            zustand: "versteckt",
            nurStage: false,
            herkunft: "routine",
            quelle: "production:20261012T190000Z-64e03c0",
            erstelltAt: "2026-10-12T19:00:00.000Z",
            freigegebenAt: "2026-10-12T19:30:00.000Z",
            freigegebenVon: "Rondrikan",
        },
    ],
    papierkorb: [],
    stage: null,
};

const liste: NewsListe = { stand: "2026-10-13", eintraege: EINTRAEGE };

/** Der öffentliche Lesepfad aus dem Stub; die Karte dahinter kommt vom echten Entwicklungsserver. */
async function stubNews(page: Page): Promise<void> {
    await page.route("**/api/news", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liste) }),
    );
}

/** Der Lesestand des vorigen Öffnens: alles bis 110 kennt der Leser, 111 und 112 sind neu. */
async function lesestand(page: Page, bis: number): Promise<void> {
    await page.addInitScript((wert: number) => {
        try {
            window.localStorage.setItem("avm.neuigkeiten.gesehen-bis", String(wert));
        } catch {
            /* ohne Speicher ist nichts neu; das zeigt das Blatt nicht */
        }
    }, bis);
}

async function fenster(
    browser: Browser,
    baseURL: string,
    options: BrowserContextOptions,
    bis = 110,
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({ baseURL, ...options });
    const page = await context.newPage();
    await lesestand(page, bis);
    await stubNews(page);
    await page.goto("/");
    await page.getByTestId("news-open").click();
    await page.getByTestId("news-112").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    return { page, close: () => context.close() };
}

test("Blatt: Neuigkeiten", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    mkdirSync(OUTPUT, { recursive: true });
    const schuss = async (page: Page, name: string, ziel?: string): Promise<void> => {
        const ort = ziel === undefined ? page : page.locator(ziel);
        await ort.screenshot({ path: resolve(OUTPUT, `${name}.png`) });
    };

    // (a) Das Fenster, wie ein Besucher es sieht.
    const hell = await fenster(browser, baseURL!, { viewport: { width: 1280, height: 860 } });
    await schuss(hell.page, "a-fenster");
    await schuss(hell.page, "b-nah", '[data-testid="news"]');
    await hell.close();

    // (c) Dunkel.
    const dunkel = await fenster(browser, baseURL!, {
        viewport: { width: 1280, height: 860 },
        colorScheme: "dark",
    });
    await schuss(dunkel.page, "c-dunkel");
    await dunkel.close();

    // (d) Telefon.
    const telefon = await fenster(browser, baseURL!, { ...devices["Pixel 7"] });
    await schuss(telefon.page, "d-telefon");
    await telefon.close();

    // (e) Die Pflege in der Systemsteuerung.
    const pflegeContext = await browser.newContext({ baseURL: baseURL!, viewport: { width: 1280, height: 860 } });
    const pflegeSeite = await pflegeContext.newPage();
    await stubAdmin(pflegeSeite, {
        capabilities: [...ADMIN_CAPABILITIES, "manage_news"],
        role: "operator",
        answer: (call) => (call.path.startsWith("/api/admin/system/news") ? { status: 200, body: PFLEGE } : undefined),
    });
    await pflegeSeite.goto("/?verwaltung=neuigkeiten");
    await pflegeSeite.getByTestId("news-pflege-113").waitFor();
    await pflegeSeite.evaluate(() => document.fonts.ready);
    await pflegeSeite.waitForTimeout(400);
    await schuss(pflegeSeite, "e-pflege");
    await pflegeContext.close();

    // Das Blatt: eine Seite, die die Bilder ordnet und sagt, worauf zu achten ist.
    const img = (name: string, breite = 1280): string =>
        `<img src="${name}.png" width="${String(breite)}" loading="eager" />`;
    const fig = (name: string, satz: string, breite = 620): string =>
        `<figure style="width:${String(breite)}px"><img src="${name}.png" width="${String(breite)}" /><figcaption>${satz}</figcaption></figure>`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8" />
<style>
body{margin:0;padding:28px 32px;background:#f3f0e8;color:#2e271e;font:14px/1.5 Arial,sans-serif;max-width:1344px}
h1{font-size:24px;font-weight:500;margin:0 0 4px}h2{font-size:16px;font-weight:600;margin:28px 0 10px}
h2 span{font-weight:400;color:#706557}p.lead{margin:0 0 6px;color:#4a4036}
.row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0}figcaption{margin-top:6px;color:#706557;font-size:13px}
img{display:block;border:1px solid #cec3b0;border-radius:6px;background:#fff;height:auto;max-width:100%}
p.note{margin-top:24px;padding:12px 14px;border-left:3px solid #8a6b16;background:#fffdf9;color:#4a4036}
</style></head><body>
<h1>Neuigkeiten</h1>
<p class="lead">WI-0139 · Stand ${new Date().toISOString().slice(0, 10)} · Betreiber 2026-10-13: „es wird auch zeit bei <i>Production</i> den <i>Neuigkeiten-Kanal</i> fürs frontend freizuschalten“ · „erst entwurf, wie empfohlen“</p>

<h2>(a) Was Besucher sehen <span>· der Knopf unten links in der Ecke ist nicht mehr gesperrt</span></h2>
${img("a-fenster")}

<h2>(b) Nahaufnahme <span>· nach Tagen gruppiert, je Eintrag eine Rubrik; die zwei obersten kamen seit dem letzten Öffnen dazu</span></h2>
${img("b-nah", 760)}

<h2>(c) Dunkel und (d) am Telefon</h2>
<div class="row">${fig("c-dunkel", "Dunkel, dieselbe Lage", 700)}${fig("d-telefon", "Pixel 7 (412 × 915)", 300)}</div>

<h2>(e) Die Pflege in der Systemsteuerung <span>· Redaktion &amp; Integrationen › Neuigkeiten, Zahl an der Schiene = wartende Entwürfe</span></h2>
${img("e-pflege")}

<p class="note"><b>Worauf zu achten ist:</b> Die tägliche Routine legt <b>Entwürfe</b> an (○) — erst eure Freigabe macht einen Eintrag sichtbar (●).
Zurücknehmen heißt <b>verstecken</b> (◐); <b>gelöscht wird nie</b>, „Löschen“ legt seit WI-0217 in den Papierkorb. Was ein Besucher schon gelesen hat, verschwindet nicht:
Es steht leiser da, und nur was seit seinem letzten Öffnen dazukam, trägt „neu“. Der Lesestand liegt allein in seinem Browser — ohne ihn ist einmal alles
wieder neu, und das ist der harmloseste denkbare Fehler.</p>
</body></html>`;

    const sheetContext = await browser.newContext({ baseURL: baseURL!, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__neuigkeiten.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__neuigkeiten.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
