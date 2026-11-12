import { expect, type Page } from "@playwright/test";
import {
    SUBJECT_API_BASE,
    SUBJECT_WETTER_SYMBOL_PFAD,
    WETTER_SYMBOL_VORGABEN,
    wetterSymbolTyp,
    wetterWikiAdresse,
    type SubjectDetail,
    type WetterSymbolDaten,
} from "@avesmaps3d/shared";
import { settleFrame } from "./map-handle.ts";
import { stubWetter, type WetterServer } from "./wetter-stub.ts";

/**
 * Das Infopanel der Wetter-Icons im Browser (WI-0288; Betreiber 2026-11-08: „ja infopanel bauen“): das Wetter mit Verweisen aus dem Nachbau (`wetter-stub.ts`) und die
 * Detailantwort `/api/subjects/wetter-symbol/{id}` in der Form des Servers (`apps/server/src/subjects/detail-wetter.ts`). 🔴 Nichts davon erreicht eine Datenbank; die
 * echte Antwort prüft `apps/server/test/wetter-infopanel.test.ts` auf einem Wegwerf-Cluster. Artikel und Texte sind erfunden.
 */

export interface ProbeArtikel {
    titel: string;
    /** Die Art, wie das Wiki sie nennt („Wind“, „Meeresströmung“, „Mahlstrom“). */
    art: string;
    region?: string;
    beschreibung?: string;
}

/** Die Lage in Kartenkoordinaten, wie der Server sie rechnet (z zählt nach Süden, y nach Norden). */
const kartenpunkt = (x: number, z: number): { x: number; y: number } => ({ x, y: 1024 - z });

/** Die Detailantwort eines Icons mit Verweis, wie der Server sie baut. */
export function wetterSymbolDetail(symbol: WetterSymbolDaten, artikel: ProbeArtikel): SubjectDetail {
    const url = wetterWikiAdresse(artikel.titel);
    const herkunft = { kind: "wiki" as const, wikiUrl: url };
    const facts: NonNullable<SubjectDetail["facts"]> = [
        ...(artikel.region === undefined
            ? []
            : [{ field: "regionParent" as const, value: artikel.region, provenance: herkunft }]),
        ...(artikel.beschreibung === undefined
            ? []
            : [{ field: "description" as const, value: artikel.beschreibung, provenance: herkunft }]),
    ];
    const mitte = kartenpunkt(symbol.x, symbol.z);
    return {
        subject: { kind: "wetterSymbol", id: symbol.id },
        revision: "0288e2e00000",
        title: symbol.name ?? artikel.titel,
        subtitle: [{ part: "type", key: wetterSymbolTyp(symbol.art, artikel.art) }],
        ...(facts.length === 0 ? {} : { facts }),
        wiki: {
            url,
            title: artikel.titel,
            corpus: { key: "wiki-aventurica.de", label: "Wiki Aventurica" },
            license: { name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" },
        },
        target: {
            x: mitte.x,
            y: mitte.y,
            zoom: 3,
            bounds: [
                mitte.x - symbol.reichweite,
                mitte.y - symbol.reichweite,
                mitte.x + symbol.reichweite,
                mitte.y + symbol.reichweite,
            ],
        },
    };
}

export interface WetterInfoServer extends WetterServer {
    /** Die Kennungen, deren Detail die Seite gefragt hat, in der Folge der Fragen. */
    readonly gefragt: string[];
}

/**
 * Wetter mit Wind und Meeresströmungen im Auge, die Icons aus den Vorgaben, `verweise` je Kennung ein Artikel. Jede schreibende Anfrage an `/api` endet im Browser (vorher
 * angemeldet, die Nachbauten danach gewinnen für ihre Wege).
 */
export async function stubWetterInfopanel(
    page: Page,
    verweise: Readonly<Record<string, ProbeArtikel>>,
): Promise<WetterInfoServer> {
    await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204, body: "" }),
    );
    await page.addInitScript(() => localStorage.setItem("avesmaps3d.wetter", "wind,stroemungen"));
    const server = await stubWetter(page, {
        verweise: Object.fromEntries(Object.entries(verweise).map(([id, artikel]) => [id, artikel.titel])),
    });
    const gefragt: string[] = [];
    await page.route(`**${SUBJECT_API_BASE}/${SUBJECT_WETTER_SYMBOL_PFAD}/*`, (route) => {
        const id = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
        gefragt.push(id);
        const symbol = WETTER_SYMBOL_VORGABEN.find((eins) => eins.id === id);
        const artikel = verweise[id];
        return symbol === undefined || artikel === undefined
            ? route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' })
            : route.fulfill({
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify(wetterSymbolDetail(symbol, artikel)),
              });
    });
    return { ...server, gefragt };
}

/** Die Kamera auf ein Icon (Weltkoordinaten des Wetters), flach. */
export async function zuIcon(page: Page, symbol: WetterSymbolDaten, zoom = 3.4): Promise<void> {
    await page.evaluate(
        ({ x, z, zoom }) => {
            const n = Math.PI * (1 - (2 * z) / 1024);
            const center = { lng: (x / 1024) * 360 - 180, lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI };
            globalThis.avesmapsMap!.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
        },
        { x: symbol.x, z: symbol.z, zoom },
    );
    await page.waitForFunction(() => globalThis.avesmapsMap!.loaded(), undefined, { timeout: 60_000 });
    await settleFrame(page);
}

/** Die Mitte der Scheibe eines Icons auf dem Schirm, sobald das Wetter es zeichnet. */
export async function iconMitte(page: Page, id: string): Promise<{ x: number; y: number }> {
    const scheibe = page.locator(`[data-wetter-icon="${id}"] .ws-scheibe`);
    await expect(scheibe).toBeVisible({ timeout: 120_000 });
    const box = (await scheibe.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
