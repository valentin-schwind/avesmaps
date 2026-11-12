import {
    ROLES,
    capabilitiesFor,
    comNummer,
    leseRollenGlocke,
    rollenGlockeDazu,
    rollenGlockeText,
    socNummer,
    sonderrollenMit,
    type Role,
} from "@avesmaps3d/shared";
import type postgres from "postgres";
import type { Queryable } from "../database.ts";
import { asJson } from "../jobs/store.ts";

/**
 * Die Glocke des Community-Moduls (WI-0268 C5; Fachkonzept WI-0263 §7, Bedienkonzept §2.2 Nr. 1 und §2.3 Nr. 3 und 4). Vier Arten, alle über die
 * eine Erzeugerfunktion `public.benachrichtige` (Migration 0107, 0118) und ohne neue Migration:
 *
 * - `community_neu`: eine neue Meldung an alle aktiven Personen mit `moderate_submissions` (Rolle ab Reviewer), **gebündelt**.
 * - `community_nachricht` (WI-0268 C4): eine neue Anfrage aus dem Kontaktformular an alle aktiven Personen mit `read_mailbox` (heute die Betreiber), eine je Anfrage und Person, nicht gebündelt.
 *   Anfragen tragen Namen und Adressen; wer sie nicht lesen darf, bekommt weder diese noch eine Antwort- oder Fristmeldung zu ihnen.
 * - `community_zugewiesen`: eine ANDERE Person wurde zuständig gesetzt; sich selbst zu übernehmen löst nichts aus.
 * - `community_rolle` (WI-0279, `rollenZugewiesen`): eine Meldung bekam eine Sonderrolle; an deren Inhaber außer der Person, die zuweist, beim Eingang von Avesmaps (`system`).
 *   **Gebündelt** je Empfänger, Absender und Rolle, solange ungelesen: Der `text` ist die Rolle mit den Nummern (`leseRollenGlocke`).
 * - `community_antwort`: der Melder antwortete über die Statusseite; an die zuständige Person, sonst an die Bearbeitenden.
 * - `community_frist`: ein Vorgang steht seit 30 Tagen in der Rückfrage; einmal je Rückfrage (`fristen`, täglich aus der Aufbewahrung).
 * - `community_mail_fehler` (WI-0268 C6a): eine ausgehende Mail wurde nicht zugestellt; an die Person, die sie schrieb, einmal je Mail und „Erneut senden“ (`mailFehler`, aus dem Versandjob).
 * - Der Mailabruf (WI-0268 C6b, `mailEingegangen`, aus dem Abrufjob mit der Jobs-Rolle): eine neue Mail im Postfach meldet sich wie das Kontaktformular als `community_nachricht` („Neue Nachricht COM-…“) an alle mit
 *   `read_mailbox`; eine Mail im Faden, auch eine, die einen geschlossenen Vorgang wieder öffnet, als `community_antwort` an die (zuletzt) zuständige Person, ohne Zuständigkeit an alle mit `read_mailbox`.
 * - `photobox_eingang` (WI-0272 S3, Aufgabe 19, `neuesReisebild`): ein neues Reisebild wartet auf Prüfung, an alle mit `moderate_submissions`, **gebündelt** wie `community_neu`; der Text ist leer oder die Zahl.
 * - `bewertung_neu` (Vali 2026-11-04, `neueBewertung`): eine neue Bewertung wartet aufs Sichten, an alle mit `moderate_submissions`, **gebündelt**; der Text ist die Kennung der Bewertung oder die Zahl.
 * - `kartenvorschlag_neu` (WI-0275, `neuerKartenvorschlag`): ein neuer Kartenvorschlag wartet auf die Redaktion, an alle mit `moderate_map_suggestions`, **gebündelt**; der Text ist die Kennung des Vorschlags oder die Zahl.
 *
 * 🔴 **Nie Meldetext, nie der Name des Melders:** Der `text` einer Benachrichtigung ist allein die COM-Nummer (oder bei der Bündelung die Zahl);
 * den Satz baut die Oberfläche aus Art und Nummer (`apps/web/src/auth/benachrichtigungen.ts`). `bezug_ops` bleibt leer, denn dort steht die Nummer
 * des Betreiber-Kanals (OPS-…), und die Glocke liest über sie den Stand des Kanals.
 *
 * - **Bündeln ohne Migration.** `benachrichtige()` legt je (Person, Quelle) genau eine Zeile an und fasst eine vorhandene nie an. Darum sucht
 *   `neueMeldung` je Person die ungelesene `community_neu` und lässt sie wachsen (`text` wird die Zahl, `erstellt_at` die Zeit der jüngsten),
 *   statt eine zweite anzulegen; nur wer keine ungelesene hat, bekommt über `benachrichtige()` eine neue mit der Quelle `community_neu:COM-…` der
 *   ersten Meldung. Gelesen wird die ganze Bündelung auf einmal (das Öffnen der Glocke), die nächste Meldung beginnt die nächste. Die App-Rolle
 *   darf die Zeilen ihrer Tafel ändern (`UPDATE`, wie beim Lesen), nicht anlegen.
 * - **Wiederholungen zählen nicht doppelt:** Gezählt wird nur in der Transaktion, die den Vorgang anlegt (`eingegangen_at = now()`); eine
 *   Wiederholung derselben Kennung findet ihn schon vor und meldet nichts. Eine Sperre je Umgebung hält zwei gleichzeitige Meldungen hintereinander.
 * - **Zuweisung, Antwort, Frist** tragen die Kennung ihrer Handlung (bzw. des Rückfragetags) in der Quelle: dieselbe Handlung meldet nie zweimal.
 *   Eine Antwort des Melders meldet sich nicht noch einmal, solange der Eintrag zum selben Vorgang ungelesen ist (die Statusseite ist öffentlich;
 *   so kann niemand die Glocke einer Person fluten).
 * - **Die Glocke ist ein Hinweis, kein Protokoll:** Scheitert sie, kostet das nie die Handlung (`bestenfalls`, Savepoint).
 */

/**
 * Wer etwas bekommt, rechnet nach dem Recht, nicht nach der Rolle (WI-0279): `moderate_submissions` für Meldungen, `moderate_photobox` für
 * Reisebilder, `read_mailbox` für Anfragen, `moderate_map_suggestions` für Kartenvorschläge. Die Rollen kommen aus dem Katalog der Rechte, die Sonderrollen aus ihren Bündeln.
 */
export type BearbeitendesRecht =
    "moderate_submissions" | "moderate_photobox" | "read_mailbox" | "moderate_map_suggestions";

/** Die Rollen, die dieses Recht aus ihrer Vorlage haben. */
export const rollenMit = (recht: BearbeitendesRecht): Role[] =>
    ROLES.filter((rolle) => capabilitiesFor(rolle).has(recht));

/** Wie lange eine Rückfrage unbeantwortet bleiben darf, bis die Glocke erinnert (Bedienkonzept §2.3 Nr. 4). */
export const FRIST_TAGE = 30;

export interface GlockeLog {
    warn(object: unknown, message: string): void;
}

interface Sendung {
    art:
        | "community_neu"
        | "community_nachricht"
        | "community_zugewiesen"
        | "community_rolle"
        | "community_antwort"
        | "community_frist"
        | "community_mail_fehler"
        | "social_freigabe"
        | "photobox_eingang"
        | "bewertung_neu"
        | "kartenvorschlag_neu";
    /** Die COM-Nummer (oder bei der Bündelung die Zahl): nie ein Text der Meldung. */
    text: string;
    quelle: string;
    von?: { person: string } | undefined;
}

/** Der eine Aufruf von `benachrichtige()`; gibt die Zahl der neuen Zeilen zurück (vorhandene Quelle zählt nicht). */
async function sende(db: Queryable, umgebung: string, an: Record<string, unknown>, s: Sendung): Promise<number> {
    const [row] = await db<{ angelegt: number }[]>`
        SELECT public.benachrichtige(
            ${umgebung}, ${asJson(db, an)}::jsonb, ${s.von === undefined ? "system" : "person"}, ${s.von?.person ?? null}::uuid,
            ${s.art}, NULL, ${s.text}, ${s.quelle}
        ) AS angelegt
    `;
    return row?.angelegt ?? 0;
}

/**
 * Die aktiven Personen dieser Umgebung mit dem Recht, aus der Rolle oder einer Sonderrolle; ohne Angabe die, die Meldungen bearbeiten dürfen.
 * 🔴 Über `community_bearbeitende` (Migration 0305, SECURITY DEFINER, nur Kennungen): Aufträge laufen in der Jobs-Rolle, und die hat an `avesmaps_auth` kein Recht.
 * 🪤 Ohne EXECUTE an der Funktion (`community-grants.psql` kommt hinter der Migration) liest die App wie zuvor direkt, ohne Leserecht an den Sonderrollen nur nach der Rolle:
 * Eine gescheiterte Anweisung bräche die Transaktion ab, in der die Glocke läuft. Dieser Rückfall entfällt im Release nach dem Production-Stand von 0305.
 */
export async function bearbeitende(
    db: Queryable,
    umgebung: string,
    recht: BearbeitendesRecht = "moderate_submissions",
): Promise<string[]> {
    const rollen = rollenMit(recht);
    const sonderrollen = sonderrollenMit(recht);
    const [funktion] = await db<{ ja: boolean | null }[]>`
        SELECT has_function_privilege(current_user, to_regprocedure('avesmaps_community.community_bearbeitende(text, text[], text[])')::oid, 'EXECUTE') AS ja
    `;
    if (funktion?.ja === true) {
        const rows = await db<{ id: string }[]>`
            SELECT b.id::text AS id
              FROM avesmaps_community.community_bearbeitende(${umgebung}, ${rollen}::text[], ${sonderrollen}::text[]) AS b(id)
             ORDER BY b.id
        `;
        return rows.map((row) => row.id);
    }
    const [lesbar] = await db<{ ja: boolean | null }[]>`
        SELECT has_table_privilege(current_user, to_regclass('avesmaps_auth.sonderrolle_zuteilung')::oid, 'SELECT') AS ja
    `;
    const rows =
        lesbar?.ja === true
            ? await db<{ id: string }[]>`
                  SELECT p.id::text AS id
                    FROM avesmaps_auth.person p
                    JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = ${umgebung}
                   WHERE p.status = 'active' AND a.status = 'active'
                     AND (a.role = ANY(${rollen}::text[])
                          OR EXISTS (SELECT 1 FROM avesmaps_auth.sonderrolle_zuteilung z
                                      WHERE z.person_id = p.id AND z.environment = a.environment AND z.revoked_at IS NULL
                                        AND z.sonderrolle = ANY(${sonderrollen}::text[])))
                   ORDER BY p.id
              `
            : await db<{ id: string }[]>`
                  SELECT p.id::text AS id
                    FROM avesmaps_auth.person p
                    JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = ${umgebung}
                   WHERE p.status = 'active' AND a.status = 'active' AND a.role = ANY(${rollen}::text[])
                   ORDER BY p.id
              `;
    return rows.map((row) => row.id);
}

/**
 * Führt eine Meldung in einem Savepoint aus: Scheitert sie (Recht fehlt, Tafel weg), geht die Handlung der Transaktion trotzdem durch, und
 * eine Zeile im Protokoll sagt, was fehlt. Die Glocke ist ein Hinweis; die Liste der Redaktion bleibt die Wahrheit.
 */
export async function bestenfalls(
    tx: postgres.TransactionSql,
    log: GlockeLog,
    was: string,
    lauf: (db: Queryable) => Promise<unknown>,
): Promise<void> {
    try {
        await tx.savepoint(async (sp) => {
            await lauf(sp);
        });
    } catch (error) {
        const code = (error as { code?: unknown }).code;
        log.warn(
            { err: error, sqlstate: typeof code === "string" ? code : undefined },
            `Community: Glocke (${was}) nicht gemeldet; die Handlung gilt trotzdem`,
        );
    }
}

export interface NeueMeldungErgebnis {
    /** Personen, die eine neue Benachrichtigung bekamen. */
    neu: number;
    /** Personen, deren ungelesene Benachrichtigung um diese Meldung wuchs. */
    gewachsen: number;
}

/**
 * Eine neue Meldung ist eingegangen: an alle Bearbeitenden, gebündelt. Aufzurufen in DERSELBEN Transaktion, die den Vorgang anlegt
 * (`community_melden`): Nur dort ist `eingegangen_at = now()`, und nur dann zählt sie; die Wiederholung einer Kennung meldet nichts.
 */
export async function neueMeldung(db: Queryable, umgebung: string, id: number): Promise<NeueMeldungErgebnis> {
    const ergebnis: NeueMeldungErgebnis = { neu: 0, gewachsen: 0 };
    const [vorgang] = await db<{ art: string; frisch: boolean }[]>`
        SELECT art, eingegangen_at = now() AS frisch FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
    `;
    if (vorgang === undefined || vorgang.art !== "meldung" || !vorgang.frisch) return ergebnis;
    const nummer = comNummer(id);
    // Eine Sperre je Umgebung bis zum Ende der Transaktion: Zwei Meldungen zugleich sähen sonst beide „nichts Ungelesenes“ und legten zwei an.
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`community_neu:${umgebung}`}, 0))`;
    for (const person of await bearbeitende(db, umgebung)) {
        const [offen] = await db<{ id: string }[]>`
            SELECT id::text FROM public.benachrichtigung
             WHERE an_person = ${person}::uuid AND environment = ${umgebung} AND art = 'community_neu' AND gelesen_at IS NULL
             ORDER BY id DESC LIMIT 1
        `;
        if (offen === undefined) {
            ergebnis.neu += await sende(
                db,
                umgebung,
                { person },
                {
                    art: "community_neu",
                    text: nummer,
                    quelle: `community_neu:${nummer}`,
                },
            );
            continue;
        }
        // Der Text ist die COM-Nummer der ersten oder, ab der zweiten, die Zahl; hier wächst sie um eins.
        await db`
            UPDATE public.benachrichtigung
               SET text = (CASE WHEN text ~ '^[0-9]{1,6}$' THEN text::int + 1 ELSE 2 END)::text, erstellt_at = now()
             WHERE id = ${offen.id}::bigint
        `;
        ergebnis.gewachsen += 1;
    }
    return ergebnis;
}

/**
 * Eine neue Anfrage ist eingegangen (WI-0268 C4): „Neue Nachricht COM-…“ an alle mit `read_mailbox`, je Anfrage eine Zeile pro Person (die Quelle trägt die Nummer, eine Wiederholung meldet nichts).
 * Wie bei `neueMeldung` in DERSELBEN Transaktion, die den Vorgang anlegt: Nur dort ist `eingegangen_at = now()`. Der `text` ist allein die COM-Nummer, nie der Inhalt.
 */
export async function neueAnfrage(db: Queryable, umgebung: string, id: number): Promise<number> {
    const [vorgang] = await db<{ art: string; frisch: boolean }[]>`
        SELECT art, eingegangen_at = now() AS frisch FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
    `;
    if (vorgang === undefined || vorgang.art !== "anfrage" || !vorgang.frisch) return 0;
    const nummer = comNummer(id);
    let neu = 0;
    for (const person of await bearbeitende(db, umgebung, "read_mailbox")) {
        neu += await sende(
            db,
            umgebung,
            { person },
            { art: "community_nachricht", text: nummer, quelle: `community_nachricht:${nummer}` },
        );
    }
    return neu;
}

/**
 * Jemand setzte eine ANDERE Person als zuständig: Sie bekommt „… hat COM-… zugewiesen“. Die Kennung der Handlung steht in der Quelle, eine
 * Wiederholung meldet nichts; wer sich selbst einsetzt oder wer schon zuständig war, löst nichts aus.
 */
export async function zugewiesen(
    db: Queryable,
    umgebung: string,
    zuweisung: { id: number; ziel: string; von: string; vorher: string | null; operationId: string },
): Promise<number> {
    if (zuweisung.ziel === zuweisung.von || zuweisung.ziel === zuweisung.vorher) return 0;
    const nummer = comNummer(zuweisung.id);
    return sende(
        db,
        umgebung,
        { person: zuweisung.ziel },
        {
            art: "community_zugewiesen",
            text: nummer,
            quelle: `community_zugewiesen:${nummer}:${zuweisung.operationId}`,
            von: { person: zuweisung.von },
        },
    );
}

/**
 * Eine Meldung bekam Sonderrollen (WI-0279; Vali 2026-11-11): Jeder Inhaber einer NEU hinzugekommenen Rolle hört die Glocke, außer der Person, die zuweist (`von`); beim Eingang
 * ist der Absender Avesmaps (`von` `null`, `von_art` `system`). Wer die Rolle hat, rechnet `rollen.ts` (nur wer Meldungen bearbeiten darf; regional: in einer Region der
 * Meldung) und gibt es als `empfaenger` mit.
 *
 * - **Gebündelt** je Empfänger, Absender und Rolle: Solange eine solche Benachrichtigung ungelesen ist, hängt die nächste Meldung ihre Nummer an (`rollenGlockeDazu`), statt
 *   eine zweite anzulegen; die Quelle der ersten trägt Rolle, Absender, Nummer und die Kennung der Handlung (`eingang` beim Eingang).
 * - Eine Wiederholung derselben Handlung findet ihre Nummer schon im Text oder ihre Quelle schon vor und meldet nichts zweites.
 * - Eine Sperre je Umgebung hält zwei Zuweisungen zugleich hintereinander (wie `neueMeldung`).
 */
export async function rollenZugewiesen(
    db: Queryable,
    umgebung: string,
    zuweisung: {
        id: number;
        empfaenger: ReadonlyMap<string, readonly string[]>;
        von: string | null;
        operationId: string | null;
    },
): Promise<number> {
    const nummer = comNummer(zuweisung.id);
    const absender = zuweisung.von ?? "system";
    let gemeldet = 0;
    if ([...zuweisung.empfaenger.values()].every((personen) => personen.length === 0)) return 0;
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`community_rolle:${umgebung}`}, 0))`;
    for (const [rolle, personen] of zuweisung.empfaenger) {
        const stamm = `community_rolle:${rolle}:${absender}:`;
        for (const person of personen) {
            if (person === zuweisung.von) continue;
            const [offen] = await db<{ id: string; text: string | null }[]>`
                SELECT id::text, text FROM public.benachrichtigung
                 WHERE an_person = ${person}::uuid AND environment = ${umgebung} AND art = 'community_rolle' AND gelesen_at IS NULL
                   AND starts_with(quelle, ${stamm})
                 ORDER BY id DESC LIMIT 1
            `;
            const bisher = offen === undefined ? undefined : leseRollenGlocke(offen.text);
            if (offen !== undefined && bisher !== undefined) {
                const neu = rollenGlockeDazu(bisher, nummer);
                if (neu === bisher) continue;
                await db`
                    UPDATE public.benachrichtigung SET text = ${rollenGlockeText(neu)}, erstellt_at = now() WHERE id = ${offen.id}::bigint
                `;
                gemeldet += 1;
                continue;
            }
            gemeldet += await sende(
                db,
                umgebung,
                { person },
                {
                    art: "community_rolle",
                    text: rollenGlockeText({ rolle, nummern: [nummer], anzahl: 1 }),
                    quelle: `${stamm}${nummer}:${zuweisung.operationId ?? "eingang"}`,
                    von: zuweisung.von === null ? undefined : { person: zuweisung.von },
                },
            );
        }
    }
    return gemeldet;
}

/**
 * Der Melder antwortete über die Statusseite: Die zuständige Person bekommt „COM-…: Antwort des Melders“. Ohne Zuständigkeit (oder wenn die
 * zuständige Person nicht mehr bearbeitet) gehen sie an die Bearbeitenden, wie bei einer neuen Meldung. Solange der Eintrag zu diesem Vorgang
 * ungelesen ist, entsteht kein zweiter.
 */
export async function antwortDesMelders(
    db: Queryable,
    umgebung: string,
    antwort: { id: number; operationId: string },
): Promise<number> {
    const nummer = comNummer(antwort.id);
    const [vorgang] = await db<{ zustaendig: string | null; art: string }[]>`
        SELECT zustaendig::text, art FROM avesmaps_community.vorgang WHERE id = ${antwort.id}::bigint
    `;
    if (vorgang === undefined) return 0;
    // Die Antwort auf eine Anfrage geht nur an die, die Anfragen lesen dürfen.
    const alle = await bearbeitende(db, umgebung, vorgang.art === "anfrage" ? "read_mailbox" : "moderate_submissions");
    const ziele = vorgang.zustaendig !== null && alle.includes(vorgang.zustaendig) ? [vorgang.zustaendig] : alle;
    const stamm = `community_antwort:${nummer}:`;
    let angelegt = 0;
    for (const person of ziele) {
        const [offen] = await db<{ da: boolean }[]>`
            SELECT true AS da FROM public.benachrichtigung
             WHERE an_person = ${person}::uuid AND environment = ${umgebung} AND art = 'community_antwort' AND gelesen_at IS NULL
               AND starts_with(quelle, ${stamm})
             LIMIT 1
        `;
        if (offen !== undefined) continue;
        angelegt += await sende(
            db,
            umgebung,
            { person },
            {
                art: "community_antwort",
                text: nummer,
                quelle: `${stamm}${antwort.operationId}`,
            },
        );
    }
    return angelegt;
}

export interface FristErgebnis {
    /** Vorgänge, die seit mindestens `FRIST_TAGE` Tagen in der Rückfrage stehen. */
    faellig: number;
    /** Benachrichtigungen, die dabei neu entstanden (Personen gezählt; schon gemeldete zählen nicht). */
    gemeldet: number;
}

/**
 * Vorgänge, die seit 30 Tagen in der Rückfrage stehen, melden sich bei der zuständigen Person („COM-… wartet seit 30 Tagen“), ohne
 * Zuständigkeit bei den Bearbeitenden (je Rolle ein Aufruf, `benachrichtige()` fächert auf). Läuft täglich aus der Aufbewahrung mit der
 * Jobs-Rolle; die Quelle `community_frist:COM-…:<Tag der Rückfrage>` hält es bei EINER Meldung je Rückfrage, auch bei jedem weiteren Lauf.
 * Eine neue Rückfrage, nachdem der Melder geantwortet hat, ist ein neuer Tag und meldet sich nach ihren eigenen 30 Tagen wieder.
 */
export async function fristen(db: Queryable, umgebung: string, tage: number = FRIST_TAGE): Promise<FristErgebnis> {
    const rows = await db<{ id: string; zustaendig: string | null; tag: string }[]>`
        SELECT id::text, zustaendig::text, to_char(rueckfrage_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS tag
          FROM avesmaps_community.vorgang
         WHERE zustand = 'rueckfrage' AND papierkorb_at IS NULL AND rueckfrage_at <= now() - make_interval(days => ${tage}::int)
         ORDER BY id
         LIMIT 500
    `;
    let gemeldet = 0;
    for (const row of rows) {
        const nummer = comNummer(Number(row.id));
        const sendung: Sendung = {
            art: "community_frist",
            text: nummer,
            quelle: `community_frist:${nummer}:${row.tag}`,
        };
        if (row.zustaendig !== null) {
            gemeldet += await sende(db, umgebung, { person: row.zustaendig }, sendung);
            continue;
        }
        for (const person of await bearbeitende(db, umgebung))
            gemeldet += await sende(db, umgebung, { person }, sendung);
    }
    return { faellig: rows.length, gemeldet };
}

/**
 * Eine ausgehende Mail wurde nicht zugestellt (WI-0268 C6a, Bedienkonzept §3.3: „Glocke an die schreibende Person“): „COM-… : Mail nicht zugestellt“. Der `text` ist allein die COM-Nummer, nie der Grund und nie
 * der Inhalt. Die Quelle trägt Ausgang und Serie (`Erneut senden` zählt die Serie hoch): dieselbe Mail meldet sich je Versuchsreihe einmal, eine Wiederholung des Jobs meldet nichts. Aus dem Versandjob mit der
 * Jobs-Rolle (`benachrichtige()`, `db/system-grants.psql`). Ohne bekannte Person (Konto aufgelöst) geht sie an alle, die Mails lesen.
 */
export async function mailFehler(
    db: Queryable,
    umgebung: string,
    fehler: { nummer: string; ausgang: number; serie: number; person: string | null },
): Promise<number> {
    const sendung: Sendung = {
        art: "community_mail_fehler",
        text: fehler.nummer,
        quelle: `community_mail_fehler:${fehler.nummer}:${String(fehler.ausgang)}:${String(fehler.serie)}`,
    };
    if (fehler.person !== null) return sende(db, umgebung, { person: fehler.person }, sendung);
    let neu = 0;
    for (const person of await bearbeitende(db, umgebung, "read_mailbox")) {
        neu += await sende(db, umgebung, { person }, sendung);
    }
    return neu;
}

/**
 * Ein neues Reisebild wartet auf Prüfung (WI-0272 S3, Aufgabe 19): an alle Bearbeitenden (alle mit `moderate_submissions`, ab Reviewer), **gebündelt** wie `neueMeldung`: Solange eine Person eine ungelesene
 * `photobox_eingang` hat, wächst die Zahl im `text`, statt eine zweite Zeile anzulegen. Die erste trägt keinen Text, ab der zweiten steht die Zahl. 🔴 Nie die Beschreibung, nie der Name des Einsenders.
 * Aufzurufen in DERSELBEN Transaktion wie die Handlung, über `bestenfalls`: einreichen, Bild ersetzen, eine Beschreibung, die auf Prüfung wartet. Die Quelle trägt die Kennung der Operation
 * (`photobox_eingang:<operationId>`): Eine Wiederholung derselben Operation läuft die Handlung nicht noch einmal und meldet nichts. Eine Sperre je Umgebung hält zwei gleichzeitige Einreichungen hintereinander.
 */
export async function neuesReisebild(
    db: Queryable,
    umgebung: string,
    operationId: string,
): Promise<NeueMeldungErgebnis> {
    const ergebnis: NeueMeldungErgebnis = { neu: 0, gewachsen: 0 };
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`photobox_eingang:${umgebung}`}, 0))`;
    for (const person of await bearbeitende(db, umgebung, "moderate_photobox")) {
        const [offen] = await db<{ id: string }[]>`
            SELECT id::text FROM public.benachrichtigung
             WHERE an_person = ${person}::uuid AND environment = ${umgebung} AND art = 'photobox_eingang' AND gelesen_at IS NULL
             ORDER BY id DESC LIMIT 1
        `;
        if (offen === undefined) {
            ergebnis.neu += await sende(
                db,
                umgebung,
                { person },
                { art: "photobox_eingang", text: "", quelle: `photobox_eingang:${operationId}` },
            );
            continue;
        }
        // Ohne Text (die erste) ist die nächste die zweite; sonst wächst die Zahl um eins.
        await db`
            UPDATE public.benachrichtigung
               SET text = (CASE WHEN text ~ '^[0-9]{1,6}$' THEN text::int + 1 ELSE 2 END)::text, erstellt_at = now()
             WHERE id = ${offen.id}::bigint
        `;
        ergebnis.gewachsen += 1;
    }
    return ergebnis;
}

/**
 * Eine neue Bewertung wartet aufs Sichten (Vali 2026-11-04): an alle Bearbeitenden, **gebündelt** wie `neueMeldung`. Die erste trägt die Kennung der Bewertung und führt zu ihr, ab der zweiten steht die Zahl und der
 * Satz führt in die Liste. 🔴 Nie Text oder Name des Verfassers. Aufzurufen in DERSELBEN Transaktion, die sie anlegt: Nur dort ist `created_at = now()`, und nur dann zählt sie; die Wiederholung einer Kennung meldet nichts.
 */
export async function neueBewertung(db: Queryable, umgebung: string, id: string): Promise<NeueMeldungErgebnis> {
    const [bewertung] = await db<{ frisch: boolean }[]>`
        SELECT created_at = now() AS frisch FROM public.place_review WHERE public_id = ${id}::uuid
    `;
    if (bewertung?.frisch !== true) return { neu: 0, gewachsen: 0 };
    return gebuendelt(db, umgebung, "bewertung_neu", "moderate_submissions", id);
}

/**
 * Ein neuer Kartenvorschlag wartet auf die Redaktion (WI-0275): an alle mit `moderate_map_suggestions`, **gebündelt** wie `neueBewertung`. 🔴 Nie Titel, Notiz oder Name des Einreichers. Der Aufrufer ruft nur beim ersten
 * Eingang: bei einem Link, wenn die Zeile neu ist; bei einer Datei, wenn die Bytes angenommen sind. Eine Wiederholung kommt hier gar nicht an.
 */
export const neuerKartenvorschlag = (db: Queryable, umgebung: string, id: string): Promise<NeueMeldungErgebnis> =>
    gebuendelt(db, umgebung, "kartenvorschlag_neu", "moderate_map_suggestions", id);

/** Die Bündelung nach Kennung: Die erste trägt die Kennung und führt zu ihrem Gegenstand, ab der zweiten steht die Zahl und der Satz führt in die Liste. Eine Sperre je Umgebung hält zwei gleichzeitige hintereinander. */
async function gebuendelt(
    db: Queryable,
    umgebung: string,
    art: "bewertung_neu" | "kartenvorschlag_neu",
    recht: BearbeitendesRecht,
    id: string,
): Promise<NeueMeldungErgebnis> {
    const ergebnis: NeueMeldungErgebnis = { neu: 0, gewachsen: 0 };
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`${art}:${umgebung}`}, 0))`;
    for (const person of await bearbeitende(db, umgebung, recht)) {
        const [offen] = await db<{ id: string }[]>`
            SELECT id::text FROM public.benachrichtigung
             WHERE an_person = ${person}::uuid AND environment = ${umgebung} AND art = ${art} AND gelesen_at IS NULL
             ORDER BY id DESC LIMIT 1
        `;
        if (offen === undefined) {
            ergebnis.neu += await sende(db, umgebung, { person }, { art, text: id, quelle: `${art}:${id}` });
            continue;
        }
        await db`
            UPDATE public.benachrichtigung
               SET text = (CASE WHEN text ~ '^[0-9]{1,6}$' THEN text::int + 1 ELSE 2 END)::text, erstellt_at = now()
             WHERE id = ${offen.id}::bigint
        `;
        ergebnis.gewachsen += 1;
    }
    return ergebnis;
}

export interface SocialGlockeErgebnis {
    /** Vorgelegte Vorschläge der Routine, die auf eine Freigabe warten. */
    vorschlaege: number;
    /** Benachrichtigungen, die dabei neu entstanden (Personen gezählt; schon gemeldete zählen nicht). */
    vorschlaegeGemeldet: number;
}

/**
 * Ein Beitrag wurde zur Freigabe vorgelegt (WI-0270 C11, Fachkonzept §15.9): „Beitrag SOC-… wartet auf Freigabe“ an die Betreiber (Rolle `operator`), außer
 * an die Person, die ihn vorlegte. Der `text` ist allein die SOC-Nummer (nie Titel oder Text des Beitrags); die Quelle `social_freigabe:SOC-…` hält es bei EINER
 * Meldung je Beitrag und Person, auch wenn der Beitrag zurückgezogen und neu vorgelegt wird oder der tägliche Lauf (`socialFreigabe`) ihn noch einmal sieht.
 */
export async function beitragZurFreigabe(
    db: Queryable,
    umgebung: string,
    beitrag: { id: number; von: string | null },
): Promise<number> {
    const nummer = socNummer(beitrag.id);
    return sende(
        db,
        umgebung,
        beitrag.von === null ? { rolle: "operator" } : { rolle: "operator", ausser: beitrag.von },
        {
            art: "social_freigabe",
            text: nummer,
            quelle: `social_freigabe:${nummer}`,
            ...(beitrag.von === null ? {} : { von: { person: beitrag.von } }),
        },
    );
}

/**
 * Die Vorschläge der Routine kommen aus der Datenbank (`news_add`), nicht über die App: Niemand ruft dort die Glocke. Der tägliche Lauf der Aufbewahrung
 * holt es nach und meldet jeden vorgelegten Beitrag ohne Verfasser an die Betreiber. Die Quelle ist dieselbe wie oben, ein zweiter Lauf meldet nichts.
 * Die Jobs-Rolle liest dafür genau vier Spalten von `beitrag` (`db/community-grants.psql`), nie einen Text.
 */
export async function socialFreigabe(db: Queryable, umgebung: string): Promise<SocialGlockeErgebnis> {
    const rows = await db<{ id: string }[]>`
        SELECT id::text FROM avesmaps_community.beitrag
         WHERE zustand = 'vorgelegt' AND papierkorb_at IS NULL AND herkunft = 'routine'
         ORDER BY id
         LIMIT 100
    `;
    let gemeldet = 0;
    for (const row of rows) gemeldet += await beitragZurFreigabe(db, umgebung, { id: Number(row.id), von: null });
    return { vorschlaege: rows.length, vorschlaegeGemeldet: gemeldet };
}

/**
 * Eine Mail aus dem Postfach ist aufgenommen (WI-0268 C6b, Bedienkonzept §3.1 und §3.4): ein neuer Vorgang meldet sich als `community_nachricht`, eine Mail im Faden (angehängt oder den Vorgang wieder öffnend)
 * als `community_antwort`. Der `text` ist allein die COM-Nummer, nie Absender, Betreff oder Inhalt. Die Quelle trägt Vorgang bzw. Nachricht: dieselbe Mail meldet nie zweimal, mehrere Mails im Faden je eine.
 * Aus dem Abrufjob mit der Jobs-Rolle: Sie liest `vorgang` nicht (außer den fünf Spalten der Fristen), darum übergibt der Job, was die Funktion `community_mail_eingang` ihm sagte. Ein Vorgang im Papierkorb
 * meldet nichts (Spam soll niemanden stören). Gibt die Zahl der neuen Benachrichtigungen zurück.
 */
export async function mailEingegangen(
    db: Queryable,
    umgebung: string,
    mail: { nummer: string; nachricht: number; vorgangNeu: boolean; zustaendig: string | null; papierkorb: boolean },
): Promise<number> {
    if (mail.papierkorb) return 0;
    if (mail.vorgangNeu) {
        let neu = 0;
        for (const person of await bearbeitende(db, umgebung, "read_mailbox")) {
            neu += await sende(
                db,
                umgebung,
                { person },
                { art: "community_nachricht", text: mail.nummer, quelle: `community_nachricht:${mail.nummer}` },
            );
        }
        return neu;
    }
    const sendung: Sendung = {
        art: "community_antwort",
        text: mail.nummer,
        quelle: `community_antwort:${mail.nummer}:mail-${String(mail.nachricht)}`,
    };
    if (mail.zustaendig !== null) return sende(db, umgebung, { person: mail.zustaendig }, sendung);
    let neu = 0;
    for (const person of await bearbeitende(db, umgebung, "read_mailbox")) {
        neu += await sende(db, umgebung, { person }, sendung);
    }
    return neu;
}
