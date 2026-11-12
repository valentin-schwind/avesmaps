import { createHash, randomUUID } from "node:crypto";
import {
    COMMUNITY_GRENZEN,
    comNummer,
    leseCom,
    rollenGeordnet,
    type BezugObjektart,
    type CommunityErgebnis,
    type CommunityPrioritaet,
    type GesendetZeile,
    type KorrekturKandidaten,
    type ListenAnfrageSegment,
    type MailInhalt,
    type MeldungBezug,
    type StatusSicht,
    type VerlaufEintrag,
    type VorgangDetail,
    type VorgangKorrektur,
    type VorgangListe,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import type { DiscordBezug } from "./discord-bezug.ts";
import { grundZumSatz } from "./gruende.ts";

export { comNummer, leseCom };

/** Diese Arten lassen sich im Browser ansehen (inline); alles andere nur herunterladen. Die Route kennt dieselbe Liste. */
export const ANSEHBARE_MIME: ReadonlySet<string> = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
]);

/**
 * Das Community-Modul in der Datenbank (WI-0268, Migration 0265): dünne Hüllen um die Funktionen des Schemas `avesmaps_community` und die
 * Lesewege der Redaktion. Die Regeln (Übergänge, Revision, Idempotenz, Aufbewahrung) stehen in der Datenbank, nicht hier. Leicht: kein
 * Fastify, damit Worker und Routen sie gleich benutzen. Fehler der Funktionen kommen als SQLSTATE der Klasse `KC` und werden zu
 * `CommunityFehler` mit Fachcode.
 */

export type CommunityFehlerCode =
    | "community_not_found"
    | "community_conflict"
    | "community_transition"
    | "community_invalid"
    | "community_mail_grenze";

export class CommunityFehler extends Error {
    readonly code: CommunityFehlerCode;
    /** `reason`: der Fachcode zum Satz der Datenbank (`gruende.ts`), damit das Fenster in seiner Sprache sagt, was zu tun ist (WI-0291). */
    readonly details: Record<string, unknown> | undefined;
    constructor(code: CommunityFehlerCode, message: string, details?: Record<string, unknown>) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

/** Ein Fehler der Funktionen als `CommunityFehler`; alles andere unverändert. KC409 ist Konflikt (Revision) oder Übergang, je nach Text. */
export function communityFehler(error: unknown): unknown {
    const code = (error as { code?: unknown } | undefined)?.code;
    if (typeof code !== "string" || !code.startsWith("KC")) return error;
    const message = error instanceof Error ? error.message : String(error);
    const fach: CommunityFehlerCode =
        code === "KC404"
            ? "community_not_found"
            : code === "KC409"
              ? message.startsWith("community_conflict")
                  ? "community_conflict"
                  : "community_transition"
              : code === "KC429"
                ? "community_mail_grenze"
                : "community_invalid";
    const satz = message.replace(/^community_[a-z_]+:\s*/u, "");
    const reason = grundZumSatz(satz);
    return new CommunityFehler(fach, satz, reason === undefined ? undefined : { reason });
}

/** Ruft eine Funktion des Schemas und macht aus ihrem `KC…`-Fehler einen `CommunityFehler` (auch für `rollen.ts`). */
export async function rufe<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (error) {
        throw communityFehler(error);
    }
}

/** sha256 des Schlüssels der Statusseite; gespeichert wird nur dieser Hash. */
export const schluesselHash = (schluessel: string): Buffer => createHash("sha256").update(schluessel, "utf8").digest();

/** Ist das Modul in dieser Datenbank nutzbar (Schema da, die App darf die Funktionen rufen)? Ohne `community-grants.psql` nicht. */
export async function communityBereit(db: Queryable): Promise<boolean> {
    // CASE statt AND: Ohne USAGE am Schema scheitert schon das Auflösen der Signatur, deshalb erst danach fragen.
    try {
        const [row] = await db<{ bereit: boolean }[]>`
            SELECT CASE
                       WHEN to_regnamespace('avesmaps_community') IS NULL THEN false
                       WHEN NOT has_schema_privilege('avesmaps_community', 'USAGE') THEN false
                       ELSE has_function_privilege(
                           'avesmaps_community.community_melden(uuid, text, text, text, text, text, bytea, jsonb)', 'EXECUTE'
                       )
                   END AS bereit
        `;
        return row?.bereit === true;
    } catch {
        return false;
    }
}

// --- Öffentlich ---

export interface Meldung {
    operationId: string;
    schluessel: string;
    kategorie: string;
    text: string;
    quelle?: string | undefined;
    fehltArt?: string | undefined;
    name?: string | undefined;
    bezug: MeldungBezug;
}

export async function melden(db: Queryable, meldung: Meldung): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_community.community_melden(
                ${meldung.operationId}::uuid, ${meldung.kategorie}, ${meldung.text}, ${meldung.quelle ?? null},
                ${meldung.fehltArt ?? null}, ${meldung.name ?? null}, ${schluesselHash(meldung.schluessel)},
                ${db.json(meldung.bezug as never)}::jsonb
            )::text AS id
        `,
    );
    return Number(row?.id);
}

export interface Kontakt {
    operationId: string;
    schluessel: string;
    kategorie: string;
    text: string;
    name?: string | undefined;
    mail?: string | undefined;
}

/** Das Kontaktformular der Hinweise (WI-0268 C4): eine Anfrage mit Eingang `kontakt`. Gibt die Kennung des Vorgangs zurück. */
export async function anfragen(db: Queryable, kontakt: Kontakt): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_community.community_anfragen(
                ${kontakt.operationId}::uuid, ${kontakt.kategorie}, ${kontakt.text}, ${kontakt.name ?? null}, ${kontakt.mail ?? null},
                ${schluesselHash(kontakt.schluessel)}
            )::text AS id
        `,
    );
    return Number(row?.id);
}

export async function statusLesen(db: Queryable, schluessel: string): Promise<StatusSicht | null> {
    const [row] = await db<{ sicht: StatusSicht | null }[]>`
        SELECT avesmaps_community.community_status_lesen(${schluesselHash(schluessel)}) AS sicht
    `;
    return row?.sicht ?? null;
}

export async function statusAntworten(
    db: Queryable,
    operationId: string,
    schluessel: string,
    text: string,
): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_status_antworten(${operationId}::uuid, ${schluesselHash(schluessel)}, ${text}) AS revision
        `,
    );
    return Number(row?.revision);
}

export async function statusZurueckziehen(db: Queryable, operationId: string, schluessel: string): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_status_zurueckziehen(${operationId}::uuid, ${schluesselHash(schluessel)}) AS revision
        `,
    );
    return Number(row?.revision);
}

// --- Discord (WI-0268 C8, Migration 0283) ---
// 🔴 Die Discord-Kennung steht hier nur als Parameter eines Vergleichs; keine dieser Funktionen gibt sie zurück, und kein Fehlertext nennt sie.

export interface AusDiscord {
    operationId: string;
    text: string;
    name: string;
    discordId: string | null;
    /** Die Herkunft im Betreiber-Kanal der Stage (`OPS-000097`). */
    ops: string;
    /** Schon in der Ablage: Name (SHA-256), Dateiname, Art, Größe. */
    bilder: readonly { datei: string; name: string; mime: string; groesse: number }[];
    /** Objekt oder Stelle aus dem „Wo:“ der Meldung (`discord-bezug.ts`), sonst `null`. */
    bezug: DiscordBezug | null;
}

/**
 * Eine Meldung aus dem Betreiber-Kanal der Stage, über die Brücke weitergeleitet (WI-0297): seit Migration 0336 eine MELDUNG (Kategorie `sonstiges`, Eingang `discord`) mit
 * Objekt oder Stelle, wenn bekannt, und Rückweg `discord` über die Kennung; vorher (0332) eine Anfrage. Dieselbe Operation zweimal gibt dieselbe Kennung zurück.
 */
export async function ausDiscord(db: Queryable, m: AusDiscord): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_community.community_aus_discord_meldung(
                ${m.operationId}::uuid, ${m.text}, ${m.name}, ${m.discordId}::text, ${m.ops},
                ${db.json(m.bilder as never)}::jsonb, ${m.bezug === null ? null : db.json(m.bezug as never)}::jsonb
            )::text AS id
        `,
    );
    return Number(row?.id);
}

/** Hängt die geprüfte Discord-Kennung und den Anzeigename an den Melder des Vorgangs zum Statusschlüssel (nur sein Hash). Gibt die COM-Nummer zurück; kein Vorgang zum Schlüssel: `community_not_found`. */
export async function discordVerbinden(db: Queryable, hash: Buffer, kennung: string, name: string): Promise<string> {
    const [row] = await rufe(
        () => db<{ nummer: string }[]>`
            SELECT avesmaps_community.community_discord_verbinden(${hash}, ${kennung}, ${name}) AS nummer
        `,
    );
    return String(row?.nummer);
}

/** Löst die Verbindung aus ALLEN Vorgängen derselben Kennung (Fachkonzept §8.4); gibt ihre Zahl zurück (0 ohne Verbindung). */
export async function discordLoesen(db: Queryable, schluessel: string): Promise<number> {
    const [row] = await rufe(
        () => db<{ n: number }[]>`
            SELECT avesmaps_community.community_discord_loesen(${schluesselHash(schluessel)}) AS n
        `,
    );
    return Number(row?.n);
}

/**
 * Eine Meldung einer Kennung, so wie die Datenbank sie liefert: Nummer, Zustand, Kategorie, Bezugsname und, seit WI-0297 (Migration 0333), die letzte Nachricht der Redaktion
 * an den Melder. Abgeschlossene nur noch 30 Tage und nur mit einer solchen Nachricht. Nie Meldetext, Name oder Adresse.
 */
export interface DiscordOffenZeile {
    readonly nummer: string;
    readonly zustand: "neu" | "in_arbeit" | "rueckfrage" | "abgeschlossen";
    readonly kategorie: string;
    readonly bezugName: string | null;
    readonly antwort: { readonly text: string; readonly at: Date } | null;
}

export async function discordOffen(db: Queryable, kennung: string): Promise<DiscordOffenZeile[]> {
    const zeilen = await rufe(
        () => db<
            {
                nummer: string;
                zustand: DiscordOffenZeile["zustand"];
                kategorie: string;
                bezug_name: string | null;
                antwort: string | null;
                antwort_at: Date | null;
            }[]
        >`
            SELECT nummer, zustand, kategorie, bezug_name, antwort, antwort_at
              FROM avesmaps_community.community_discord_offen_antworten(${kennung})
        `,
    );
    return zeilen.map((z) => ({
        nummer: z.nummer,
        zustand: z.zustand,
        kategorie: z.kategorie,
        bezugName: z.bezug_name,
        antwort: z.antwort === null || z.antwort_at === null ? null : { text: z.antwort, at: z.antwort_at },
    }));
}

export type DiscordZurueckErgebnis = "zurueckgezogen" | "nicht_gefunden" | "schon_abgeschlossen";

export async function discordZurueckziehen(
    db: Queryable,
    operationId: string,
    kennung: string,
    id: number,
): Promise<DiscordZurueckErgebnis> {
    const [row] = await rufe(
        () => db<{ ergebnis: DiscordZurueckErgebnis }[]>`
            SELECT avesmaps_community.community_discord_zurueckziehen(${operationId}::uuid, ${kennung}, ${id}::bigint) AS ergebnis
        `,
    );
    return row!.ergebnis;
}

// --- Redaktion: Schritte ---

interface Schritt {
    operationId?: string;
    id: number;
    person: string;
    revision: number;
}

const neu = (operation?: string): string => operation ?? randomUUID();

const SCHRITTE = ["sichten", "uebernehmen", "archivieren", "papierkorb", "wiederherstellen"] as const;
export type SchrittName = (typeof SCHRITTE)[number];

/** Die Schritte ohne weitere Angabe: Operation, Vorgang, Person, Revision. Der Name ist fest aus `SCHRITTE`, nie aus der Anfrage. */
async function schritt(db: Queryable, name: SchrittName, s: Schritt): Promise<number> {
    if (!SCHRITTE.includes(name)) throw new Error(`unbekannter Schritt ${name}`);
    const [row] = await rufe(() =>
        db.unsafe<{ revision: number }[]>(
            `SELECT avesmaps_community.community_${name}($1::uuid, $2::bigint, $3::uuid, $4::int) AS revision`,
            [neu(s.operationId), s.id, s.person, s.revision],
        ),
    );
    return Number(row?.revision);
}

export const sichten = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "sichten", s);
export const uebernehmen = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "uebernehmen", s);
export const archivieren = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "archivieren", s);
export const papierkorb = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "papierkorb", s);
export const wiederherstellen = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "wiederherstellen", s);

export async function zustaendig(db: Queryable, s: Schritt & { ziel: string | null }): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_zustaendig(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.ziel}::uuid
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

export async function prioritaet(db: Queryable, s: Schritt & { prioritaet: CommunityPrioritaet }): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_prioritaet(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.prioritaet}
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

export async function notiz(
    db: Queryable,
    n: { operationId?: string; id: number; person: string; text: string },
): Promise<void> {
    await rufe(
        () => db`
            SELECT avesmaps_community.community_notiz(${neu(n.operationId)}::uuid, ${n.id}::bigint, ${n.person}::uuid, ${n.text})
        `,
    );
}

export async function rueckfrage(db: Queryable, s: Schritt & { text: string }): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_rueckfrage(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.text}
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

export async function abschliessen(
    db: Queryable,
    s: Schritt & { ergebnis: CommunityErgebnis; begruendung: string; nachricht?: string; dubletteVon?: number },
): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_abschliessen(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.ergebnis}, ${s.begruendung},
                ${s.nachricht ?? null}, ${s.dubletteVon ?? null}::bigint
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

export async function wiedereroeffnen(db: Queryable, s: Schritt & { grund: string }): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_wiedereroeffnen(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.grund}
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

/** Antworten auf eine Anfrage (vor dem Mailweg auf die Statusseite); mit `archivieren` gleich ins Archiv, Ergebnis `beantwortet`. */
export async function anfrageAntworten(
    db: Queryable,
    s: Schritt & { text: string; archivieren: boolean },
): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_anfrage_antworten(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.text}, ${s.archivieren}::boolean
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

/**
 * Antworten per Mail (WI-0268 C6a, Migration 0279): wie `anfrageAntworten`, aber die Nachricht geht als Mail an die Adresse des Melders dieses Vorgangs - 🔴 es gibt hier bewusst keinen Parameter für eine
 * Adresse. `domaene` ist die des Absenders (Teil der Message-ID). Gibt Revision und Kennung des Ausgangs zurück; `neu` ist falsch bei einer Wiederholung derselben Kennung (dann reiht niemand einen
 * Versand ein). Mit `archivieren` kommt die Anfrage erst nach der Annahme durch den Mailserver ins Archiv.
 */
export async function anfrageAntwortenMail(
    db: Queryable,
    s: Schritt & { text: string; archivieren: boolean; domaene: string },
): Promise<{ revision: number; ausgang: number | null; neu: boolean }> {
    const [row] = await rufe(
        () => db<{ ergebnis: { revision: number; ausgang: number | null; neu: boolean } }[]>`
            SELECT avesmaps_community.community_anfrage_antworten_mail(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.text}, ${s.archivieren}::boolean, ${s.domaene}
            ) AS ergebnis
        `,
    );
    return {
        revision: Number(row?.ergebnis.revision),
        ausgang: row?.ergebnis.ausgang == null ? null : Number(row.ergebnis.ausgang),
        neu: row?.ergebnis.neu === true,
    };
}

export interface NeueMail {
    operationId: string;
    person: string;
    an: string;
    betreff: string;
    text: string;
    domaene: string;
    /** Wie viele neue Mails eine Person in 24 Stunden schreiben darf. */
    grenze: number;
}

/** Eine neue Mail an eine freie Adresse (Migration 0279): legt Vorgang, Absender, Nachricht und Ausgang an. Gibt die Kennung des Vorgangs und des Ausgangs zurück. */
export async function neueMail(
    db: Queryable,
    m: NeueMail,
): Promise<{ id: number; ausgang: number | null; neu: boolean }> {
    const [row] = await rufe(
        () => db<{ ergebnis: { id: number | string; ausgang: number | string | null; neu: boolean } }[]>`
            SELECT avesmaps_community.community_mail_neu(
                ${m.operationId}::uuid, ${m.person}::uuid, ${m.an}, ${m.betreff}, ${m.text}, ${m.domaene}, ${m.grenze}::int
            ) AS ergebnis
        `,
    );
    return {
        id: Number(row?.ergebnis.id),
        ausgang: row?.ergebnis.ausgang == null ? null : Number(row.ergebnis.ausgang),
        neu: row?.ergebnis.neu === true,
    };
}

/** Erneut senden (Migration 0279): eine nicht zugestellte Mail zurück auf „wartet“. `neu` falsch heißt: Sie war nicht in `fehler`, es gibt nichts einzureihen. */
export async function mailErneut(
    db: Queryable,
    s: { operationId?: string; id: number; nachricht: number; person: string },
): Promise<{ ausgang: number; neu: boolean }> {
    const [row] = await rufe(
        () => db<{ ergebnis: { ausgang: number | string; neu: boolean } }[]>`
            SELECT avesmaps_community.community_mail_erneut(${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.nachricht}::bigint, ${s.person}::uuid) AS ergebnis
        `,
    );
    return { ausgang: Number(row?.ergebnis.ausgang), neu: row?.ergebnis.neu === true };
}

/** Ins Archiv: der Abschluss einer Anfrage, ein Klick ohne Begründung (Ergebnis `beantwortet` oder `erledigt`). */
export async function anfrageArchivieren(db: Queryable, s: Schritt): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_anfrage_archivieren(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

/** Zurück in den Eingang: aus dem Archiv (oder abgeschlossen), ohne Grund. */
export async function anfrageZurueckholen(db: Queryable, s: Schritt): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_anfrage_zurueckholen(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

export interface AlsMeldung {
    operationId: string;
    anfrage: number;
    person: string;
    revision: number;
    kategorie: string;
    text: string;
    quelle?: string | undefined;
    fehltArt?: string | undefined;
    bezug: MeldungBezug;
    antwort?: string | undefined;
}

/** „Als Meldung weiterführen“: legt eine Meldung an (ohne Melderdaten), verknüpft beide und beendet die Anfrage. Gibt die Kennung der neuen Meldung zurück. */
export async function alsMeldung(db: Queryable, m: AlsMeldung): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_community.community_als_meldung(
                ${m.operationId}::uuid, ${m.anfrage}::bigint, ${m.person}::uuid, ${m.revision}::int, ${m.kategorie}, ${m.text},
                ${m.quelle ?? null}, ${m.fehltArt ?? null}, ${db.json(m.bezug as never)}::jsonb, ${m.antwort ?? null}
            )::text AS id
        `,
    );
    return Number(row?.id);
}

export async function personenbezugLoeschen(
    db: Queryable,
    s: { operationId?: string; id: number; person: string },
): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.community_personenbezug_loeschen(${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid)
                AS revision
        `,
    );
    return Number(row?.revision);
}

// --- Redaktion: Lesen ---

interface ZeilenRow {
    id: string;
    art: VorgangZeile["art"];
    kategorie: string;
    zustand: VorgangZeile["zustand"];
    ergebnis: VorgangZeile["ergebnis"];
    prioritaet: VorgangZeile["prioritaet"];
    eingang: VorgangZeile["eingang"];
    bezug_name: string | null;
    bezug_art: VorgangZeile["bezugArt"];
    zustaendig_id: string | null;
    zustaendig_name: string | null;
    ohne_quelle: boolean;
    dublette: string | null;
    eingegangen_at: Date;
    aktiv_at: Date;
    revision: number;
    /** Nur Anfragen (Reiter Mails): Name, sonst Adresse; der Betreff; ob eine Antwort ausging. Meldungen und Abfragen ohne Kontakt: `null`. */
    absender: string | null;
    betreff: string | null;
    beantwortet: boolean | null;
    /** Die zugewiesenen Sonderrollen mit „mein“ (WI-0279); `null` ohne Rollen, `undefined` ohne Leserecht an den neuen Tafeln. */
    rollen?: { sonderrolle: string; mein: boolean }[] | null;
    mein?: boolean | null;
}

const zeileAus = (row: ZeilenRow): VorgangZeile => ({
    nummer: comNummer(row.id),
    art: row.art,
    kategorie: row.kategorie,
    zustand: row.zustand,
    ergebnis: row.ergebnis,
    prioritaet: row.prioritaet,
    eingang: row.eingang,
    bezugName: row.bezug_name,
    bezugArt: row.bezug_art,
    zustaendig: row.zustaendig_id === null ? null : { id: row.zustaendig_id, name: row.zustaendig_name ?? "" },
    ohneQuelle: row.ohne_quelle,
    moeglicheDublette: row.dublette === null ? null : comNummer(row.dublette),
    eingegangenAt: row.eingegangen_at.toISOString(),
    aktivAt: row.aktiv_at.toISOString(),
    revision: row.revision,
    ...(row.art === "anfrage"
        ? { absender: row.absender, betreff: row.betreff, beantwortet: row.beantwortet === true }
        : {}),
    ...(row.art === "meldung" && row.rollen !== undefined
        ? { rollen: rollenGeordnetMitMein(row.rollen ?? []), mein: row.mein === true }
        : {}),
});

/** Die Rollen einer Zeile in der Reihenfolge des Katalogs; was der Katalog nicht kennt, fällt weg. */
const rollenGeordnetMitMein = (rollen: readonly { sonderrolle: string; mein: boolean }[]) =>
    rollenGeordnet(rollen.map((rolle) => rolle.sonderrolle)).map((sonderrolle) => ({
        sonderrolle,
        mein: rollen.some((rolle) => rolle.sonderrolle === sonderrolle && rolle.mein),
    }));

/**
 * Meine Sonderrollen für „Meine“ (WI-0279, `rollen.ts` `meineRollen`): die ohne Region und die regionalen je Region. Fehlen sie, sind die Rollen der Meldungen (noch) nicht
 * lesbar; dann trägt keine Zeile Rollen, und „Meine“ ist nur die Person.
 */
export interface MeineRollen {
    readonly global: readonly string[];
    readonly regional: readonly { readonly rolle: string; readonly region: string }[];
}

/** Ist diese Rolle der Zeile meine? Fragment über `vorgang_rolle r`. */
function meinSql(db: Queryable, meine: MeineRollen) {
    return db`(r.sonderrolle = ANY(${[...meine.global]}::text[])
        OR EXISTS (SELECT 1 FROM unnest(${meine.regional.map((m) => m.rolle)}::text[], ${meine.regional.map((m) => m.region)}::uuid[]) AS m(rolle, region)
                    JOIN avesmaps_community.vorgang_region g ON g.vorgang_id = r.vorgang_id AND g.region_public_id = m.region
                   WHERE m.rolle = r.sonderrolle))`;
}

/**
 * Die Spalten, die nur Anfragen füllen (Reiter Mails): der Absender, der Betreff (erste Zeile der ersten Nachricht, gekürzt) und ob eine Antwort ausging. `kontakt` falsch heißt: kein Absender,
 * nie ein Name und nie eine Adresse. Der Fragment gehört in ein SELECT über `vorgang v` und `melder mm`.
 */
function anfrageSpaltenSql(db: Queryable, kontakt: boolean) {
    return db`
        CASE WHEN v.art = 'anfrage' AND ${kontakt}::boolean THEN COALESCE(mm.name, mm.mail) END AS absender,
        CASE WHEN v.art = 'anfrage' AND ${kontakt}::boolean THEN COALESCE(
            (SELECT left(btrim(split_part(btrim(n.text), chr(10), 1)), ${COMMUNITY_GRENZEN.betreffMax}::int)
               FROM avesmaps_community.nachricht n WHERE n.vorgang_id = v.id AND n.richtung = 'ein' ORDER BY n.at, n.id LIMIT 1),
            -- Eine Mail, die die Redaktion begonnen hat (WI-0268 C6a), hat keine Nachricht des Absenders: Ihr Betreff ist der der ersten Mail, ohne die Nummer dahinter.
            (SELECT left(regexp_replace(a.betreff, ' [[]COM-[0-9]+[]]$', ''), ${COMMUNITY_GRENZEN.betreffMax}::int)
               FROM avesmaps_community.mail_ausgang a JOIN avesmaps_community.nachricht n ON n.id = a.nachricht_id
              WHERE n.vorgang_id = v.id ORDER BY n.at, n.id LIMIT 1)
        ) END AS betreff,
        CASE WHEN v.art = 'anfrage' THEN EXISTS (
            SELECT 1 FROM avesmaps_community.nachricht n WHERE n.vorgang_id = v.id AND n.richtung = 'aus'
        ) END AS beantwortet
    `;
}

/**
 * Die Liste eines Segments (Bedienkonzept §4). Offen: ○ ◐ ◑ ohne Papierkorb; Erledigt: abgeschlossen, nicht archiviert, nicht im Papierkorb;
 * Archiv; Papierkorb; bei Mails der Eingang (nicht im Archiv, nicht im Papierkorb). Die Suche läuft auf dem Server über Nummer, Bezug, Quelle und die Texte (Meldung,
 * Nachrichten, Notizen).
 *
 * 🔴 **Kontaktdaten stehen nur mit `kontakt`** (WI-0268 C4, `read_mailbox`): Ohne sie zeigt keine Zeile einen Absender, und die Suche sucht nicht in Namen und Adressen. Die Route
 * setzt es genau für die Liste der Anfragen, die sie nur mit dem Recht ausliefert.
 */
export async function liste(
    db: Queryable,
    optionen: {
        segment: ListenAnfrageSegment;
        art?: VorgangZeile["art"];
        q?: string;
        person: string;
        kontakt?: boolean;
        /** Meine Sonderrollen (WI-0279); ohne sie trägt keine Zeile Rollen, und „Meine“ ist nur die Person. */
        rollen?: MeineRollen | undefined;
    },
): Promise<VorgangListe> {
    const { segment, person } = optionen;
    const meine = optionen.rollen;
    const rollenSpalten =
        meine === undefined
            ? db``
            : db`,
               (SELECT json_agg(json_build_object('sonderrolle', r.sonderrolle, 'mein', ${meinSql(db, meine)}) ORDER BY r.sonderrolle)
                  FROM avesmaps_community.vorgang_rolle r WHERE r.vorgang_id = v.id) AS rollen,
               (v.zustaendig IS NOT DISTINCT FROM ${person}::uuid
                OR EXISTS (SELECT 1 FROM avesmaps_community.vorgang_rolle r WHERE r.vorgang_id = v.id AND ${meinSql(db, meine)})) AS mein`;
    // Die Zahl am Unterreiter (WI-0279): offen und niemand zuständig (keine Person, keine Rolle) oder meins (Person oder Rolle).
    const meineZahl =
        meine === undefined
            ? db`zustand <> 'abgeschlossen' AND (zustaendig IS NULL OR zustaendig = ${person}::uuid)`
            : db`zustand <> 'abgeschlossen' AND (
                  (zustaendig IS NULL AND NOT EXISTS (SELECT 1 FROM avesmaps_community.vorgang_rolle r WHERE r.vorgang_id = v.id))
                  OR zustaendig = ${person}::uuid
                  OR EXISTS (SELECT 1 FROM avesmaps_community.vorgang_rolle r WHERE r.vorgang_id = v.id AND ${meinSql(db, meine)}))`;
    const art = optionen.art ?? null;
    const kontakt = optionen.kontakt === true;
    const q = optionen.q?.trim() ?? "";
    const nummer = q === "" ? null : (leseCom(q) ?? null);
    const muster = q === "" ? null : `%${q.replace(/[\\%_]/gu, (zeichen) => `\\${zeichen}`)}%`;
    const anfrageSpalten = anfrageSpaltenSql(db, kontakt);
    const rows = await db<ZeilenRow[]>`
        SELECT v.id::text, v.art, v.kategorie, v.zustand, v.ergebnis, v.prioritaet, v.eingang,
               COALESCE(b.name, b.naechster_ort) AS bezug_name, b.art AS bezug_art,
               v.zustaendig::text AS zustaendig_id, p.display_name AS zustaendig_name,
               (v.art = 'meldung' AND v.kategorie <> 'bewertung' AND v.quelle IS NULL) AS ohne_quelle,
               (SELECT d.id::text FROM avesmaps_community.vorgang d JOIN avesmaps_community.bezug db ON db.vorgang_id = d.id
                 WHERE b.objekt_id IS NOT NULL AND db.objekt_id = b.objekt_id AND db.bewertung_id IS NOT DISTINCT FROM b.bewertung_id
                   AND d.id <> v.id AND d.zustand <> 'abgeschlossen'
                 ORDER BY d.id LIMIT 1) AS dublette,
               v.eingegangen_at, v.aktiv_at, v.revision,
               ${anfrageSpalten}${rollenSpalten}
          FROM avesmaps_community.vorgang v
          LEFT JOIN LATERAL (SELECT * FROM avesmaps_community.bezug x WHERE x.vorgang_id = v.id ORDER BY x.id LIMIT 1) b ON true
          LEFT JOIN avesmaps_auth.person p ON p.id = v.zustaendig
          LEFT JOIN avesmaps_community.melder mm ON mm.vorgang_id = v.id
         WHERE (${art}::text IS NULL OR v.art = ${art})
           AND CASE ${segment}
                   WHEN 'offen' THEN v.zustand <> 'abgeschlossen'
                   WHEN 'eingang' THEN v.archiviert_at IS NULL AND v.papierkorb_at IS NULL
                   WHEN 'erledigt' THEN v.zustand = 'abgeschlossen' AND v.archiviert_at IS NULL AND v.papierkorb_at IS NULL
                   WHEN 'archiv' THEN v.archiviert_at IS NOT NULL
                   ELSE v.papierkorb_at IS NOT NULL
               END
           AND (${muster}::text IS NULL
                OR v.id = ${nummer}::bigint
                OR b.name ILIKE ${muster} OR b.naechster_ort ILIKE ${muster} OR v.quelle ILIKE ${muster}
                OR (${kontakt}::boolean AND (mm.name ILIKE ${muster} OR mm.mail ILIKE ${muster}))
                OR EXISTS (SELECT 1 FROM avesmaps_community.nachricht n WHERE n.vorgang_id = v.id AND n.text ILIKE ${muster})
                OR EXISTS (SELECT 1 FROM avesmaps_community.notiz n WHERE n.vorgang_id = v.id AND n.text ILIKE ${muster}))
         ORDER BY v.eingegangen_at DESC, v.id DESC
         LIMIT 500
    `;
    const [z] = await db<
        {
            offen: number;
            erledigt: number;
            archiv: number;
            papierkorb: number;
            meine: number;
            neu: number;
            in_arbeit: number;
            rueckfrage: number;
            eingang: number;
        }[]
    >`
        SELECT count(*) FILTER (WHERE zustand <> 'abgeschlossen')::int AS offen,
               count(*) FILTER (WHERE archiviert_at IS NULL AND papierkorb_at IS NULL)::int AS eingang,
               count(*) FILTER (WHERE zustand = 'abgeschlossen' AND archiviert_at IS NULL AND papierkorb_at IS NULL)::int AS erledigt,
               count(*) FILTER (WHERE archiviert_at IS NOT NULL)::int AS archiv,
               count(*) FILTER (WHERE papierkorb_at IS NOT NULL)::int AS papierkorb,
               count(*) FILTER (WHERE ${meineZahl})::int AS meine,
               count(*) FILTER (WHERE zustand = 'neu')::int AS neu,
               count(*) FILTER (WHERE zustand = 'in_arbeit')::int AS in_arbeit,
               count(*) FILTER (WHERE zustand = 'rueckfrage')::int AS rueckfrage
          FROM avesmaps_community.vorgang v
         WHERE (${art}::text IS NULL OR art = ${art})
    `;
    return {
        zeilen: rows.map(zeileAus),
        zaehler: {
            offen: z?.offen ?? 0,
            erledigt: z?.erledigt ?? 0,
            archiv: z?.archiv ?? 0,
            papierkorb: z?.papierkorb ?? 0,
            meine: z?.meine ?? 0,
            neu: z?.neu ?? 0,
            inArbeit: z?.in_arbeit ?? 0,
            rueckfrage: z?.rueckfrage ?? 0,
            eingang: z?.eingang ?? 0,
        },
    };
}

/**
 * Ein Vorgang mit Bezug, Melder und Verlauf aus Nachrichten, Notizen und Ereignissen. `null`, wenn es ihn nicht gibt.
 *
 * 🔴 **Kontaktdaten nur mit `kontakt`** (WI-0268 C4, `read_mailbox`): die Adresse des Melders, seine früheren Vorgänge und bei Anfragen der Absender in der Zeile. Ohne bleibt der Melder, was er war:
 * Name und Rückwege.
 */
export async function detail(
    db: Queryable,
    id: number,
    optionen: { kontakt?: boolean } = {},
): Promise<VorgangDetail | null> {
    const kontakt = optionen.kontakt === true;
    const anfrageSpalten = anfrageSpaltenSql(db, kontakt);
    const [zeile] = await db<(ZeilenRow & { quelle: string | null; fehlt_art: string | null })[]>`
        SELECT v.id::text, v.art, v.kategorie, v.zustand, v.ergebnis, v.prioritaet, v.eingang, v.quelle, v.fehlt_art,
               COALESCE(b.name, b.naechster_ort) AS bezug_name, b.art AS bezug_art,
               v.zustaendig::text AS zustaendig_id, p.display_name AS zustaendig_name,
               (v.art = 'meldung' AND v.kategorie <> 'bewertung' AND v.quelle IS NULL) AS ohne_quelle,
               (SELECT d.id::text FROM avesmaps_community.vorgang d JOIN avesmaps_community.bezug db ON db.vorgang_id = d.id
                 WHERE b.objekt_id IS NOT NULL AND db.objekt_id = b.objekt_id AND db.bewertung_id IS NOT DISTINCT FROM b.bewertung_id
                   AND d.id <> v.id AND d.zustand <> 'abgeschlossen'
                 ORDER BY d.id LIMIT 1) AS dublette,
               v.eingegangen_at, v.aktiv_at, v.revision,
               ${anfrageSpalten}
          FROM avesmaps_community.vorgang v
          LEFT JOIN LATERAL (SELECT * FROM avesmaps_community.bezug x WHERE x.vorgang_id = v.id ORDER BY x.id LIMIT 1) b ON true
          LEFT JOIN avesmaps_auth.person p ON p.id = v.zustaendig
          LEFT JOIN avesmaps_community.melder mm ON mm.vorgang_id = v.id
         WHERE v.id = ${id}::bigint
    `;
    if (zeile === undefined) return null;
    const [vorgang] = await db<{ papierkorb_at: Date | null; archiviert_at: Date | null }[]>`
        SELECT papierkorb_at, archiviert_at FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
    `;
    const [bezug] = await db<
        {
            art: "objekt" | "stelle";
            objekt_art: NonNullable<VorgangDetail["bezug"]>["objektArt"];
            objekt_id: string | null;
            name: string | null;
            typ: string | null;
            lage_x: number | null;
            lage_y: number | null;
            vorschlag_x: number | null;
            vorschlag_y: number | null;
            naechster_ort: string | null;
            bewertung_id: string | null;
            bewertung_grund: string | null;
            reisebild_id: string | null;
        }[]
    >`
        SELECT art, objekt_art, objekt_id::text, name, typ, lage_x, lage_y, vorschlag_x, vorschlag_y, naechster_ort,
               bewertung_id::text, bewertung_grund, reisebild_id::text
          FROM avesmaps_community.bezug WHERE vorgang_id = ${id}::bigint ORDER BY id LIMIT 1
    `;
    const [melder] = await db<
        {
            name: string | null;
            statuslink: boolean;
            hat_mail: boolean;
            mail: string | null;
            discord: boolean;
            discord_name: string | null;
            entfernt: boolean;
        }[]
    >`
        SELECT name, schluessel_hash IS NOT NULL AS statuslink, mail IS NOT NULL AS hat_mail,
               CASE WHEN ${kontakt}::boolean THEN mail END AS mail, discord_id IS NOT NULL AS discord,
               CASE WHEN discord_id IS NOT NULL THEN discord_name END AS discord_name,
               entfernt_at IS NOT NULL AS entfernt
          FROM avesmaps_community.melder WHERE vorgang_id = ${id}::bigint
    `;
    // Frühere Vorgänge derselben Adresse (Fachkonzept §2.1: nur über einen gesicherten Schlüssel, die Adresse genau, ohne Groß- und Kleinschreibung): neueste zuerst, höchstens zehn.
    const fruehere =
        kontakt && melder?.mail != null
            ? await db<{ id: string; kategorie: string; ergebnis: VorgangZeile["ergebnis"]; eingegangen_at: Date }[]>`
                  SELECT v.id::text, v.kategorie, v.ergebnis, v.eingegangen_at
                    FROM avesmaps_community.melder m JOIN avesmaps_community.vorgang v ON v.id = m.vorgang_id
                   WHERE lower(m.mail) = lower(${melder.mail}) AND v.id <> ${id}::bigint AND v.papierkorb_at IS NULL
                   ORDER BY v.eingegangen_at DESC, v.id DESC LIMIT 10
              `
            : [];
    // Die Beziehungen aus „Als Meldung weiterführen“, in beide Richtungen.
    const verknuepft = await db<{ richtung: "von" | "zu"; id: string }[]>`
        SELECT 'von' AS richtung, ziel_vorgang::text AS id FROM avesmaps_community.verknuepfung
         WHERE vorgang_id = ${id}::bigint AND art = 'gehoert_zu'
        UNION ALL
        SELECT 'zu', vorgang_id::text FROM avesmaps_community.verknuepfung
         WHERE ziel_vorgang = ${id}::bigint AND art = 'gehoert_zu'
         ORDER BY 1, 2
    `;
    const [dublette] = await db<{ ziel: string }[]>`
        SELECT ziel_vorgang::text AS ziel FROM avesmaps_community.verknuepfung
         WHERE vorgang_id = ${id}::bigint AND art = 'dublette_von' ORDER BY id DESC LIMIT 1
    `;
    const korrekturen = await korrekturenVon(db, id);
    const kanal = await db<{ ziel: string }[]>`
        SELECT ziel FROM avesmaps_community.verknuepfung WHERE vorgang_id = ${id}::bigint AND art = 'ops' ORDER BY id
    `;
    const verlauf = await db<
        {
            art: "nachricht" | "notiz" | "ereignis";
            richtung: "ein" | "aus" | null;
            weg: string | null;
            ereignis: string | null;
            alt: string | null;
            neu: string | null;
            text: string | null;
            von_id: string | null;
            von_name: string | null;
            vom_melder: boolean;
            at: Date;
            nr: string | number;
            za_zustand: "wartet" | "gesendet" | "fehler" | null;
            za_fehler: string | null;
            za_an: string | null;
            za_betreff: string | null;
        }[]
    >`
        SELECT * FROM (
            SELECT 'nachricht' AS art, n.richtung, n.weg, NULL AS ereignis, NULL AS alt, NULL AS neu, n.text,
                   n.von_person::text AS von_id, p.display_name AS von_name, false AS vom_melder, n.at, 1 AS ordnung, n.id AS nr,
                   x.zustand AS za_zustand, x.fehler AS za_fehler, CASE WHEN ${kontakt}::boolean THEN x.an END AS za_an, x.betreff AS za_betreff
              FROM avesmaps_community.nachricht n LEFT JOIN avesmaps_auth.person p ON p.id = n.von_person
              LEFT JOIN avesmaps_community.mail_ausgang x ON x.nachricht_id = n.id
             WHERE n.vorgang_id = ${id}::bigint
            UNION ALL
            SELECT 'notiz', NULL, NULL, NULL, NULL, NULL, o.text, o.von_person::text, p.display_name, false, o.at, 2, o.id, NULL, NULL, NULL, NULL
              FROM avesmaps_community.notiz o LEFT JOIN avesmaps_auth.person p ON p.id = o.von_person
             WHERE o.vorgang_id = ${id}::bigint
            UNION ALL
            SELECT 'ereignis', NULL, NULL, e.art, e.alt, e.neu, e.text, e.von_person::text, p.display_name, e.vom_melder, e.at, 0, e.seq, NULL, NULL, NULL, NULL
              FROM avesmaps_community.ereignis e LEFT JOIN avesmaps_auth.person p ON p.id = e.von_person
             WHERE e.vorgang_id = ${id}::bigint
        ) alle
        ORDER BY at, ordnung, nr
    `;
    // Eingehende Mails (WI-0268 C6b): Betreff, bereinigtes HTML und Anhänge, nur mit `kontakt` (`read_mailbox`). Das HTML trägt Adressen dieser App für eingebettete Bilder; die Datei selbst liefert die Route.
    // 🔴 Bilder einer Meldung aus dem Betreiber-Kanal (WI-0297, Weg `discord`) sieht auch, wer nur Meldungen bearbeitet: Sie sind Teil der Meldung, kein Mailanhang.
    const mailInhalte = new Map<string, MailInhalt>();
    {
        const mailRows = kontakt
            ? await db<
                  {
                      nachricht: string;
                      betreff: string;
                      html: string | null;
                      extern_bilder: number;
                      hinweis: MailInhalt["hinweis"];
                  }[]
              >`
                  SELECT e.nachricht_id::text AS nachricht, e.betreff, e.html, e.extern_bilder, e.hinweis
                    FROM avesmaps_community.mail_eingang e JOIN avesmaps_community.nachricht n ON n.id = e.nachricht_id
                   WHERE n.vorgang_id = ${id}::bigint
              `
            : [];
        const anhangRows = await db<
            {
                id: string;
                nachricht: string;
                dateiname: string;
                mime: string;
                groesse: number;
                da: boolean;
                gesperrt: boolean;
                grund: MailInhalt["anhaenge"][number]["grund"];
            }[]
        >`
            SELECT x.id::text, x.nachricht_id::text AS nachricht, x.dateiname, x.mime, x.groesse::bigint::int AS groesse,
                   x.datei IS NOT NULL AS da, x.gesperrt, x.grund
              FROM avesmaps_community.mail_anhang x JOIN avesmaps_community.nachricht n ON n.id = x.nachricht_id
             WHERE n.vorgang_id = ${id}::bigint AND (${kontakt}::boolean OR n.weg = 'discord')
             ORDER BY x.id
        `;
        const anhaengeVon = (nachricht: string): MailInhalt["anhaenge"] =>
            anhangRows
                .filter((x) => x.nachricht === nachricht)
                .map((x) => ({
                    id: Number(x.id),
                    name: x.dateiname,
                    groesse: x.groesse,
                    mime: x.mime,
                    gesperrt: x.gesperrt,
                    grund: x.grund,
                    vorschau: x.da && !x.gesperrt && ANSEHBARE_MIME.has(x.mime),
                }));
        for (const m of mailRows) {
            mailInhalte.set(m.nachricht, {
                betreff: m.betreff,
                html: m.html,
                externBilder: m.extern_bilder,
                hinweis: m.hinweis,
                anhaenge: anhaengeVon(m.nachricht),
            });
        }
        // Eine Meldung aus dem Betreiber-Kanal (WI-0297) hat keine Mail, aber vielleicht Bilder: dieselbe Darstellung, ohne Betreff und ohne HTML.
        for (const nachricht of new Set(anhangRows.map((x) => x.nachricht))) {
            if (mailInhalte.has(nachricht)) continue;
            mailInhalte.set(nachricht, {
                betreff: "",
                html: null,
                externBilder: 0,
                hinweis: null,
                anhaenge: anhaengeVon(nachricht),
            });
        }
    }
    const person = (vonId: string | null, vonName: string | null) =>
        vonId === null ? null : { id: vonId, name: vonName ?? "" };
    const lage = (x: number | null, y: number | null) => (x === null || y === null ? null : { x, y });
    // Kasten „Zuständig“ (WI-0279): das jüngste Ereignis, das die jetzige Person einsetzte (zuständig gesetzt oder übernommen).
    const eingesetzt =
        zeile.zustaendig_id === null
            ? undefined
            : verlauf.findLast(
                  (e) =>
                      e.art === "ereignis" &&
                      (e.ereignis === "zustaendig" || e.ereignis === "uebernommen") &&
                      e.neu === zeile.zustaendig_id,
              );
    return {
        zeile: zeileAus(zeile),
        quelle: zeile.quelle,
        fehltArt: zeile.fehlt_art,
        bezug:
            bezug === undefined
                ? null
                : {
                      art: bezug.art,
                      objektArt: bezug.objekt_art,
                      objektId: bezug.objekt_id,
                      name: bezug.name,
                      typ: bezug.typ,
                      lage: lage(bezug.lage_x, bezug.lage_y),
                      vorschlagLage: lage(bezug.vorschlag_x, bezug.vorschlag_y),
                      naechsterOrt: bezug.naechster_ort,
                      bewertungId: bezug.bewertung_id,
                      bewertungGrund: bezug.bewertung_grund,
                      reisebildId: bezug.reisebild_id,
                  },
        melder: {
            name: melder?.name ?? null,
            rueckwege: [
                ...(melder?.statuslink === true ? (["statusseite"] as const) : []),
                ...(melder?.hat_mail === true ? (["mail"] as const) : []),
                ...(melder?.discord === true ? (["discord"] as const) : []),
            ],
            ...(melder?.discord_name == null ? {} : { discordName: melder.discord_name }),
            entfernt: melder?.entfernt === true,
            ...(kontakt
                ? {
                      mail: melder?.mail ?? null,
                      fruehere: fruehere.map((f) => ({
                          nummer: comNummer(f.id),
                          kategorie: f.kategorie,
                          ergebnis: f.ergebnis,
                          eingegangenAt: f.eingegangen_at.toISOString(),
                      })),
                  }
                : {}),
        },
        ...(verknuepft.length === 0
            ? {}
            : {
                  verknuepft: verknuepft.map((v) => ({
                      art: "gehoert_zu" as const,
                      richtung: v.richtung,
                      nummer: comNummer(v.id),
                  })),
              }),
        ...(korrekturen.length === 0 ? {} : { korrekturen }),
        ...(kanal.length === 0 ? {} : { kanal: kanal.map((k) => ({ nummer: k.ziel })) }),
        dubletteVon: dublette === undefined ? null : comNummer(dublette.ziel),
        papierkorbAt: vorgang?.papierkorb_at?.toISOString() ?? null,
        archiviertAt: vorgang?.archiviert_at?.toISOString() ?? null,
        ...(eingesetzt === undefined
            ? {}
            : {
                  zustaendigSeit: {
                      von: person(eingesetzt.von_id, eingesetzt.von_name),
                      at: eingesetzt.at.toISOString(),
                  },
              }),
        verlauf: verlauf.map((e): VerlaufEintrag => {
            if (e.art === "nachricht") {
                return {
                    art: "nachricht",
                    richtung: e.richtung ?? "ein",
                    weg: e.weg ?? "",
                    text: e.text,
                    von: person(e.von_id, e.von_name),
                    at: e.at.toISOString(),
                    // Eine Mail (WI-0268 C6a) trägt ihre Kennung und ihren Zustellstand; die Adresse nur mit `kontakt`.
                    ...(e.weg === "mail" && e.za_zustand !== null
                        ? {
                              id: Number(e.nr),
                              zustellung: {
                                  zustand: e.za_zustand,
                                  grund: e.za_fehler,
                                  an: e.za_an,
                                  betreff: e.za_betreff ?? "",
                              },
                          }
                        : {}),
                    // Eine eingehende Mail (WI-0268 C6b) trägt Betreff, bereinigtes HTML und Anhänge (nur mit `kontakt`).
                    ...((e.weg === "mail" || e.weg === "discord") && mailInhalte.has(String(e.nr))
                        ? { id: Number(e.nr), mail: mailInhalte.get(String(e.nr)) as MailInhalt }
                        : {}),
                };
            }
            if (e.art === "notiz") {
                return { art: "notiz", text: e.text ?? "", von: person(e.von_id, e.von_name), at: e.at.toISOString() };
            }
            return {
                art: "ereignis",
                ereignis: e.ereignis ?? "",
                alt: e.alt,
                neu: e.neu,
                text: e.text,
                von: person(e.von_id, e.von_name),
                vomMelder: e.vom_melder,
                at: e.at.toISOString(),
            };
        }),
    };
}

// --- Verknüpfungen (WI-0268 C7; Migration 0272 und 0273) ---

interface OperationRow {
    operation_id: string;
    action: string;
    summary: string | null;
    at: Date;
    von_id: string | null;
    von_name: string | null;
}

const personVon = (vonId: string | null, vonName: string | null) =>
    vonId === null ? null : { id: vonId, name: vonName ?? "" };

/** Eine Operation als Zeile des Vorgangs. Wer sie schrieb, steht nur bei einer Person (Agent, Import und System haben keinen Namen). */
const operationAus = (row: OperationRow) => ({
    operationId: row.operation_id,
    aktion: row.action,
    zusammenfassung: row.summary,
    at: row.at.toISOString(),
    von: personVon(row.von_id, row.von_name),
});

/**
 * Die Korrekturen eines Vorgangs, neueste zuerst: die Operationen, die der Editor mit ihm als Herkunft schrieb (`map_operation.community_vorgang`), und die von Hand verknüpften
 * (`verknuepfung.art = 'korrektur'`, `ziel` ist die Kennung der Operation). Eine Operation steht höchstens einmal da, mit dem Weg `editor`, wenn beides gilt.
 */
async function korrekturenVon(db: Queryable, id: number): Promise<VorgangKorrektur[]> {
    const rows = await db<(OperationRow & { weg: VorgangKorrektur["weg"]; seq: string })[]>`
        SELECT DISTINCT ON (k.operation_id) k.operation_id::text AS operation_id, k.action, k.summary, k.at,
               k.actor_person_id::text AS von_id, p.display_name AS von_name, k.weg, k.seq::text AS seq
          FROM (
              SELECT o.operation_id, o.action, o.summary, o.at, o.actor_person_id, o.seq, 'editor' AS weg
                FROM public.map_operation o
               WHERE o.community_vorgang = ${id}::bigint
              UNION ALL
              SELECT o.operation_id, o.action, o.summary, o.at, o.actor_person_id, o.seq, 'hand' AS weg
                FROM avesmaps_community.verknuepfung v
                JOIN public.map_operation o ON o.operation_id = (
                         CASE WHEN v.ziel ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v.ziel::uuid END)
               WHERE v.vorgang_id = ${id}::bigint AND v.art = 'korrektur'
          ) k
          LEFT JOIN avesmaps_auth.person p ON p.id = k.actor_person_id
         ORDER BY k.operation_id, k.weg
    `;
    return rows
        .sort((a, b) => b.at.getTime() - a.at.getTime() || Number(b.seq) - Number(a.seq))
        .map((row) => ({ ...operationAus(row), weg: row.weg }));
}

/** Das Fachprotokoll nennt ein Objekt je Art in einer eigenen Spalte (`map_audit_event`); die Spalte ist fest, nie aus der Anfrage. `area` ist die Fläche der Derographie, ihre Kennung die der Region. */
const AUDIT_SPALTE: Readonly<Record<BezugObjektart, string>> = {
    place: "place_public_id",
    path: "path_public_id",
    area: "region_public_id",
    territory: "territory_public_id",
    peak: "peak_public_id",
    powerline: "powerline_public_id",
};
/** So viele Operationen bietet „Korrektur verknüpfen“ an. */
const KANDIDATEN = 15;

/**
 * Die Operationen, aus denen die Redaktion eine Korrektur verknüpfen kann (Bedienkonzept „Korrektur verknüpfen“): Hat der Vorgang ein Kartenobjekt zum Bezug, die letzten 15, die dieses Objekt
 * berührten; sonst die letzten 15 eigenen der Person. Nur Operationen des Editors und Rücknahmen (nie Import, Testwelt oder WikiSync); was schon zum Vorgang gehört, fehlt. `null`, wenn es den Vorgang nicht gibt.
 *
 * Zum Weg und zur Kraftlinie nennt der Bezug einen Abschnitt; die Operationen an den anderen Abschnitten derselben Linie stehen hier nicht, sie lassen sich in „Änderungen“ von Hand wählen.
 */
export async function korrekturKandidaten(
    db: Queryable,
    id: number,
    person: string,
): Promise<KorrekturKandidaten | null> {
    const [vorgang] = await db<{ da: boolean }[]>`
        SELECT true AS da FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
    `;
    if (vorgang === undefined) return null;
    const [bezug] = await db<{ objekt_art: BezugObjektart | null; objekt_id: string | null }[]>`
        SELECT objekt_art, objekt_id::text FROM avesmaps_community.bezug
         WHERE vorgang_id = ${id}::bigint AND art = 'objekt' ORDER BY id LIMIT 1
    `;
    const spalte = bezug?.objekt_art == null ? undefined : AUDIT_SPALTE[bezug.objekt_art];
    const objektId = bezug?.objekt_id ?? undefined;
    const beiObjekt = spalte !== undefined && objektId !== undefined;
    const rows = await db<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.action, o.summary, o.at, o.actor_person_id::text AS von_id, p.display_name AS von_name
          FROM public.map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE o.source IN ('editor', 'restore')
           AND o.community_vorgang IS DISTINCT FROM ${id}::bigint
           AND NOT EXISTS (SELECT 1 FROM avesmaps_community.verknuepfung v
                            WHERE v.vorgang_id = ${id}::bigint AND v.art = 'korrektur' AND v.ziel = o.operation_id::text)
           AND ${
               beiObjekt
                   ? db`EXISTS (SELECT 1 FROM public.map_audit_event e
                                 WHERE e.operation_id = o.operation_id AND e.${db(spalte)} = ${objektId}::uuid)`
                   : db`o.actor_person_id = ${person}::uuid`
           }
         ORDER BY o.seq DESC
         LIMIT ${KANDIDATEN}
    `;
    return { quelle: beiObjekt ? "objekt" : "sitzung", kandidaten: rows.map(operationAus) };
}

/**
 * Hängt eine Korrektur (`korrektur`, Kennung einer Operation) oder einen Kanal-Vorgang (`ops`, `OPS-000134`) an einen Vorgang. Dieselbe Verknüpfung zweimal ergibt eine Zeile; weder Zustand noch Revision
 * ändern sich. Gibt die Kennung der Verknüpfung zurück.
 */
export async function verknuepfen(
    db: Queryable,
    v: { id: number; person: string; art: "korrektur" | "ops"; ziel: string },
): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_community.community_verknuepfen(${v.id}::bigint, ${v.person}::uuid, ${v.art}, ${v.ziel})::text AS id
        `,
    );
    return Number(row?.id);
}

/** Gibt es die Verknüpfung schon? (Der Eintrag im Protokoll entsteht nur beim ersten Mal.) */
export async function istVerknuepft(
    db: Queryable,
    v: { id: number; art: "korrektur" | "ops"; ziel: string },
): Promise<boolean> {
    const [row] = await db<{ da: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM avesmaps_community.verknuepfung WHERE vorgang_id = ${v.id}::bigint AND art = ${v.art} AND ziel = ${v.ziel}) AS da
    `;
    return row?.da === true;
}

/**
 * Die ausgehenden Nachrichten der Anfragen, neueste zuerst (Bedienkonzept §3.4, Reiter Mails › Gesendet): eine Sicht, keine eigene Ablage. `an` ist die Adresse nur, wenn die Nachricht
 * wirklich als Mail ging (Mailweg, C6a; der Empfänger des Ausgangs, nach der Frist `null`); eine Antwort auf die Statusseite hat `an` `null`. Bei einer Mail steht dazu der Zustellstand. Vorgänge im Papierkorb fehlen. 🔴 Nur mit `read_mailbox`: Die Route prüft es.
 */
export async function gesendet(db: Queryable, optionen: { q?: string } = {}): Promise<GesendetZeile[]> {
    const q = optionen.q?.trim() ?? "";
    const nummer = q === "" ? null : (leseCom(q) ?? null);
    const muster = q === "" ? null : `%${q.replace(/[\\%_]/gu, (zeichen) => `\\${zeichen}`)}%`;
    const rows = await db<
        {
            id: string;
            an: string | null;
            betreff: string | null;
            text: string | null;
            at: Date;
            von_id: string | null;
            von_name: string | null;
            weg: string;
            za_zustand: "wartet" | "gesendet" | "fehler" | null;
            za_fehler: string | null;
            za_betreff: string | null;
        }[]
    >`
        SELECT n.vorgang_id::text AS id, CASE WHEN n.weg = 'mail' THEN x.an END AS an,
               (SELECT left(btrim(split_part(btrim(e.text), chr(10), 1)), ${COMMUNITY_GRENZEN.betreffMax}::int)
                  FROM avesmaps_community.nachricht e WHERE e.vorgang_id = v.id AND e.richtung = 'ein' ORDER BY e.at, e.id LIMIT 1) AS betreff,
               left(n.text, ${COMMUNITY_GRENZEN.gesendetTextMax}::int) AS text, n.at,
               n.von_person::text AS von_id, p.display_name AS von_name, n.weg,
               x.zustand AS za_zustand, x.fehler AS za_fehler, x.betreff AS za_betreff
          FROM avesmaps_community.nachricht n
          JOIN avesmaps_community.vorgang v ON v.id = n.vorgang_id AND v.art = 'anfrage' AND v.papierkorb_at IS NULL
          LEFT JOIN avesmaps_community.melder m ON m.vorgang_id = v.id
          LEFT JOIN avesmaps_community.mail_ausgang x ON x.nachricht_id = n.id
          LEFT JOIN avesmaps_auth.person p ON p.id = n.von_person
         WHERE n.richtung = 'aus'
           AND (${muster}::text IS NULL
                OR v.id = ${nummer}::bigint
                OR n.text ILIKE ${muster} OR m.mail ILIKE ${muster} OR m.name ILIKE ${muster}
                OR EXISTS (SELECT 1 FROM avesmaps_community.nachricht e WHERE e.vorgang_id = v.id AND e.richtung = 'ein' AND e.text ILIKE ${muster}))
         ORDER BY n.at DESC, n.id DESC
         LIMIT 200
    `;
    return rows.map((row) => ({
        nummer: comNummer(row.id),
        an: row.an,
        betreff: row.betreff,
        text: row.text,
        at: row.at.toISOString(),
        von: row.von_id === null ? null : { id: row.von_id, name: row.von_name ?? "" },
        weg: row.weg,
        ...(row.weg === "mail" && row.za_zustand !== null
            ? {
                  zustellung: {
                      zustand: row.za_zustand,
                      grund: row.za_fehler,
                      an: row.an,
                      betreff: row.za_betreff ?? "",
                  },
              }
            : {}),
    }));
}

/** Die Revision eines Vorgangs (Quittung nach einer Notiz). */
export async function revision(db: Queryable, id: number): Promise<number | null> {
    const [row] = await db<
        { revision: number }[]
    >`SELECT revision FROM avesmaps_community.vorgang WHERE id = ${id}::bigint`;
    return row?.revision ?? null;
}

/** Die Aufbewahrung (Fachkonzept §10.2), mit der Jobs-Rolle. */
export async function aufbewahren(db: Queryable): Promise<{ archiviert: number; kontakt: number; geloescht: number }> {
    const [row] = await db<{ ergebnis: { archiviert: number; kontakt: number; geloescht: number } }[]>`
        SELECT avesmaps_community.community_purge_expired() AS ergebnis
    `;
    return row?.ergebnis ?? { archiviert: 0, kontakt: 0, geloescht: 0 };
}

/**
 * Die Datei eines Anhangs für den Abruf durch die Redaktion (WI-0268 C6b): Name und Art aus der Datenbank, der Name der Datei in der Ablage (SHA-256). `null`, wenn es den Anhang unter diesem Vorgang nicht
 * gibt, er gesperrt ist oder seine Datei fehlt (Frist, Personenbezug). 🔴 Der Pfad entsteht nie aus der Anfrage: Der Vorgang aus der Adresse muss derselbe sein, zu dem die Nachricht des Anhangs gehört, und der
 * Dateiname kommt aus dieser Tafel. Das Recht (`read_mailbox`) prüft die Route. `ausDiscord`: Das Bild gehört zu einer Meldung aus dem Betreiber-Kanal (WI-0297, Weg `discord`);
 * die sieht auch, wer nur Meldungen bearbeitet.
 */
export async function anhangDatei(
    db: Queryable,
    vorgang: number,
    anhang: number,
): Promise<{ name: string; mime: string; datei: string; ausDiscord: boolean } | null> {
    const [row] = await db<{ name: string; mime: string; datei: string; ausDiscord: boolean }[]>`
        SELECT x.dateiname AS name, x.mime, x.datei, (n.weg = 'discord') AS "ausDiscord"
          FROM avesmaps_community.mail_anhang x JOIN avesmaps_community.nachricht n ON n.id = x.nachricht_id
         WHERE x.id = ${anhang}::bigint AND n.vorgang_id = ${vorgang}::bigint AND x.datei IS NOT NULL AND NOT x.gesperrt
    `;
    return row ?? null;
}
