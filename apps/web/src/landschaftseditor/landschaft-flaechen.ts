import {
    editorLandscapeBooleanPreviewUrl,
    editorLandscapeBooleanUrl,
    editorLandscapePartsUrl,
    editorLandscapeSplitUrl,
    editorLandscapeUrl,
    type EditorLandscapeDetail,
    type EditorLandscapeLayer,
    type LandscapeBooleanPreview,
    type LandscapeBrushBody,
    type LandscapePartsReceipt,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { aufbauAus } from "../map/geometrie/formoperation";
import type { FlaechenQuelle, FlaechenSofort, SofortAntwort, StrichAntwort } from "../map/geometrie/flaechen-quelle";
import type { EckenDaten } from "./ecken";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * Die Landschaft als Quelle der Werkzeuge der Form (`map/geometrie/flaechen-quelle.ts`): „Fläche vereinfachen“, „Verschieben“, „Fläche malen“ und
 * „Fläche radieren“ an der Derographie, so wie sie vor WI-0261 Stufe 2 fest verdrahtet waren.
 *
 * - **Lesen:** die Landschaft mit allen Teilflächen und die Andockziele um sie (`GET …/targets`): Nachbarn derselben Ebene und Stützpunkte der
 *   Flüsse. Wie viele Ringe jedes Polygon hat (eigene und Nachbarn), meldet das Lesen an die Art (`merkeAufbau`), denn „Fertig“ schreibt
 *   `landscape.update`, und die Nachbarn stehen nicht im gelesenen Stand.
 * - **Pinsel:** `POST …/landscapes/:id/brush` mit der Teilfläche im Körper.
 * - **Getragen:** solange das Fenster der Landschaft steht (D19); ohne Angabe immer. Seine Liste zieht ein, solange der Modus läuft.
 */
export interface LandschaftFlaechenOptionen {
    readonly daten: EckenDaten;
    /** Die sichtbaren Ebenen der Karte (für die Andockziele, aus denen die Nachbarn kommen). */
    ebenen(): readonly EditorLandscapeLayer[];
    /** Die Bearbeitung der Landschaft; öffnet ihr Fenster (D19). Ohne Schreibrecht keine: Dann beginnt nichts. */
    bearbeitung(regionId: string): LandschaftBearbeitung | undefined;
    /** Steht das Fenster dieser Landschaft sichtbar (angedockt oder gelöst)? Ohne Angabe immer. */
    getragen?(regionId: string): boolean;
    /** Ein Strich, gerechnet vom Server (`POST …/brush`); nur „Fläche malen“ und „Fläche radieren“ brauchen ihn. */
    strich?(regionId: string, body: LandscapeBrushBody): Promise<StrichAntwort>;
}

export function landschaftFlaechen(optionen: LandschaftFlaechenOptionen): FlaechenQuelle<LandschaftBearbeitung> {
    const { daten, strich } = optionen;
    return {
        bearbeitung: (regionId) => optionen.bearbeitung(regionId),
        async lade(regionId, bearbeitung, signal) {
            const [detail, ziele] = await Promise.all([
                daten.landschaft(regionId, signal),
                daten.ziele(regionId, optionen.ebenen(), signal),
            ]);
            if (detail === null || ziele === null) return null;
            bearbeitung.art.merkeAufbau(aufbauAus([...detail.areas, ...ziele.neighbors]));
            return {
                name: detail.name,
                flaechen: detail.areas,
                nachbarn: ziele.neighbors,
                fluesse: ziele.riverPoints.map((p) => ({ x: p.x, y: p.y })),
            };
        },
        ...(strich === undefined
            ? {}
            : { strich: (regionId, areaId, eingabe) => strich(regionId, { areaId, ...eingabe }) }),
        getragen: (regionId) => optionen.getragen?.(regionId) ?? true,
        werkzeug: "landschaftseditor",
        mitNachbarn: true,
    };
}

/**
 * Die Antwort des Servers: der Körper, oder sein Satz (sonst der Status). Der Server sendet Fehler als `{ error: { message } }`; vorher las der Helfer nur
 * `message` oben und zeigte darum „HTTP 400“ statt des Satzes (Befund WI-0261 Stufe 3, Editor-Orchestrierung 2026-10-31).
 */
async function json<T>(antwort: Response): Promise<SofortAntwort<T>> {
    const body = (await antwort.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
    return antwort.ok
        ? { ok: true, wert: body as T }
        : { ok: false, satz: body.error?.message ?? body.message ?? `HTTP ${String(antwort.status)}` };
}

/**
 * Die Landschaft als Quelle der sofort schreibenden Werkzeuge (`FlaechenSofort`, WI-0261 Stufe 3): „Unterflächen ›“, „Zerschneiden“ und „Mit anderer
 * Fläche ›“ an der Derographie, so wie sie vorher fest verdrahtet waren (`unterflaechen.ts`, `zerschneiden.ts`, `mit-anderer-flaeche.ts`): das Detail der
 * Landschaft lesen, `POST …/landscapes/:id/parts`, `split`, `boolean-preview`, `boolean` mit der Teilfläche im Körper; Ziele sind die gezeichneten Füllebenen
 * (`ebenen`), die oberste andere Teilfläche, nie eine für Klicks gesperrte. Ohne Verbindung wirft jeder Weg (die Werkzeuge sagen es). Was nach dem Schreiben
 * geschieht, gibt das Werkzeug dazu (`geschrieben`, je Werkzeug in `app.vue`).
 */
export function landschaftSofort(
    optionen: { fetcher?: typeof fetch | undefined; ebenen?: () => readonly string[] } = {},
): Omit<FlaechenSofort, "geschrieben"> {
    const fetcher = optionen.fetcher ?? ((url, init) => fetch(url, init));
    const sende = async <T>(url: string, body: unknown, signal?: AbortSignal): Promise<SofortAntwort<T>> =>
        json<T>(
            await fetcher(url, {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify(body),
                ...(signal === undefined ? {} : { signal }),
            }),
        );
    return {
        werkzeug: "landschaftseditor",
        async lies(regionId, areaId) {
            const d = await json<EditorLandscapeDetail>(
                await fetcher(editorLandscapeUrl(regionId), { headers: { accept: "application/json" } }),
            );
            if (!d.ok) return d;
            const teil = d.wert.areas.find((area) => area.id === areaId);
            return {
                ok: true,
                wert:
                    teil === undefined
                        ? undefined
                        : { name: d.wert.name, teile: teil.polygons, revision: teil.revision },
            };
        },
        teile: (regionId, areaId, body) =>
            sende<LandscapePartsReceipt>(editorLandscapePartsUrl(regionId), { ...body, areaId }),
        schneide: (regionId, areaId, body) =>
            sende<OperationReceipt>(editorLandscapeSplitUrl(regionId), { ...body, areaId }),
        vorschau: (regionId, areaId, body, signal) =>
            sende<LandscapeBooleanPreview>(editorLandscapeBooleanPreviewUrl(regionId), { ...body, areaId }, signal),
        verknuepfe: (regionId, areaId, body) =>
            sende<OperationReceipt>(editorLandscapeBooleanUrl(regionId), { ...body, areaId }),
        zielEbenen: () => optionen.ebenen?.() ?? [],
        ziel(features, areaId) {
            for (const feature of features) {
                const id = feature.properties["public_id"];
                if (typeof id === "string" && id !== areaId && feature.properties["is_locked"] !== true) return id;
            }
            return undefined;
        },
        vereinigtMitAnderen: false,
        saetze: {
            herausgeloest: "landschaftseditor.unterflaechen.herausgeloest",
            geschnitten: "landschaftseditor.zerschneiden.geschnitten",
        },
    };
}
