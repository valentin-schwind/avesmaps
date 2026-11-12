import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { openStageGroups, settleStages } from "./stage-groups.ts";

/**
 * Abnahmeblatt „Etappenliste“ (WI-0087): die sechs gebauten Punkte und die EINE offene Gestaltungsfrage, auf einem
 * Blatt, hell und dunkel, am Rechner und am Telefon.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/stage-list-model.test.ts`, `apps/server/test/stage-territories.test.ts` und `e2e/route-stages.spec.ts`.
 *
 *   npm run review:etappenliste
 *
 * Ablage: `review/wi-0087/etappenliste/blatt.png` (`review/` ist nicht versioniert).
 *
 * 🔴 **P7 ist seit dem 2026-10-06 entschieden und gebaut** (Form C, Raster an der Ziffer, Farbe `pillText`). Das
 * zweite Blatt stellt deshalb VORHER und NACHHER nebeneinander; das Vorher entsteht im selben Lauf, indem dem
 * gebauten Stand der alte Kreis und die durchgehende Kette wieder übergestülpt werden. Am ausgelieferten Bauteil
 * ändert dieser Lauf nichts.
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0087/etappenliste");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as { colour: Record<string, string>; colourDark?: Record<string, string> };

/** Eine Landreise mit Zwischenziel, zweistelligen Etappennummern und Wegnamen. */
const ROUTE = "/?route=Ferdok~Luring~Perricum&allowRiver=0&allowSea=0";

type Scheme = "light" | "dark";
interface Shot {
    png: Buffer;
    note: string;
}

/**
 * 🔴 **Der Zustand VORHER**, nur für den Vergleich auf dem Blatt (P7 ist seit dem 2026-10-06 entschieden und
 * gebaut): Er stülpt dem fertigen Stand die alte Perle und die durchgehende Kette wieder über - Kreis, deckender
 * Grund, Bernstein bei Auswahl, 10 px. So steht das Vorher neben dem Nachher aus demselben Lauf, statt aus einem
 * alten Bild zu stammen.
 */
const VORHER = `
    [data-testid="route-stages"] .stages__glow { display: none !important; }
    .stage__bead {
        border: 1.5px solid var(--color-text-muted) !important;
        border-radius: 50% !important;
        background: var(--mark-bg, var(--color-panel)) !important;
        color: var(--color-text-muted) !important;
        font-size: 10px !important;
    }
    .stage.is-active .stage__bead {
        border-color: var(--color-marker-active) !important;
        background: var(--color-marker-active) !important;
        color: var(--color-marker-waypoint-core) !important;
    }
    .stage.is-active .stage__number { font-weight: 400 !important; }
`;

/**
 * Die durchgehende Kette von früher: EIN Stück von der ersten bis zur letzten Marke, das die Perlen mit ihrem Grund
 * ausstanzen. Für das Vorher-Bild zusammengesetzt aus den Stücken, die das Bauteil jetzt zeichnet.
 */
async function joinChain(page: Page): Promise<void> {
    await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>("[data-testid=route-stages]");
        const pieces = [...(list?.querySelectorAll<HTMLElement>(".stages__chain") ?? [])];
        const first = pieces[0];
        if (!list || !first) return;
        const base = list.getBoundingClientRect();
        const boxen = pieces.map((piece) => piece.getBoundingClientRect());
        const oben = Math.min(...boxen.map((box) => box.top)) - base.top;
        const unten = Math.max(...boxen.map((box) => box.bottom)) - base.top;
        for (const piece of pieces.slice(1)) piece.remove();
        first.style.top = `${String(oben)}px`;
        first.style.height = `${String(unten - oben)}px`;
        first.style.backgroundPositionY = "0px";
    });
}

/** Lädt die Reise und wartet, bis die Liste steht. */
async function openRoute(page: Page, search = ROUTE): Promise<void> {
    await page.goto(search);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 60_000 });
    await page.getByTestId("route-stages").waitFor({ timeout: 60_000 });
    await page.getByTestId("route-station").first().waitFor({ timeout: 60_000 });
}

/** Ein Ausschnitt der Seite um mehrere Elemente herum, mit etwas Luft. */
async function clipOf(
    page: Page,
    boxes: ({ x: number; y: number; width: number; height: number } | null)[],
    pad = 10,
): Promise<{ x: number; y: number; width: number; height: number }> {
    const found = boxes.filter((box): box is NonNullable<typeof box> => box !== null);
    const left = Math.min(...found.map((box) => box.x)) - pad;
    const top = Math.min(...found.map((box) => box.y)) - pad;
    const right = Math.max(...found.map((box) => box.x + box.width)) + pad;
    const bottom = Math.max(...found.map((box) => box.y + box.height)) + pad;
    const size = page.viewportSize() ?? { width: 1400, height: 1000 };
    return {
        x: Math.max(0, Math.round(left)),
        y: Math.max(0, Math.round(top)),
        width: Math.min(size.width, Math.round(right - left)),
        height: Math.min(size.height, Math.round(bottom - top)),
    };
}

async function newPage(browser: Browser, baseURL: string, scheme: Scheme, width = 1400): Promise<Page> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 1000 },
        colorScheme: scheme,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(180 + Math.floor(Math.random() * 40))}` },
    });
    return context.newPage();
}

test("Abnahmeblatt: die Etappenliste (WI-0087)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    mkdirSync(OUTPUT, { recursive: true });
    const baseURL = String(testInfo.project.use.baseURL);
    const shots: Record<string, Shot> = {};
    /** Wie oft die Rast auf der gezeigten Reise wirklich anfällt - gemessen, nicht behauptet. */
    let rastZahlen: { gesamt: number; rast: number; beides: number } | null = null;
    /** Wie oft der Zusatz der Wegart wirklich auftritt - gemessen, nicht behauptet (WI-0087 P10). */
    let wegartZahlen: { gesamt: number; mitZusatz: number } | null = null;

    // ---------------------------------------------------------------- P4, P5, P3: zu und auf
    for (const scheme of ["light", "dark"] as const) {
        const page = await newPage(browser, baseURL, scheme);
        await openRoute(page);
        // Zugeklappt, wie eine frisch geöffnete Reise jetzt aussieht: Stationen stehen zwischen den Boxen.
        const list = page.getByTestId("route-stages");
        shots[`zu-${scheme}`] = { png: await list.screenshot(), note: "zugeklappt" };
        await openStageGroups(page);
        const station = page.getByTestId("route-station").nth(1);
        const before = page.getByTestId("route-stage-group").first();
        const clip = await clipOf(page, [await before.boundingBox(), await station.boundingBox()]);
        shots[`auf-${scheme}`] = {
            png: await page.screenshot({ clip: { ...clip, height: Math.min(clip.height, 520) } }),
            note: "aufgeklappt",
        };
        await page.context().close();
    }

    // ---------------------------------------------------------------- P6: Ring und Nadel, dazu die Karte
    for (const scheme of ["light", "dark"] as const) {
        const page = await newPage(browser, baseURL, scheme);
        await openRoute(page);
        const stations = page.getByTestId("route-station");
        const marks = await clipOf(
            page,
            [await stations.first().boundingBox(), await stations.last().boundingBox()],
            6,
        );
        shots[`marken-${scheme}`] = { png: await page.screenshot({ clip: marks }), note: "Ring, Ring, Nadel" };
        // Dieselben Zeichen auf der Karte - seit P6 dieselbe Gestalt, aus derselben Quelle gerastert.
        await page.waitForTimeout(1200);
        const at = await page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as {
                querySourceFeatures(
                    id: string,
                ): { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }[];
                project(point: [number, number]): { x: number; y: number };
            };
            // Die Ausschnitte sind in Seitenkoordinaten: im Editor-Modus steht über der Karte die Kopfleiste (WI-0120).
            const rect = document.querySelector('[data-testid="map"]')!.getBoundingClientRect();
            const found = map.querySourceFeatures("route-waypoints").map((feature) => {
                const point = map.project(feature.geometry.coordinates);
                return { icon: String(feature.properties["icon"]), x: rect.left + point.x, y: rect.top + point.y };
            });
            const drop = found.find((mark) => mark.icon.endsWith("drop"));
            const disc = found.find((mark) => mark.icon.endsWith("disc"));
            return { drop, disc };
        });
        for (const [name, mark] of Object.entries(at)) {
            if (!mark) continue;
            shots[`karte-${name}-${scheme}`] = {
                png: await page.screenshot({
                    clip: {
                        x: Math.max(0, Math.round(mark.x - 40)),
                        y: Math.max(0, Math.round(mark.y - 55)),
                        width: 80,
                        height: 80,
                    },
                }),
                note: name === "drop" ? "Nadel auf der Karte" : "Ring auf der Karte",
            };
        }
        await page.context().close();
    }

    // ---------------------------------------------------------------- P1, P2, P3 am Telefon (360 px)
    {
        const page = await newPage(browser, baseURL, "light", 360);
        await page.goto(ROUTE);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 60_000,
        });
        const tab = page.getByTestId("route-planner-tab");
        if ((await tab.count()) > 0 && (await tab.getAttribute("aria-expanded")) === "false") await tab.click();
        await page.getByTestId("route-stages").waitFor({ timeout: 60_000 });
        await openStageGroups(page);
        const clip = await clipOf(page, [await page.getByTestId("route-stages").boundingBox()], 0);
        shots["telefon"] = {
            png: await page.screenshot({ clip: { ...clip, x: 0, width: 360, height: Math.min(clip.height, 620) } }),
            note: "360 px",
        };
        await page.context().close();
    }

    // ---------------------------------------------------------------- P7: vorher und nachher, am echten Planer
    for (const scheme of ["light", "dark"] as const) {
        for (const stand of ["vorher", "nachher"] as const) {
            const page = await newPage(browser, baseURL, scheme);
            await openRoute(page);
            await openStageGroups(page);
            // Eine ZWEISTELLIGE Nummer wählen; ihre Zeile ist die aktive.
            const rows = page.getByTestId("route-stage");
            const count = await rows.count();
            const index = Math.min(10, Math.max(1, count - 2));
            await rows.nth(index).locator("img").first().click();
            await rows.nth(index).and(page.locator(".is-active")).waitFor({ timeout: 20_000 });
            await settleStages(page);
            if (stand === "vorher") {
                await page.addStyleTag({ content: VORHER });
                await joinChain(page);
                await page.waitForTimeout(200);
            }
            // Drei Zeilen um die gewählte herum, in echter Größe.
            const clip = await clipOf(
                page,
                [await rows.nth(index - 1).boundingBox(), await rows.nth(index + 1).boundingBox()],
                6,
            );
            shots[`p7-${stand}-${scheme}`] = {
                png: await page.screenshot({ clip: { ...clip, width: Math.min(clip.width, 330) } }),
                note: stand,
            };
            // 🔴 Die NAHT: wo die Kette auf die Ziffer trifft.
            const digit = await rows.nth(index).locator(".stage__number").boundingBox();
            if (digit) {
                shots[`p7-naht-${stand}-${scheme}`] = {
                    png: await page.screenshot({
                        clip: {
                            x: Math.max(0, Math.round(digit.x - 14)),
                            y: Math.max(0, Math.round(digit.y + digit.height / 2 - 26)),
                            width: 54,
                            height: 52,
                        },
                    }),
                    note: `Naht ${stand}`,
                };
            }
            /**
             * 🔴 Und die Stelle, an der die Kette auf eine WEGPUNKTMARKE trifft: Ring und Nadel bleiben rund und
             * stanzen weiter - dort darf sich nichts geändert haben.
             */
            const station = page.getByTestId("route-station").nth(1);
            await station.scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            const mark = await station.locator(".station__mark").boundingBox();
            const sicht = page.viewportSize();
            if (mark && sicht && mark.y > 30 && mark.y + mark.height < sicht.height - 30) {
                shots[`p7-marke-${stand}-${scheme}`] = {
                    png: await page.screenshot({
                        clip: {
                            x: Math.max(0, Math.round(mark.x - 16)),
                            y: Math.max(0, Math.round(mark.y + mark.height / 2 - 30)),
                            width: 56,
                            height: 60,
                        },
                    }),
                    note: `Marke ${stand}`,
                };
            }
            await page.context().close();
        }
    }

    // ---------------------------------------------------------------- P10: die Wegart neben dem Namen
    for (const scheme of ["light", "dark"] as const) {
        const page = await newPage(browser, baseURL, scheme);
        await openRoute(page, "/?route=Gareth~Perricum");
        await openStageGroups(page);
        const rows = page.getByTestId("route-stage");
        const kinds = await rows.evaluateAll((list) =>
            list.map((row) => ({
                name: row.querySelector("[data-testid=stage-path]")?.textContent?.trim() ?? "",
                zusatz: row.querySelector("[data-testid=stage-path-type]")?.textContent?.trim() ?? "",
            })),
        );
        const faelle: [string, (kind: { name: string; zusatz: string }) => boolean][] = [
            ["mitZusatz", (kind) => kind.name !== "" && kind.zusatz !== ""],
            ["imNamen", (kind) => kind.name !== "" && kind.zusatz === ""],
            ["ohneNamen", (kind) => kind.name === ""],
        ];
        for (const [name, passt] of faelle) {
            const at = kinds.findIndex(passt);
            if (at < 0) continue;
            await rows.nth(at).scrollIntoViewIfNeeded();
            await page.waitForTimeout(120);
            const box = await rows.nth(at).boundingBox();
            const sicht = page.viewportSize();
            if (!box || !sicht || box.y < 0 || box.y + box.height > sicht.height) continue;
            shots[`wegart-${name}-${scheme}`] = {
                png: await page.screenshot({
                    clip: { x: box.x, y: box.y, width: Math.min(box.width, 330), height: box.height },
                }),
                note: name,
            };
        }
        if (scheme === "light") {
            wegartZahlen = {
                gesamt: kinds.filter((kind) => kind.name !== "").length,
                mitZusatz: kinds.filter((kind) => kind.zusatz !== "").length,
            };
        }
        await page.context().close();
    }

    // ---------------------------------------------------------------- P11: der Eiltempo-Deckel
    for (const scheme of ["light", "dark"] as const) {
        const page = await newPage(browser, baseURL, scheme);
        await openRoute(page, "/?route=Gareth~Perricum&hurry=1");
        const deckel = page.getByTestId("planning-hurry");
        await deckel.waitFor({ timeout: 30_000 });
        await deckel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        shots[`eiltempo-zu-${scheme}`] = { png: await deckel.screenshot(), note: "zugeklappt" };
        await page.getByTestId("hurry-toggle").click();
        await page.waitForTimeout(500);
        await deckel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        shots[`eiltempo-auf-${scheme}`] = { png: await deckel.screenshot(), note: "aufgeklappt" };
        await page.context().close();
    }

    // ---------------------------------------------------------------- P8: das Etikett der Rast
    for (const scheme of ["light", "dark"] as const) {
        const page = await newPage(browser, baseURL, scheme);
        // Eine Fußreise mit Eiltempo: Nur so stehen beide Etiketten wirklich an derselben Zeile (gemessen: 12 von 36).
        await openRoute(page, "/?route=Ferdok~Perricum&land=groupFoot&domains=land&startMonth=praios&hurry=1");
        await openStageGroups(page);
        const rows = page.getByTestId("route-stage");
        const kinds = await rows.evaluateAll((list) =>
            list.map((row) => ({
                rest: row.querySelector("[data-testid=stage-rest]") !== null,
                hurry: row.querySelector("[data-testid=stage-hurry]") !== null,
            })),
        );
        const suche = (want: { rest: boolean; hurry: boolean }): number =>
            kinds.findIndex((kind) => kind.rest === want.rest && kind.hurry === want.hurry);
        const faelle: [string, { rest: boolean; hurry: boolean }][] = [
            ["beides", { rest: true, hurry: true }],
            ["nurRast", { rest: true, hurry: false }],
            ["nurEil", { rest: false, hurry: true }],
            ["ohne", { rest: false, hurry: false }],
        ];
        for (const [name, want] of faelle) {
            const at = suche(want);
            if (at < 0) continue;
            // 🪤 Die Fußreise hat 36 Etappen: Die gesuchte Zeile liegt oft unter dem Fensterrand und muss erst
            // hereingerollt werden, sonst liegt der Ausschnitt außerhalb des Bildes.
            await rows.nth(at).scrollIntoViewIfNeeded();
            await page.waitForTimeout(120);
            const box = await rows.nth(at).boundingBox();
            const sicht = page.viewportSize();
            if (!box || !sicht || box.y < 0 || box.y + box.height > sicht.height) continue;
            shots[`rast-${name}-${scheme}`] = {
                png: await page.screenshot({
                    clip: { x: box.x, y: box.y, width: Math.min(box.width, 330), height: box.height },
                }),
                note: name,
            };
        }
        if (scheme === "light") {
            rastZahlen = {
                gesamt: kinds.length,
                rast: kinds.filter((kind) => kind.rest).length,
                beides: kinds.filter((kind) => kind.rest && kind.hurry).length,
            };
        }
        await page.context().close();
    }

    // ---------------------------------------------------------------- Das Blatt
    const colour = CANON.colour;
    const image = (key: string, extra = ""): string => {
        const shot = shots[key];
        if (!shot) return '<p class="fehlt">(nicht aufgenommen)</p>';
        return `<img class="${extra}" src="data:image/png;base64,${shot.png.toString("base64")}" alt="">`;
    };
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1180px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 22px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 26px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
p.sub { margin: 0 0 10px; color: ${colour["textMuted"]}; font-size: 13px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
.vier { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; align-items: start; }
.vier > div > p, .pair > div > p, .reihe > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; }
.reihe { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
img { display: block; max-width: 100%; border: 1px solid ${colour["border"]}; border-radius: 6px; }
img.nah { image-rendering: pixelated; width: 100%; }
img.echt { width: auto; }
.note { margin: 16px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
.fehlt { color: ${colour["textMuted"]}; font-size: 12px; }
</style></head><body>
<h1>Die Etappenliste des Routenplaners</h1>
<p class="lead">WI-0087 · eine Landreise mit Zwischenziel (Ferdok → Luring → Perricum) · links hell, rechts dunkel.
P1 bis P6 und P8 sind gebaut; P7 (die Etappennummer) steht als Vorher/Nachher auf dem zweiten Blatt.</p>

<h2>P4 · P5 — zugeklappt, und das Zwischenziel bleibt <span>· die Vorgabe ist jetzt „zu“</span></h2>
<p class="sub">Links: eine frisch geöffnete Reise. Die Zusammenfassungen sind zu, Start, Zwischenziel und Ziel stehen
<i>zwischen</i> den Boxen und können nicht mit eingeklappt werden. Die punktierte Kette läuft über die Fuge durch.</p>
<div class="pair"><div><p>hell</p>${image("zu-light")}</div><div><p>dunkel</p>${image("zu-dark")}</div></div>

<h2>P1 · P2 · P3 — Wegname, Objektlink, Untertitel <span>· aufgeklappt</span></h2>
<p class="sub">Zeile 2 nennt den <b>Wegnamen</b> statt der Gattung, wo der Weg einen hat; er ist anklickbar und öffnet
den Weg im Infopanel. Unter einem Wegpunkt steht seine Ortsklasse und das unterste Gebiet mit Namen — das Gebiet ist
ebenfalls ein Objektlink.</p>
<div class="pair"><div><p>hell</p>${image("auf-light")}</div><div><p>dunkel</p>${image("auf-dark")}</div></div>

<h2>P6 — die Marken: Transparenz und gleicher Rand</h2>
<p class="sub">Die Stanze, mit der eine Marke die Kette freihält, trug den Ton der Klappbox statt den ihres eigenen
Grundes; daraus wurde eine hellere Scheibe um den Ring und ein Kasten hinter der Nadel. Dazu ist der dunkle Rand des
Rings jetzt so dick wie der der Nadel (vorher rund 60 % mehr). Karte und Liste zeichnen seither <b>dieselbe</b>
Gestalt aus einer Quelle.</p>
<div class="reihe">
  <div><p>Liste, hell · Ring, Ring, Nadel</p>${image("marken-light", "nah")}</div>
  <div><p>Liste, dunkel</p>${image("marken-dark", "nah")}</div>
  <div><p>Karte · Ring</p>${image("karte-disc-light", "echt")}</div>
  <div><p>Karte · Nadel</p>${image("karte-drop-light", "echt")}</div>
</div>

<h2>P8 — das Etikett der Rast <span>· echte Größe</span></h2>
<p class="sub">„kannst du außerdem eine rast markieren (wie eiltempo als pille?)“ — eine Etappe, in die eine Rast
fällt, trägt jetzt dasselbe Etikett wie das Eiltempo, in derselben Gestalt und am selben Platz. 🔴 Es sagt
<b>dass</b>, nicht <b>wie viel</b>: Die Stundenzahl steht im Infopanel, die Zeile ist eng.
${rastZahlen ? `Auf der gezeigten Fußreise sind es <b>${String(rastZahlen.rast)} von ${String(rastZahlen.gesamt)}</b> Etappen, und <b>${String(rastZahlen.beides)}</b> davon tragen zugleich das Eiltempo.` : ""}</p>
<p class="sub">🪤 <b>Beide Etiketten stehen wirklich nebeneinander</b> — deshalb die Frage nach einer zweiten Farbe.
Gebaut ist EINE Rezeptur, unterschieden wird über das Wort. Eine zweite Farbe gäbe es im Haus nur als
<i>pillHidden</i>, und die heißt „verborgen“: eine neue Farbe für „Rast“ behauptete eine Bedeutung, die es nicht
gibt. Wenn die beiden im Bild zu ähnlich wirken, sagen Sie es — dann ist es eine eigene kleine Entscheidung.</p>
<div class="reihe">
  <div><p>beides, hell</p>${image("rast-beides-light", "echt")}</div>
  <div><p>nur Rast</p>${image("rast-nurRast-light", "echt")}</div>
  <div><p>nur Eiltempo</p>${image("rast-nurEil-light", "echt")}</div>
  <div><p>ohne</p>${image("rast-ohne-light", "echt")}</div>
</div>
<div class="reihe" style="margin-top:12px">
  <div><p>beides, dunkel</p>${image("rast-beides-dark", "echt")}</div>
  <div><p>nur Rast</p>${image("rast-nurRast-dark", "echt")}</div>
  <div><p>nur Eiltempo</p>${image("rast-nurEil-dark", "echt")}</div>
  <div><p>ohne</p>${image("rast-ohne-dark", "echt")}</div>
</div>

<h2>Am Telefon <span>· 360 px</span></h2>
<div class="reihe"><div><p>360 px breit</p>${image("telefon", "echt")}</div></div>

<p class="note"><b>P7 (die Etappennummer) steht auf dem zweiten Blatt</b> — entschieden am 2026-10-06 und gebaut:
Form C mit Raster an der Ziffer, Farbe <i>pillText</i>. Dort als Vorher/Nachher, in echter Größe, hell und dunkel.</p>
</body></html>`;

    /**
     * 🔴 **Das eigene Blatt zu P7** (zweite Vorlage, Betreiber 2026-10-06): P1 bis P6 sind abgenommen und stehen auf
     * dem großen Blatt; hier geht es nur noch um die Etappennummer. Darum vier Spalten, Nahaufnahme, echte Größe und
     * - neu - die NAHT: die Stelle, an der die Kette auf die Ziffer trifft.
     */
    /**
     * 🔴 **Das Blatt zu P7**, jetzt als **Vorher/Nachher** - die Entscheidung ist gefallen (Betreiber 2026-10-06:
     * „wir machen Raster an der Ziffer für die naht / drei zeilen in zusammenhang: Form C"), also kein
     * Variantenblatt mehr. Das Vorher entsteht im selben Lauf, indem dem gebauten Stand die alte Perle und die
     * durchgehende Kette wieder übergestülpt werden.
     */
    const p7 = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1180px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 20px; color: ${colour["textMuted"]}; font-size: 13px; }
h2 { margin: 26px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 span { color: ${colour["textMuted"]}; font-size: 13px; }
p.sub { margin: 0 0 10px; color: ${colour["textMuted"]}; font-size: 13px; }
.paar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; align-items: start; }
.reihe { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.paar > div > p, .reihe > div > p { margin: 0 0 6px; font-size: 13px; color: ${colour["textMuted"]}; }
img { display: block; max-width: 100%; border: 1px solid ${colour["border"]}; border-radius: 6px; }
img.nah { image-rendering: pixelated; width: 100%; }
img.echt { width: auto; }
.note { margin: 18px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
.fehlt { color: ${colour["textMuted"]}; font-size: 12px; }
</style></head><body>
<h1>Die Etappennummer — gebaut</h1>
<p class="lead">WI-0087 P7 · <b>Form C mit Raster an der Ziffer</b>, Farbe <i>pillText</i> — entschieden am
2026-10-06 und <b>eingebaut</b>. Kein Variantenblatt mehr: links jeweils der Stand von vorher, rechts der gebaute.
Das Vorher entsteht im selben Lauf, indem dem gebauten Stand der alte Kreis und die durchgehende Kette wieder
übergestülpt werden.</p>

<h2>In echter Größe <span>· drei Zeilen, die mittlere gewählt (zweistellige Nummer)</span></h2>
<p class="sub">Die Ziffer hat keinen Grund und keinen Rand mehr; die Kette setzt an ihr aus. Die gewählte Zeile
<i>leuchtet auf ganzer Höhe</i> — der Verlauf sitzt auf den Kettenpunkten, nicht auf einer Fläche, sonst wäre der
Kreis zurück. Die Ziffer geht dabei von der benannten Ausnahme 10 px auf die Hausgröße 11 px zurück, und eine
gewöhnliche Nummer trägt den normalen Textton statt des gedämpften.</p>
<div class="paar">
  <div><p>vorher, hell</p>${image("p7-vorher-light", "echt")}</div>
  <div><p><b>nachher, hell</b></p>${image("p7-nachher-light", "echt")}</div>
  <div><p>vorher, dunkel</p>${image("p7-vorher-dark", "echt")}</div>
  <div><p><b>nachher, dunkel</b></p>${image("p7-nachher-dark", "echt")}</div>
</div>

<h2>Die Naht <span>· wo die Kette auf die Ziffer trifft, achtfach</span></h2>
<p class="sub">Das Raster setzt an jeder Ziffer neu an, die Luft ist 3 px als Mindestmaß, und die Punkte sitzen
mittig in ihrem Stück — so wird keiner angeschnitten. Weil jede Zeile eine Ziffer trägt, sieht jede Naht gleich aus.</p>
<div class="paar">
  <div><p>vorher, hell</p>${image("p7-naht-vorher-light", "nah")}</div>
  <div><p><b>nachher, hell</b></p>${image("p7-naht-nachher-light", "nah")}</div>
  <div><p>vorher, dunkel</p>${image("p7-naht-vorher-dark", "nah")}</div>
  <div><p><b>nachher, dunkel</b></p>${image("p7-naht-nachher-dark", "nah")}</div>
</div>

<h2>Wo die Kette auf eine Wegpunktmarke trifft <span>· achtfach</span></h2>
<p class="sub">🔴 Die Wegpunktmarken bleiben rund und stanzen die Kette weiter mit ihrem Grund aus — nur die
Etappennummer hat ihren Kreis verloren. Hier ist zu sehen, dass sich daran nichts geändert hat.</p>
<div class="paar">
  <div><p>vorher, hell</p>${image("p7-marke-vorher-light", "nah")}</div>
  <div><p><b>nachher, hell</b></p>${image("p7-marke-nachher-light", "nah")}</div>
  <div><p>vorher, dunkel</p>${image("p7-marke-vorher-dark", "nah")}</div>
  <div><p><b>nachher, dunkel</b></p>${image("p7-marke-nachher-dark", "nah")}</div>
</div>

<h2>P10 — die Wegart neben dem Namen <span>· echte Größe, nur wenn der Name sie nicht nennt</span></h2>
<p class="sub">„kannst du bei der nennung des wegnamens auch die typ einblenden, wenn der string vom typ nicht im
namen enthalten ist?“ — genau so umgesetzt. 🪤 Verglichen wird <b>ohne Rücksicht auf die Schreibung</b>:
„Reichsstraße 3“ enthält „Straße“ nur klein; mit Schreibung bekäme jede Reichsstraße ein „(Straße)“.
${wegartZahlen ? `Auf der gezeigten Reise tragen <b>${String(wegartZahlen.mitZusatz)} von ${String(wegartZahlen.gesamt)}</b> benannten Wegen den Zusatz.` : ""}</p>
<div class="reihe">
  <div><p>Art nicht im Namen → Zusatz</p>${image("wegart-mitZusatz-light", "echt")}</div>
  <div><p>Art steht im Namen → kein Zusatz</p>${image("wegart-imNamen-light", "echt")}</div>
  <div><p>kein Name → nur die Gattung</p>${image("wegart-ohneNamen-light", "echt")}</div>
</div>
<div class="reihe" style="margin-top:12px">
  <div><p>dunkel</p>${image("wegart-mitZusatz-dark", "echt")}</div>
  <div><p>dunkel</p>${image("wegart-imNamen-dark", "echt")}</div>
  <div><p>dunkel</p>${image("wegart-ohneNamen-dark", "echt")}</div>
</div>

<h2>P11 — der Eiltempo-Deckel <span>· echte Größe</span></h2>
<p class="sub">„kannst du die wall of text etwas auflockern, vielleicht kannst du die rechnung in eine tabelle tun.“
Die vier Rechenzeilen stehen jetzt als Tabelle — links die Benennung, rechts der Wert; 🔴 <b>die Werte selbst sind
unverändert</b>, dieselben Zahlen, Einheiten und Rundungen. Die Regel der Geographia darunter ist aufgelockert:
drei Sätze statt eines Absatzes, und die Aufzählung, die im Fließtext steckte, steht als Aufzählung.
🔴 <b>Wort für Wort dieselbe — gestrichen ist nichts</b> (ein Test setzt die Teile wieder zum alten Absatz zusammen).</p>
<div class="reihe">
  <div><p>zugeklappt, hell</p>${image("eiltempo-zu-light", "echt")}</div>
  <div><p>aufgeklappt, hell</p>${image("eiltempo-auf-light", "echt")}</div>
</div>
<div class="reihe" style="margin-top:12px">
  <div><p>zugeklappt, dunkel</p>${image("eiltempo-zu-dark", "echt")}</div>
  <div><p>aufgeklappt, dunkel</p>${image("eiltempo-auf-dark", "echt")}</div>
</div>

<p class="note"><b>Was dabei noch gewechselt hat:</b> Die Etappe, an der die Route einer Sperre ausweicht, trug den
Warnton bisher im RING. Mit dem Ring ist der Träger weg, die Aussage nicht — sie sitzt jetzt in der Ziffer selbst.
Und im dunklen Thema wechselt die gewählte Ziffer von Bernstein (<i>markerActive</i>, Kontrast 3,85) auf Sandgold
(<i>pillText</i>, 5,01); im hellen von 1,50 auf 6,16.</p>
</body></html>`;

    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1244, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__etappenblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.route("**/__p7blatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: p7 }),
    );
    await sheet.goto("/__etappenblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheet.goto("/__p7blatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt-p7.png"), fullPage: true });
    await sheetContext.close();
});
