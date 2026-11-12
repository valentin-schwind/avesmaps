import { shallowRef, type ShallowRef } from "vue";
import {
    EDITOR_PLACE_TEXT_FIELDS,
    PLACE_SAMMEL_MAX,
    PLACE_WIKI_FIELDS,
    type EditorPlaceDetail,
    type OperationReceipt,
    type PlaceDeleteManyBody,
    type PlaceRemoval,
    type PlaceSammelBody,
    type PlaceWikiField,
} from "@avesmaps3d/shared";
import { createSammelEntwurf, type SammelEntwurf } from "../fenster/sammel";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import { t } from "../i18n/i18n";
import { eigenerWert, entwurfAus, groesseZeile, nameZeile } from "./entwurf";

/**
 * Die Mehrfachauswahl der Ortsliste (WI-0237, EDIT-0003 T57; Bauteile `fenster/sammel.ts`, `editor-liste/editor-liste.vue`): Was für
 * mehrere Orte zugleich geht. Gemeinsam sind bei den Orten zunächst nur „Entfernen …“ (Ganz löschen) und ↺ auf Wiki-Werte (Vorschlag der
 * Orchestrierung in T57: „Orte und Kraftlinien zunächst nur „Entfernen …“ und ↺“); alle anderen Felder stehen mit „Nur einzeln“ da,
 * „Ort verschieben“ und die übrigen Reiter grau.
 *
 * - Die Werte der Felder (gleich oder gemischt) und die Revisionen, gegen die geschrieben wird, liest die Ansicht je Ort über denselben
 *   Weg wie das Fenster eines Orts (`GET /api/editor/places/:id`), höchstens `PLACE_SAMMEL_MAX` Orte, `GLEICHZEITIG` auf einmal.
 * - ↺ ist ein Schritt im Sammel-Entwurf; „Speichern“ schreibt `place.sammel` als EINE Operation. „Entfernen …“ schreibt sofort nach
 *   der Rückfrage `place.delete` für alle; ↺ unter „Änderungen“ holt jeden Ort einzeln zurück.
 */

/** So viele Orte liest die Ansicht zugleich. */
export const GLEICHZEITIG = 6;

/** Was die Ansicht vom Server braucht: lesen wie das Fenster eines Orts, dazu die beiden Sammelwege. */
export interface SammelApi {
    ort(publicId: string, signal: AbortSignal): Promise<EditorPlaceDetail | null>;
    entfernenVorschau(publicId: string, signal: AbortSignal): Promise<PlaceRemoval | null>;
    sammle(body: PlaceSammelBody): Promise<SchreibAntwort<OperationReceipt>>;
    loescheAlle(body: PlaceDeleteManyBody): Promise<SchreibAntwort<OperationReceipt>>;
}

/** Je Eintrag `arbeit`, höchstens `zugleich` auf einmal; die Reihenfolge der Ergebnisse folgt den Einträgen. */
export async function nacheinander<E, R>(
    eintraege: readonly E[],
    arbeit: (eintrag: E) => Promise<R>,
    zugleich = GLEICHZEITIG,
): Promise<R[]> {
    const raus: R[] = new Array<R>(eintraege.length);
    let naechster = 0;
    const laeufer = async (): Promise<void> => {
        while (naechster < eintraege.length) {
            const i = naechster;
            naechster += 1;
            raus[i] = await arbeit(eintraege[i]!);
        }
    };
    await Promise.all(Array.from({ length: Math.min(zugleich, eintraege.length) }, laeufer));
    return raus;
}

/** Hat der Ort in diesem Feld einen eigenen Wert, den ↺ auf den Wiki-Wert setzen würde (wie einzeln, `entwurf.ts`)? */
export function eigenerWikiWert(detail: EditorPlaceDetail, feld: PlaceWikiField): boolean {
    const entwurf = entwurfAus(detail);
    if (feld === "name") return nameZeile(detail, entwurf).zurueck;
    if (feld === "subtype") return groesseZeile(detail, entwurf, String).zurueck;
    return eigenerWert(detail, entwurf, feld);
}

/** Je Wiki-Feld: wie viele der gewählten Orte dort einen eigenen Wert haben. */
export function eigeneJeFeld(details: readonly EditorPlaceDetail[]): Record<PlaceWikiField, number> {
    return Object.fromEntries(
        PLACE_WIKI_FIELDS.map((feld) => [feld, details.filter((detail) => eigenerWikiWert(detail, feld)).length]),
    ) as Record<PlaceWikiField, number>;
}

/** Der Wert eines Felds an einem Ort, wie das Fenster eines Orts ihn zeigt: ohne eigenen Wert der des Wiki (`entwurfAus`). */
export function feldWert(detail: EditorPlaceDetail, feld: PlaceWikiField | "kind"): string {
    if (feld === "name") return detail.name;
    if (feld === "subtype") return detail.subtype;
    if (feld === "kind") return detail.kind ?? "";
    return detail.fields[feld].value ?? detail.fields[feld].wiki ?? "";
}

/** Gemeinsame Felder gibt es bei den Orten noch keine (T57); geschrieben wird allein ↺. */
export type OrtSammelFelder = Record<string, never>;

export interface OrtSammel {
    /** Die Kennungen der gewählten Orte, in Listenreihenfolge. */
    readonly ids: readonly string[];
    /** Die gelesenen Orte; fehlt einer, ist er noch nicht da oder gibt es ihn nicht mehr. */
    readonly details: Readonly<ShallowRef<ReadonlyMap<string, EditorPlaceDetail>>>;
    readonly laedt: Readonly<ShallowRef<boolean>>;
    readonly entwurf: SammelEntwurf<OrtSammelFelder>;
    /** Alle neu lesen (nach dem Schreiben). */
    lies(): Promise<void>;
    destroy(): void;
}

/** Die Sammelansicht für diese Orte; ein Wechsel der Auswahl beginnt eine neue (der Entwurf ist flüchtig, `sammel.ts`). */
export function createOrtSammel(
    api: SammelApi,
    ids: readonly string[],
    optionen: { geschrieben?: (quittung: OperationReceipt) => void; neueKennung?: () => string } = {},
): OrtSammel {
    const details = shallowRef<ReadonlyMap<string, EditorPlaceDetail>>(new Map());
    const laedt = shallowRef(false);
    let steuerung: AbortController | undefined;
    async function lies(): Promise<void> {
        steuerung?.abort();
        const jetzt = new AbortController();
        steuerung = jetzt;
        laedt.value = true;
        const gelesen = await nacheinander(ids.slice(0, PLACE_SAMMEL_MAX), (id) =>
            api.ort(id, jetzt.signal).catch(() => null),
        );
        if (jetzt.signal.aborted) return;
        details.value = new Map(gelesen.flatMap((detail) => (detail === null ? [] : [[detail.publicId, detail]])));
        laedt.value = false;
    }
    const entwurf = createSammelEntwurf<OrtSammelFelder>(
        {
            schreibe: (_ids, aenderungen, operationId) =>
                api.sammle({
                    operationId,
                    orte: [...details.value.values()].map((detail) => ({
                        id: detail.publicId,
                        baseRevision: detail.revision,
                    })),
                    wiki: aenderungen.wiki.filter((feld): feld is PlaceWikiField =>
                        (PLACE_WIKI_FIELDS as readonly string[]).includes(feld),
                    ),
                }),
        },
        ids,
        {
            ...(optionen.neueKennung === undefined ? {} : { neueKennung: optionen.neueKennung }),
            geschrieben: (quittung) => {
                optionen.geschrieben?.(quittung);
                void lies();
            },
        },
    );
    void lies();
    return { ids, details, laedt, entwurf, lies, destroy: () => steuerung?.abort() };
}

/** Was das Blatt „Entfernen …“ für mehrere zeigt (wie `ort-entfernen.ts` für einen). */
export interface SammelEntfernenStand {
    /** Orte, die das Löschen sperren, mit Grund; dann geht der Knopf nicht. */
    readonly gesperrt: readonly { readonly name: string; readonly grund: string }[];
    readonly staetten: number;
    readonly wegenden: number;
    /** Gebiete, deren Hauptstadt oder Sitz einer der Orte ist. */
    readonly gebiete: readonly string[];
    readonly aufDerKarte: number;
}

export function sammelEntfernenStand(vorschauen: readonly PlaceRemoval[]): SammelEntfernenStand {
    const gesperrt: { name: string; grund: string }[] = [];
    for (const ort of vorschauen) {
        if (ort.kraftlinien.length > 0)
            gesperrt.push({ name: ort.name, grund: t("ortseditor.sammel.entfernen.grund.kraftlinie") });
        else if (ort.innerortsVon !== undefined)
            gesperrt.push({
                name: ort.name,
                grund: t("ortseditor.sammel.entfernen.grund.innerorts", { stadt: ort.innerortsVon }),
            });
    }
    return {
        gesperrt,
        staetten: vorschauen.reduce((summe, ort) => summe + ort.staetten.length, 0),
        wegenden: vorschauen.reduce((summe, ort) => summe + ort.wegenden.length, 0),
        gebiete: [...new Set(vorschauen.flatMap((ort) => ort.gebiete.map((gebiet) => gebiet.name)))],
        aufDerKarte: vorschauen.filter((ort) => ort.onMap).length,
    };
}

/** Die Text-Felder in der Reihenfolge des Kastens „Identität“. */
export const SAMMEL_TEXTFELDER = EDITOR_PLACE_TEXT_FIELDS;
