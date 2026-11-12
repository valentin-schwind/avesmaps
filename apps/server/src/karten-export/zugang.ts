import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PendingQuery, Row } from "postgres";
import {
    KARTEN_SCHLUESSEL_UEBERLAPPUNG_TAGE,
    KARTEN_ZUGANG_HOECHSTENS,
    type KartenAbruf,
    type KartenZugang,
    type KartenZugangArt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { randomToken, tokenHash } from "../auth/tokens.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Die Zugänge zu den Kartendateien (WI-0280, Migration 0313, seit 0324 in `avesmaps_auth`): Token-Links und API-Schlüssel. Nach dem Muster der Abzugs-Schlüssel (`abzug/schluessel.ts`):
 * 32 Byte Zufall, in der Datenbank nur der SHA-256, der Wert erscheint einmal. Sie gelten bis zum Ablauf oder Widerruf und solange die Person, die sie anlegte, aktiv
 * ist: Wer aufgelöst oder gesperrt wird, nimmt seine Zugänge mit.
 *
 * Die vier Dinge, an denen Legacys Ausnahme vom „keine Adresse ohne Sitzung“ hing, gelten hier für Links wie Schlüssel: die Frist, die Bindung an genau diese Karten, die
 * Sichtbarkeit samt Rücknahme und der Beleg (`karten_abruf`, Protokoll).
 *
 * **Das Ticket des Downloads:** Das Token eines Links steht im Fragment und erreicht so kein Protokoll, ein Browser-Download braucht aber eine Adresse. Sie trägt
 * darum ein Ticket `<id>.<ablauf>.<hmac>`, unterschrieben mit dem Hash des Tokens: Es überlebt einen Neustart (ein Download von 1,8 GB wird fortgesetzt), gilt nur 24
 * Stunden und fällt mit dem Widerruf, weil jede Prüfung die Zeile liest. Wer es aus einem Protokoll liest, hat 24 Stunden und nur diesen einen Link. Wer den Hash
 * liest, könnte es selbst unterschreiben: Darum steht die Tafel im geschützten Schema, das Claudios Lesekonto nicht sieht (ADR-0010, Vali 2026-11-07).
 */

const TAG_MS = 86_400_000;
const SICHTBAR_TAGE = 60;
const TICKET_MS = TAG_MS;
const LISTE_ABRUFE = 5;
const KENNUNG_LINK = 8;
const KENNUNG_SCHLUESSEL = 8;

export interface NeuerZugang {
    readonly id: string;
    readonly geheimnis: string;
    readonly laeuftAb: Date;
    readonly kennung: string;
}

/** Die Tafel der Zugänge für eine Anweisung; ein Objekt, weil ein Fragment selbst ein Thenable ist und ein `await` es ausführen würde. */
interface Tafel {
    readonly name: PendingQuery<Row[]>;
    /** `false`: Die App-Rolle darf `avesmaps_auth.karten_zugang` noch nicht lesen. Gelesen wird dann die alte Tafel, geschrieben nichts. */
    readonly neu: boolean;
}

/**
 * Wo die Zugänge stehen (Migration 0324). 🪤 Die Rechte an der neuen Tafel kommen nicht mit der Migration: `auth-grants.psql` spielt Claudio ein, nie der
 * Korridor. Bis dahin liest dieses Release die alte Tafel in `public` (die Migration kopierte ihre Zeilen), statt an der neuen mit 42501 zu scheitern: Das
 * nähme jedem Link und jedem Schlüssel die Datei und bräche die Transaktion der Handlung ab. Sind die Rechte da, gilt ohne Neustart die neue.
 */
async function zugangTafel(sql: Sql): Promise<Tafel> {
    const [zeile] = await sql<{ neu: boolean | null }[]>`
        SELECT has_table_privilege(current_user, to_regclass('avesmaps_auth.karten_zugang')::oid, 'SELECT') AS neu
    `;
    const neu = zeile?.neu === true;
    return { neu, name: neu ? sql`avesmaps_auth.karten_zugang` : sql`public.karten_zugang` };
}

/**
 * Geschrieben wird nur die neue Tafel: Was im Rückfall in der alten stünde, fehlte nach dem Umschalten, ein Widerruf darunter. Ohne ihre Rechte sagt es
 * 503 `karten_zugang_umzug`, was los ist; bestehende Links und Schlüssel gelten weiter.
 */
async function schreibTafel(sql: Sql): Promise<Tafel> {
    const tafel = await zugangTafel(sql);
    if (!tafel.neu) {
        throw new ApiError(
            503,
            "karten_zugang_umzug",
            "Die Zugänge ziehen gerade in den geschützten Bereich um. Bis das abgeschlossen ist, lässt sich nichts anlegen, neu ausstellen oder zurücknehmen; bestehende Links und Schlüssel gelten weiter.",
        );
    }
    return tafel;
}

function erzeuge(art: KartenZugangArt): { geheimnis: string; kennung: string } {
    if (art === "schluessel") {
        const geheimnis = `avk_${randomToken()}`;
        return { geheimnis, kennung: geheimnis.slice(0, KENNUNG_SCHLUESSEL) };
    }
    // Ein Link hat keinen sichtbaren Vorspann; die Kennung nennt die Zeile, nicht den Link, und verrät nichts über ihn.
    return { geheimnis: randomToken(), kennung: randomBytes(4).toString("hex").slice(0, KENNUNG_LINK) };
}

/** Legt einen Zugang an; höchstens `KARTEN_ZUGANG_HOECHSTENS` gültige je Art (409 `karten_zugang_zuviele`). Läuft in der Transaktion der Handlung. */
export async function legeZugangAn(
    sql: Sql,
    eingabe: {
        art: KartenZugangArt;
        fuerWen: string;
        karten: readonly string[];
        tage: number;
        personId: string;
        ersetzt?: string;
    },
    jetzt: Date = new Date(),
): Promise<NeuerZugang> {
    const { name } = await schreibTafel(sql);
    const [gueltig] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${name}
         WHERE art = ${eingabe.art} AND revoked_at IS NULL AND expires_at > ${jetzt}
    `;
    if ((gueltig?.n ?? 0) >= KARTEN_ZUGANG_HOECHSTENS) {
        throw new ApiError(
            409,
            "karten_zugang_zuviele",
            `Es gibt schon ${String(KARTEN_ZUGANG_HOECHSTENS)} gültige. Nimm einen zurück, den du nicht mehr brauchst.`,
        );
    }
    const { geheimnis, kennung } = erzeuge(eingabe.art);
    const laeuftAb = new Date(jetzt.getTime() + eingabe.tage * TAG_MS);
    const [zeile] = await sql<{ id: string }[]>`
        INSERT INTO ${name} (art, token_hash, kennung, fuer_wen, karten, created_by, created_at, expires_at, ersetzt)
        VALUES (${eingabe.art}, ${tokenHash(geheimnis)}, ${kennung}, ${eingabe.fuerWen}, ${[...eingabe.karten]}, ${eingabe.personId},
                ${jetzt}, ${laeuftAb}, ${eingabe.ersetzt ?? null})
        RETURNING id
    `;
    return { id: zeile!.id, geheimnis, laeuftAb, kennung };
}

interface ZugangZeile {
    id: string;
    art: KartenZugangArt;
    fuer_wen: string;
    karten: string[];
    kennung: string;
    created_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
}

async function sperreZugang(sql: Sql, tafel: Tafel, id: string): Promise<ZugangZeile> {
    const [zeile] = await sql<ZugangZeile[]>`
        SELECT id, art, fuer_wen, karten, kennung, created_at, expires_at, revoked_at
          FROM ${tafel.name} WHERE id = ${id} FOR UPDATE
    `;
    if (zeile === undefined) throw new ApiError(404, "karten_zugang_unbekannt", "Diesen Zugang gibt es nicht (mehr).");
    return zeile;
}

/** Nimmt einen gültigen Zugang zurück; schon beendet ist kein Fehler, sondern erledigt. */
export async function nimmZugangZurueck(
    sql: Sql,
    eingabe: { id: string; personId: string },
    jetzt: Date = new Date(),
): Promise<{ art: KartenZugangArt; kennung: string }> {
    const tafel = await schreibTafel(sql);
    const zeile = await sperreZugang(sql, tafel, eingabe.id);
    if (zeile.revoked_at === null) {
        await sql`UPDATE ${tafel.name} SET revoked_at = ${jetzt}, revoked_by = ${eingabe.personId} WHERE id = ${eingabe.id}`;
    }
    return { art: zeile.art, kennung: zeile.kennung };
}

/**
 * Stellt einen Zugang neu aus: gleiche Karten, gleiches „für wen“, gleiche Frist. Ein alter Link gilt sofort nicht mehr (der Wert ging verloren oder an die falsche
 * Stelle). Ein alter Schlüssel gilt noch `KARTEN_SCHLUESSEL_UEBERLAPPUNG_TAGE`, damit ein Werkzeug umziehen kann (Ultra-Review T-06).
 */
export async function stelleZugangNeuAus(
    sql: Sql,
    eingabe: { id: string; personId: string },
    jetzt: Date = new Date(),
): Promise<NeuerZugang & { art: KartenZugangArt; tage: number; karten: string[] }> {
    const tafel = await schreibTafel(sql);
    const alt = await sperreZugang(sql, tafel, eingabe.id);
    const tage = Math.max(1, Math.round((alt.expires_at.getTime() - alt.created_at.getTime()) / TAG_MS));
    if (alt.art === "link") {
        await sql`
            UPDATE ${tafel.name} SET revoked_at = coalesce(revoked_at, ${jetzt}), revoked_by = coalesce(revoked_by, ${eingabe.personId})
             WHERE id = ${alt.id}
        `;
    } else {
        const ende = new Date(jetzt.getTime() + KARTEN_SCHLUESSEL_UEBERLAPPUNG_TAGE * TAG_MS);
        await sql`UPDATE ${tafel.name} SET expires_at = least(expires_at, ${ende}) WHERE id = ${alt.id}`;
    }
    const neu = await legeZugangAn(
        sql,
        {
            art: alt.art,
            fuerWen: alt.fuer_wen,
            karten: alt.karten,
            tage,
            personId: eingabe.personId,
            ersetzt: alt.id,
        },
        jetzt,
    );
    return { ...neu, art: alt.art, tage, karten: alt.karten };
}

export interface GeprueftZugang {
    readonly id: string;
    readonly art: KartenZugangArt;
    readonly kennung: string;
    readonly karten: readonly string[];
    readonly laeuftAb: Date;
    readonly tokenHash: Buffer;
}

interface PruefZeile extends ZugangZeile {
    token_hash: Buffer;
    status: string;
}

function urteil(zeile: PruefZeile | undefined, jetzt: Date): GeprueftZugang | null {
    if (zeile === undefined) return null;
    if (zeile.revoked_at !== null || zeile.expires_at.getTime() <= jetzt.getTime() || zeile.status !== "active")
        return null;
    return {
        id: zeile.id,
        art: zeile.art,
        kennung: zeile.kennung,
        karten: zeile.karten,
        laeuftAb: zeile.expires_at,
        tokenHash: zeile.token_hash,
    };
}

/** Gilt dieser Wert? Unbekannt, abgelaufen, widerrufen und von einer nicht mehr aktiven Person sind von außen nicht zu unterscheiden. */
export async function pruefeZugang(
    sql: Sql,
    wert: string,
    art: KartenZugangArt,
    jetzt: Date = new Date(),
): Promise<GeprueftZugang | null> {
    const { name } = await zugangTafel(sql);
    const [zeile] = await sql<PruefZeile[]>`
        SELECT z.id, z.art, z.fuer_wen, z.karten, z.kennung, z.created_at, z.expires_at, z.revoked_at, z.token_hash, p.status
          FROM ${name} z
          JOIN avesmaps_auth.person p ON p.id = z.created_by
         WHERE z.token_hash = ${tokenHash(wert)} AND z.art = ${art}
    `;
    return urteil(zeile, jetzt);
}

function unterschrift(hash: Buffer, id: string, ablauf: number): string {
    return createHmac("sha256", hash)
        .update(`${id}.${String(ablauf)}`)
        .digest("base64url");
}

/** Das Ticket eines Links für die Adresse des ZIP. */
export function stelleTicketAus(zugang: GeprueftZugang, jetzt: Date = new Date()): string {
    const ablauf = Math.min(jetzt.getTime() + TICKET_MS, zugang.laeuftAb.getTime());
    return `${zugang.id}.${String(ablauf)}.${unterschrift(zugang.tokenHash, zugang.id, ablauf)}`;
}

const TICKET = /^([0-9a-f-]{36})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/u;

/** Prüft ein Ticket gegen die Zeile: Unterschrift, Frist des Tickets und Gültigkeit des Links. */
export async function loeseTicketEin(
    sql: Sql,
    ticket: string,
    jetzt: Date = new Date(),
): Promise<GeprueftZugang | null> {
    const treffer = TICKET.exec(ticket);
    if (treffer === null) return null;
    const [, id, ablaufText, zeichen] = treffer as unknown as [string, string, string, string];
    const ablauf = Number(ablaufText);
    if (!Number.isSafeInteger(ablauf) || ablauf <= jetzt.getTime()) return null;
    const { name } = await zugangTafel(sql);
    const [zeile] = await sql<PruefZeile[]>`
        SELECT z.id, z.art, z.fuer_wen, z.karten, z.kennung, z.created_at, z.expires_at, z.revoked_at, z.token_hash, p.status
          FROM ${name} z
          JOIN avesmaps_auth.person p ON p.id = z.created_by
         WHERE z.id = ${id} AND z.art = 'link'
    `;
    const zugang = urteil(zeile, jetzt);
    if (zugang === null) return null;
    const soll = Buffer.from(unterschrift(zugang.tokenHash, zugang.id, ablauf));
    const ist = Buffer.from(zeichen);
    return soll.length === ist.length && timingSafeEqual(soll, ist) ? zugang : null;
}

/** Merkt sich die Nutzung, höchstens einmal je Minute; im Rückfall ohne Rechte an der neuen Tafel gar nicht (die alte wird nicht mehr geschrieben). */
export async function merkeNutzung(sql: Sql, id: string, jetzt: Date = new Date()): Promise<void> {
    const tafel = await zugangTafel(sql);
    if (!tafel.neu) return;
    await sql`
        UPDATE ${tafel.name} SET last_used_at = ${jetzt}
         WHERE id = ${id} AND (last_used_at IS NULL OR last_used_at < ${new Date(jetzt.getTime() - 60_000)})
    `;
}

/** Trägt einen Abruf ein, bevor das erste Byte hinausgeht (fail-closed: ohne Beleg keine Datei). */
export async function beginneAbruf(
    sql: Sql,
    eingabe: { zugangId: string | null; personId: string | null; karten: readonly string[]; bytes: number },
): Promise<string> {
    const [zeile] = await sql<{ id: string }[]>`
        INSERT INTO karten_abruf (zugang_id, person_id, karten, bytes)
        VALUES (${eingabe.zugangId}, ${eingabe.personId}, ${[...eingabe.karten]}, ${eingabe.bytes})
        RETURNING id::text AS id
    `;
    return zeile!.id;
}

/** Der jüngste Abruf derselben Karten über denselben Weg: Ein Fortsetzen mit `Range` gehört zu ihm. */
export async function findeAbruf(
    sql: Sql,
    eingabe: { zugangId: string | null; personId: string | null; karten: readonly string[] },
): Promise<string | null> {
    const [zeile] = await sql<{ id: string }[]>`
        SELECT id::text AS id FROM karten_abruf
         WHERE zugang_id IS NOT DISTINCT FROM ${eingabe.zugangId} AND person_id IS NOT DISTINCT FROM ${eingabe.personId}
           AND karten = ${[...eingabe.karten]}
         ORDER BY started_at DESC, id DESC LIMIT 1
    `;
    return zeile?.id ?? null;
}

export async function beendeAbruf(
    sql: Sql,
    eingabe: { id: string; geliefert: number; vollstaendig: boolean },
    jetzt: Date = new Date(),
): Promise<void> {
    await sql`
        UPDATE karten_abruf
           SET geliefert = greatest(geliefert, ${eingabe.geliefert}), finished_at = ${jetzt},
               zustand = CASE WHEN ${eingabe.vollstaendig} THEN 'vollstaendig' WHEN zustand = 'vollstaendig' THEN 'vollstaendig' ELSE 'abgebrochen' END
         WHERE id = ${eingabe.id}
    `;
}

/** Die Zugänge einer Art für die Liste: gültige und die der letzten Wochen, neueste zuerst. Nie der Wert. */
export async function listeZugaenge(sql: Sql, art: KartenZugangArt, jetzt: Date = new Date()): Promise<KartenZugang[]> {
    const seit = new Date(jetzt.getTime() - SICHTBAR_TAGE * TAG_MS);
    const { name } = await zugangTafel(sql);
    const zeilen = await sql<
        (ZugangZeile & {
            last_used_at: Date | null;
            display_name: string;
            status: string;
            abrufe: number;
            letzte: { zeit: string; zustand: KartenAbruf["zustand"]; bytes: string; geliefert: string }[] | null;
        })[]
    >`
        SELECT z.id, z.art, z.fuer_wen, z.karten, z.kennung, z.created_at, z.expires_at, z.revoked_at, z.last_used_at,
               p.display_name, p.status,
               (SELECT count(*)::int FROM karten_abruf a WHERE a.zugang_id = z.id) AS abrufe,
               (SELECT json_agg(j) FROM (
                    SELECT a.started_at AS zeit, a.zustand, a.bytes::text AS bytes, a.geliefert::text AS geliefert
                      FROM karten_abruf a WHERE a.zugang_id = z.id ORDER BY a.started_at DESC LIMIT ${LISTE_ABRUFE}
               ) j) AS letzte
          FROM ${name} z
          JOIN avesmaps_auth.person p ON p.id = z.created_by
         WHERE z.art = ${art} AND greatest(z.expires_at, coalesce(z.revoked_at, z.expires_at)) > ${seit}
         ORDER BY z.created_at DESC
         LIMIT 200
    `;
    return zeilen.map((zeile) => ({
        id: zeile.id,
        art: zeile.art,
        kennung: zeile.kennung,
        fuerWen: zeile.fuer_wen,
        karten: zeile.karten,
        zustand:
            zeile.revoked_at !== null || zeile.status !== "active"
                ? "widerrufen"
                : zeile.expires_at.getTime() <= jetzt.getTime()
                  ? "abgelaufen"
                  : "aktiv",
        angelegt: zeile.created_at.toISOString(),
        laeuftAb: zeile.expires_at.toISOString(),
        widerrufen: zeile.revoked_at?.toISOString() ?? null,
        von: zeile.status === "departed" ? null : zeile.display_name,
        zuletzt: zeile.last_used_at?.toISOString() ?? null,
        abrufe: zeile.abrufe,
        letzteAbrufe: (zeile.letzte ?? []).map((a) => ({
            zeit: new Date(a.zeit).toISOString(),
            zustand: a.zustand,
            bytes: Number(a.bytes),
            geliefert: Number(a.geliefert),
        })),
    }));
}
