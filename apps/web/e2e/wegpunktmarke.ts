import { expect, type Page } from "@playwright/test";

/**
 * Die Marke eines Wegpunkts ausmessen - **im gezeichneten Bild**, nicht im Stylesheet (Guide §3.2: „Gemessen wird am
 * Bild, nicht am Stylesheet"). Gemeinsam genutzt von `wegpunktmarke.spec.ts` (Zusicherungen) und
 * `wegpunktmarke-review.spec.ts` (Blatt).
 *
 * 🔴 **Warum am Bild:** Die Frage des Betreibers („gleich groß") gilt für das, was er sieht. Ein `width` im
 * Stylesheet beantwortet sie nicht - ein viewBox, ein `preserveAspectRatio` oder ein Polster kann dazwischenstehen.
 *
 * 🪤 **Die Tinte wird nach FARBE erkannt, nicht als „weicht vom Grund ab".** Erster Versuch war eine Schwelle gegen
 * das Eckpixel des Ausschnitts; im dunklen Thema liegt der dunkle Rand der Marke (`markerWaypointCore` #2e2119) nur
 * 29 Einheiten vom Panelgrund (#312e26) entfernt, also zählte er als Grund und die Messung gab 15 statt 18 px
 * zurück - der rote Körper allein. Jetzt entscheidet für jedes Pixel, ob es dem Kern, dem Körper oder dem Grund
 * näher liegt; alle drei Farben kommen aus dem Dokument (`getComputedStyle`), nicht aus einer Tabelle hier.
 */
export type MarkMass = {
    /** Der Layoutkasten des SVG in CSS-Pixeln. */
    kasten: { breite: number; hoehe: number };
    /** Die wirklich gezeichnete Tinte in CSS-Pixeln, gemessen bei vierfacher Pixeldichte. */
    tinte: { breite: number; hoehe: number };
};

/** Die gepunkteten Linien verdecken: Sie sind Tinte und lägen sonst im Suchfenster. */
export const OHNE_PUNKTLINIEN = `.waypoint__marker::after { display: none !important; }
.stages__chain, .stages__glow { display: none !important; }`;

/**
 * Der Stand VOR WI-0097 als Stilzettel: die Marke der Etappenliste bei 13 px (Ring) und 10 × 17 px (Nadel).
 * `!important` übersteuert das Inline-`style` des Bauteils - so entsteht das „vorher" aus DEMSELBEN Stand.
 */
export const VORHER_WI0097 = `[data-testid="route-station"] .mark--disc { width: 13px !important; height: 13px !important; }
[data-testid="route-station"] .mark--drop { width: 10px !important; height: 17px !important; }`;

export async function markMass(page: Page, selektor: string, nth: number): Promise<MarkMass> {
    const element = page.locator(selektor).nth(nth);
    await element.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const box = await element.boundingBox();
    if (box === null) throw new Error(`Marke nicht sichtbar: ${selektor} #${String(nth)}`);
    const luft = 3;
    const clip = {
        x: Math.floor(box.x) - luft,
        y: Math.floor(box.y) - luft,
        width: Math.ceil(box.width) + 2 * luft + 2,
        height: Math.ceil(box.height) + 2 * luft + 2,
    };
    const png = await page.screenshot({ clip });
    const tinte = await page.evaluate(
        async ({ data, clip, selektor, nth }) => {
            const svg = document.querySelectorAll(selektor)[nth];
            if (!(svg instanceof SVGElement)) throw new Error("kein SVG an dieser Stelle");
            const rgb = (text: string): number[] =>
                (text.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map((wert) => Number(wert));
            const kern = rgb(getComputedStyle(svg.querySelector(".mark-core") as Element).fill);
            const koerper = rgb(getComputedStyle(svg.querySelector(".mark-fill") as Element).fill);
            // Der Grund: die erste Elternfläche, die wirklich deckt - beim Ring sein Saum, bei der Nadel ihr Kasten.
            let grund: number[] | null = null;
            for (let element = svg.parentElement; element !== null; element = element.parentElement) {
                const teile = (getComputedStyle(element).backgroundColor.match(/[\d.]+/g) ?? []).map((wert) =>
                    Number(wert),
                );
                if (teile.length >= 3 && (teile.length < 4 || (teile[3] ?? 1) > 0.5)) {
                    grund = teile.slice(0, 3);
                    break;
                }
            }
            if (grund === null) throw new Error("kein deckender Grund hinter der Marke gefunden");
            const bild = new Image();
            bild.src = `data:image/png;base64,${data}`;
            await bild.decode();
            const canvas = document.createElement("canvas");
            canvas.width = bild.width;
            canvas.height = bild.height;
            const kontext = canvas.getContext("2d");
            if (kontext === null) throw new Error("kein 2D-Kontext");
            kontext.drawImage(bild, 0, 0);
            const pixel = kontext.getImageData(0, 0, bild.width, bild.height).data;
            const massstab = bild.width / clip.width;
            const weg = (a: number[], b: number[]): number =>
                ((a[0] ?? 0) - (b[0] ?? 0)) ** 2 + ((a[1] ?? 0) - (b[1] ?? 0)) ** 2 + ((a[2] ?? 0) - (b[2] ?? 0)) ** 2;
            // Suchfenster: der Kasten der Marke plus ein CSS-Pixel. Weiter nicht - sonst zählen Nachbarn mit.
            const svgBox = svg.getBoundingClientRect();
            const gerät = (wert: number): number => Math.round(wert * massstab);
            const x0 = Math.max(0, gerät(svgBox.x - clip.x - 1));
            const x1 = Math.min(bild.width - 1, gerät(svgBox.x + svgBox.width - clip.x + 1));
            const y0 = Math.max(0, gerät(svgBox.y - clip.y - 1));
            const y1 = Math.min(bild.height - 1, gerät(svgBox.y + svgBox.height - clip.y + 1));
            let links = Infinity;
            let rechts = -Infinity;
            let oben = Infinity;
            let unten = -Infinity;
            for (let y = y0; y <= y1; y += 1) {
                for (let x = x0; x <= x1; x += 1) {
                    const i = (y * bild.width + x) * 4;
                    const farbe = [pixel[i] ?? 0, pixel[i + 1] ?? 0, pixel[i + 2] ?? 0];
                    if (Math.min(weg(farbe, kern), weg(farbe, koerper)) >= weg(farbe, grund)) continue;
                    if (x < links) links = x;
                    if (x > rechts) rechts = x;
                    if (y < oben) oben = y;
                    if (y > unten) unten = y;
                }
            }
            if (rechts < 0) throw new Error("keine Tinte im Kasten der Marke gefunden");
            return {
                breite: Math.round(((rechts - links + 1) / massstab) * 100) / 100,
                hoehe: Math.round(((unten - oben + 1) / massstab) * 100) / 100,
            };
        },
        { data: png.toString("base64"), clip, selektor, nth },
    );
    return {
        kasten: { breite: Math.round(box.width * 100) / 100, hoehe: Math.round(box.height * 100) / 100 },
        tinte,
    };
}

/** Die vier Marken einer Reise mit Zwischenziel: Ring und Nadel, je oben in der Eingabe und unten in der Liste. */
export type VierMarken = { ringOben: MarkMass; ringUnten: MarkMass; nadelOben: MarkMass; nadelUnten: MarkMass };

export async function vierMarken(page: Page): Promise<VierMarken> {
    const stationen = await page.getByTestId("route-station").count();
    const zettel = await page.addStyleTag({ content: OHNE_PUNKTLINIEN });
    await page.waitForTimeout(150);
    const masse = {
        ringOben: await markMass(page, ".waypoint__marker .mark--disc", 0),
        nadelOben: await markMass(page, ".waypoint__marker .mark--drop", 0),
        ringUnten: await markMass(page, '[data-testid="route-station"] .mark--disc', 0),
        nadelUnten: await markMass(page, '[data-testid="route-station"] .mark--drop', 0),
    };
    await zettel.evaluate((element) => (element as unknown as HTMLElement).remove());
    await page.waitForTimeout(200);
    expect(stationen, "die Reise hat Start, Zwischenziel und Ziel").toBeGreaterThanOrEqual(3);
    return masse;
}

/**
 * Anfang und Ende der Kette gegen die Ankerpunkte der ersten und letzten Marke - dieselbe Rechnung wie in
 * `route-stages.spec.ts`, hier als Nachweis, dass eine GRÖSSERE Marke die Kette nicht verschiebt. Der Anker ist ein
 * ANTEIL der Markenhöhe (`MARK_CHAIN_ANCHOR`), also größenunabhängig; genau das wird hier gemessen.
 */
export async function ketteGegenAnker(page: Page): Promise<{ stuecke: number; oben: number; unten: number }> {
    const werte = await page.evaluate(() => {
        const liste = document.querySelector<HTMLElement>("[data-testid=route-stages]");
        if (liste === null) throw new Error("keine Etappenliste");
        const stuecke = [...liste.querySelectorAll<HTMLElement>(".stages__chain")];
        const marken = [...liste.querySelectorAll<HTMLElement>(".stages__mark")].filter(
            (marke) => marke.getClientRects().length > 0,
        );
        if (stuecke.length === 0 || marken.length < 2) return null;
        const anker = (marke: HTMLElement): number => {
            const rect = marke.getBoundingClientRect();
            return rect.top + rect.height * Number(marke.dataset["chainAnchor"] ?? "0.5");
        };
        const boxen = stuecke.map((stueck) => stueck.getBoundingClientRect());
        return {
            stuecke: stuecke.length,
            oben: Math.min(...boxen.map((box) => box.top)) - anker(marken[0] as HTMLElement),
            unten: Math.max(...boxen.map((box) => box.bottom)) - anker(marken[marken.length - 1] as HTMLElement),
        };
    });
    if (werte === null) throw new Error("keine Kette und keine zwei Marken in der Liste");
    return {
        stuecke: werte.stuecke,
        oben: Math.round(werte.oben * 100) / 100,
        unten: Math.round(werte.unten * 100) / 100,
    };
}

/**
 * Wie groß die Karte dieselbe Gestalt rastert - nur Befund (WI-0097 ändert die Karte NICHT).
 *
 * 🪤 Das Bild ist mit `pixelRatio: 2` angemeldet (`map/runtime-images.ts`), seine Datenmaße sind also doppelt so
 * groß wie das, was auf der Karte steht; geteilt wird deshalb durch das Verhältnis.
 */
export async function karteMarkenMass(
    page: Page,
): Promise<{ ring: number; nadelBreite: number; nadelHoehe: number; iconSize: unknown }> {
    return page.evaluate(() => {
        interface Kartenbilder {
            getImage: (id: string) => undefined | { data: { width: number; height: number }; pixelRatio?: number };
            getLayoutProperty: (layer: string, property: string) => unknown;
        }
        const karte = globalThis.avesmapsMap as unknown as Kartenbilder | undefined;
        if (!karte) throw new Error("keine Karte");
        const bild = (id: string): { w: number; h: number } => {
            const eintrag = karte.getImage(id);
            if (!eintrag) throw new Error(`kein Bild ${id}`);
            const ratio = eintrag.pixelRatio ?? 1;
            return { w: eintrag.data.width / ratio, h: eintrag.data.height / ratio };
        };
        const ring = bild("route-marker-disc");
        const nadel = bild("route-marker-drop");
        return {
            ring: Math.round(ring.w * 100) / 100,
            nadelBreite: Math.round(nadel.w * 100) / 100,
            nadelHoehe: Math.round(nadel.h * 100) / 100,
            // Ohne `icon-size` zeichnet MapLibre das Bild in seiner eigenen Größe - der Befund gilt dann so.
            iconSize: karte.getLayoutProperty("route-markers", "icon-size") ?? null,
        };
    });
}
