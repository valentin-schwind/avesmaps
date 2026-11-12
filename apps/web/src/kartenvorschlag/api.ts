import {
    KARTENVORSCHLAG_SCHLUESSEL_KOPF,
    KARTENVORSCHLAG_STATUS_PFAD,
    KARTENVORSCHLAG_URL,
    type KartenvorschlagDateiAngenommen,
    type KartenvorschlagEingegangen,
    type KartenvorschlagEinreichung,
    type KartenvorschlagStand,
    type KartenvorschlagStatus,
    type KartenvorschlagZurueckziehen,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, postJson, putBytes, type Fetcher } from "../auth/api";
import { sperreBis } from "../community/api";
import type { MessageKey } from "../i18n/de";

/**
 * Die Besucherseite von „Karte vorschlagen“ (WI-0275 Stufe C; Server: `apps/server/src/routes/kartenvorschlag.ts`, Vertrag `packages/shared/src/kartenvorschlag.ts`). Alle Aufrufe gehen an dieselbe Herkunft
 * und im Umschlag der Fehler (ADR-0018): Die Oberfläche wählt ihren eigenen Satz nach dem Code und zeigt nie den Text des Servers. Gebaut wie `photobox/api.ts`.
 *
 * - 🔴 **Der Weg einer Datei hat zwei Schritte:** erst die Angaben (`sendeEinreichung`, JSON), dann die Bytes (`sendeDatei`, roher Rumpf bis 50 MiB). Der Schlüssel der Statusseite entsteht im Formular
 *   (`community/api.ts` `neuesFormular`) und geht nur im Rumpf beziehungsweise im Kopf `x-vorschlag-schluessel`, nie in einer Adresse.
 * - Die Statusseite fragt mit `POST`, auch wo sie nur liest, damit der Schlüssel in keiner Adresse steht.
 */

/** Nimmt dieser Server gerade Kartenvorschläge an? Eine fehlende Antwort ist ein Nein: Ein toter Knopf wäre schlimmer als ein Satz. */
export async function ladeStand(fetcher: Fetcher = fetch): Promise<boolean> {
    try {
        return (await getJson<KartenvorschlagStand>(`${KARTENVORSCHLAG_URL}/stand`, fetcher)).einreichen === true;
    } catch {
        return false;
    }
}

export const sendeEinreichung = (
    body: KartenvorschlagEinreichung,
    fetcher?: Fetcher,
): Promise<KartenvorschlagEingegangen> =>
    postJson<KartenvorschlagEingegangen>(`${KARTENVORSCHLAG_URL}/einreichungen`, body, fetcher);

/** Die Bytes der Datei (zweiter Schritt). Der Server prüft die Art aus den Bytes, nie aus dem Namen. */
export async function sendeDatei(
    schluessel: string,
    datei: Blob,
    fetcher?: Fetcher,
): Promise<KartenvorschlagDateiAngenommen> {
    return putBytes<KartenvorschlagDateiAngenommen>(
        `${KARTENVORSCHLAG_URL}/datei`,
        await datei.arrayBuffer(),
        { [KARTENVORSCHLAG_SCHLUESSEL_KOPF]: schluessel },
        fetcher,
    );
}

export const leseStatus = (schluessel: string, fetcher?: Fetcher): Promise<KartenvorschlagStatus> =>
    postJson<KartenvorschlagStatus>(`${KARTENVORSCHLAG_URL}/status`, { schluessel }, fetcher);

export const ziehZurueck = (body: KartenvorschlagZurueckziehen, fetcher?: Fetcher): Promise<KartenvorschlagStatus> =>
    postJson<KartenvorschlagStatus>(`${KARTENVORSCHLAG_URL}/status/zurueckziehen`, body, fetcher);

/** Die Adresse der Statusseite: der Schlüssel im Fragment, nie in der Suche (`KARTENVORSCHLAG_STATUS_PFAD`). */
export const vorschlagAdresse = (origin: string, schluessel: string): string =>
    `${origin}${KARTENVORSCHLAG_STATUS_PFAD}#${schluessel}`;

/**
 * Was schiefging, in der Sprache der Oberfläche (ADR-0018: der Fachcode, nie der Text des Servers).
 * - `netz`: nichts ist angekommen; der Text bleibt, erneutes Senden ist gefahrlos (dieselbe Kennung).
 * - `zu_viele`: die Drossel (429 `kartenvorschlag_rate`); `sperreBis` nennt die Uhrzeit.
 * - `pausiert`: der Schalter ist aus oder das Modul nicht eingerichtet (503).
 * - `nicht_gefunden`: kein Vorschlag zu diesem Schlüssel (404), derselbe Satz für „nie gewesen“ und „gelöscht“.
 * - `uebergang`: der Zustand erlaubt das nicht (mehr) (409 `kartenvorschlag_transition`).
 * - `schluessel_belegt`: der Link gehört schon zu einem Vorschlag (409): das Formular neu öffnen.
 * - `format`: die Datei ist kein JPEG, PNG, WebP oder PDF (415).
 * - `ungueltig`: die Angaben oder die Datei wurden nicht angenommen (422, 400, 413).
 * - `sonst`: alles Übrige.
 */
export type VorschlagFehlerArt =
    | "netz"
    | "zu_viele"
    | "pausiert"
    | "nicht_gefunden"
    | "uebergang"
    | "schluessel_belegt"
    | "format"
    | "ungueltig"
    | "sonst";

export function fehlerArt(fehler: unknown): VorschlagFehlerArt {
    if (!(fehler instanceof ApiFailure)) return "sonst";
    if (fehler.status === 0 || fehler.code === "network") return "netz";
    switch (fehler.code) {
        case "kartenvorschlag_rate":
            return "zu_viele";
        case "kartenvorschlag_unavailable":
            return "pausiert";
        case "kartenvorschlag_not_found":
            return "nicht_gefunden";
        case "kartenvorschlag_transition":
            return "uebergang";
        case "kartenvorschlag_key_used":
            return "schluessel_belegt";
        case "unsupported_media_type":
            return "format";
        case "kartenvorschlag_invalid":
        case "kartenvorschlag_too_large":
        case "validation_failed":
            return "ungueltig";
        default:
            if (fehler.status === 429) return "zu_viele";
            if (fehler.status === 503) return "pausiert";
            if (fehler.status === 415) return "format";
            if (fehler.status === 413 || fehler.status === 422) return "ungueltig";
            return "sonst";
    }
}

export const FEHLER_SATZ: Readonly<Record<VorschlagFehlerArt, MessageKey>> = {
    netz: "photobox.fehler.netz",
    zu_viele: "photobox.fehler.zuViele",
    pausiert: "kartenvorschlag.fehler.pausiert",
    nicht_gefunden: "kartenvorschlag.status.fehlt",
    uebergang: "kartenvorschlag.fehler.uebergang",
    schluessel_belegt: "kartenvorschlag.fehler.schluesselBelegt",
    format: "kartenvorschlag.fehler.format",
    ungueltig: "kartenvorschlag.fehler.ungueltig",
    sonst: "photobox.fehler.sonst",
};

export { sperreBis };
