import type { Page, Route } from "@playwright/test";
import { freeSpot, settleFrame } from "./map-handle.ts";
import {
    WETTER_PRESET_VORGABEN,
    WETTER_SYMBOL_VORGABEN,
    WETTER_WIKI_URL,
    istAngelegtePresetId,
    wetterNeuePresetWerte,
    wetterWikiAdresse,
    type OperationReceipt,
    type WetterDatenAntwort,
    type WetterPreset,
    type WetterPresetWerte,
    type WetterSymbol,
    type WetterWikiArtikel,
} from "@avesmaps3d/shared";

/**
 * Ein Nachbau der Wege des Wetters (WI-0288 Stufe 3; Routen `apps/server/src/routes/wetter.ts`) im Browser des Tests: Presets und Icons mit
 * Revisionen, Tausch der Zeitpunkte samt „unbestimmt“, Anlegen, Ändern, weiches Entfernen, 409 bei veralteter Revision; Presets anlegen und
 * (nur angelegte) entfernen. 🔴 Kein Test schreibt
 * in eine Datenbank; den echten Weg prüft `apps/server/test/wetter.test.ts` auf einem Wegwerf-Cluster.
 *
 * Die Wiki-Artikel für den Verweis am Icon (Stufe 6) antworten aus `wiki` (erfundene Titel); der Lesezugriff steht nicht in `aufrufe`, die nur Schreibendes zählen.
 */

const artikel = (titel: string, art: string, region?: string): WetterWikiArtikel => ({
    titel,
    art,
    ...(region === undefined ? {} : { region }),
    wikiUrl: wetterWikiAdresse(titel),
});

/** Erfundene Artikel, wie der Derographie-Zug sie führt: zwei Winde, eine Meeresströmung, ein Mahlstrom. */
export const WETTER_WIKI_PROBE: readonly WetterWikiArtikel[] = [
    artikel("Probewind (Wind)", "Wind", "Probeküste"),
    artikel("Probebrise", "Wind"),
    artikel("Probestrom", "Meeresströmung", "Probemeer"),
    artikel("Probestrudel", "Mahlstrom", "Probemeer"),
];

export interface WetterAufruf {
    readonly method: string;
    readonly path: string;
    readonly body: Record<string, unknown> | undefined;
}

export interface WetterServer {
    readonly aufrufe: WetterAufruf[];
    readonly stand: () => WetterDatenAntwort;
    /** Die nächste Änderung an diesem Preset oder Icon antwortet 409 (als hätte jemand anderes es geändert). */
    konfliktBei(id: string): void;
}

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function stubWetter(
    page: Page,
    optionen: {
        wiki?: readonly WetterWikiArtikel[];
        /** Verweise der Icons auf Wiki-Artikel schon zu Beginn, je Kennung der Titel (das Infopanel, WI-0288). */
        verweise?: Readonly<Record<string, string>>;
    } = {},
): Promise<WetterServer> {
    const presets: WetterPreset[] = WETTER_PRESET_VORGABEN.map((p) => ({ ...p, werte: { ...p.werte }, revision: 0 }));
    let symbole: WetterSymbol[] = WETTER_SYMBOL_VORGABEN.map((s) => ({
        ...s,
        ...(optionen.verweise?.[s.id] === undefined ? {} : { wikiTitel: optionen.verweise[s.id] }),
        revision: 0,
    }));
    const aufrufe: WetterAufruf[] = [];
    const konflikte = new Set<string>();
    let neu = 0;
    let angelegt = 0;
    const stand = (): WetterDatenAntwort => ({
        presets: presets.map((p) => ({ ...p, werte: { ...p.werte } })),
        symbole: symbole.map((s) => ({ ...s })),
        modell: { revision: null, werte: {}, verstellt: [] },
        quelle: { presets: "vorgabe", symbole: "vorgabe", modell: "vorgabe" },
    });
    const quittung = (affected: OperationReceipt["affected"]): OperationReceipt => ({
        operationId: "e2e",
        status: "applied",
        environment: "staging",
        affected,
        derivedWork: [],
        warnings: [],
    });
    const fehler = (route: Route, status: number, code: string): Promise<void> =>
        json(route, status, { error: { code, message: code } });

    await page.route("**/api/wetter", (route) => json(route, 200, stand()));
    await page.route("**/api/editor/wetter/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === "GET" && path === WETTER_WIKI_URL)
            return json(route, 200, { artikel: optionen.wiki ?? WETTER_WIKI_PROBE });
        const body = request.postDataJSON() as Record<string, unknown> | undefined;
        aufrufe.push({ method: request.method(), path, body });
        const teile = path.split("/").slice(4);
        // Ein Preset anlegen (Betreiber 2026-11-08): an einem freien Tag, mit den dort übergeblendeten Werten wie der Server.
        if (teile[0] === "presets" && teile[1] === undefined) {
            const tag = body?.["tag"] as number;
            if (presets.some((p) => p.tag === tag)) return fehler(route, 409, "tag_belegt");
            angelegt += 1;
            const id = `p-eneu${"abcdefghij"[angelegt % 10]!}`;
            const werte = { ...wetterNeuePresetWerte(presets as unknown as WetterPresetWerte[], tag) };
            presets.push({ id, tag, werte, revision: 1 });
            return json(route, 200, quittung([{ kind: "wetter_preset", id, revision: 1 }]));
        }
        if (teile[0] === "presets") {
            const preset = presets.find((p) => p.id === teile[1]);
            if (preset === undefined) return fehler(route, 404, "not_found");
            if (konflikte.delete(preset.id) || body?.["baseRevision"] !== preset.revision)
                return fehler(route, 409, "edit_conflict");
            if (teile[2] === "entfernen") {
                if (!istAngelegtePresetId(preset.id)) return fehler(route, 409, "vorgabe_bleibt");
                if (preset.tag === null) return fehler(route, 409, "unbestimmt_bleibt");
                presets.splice(presets.indexOf(preset), 1);
                return json(
                    route,
                    200,
                    quittung([{ kind: "wetter_preset", id: preset.id, revision: preset.revision + 1 }]),
                );
            }
            if (teile[2] === "zeitpunkt") {
                const ziel = body?.["tag"] as number | null;
                const dort = presets.find((p) => p !== preset && p.tag === ziel);
                if (dort === undefined && preset.tag === null) return fehler(route, 409, "unbestimmt_bleibt");
                const alt = preset.tag;
                preset.tag = ziel;
                preset.revision += 1;
                const affected = [{ kind: "wetter_preset", id: preset.id, revision: preset.revision }];
                if (dort !== undefined) {
                    dort.tag = alt;
                    dort.revision += 1;
                    affected.push({ kind: "wetter_preset", id: dort.id, revision: dort.revision });
                }
                return json(route, 200, quittung(affected));
            }
            Object.assign(preset.werte, body?.["werte"] as Record<string, number>);
            preset.revision += 1;
            return json(route, 200, quittung([{ kind: "wetter_preset", id: preset.id, revision: preset.revision }]));
        }
        if (teile[0] === "symbole" && teile[1] === undefined) {
            neu += 1;
            const felder = Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => k !== "operationId"));
            const symbol = {
                id: `0288e2e0-0000-4000-8000-${String(neu).padStart(12, "0")}`,
                name: null,
                nameZeigen: false,
                sichtbar: true,
                richtung: null,
                drehsinn: null,
                ...felder,
                revision: 1,
            } as WetterSymbol;
            symbole = [...symbole, symbol];
            return json(route, 200, quittung([{ kind: "wetter_symbol", id: symbol.id, revision: 1 }]));
        }
        const symbol = symbole.find((s) => s.id === teile[1]);
        if (symbol === undefined) return fehler(route, 404, "not_found");
        if (konflikte.delete(symbol.id) || body?.["baseRevision"] !== symbol.revision)
            return fehler(route, 409, "edit_conflict");
        symbol.revision += 1;
        if (teile[2] === "entfernen") symbole = symbole.filter((s) => s !== symbol);
        else Object.assign(symbol, body?.["aenderungen"] as Partial<WetterSymbol>);
        return json(route, 200, quittung([{ kind: "wetter_symbol", id: symbol.id, revision: symbol.revision }]));
    });
    return { aufrufe, stand, konfliktBei: (id) => konflikte.add(id) };
}

/**
 * Schiebt die Karte, bis die Scheibe des Icons auf einer freien Stelle der Karte liegt (`freeSpot`: kein Bedienelement, keine Trefferfläche darüber), und
 * gibt diese Stelle in Seitenkoordinaten zurück. 🪤 Der Flug aus der Liste setzt das Icon in die freie Mitte der Kamera; die rechnet den offenen Planer
 * links nicht mit, und ein Rechtsklick dort träfe den Planer statt der Karte.
 */
export async function iconAufFreieStelle(
    page: Page,
    id: string,
    von = { x: 420, y: 260 },
): Promise<{ x: number; y: number }> {
    const ziel = await freeSpot(page, von);
    await page.evaluate(
        ({ id, ziel }) => {
            const map = globalThis.avesmapsMap;
            const scheibe = document.querySelector(`[data-wetter-icon="${id}"] .ws-scheibe`);
            if (!map || !scheibe) throw new Error("Karte oder Icon fehlt");
            const rect = map.getCanvas().getBoundingClientRect();
            const box = scheibe.getBoundingClientRect();
            const dx = box.left + box.width / 2 - ziel.x;
            const dy = box.top + box.height / 2 - ziel.y;
            map.jumpTo({ center: map.unproject([rect.width / 2 + dx, rect.height / 2 + dy]) });
        },
        { id, ziel: { x: ziel.x, y: ziel.y } },
    );
    await settleFrame(page);
    return { x: ziel.x, y: ziel.y };
}
