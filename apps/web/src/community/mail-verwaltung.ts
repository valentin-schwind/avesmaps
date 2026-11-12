import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import {
    MAIL_ADMIN_URL,
    type MailAbrufStand,
    type MailRoutineArt,
    type MailStand,
    type MailVersandStand,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import {
    createReadConfirmation,
    requestConfirmation,
    withConfirmation,
    type ReadConfirmation,
} from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";
import type { MessageKey } from "../i18n/i18n";

/**
 * Das Panel „Mailpostfach“ unter Systemsteuerung › Redaktion & Zusammenarbeit (WI-0268 C6c): Betrieb, Routine (an/aus mit Passkey), Zugang (nur ob), letzter Lauf und Erfolg von Abruf und Versand.
 * Wie es aussieht, steht in `mail-verwaltung.vue`; Vorbild ist der Discord-Reiter (`news/discord.ts`). 🔴 Ob abgeholt oder gesendet wird, entscheidet der Server; das Panel zeigt es nur und legt den Schalter um.
 * Zugangsdaten kennt das Panel nicht: Der Stand nennt nur „hinterlegt“ oder „fehlt“, den Server und den Ordner.
 */

export type Ton = "erfolg" | "ruhe" | "warnung";

/**
 * Der Ton des Statuspunkts für den Betrieb: läuft (`erfolg`), ist bewusst aus (`ruhe`) oder es fehlt etwas oder es braucht Aufmerksamkeit (`warnung`): kein Zugang, abgelehnte Anmeldung, oder ein Abruf ohne Startpunkt
 * (er holt ab, aber der erste Lauf läse das ganze Postfach).
 */
export function betriebsTon(stand: Pick<MailAbrufStand | MailVersandStand, "grund">): Ton {
    if (stand.grund === null) return "erfolg";
    return stand.grund === "ausgeschaltet" ? "ruhe" : "warnung";
}

/** Der Betrieb als Wort: „holt ab“, „holt nicht ab“, „sendet“, „sendet nicht“. */
export function betriebsText(
    art: MailRoutineArt,
    stand: Pick<MailAbrufStand | MailVersandStand, "betrieb">,
): MessageKey {
    if (art === "abruf")
        return stand.betrieb === "holt_ab" ? "admin.mail.betrieb.holtAb" : "admin.mail.betrieb.holtNichtAb";
    return stand.betrieb === "sendet" ? "admin.mail.betrieb.sendet" : "admin.mail.betrieb.sendetNicht";
}

/**
 * Der Grund als Satz: Schlüssel und, wo der Satz eine Zeit nennt, die Zeit (ISO) als `zeit`. Abgelehnte Anmeldung heißt „nächster Versuch ab …“; endete der letzte Lauf mit `ordner_fehlt`, sagt der Satz das
 * (beides wartet sechs Stunden). Bei Versand hängt am Grund `ausgeschaltet` ein Hinweis auf die wartenden Mails (`wartendeHinweis`).
 */
export function grundSatz(
    art: MailRoutineArt,
    stand: MailAbrufStand | MailVersandStand,
): { key: MessageKey; zeit: string | null } | null {
    switch (stand.grund) {
        case null:
            return null;
        case "zugang_fehlt":
            return { key: "admin.mail.grund.zugang_fehlt", zeit: null };
        case "ausgeschaltet":
            return {
                key: art === "abruf" ? "admin.mail.grund.ausgeschaltet" : "admin.mail.grund.versandAusgeschaltet",
                zeit: null,
            };
        case "nicht_eingerichtet":
            return { key: "admin.mail.grund.nicht_eingerichtet", zeit: null };
        case "anmeldung_abgelehnt": {
            const zeit = "wartenBis" in stand ? stand.wartenBis : null;
            return {
                key:
                    stand.letzterLauf?.ergebnis === "ordner_fehlt"
                        ? "admin.mail.grund.ordner_fehlt"
                        : "admin.mail.grund.anmeldung_abgelehnt",
                zeit,
            };
        }
    }
}

/** Der Name eines Laufs (Wort aus der festen Liste) als Schlüssel der Sprachtafel. */
export function laufSchluessel(
    ergebnis:
        | NonNullable<MailAbrufStand["letzterLauf"]>["ergebnis"]
        | NonNullable<MailVersandStand["letzterLauf"]>["ergebnis"],
): MessageKey {
    return `admin.mail.lauf.${ergebnis}`;
}

/** Die Zahlen des letzten Abrufs als Teile für den Satz „neu · angehängt · unlesbar · zu groß“. */
export function erfolgZahlen(erfolg: NonNullable<MailAbrufStand["letzterErfolg"]>): {
    neu: number;
    angehaengt: number;
    unlesbar: number;
    zuGross: number;
} {
    return { neu: erfolg.neu, angehaengt: erfolg.angehaengt, unlesbar: erfolg.unlesbar, zuGross: erfolg.zuGross };
}

/** UIDVALIDITY und letzte UID für die Zeile „Startpunkt“ (nur lesend). */
export function startpunktParams(startpunkt: NonNullable<MailAbrufStand["startpunkt"]>): {
    uidValidity: number;
    letzteUid: number;
} {
    return { uidValidity: startpunkt.uidValidity, letzteUid: startpunkt.letzteUid };
}

export interface MailVerwaltung {
    stand: ShallowRef<MailStand | null>;
    fehler: Ref<boolean>;
    /** Welche Routine gerade schaltet (`abruf`, `versand`); sonst `null`. */
    busy: Ref<MailRoutineArt | null>;
    problems: Ref<Phrase[]>;
    /** Zu welcher Routine die `problems` gehören: Jede Karte zeigt nur ihre eigenen. */
    problemArt: Ref<MailRoutineArt | null>;
    laden: () => Promise<void>;
    setzeRoutine: (art: MailRoutineArt, aktiv: boolean) => Promise<boolean>;
}

export interface MailVerwaltungDeps {
    fetcher?: Fetcher;
    reads?: ReadConfirmation;
}

export function createMailVerwaltung(deps: MailVerwaltungDeps = {}): MailVerwaltung {
    const stand = shallowRef<MailStand | null>(null);
    const fehler = ref(false);
    const busy = ref<MailRoutineArt | null>(null);
    const problems = ref<Phrase[]>([]);
    const problemArt = ref<MailRoutineArt | null>(null);
    const reads = deps.reads ?? createReadConfirmation(requestConfirmation);

    async function laden(): Promise<void> {
        try {
            stand.value = await withConfirmation(() => getJson<MailStand>(MAIL_ADMIN_URL, deps.fetcher), reads.ask);
            fehler.value = false;
        } catch {
            fehler.value = true;
        }
    }

    /** Der Schalter mit Passkey: Der Server fragt ihn an (`reauth_required`), die Bestätigung kommt von hier. Danach steht der Stand neu da. */
    async function setzeRoutine(art: MailRoutineArt, aktiv: boolean): Promise<boolean> {
        if (busy.value !== null) return false;
        busy.value = art;
        problems.value = [];
        problemArt.value = art;
        let ok = false;
        try {
            await withConfirmation(
                () =>
                    postJson<OperationReceipt>(
                        `${MAIL_ADMIN_URL}/routine`,
                        { operationId: newOperationId(), art, aktiv },
                        deps.fetcher,
                    ),
                requestConfirmation,
            );
            ok = true;
        } catch (error) {
            problems.value = formProblems(error);
        } finally {
            busy.value = null;
        }
        await laden();
        return ok;
    }

    return { stand, fehler, busy, problems, problemArt, laden, setzeRoutine };
}
