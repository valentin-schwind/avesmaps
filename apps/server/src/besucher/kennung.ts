import { createHash, createHmac } from "node:crypto";

/**
 * Die Tageskennung eines Besuchs (WI-0138, BESUCH-0001 §4).
 *
 * 🔴 **Die IP wird hier gelesen und nirgends abgelegt.** Was die Datenbank sieht, sind 16 Byte, die aus dem UTC-Datum, der IP und
 * dem User-Agent entstehen — mit einem Schlüssel, der nur in der Umgebung steht. Nach dem Tageswechsel passt die Kennung zu nichts
 * mehr: Der Tag geht in den HMAC ein, und die Zeilen von gestern werden gelöscht.
 *
 * 💣 **Ohne Schlüssel keine Kennung.** Legacy lieferte einen Vorgabewert im Quelltext mit (Befund A23: der Salt steht im
 * Repository, der IPv4-Raum ist klein genug zum Durchprobieren, also war die Zusage „nicht zurückrechenbar“ nichts wert).
 * Hier gibt es keinen Vorgabewert: Fehlt `VISITOR_SALT`, zählt der Server Aufrufe weiter, aber keine eindeutigen Besucher, und
 * die Ansicht sagt „unbekannt“ statt 0. Eine fehlende Zahl ist besser als eine Scheinanonymität.
 */

/** Das UTC-Datum als `YYYY-MM-DD`; dieselbe Grenze wie `UTC_DATE()` in der Datenbank. */
export function utcTag(jetzt: Date = new Date()): string {
    return jetzt.toISOString().slice(0, 10);
}

/**
 * 16 Byte aus Datum, IP und User-Agent — oder `undefined`, wenn kein Schlüssel eingerichtet ist.
 *
 * ⚠️ 16 statt 32 Byte: Die Kennung muss nur innerhalb eines Tages unterscheiden, und was nicht gespeichert wird, kann auch nicht
 * verglichen werden. Die Kollisionswahrscheinlichkeit liegt bei unseren Zahlen (hunderte je Tag) weit jenseits des Messbaren.
 */
export function tagesKennung(
    salt: string | undefined,
    ip: string,
    userAgent: string,
    jetzt: Date = new Date(),
): Buffer | undefined {
    if (!salt || salt.trim() === "") return undefined;
    return createHmac("sha256", salt)
        .update(`${utcTag(jetzt)}|${ip}|${userAgent}`)
        .digest()
        .subarray(0, 16);
}

/**
 * Die Tageskennung eines Angemeldeten: aus der Person, nicht aus dem Gerät (Vali 2026-11-11: „die anzahl editoren kann mit 22
 * nicht sein - wir sind nur 11“).
 *
 * 🔴 **Ein Editor ist ein Kopf, egal an wie vielen Geräten.** Aus Adresse und Browser war dieselbe Person am Rechner und am Telefon
 * zwei, nach jedem Wechsel der Funkzelle oder der IPv6-Datenschutzadresse noch einer mehr. Die Person kennt die Sitzung ohnehin;
 * gespeichert wird wie bei `tagesKennung` nur der HMAC, und er verfällt mit dem Tag.
 *
 * 🪤 `person|` trennt die Eingabe von der Form `tag|ip|browser`: Keine Adresse heißt „person“, also trifft keine Gerätekennung je
 * eine Personenkennung.
 */
export function kopfKennung(salt: string | undefined, personId: string, jetzt: Date = new Date()): Buffer | undefined {
    if (!salt || salt.trim() === "") return undefined;
    return createHmac("sha256", salt)
        .update(`${utcTag(jetzt)}|person|${personId}`)
        .digest()
        .subarray(0, 16);
}

/**
 * Die Kennung derselben Person in der gefilterten Sicht (`visitor_lang`, OPS-000118): Sie zählt dort einmal am Tag, unabhängig davon, ob sie
 * ungefiltert schon gezählt ist. Abgeleitet aus der Tageskennung, also ebenso nur heute gültig und ohne Schlüssel nicht zu bilden.
 */
export function langKennung(kennung: Buffer): Buffer {
    return createHash("sha256").update("lang|").update(kennung).digest().subarray(0, 16);
}
