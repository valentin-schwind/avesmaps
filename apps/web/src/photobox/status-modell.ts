import {
    PHOTOBOX_AKTIONEN,
    photoboxAktionErlaubt,
    photoboxGrantAllowed,
    type PhotoboxAktion,
    type PhotoboxStatus,
    type PhotoboxSubmissionState,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";

/**
 * Was die Statusseite `/reisebild#…` rechnet (WI-0272 S2b, Aufgabe 14; WI §5.2), ohne Browser: der Stand in Worten, die Knöpfe je Zustand und der Takt, in dem die Vorschau nachgefragt wird.
 * Wie es aussieht, steht in `reisebild-status-fenster.vue`, die Aufrufe in `api.ts`.
 *
 * - 🔴 **Die Knöpfe stehen genau nach `photoboxAktionErlaubt`** (`packages/shared/src/photobox.ts`): Server und Oberfläche fragen dieselbe Stelle. Was der Zustand nicht erlaubt, gibt es nicht als Knopf, auch nicht
 *   gesperrt; der Server lehnte es ohnehin mit 409 ab. Dazu kommt, was kein Zustandsübergang ist: „Auf der Karte zeigen“ (gilt in jedem Zustand) und „Neues Bild von dieser Stelle“ (wo der Weg zu Ende ist).
 * - **Die Lizenzwahl** ändert sich vor der Freigabe in beide Richtungen, danach nur noch zu CC BY (und nie bei einer Avesmaps-Aufnahme: `photoboxGrantAllowed`).
 * - **Die Vorschau** (die interne Fassung des eigenen Bildes) wird nachgefragt, solange sie fehlt: `/status` alle 15 Sekunden, höchstens achtmal (die Lesegrenze liegt bei 120 Aufrufen je Stunde und Adresse), danach
 *   „Neu laden“ von Hand.
 * - 🔴 **Bild endgültig gelöscht** (WI-0272, `bildEntfernt`): Pille „Entfernt“, Satz „Das Bild wurde entfernt.“, keine Vorschau, kein Verlauf der Schritte und keine Aktion mehr (der Server nähme
 *   keine an, Grund `bild_entfernt`); es bleiben „Auf der Karte zeigen“ und „Neues Bild von dieser Stelle“.
 */

/** Der Zustand in Alltagssprache, als Pille. */
export const ZUSTAND_TEXT: Readonly<Record<PhotoboxSubmissionState, MessageKey>> = {
    incoming: "photobox.status.zustand.incoming",
    technical_failed: "photobox.status.zustand.technical_failed",
    pending: "photobox.status.zustand.pending",
    changes_requested: "photobox.status.zustand.changes_requested",
    approved: "photobox.status.zustand.approved",
    rejected: "photobox.status.zustand.rejected",
    withdrawn: "photobox.status.zustand.withdrawn",
    offline: "photobox.status.zustand.offline",
    expired: "photobox.status.zustand.expired",
    purged: "photobox.status.zustand.purged",
};

/** Was der Zustand bedeutet und wie es weitergeht, als Satz unter der Pille. */
export const ZUSTAND_SATZ: Readonly<Record<PhotoboxSubmissionState, MessageKey>> = {
    incoming: "photobox.status.text.incoming",
    technical_failed: "photobox.status.text.technical_failed",
    pending: "photobox.status.text.pending",
    changes_requested: "photobox.status.text.changes_requested",
    approved: "photobox.status.text.approved",
    rejected: "photobox.status.text.rejected",
    withdrawn: "photobox.status.text.withdrawn",
    offline: "photobox.status.text.offline",
    expired: "photobox.status.text.expired",
    purged: "photobox.status.text.purged",
};

export type ZustandTon = "neutral" | "erfolg" | "warnung" | "gefahr";

/** Hat der Betreiber das Bild endgültig gelöscht (WI-0272, Migration 0328)? Dann bleibt die Einreichung ohne Datei im Verlauf. */
export const istEntfernt = (status: Pick<PhotoboxStatus, "bildEntfernt">): boolean => status.bildEntfernt === true;

/** Pille, Ton und Satz eines Stands: nach dem endgültigen Löschen „Entfernt“ und „Das Bild wurde entfernt.“, sonst die des Zustands. */
export function standWorte(status: Pick<PhotoboxStatus, "zustand" | "bildEntfernt">): {
    pille: MessageKey;
    satz: MessageKey;
    ton: ZustandTon;
} {
    if (istEntfernt(status))
        return { pille: "photobox.status.zustand.entfernt", satz: "photobox.status.text.entfernt", ton: "gefahr" };
    return { pille: ZUSTAND_TEXT[status.zustand], satz: ZUSTAND_SATZ[status.zustand], ton: zustandTon(status.zustand) };
}

export const zustandTon = (zustand: PhotoboxSubmissionState): ZustandTon => {
    switch (zustand) {
        case "approved":
            return "erfolg";
        case "changes_requested":
        case "technical_failed":
            return "warnung";
        case "rejected":
        case "withdrawn":
        case "offline":
        case "expired":
        case "purged":
            return "gefahr";
        default:
            return "neutral";
    }
};

/**
 * Die drei Schritte „Eingereicht · In Prüfung · Veröffentlicht“ der Leiste (Probierseite): Wie viele davon erreicht sind, oder `undefined`, wenn der Weg zu Ende ist (abgelehnt, zurückgezogen, offline, verfallen)
 * und die Leiste nichts mehr zeigt. Eingegangen und in Prüfung stehen auf dem zweiten, eine Rückfrage ebenfalls.
 */
export function erreichteSchritte(zustand: PhotoboxSubmissionState): number | undefined {
    switch (zustand) {
        case "incoming":
        case "pending":
        case "changes_requested":
            return 2;
        case "approved":
            return 3;
        default:
            return undefined;
    }
}

export interface StatusKnoepfe {
    /** Die Bildbeschreibung ändern (vor der Freigabe sofort, danach wartet sie auf Prüfung). */
    readonly beschreibung: boolean;
    readonly bild: boolean;
    readonly zurueckziehen: boolean;
    /** „Sofort offline nehmen“, nach der Freigabe; nicht rückgängig zu machen. */
    readonly offline: boolean;
    /** Zu CC BY 4.0 wechseln (nie bei einer Avesmaps-Aufnahme, auch nach der Freigabe möglich). */
    readonly nutzungCcBy: boolean;
    /** Zurück zu „Nur für Avesmaps“, nur vor der Freigabe. */
    readonly nutzungNurAvesmaps: boolean;
    /** „Auf der Karte zeigen“: Die Kamera fliegt zur Stelle; in jedem Zustand. */
    readonly zeigen: boolean;
    /** „Neues Bild von dieser Stelle“: dort, wo dieses Reisebild keine Aktion mehr hat. */
    readonly neuesBild: boolean;
}

/** Die Knöpfe zu einem Stand: genau die Tafel `photoboxAktionErlaubt`, dazu die zwei Wege, die kein Übergang sind. Nach dem endgültigen Löschen keine Aktion mehr. */
export function knoepfeFuer(
    status: Pick<PhotoboxStatus, "zustand" | "nutzung" | "entstehung" | "bildEntfernt">,
): StatusKnoepfe {
    const { zustand } = status;
    const entfernt = istEntfernt(status);
    const erlaubt = (aktion: PhotoboxAktion): boolean => !entfernt && photoboxAktionErlaubt(zustand, aktion);
    return {
        beschreibung: erlaubt("beschreibung"),
        bild: erlaubt("bild"),
        zurueckziehen: erlaubt("zurueckziehen"),
        offline: erlaubt("offline"),
        nutzungCcBy:
            !entfernt &&
            status.nutzung !== "cc-by-4.0" &&
            photoboxAktionErlaubt(zustand, "nutzung", "cc-by-4.0") &&
            photoboxGrantAllowed(status.entstehung, "cc-by-4.0"),
        nutzungNurAvesmaps:
            !entfernt &&
            status.nutzung !== "avesmaps_only" &&
            photoboxAktionErlaubt(zustand, "nutzung", "avesmaps_only"),
        zeigen: true,
        neuesBild: PHOTOBOX_AKTIONEN.every((aktion) => !erlaubt(aktion)),
    };
}

/** Wie oft und wie schnell `/status` nachgefragt wird, solange die Vorschau fehlt. */
export const VORSCHAU_TAKT = { abstandMs: 15_000, hoechstens: 8 } as const;

/**
 * Was nach einer Antwort zu tun ist: `holen` (die Vorschau ist bereit, jetzt laden), `warten` (noch nicht bereit, in `abstandMs` neu fragen) oder `aufgeben` (nach `hoechstens` Wiederholungen: Knopf „Neu laden“).
 * `versuche` zählt die Nachfragen NACH der ersten (die erste beim Öffnen zählt nicht).
 */
export function naechsterSchritt(vorschauBereit: boolean, versuche: number): "holen" | "warten" | "aufgeben" {
    if (vorschauBereit) return "holen";
    return versuche < VORSCHAU_TAKT.hoechstens ? "warten" : "aufgeben";
}
