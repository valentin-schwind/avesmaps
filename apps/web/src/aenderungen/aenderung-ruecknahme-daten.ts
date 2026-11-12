import {
    editorKorpusRestoreSeriesPreviewUrl,
    editorKorpusRestoreSeriesUrl,
    editorLandscapeRestoreSeriesPreviewUrl,
    editorLandscapeRestoreSeriesUrl,
    editorNodixRestoreSeriesPreviewUrl,
    editorNodixRestoreSeriesUrl,
    editorPathRestoreSeriesPreviewUrl,
    editorPathRestoreSeriesUrl,
    editorPeakRestoreSeriesPreviewUrl,
    editorPeakRestoreSeriesUrl,
    editorPlaceRestoreSeriesPreviewUrl,
    editorPlaceRestoreSeriesUrl,
    editorPowerlineRestoreSeriesPreviewUrl,
    editorPowerlineRestoreSeriesUrl,
    editorQuelleRestoreSeriesPreviewUrl,
    editorQuelleRestoreSeriesUrl,
    editorSpracheRestoreSeriesPreviewUrl,
    editorSpracheRestoreSeriesUrl,
    editorUmwandlungRestoreSeriesPreviewUrl,
    editorUmwandlungRestoreSeriesUrl,
    editorTerritoryRestoreSeriesPreviewUrl,
    editorTerritoryRestoreSeriesUrl,
    editorVorkommenRestoreSeriesPreviewUrl,
    editorVorkommenRestoreSeriesUrl,
    editorWerkRestoreSeriesPreviewUrl,
    editorWerkRestoreSeriesUrl,
    editorWikiBoxRestoreSeriesPreviewUrl,
    editorWikiBoxRestoreSeriesUrl,
    editorWikiSyncEditRestoreSeriesPreviewUrl,
    editorWikiSyncEditRestoreSeriesUrl,
    editorWikiSyncRestoreSeriesPreviewUrl,
    editorWikiSyncRestoreSeriesUrl,
    type ApiErrorBody,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import { withConfirmation, type Need } from "../auth/bestaetigen";
import type { RuecknahmeZiel } from "./aenderung-ruecknahme";

/**
 * Was das Zurücknehmen vom Server liest und schreibt (WI-0265 B5c): die Vorprüfung (`POST …/restore-series/preview`, lesend) und die Rücknahme (`POST …/restore-series`,
 * EINE Operation für die ganze Serie). Je Familie eine Adresse (`aenderung-ruecknahme.ts`, `RuecknahmeZiel`); die Antworten stehen in
 * `packages/shared/src/editor-ruecknahme.ts` und im Fachvertrag C.2.
 *
 * Eine Antwort ist `ok` mit dem Ergebnis oder ein Fehler im Umschlag; ohne Verbindung kommt der eigene Fehler `network_error` mit Status 0 (die Rücknahme darf dann mit
 * DERSELBEN Kennung noch einmal gesendet werden: Der Server erkennt die Wiederholung, nichts wird doppelt geschrieben).
 */
export type ApiFehler = ApiErrorBody["error"];

export type Antwort<Q> =
    | { readonly ok: true; readonly wert: Q }
    | { readonly ok: false; readonly status: number; readonly fehler: ApiFehler };

export interface RuecknahmeDaten {
    vorschau(
        ziel: RuecknahmeZiel,
        body: RuecknahmeVorschauBody,
        signal?: AbortSignal,
    ): Promise<Antwort<RuecknahmePruefung>>;
    ruecknehmen(ziel: RuecknahmeZiel, body: RuecknahmeBody): Promise<Antwort<RuecknahmeReceipt>>;
}

/** Je Familie die Adresse; die Wiki-Box hängt zusätzlich an der Art der Box (`ziel.art`, WI-0265 B8d). */
type Adresse = (ziel: RuecknahmeZiel) => string;
const nurId =
    (url: (id: string) => string): Adresse =>
    (ziel) =>
        url(ziel.id);
const boxAdresse =
    (url: (art: NonNullable<RuecknahmeZiel["art"]>, id: string) => string): Adresse =>
    (ziel) =>
        url(ziel.art ?? "ort", ziel.id);
const VORSCHAU_URL: Readonly<Record<RuecknahmeZiel["familie"], Adresse>> = {
    landscape: nurId(editorLandscapeRestoreSeriesPreviewUrl),
    path: nurId(editorPathRestoreSeriesPreviewUrl),
    place: nurId(editorPlaceRestoreSeriesPreviewUrl),
    peak: nurId(editorPeakRestoreSeriesPreviewUrl),
    umwandlung: nurId(editorUmwandlungRestoreSeriesPreviewUrl),
    territory: nurId(editorTerritoryRestoreSeriesPreviewUrl),
    powerline: nurId(editorPowerlineRestoreSeriesPreviewUrl),
    nodix: nurId(editorNodixRestoreSeriesPreviewUrl),
    sprache: nurId(editorSpracheRestoreSeriesPreviewUrl),
    source: nurId(editorQuelleRestoreSeriesPreviewUrl),
    work: nurId(editorWerkRestoreSeriesPreviewUrl),
    corpus: nurId(editorKorpusRestoreSeriesPreviewUrl),
    lore: nurId(editorVorkommenRestoreSeriesPreviewUrl),
    wikibox: boxAdresse(editorWikiBoxRestoreSeriesPreviewUrl),
    wikisync: nurId(editorWikiSyncRestoreSeriesPreviewUrl),
    wikisyncschritt: nurId(editorWikiSyncEditRestoreSeriesPreviewUrl),
};
const RUECKNAHME_URL: Readonly<Record<RuecknahmeZiel["familie"], Adresse>> = {
    landscape: nurId(editorLandscapeRestoreSeriesUrl),
    path: nurId(editorPathRestoreSeriesUrl),
    place: nurId(editorPlaceRestoreSeriesUrl),
    peak: nurId(editorPeakRestoreSeriesUrl),
    umwandlung: nurId(editorUmwandlungRestoreSeriesUrl),
    territory: nurId(editorTerritoryRestoreSeriesUrl),
    powerline: nurId(editorPowerlineRestoreSeriesUrl),
    nodix: nurId(editorNodixRestoreSeriesUrl),
    sprache: nurId(editorSpracheRestoreSeriesUrl),
    source: nurId(editorQuelleRestoreSeriesUrl),
    work: nurId(editorWerkRestoreSeriesUrl),
    corpus: nurId(editorKorpusRestoreSeriesUrl),
    lore: nurId(editorVorkommenRestoreSeriesUrl),
    wikibox: boxAdresse(editorWikiBoxRestoreSeriesUrl),
    wikisync: nurId(editorWikiSyncRestoreSeriesUrl),
    wikisyncschritt: nurId(editorWikiSyncEditRestoreSeriesUrl),
};
export const vorschauUrl = (ziel: RuecknahmeZiel): string => VORSCHAU_URL[ziel.familie](ziel);
export const ruecknahmeUrl = (ziel: RuecknahmeZiel): string => RUECKNAHME_URL[ziel.familie](ziel);

async function sende<Q>(
    hole: typeof fetch,
    url: string,
    body: unknown,
    signal: AbortSignal | undefined,
): Promise<Antwort<Q>> {
    let antwort: Response;
    try {
        antwort = await hole(url, {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(body),
            ...(signal === undefined ? {} : { signal }),
        });
    } catch (fehler) {
        if (signal?.aborted) throw fehler;
        return { ok: false, status: 0, fehler: { code: "network_error", message: "Keine Verbindung zum Server." } };
    }
    if (antwort.ok) return { ok: true, wert: (await antwort.json()) as Q };
    const umschlag = (await antwort.json().catch(() => undefined)) as ApiErrorBody | undefined;
    return {
        ok: false,
        status: antwort.status,
        fehler: umschlag?.error ?? {
            code: "unknown_error",
            message: `Der Server antwortete ${String(antwort.status)}.`,
        },
    };
}

/**
 * Die Rücknahme des WikiSync verlangt einen frischen Passkey (`undo_wikisync_run`, wie in der Verwaltung): Fordert der Server ihn (`reauth_required`, `assurance_required`), fragt „Kurz bestätigen“ nach und
 * die Anfrage geht mit DERSELBEN Kennung noch einmal. Bricht die Person ab, bleibt die ursprüngliche Antwort des Servers.
 */
async function sendeMitBestaetigung(
    hole: typeof fetch,
    url: string,
    body: RuecknahmeBody,
    frage?: (need: Need) => Promise<boolean>,
): Promise<Antwort<RuecknahmeReceipt>> {
    const einmal = async (): Promise<Antwort<RuecknahmeReceipt>> => {
        const antwort = await sende<RuecknahmeReceipt>(hole, url, body, undefined);
        if (!antwort.ok && (antwort.fehler.code === "reauth_required" || antwort.fehler.code === "assurance_required"))
            throw new ApiFailure(antwort.status, antwort.fehler.code, antwort.fehler.message, antwort.fehler.details);
        return antwort;
    };
    try {
        return await withConfirmation(einmal, frage);
    } catch (fehler) {
        if (!(fehler instanceof ApiFailure)) throw fehler;
        return {
            ok: false,
            status: fehler.status,
            fehler: {
                code: fehler.code,
                message: fehler.message,
                ...(fehler.details === undefined ? {} : { details: fehler.details }),
            },
        };
    }
}

export function createRuecknahmeDaten(
    hole: typeof fetch = (eingabe, init) => fetch(eingabe, init),
    /** Die Rückfrage „Kurz bestätigen“; ohne Angabe die der Seite (`auth/bestaetigen.ts`). Nur Tests geben sie vor. */
    frage?: (need: Need) => Promise<boolean>,
): RuecknahmeDaten {
    return {
        vorschau: (ziel, body, signal) => sende<RuecknahmePruefung>(hole, vorschauUrl(ziel), body, signal),
        ruecknehmen: (ziel, body) =>
            ziel.familie === "wikisync" || ziel.familie === "wikisyncschritt"
                ? sendeMitBestaetigung(hole, ruecknahmeUrl(ziel), body, frage)
                : sende<RuecknahmeReceipt>(hole, ruecknahmeUrl(ziel), body, undefined),
    };
}
