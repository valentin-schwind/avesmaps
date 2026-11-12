import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import {
    GEBIRGS_PRESETS_VORGABE,
    type EditorGebirge,
    type EditorLandscapeDetail,
    type V12Input,
} from "@avesmaps3d/shared";
import { aufSeite, gebirgeKennung, type GebirgeStub } from "./gebirge-stub.ts";

/**
 * Ein Gebirge wie die Blutzinnen für die Bilder des Kammeditors mit Höhen (WI-0249 P9): Umriss, Gipfel, 28 Kämme und 18 Nebengipfel aus
 * der Rückennetz-Fixture der Servertests (`apps/server/test/fixtures/rueckennetz/blutzinnen.json`, Beispiele der Topographie). Die
 * Nebengipfel tragen ihre Höhen als eigene, die Kämme die Vorgabe; so stehen kräftige und blasse Zahlen nebeneinander.
 */
export const KAMMHOEHEN_BILDER = process.env["KAMMHOEHEN_BILDER"] ?? "test-results";

const GEBIRGE = "a5a5a5a5-0000-4000-8000-000000000201";
const FLAECHE = "a5a5a5a5-0000-4000-8000-0000000002a1";

export function blutzinnenStub(): GebirgeStub {
    const fall = JSON.parse(
        readFileSync(resolve(import.meta.dirname, "../../server/test/fixtures/rueckennetz/blutzinnen.json"), "utf8"),
    ) as { input: V12Input };
    const input = fall.input;
    const geometrie = input.geometry as { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
    const polygone = (
        geometrie.type === "Polygon"
            ? [geometrie.coordinates as [number, number][][]]
            : (geometrie.coordinates as [number, number][][][])
    ).map((polygon) => polygon.map((ring) => ring.slice(0, -1)));
    const stand: EditorGebirge["stand"] = {
        typ: null,
        muster: null,
        kammhoehe: Number(input.regler.maximalhoehe),
        werte: {},
        modell: {},
        netz: {
            kaemme: (input.kaemme ?? []).map((k) => ({ punkte: k.punkte, rang: k.rang })),
            nebengipfel: (input.nebengipfel ?? []).map((n) => ({ x: n.x, y: n.y, h: n.h ?? null })),
        },
        revision: 1,
    };
    const detail: EditorLandscapeDetail = {
        id: GEBIRGE,
        name: "Blutzinnen",
        layer: "topographie",
        type: "gebirge",
        circle: "halb-rechts",
        order: 10,
        clickLocked: false,
        areas: [{ id: FLAECHE, polygons: polygone, affectsPaths: true, revision: 1, gebirge: stand }],
        labels: [],
        neighbors: [],
        peaks: input.peaks.map((p, i) => ({
            id: `a5a5a5a5-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`,
            name: `Zinne ${String(i + 1)}`,
            subtype: "berggipfel" as const,
            ...(p.h === null ? {} : { height: p.h }),
            position: [p.x, p.y] as [number, number],
            revision: 1,
        })),
        revision: 1,
    };
    const { regler: _regler, kaemme: _kaemme, nebengipfel: _neben, ...eingabe } = input;
    void _regler;
    void _kaemme;
    void _neben;
    const gelesen: EditorGebirge = {
        area: FLAECHE,
        eingabe: eingabe as EditorGebirge["eingabe"],
        stand,
        grundhoehe: null,
        presets: { quelle: "vorgabe", fassung: 18, gruppe: GEBIRGS_PRESETS_VORGABE },
    };
    return { detail, gelesen };
}

/**
 * 🪤 Am Telefon decken das offene Editorpanel (volle Höhe) und das angedockte Landschaftsfenster im Modus „Kämme zeichnen“ Karte und
 * Leiste: Das Fenster klappt nicht ein wie der Ortseditor (`eingeklappt`, WI-0128 E12), das Panel bleibt vorn. Das ist älter als P9 und
 * offen gemeldet; für die Geste und das Bild stehen beide hier aus dem Weg.
 */
export async function fensterAusDemWeg(page: Page): Promise<void> {
    await page.evaluate(() => {
        const weg = [
            document.querySelector('[data-testid^="landschaftseditor-fenster-"][data-lage]'),
            document.querySelector('[data-testid="editor-panel"]')?.closest(".editor-panel"),
        ];
        for (const teil of weg) if (teil instanceof HTMLElement) teil.style.display = "none";
    });
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving()), { timeout: 15_000 }).toBe(false);
}

/**
 * Der Kammeditor mit Höhen im Bild: „Kämme zeichnen“, Höhen beschriften, drei Punkte mit Umschalt gewählt, ↕ an und ein Zug mitten in der
 * Bewegung (der Zeiger hält, die gezogenen Zahlen stehen live). Am Ende bricht Esc den Zug ab. `telefon`: das Fenster aus dem Weg.
 */
export async function zeigeKammhoehen(page: Page, pfad: string, telefon = false): Promise<void> {
    await page.getByRole("tab", { name: "Gebirge" }).click();
    await gebirgeKennung(page, "-kaemme-zeichnen").click();
    await expect(page.getByTestId("kamm-netz-leiste")).toBeVisible();
    if (telefon) await fensterAusDemWeg(page);
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving()), { timeout: 15_000 }).toBe(false);
    // Das ganze Gebirge im Bild (⌖), dann Höhen beschriften.
    await page.getByTestId("kamm-netz-ganz").click();
    await expect.poll(() => page.evaluate(() => globalThis.avesmapsMap!.isMoving()), { timeout: 15_000 }).toBe(false);
    await page.getByTestId("kamm-netz-hoehen-zeigen").click();
    await page.getByTestId("kamm-netz-werkzeug-waehlen").click();
    // Drei Nebengipfel in der Mitte des Gebirges, mit Umschalt gewählt.
    for (const [i, p] of [
        { x: 445.23, y: 694.08 },
        { x: 447.5, y: 691.49 },
        { x: 450.41, y: 688.25 },
    ].entries()) {
        const at = await aufSeite(page, p);
        if (i > 0) await page.keyboard.down("Shift");
        await page.mouse.click(at.x, at.y);
        if (i > 0) await page.keyboard.up("Shift");
    }
    await page.getByTestId("kamm-netz-hoehe-ziehen").click();
    const leinwand = (await page.evaluate(() => {
        const r = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
        return { x: r.left + r.width * 0.35, y: r.top + r.height * 0.6 };
    })) as { x: number; y: number };
    await page.mouse.move(leinwand.x, leinwand.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(leinwand.x, leinwand.y - i * 6);
    await page.screenshot({ path: pfad });
    await page.keyboard.press("Escape");
    await page.mouse.up();
}
