import { createHash } from "node:crypto";
import { REISEBILD_AUSSCHNITT_MAX, type ReisebilderAntwort, type ReisebilderAusschnitt } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { resolveReisebilder } from "../media/resolver.ts";
import { inhaltsstandFuer } from "../system/inhaltsstand.ts";

/**
 * Der Lesepfad der Reisebilder mit Zwischenspeicher des Servers (WI-0272 S4, Aufgabe 23): die Antwort je gerastertem Ausschnitt, fertig als Text mit ETag.
 *
 * Der Zwischenspeicher steht gegen die Last des Verschiebens der Karte, nicht gegen die Entscheidung. Er hält eine Antwort höchstens {@link REISEBILDER_SPEICHER_MS}
 * und höchstens {@link SPEICHER_MAX} Einträge (die ältesten fallen). 🔴 **Offline bleibt sofort:** Nimmt der Einreicher oder die Redaktion ein Reisebild offline, oder
 * wird ein Notaus gesetzt oder aufgehoben, ruft die Operation nach dem Commit {@link vergissReisebilder}: Der Speicher ist leer, die nächste Antwort liest neu.
 * Ein Schalter der Inhalte kommt über seine Revision: Sie steht im Schlüssel, ein umgelegter Schalter trifft also nie einen alten Eintrag. Eine Antwort, die vor dem
 * Vergessen zu rechnen begann, wird danach nicht mehr abgelegt (sie könnte das Bild noch enthalten).
 *
 * **Neue Bilder leise** (Vali 2026-11-02: „ja andere besucher sollen neu freigegebene bilder ohne zutun sehen - aber es soll kein popup oder so kommen“): Die Freigabe vergisst den Speicher ebenso, und
 * {@link reisebilderStand} nennt jeder offenen Seite im vorhandenen Takt von `GET /api/content-state` (60 s, 304 kostet nichts), ob sich etwas geändert hat. Kein neuer Dienst, kein Push, keine Nginx-Änderung.
 */

/** Wie lange eine Antwort im Speicher des Servers gilt (Regler melden). */
export const REISEBILDER_SPEICHER_MS = 15_000;
const SPEICHER_MAX = 64;

interface Eintrag {
    bis: number;
    body: string;
    etag: string;
}

/** Die fertige Antwort: der Text und sein ETag (in Anführungszeichen, wie ihn HTTP verlangt). */
export interface ReisebilderText {
    body: string;
    etag: string;
}

const speicher = new Map<string, Eintrag>();
/** Wird bei jedem Vergessen größer: Wer vorher zu rechnen begann, legt sein Ergebnis nicht mehr ab. */
let epoche = 0;

/** Den ganzen Speicher leeren: nach jeder Operation, nach der ein Bild nicht mehr erscheinen darf (Offline, Notaus). */
export function vergissReisebilder(): void {
    epoche += 1;
    speicher.clear();
}

let stand: { bis: number; epoche: number; wert: string } | undefined;

/**
 * Der Stand der Reisebilder als kurze Zeichenkette für den Takt der offenen Seiten (`GET /api/content-state`): die Zahl der aktiven Verwendungen, die jüngste und die Epoche dieses Prozesses. Eine Freigabe
 * ändert die ersten beiden, ein Offline-Nehmen die Zahl, ein Notaus die Epoche. Höchstens eine Datenbankfrage je {@link REISEBILDER_SPEICHER_MS}, egal wie viele Seiten fragen.
 */
export async function reisebilderStand(db: Queryable): Promise<string> {
    const jetzt = Date.now();
    if (stand !== undefined && stand.epoche === epoche && stand.bis > jetzt) return stand.wert;
    const gestartet = epoche;
    const [zeile] = await db<{ zahl: number; letzte: string }[]>`
        SELECT count(*)::int AS zahl, coalesce(max(id), 0)::text AS letzte FROM photobox_media WHERE retired_at IS NULL
    `;
    const wert = `${String(zeile?.zahl ?? 0)}-${zeile?.letzte ?? "0"}-${String(gestartet)}`;
    stand = { bis: jetzt + REISEBILDER_SPEICHER_MS, epoche: gestartet, wert };
    return wert;
}

/** Die Antwort als Text mit ETag (ein kurzer Hash des Textes, wie bei den Typbildern). */
export function reisebilderText(antwort: ReisebilderAntwort): ReisebilderText {
    const body = JSON.stringify(antwort);
    return { body, etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"` };
}

/** Die Antwort, wenn es nichts zu zeigen gibt (Schalter aus, keine Datenbank, Tafeln fehlen noch). */
export const reisebilderLeer = (): ReisebilderText => reisebilderText({ an: false, bilder: [], gekappt: false });

/**
 * Die Reisebilder im Ausschnitt als fertiger Text. Gleicher Ausschnitt und gleicher Stand der Inhaltsschalter innerhalb von 15 Sekunden: aus dem Speicher, ohne
 * Datenbankfrage; sonst frisch gelesen (höchstens {@link REISEBILD_AUSSCHNITT_MAX} Bilder).
 */
export async function liesReisebilder(db: Queryable, ausschnitt: ReisebilderAusschnitt): Promise<ReisebilderText> {
    const stand = await inhaltsstandFuer(db);
    const key = `${stand.source}:${String(stand.revision)}:${String(ausschnitt.x0)},${String(ausschnitt.y0)},${String(ausschnitt.x1)},${String(ausschnitt.y1)}`;
    const jetzt = Date.now();
    const gespeichert = speicher.get(key);
    if (gespeichert !== undefined) {
        if (gespeichert.bis > jetzt) return gespeichert;
        speicher.delete(key);
    }
    const gestartet = epoche;
    const text = reisebilderText(await resolveReisebilder(db, ausschnitt, REISEBILD_AUSSCHNITT_MAX));
    if (gestartet === epoche && stand.source === "database") {
        if (speicher.size >= SPEICHER_MAX) {
            const aeltester = speicher.keys().next();
            if (aeltester.done !== true) speicher.delete(aeltester.value);
        }
        speicher.set(key, { ...text, bis: jetzt + REISEBILDER_SPEICHER_MS });
    }
    return text;
}
