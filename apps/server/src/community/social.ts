import { randomUUID } from "node:crypto";
import {
    AVENTURIA,
    socNummer,
    type KanalId,
    type SocialAusstehend,
    type SocialDetail,
    type SocialHerkunft,
    type SocialListe,
    type SocialSegment,
    type SocialVerlauf,
    type SocialZeile,
    type SocialZiel,
    type SocialZustand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { comNummer, communityFehler } from "./db.ts";
import { socialBildUrteile } from "./social/bild-urteil.ts";
import { SOCIAL_SENDEN_KIND } from "./social/kanaele/konfiguration.ts";

/**
 * Der Social Hub in der Datenbank (WI-0270 C11, Migration 0269): dünne Hüllen um die Funktionen des Schemas `avesmaps_community` und die Lesewege der
 * Redaktion. Die Regeln (Zustände, Revision, Idempotenz, die Neuigkeit als einziger Speicher) stehen in der Datenbank, nicht hier. Fehler der Funktionen
 * kommen als SQLSTATE der Klasse `KC` und werden zu `CommunityFehler`.
 *
 * 🔴 Die App schreibt die Tafeln NIE selbst (kein INSERT, UPDATE, DELETE; `community-grants.psql`), nur über diese Funktionen. Der Text eines Beitrags
 * verlässt die Datenbank nur in der Liste und im Fenster der Redaktion; nie ins Protokoll.
 */

async function rufe<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (error) {
        throw communityFehler(error);
    }
}

const neu = (operation?: string): string => operation ?? randomUUID();

// --- Schreiben --------------------------------------------------------------------------------------------------------------

export interface BeitragInhalt {
    titel?: string | null | undefined;
    text: string;
    hashtags: readonly string[];
    rubrik: string;
    bild?: string | null | undefined;
    bildBeschreibung?: string | null | undefined;
    ki: boolean;
    kanaele: readonly KanalId[];
}

export interface BeitragAntwort {
    id: number;
    revision: number;
    zustand: SocialZustand;
}

export async function beitragAnlegen(
    db: Queryable,
    b: BeitragInhalt & { operationId?: string; person: string; vorgang?: number | undefined },
): Promise<BeitragAntwort> {
    const [row] = await rufe(
        () => db<{ antwort: { id: number | string; revision: number; zustand: SocialZustand } }[]>`
            SELECT avesmaps_community.beitrag_anlegen(
                ${neu(b.operationId)}::uuid, ${b.person}::uuid, ${b.vorgang ?? null}::bigint, ${b.titel ?? null}, ${b.text},
                ${[...b.hashtags]}::text[], ${b.rubrik}, ${b.bild ?? null}::uuid, ${b.bildBeschreibung ?? null}, ${b.ki},
                ${[...b.kanaele]}::text[]
            ) AS antwort
        `,
    );
    if (row === undefined) throw new Error("beitrag_anlegen lieferte nichts");
    return { id: Number(row.antwort.id), revision: Number(row.antwort.revision), zustand: row.antwort.zustand };
}

export async function beitragAendern(
    db: Queryable,
    b: BeitragInhalt & { operationId?: string; id: number; person: string; revision: number },
): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.beitrag_aendern(
                ${neu(b.operationId)}::uuid, ${b.id}::bigint, ${b.person}::uuid, ${b.revision}::int, ${b.titel ?? null}, ${b.text},
                ${[...b.hashtags]}::text[], ${b.rubrik}, ${b.bild ?? null}::uuid, ${b.bildBeschreibung ?? null}, ${b.ki},
                ${[...b.kanaele]}::text[]
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

interface Schritt {
    operationId?: string;
    id: number;
    person: string;
    revision: number;
}

const SCHRITTE = [
    "vorlegen",
    "zurueckziehen",
    "freigeben",
    "aenderung_veroeffentlichen",
    "zuruecknehmen",
    "papierkorb",
    "zurueckholen",
] as const;
export type BeitragSchrittName = (typeof SCHRITTE)[number];

/** Die Schritte ohne weitere Angabe. Der Name ist fest aus `SCHRITTE`, nie aus der Anfrage. */
async function schritt(db: Queryable, name: BeitragSchrittName, s: Schritt): Promise<number> {
    if (!SCHRITTE.includes(name)) throw new Error(`unbekannter Schritt ${name}`);
    const [row] = await rufe(() =>
        db.unsafe<{ revision: number }[]>(
            `SELECT avesmaps_community.beitrag_${name}($1::uuid, $2::bigint, $3::uuid, $4::int) AS revision`,
            [neu(s.operationId), s.id, s.person, s.revision],
        ),
    );
    return Number(row?.revision);
}

export const beitragVorlegen = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "vorlegen", s);
export const beitragZurueckziehen = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "zurueckziehen", s);
export const beitragFreigeben = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "freigeben", s);
export const beitragAenderungVeroeffentlichen = (db: Queryable, s: Schritt): Promise<number> =>
    schritt(db, "aenderung_veroeffentlichen", s);
export const beitragZuruecknehmen = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "zuruecknehmen", s);
export const beitragInDenPapierkorb = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "papierkorb", s);
export const beitragZurueckholen = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "zurueckholen", s);

/** Zurück an den Verfasser, mit einem freiwilligen Grund. */
export async function beitragZurueckgeben(db: Queryable, s: Schritt & { grund?: string | undefined }): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.beitrag_zurueckgeben(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.grund?.trim() || null}
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

/** Einen gesendeten Beitrag bei einem Kanal mit Zugang zurücknehmen (Mastodon: löschen). Der Auftrag `social_senden` tut es; hier wird es vorgemerkt. */
export async function beitragKanalZuruecknehmen(db: Queryable, s: Schritt & { kanal: KanalId }): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.beitrag_kanal_zuruecknehmen(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.kanal}
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

/**
 * Reiht für jede vorgemerkte Sendung des Beitrags den Auftrag `social_senden` ein (`job_enqueue`, SECURITY DEFINER; Akteur `community`, ohne Fußabdruck auf der Karte). Der Aufruf gehört in DIESELBE Transaktion
 * wie die Handlung, die die Sendung vormerkte (Freigeben, Erneut senden, Zurücknehmen): Entweder beides oder nichts. Gibt zurück, wie viele Aufträge eingereiht wurden.
 */
export async function reiheSendungenEin(db: Queryable, beitrag: number): Promise<number> {
    const kanaele = await db<{ kanal: string }[]>`
        SELECT kanal FROM avesmaps_community.sendung WHERE beitrag_id = ${beitrag}::bigint AND aufgabe IS NOT NULL ORDER BY kanal
    `;
    for (const { kanal } of kanaele) {
        await db`
            SELECT public_id::text AS public_id
              FROM job_enqueue(
                       ${SOCIAL_SENDEN_KIND}, 1::smallint, ${AVENTURIA.mapDomain}, 'community', ${db.json({ beitrag, kanal })}::jsonb, 50::smallint,
                       NULL::timestamptz, 'tiles', '{}'::smallint[]
                   )
        `;
    }
    return kanaele.length;
}

/** Erneut senden, für einen Kanal. */
export async function beitragErneutSenden(db: Queryable, s: Schritt & { kanal: KanalId }): Promise<number> {
    const [row] = await rufe(
        () => db<{ revision: number }[]>`
            SELECT avesmaps_community.beitrag_erneut_senden(
                ${neu(s.operationId)}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${s.kanal}
            ) AS revision
        `,
    );
    return Number(row?.revision);
}

// --- Lesen ------------------------------------------------------------------------------------------------------------------

interface ZeilenRow {
    id: string;
    herkunft: SocialHerkunft;
    vorgang_id: string | null;
    verfasser_id: string | null;
    verfasser_name: string | null;
    titel: string | null;
    text: string;
    hashtags: string[];
    rubrik: string;
    bild_id: string | null;
    bild_beschreibung: string | null;
    ki: boolean;
    kanaele: KanalId[];
    zustand: SocialZustand;
    geaendert: boolean;
    papierkorb_at: Date | null;
    papierkorb_art: string | null;
    angelegt_at: Date;
    vorgelegt_at: Date | null;
    veroeffentlicht_at: Date | null;
    revision: number;
    ziele: {
        kanal: KanalId;
        zustand: SocialZiel["zustand"];
        adresse: string | null;
        fehler: string | null;
        versuche: number;
        sendeAt: string | null;
        ausstehend: SocialAusstehend | null;
    }[];
}

/** Der Moment als ISO-Zeit, wie die übrigen Wege ihn liefern (JSON der Datenbank trägt ihn mit Offset). */
const iso = (moment: string | null): string | null => (moment === null ? null : new Date(moment).toISOString());

const zeileAus = (row: ZeilenRow): SocialZeile => ({
    id: Number(row.id),
    nr: socNummer(row.id),
    zustand: row.zustand,
    herkunft: row.herkunft,
    vorgang: row.vorgang_id === null ? null : comNummer(row.vorgang_id),
    verfasser: row.verfasser_id === null ? null : { id: row.verfasser_id, name: row.verfasser_name ?? "" },
    titel: row.titel,
    text: row.text,
    hashtags: row.hashtags,
    rubrik: row.rubrik,
    bild: row.bild_id,
    bildBeschreibung: row.bild_beschreibung,
    ki: row.ki,
    kanaele: row.kanaele,
    ziele: row.ziele.map((ziel) => ({ ...ziel, sendeAt: iso(ziel.sendeAt) })),
    papierkorb: row.papierkorb_at !== null,
    verfallen: row.papierkorb_art === "verfallen",
    geaendert: row.geaendert,
    revision: row.revision,
    angelegtAt: row.angelegt_at.toISOString(),
    vorgelegtAt: row.vorgelegt_at?.toISOString() ?? null,
    veroeffentlichtAt: row.veroeffentlicht_at?.toISOString() ?? null,
});

const ZEILEN_SELECT = `
    b.id::text AS id, b.herkunft, b.vorgang_id::text AS vorgang_id, b.verfasser::text AS verfasser_id, p.display_name AS verfasser_name,
    b.titel, b.text, b.hashtags, b.rubrik, b.bild_id::text AS bild_id, b.bild_beschreibung, b.ki, b.kanaele, b.zustand, b.geaendert,
    b.papierkorb_at, b.papierkorb_art, b.angelegt_at, b.vorgelegt_at, b.veroeffentlicht_at, b.revision,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'kanal', z.kanal, 'zustand', z.zustand, 'adresse', z.adresse, 'fehler', z.fehler, 'versuche', z.versuche,
                'sendeAt', z.gesendet_at,
                'ausstehend', (SELECT sd.aufgabe FROM avesmaps_community.sendung sd WHERE sd.beitrag_id = z.beitrag_id AND sd.kanal = z.kanal)
            ) ORDER BY z.kanal), '[]'::jsonb)
       FROM avesmaps_community.beitrag_ziel z WHERE z.beitrag_id = b.id) AS ziele`;

export interface SocialAnfrage {
    segment: SocialSegment;
    q?: string | undefined;
    kanal?: KanalId | undefined;
    herkunft?: SocialHerkunft | undefined;
}

const SEGMENT_BEDINGUNG: Record<SocialSegment, string> = {
    offen: `b.papierkorb_at IS NULL AND b.zustand IN ('entwurf', 'vorgelegt')`,
    veroeffentlicht: `b.papierkorb_at IS NULL AND b.zustand = 'veroeffentlicht'`,
    papierkorb: `b.papierkorb_at IS NOT NULL`,
};

/** Die Liste eines Segments mit den Zahlen aller (Bedienkonzept §6.4). Höchstens 500 Zeilen, wie die Vorgänge. */
export async function socialListe(db: Queryable, a: SocialAnfrage): Promise<SocialListe> {
    const bedingungen = [SEGMENT_BEDINGUNG[a.segment]];
    const werte: unknown[] = [];
    const param = (wert: unknown): string => {
        werte.push(wert);
        return `$${String(werte.length)}`;
    };
    const q = a.q?.trim() ?? "";
    if (q !== "") {
        const muster = param(`%${q.replace(/[\\%_]/gu, (zeichen) => `\\${zeichen}`)}%`);
        bedingungen.push(
            `(b.titel ILIKE ${muster} OR b.text ILIKE ${muster} OR array_to_string(b.hashtags, ' ') ILIKE ${muster})`,
        );
    }
    if (a.kanal !== undefined) bedingungen.push(`${param(a.kanal)}::text = ANY (b.kanaele)`);
    if (a.herkunft !== undefined) bedingungen.push(`b.herkunft = ${param(a.herkunft)}`);
    const rows = await db.unsafe<ZeilenRow[]>(
        `SELECT ${ZEILEN_SELECT}
           FROM avesmaps_community.beitrag b LEFT JOIN avesmaps_auth.person p ON p.id = b.verfasser
          WHERE ${bedingungen.join(" AND ")}
          ORDER BY b.angelegt_at DESC, b.id DESC
          LIMIT 500`,
        werte as never[],
    );
    const [z] = await db<
        {
            offen: number;
            veroeffentlicht: number;
            papierkorb: number;
            entwurf: number;
            vorgelegt: number;
            wartet: number;
        }[]
    >`
        SELECT count(*) FILTER (WHERE b.papierkorb_at IS NULL AND b.zustand IN ('entwurf', 'vorgelegt'))::int AS offen,
               count(*) FILTER (WHERE b.papierkorb_at IS NULL AND b.zustand = 'veroeffentlicht')::int AS veroeffentlicht,
               count(*) FILTER (WHERE b.papierkorb_at IS NOT NULL)::int AS papierkorb,
               count(*) FILTER (WHERE b.papierkorb_at IS NULL AND b.zustand = 'entwurf')::int AS entwurf,
               count(*) FILTER (WHERE b.papierkorb_at IS NULL AND b.zustand = 'vorgelegt')::int AS vorgelegt,
               count(*) FILTER (WHERE b.papierkorb_at IS NULL AND (b.zustand = 'vorgelegt' OR EXISTS (
                   SELECT 1 FROM avesmaps_community.beitrag_ziel zz WHERE zz.beitrag_id = b.id AND zz.zustand = 'fehler'
               )))::int AS wartet
          FROM avesmaps_community.beitrag b
    `;
    // Das Urteil je Bild in EINER Abfrage: Das ✓ der Zeile sperrt dann mit demselben Grund wie das Freigeben (`zaehlePruefe`).
    const urteile = await socialBildUrteile(db, [
        ...new Set(rows.flatMap((row) => (row.bild_id === null ? [] : [row.bild_id]))),
    ]);
    return {
        zeilen: rows.map((row) => {
            const zeile = zeileAus(row);
            const urteil = row.bild_id === null ? undefined : urteile.get(row.bild_id);
            return urteil === undefined
                ? zeile
                : {
                      ...zeile,
                      bildUrteil: {
                          erlaubt: urteil.erlaubt,
                          grund: urteil.grund,
                          oeffentlich: urteil.oeffentlich,
                          social: urteil.typ === "social_post",
                      },
                  };
        }),
        zaehler: {
            offen: z?.offen ?? 0,
            veroeffentlicht: z?.veroeffentlicht ?? 0,
            papierkorb: z?.papierkorb ?? 0,
            entwurf: z?.entwurf ?? 0,
            vorgelegt: z?.vorgelegt ?? 0,
            wartet: z?.wartet ?? 0,
        },
    };
}

/** Das Medium eines Bildes: Titel, Rechtsbasis und Klärung aus dem Medienkern, dazu das Urteil der Policy (`social/bild-urteil.ts`); `null`, wo es das Medium nicht gibt. */
export async function bildInfo(db: Queryable, bild: string): Promise<NonNullable<SocialDetail["bild"]> | null> {
    const [row] = await db<
        { titel: string | null; rechtsbasis: string | null; klaerung: string | null; typ: string | null }[]
    >`
        SELECT a.title AS titel, r.rights_basis AS rechtsbasis, r.clearance_state AS klaerung, a.asset_type AS typ
          FROM public.media_asset a LEFT JOIN public.media_rights r ON r.media_asset_id = a.id
         WHERE a.public_id = ${bild}::uuid
    `;
    if (row === undefined) return null;
    const urteil = (await socialBildUrteile(db, [bild])).get(bild);
    return {
        id: bild,
        titel: row.titel,
        rechtsbasis: row.rechtsbasis,
        klaerung: row.klaerung,
        geklaert: urteil?.erlaubt ?? false,
        grund: urteil?.grund ?? "rights_missing",
        nennung: urteil?.nennung ?? null,
        oeffentlich: urteil?.oeffentlich ?? false,
        typ: row.typ,
    };
}

/** Ein Beitrag mit Bild und Verlauf. `null`, wo es ihn nicht gibt. */
export async function socialDetail(db: Queryable, id: number): Promise<SocialDetail | null> {
    const [row] = await db.unsafe<ZeilenRow[]>(
        `SELECT ${ZEILEN_SELECT}
           FROM avesmaps_community.beitrag b LEFT JOIN avesmaps_auth.person p ON p.id = b.verfasser
          WHERE b.id = $1::bigint`,
        [id],
    );
    if (row === undefined) return null;
    const ereignisse = await db<
        { art: SocialVerlauf["art"]; von_id: string | null; von_name: string | null; text: string | null; at: Date }[]
    >`
        SELECT e.art, e.von_person::text AS von_id, p.display_name AS von_name, e.text, e.at
          FROM avesmaps_community.beitrag_ereignis e LEFT JOIN avesmaps_auth.person p ON p.id = e.von_person
         WHERE e.beitrag_id = ${id}::bigint ORDER BY e.seq
    `;
    return {
        zeile: zeileAus(row),
        bild: row.bild_id === null ? null : await bildInfo(db, row.bild_id),
        verlauf: ereignisse.map((e) => ({
            art: e.art,
            von: e.von_id === null ? null : { id: e.von_id, name: e.von_name ?? "" },
            text: e.text,
            at: e.at.toISOString(),
        })),
    };
}

/** Der Verfasser eines Beitrags und sein Stand, für die Rechteprüfung der Route (wer darf ändern, vorlegen, verwerfen?). */
export async function beitragKopf(
    db: Queryable,
    id: number,
): Promise<{ verfasser: string | null; zustand: SocialZustand; papierkorb: boolean } | null> {
    const [row] = await db<{ verfasser: string | null; zustand: SocialZustand; papierkorb: boolean }[]>`
        SELECT verfasser::text AS verfasser, zustand, papierkorb_at IS NOT NULL AS papierkorb
          FROM avesmaps_community.beitrag WHERE id = ${id}::bigint
    `;
    return row ?? null;
}
