import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { showStages } from "./stage-groups.ts";

/**
 * Abnahmeblatt der Runde vom 2026-10-05: Eiltempo nach der Geographia, die beiden nachgelieferten Bilder, der
 * zweite Sperrhinweis und die sechs Änderungen des Betreibers an der Reiseübersicht.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor; die Prüfungen stehen in `route-stages.spec.ts`,
 * `route-departure.spec.ts`, `route-landscapes.spec.ts` und den Unit-Tests.
 *
 * 🔴 Seit 2026-10-06 läuft er nicht mehr im Standardlauf (`playwright.config.ts`, `SHEET_SPECS`),
 * sondern nur noch, wenn seine Datei genannt wird. Die beiden `expect` hier sind dabei nachgeprüft
 * und nicht verloren gegangen (nachgeprüft erneut 2026-10-10, WI-0123): Die Eiltempo-Pille sichert
 * `route-stages.spec.ts` „Eiltempo (WI-0078): der Haken verkürzt die Zeit …“ (fordert sie mit dem Haken
 * und ihr Ausbleiben ohne ihn), den zweiten Sperrhinweis sichert `route-departure.spec.ts` „im Tsa
 * ohnehin gemieden …“ — und zwar SCHÄRFER als hier, nämlich über seinen Text statt nur über seine
 * Sichtbarkeit. Hier blieben sie stehen, weil ein Blatt ohne Pille und ohne Hinweis
 * das Falsche zeigen würde; sie sichern also das Blatt, nicht die Anwendung.
 *
 * 🪤 Aufgenommen wird immer das GANZE Element (`locator.screenshot()`); die Ausschnitte entstehen erst im Blatt
 * über einen Rahmen mit `overflow: hidden`. Ein `page.screenshot({ clip })` reicht hier nicht: Die Etappenliste ist
 * höher als das Fenster.
 *
 * Ablage: `review/wi-0078-ga/blatt.png` (`review/` ist nicht versioniert).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0078-ga");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string> };

async function openRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await showStages(page, 30_000);
}

const shot = (locator: Locator): Promise<Buffer> => locator.screenshot();

/**
 * Ein Ausschnitt ab der linken oberen Ecke eines Elements.
 *
 * 🪤 Nicht `locator.screenshot()` für einen Teil einer LANGEN Liste: Ist das Element höher als das Fenster, nimmt
 * Playwright die ganze Seite auf, und der Ausschnitt träfe den Planerkopf. Deshalb erst ins Bild rollen, dann die
 * Seite mit `clip` aufnehmen.
 */
async function teil(page: Page, locator: Locator, box: { w: number; h: number; dy?: number }): Promise<Buffer> {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const rect = await locator.boundingBox();
    if (!rect) throw new Error("kein Kasten");
    const y = Math.max(0, rect.y + (box.dy ?? 0));
    return page.screenshot({ clip: { x: rect.x, y, width: box.w, height: Math.min(box.h, 940 - y) } });
}

test("Abnahmeblatt: Eiltempo am Reisetag, zwei neue Bilder, der zweite Sperrhinweis, sechs Änderungen", async ({
    page,
}, testInfo) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1280, height: 960 });

    // 1. Die Etappenliste: ohne Zwischenräume, ohne „›“, Ring am Start, Nadel am Ziel, Perlen ein- und zweistellig.
    await openRoute(page, "?route=Gareth~Fasar");
    await page.getByTestId("route-stage").nth(9).click();
    await page.waitForTimeout(500);
    const kopfBild = await teil(page, page.getByTestId("route-stage-group").first(), { w: 340, h: 320 });
    const gewaehltBild = await teil(page, page.getByTestId("route-stage").nth(9), { w: 340, h: 300, dy: -130 });
    const ziel = await shot(page.getByTestId("route-station").last());
    const perleEins = await shot(page.getByTestId("route-stage").first().locator(".stage__bead"));
    const perleZehn = await shot(page.getByTestId("route-stage").nth(9).locator(".stage__bead"));
    const perleElf = await shot(page.getByTestId("route-stage").nth(10).locator(".stage__bead"));

    // 2. Das Eiltempo-Etikett und der Deckel - über die Adresse, nicht über den Haken: Der Kasten
    // TRANSPORTMITTEL ist zugeklappt, und sein Bild fängt den Klick ab.
    await openRoute(page, "?route=Gareth~Fasar&hurry=1");
    await expect(page.getByTestId("stage-hurry").first()).toBeVisible({ timeout: 20_000 });
    const eiltempoBild = await teil(page, page.getByTestId("route-stage-group").first(), { w: 340, h: 320 });
    const deckelZu = await shot(page.getByTestId("planning-hurry"));
    await page.getByTestId("hurry-toggle").click();
    await page.waitForTimeout(400);
    const deckelOffen = await shot(page.getByTestId("planning-hurry"));

    // 3. Die beiden neuen Bilder: Querfeldein in der Zeile, das eigene Flugmittel im Kopf der Flugliste.
    await openRoute(page, "?route=@455.91,516.01~Wallerheim");
    const querfeldein = await shot(page.getByTestId("route-stage").first());
    await openRoute(page, "?route=Gareth~Fasar&air=custom&airSpeed=40&airAltitude=250");
    const eigenesFluggeraet = await teil(page, page.getByTestId("route-flight"), { w: 340, h: 92 });

    // 4. Der zweite Sperrhinweis: gesperrt, aber ohnehin gemieden.
    await openRoute(page, "?route=Greifenfurt~Lowangen&landTransport=lightRider&startMonth=firun&startDay=1");
    await expect(page.getByTestId("route-closure-anyway")).toBeVisible({ timeout: 20_000 });
    const sperrhinweis = await shot(page.getByTestId("route-closure-anyway"));
    await page.getByTestId("route-stage").first().click();
    await page.waitForTimeout(900);
    const etappenhinweis = await shot(page.getByTestId("stage-note").first());

    // 5. Die Reihenfolge der Blöcke und die Flächenbox mit ihren Unterüberschriften.
    await openRoute(page, "?route=Gareth~Fasar");
    const reihenfolge = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".overview__heading--legs")].map(
            (element) => element.textContent?.trim() ?? "",
        ),
    );
    await page.getByTestId("areas-toggle").scrollIntoViewIfNeeded();
    await page.getByTestId("areas-toggle").click();
    await page.waitForTimeout(500);
    const flaechen = await teil(page, page.getByTestId("route-areas"), { w: 340, h: 320 });

    const colour = CANON.colour;
    const bild = (png: Buffer, width: number): string =>
        `<img width="${String(width)}" src="data:image/png;base64,${png.toString("base64")}" alt="">`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${String(testInfo.project.use.baseURL)}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 36px; width: 1180px; background: ${colour["pageBg"]}; color: ${colour["text"]};
    font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 18px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 980px; }
section { padding: 14px 0 6px; border-top: 1px solid ${colour["border"]}; }
h2 { margin: 0 0 8px; font-size: 17px; font-weight: 400; color: ${colour["textStrong"]}; }
.reihe { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; }
figure { margin: 0; }
figcaption { margin-top: 5px; font-size: 12px; color: ${colour["textMuted"]}; max-width: 360px; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 6px; background: ${colour["panel"]}; }
.perlen { display: flex; gap: 14px; }
.perlen img { image-rendering: pixelated; border-radius: 50%; }
p.note { margin: 8px 0 0; font-size: 13px; color: ${colour["textMuted"]}; max-width: 980px; }
b { color: ${colour["textStrong"]}; font-weight: 400; }
</style></head><body>
<h1>Eiltempo nach der Geographia · zwei neue Bilder · der zweite Sperrhinweis · sechs Änderungen an der Übersicht</h1>
<p class="lead">Ein Blatt für die Runde vom 2026-10-05. Oben, was sich an der Etappenliste geändert hat, darunter die
nachgelieferten Bilder, der neue Sperrhinweis und die Flächenbox.</p>

<section><h2>1 · Die Etappenliste: keine Zwischenräume, kein „›“, Ring am Start, Nadel am Ziel</h2>
<div class="reihe">
<figure>${bild(kopfBild, 340)}<figcaption>Die Etappen einer Gruppe stehen als EINE Liste;
getrennt nur durch eine Haarlinie zwischen zwei Zeilen. Der Abstand zwischen den Mediengruppen bleibt. Am Start der
Ring der Wegpunkteingabe.</figcaption></figure>
<figure>${bild(gewaehltBild, 340)}<figcaption>Die gewählte Etappe (10) mitten in der Liste:
Ohne Abstand trägt die Fläche sie allein. Rechts steht kein „›“ mehr - dort klappt nichts auf.</figcaption></figure>
<figure>${bild(ziel, 300)}<figcaption>Das Ziel trägt jetzt die Nadel (Tropfen) wie in der Wegpunkteingabe, nicht mehr
die schlichte Scheibe. Die Kette endet an ihrem Kopf.</figcaption></figure>
<figure><div class="perlen">${bild(perleEins, 80)}${bild(perleZehn, 80)}${bild(perleElf, 80)}</div>
<figcaption>Die Perlen, vierfach vergrößert: einstellig, zweistellig gefüllt (die gewählte Etappe) und zweistellig
hohl. 20 px statt 18, Ziffer 10 px statt 11, Versalhöhe mittig - „10“ misst 14,0 px in 17 px Innenraum (gemessen
1,5 px Luft zum Ring; vorher lagen die Ziffern 0,2 px IM Ring).</figcaption></figure>
</div></section>

<section><h2>2 · Eiltempo rechnet am Reisetag</h2>
<div class="reihe">
<figure>${bild(eiltempoBild, 340)}<figcaption>Das Etikett steht nur an Etappen, auf denen das
Eiltempo wirklich gegriffen hat - also an Eiltagen. Ein gewöhnlicher Reisetag trägt keines.</figcaption></figure>
<figure>${bild(deckelZu, 360)}<figcaption>Der Deckel nennt nur das Ergebnis: die gesparte Zeit zuerst, dann wofür.
Die Zahl ist hervorgehoben, das Wort nicht - das Rezept der Klappbox.</figcaption></figure>
<figure>${bild(deckelOffen, 460)}<figcaption>Aufgeklappt steht die Rechnung: welcher Teil der Reise geeignet war, wie
viele Reisetage wirklich geeilt wurden, welcher Faktor an einem Eiltag galt, und was daraus
folgt.</figcaption></figure>
</div>
<p class="note">Neu: An einem <b>Eiltag</b> gilt der volle Faktor der Geographia (1,5 beziehungsweise 1,25), an jedem
zweiten Reisetag gar keiner - vorher war es ein Mittelwert von 1,2 über die ganze Reise. Eine Reise, die an einem Tag
endet, bekommt damit die vollen 1,5. Gemessen an denselben 200 Zufallsreisen: Median 10,00 % → <b>12,91 %</b> kürzer,
über alle Reisen 8,99 % → <b>11,13 %</b>. 0 abweichende Kantenfolgen, 0 Reisen wurden länger.</p></section>

<section><h2>3 · Die beiden nachgelieferten Bilder</h2>
<div class="reihe">
<figure>${bild(querfeldein, 360)}<figcaption>„Unwegsames Gelände“ trägt jetzt das neue Bild im Stil der übrigen; das
alte flache ist abgelöst.</figcaption></figure>
<figure>${bild(eigenesFluggeraet, 340)}<figcaption>Ein eigenes Flugmittel trägt das neutrale
Bild „Eigenes Fluggerät“ - vorher blieb die Spalte leer, und davor wurde fälschlich der Hexenflug
gezeichnet.</figcaption></figure>
</div></section>

<section><h2>4 · Der zweite Sperrhinweis: gesperrt, aber ohnehin gemieden</h2>
<div class="reihe">
<figure>${bild(sperrhinweis, 460)}<figcaption>Greifenfurt → Lowangen, reitend, ab 1. Firun. Der Saljethweg ist
gesperrt, aber die Reise meidet ihn schon wegen des Schnees - deshalb <b>ohne Zeitangabe</b>.</figcaption></figure>
<figure>${bild(etappenhinweis, 460)}<figcaption>Welcher Weg und wann er zu ist, steht wie bisher am Abzweig, im
Infopanel der Etappe.</figcaption></figure>
</div></section>

<section><h2>5 · Die Übersicht: Reiseetappen oben, Routendetails darunter; der Deckel ohne „Durch“</h2>
<div class="reihe">
<figure>${bild(flaechen, 340)}<figcaption>Der Deckel beginnt mit der Zahl. Innen tragen
beide Listen eine Unterüberschrift - gedämpft, klein, in Versalien, ohne Grund und ohne Pfeil, damit sie nicht wie
ein zweiter Klappdeckel wirken. Sie nennen keine Zahl: die trägt der Deckel darüber.</figcaption></figure>
</div>
<p class="note">Die Reihenfolge der beiden Überschriften im laufenden Browser gemessen:
<b>${reihenfolge.map((text) => text || "—").join(" → ")}</b>.</p></section>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
