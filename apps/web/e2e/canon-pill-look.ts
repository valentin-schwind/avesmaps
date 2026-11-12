import { expect, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";

/**
 * Die Kanon-Pille, gemessen an der TINTE (Betreiber 2026-10-04: „die pillen offiziell und inoffiziell sind extrem wichtig. mach den text
 * darin fett und zentrier ihn vertikal exakt mittig“; „nein nur die linke hälfte von INOFFIZIELL | Briefspiel wird fett“).
 *
 * Gemessen wird, was man sieht: Ein Bildschirmausschnitt um die Pille, ganzzahlig ausgerichtet und mit bekanntem Versatz (ein
 * Elementausschnitt rundet die Lage der Pille und verschiebt das Ergebnis um deren Bruchteil), wird im Browser auf Schriftpixel
 * untersucht. Im Kanonfeld zählt das ganze Wort (Versalien, keine Unterlängen), im Namensfeld nur die ERSTE Glyphe - ein Großbuchstabe
 * („Briefspiel“): Ober- und Unterlängen der übrigen gehören nicht zur Versalhöhe. Die Mitte der Tinte wird mit der Mitte der Pille
 * verglichen. Taugt nur bei hoher Pixeldichte (≥ 2,5): bei 1 wäre die Rasterung selbst schon ±0,5 px.
 */

/** Die Fälle, über ihre Kennung geöffnet (der Objektlink `?siedlung=Grafenstein` liefe über die Namenssuche, unter Last langsam). */
export const CANON_PILL_CASES = [
    {
        name: "Gareth (offiziell, Kopf und Quellenkasten)",
        ref: { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" },
        title: "Gareth",
    },
    {
        name: "Grafenstein (inoffiziell | Briefspiel)",
        ref: { kind: "place", id: "bb7636b3-dcb9-42dc-a034-e6da3193c954" },
        title: /Grafenstein/,
    },
    {
        name: "Königreich Garetien (offizielles Gebiet)",
        ref: { kind: "territory", id: "99dacb52-93f1-4698-8746-1dd9d4b55992" },
        title: /Garetien/,
    },
] as const;

export interface CanonFieldMeasure {
    text: string;
    /** Mitte der Tinte minus Mitte der Pille in CSS-Pixeln; positiv heißt: zu tief. */
    delta: number;
    weight: string;
    synthesis: string;
}

export interface CanonPillMeasure {
    height: number;
    fields: CanonFieldMeasure[];
}

/** Misst jede sichtbare Kanon-Pille im Panel. */
export async function measureCanonPills(page: Page): Promise<CanonPillMeasure[]> {
    const pills = page.getByTestId("info-canon");
    const result: CanonPillMeasure[] = [];
    const count = await pills.count();
    for (let index = 0; index < count; index += 1) {
        const pill = pills.nth(index);
        if (!(await pill.isVisible())) continue;
        await pill.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const box = await pill.boundingBox();
        if (box === null) continue;
        const clip = {
            x: Math.floor(box.x) - 2,
            y: Math.floor(box.y) - 2,
            width: Math.ceil(box.width) + 5,
            height: Math.ceil(box.height) + 5,
        };
        const png = await page.screenshot({ clip });
        const layout = await pill.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                y: rect.y,
                height: rect.height,
                fields: [...element.querySelectorAll<HTMLElement>(".info-canon__state, .info-canon__by")].map(
                    (field) => {
                        const fieldRect = field.getBoundingClientRect();
                        const style = getComputedStyle(field.querySelector(".info-canon__glyphs") ?? field);
                        return {
                            x: fieldRect.x,
                            width: fieldRect.width,
                            text: (field.textContent ?? "").trim(),
                            wholeWord: field.classList.contains("info-canon__state"),
                            weight: style.fontWeight,
                            synthesis: style.fontSynthesisWeight,
                        };
                    },
                ),
            };
        });
        const fields = await page.evaluate(
            async ({ data, layout, clip }) => {
                const image = new Image();
                image.src = `data:image/png;base64,${data}`;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d");
                if (context === null) throw new Error("kein 2D-Kontext");
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(0, 0, image.width, image.height).data;
                const scale = image.width / clip.width;
                const at = (x: number, y: number): [number, number, number] => {
                    const i = (y * image.width + x) * 4;
                    return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
                };
                const distance = (a: number[], b: number[]): number =>
                    Math.abs((a[0] ?? 0) - (b[0] ?? 0)) +
                    Math.abs((a[1] ?? 0) - (b[1] ?? 0)) +
                    Math.abs((a[2] ?? 0) - (b[2] ?? 0));
                // Innerhalb der Kontur (1 px) und mit einem halben Pixel Abstand zur Kante.
                const top = Math.ceil((layout.y - clip.y + 1.5) * scale);
                const bottom = Math.floor((layout.y - clip.y + layout.height - 1.5) * scale);
                const middle = Math.round((layout.y - clip.y + layout.height / 2) * scale);
                return layout.fields.map((field) => {
                    const x0 = Math.round((field.x - clip.x) * scale) + 3;
                    const x1 = Math.round((field.x + field.width - clip.x) * scale) - 3;
                    const background = at(x0, middle);
                    const inked = (x: number, y: number): boolean => distance(at(x, y), background) > 120;
                    let first = -1;
                    let last = -1;
                    for (let x = x0; x < x1; x += 1) {
                        let ink = false;
                        for (let y = top; y < bottom && !ink; y += 1) ink = inked(x, y);
                        if (ink) {
                            if (first < 0) first = x;
                            last = x;
                        } else if (first >= 0 && !field.wholeWord) break;
                    }
                    let inkTop = -1;
                    let inkBottom = -1;
                    for (let y = top; y < bottom; y += 1) {
                        let ink = false;
                        for (let x = first; x <= last && first >= 0 && !ink; x += 1) ink = inked(x, y);
                        if (ink) {
                            if (inkTop < 0) inkTop = y;
                            inkBottom = y;
                        }
                    }
                    const centre = (inkTop + inkBottom + 1) / 2 / scale;
                    return {
                        text: field.text,
                        delta: Math.round((centre - (layout.y - clip.y) - layout.height / 2) * 100) / 100,
                        weight: field.weight,
                        synthesis: field.synthesis,
                    };
                });
            },
            { data: png.toString("base64"), layout, clip },
        );
        result.push({ height: Math.round(box.height * 100) / 100, fields });
    }
    return result;
}

/** Öffnet einen Fall, prüft hell und dunkel: mittig auf 0,5 px, 18 px hoch, fett nur das Kanonwort. */
export async function expectCanonPillsCentred(page: Page): Promise<void> {
    await openMap(page);
    for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const subject of CANON_PILL_CASES) {
            await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), subject.ref);
            await expect(page.getByTestId("info-title")).toHaveText(subject.title, { timeout: 30_000 });
            await expect(page.getByTestId("info-canon").first()).toBeVisible();
            // Die Fahrt des Panels und das Laden der Schrift abwarten.
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(400);
            const pills = await measureCanonPills(page);
            expect(pills.length, `${subject.name}, ${scheme}`).toBeGreaterThan(0);
            for (const pill of pills) {
                const where = `${subject.name}, ${scheme}: ${pill.fields.map((field) => field.text).join(" | ")}`;
                expect(pill.height, where).toBe(18);
                for (const field of pill.fields) {
                    expect(
                        Math.abs(field.delta),
                        `${where}: ${field.text} um ${String(field.delta)} px`,
                    ).toBeLessThanOrEqual(0.5);
                }
                const [canon, by] = pill.fields;
                expect(canon?.weight, where).toBe("700");
                // Ohne die erlaubte Kunstfettung stünde 700 im Stil und gezeichnet würde dasselbe Regular.
                expect(canon?.synthesis, where).toBe("auto");
                if (by !== undefined) expect(by.weight, where).toBe("400");
            }
        }
    }
}
