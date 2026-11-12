import {
    PHOTOBOX_URL,
    REISEBILD_STATUS_PFAD,
    type PhotoboxBeschreibung,
    type PhotoboxBildErsetzen,
    type PhotoboxEingegangen,
    type PhotoboxEinreichung,
    type PhotoboxNutzung,
    type PhotoboxOffline,
    type PhotoboxStand,
    type PhotoboxStatus,
    type PhotoboxZurueckziehen,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, postJson, type Fetcher } from "../auth/api";
import { sperreBis } from "../community/api";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { genauerGrund } from "../system/ablehnung";
import { BESUCHER_ABBILDUNG } from "./ablehnung";

/**
 * Die Besucherseite der Reisebilder (WI-0272 S2b; Server: `apps/server/src/routes/photobox.ts`, Vertrag `packages/shared/src/photobox.ts`). Alle Aufrufe gehen an dieselbe Herkunft
 * und im Umschlag der Fehler (ADR-0018): Die Oberfläche wählt ihren eigenen Satz nach dem Code und zeigt nie den Text des Servers.
 *
 * - 🔴 **Der Schlüssel der Statusseite entsteht im Formular** (`community/api.ts` `neuesFormular`: 32 Zufallsbytes, base64url) und geht nur im Rumpf: nie in einer Adresse, nie in
 *   einem Log. Die Statusseite fragt mit `POST`, auch wo sie nur liest, damit er in keiner Adresse steht.
 * - 🔴 **Die Vorschau ist ein Bild als Antwort auf ein `POST`** (`…/status/vorschau`, `image/webp`): Sie kommt als `Blob`, die Seite macht daraus eine Adresse nur für sich selbst
 *   (`URL.createObjectURL`) und gibt sie beim Schließen frei.
 * - Eine Aktion der Statusseite antwortet mit dem neuen Stand; die Seite braucht keine zweite Anfrage.
 */

/** Nimmt dieser Server gerade neue Reisebilder an? Eine fehlende Antwort ist ein Nein: Ein toter Knopf wäre schlimmer als ein Satz. */
export async function ladeStand(fetcher: Fetcher = fetch): Promise<boolean> {
    try {
        return (await getJson<PhotoboxStand>(`${PHOTOBOX_URL}/stand`, fetcher)).einreichen === true;
    } catch {
        return false;
    }
}

export const sendeEinreichung = (body: PhotoboxEinreichung, fetcher?: Fetcher): Promise<PhotoboxEingegangen> =>
    postJson<PhotoboxEingegangen>(`${PHOTOBOX_URL}/einreichungen`, body, fetcher);

export const leseStatus = (schluessel: string, fetcher?: Fetcher): Promise<PhotoboxStatus> =>
    postJson<PhotoboxStatus>(`${PHOTOBOX_URL}/status`, { schluessel }, fetcher);

export const aendereBeschreibung = (body: PhotoboxBeschreibung, fetcher?: Fetcher): Promise<PhotoboxStatus> =>
    postJson<PhotoboxStatus>(`${PHOTOBOX_URL}/status/beschreibung`, body, fetcher);

export const ersetzeBild = (body: PhotoboxBildErsetzen, fetcher?: Fetcher): Promise<PhotoboxStatus> =>
    postJson<PhotoboxStatus>(`${PHOTOBOX_URL}/status/bild`, body, fetcher);

export const waehleNutzung = (body: PhotoboxNutzung, fetcher?: Fetcher): Promise<PhotoboxStatus> =>
    postJson<PhotoboxStatus>(`${PHOTOBOX_URL}/status/nutzung`, body, fetcher);

export const ziehZurueck = (body: PhotoboxZurueckziehen, fetcher?: Fetcher): Promise<PhotoboxStatus> =>
    postJson<PhotoboxStatus>(`${PHOTOBOX_URL}/status/zurueckziehen`, body, fetcher);

export const nimmOffline = (body: PhotoboxOffline, fetcher?: Fetcher): Promise<PhotoboxStatus> =>
    postJson<PhotoboxStatus>(`${PHOTOBOX_URL}/status/offline`, body, fetcher);

/**
 * Die interne Vorschau des eigenen Bildes. `"fehlt"` heißt: noch nicht berechnet (404 `photobox_preview_missing`, der Worker ist noch dran); jeder andere Fehler wird zum
 * `ApiFailure` mit dem Code des Servers, damit die Seite „gibt es nicht (mehr)“ vom Netzfehler unterscheidet.
 */
export async function ladeVorschau(schluessel: string, fetcher: Fetcher = fetch): Promise<Blob | "fehlt"> {
    let antwort: Response;
    try {
        antwort = await fetcher(`${PHOTOBOX_URL}/status/vorschau`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "image/webp" },
            body: JSON.stringify({ schluessel }),
            credentials: "same-origin",
            cache: "no-store",
        });
    } catch {
        throw new ApiFailure(0, "network", "Keine Verbindung zum Server.");
    }
    if (antwort.ok) return antwort.blob();
    let code = antwort.status >= 500 ? "unavailable" : "failed";
    try {
        const fehler = ((await antwort.json()) as { error?: { code?: unknown } }).error;
        if (typeof fehler?.code === "string") code = fehler.code;
    } catch {
        // Kein Umschlag: Es bleibt der Code nach dem Status.
    }
    if (code === "photobox_preview_missing") return "fehlt";
    throw new ApiFailure(antwort.status, code, antwort.statusText);
}

/** Die Adresse der Statusseite: der Schlüssel im Fragment, nie in der Suche (`REISEBILD_STATUS_PFAD`). */
export const reisebildAdresse = (origin: string, schluessel: string): string =>
    `${origin}${REISEBILD_STATUS_PFAD}#${schluessel}`;

/**
 * Was schiefging, in der Sprache der Oberfläche (ADR-0018: der Fachcode, nie der Text des Servers).
 * - `netz`: nichts ist angekommen; der Text bleibt, erneutes Senden ist gefahrlos (dieselbe Kennung).
 * - `zu_viele`: die Drossel (429 `photobox_rate`); `sperreBis` nennt die Uhrzeit.
 * - `pausiert`: der Schalter „Einreichungen annehmen“ ist aus (503 `photobox_paused`) oder das Modul ist nicht eingerichtet (503).
 * - `nicht_gefunden`: kein Reisebild zu diesem Schlüssel (404 `photobox_not_found`), derselbe Satz für „nie gewesen“, „gelöscht“ und „geleert“.
 * - `uebergang`: der Zustand erlaubt das nicht (mehr) (409 `photobox_transition`).
 * - `zu_oft_ersetzt`: die sechste Ersetzung des Bildes (409 `photobox_replace_limit`).
 * - `schluessel_belegt`: der Link gehört schon zu einem Reisebild (409 `photobox_key_used`): das Formular neu öffnen.
 * - `format`: das Bild ist kein JPEG, PNG, WebP oder GIF (415 `unsupported_media_type`).
 * - `ungueltig`: die Angaben oder das Bild wurden nicht angenommen (422, 400, 413).
 * - `sonst`: alles Übrige (fremde Herkunft, Serverfehler).
 */
export type PhotoboxFehlerArt =
    | "netz"
    | "zu_viele"
    | "pausiert"
    | "nicht_gefunden"
    | "uebergang"
    | "zu_oft_ersetzt"
    | "schluessel_belegt"
    | "format"
    | "ungueltig"
    | "sonst";

export function fehlerArt(fehler: unknown): PhotoboxFehlerArt {
    if (!(fehler instanceof ApiFailure)) return "sonst";
    if (fehler.status === 0 || fehler.code === "network") return "netz";
    switch (fehler.code) {
        case "photobox_rate":
            return "zu_viele";
        case "photobox_paused":
        case "photobox_unavailable":
            return "pausiert";
        case "photobox_not_found":
            return "nicht_gefunden";
        case "photobox_transition":
            return "uebergang";
        case "photobox_replace_limit":
            return "zu_oft_ersetzt";
        case "photobox_key_used":
            return "schluessel_belegt";
        case "unsupported_media_type":
            return "format";
        case "photobox_invalid":
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

export const FEHLER_SATZ: Readonly<Record<PhotoboxFehlerArt, MessageKey>> = {
    netz: "photobox.fehler.netz",
    zu_viele: "photobox.fehler.zuViele",
    pausiert: "photobox.fehler.pausiert",
    nicht_gefunden: "photobox.status.fehlt",
    uebergang: "photobox.fehler.uebergang",
    zu_oft_ersetzt: "photobox.fehler.zuOftErsetzt",
    schluessel_belegt: "photobox.fehler.schluesselBelegt",
    format: "photobox.fehler.format",
    ungueltig: "photobox.fehler.ungueltig",
    sonst: "photobox.fehler.sonst",
};

/**
 * Ein Satz der Oberfläche samt den Werten für seine Platzhalter. `text` ist der genaue Grund des Servers in der Sprache der Oberfläche (WI-0291, `ablehnung.ts`); steht er da,
 * zeigt die Seite ihn statt `key` (der allgemeine Satz bleibt der Rückfall). Gezeigt wird mit `fehlerText`.
 */
export interface FehlerSatz {
    readonly key: MessageKey;
    readonly params?: Readonly<Record<string, string>>;
    readonly text?: string;
}

/** Der Satz, wie die Seite ihn zeigt: der genaue Grund, wenn es einen gibt, sonst der allgemeine Satz der Fehlerart. */
export const fehlerText = (satz: FehlerSatz): string => satz.text ?? t(satz.key, satz.params);

/**
 * Der Satz zu einem Fehler beim LESEN des Standes (Statusseite; Review S2b I2). `FEHLER_SATZ` spricht vom Einreichen und kennt bei der Drossel eine Uhrzeit; beim Lesen passt
 * das nicht: Die Lesegrenze (120 Aufrufe je Stunde und Adresse) hat keine Uhrzeit, die der Server nennt, und ein Platzhalter bliebe buchstäblich stehen. Darum eigene Sätze ohne Platzhalter.
 */
export function ladeFehlerSatz(art: PhotoboxFehlerArt): MessageKey {
    return art === "zu_viele" ? "photobox.status.ladefehlerZuViele" : "photobox.status.ladefehler";
}

/**
 * Der Satz zu einem Fehler einer AKTION der Statusseite (zurückziehen, Bild ersetzen …). Bei der Drossel steht die Uhrzeit darin; nennt der Server keine, gilt eine Stunde
 * (`sperreBis`), und fehlt auch das, bleibt nie der Platzhalter `{uhr}` im Satz stehen.
 */
export function aktionFehlerSatz(
    art: PhotoboxFehlerArt,
    bis: Date | undefined,
    uhrzeit: (bis: Date) => string,
    jetzt: Date,
): FehlerSatz {
    if (art !== "zu_viele") return { key: FEHLER_SATZ[art] };
    return { key: FEHLER_SATZ[art], params: { uhr: uhrzeit(bis ?? new Date(jetzt.getTime() + 3_600_000)) } };
}

/**
 * Der Satz zu einem Fehler beim EINREICHEN oder einer AKTION: der genaue Grund des Servers (`details.reason`, Datei, Schema, Zustand), sonst der allgemeine Satz der
 * Fehlerart mit der Uhrzeit bei der Drossel (nie bleibt `{uhr}` stehen). WI-0291.
 */
export function fehlerSatzFuer(fehler: unknown, uhrzeit: (bis: Date) => string, jetzt: Date = new Date()): FehlerSatz {
    const art = fehlerArt(fehler);
    const satz = aktionFehlerSatz(art, sperreBis(fehler, jetzt), uhrzeit, jetzt);
    const genau = genauerGrund(fehler, BESUCHER_ABBILDUNG);
    return genau === undefined ? satz : { ...satz, text: genau };
}

export { sperreBis };
