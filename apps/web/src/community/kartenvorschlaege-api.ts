import {
    KARTENVORSCHLAG_REDAKTION_URL,
    kartenvorschlagRedaktionUrl,
    type KartenvorschlagDetail,
    type KartenvorschlagListe,
    type KartenvorschlagSegment,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import type { MessageKey } from "../i18n/de";

/**
 * Die Redaktion der Kartenvorschläge an der Leitung (WI-0275; Server: `apps/server/src/routes/kartenvorschlag.ts`, Vertrag `packages/shared/src/kartenvorschlag.ts`). Lesen: die Liste und ein Vorschlag. Schritte: je ein Aufruf
 * mit der Revision, die die Person gesehen hat; ein veralteter Stand ist `kartenvorschlag_conflict`, nie ein stilles Überschreiben.
 *
 * - 🔴 **Eine Kennung je Handlung** (ADR-0019): Derselbe Schritt am selben Vorschlag schickt dieselbe `operationId`, bis er gelungen ist oder der Server ihn abgelehnt hat. Ein erneutes Senden nach einem Netzfehler legt nie zwei
 *   Karten an.
 * - Der Fehler kommt als Fachcode, die Oberfläche wählt ihren Satz (`SCHRITT_SATZ`), nie den Text des Servers.
 */

export interface VorschlagsFrage {
    readonly segment: KartenvorschlagSegment;
    readonly q?: string | undefined;
    /** Die Marke der vorigen Seite (`naechste`). */
    readonly nach?: number | undefined;
    /** Weniger als die 50 der Vorgabe (1 bis 100): Wer nur die Zähler braucht, holt eine Zeile. */
    readonly limit?: number | undefined;
}

export function ladeVorschlaege(frage: VorschlagsFrage, fetcher?: Fetcher): Promise<KartenvorschlagListe> {
    const parameter = new URLSearchParams({ segment: frage.segment });
    const q = frage.q?.trim() ?? "";
    if (q !== "") parameter.set("q", q.slice(0, 100));
    if (frage.nach !== undefined) parameter.set("nach", String(frage.nach));
    if (frage.limit !== undefined) parameter.set("limit", String(frage.limit));
    return getJson<KartenvorschlagListe>(`${KARTENVORSCHLAG_REDAKTION_URL}?${parameter.toString()}`, fetcher);
}

export const ladeVorschlag = (id: string, fetcher?: Fetcher): Promise<KartenvorschlagDetail> =>
    getJson<KartenvorschlagDetail>(kartenvorschlagRedaktionUrl(id), fetcher);

type Schritt = "annehmen" | "ablehnen";

/** Die Kennungen der Handlungen, die noch keinen Abschluss haben. */
const offeneKennungen = new Map<string, string>();

function kennung(id: string, schritt: Schritt): string {
    const schluessel = `${id}/${schritt}`;
    let wert = offeneKennungen.get(schluessel);
    if (wert === undefined) {
        wert = newOperationId();
        offeneKennungen.set(schluessel, wert);
    }
    return wert;
}

/** Führt einen Schritt aus. Ein Netzfehler lässt die Kennung stehen (das erneute Senden ist gefahrlos), jede andere Antwort gibt sie frei. */
async function fuehreAus(
    id: string,
    schritt: Schritt,
    body: Record<string, unknown>,
    fetcher?: Fetcher,
): Promise<KartenvorschlagDetail> {
    try {
        const antwort = await postJson<KartenvorschlagDetail>(
            `${kartenvorschlagRedaktionUrl(id)}/${schritt}`,
            { operationId: kennung(id, schritt), ...body },
            fetcher,
        );
        offeneKennungen.delete(`${id}/${schritt}`);
        return antwort;
    } catch (fehler) {
        if (schrittFehler(fehler) !== "netz") offeneKennungen.delete(`${id}/${schritt}`);
        throw fehler;
    }
}

/**
 * Was das Blatt „Annehmen“ wählt: ein neuer Eintrag mit dem Ort aus dem Blatt (`null` heißt ausdrücklich keiner), oder (WI-0287 Stufe 2) eine weitere Version eines vorhandenen
 * Eintrags mit ihrer Bezeichnung; der Ort gilt dann nicht.
 */
export type AnnahmeWahl = { readonly ort: string | null } | { readonly ziel: string; readonly version: string | null };

export const annehme = (
    id: string,
    baseRevision: number,
    wahl: AnnahmeWahl,
    fetcher?: Fetcher,
): Promise<KartenvorschlagDetail> =>
    fuehreAus(
        id,
        "annehmen",
        "ziel" in wahl
            ? { baseRevision, targetId: wahl.ziel, versionLabel: wahl.version }
            : { baseRevision, placeId: wahl.ort },
        fetcher,
    );

export const lehneAb = (
    id: string,
    baseRevision: number,
    grund: string,
    fetcher?: Fetcher,
): Promise<KartenvorschlagDetail> => {
    const text = grund.trim();
    return fuehreAus(id, "ablehnen", { baseRevision, ...(text === "" ? {} : { grund: text }) }, fetcher);
};

/** Fehlt auf dieser Instanz die Tafel oder das Recht (503)? Dann steht ein ruhiger Hinweis statt der Liste. */
export const nichtEingerichtet = (fehler: unknown): boolean =>
    fehler instanceof ApiFailure && fehler.code === "kartenvorschlag_unavailable";

export type SchrittFehler = "konflikt" | "uebergang" | "gesperrt" | "import" | "ort" | "ziel" | "netz" | "sonst";

export function schrittFehler(fehler: unknown): SchrittFehler {
    if (!(fehler instanceof ApiFailure)) return "sonst";
    if (fehler.status === 0 || fehler.code === "network") return "netz";
    switch (fehler.code) {
        case "kartenvorschlag_conflict":
            return "konflikt";
        case "kartenvorschlag_transition":
        case "kartenvorschlag_not_found":
            return "uebergang";
        case "kartenvorschlag_invalid":
            return "ort";
        // Der Eintrag, zu dem die Version gehören soll, ist inzwischen stillgelegt oder fort (WI-0287 Stufe 2).
        case "citymap_target_retired":
        case "not_found":
            return "ziel";
        case "map_import_running":
            return "import";
        default:
            return fehler.status === 423 ? "gesperrt" : "sonst";
    }
}

export const SCHRITT_SATZ: Readonly<Record<SchrittFehler, MessageKey>> = {
    konflikt: "kartenvorschlag.redaktion.fehler.konflikt",
    uebergang: "kartenvorschlag.redaktion.fehler.uebergang",
    gesperrt: "kartenvorschlag.redaktion.fehler.gesperrt",
    import: "kartenvorschlag.redaktion.fehler.import",
    ort: "kartenvorschlag.redaktion.fehler.ort",
    ziel: "kartenvorschlag.redaktion.fehler.ziel",
    netz: "kartenvorschlag.redaktion.fehler.netz",
    sonst: "kartenvorschlag.redaktion.fehler.sonst",
};
