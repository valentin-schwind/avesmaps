import { expect, type Page } from "@playwright/test";
import type { EditorPathRow, EditorPathStreet } from "@avesmaps3d/shared";
import { settleFrame } from "./map-handle.ts";

/**
 * Handgriffe der Browserfälle zur Mehrfachauswahl der Wege (WI-0252), geteilt von `wegeditor-mehrfach.spec.ts` (Stubs) und
 * `wegeditor-echt.spec.ts` (echter Server in der Wegwerf-Welt): Wo ein Weg gerade auf der Seite liegt, Umschalt- und Rechtsklick darauf,
 * die Wege der gezeichneten Kacheln als Liste und Straßen.
 */

export interface Stelle {
    readonly x: number;
    readonly y: number;
}
export interface Weg {
    readonly name: string;
    readonly stelle: Stelle;
    /** Wo die Stelle auf der Karte liegt (Länge und Breite der Darstellung): Nach einem Verschieben der Karte gilt sie weiter. */
    readonly ort?: { readonly lng: number; readonly lat: number };
}

/**
 * Wo ein Weg JETZT auf der Seite liegt: Die Kamera folgt einer neuen Auswahl (Hausregel „Kamera fliegt immer“), gemessene Pixel veralten
 * damit, und mit dem Zoom ändern sich die Trefferflächen. Gesucht wird darum frisch eine Stelle, an der nur er liegt; sonst sein Ort.
 */
export async function jetzt(page: Page, weg: Weg): Promise<Stelle> {
    const frisch = (await wegeDerKarte(page)).wege.find((w) => w.name === weg.name);
    if (frisch !== undefined) return frisch.stelle;
    if (weg.ort === undefined) return weg.stelle;
    return page.evaluate((ort) => {
        const map = globalThis.avesmapsMap!;
        const p = map.project(ort);
        const r = map.getCanvas().getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
    }, weg.ort);
}

/** Ein Klick mit gedrückter Umschalttaste, wie ihn ein Mensch macht, auf den Weg, wo er gerade liegt. */
export async function umschaltKlick(page: Page, weg: Weg): Promise<void> {
    const at = await jetzt(page, weg);
    await page.keyboard.down("Shift");
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up("Shift");
    await settleFrame(page);
}

/**
 * Stehen am Weg mehr Handgriffe, als flach passen (`FLACH_BIS`, mit der Mehrfachauswahl kommen „Auswahl zu neuem Weg“ und „Wege
 * verbinden“ dazu), stehen sie hinter EINEM Eintrag „Weg ›“: Ihn zeigen, damit sein Untermenü aufgeht.
 */
export async function handgriffeAuf(page: Page): Promise<void> {
    await expect(page.getByTestId("context-editor")).toBeVisible();
    const sammel = page.getByTestId("context-editor-path-handgriffe");
    if ((await sammel.count()) > 0) await sammel.hover();
}

/** Ein Rechtsklick auf den Weg, wo er gerade liegt. */
export async function rechtsKlick(page: Page, weg: Weg): Promise<void> {
    const at = await jetzt(page, weg);
    await page.mouse.click(at.x, at.y, { button: "right" });
}

/**
 * Die Wege der gezeichneten Kacheln als Liste und Straßen (wie `editorPathGroupKey`: ein Weg ist sein echter Name; ein Griff wie
 * „Pfad-3443“ oder ein leerer Name ist ein Weg für sich), dazu je Straße mit echtem Namen Stellen, an denen NUR sie liegt.
 */
export async function wegeDerKarte(
    page: Page,
): Promise<{ rows: EditorPathRow[]; strassen: EditorPathStreet[]; wege: Weg[]; leer: Stelle | undefined }> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getStyle(): { layers?: { id: string }[] };
            getCanvas(): HTMLCanvasElement;
            queryRenderedFeatures(
                punkt?: [number, number] | { layers: string[] },
                optionen?: { layers: string[] },
            ): { id?: string | number; properties: Record<string, unknown> }[];
        };
        const ebenen = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith("path-hit-"));
        const orte = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith("place-marker"));
        const schluessel = (p: Record<string, unknown>): { key: string; name: string; echt: boolean } => {
            const name = String(p["name"] ?? "").trim();
            const griff = name === "" || name === String(p["subtype"]) || /^\S+-\d+$/.test(name);
            return griff
                ? { key: `#${String(p["public_id"])}`, name, echt: false }
                : { key: `name:${name}`, name, echt: true };
        };
        const je = new Map<string, { name: string; subtype: string; ids: Set<string> }>();
        for (const f of map.queryRenderedFeatures({ layers: ebenen })) {
            const { key, name } = schluessel(f.properties);
            const eintrag = je.get(key) ?? { name, subtype: String(f.properties["subtype"]), ids: new Set<string>() };
            eintrag.ids.add(String(f.properties["public_id"]));
            je.set(key, eintrag);
        }
        const rows: EditorPathRow[] = [];
        const strassen: EditorPathStreet[] = [];
        for (const { name, subtype, ids } of je.values()) {
            const sortiert = [...ids].sort();
            rows.push({
                id: sortiert[0]!,
                name,
                subtype,
                isBach: false,
                circle: "halb-rechts",
                segments: sortiert.length,
            });
            strassen.push({
                id: sortiert[0]!,
                name,
                subtype,
                isBach: false,
                circle: "halb-rechts",
                labelVisible: true,
                segments: sortiert.map((id, i) => ({
                    id,
                    revision: 1,
                    labelVisible: i % 2 === 0,
                    wiki: false,
                    points: 2,
                    art: subtype,
                })),
            });
        }
        // Stellen, an denen die Karte obenauf liegt (nicht unter Planer oder Fenster), mit genau einem Weg und keinem Ort.
        const leinwand = map.getCanvas();
        const rahmen = leinwand.getBoundingClientRect();
        const stellen = new Map<string, { x: number; y: number; ort: { lng: number; lat: number } }>();
        let leer: { x: number; y: number } | undefined;
        for (let y = 140; y < rahmen.height - 120; y += 12)
            for (let x = 24; x < rahmen.width - 24; x += 12) {
                if (document.elementFromPoint(x, rahmen.top + y) !== leinwand) continue;
                if (map.queryRenderedFeatures([x - rahmen.left, y], { layers: orte }).length > 0) continue;
                // Eine Stelle ohne Weg in weitem Umkreis (die Trefferfläche ist breiter als die Linie): „ins Leere“.
                const umkreis: [[number, number], [number, number]] = [
                    [x - rahmen.left - 30, y - 30],
                    [x - rahmen.left + 30, y + 30],
                ];
                if (
                    leer === undefined &&
                    (map.queryRenderedFeatures as unknown as (b: unknown, o: { layers: string[] }) => unknown[])(
                        umkreis,
                        {
                            layers: [...ebenen, ...orte],
                        },
                    ).length === 0
                )
                    leer = { x, y: rahmen.top + y };
                // Nur ein Weg im weiten Umkreis: Der Besitzer der Wege wählt mit seinem Fangradius den nächsten, nicht den der Kachel
                // unter dem Punkt.
                const umfeld: [[number, number], [number, number]] = [
                    [x - rahmen.left - 14, y - 14],
                    [x - rahmen.left + 14, y + 14],
                ];
                if (
                    (map.queryRenderedFeatures as unknown as (b: unknown, o: { layers: string[] }) => unknown[])(
                        umfeld,
                        { layers: orte },
                    ).length > 0
                )
                    continue;
                const treffer = new Set(
                    (
                        map.queryRenderedFeatures as unknown as (
                            b: unknown,
                            o: { layers: string[] },
                        ) => { properties: Record<string, unknown> }[]
                    )(umfeld, { layers: ebenen }).map((f) => schluessel(f.properties).key),
                );
                const mitte = map
                    .queryRenderedFeatures([x - rahmen.left, y], { layers: ebenen })
                    .map((f) => schluessel(f.properties));
                const erster = mitte[0];
                if (
                    treffer.size !== 1 ||
                    erster === undefined ||
                    !erster.echt ||
                    !treffer.has(erster.key) ||
                    stellen.has(erster.key)
                )
                    continue;
                const ort = (
                    map as unknown as { unproject(p: [number, number]): { lng: number; lat: number } }
                ).unproject([x - rahmen.left, y]);
                stellen.set(erster.key, { x, y: rahmen.top + y, ort: { lng: ort.lng, lat: ort.lat } });
            }
        const wege = [...stellen].map(([key, { x, y, ort }]) => ({
            name: key.slice("name:".length),
            stelle: { x, y },
            ort,
        }));
        return { rows, strassen, wege, leer };
    });
}

/** Was nach einem gewöhnlichen Klick gewählt ist: die Kette des Wegs (`name:<Name>`), sonst nichts. */
export async function gewaehltNach(page: Page, weg: Weg): Promise<string | undefined> {
    const at = await jetzt(page, weg);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(500);
    await settleFrame(page);
    // Die Auswahl der Karte (golden), wie der Besitzer der Wege sie setzt; steht das Editorpanel vorn, zieht der Subject des Infopanels
    // nur im Hintergrund nach und ist kein verlässliches Zeichen.
    return page.evaluate(() => {
        const flaeche = globalThis.avesmapsAreaSelection?.();
        if (flaeche?.kind !== "path") return undefined;
        return flaeche.id.startsWith("name:") ? flaeche.id : `name:${flaeche.name ?? ""}`;
    });
}

export const abstand = (a: Stelle, b: Stelle): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Rückt die Mitte zweier Stellen in die Mitte der freien Kartenfläche, neben Planer und Fenster (über ihren Ort, nicht ihre Pixel). */
export async function rueckeInDieFreieMitte(page: Page, a: Weg, b: Weg): Promise<void> {
    if (a.ort === undefined || b.ort === undefined) return;
    await page.evaluate(
        async (orte) => {
            const map = globalThis.avesmapsMap!;
            const { top, right, bottom, left } = globalThis.avesmapsVisibleArea!.insets();
            const leinwand = map.getCanvas();
            const frei = {
                x: left + (leinwand.clientWidth - left - right) / 2,
                y: top + (leinwand.clientHeight - top - bottom) / 2,
            };
            const [pa, pb] = orte.map((o) => map.project(o));
            const ziel = { x: (pa!.x + pb!.x) / 2, y: (pa!.y + pb!.y) / 2 };
            const bildmitte = { x: leinwand.clientWidth / 2, y: leinwand.clientHeight / 2 };
            map.jumpTo({ center: map.unproject([bildmitte.x + ziel.x - frei.x, bildmitte.y + ziel.y - frei.y]) });
            await new Promise<void>((fertig) => {
                map.once("idle", () => fertig());
                setTimeout(fertig, 10_000);
            });
        },
        [a.ort, b.ort],
    );
    await settleFrame(page);
}
