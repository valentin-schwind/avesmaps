import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
import type { MediaCredit, MediaImageRelation, MediaPublicView } from "@avesmaps3d/shared";

/**
 * Gestellte Kopfbilder für die Browsertests des Bildbezugs (Betreiber 2026-10-11, `info-panel-bildbezug.spec.ts` und `.touch.spec.ts`).
 *
 * Gestellt wird NUR die Liste `media.header` der Detailantwort eines Ortes; Panel, Modell und Bauteil sind die echten, der Rest der
 * Antwort kommt vom laufenden Server. So hängt kein Test daran, welche Bilder der geteilte Entwicklungsstand gerade freigibt, und der
 * Bildbezug steht fest - auch solange der Server auf 3000 die Vorversion ohne das Feld fährt. Die Bilder selbst sind die Kopfgrafiken
 * aus `public/icons/header` (800 × 450), je Nummer eine andere; eine Nummer in `kaputt` antwortet 404 wie ein Asset ohne Bytes.
 */

export const GARETH = "80558060-4299-54aa-b520-814b10819885";
export const FASAR = "aed5f402-47d0-5a89-a7e2-c3f8a31e56c2";
/** Ein Weg mit Kopfgrafik der Art: Reichsstraße 3. */
export const REICHSSTRASSE = { kind: "path", chain: "Reichsstraße 3:Reichsstrasse" } as const;

const HEADER = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons", "header");
const MOTIVE = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "kueste", "insel", "see", "wald"];

const shaOf = (n: number): string =>
    createHash("sha256")
        .update(`bildbezug-${String(n)}`)
        .digest("hex");

/** Ein gestelltes Kopfbild, wie der Media Core es liefert. Ohne `relation`: eine Antwort der Vorversion. */
export function kopfbild(n: number, relation?: MediaImageRelation, credit?: MediaCredit): MediaPublicView {
    const sha = shaOf(n);
    return {
        id: `b11d0000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
        role: "header",
        url: `/media/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.webp`,
        width: 800,
        height: 450,
        mimeType: "image/webp",
        ...(credit === undefined ? {} : { credit }),
        ...(relation === undefined ? {} : { relation }),
    };
}

/** Beantwortet jede Medienadresse mit einer echten Datei; die gestellten Nummern je mit ihrem Motiv, `kaputt` mit 404. */
export async function bedieneBilder(page: Page, kaputt: readonly number[] = []): Promise<void> {
    const motiv = new Map<string, number>();
    for (let n = 0; n < 40; n += 1) motiv.set(shaOf(n), n);
    await page.route("**/media/sha256/**", async (route) => {
        const sha = /([0-9a-f]{64})\.webp$/.exec(route.request().url())?.[1] ?? "";
        const n = motiv.get(sha);
        if (n !== undefined && kaputt.includes(n)) {
            await route.fulfill({ status: 404, body: "" });
            return;
        }
        const name = MOTIVE[(n ?? 0) % MOTIVE.length]!;
        await route.fulfill({ status: 200, contentType: "image/webp", path: join(HEADER, `${name}.webp`) });
    });
}

/** Stellt `media.header` der Detailantwort des Ortes `id`; `null` nimmt alle Medien weg (dann gilt die Grafik der Art). */
export async function stelleKopf(page: Page, id: string, header: MediaPublicView[] | null): Promise<void> {
    await page.route(
        (url) => url.pathname === `/api/subjects/place/${id}`,
        async (route) => {
            const response = await route.fetch();
            const answer = (await response.json()) as Record<string, unknown>;
            const media = { ...((answer["media"] as Record<string, unknown> | undefined) ?? {}) };
            if (header === null) delete answer["media"];
            else answer["media"] = { ...media, header };
            await route.fulfill({ response, json: answer });
        },
    );
}

/** Öffnet einen Gegenstand über die Auswahl und wartet, bis der Kopf ein Bild (oder die Grafik) zeigt. */
export async function oeffne(page: Page, ref: Record<string, unknown>, titel: string): Promise<void> {
    await page.evaluate((subject) => globalThis.avesmapsOpenSubject?.(subject as never), ref);
    await expect(page.getByTestId("info-title")).toHaveText(titel, { timeout: 30_000 });
    await expect(page.getByTestId("info-header-image")).toBeVisible({ timeout: 30_000 });
    // Das Bild ist geladen (oder als kaputt herausgefallen): erst dann steht die Folge fest.
    await page.waitForFunction(
        () => {
            const image = document.querySelector<HTMLImageElement>("[data-testid=info-header-image]");
            return image !== null && image.complete && image.naturalWidth > 0;
        },
        undefined,
        { timeout: 30_000 },
    );
}

export interface Kasten {
    x: number;
    y: number;
    width: number;
    height: number;
}

export async function kasten(locator: Locator): Promise<Kasten> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("kein Kasten: Element nicht sichtbar");
    return box;
}

/** Überdecken sich zwei Kästen (mit einem Pixel Spielraum für Kantenrundung)? */
export const ueberdecken = (a: Kasten, b: Kasten): boolean =>
    a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** Die Hülle mehrerer Kästen (die Seitenmarken als eine Zeile). */
export function huelle(boxes: readonly Kasten[]): Kasten {
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    return { x, y, width: right - x, height: bottom - y };
}

/** Die Beschriftung sitzt im Bild, in seiner rechten unteren Ecke. */
export async function sitztUntenRechts(page: Page): Promise<{ medien: Kasten; plakette: Kasten }> {
    const medien = await kasten(page.getByTestId("info-media"));
    const plakette = await kasten(page.getByTestId("info-header-bildbezug"));
    expect(plakette.x).toBeGreaterThan(medien.x + medien.width / 2);
    expect(plakette.y).toBeGreaterThan(medien.y + medien.height / 2);
    expect(plakette.x + plakette.width).toBeLessThanOrEqual(medien.x + medien.width);
    expect(plakette.y + plakette.height).toBeLessThanOrEqual(medien.y + medien.height);
    // Nah an der Ecke: höchstens 16 px vom rechten und vom unteren Rand.
    expect(medien.x + medien.width - (plakette.x + plakette.width)).toBeLessThanOrEqual(16);
    expect(medien.y + medien.height - (plakette.y + plakette.height)).toBeLessThanOrEqual(16);
    return { medien, plakette };
}

/** Die Transformation des gezeigten Bildes (`none` oder eine Matrix). */
export const transformDesBildes = (page: Page): Promise<string> =>
    page.getByTestId("info-header-image").evaluate((node) => getComputedStyle(node).transform);
