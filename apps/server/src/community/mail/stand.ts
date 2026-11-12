import {
    MAIL_ABRUF_ERGEBNISSE,
    MAIL_ABRUF_WARTEZEIT_MS,
    MAIL_VERSAND_ERGEBNISSE,
    type MailAbrufErgebnis,
    type MailAbrufGrund,
    type MailAbrufStand,
    type MailStand,
    type MailVersandErgebnis,
    type MailVersandGrund,
    type MailVersandStand,
} from "@avesmaps3d/shared";
import { ABRUF_VORGABE, leseAbrufKonfiguration, leseMailKonfiguration } from "./konfiguration.ts";
import type { MailUebersicht, RohRoutine } from "./routine.ts";

/**
 * Der Stand des Panels „Mailpostfach“ (WI-0268 C6c) aus drei Quellen: der Umgebung des Prozesses (das erste Tor: sind die Angaben da?), den Schaltern und Läufen der Datenbank (`routine.ts`) und der Uhr.
 * Rein: kennt weder Fastify noch die Datenbank; die Route (`routes/admin-community-mail.ts`) holt die Übersicht und ruft `baueMailStand`.
 *
 * - 🔴 **Nie im Stand:** Nutzer, Kennwort, Absenderadresse, Ablagepfad. Der Stand sagt nur, OB der Zugang hinterlegt ist (`leseAbrufKonfiguration`/`leseMailKonfiguration` sind brauchbar), und nennt den Server (IMAP- bzw.
 *   SMTP-Host) und den Ordner. Beide sind kein Geheimnis. Die Werte kommen aus den Hilfen unten, die nur diese Felder lesen, nie aus einem Objekt, das Zugangsdaten trüge.
 * - **Betrieb des Abrufs.** Er holt NICHT ab, wenn (in dieser Rangfolge) eine Pflichtangabe der Umgebung fehlt (`zugang_fehlt`), der Schalter aus steht (`ausgeschaltet`) oder der letzte Lauf eine dauerhafte Ablehnung war und die
 *   Pflege noch ihre sechs Stunden wartet (`anmeldung_abgelehnt`, mit `wartenBis`; zählt auch `ordner_fehlt`, denn beides ist `MAIL_ABRUF_DAUERHAFT`).
 * - **`nicht_eingerichtet`** heißt: Der Zugang ist da, aber für den Ordner gibt es keinen Startpunkt (`mail_abruf_stand`). 🔴 Der Abruf holt dann trotzdem ab: Die Pflege reiht ihn nur nach der Umgebung ein
 *   (`abrufAn`), der erste Lauf liest ab der ersten UID und nähme das ganze Postfach als Anfragen auf. Deshalb bleibt der Betrieb `holt_ab`; der Grund ist ein Vorbehalt, den das Panel als Warnung zeigt (die Betreiber können
 *   die Routine dann ausschalten, bevor der Startpunkt mit `mail-einrichten.sh --abruf-an` gesetzt ist). „Der Abstand der Pflege ist nicht gesetzt“ kann im Betrieb nicht vorkommen: `jobs/ausfuehrer.ts` setzt fünf Minuten fest.
 * - **Betrieb des Versands.** Er sendet NICHT, wenn eine der fünf Angaben fehlt (`zugang_fehlt`) oder der Schalter aus steht (`ausgeschaltet`).
 */

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/u;

/** Ein Host der Umgebung, wenn er brauchbar ist (dasselbe Muster wie die Konfiguration); sonst `null`. Hosts sind kein Geheimnis. */
function hostAus(
    umgebung: NodeJS.ProcessEnv,
    name: "COMMUNITY_MAIL_IMAP_HOST" | "COMMUNITY_MAIL_SMTP_HOST",
): string | null {
    const roh = umgebung[name]?.trim();
    return roh !== undefined && HOST.test(roh) ? roh : null;
}

/** Der Ordner, der gelesen wird: der der Umgebung, wenn er brauchbar ist, sonst die Vorgabe (wie `leseAbrufKonfiguration`). */
export function ordnerAus(umgebung: NodeJS.ProcessEnv = process.env): string {
    const roh = umgebung["COMMUNITY_MAIL_ORDNER"]?.trim();
    // eslint-disable-next-line no-control-regex
    if (roh === undefined || roh === "" || roh.length > 200 || /[\u0000-\u001f\u007f]/u.test(roh))
        return ABRUF_VORGABE.ordner;
    return roh;
}

/** Eine Zeit der Datenbank als ISO-Text in UTC; `null`, wenn keine da ist oder sie nicht lesbar ist. */
function iso(wert: string | null | undefined): string | null {
    if (wert === null || wert === undefined) return null;
    const zeit = Date.parse(wert);
    return Number.isNaN(zeit) ? null : new Date(zeit).toISOString();
}

const zahl = (wert: unknown): number =>
    typeof wert === "number" && Number.isSafeInteger(wert) && wert >= 0 ? wert : 0;

function routineVon(roh: RohRoutine | undefined): MailAbrufStand["routine"] {
    // Ohne Zeile (vor der Migration) gilt die Vorgabe: an, nie von jemandem umgelegt.
    return roh === undefined
        ? { aktiv: true, geaendertAt: null, geaendertVon: null }
        : { aktiv: roh.aktiv, geaendertAt: iso(roh.geaendertAt), geaendertVon: roh.geaendertVon };
}

/** Der letzte Lauf, wenn sein Wort in der Liste der Art steht (ein fremdes Wort wird nie ausgeliefert). */
function laufVon<T extends string>(
    roh: RohRoutine | undefined,
    erlaubt: readonly T[],
): { at: string; ergebnis: T } | null {
    const lauf = roh?.letzterLauf;
    const at = iso(lauf?.at);
    const ergebnis = erlaubt.find((wort) => wort === lauf?.ergebnis);
    return at === null || ergebnis === undefined ? null : { at, ergebnis };
}

export interface MailStandEingabe {
    umgebung: NodeJS.ProcessEnv;
    uebersicht: MailUebersicht;
    jetzt: Date;
}

export function baueAbrufStand({ umgebung, uebersicht, jetzt }: MailStandEingabe): MailAbrufStand {
    const roh = uebersicht.routinen.abruf;
    const routine = routineVon(roh);
    const zugang = leseAbrufKonfiguration(umgebung) !== undefined;
    const letzterLauf = laufVon<MailAbrufErgebnis>(roh, MAIL_ABRUF_ERGEBNISSE);
    const erfolgAt = iso(roh?.letzterErfolg?.at);
    const zahlen = roh?.letzterErfolg?.zahlen ?? {};
    const startpunkt = uebersicht.startpunkt;

    let grund: MailAbrufGrund | null = null;
    let wartenBis: string | null = null;
    if (!zugang) grund = "zugang_fehlt";
    else if (!routine.aktiv) grund = "ausgeschaltet";
    else {
        if (
            letzterLauf !== null &&
            (letzterLauf.ergebnis === "anmeldung_abgelehnt" || letzterLauf.ergebnis === "ordner_fehlt")
        ) {
            const bis = Date.parse(letzterLauf.at) + MAIL_ABRUF_WARTEZEIT_MS;
            if (bis > jetzt.getTime()) {
                grund = "anmeldung_abgelehnt";
                wartenBis = new Date(bis).toISOString();
            }
        }
        if (grund === null && startpunkt === null) grund = "nicht_eingerichtet";
    }
    return {
        betrieb: grund === null || grund === "nicht_eingerichtet" ? "holt_ab" : "holt_nicht_ab",
        grund,
        wartenBis,
        zugang: zugang ? "hinterlegt" : "fehlt",
        server: hostAus(umgebung, "COMMUNITY_MAIL_IMAP_HOST"),
        ordner: ordnerAus(umgebung),
        routine,
        letzterLauf,
        letzterErfolg:
            erfolgAt === null
                ? null
                : {
                      at: erfolgAt,
                      neu: zahl(zahlen["neu"]),
                      angehaengt: zahl(zahlen["angehaengt"]),
                      unlesbar: zahl(zahlen["unlesbar"]),
                      zuGross: zahl(zahlen["zu_gross"]),
                  },
        startpunkt:
            startpunkt === null
                ? null
                : { uidValidity: zahl(startpunkt.uidValidity), letzteUid: zahl(startpunkt.letzteUid) },
        letzteMailAt: iso(uebersicht.letzteMailAt),
    };
}

export function baueVersandStand({ umgebung, uebersicht }: MailStandEingabe): MailVersandStand {
    const roh = uebersicht.routinen.versand;
    const routine = routineVon(roh);
    const zugang = leseMailKonfiguration(umgebung) !== undefined;
    const erfolgAt = iso(roh?.letzterErfolg?.at);
    const grund: MailVersandGrund | null = !zugang ? "zugang_fehlt" : !routine.aktiv ? "ausgeschaltet" : null;
    return {
        betrieb: grund === null ? "sendet" : "sendet_nicht",
        grund,
        zugang: zugang ? "hinterlegt" : "fehlt",
        server: hostAus(umgebung, "COMMUNITY_MAIL_SMTP_HOST"),
        routine,
        letzterLauf: laufVon<MailVersandErgebnis>(roh, MAIL_VERSAND_ERGEBNISSE),
        letzterErfolg:
            erfolgAt === null
                ? null
                : {
                      at: erfolgAt,
                      ...(zahl(roh?.letzterErfolg?.zahlen?.["kopie_fehlt"]) > 0 ? { kopieFehlt: true } : {}),
                  },
        wartend: zahl(uebersicht.wartend),
        fehler7Tage: zahl(uebersicht.fehler7Tage),
    };
}

/** Der ganze Stand des Panels. */
export function baueMailStand(eingabe: MailStandEingabe): MailStand {
    return { abruf: baueAbrufStand(eingabe), versand: baueVersandStand(eingabe) };
}
