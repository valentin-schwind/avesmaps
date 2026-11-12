import {
    ABZUG_SCHLUESSEL_HOECHSTENS,
    istAbzugSchluessel,
    type AbzugQuelle,
    type AbzugSchluessel,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { randomToken, tokenHash } from "../auth/tokens.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Die Abzugs-Schlüssel auf Stage und Production (WI-0251; Migration 0220): Mit ihnen holt der Entwicklungsrechner einen Abzug selbst ab, ohne Sitzung.
 *
 * - Ein Schlüssel ist `abz_` und 32 Byte Zufall; in der Datenbank steht nur sein SHA-256 (`auth/tokens.ts`). Der Wert erscheint genau einmal, bei
 *   der Ausstellung, in der Antwort der Route, nie im Protokoll.
 * - Er gilt, solange er weder abgelaufen noch widerrufen ist und die Person, die ihn anlegte, aktiv ist: Wer aufgelöst oder gesperrt wird, nimmt seine
 *   Schlüssel mit (ohne dass die Auflösung sie kennen muss).
 * - Er gilt nur für die Umgebung, für die er angelegt wurde (`quelle`): Ein Schlüssel der Stage öffnet auf Production nichts.
 */

/** Wie lange abgelaufene und widerrufene Schlüssel in der Liste bleiben. */
const SICHTBAR_TAGE = 60;
const TAG_MS = 86_400_000;

export function neuerSchluessel(): string {
    return `abz_${randomToken()}`;
}

/** Der Schlüssel aus `Authorization: Bearer abz_…`, oder `undefined`. */
export function schluesselAusKopf(kopf: string | undefined): string | undefined {
    const treffer = /^Bearer (\S+)$/u.exec(kopf ?? "");
    return treffer?.[1];
}

export interface AngelegterSchluessel {
    readonly id: string;
    readonly schluessel: string;
    readonly laeuftAb: string;
}

/** Legt einen Schlüssel an; höchstens `ABZUG_SCHLUESSEL_HOECHSTENS` gültige je Quelle (409 `abzug_schluessel_zuviele`). Läuft in der Transaktion der Handlung. */
export async function legeSchluesselAn(
    sql: Sql,
    eingabe: { quelle: AbzugQuelle; personId: string; tage: number },
    jetzt: Date = new Date(),
): Promise<AngelegterSchluessel> {
    const [gueltig] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM avesmaps_auth.abzug_schluessel
         WHERE quelle = ${eingabe.quelle} AND revoked_at IS NULL AND expires_at > ${jetzt}
    `;
    if ((gueltig?.n ?? 0) >= ABZUG_SCHLUESSEL_HOECHSTENS) {
        throw new ApiError(
            409,
            "abzug_schluessel_zuviele",
            `Es gibt schon ${String(ABZUG_SCHLUESSEL_HOECHSTENS)} gültige Schlüssel. Widerrufe einen, den du nicht mehr brauchst.`,
        );
    }
    const schluessel = neuerSchluessel();
    const laeuftAb = new Date(jetzt.getTime() + eingabe.tage * TAG_MS);
    const [zeile] = await sql<{ id: string }[]>`
        INSERT INTO avesmaps_auth.abzug_schluessel (quelle, token_hash, created_by, created_at, expires_at)
        VALUES (${eingabe.quelle}, ${tokenHash(schluessel)}, ${eingabe.personId}, ${jetzt}, ${laeuftAb})
        RETURNING id
    `;
    return { id: zeile!.id, schluessel, laeuftAb: laeuftAb.toISOString() };
}

/** Widerruft einen gültigen Schlüssel dieser Quelle; 404 `abzug_schluessel_unbekannt`, wenn es ihn nicht (mehr) gibt. */
export async function widerrufeSchluessel(
    sql: Sql,
    eingabe: { quelle: AbzugQuelle; id: string; personId: string },
    jetzt: Date = new Date(),
): Promise<void> {
    const zeilen = await sql<{ id: string }[]>`
        UPDATE avesmaps_auth.abzug_schluessel SET revoked_at = ${jetzt}, revoked_by = ${eingabe.personId}
         WHERE id = ${eingabe.id} AND quelle = ${eingabe.quelle} AND revoked_at IS NULL
        RETURNING id
    `;
    if (zeilen.length === 0) {
        throw new ApiError(404, "abzug_schluessel_unbekannt", "Diesen Schlüssel gibt es hier nicht (mehr).");
    }
}

/** Die Schlüssel einer Quelle für die Liste im Datenabgleich: gültige und die der letzten Wochen, neueste zuerst. Nie der Wert. */
export async function listeSchluessel(
    sql: Sql,
    quelle: AbzugQuelle,
    jetzt: Date = new Date(),
): Promise<AbzugSchluessel[]> {
    const seit = new Date(jetzt.getTime() - SICHTBAR_TAGE * TAG_MS);
    const zeilen = await sql<
        {
            id: string;
            created_at: Date;
            expires_at: Date;
            revoked_at: Date | null;
            last_used_at: Date | null;
            display_name: string;
            status: string;
        }[]
    >`
        SELECT s.id, s.created_at, s.expires_at, s.revoked_at, s.last_used_at, p.display_name, p.status
          FROM avesmaps_auth.abzug_schluessel s
          JOIN avesmaps_auth.person p ON p.id = s.created_by
         WHERE s.quelle = ${quelle} AND greatest(s.expires_at, coalesce(s.revoked_at, s.expires_at)) > ${seit}
         ORDER BY s.created_at DESC
         LIMIT 20
    `;
    return zeilen.map((zeile) => {
        const widerrufen = zeile.revoked_at !== null || zeile.status !== "active";
        return {
            id: zeile.id,
            // Eine aufgelöste oder gesperrte Person nimmt ihre Schlüssel mit: Sie gelten wie widerrufen.
            zustand: widerrufen
                ? "widerrufen"
                : zeile.expires_at.getTime() <= jetzt.getTime()
                  ? "abgelaufen"
                  : "gueltig",
            angelegt: zeile.created_at.toISOString(),
            laeuftAb: zeile.expires_at.toISOString(),
            von: zeile.status === "departed" ? null : zeile.display_name,
            zuletzt: zeile.last_used_at?.toISOString() ?? null,
        };
    });
}

export type SchluesselUrteil =
    { readonly ok: true; readonly id: string } | { readonly ok: false; readonly grund: "ungueltig" | "abgelaufen" };

/** Gilt dieser Schlüssel hier? Unbekannt oder falsch geformt: `ungueltig`; bekannt, aber abgelaufen, widerrufen oder von einer nicht mehr aktiven Person: `abgelaufen`. */
export async function pruefeSchluessel(
    sql: Sql,
    wert: string | undefined,
    quelle: AbzugQuelle,
    jetzt: Date = new Date(),
): Promise<SchluesselUrteil> {
    if (!istAbzugSchluessel(wert)) return { ok: false, grund: "ungueltig" };
    const [zeile] = await sql<{ id: string; expires_at: Date; revoked_at: Date | null; status: string }[]>`
        SELECT s.id, s.expires_at, s.revoked_at, p.status
          FROM avesmaps_auth.abzug_schluessel s
          JOIN avesmaps_auth.person p ON p.id = s.created_by
         WHERE s.token_hash = ${tokenHash(wert)} AND s.quelle = ${quelle}
    `;
    if (zeile === undefined) return { ok: false, grund: "ungueltig" };
    if (zeile.revoked_at !== null || zeile.expires_at.getTime() <= jetzt.getTime() || zeile.status !== "active") {
        return { ok: false, grund: "abgelaufen" };
    }
    return { ok: true, id: zeile.id };
}

/** Merkt sich, dass der Schlüssel benutzt wurde (höchstens einmal je Minute, damit eine Liste nicht jedes Mal schreibt). */
export async function merkeNutzung(sql: Sql, id: string, jetzt: Date = new Date()): Promise<void> {
    await sql`
        UPDATE avesmaps_auth.abzug_schluessel SET last_used_at = ${jetzt}
         WHERE id = ${id} AND (last_used_at IS NULL OR last_used_at < ${new Date(jetzt.getTime() - 60_000)})
    `;
}
