import {
    EDITOR_STRASSEN_ASSISTENT_STRECKE_URL,
    EDITOR_STRASSEN_ASSISTENT_ZUWEISEN_URL,
    type StrasseStreckeAntwort,
    type StrasseStreckeBody,
    type StrasseZuweisenBody,
    type StrasseZuweisenReceipt,
} from "@avesmaps3d/shared";
import { sende, type ApiFehler, type SchreibAntwort } from "../fenster/entwurf-senden";
import type { MessageKey } from "../i18n/i18n";

/**
 * Was der Straßen-Assistent beim Server liest und schreibt (WI-0310; Vertrag `packages/shared/src/editor-strassen-assistent.ts`): die Strecke
 * (lesend, jede jüngere Frage bricht die ältere ab) und „Zuweisen“ (EINE Operation, die Quittung nennt den Anker der Straße danach).
 *
 * - **250 ms Ruhe** nach Änderungen der Liste, bevor gefragt wird (`RUHE_MS`): Wer eine Zeile zieht oder mehrere Orte hintereinander einreiht,
 *   löst nicht jedes Mal eine Rechnung des Servers aus.
 * - **Fehler als Satz:** 409 (ein Abschnitt änderte sich, oder ein anderer Editor hält ihn) und 403 (das Recht fehlt) sagen, was zu tun ist.
 */

export const RUHE_MS = 250;

export type StreckeAntwort =
    | { readonly ok: true; readonly antwort: StrasseStreckeAntwort }
    | { readonly ok: false; readonly status: number; readonly fehler: ApiFehler };

export interface StrassenAssistentDaten {
    strecke(body: StrasseStreckeBody, signal: AbortSignal): Promise<StreckeAntwort>;
    zuweisen(body: StrasseZuweisenBody): Promise<SchreibAntwort<StrasseZuweisenReceipt>>;
}

type Abruf = typeof fetch;

export function createStrassenAssistentDaten(
    abruf: Abruf = (eingabe, init) => fetch(eingabe, init),
): StrassenAssistentDaten {
    return {
        strecke: (body, signal) =>
            sende<StrasseStreckeAntwort>(EDITOR_STRASSEN_ASSISTENT_STRECKE_URL, body, "POST", abruf, signal).then(
                (antwort): StreckeAntwort => (antwort.ok ? { ok: true, antwort: antwort.quittung } : antwort),
            ),
        zuweisen: (body) => sende<StrasseZuweisenReceipt>(EDITOR_STRASSEN_ASSISTENT_ZUWEISEN_URL, body, "POST", abruf),
    };
}

/** Der Satz zu einem Fehler des Servers (der Schlüssel der Tafel). */
export function fehlerSchluessel(status: number, code: string, lesen = false): MessageKey {
    if (status === 0) return "wegeditor.assistent.fehler.netz";
    if (status === 403) return "wegeditor.assistent.fehler.recht";
    if (status === 409 && code === "object_locked") return "wegeditor.assistent.fehler.gesperrt";
    if (status === 409) return "wegeditor.assistent.fehler.konflikt";
    return lesen ? "wegeditor.assistent.fehler.lesen" : "wegeditor.assistent.fehler.allgemein";
}

export type LeserStand =
    | { readonly phase: "laedt" }
    | { readonly phase: "bereit"; readonly antwort: StrasseStreckeAntwort }
    | { readonly phase: "fehler"; readonly satz: MessageKey };

export interface StreckenLeser {
    /** Fragt die Strecke; `sofort` ohne die Ruhe (Öffnen, Artikelwechsel), sonst nach `RUHE_MS` Stille. */
    frage(body: StrasseStreckeBody, sofort?: boolean): void;
    /** Bricht eine laufende oder wartende Frage ab (das Fenster geht zu). */
    stopp(): void;
}

/**
 * Die Strecke lesen: Eine neue Frage bricht die alte ab, eine abgebrochene meldet nichts. Während gefragt wird, hält der Leser den letzten
 * Stand nicht fest (`laedt`); das Fenster behält ihn selbst, damit die Liste nicht flackert.
 */
export function createStreckenLeser(
    daten: Pick<StrassenAssistentDaten, "strecke">,
    meldet: (stand: LeserStand) => void,
    ruheMs: number = RUHE_MS,
): StreckenLeser {
    let abbruch: AbortController | undefined;
    let frist: ReturnType<typeof setTimeout> | undefined;

    function stopp(): void {
        if (frist !== undefined) clearTimeout(frist);
        frist = undefined;
        abbruch?.abort();
        abbruch = undefined;
    }

    async function hole(body: StrasseStreckeBody): Promise<void> {
        const steuer = new AbortController();
        abbruch = steuer;
        meldet({ phase: "laedt" });
        const antwort = await daten.strecke(body, steuer.signal);
        if (steuer.signal.aborted || abbruch !== steuer) return;
        abbruch = undefined;
        meldet(
            antwort.ok
                ? { phase: "bereit", antwort: antwort.antwort }
                : { phase: "fehler", satz: fehlerSchluessel(antwort.status, antwort.fehler.code, true) },
        );
    }

    return {
        frage(body, sofort = false) {
            stopp();
            meldet({ phase: "laedt" });
            if (sofort) void hole(body);
            else
                frist = setTimeout(() => {
                    frist = undefined;
                    void hole(body);
                }, ruheMs);
        },
        stopp,
    };
}
