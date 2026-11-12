import type { Page } from "@playwright/test";

/**
 * 🔴 IN EINER LEISTE SITZT DIE VERSALHÖHE IN DER MITTE, NICHT DIE ZEILE (Hausregel, Guide §3.2, Rezept
 * `.avm-versalmitte` in `styles/canon.css`) - und hier steht die MESSUNG dazu, genau einmal.
 *
 * 💣 Sie stand bis zum 2026-10-07 in `leisten-mitte.spec.ts` und wurde von dort gebraucht; mit WI-0098 misst ein
 * zweiter Fall dieselbe Sache an denselben Leisten (`klappbox-hoehe.spec.ts`). Eine abgeschriebene Messung ist genau
 * der Weg, auf dem zwei Rezepturen auseinanderlaufen - und bei dieser hier besonders teuer: Sie trägt fünf Fallen,
 * die alle einmal eine Zahl um mehr als einen Pixel verfälscht haben (siehe unten).
 */

/** Die Mitte der Tinte der ersten Glyphe minus die Mitte der Leiste, in CSS-Pixeln; positiv heißt: zu tief. */
export async function tintenVersatz(page: Page, band: string, text: string): Promise<number> {
    const leiste = page.locator(band).first();
    await leiste.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const box = await leiste.boundingBox();
    if (box === null) throw new Error(`Leiste ${band} ist nicht sichtbar`);
    const clip = {
        x: Math.floor(box.x) - 2,
        y: Math.floor(box.y) - 2,
        width: Math.ceil(box.width) + 5,
        height: Math.ceil(box.height) + 5,
    };
    const png = await page.screenshot({ clip });
    return page.evaluate(
        async ({ band, text, data, clip }) => {
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
            const an = (x: number, y: number): [number, number, number] => {
                const i = (y * bild.width + x) * 4;
                return [pixel[i] ?? 0, pixel[i + 1] ?? 0, pixel[i + 2] ?? 0];
            };
            const abstand = (a: number[], b: number[]): number =>
                Math.abs((a[0] ?? 0) - (b[0] ?? 0)) +
                Math.abs((a[1] ?? 0) - (b[1] ?? 0)) +
                Math.abs((a[2] ?? 0) - (b[2] ?? 0));
            const leisteElement = document.querySelector(band);
            const leiste = leisteElement?.getBoundingClientRect();
            const schrift = document.querySelector(text)?.getBoundingClientRect();
            if (leisteElement === null || leiste === undefined || schrift === undefined) {
                throw new Error("Leiste oder Text fehlt");
            }
            /**
             * 💣 **Die KONTUR der Leiste ist Tinte, und sie lag im Suchfenster.** Hier stand ein fester Einzug von
             * 1 CSS-Pixel oben und unten - genau die Breite der Kontur, also reichte er nicht, sobald die Leiste auf
             * einem Bruchteil eines Gerätepixels sitzt. Gemessen am 2026-10-06 am Quellen-Reiter (Oberkante 1053,77,
             * Höhe 18,53, Kontur 1 px): Die Glyphe lag in den Gerätezeilen 29 bis 64, danach 15 LEERE Zeilen, und
             * Zeile 80 trug 107 - die kantengeglättete Unterkontur, knapp über der Schwelle 90. Sie zog `fuss` von 64
             * auf 80 und die gemessene Mitte um 1,72 px nach unten; das Element selbst saß geometrisch exakt mittig
             * (Versatz 0,00 px, `text-box: cap alphabetic` wirkt). Zweite Wirkung: Eine Konturzeile über die ganze
             * Breite macht JEDE Spalte betintet, also fand die Spaltensuche keine Lücke und maß statt der ersten
             * Glyphe den ganzen Text.
             *
             * 🔴 Die Schranke bleibt 0,75 px. Ausgeschlossen wird die Kontur nach ihrer WIRKLICHEN Breite, dazu ein
             * Gerätepixel für die Kantenglättung.
             */
            const stilLeiste = getComputedStyle(leisteElement);
            const randOben = Number.parseFloat(stilLeiste.borderTopWidth);
            const randUnten = Number.parseFloat(stilLeiste.borderBottomWidth);
            const oben = Math.ceil((leiste.y - clip.y + randOben) * massstab) + 1;
            const unten = Math.floor((leiste.y - clip.y + leiste.height - randUnten) * massstab) - 1;
            // 🪤 Hinter Kontur und Polster beginnen: Sonst zaehlt die Kontur des Elements als erste „Glyphe“
            // und gemessen wuerde ihre Hoehe statt der eines Buchstabens (im dunklen Thema zuerst aufgefallen).
            const stil = getComputedStyle(document.querySelector(text) as Element);
            const einzug = Number.parseFloat(stil.paddingLeft) + Number.parseFloat(stil.borderLeftWidth);
            const x0 = Math.round((schrift.x + einzug - clip.x) * massstab) + 1;
            const x1 = Math.round((schrift.x + schrift.width - clip.x) * massstab) - 1;
            // Der Grund: die Mitte der Leiste, zwei Pixel unter ihrer Oberkante - dort steht in jeder Leiste
            // Polster, denn die Versalhoehe beginnt tiefer.
            const grund = an(
                Math.round((leiste.x + leiste.width / 2 - clip.x) * massstab),
                Math.round((leiste.y - clip.y + 2) * massstab),
            );
            const tinte = (x: number, y: number): boolean => abstand(an(x, y), grund) > 90;
            // Nur die erste Glyphe: ab dem ersten Tintenstrich bis zur nächsten freien Spalte.
            let erste = -1;
            let letzte = -1;
            for (let x = x0; x < x1; x += 1) {
                let hat = false;
                for (let y = oben; y < unten && !hat; y += 1) hat = tinte(x, y);
                if (hat) {
                    if (erste < 0) erste = x;
                    letzte = x;
                } else if (erste >= 0) break;
            }
            if (erste < 0) throw new Error("keine Tinte in der Leiste gefunden");
            let kopf = -1;
            let fuss = -1;
            let zeilenMitTinte = 0;
            for (let y = oben; y < unten; y += 1) {
                let hat = false;
                for (let x = erste; x <= letzte && !hat; x += 1) hat = tinte(x, y);
                if (hat) {
                    if (kopf < 0) kopf = y;
                    fuss = y;
                    zeilenMitTinte += 1;
                }
            }
            // 🔴 Der Wächter gegen genau den Fehler, der diese Messung 1,72 px falsch machte: Eine Glyphe ist ein
            // zusammenhängender Block von Zeilen. Liegt zwischen `kopf` und `fuss` eine leere Zeile, steckt etwas
            // anderes als Schrift im Fenster (eine Kontur, ein Schatten, eine Nachbarzeile) - dann ist die Zahl
            // falsch, und ein falscher Wert soll auffallen und nicht gemessen werden.
            if (zeilenMitTinte !== fuss - kopf + 1) {
                throw new Error(
                    `kein zusammenhängender Buchstabe: ${String(zeilenMitTinte)} betintete Zeilen zwischen ${String(kopf)} und ${String(fuss)} - im Fenster steckt etwas, das keine Schrift ist`,
                );
            }
            const mitte = (kopf + fuss + 1) / 2 / massstab + clip.y;
            return Math.round((mitte - (leiste.y + leiste.height / 2)) * 100) / 100;
        },
        { band, text, data: png.toString("base64"), clip },
    );
}
