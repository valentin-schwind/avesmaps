import {
    WETTER_PRESETS_URL,
    WETTER_SYMBOLE_URL,
    WETTER_URL,
    WETTER_WIKI_URL,
    wetterPresetEntfernenUrl,
    wetterPresetUrl,
    wetterPresetZeitpunktUrl,
    wetterSymbolEntfernenUrl,
    wetterSymbolUrl,
    type WetterDatenAntwort,
    type WetterSymbolAenderungen,
    type WetterSymbolAnlegenBody,
    type WetterWikiArtikel,
    type WetterWikiArtikelAntwort,
} from "@avesmaps3d/shared";
import { ApiFailure, newOperationId, type Fetcher } from "../auth/api";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";

/**
 * Der Weg des Wetter-Editors zum Server (WI-0288 Stufe 3; Vertrag `packages/shared/src/wetter/schnittstelle.ts`, Routen
 * `apps/server/src/routes/wetter.ts`). Gelesen wird derselbe öffentliche Weg wie von der Karte (`GET /api/wetter`), mit den Revisionen; jede
 * Handlung trägt eine eigene `operationId`, jede Änderung `baseRevision`. Schreiben antwortet im Umschlag (`entwurf-senden.ts`), damit der
 * Editor 409 und 423 sieht, statt zu werfen.
 */
export interface WetterEditorApi {
    lade(signal?: AbortSignal): Promise<WetterDatenAntwort>;
    presetWerte(id: string, baseRevision: number, werte: Readonly<Record<string, number>>): Promise<SchreibAntwort>;
    presetZeitpunkt(id: string, baseRevision: number, tag: number | null): Promise<SchreibAntwort>;
    /** Legt ein Preset an einem freien Tag an (Betreiber 2026-11-08); die Quittung nennt die neue Kennung. */
    presetAnlegen(tag: number): Promise<SchreibAntwort>;
    /** Entfernt ein angelegtes Preset (hart); die 14 festen und das unbestimmte lehnt der Server mit 409 ab. */
    presetEntfernen(id: string, baseRevision: number): Promise<SchreibAntwort>;
    symbolAnlegen(body: Omit<WetterSymbolAnlegenBody, "operationId">): Promise<SchreibAntwort>;
    symbolAendern(id: string, baseRevision: number, aenderungen: WetterSymbolAenderungen): Promise<SchreibAntwort>;
    symbolEntfernen(id: string, baseRevision: number): Promise<SchreibAntwort>;
    /** Die Winde, Meeresströmungen und Mahlströme des Derographie-Zugs, auf die ein Icon verweisen kann (Stufe 6); wirft ohne Antwort. */
    wikiArtikel(signal?: AbortSignal): Promise<readonly WetterWikiArtikel[]>;
}

export function createWetterEditorApi(fetcher: Fetcher = (eingabe, init) => fetch(eingabe, init)): WetterEditorApi {
    return {
        async lade(signal) {
            const antwort = await fetcher(WETTER_URL, {
                headers: { accept: "application/json" },
                cache: "no-cache",
                ...(signal === undefined ? {} : { signal }),
            });
            if (!antwort.ok)
                throw new ApiFailure(
                    antwort.status,
                    "wetter_unlesbar",
                    `Der Server antwortete ${String(antwort.status)}.`,
                );
            return (await antwort.json()) as WetterDatenAntwort;
        },
        presetWerte: (id, baseRevision, werte) =>
            sende(wetterPresetUrl(id), { operationId: newOperationId(), baseRevision, werte }, "PATCH", fetcher),
        presetZeitpunkt: (id, baseRevision, tag) =>
            sende(wetterPresetZeitpunktUrl(id), { operationId: newOperationId(), baseRevision, tag }, "POST", fetcher),
        presetAnlegen: (tag) => sende(WETTER_PRESETS_URL, { operationId: newOperationId(), tag }, "POST", fetcher),
        presetEntfernen: (id, baseRevision) =>
            sende(wetterPresetEntfernenUrl(id), { operationId: newOperationId(), baseRevision }, "POST", fetcher),
        symbolAnlegen: (body) => sende(WETTER_SYMBOLE_URL, { operationId: newOperationId(), ...body }, "POST", fetcher),
        symbolAendern: (id, baseRevision, aenderungen) =>
            sende(wetterSymbolUrl(id), { operationId: newOperationId(), baseRevision, aenderungen }, "PATCH", fetcher),
        symbolEntfernen: (id, baseRevision) =>
            sende(wetterSymbolEntfernenUrl(id), { operationId: newOperationId(), baseRevision }, "POST", fetcher),
        async wikiArtikel(signal) {
            const antwort = await fetcher(WETTER_WIKI_URL, {
                headers: { accept: "application/json" },
                credentials: "same-origin",
                cache: "no-cache",
                ...(signal === undefined ? {} : { signal }),
            });
            if (!antwort.ok)
                throw new ApiFailure(
                    antwort.status,
                    "wiki_unlesbar",
                    `Der Server antwortete ${String(antwort.status)}.`,
                );
            const body = (await antwort.json()) as Partial<WetterWikiArtikelAntwort>;
            return Array.isArray(body.artikel) ? body.artikel : [];
        },
    };
}
