import { createHash, randomUUID } from "node:crypto";
import {
    BEWERTUNG_GRUENDE,
    comNummer,
    type BewertungDetail,
    type BewertungGrund,
    type BewertungListe,
    type BewertungSegment,
    type BewertungSortierung,
    type BewertungVerlauf,
    type BewertungZeile,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { communityFehler } from "./db.ts";

/**
 * Bewertungen in der Datenbank (WI-0269, Migration 0266): dünne Hüllen um die Funktionen des Schemas `avesmaps_community` und die Lesewege der
 * Redaktion. Die Regeln (Zustände, Revision, Idempotenz, Rechte der App-Rolle) stehen in der Datenbank, nicht hier. Fehler der Funktionen kommen
 * als SQLSTATE der Klasse `KC` und werden zu `CommunityFehler`.
 *
 * 🔴 Die App schreibt `place_review` NIE selbst (kein INSERT, UPDATE, DELETE; `community-grants.psql`), nur über diese Funktionen.
 * 🔴 Name, Text und Datum verlassen die Datenbank nur in `GET …/reviews` (öffentlich, nur Öffentliches) und in der Liste und dem Fenster der
 * Redaktion; nie ins Protokoll.
 */

async function rufe<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (error) {
        throw communityFehler(error);
    }
}

const sha256 = (schluessel: string): Buffer => createHash("sha256").update(schluessel, "utf8").digest();

// --- Öffentlich -------------------------------------------------------------------------------------------------------------------

export interface NeueBewertung {
    operationId: string;
    ort: string;
    sterne: number;
    text?: string | undefined;
    name?: string | undefined;
    /** Schon geprüft und kanonisch (`normalisiereAventurischesDatum`), oder das heutige Datum. */
    datum: string;
    zustand: "neu" | "zurueckgehalten";
    grund: "adresse" | "wortliste" | null;
}

export async function bewertungSchreiben(
    db: Queryable,
    b: NeueBewertung,
): Promise<{ id: string; zustand: "neu" | "zurueckgehalten" }> {
    const [row] = await rufe(
        () => db<{ antwort: { id: string; zustand: "neu" | "zurueckgehalten" } }[]>`
            SELECT avesmaps_community.bewertung_schreiben(
                ${b.operationId}::uuid, ${b.ort}::uuid, ${b.sterne}::int, ${b.text ?? null}, ${b.name ?? null}, ${b.datum},
                ${b.zustand}, ${b.grund}, NULL::bytea
            ) AS antwort
        `,
    );
    if (row === undefined) throw new Error("bewertung_schreiben lieferte nichts");
    return row.antwort;
}

/** „Gefällt mir“ setzen (`1`) oder zurücknehmen (`-1`): nur die Zahl, nie wer. Antwort: die Zahl danach. */
export async function bewertungGefaellt(db: Queryable, id: string, delta: 1 | -1): Promise<number> {
    const [row] = await rufe(
        () => db<{ zahl: number }[]>`SELECT avesmaps_community.bewertung_gefaellt(${id}::uuid, ${delta}::int) AS zahl`,
    );
    return Number(row?.zahl ?? 0);
}

export interface BewertungMeldung {
    operationId: string;
    bewertung: string;
    schluessel: string;
    grund: BewertungGrund;
    text?: string | undefined;
}

/** Eine Bewertung melden: ein Vorgang der Kategorie `bewertung`. Antwort: die Kennung des Vorgangs (COM-Nummer ohne Präfix). */
export async function bewertungMelden(db: Queryable, m: BewertungMeldung): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_community.bewertung_melden(
                ${m.operationId}::uuid, ${m.bewertung}::uuid, ${m.grund}, ${m.text ?? null}, ${sha256(m.schluessel)}
            )::text AS id
        `,
    );
    return Number(row?.id);
}

// --- Redaktion: Schritte ----------------------------------------------------------------------------------------------------------

interface Schritt {
    operationId?: string;
    id: string;
    person: string;
    revision: number;
}

const neu = (operation?: string): string => operation ?? randomUUID();

const SCHRITTE = ["sichten", "freigeben", "einblenden", "inhalt_loeschen"] as const;
export type BewertungSchrittName = (typeof SCHRITTE)[number];

/** Die Schritte ohne weitere Angabe. Der Name ist fest aus `SCHRITTE`, nie aus der Anfrage. */
async function schritt(db: Queryable, name: BewertungSchrittName, s: Schritt): Promise<number> {
    if (!SCHRITTE.includes(name)) throw new Error(`unbekannter Schritt ${name}`);
    const [row] = await rufe(() =>
        db.unsafe<{ revision: number }[]>(
            `SELECT avesmaps_community.bewertung_${name}($1::uuid, $2::uuid, $3::uuid, $4::int) AS revision`,
            [neu(s.operationId), s.id, s.person, s.revision],
        ),
    );
    return Number(row?.revision);
}

export const bewertungSichten = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "sichten", s);
export const bewertungFreigeben = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "freigeben", s);
export const bewertungEinblenden = (db: Queryable, s: Schritt): Promise<number> => schritt(db, "einblenden", s);
export const bewertungInhaltLoeschen = (db: Queryable, s: Schritt): Promise<number> =>
    schritt(db, "inhalt_loeschen", s);

/** Verbergen mit Grund; auf Wunsch gleich die offenen Meldungen zu dieser Bewertung abschließen. */
export async function bewertungVerbergen(
    db: Queryable,
    s: Schritt & { grund: BewertungGrund; vorgaengeAbschliessen: boolean },
): Promise<{ revision: number; abgeschlossen: string[] }> {
    if (!BEWERTUNG_GRUENDE.includes(s.grund)) throw new Error(`unbekannter Grund ${s.grund}`);
    const [row] = await rufe(
        () => db<{ antwort: { revision: number; abgeschlossen: number[] } }[]>`
            SELECT avesmaps_community.bewertung_verbergen(
                ${neu(s.operationId)}::uuid, ${s.id}::uuid, ${s.person}::uuid, ${s.revision}::int, ${s.grund}, ${s.vorgaengeAbschliessen}
            ) AS antwort
        `,
    );
    return {
        revision: Number(row?.antwort.revision),
        abgeschlossen: (row?.antwort.abgeschlossen ?? []).map((id) => comNummer(id)),
    };
}

// --- Redaktion: Lesen -------------------------------------------------------------------------------------------------------------

interface ZeilenRow {
    id: string;
    ort_id: string;
    ort_name: string;
    stars: number;
    body: string | null;
    author_name: string | null;
    dsa_date: string | null;
    zustand: BewertungZeile["zustand"];
    grund: string | null;
    herkunft: string;
    eingang: Date;
    gemeldet: string[];
    gefaellt: number;
    geloescht: boolean;
    revision: number;
}

const zeileAus = (row: ZeilenRow): BewertungZeile => ({
    id: row.id,
    ort: { id: row.ort_id, name: row.ort_name },
    sterne: row.stars,
    text: row.body,
    name: row.author_name,
    datum: row.dsa_date,
    zustand: row.zustand,
    grund: row.grund,
    herkunft: row.herkunft === "legacy" ? "legacy" : "website",
    eingangAt: row.eingang.toISOString(),
    gemeldet: row.gemeldet,
    gefaellt: row.gefaellt,
    inhaltGeloescht: row.geloescht,
    revision: row.revision,
});

/** Die Spalten einer Zeile samt der offenen Meldungen (COM-Nummern). Gelöschter Inhalt ist schon in der Tafel `NULL`. */
const ZEILEN_SELECT = `
    r.public_id::text AS id, p.public_id::text AS ort_id, p.name AS ort_name, r.stars, r.body, r.author_name, r.dsa_date,
    r.zustand, r.grund, r.source_system AS herkunft, r.eingang, r.gefaellt, (r.inhalt_geloescht_at IS NOT NULL) AS geloescht, r.revision,
    ARRAY(
        SELECT 'COM-' || lpad(v.id::text, 6, '0')
          FROM avesmaps_community.vorgang v JOIN avesmaps_community.bezug b ON b.vorgang_id = v.id
         WHERE b.bewertung_id = r.public_id AND v.zustand <> 'abgeschlossen' AND v.papierkorb_at IS NULL
         ORDER BY v.id
    ) AS gemeldet`;

/** Hat die Bewertung `r` eine offene Meldung? */
const GEMELDET = `EXISTS (
    SELECT 1 FROM avesmaps_community.vorgang v JOIN avesmaps_community.bezug b ON b.vorgang_id = v.id
     WHERE b.bewertung_id = r.public_id AND v.zustand <> 'abgeschlossen' AND v.papierkorb_at IS NULL
)`;

export interface BewertungenAnfrage {
    segment: BewertungSegment;
    q?: string | undefined;
    sterne?: number | undefined;
    herkunft?: "website" | "legacy" | undefined;
    gemeldet?: boolean | undefined;
    zurueckgehalten?: boolean | undefined;
    sortierung?: BewertungSortierung | undefined;
}

const SEGMENT_BEDINGUNG: Record<BewertungSegment, string> = {
    // „Zu sichten“: neue, zurückgehaltene und solche mit offener Meldung (auch schon gesichtete).
    sichten: `r.zustand <> 'verborgen' AND (r.zustand IN ('neu', 'zurueckgehalten') OR ${GEMELDET})`,
    sichtbar: `r.zustand = 'gesichtet' AND NOT ${GEMELDET}`,
    verborgen: `r.zustand = 'verborgen'`,
};
const SORTIERUNG: Record<BewertungSortierung, string> = {
    neueste: "r.eingang DESC, r.id DESC",
    aelteste: "r.eingang ASC, r.id ASC",
    wenigste: "r.stars ASC, r.eingang DESC, r.id DESC",
};

/** Die Liste eines Segments mit den Zahlen aller (Bedienkonzept §6.1). Höchstens 500 Zeilen, wie die Vorgänge. */
export async function bewertungenListe(db: Queryable, a: BewertungenAnfrage): Promise<BewertungListe> {
    const bedingungen = [SEGMENT_BEDINGUNG[a.segment], "p.is_active"];
    const werte: unknown[] = [];
    const param = (wert: unknown): string => {
        werte.push(wert);
        return `$${String(werte.length)}`;
    };
    const q = a.q?.trim() ?? "";
    if (q !== "") {
        const muster = param(`%${q.replace(/[\\%_]/gu, (zeichen) => `\\${zeichen}`)}%`);
        bedingungen.push(`(p.name ILIKE ${muster} OR r.author_name ILIKE ${muster} OR r.body ILIKE ${muster})`);
    }
    if (a.sterne !== undefined) bedingungen.push(`r.stars = ${param(a.sterne)}::int`);
    if (a.herkunft !== undefined) bedingungen.push(`r.source_system = ${param(a.herkunft)}`);
    if (a.gemeldet === true) bedingungen.push(GEMELDET);
    if (a.zurueckgehalten === true) bedingungen.push(`r.zustand = 'zurueckgehalten'`);
    const rows = await db.unsafe<ZeilenRow[]>(
        `SELECT ${ZEILEN_SELECT}
           FROM place_review r JOIN place p ON p.id = r.place_id
          WHERE ${bedingungen.join(" AND ")}
          ORDER BY ${SORTIERUNG[a.sortierung ?? "neueste"]}
          LIMIT 500`,
        werte as never[],
    );
    const [z] = await db<
        {
            sichten: number;
            sichtbar: number;
            verborgen: number;
            neu: number;
            zurueckgehalten: number;
            gesichtet: number;
        }[]
    >`
        WITH x AS (
            SELECT r.zustand, EXISTS (
                SELECT 1 FROM avesmaps_community.vorgang v JOIN avesmaps_community.bezug b ON b.vorgang_id = v.id
                 WHERE b.bewertung_id = r.public_id AND v.zustand <> 'abgeschlossen' AND v.papierkorb_at IS NULL
            ) AS gemeldet
              FROM place_review r JOIN place p ON p.id = r.place_id WHERE p.is_active
        )
        SELECT count(*) FILTER (WHERE zustand <> 'verborgen' AND (zustand IN ('neu', 'zurueckgehalten') OR gemeldet))::int AS sichten,
               count(*) FILTER (WHERE zustand = 'gesichtet' AND NOT gemeldet)::int AS sichtbar,
               count(*) FILTER (WHERE zustand = 'verborgen')::int AS verborgen,
               count(*) FILTER (WHERE zustand = 'neu')::int AS neu,
               count(*) FILTER (WHERE zustand = 'zurueckgehalten')::int AS zurueckgehalten,
               count(*) FILTER (WHERE zustand = 'gesichtet')::int AS gesichtet
          FROM x
    `;
    return {
        zeilen: rows.map(zeileAus),
        zaehler: {
            sichten: z?.sichten ?? 0,
            sichtbar: z?.sichtbar ?? 0,
            verborgen: z?.verborgen ?? 0,
            neu: z?.neu ?? 0,
            zurueckgehalten: z?.zurueckgehalten ?? 0,
            gesichtet: z?.gesichtet ?? 0,
        },
    };
}

/** Eine Bewertung mit Ort, Durchschnitt jetzt und danach, Meldungen und Verlauf. `null`, wo es sie nicht gibt. */
export async function bewertungDetail(db: Queryable, id: string): Promise<BewertungDetail | null> {
    const [zeile] = await db.unsafe<(ZeilenRow & { art: string | null; x: number | null; y: number | null })[]>(
        `SELECT ${ZEILEN_SELECT}, p.subtype AS art, public.st_x(p.geom) AS x, public.st_y(p.geom) AS y
           FROM place_review r JOIN place p ON p.id = r.place_id
          WHERE r.public_id = $1::uuid`,
        [id],
    );
    if (zeile === undefined) return null;
    // Jetzt: die öffentlichen Bewertungen des Orts. Danach: dieselben, nachdem diese Bewertung ihren Stand wechselt (öffentlich → raus, sonst → rein).
    const [schnitt] = await db<{ n: number; wert: string | null; n_danach: number; wert_danach: string | null }[]>`
        SELECT count(*) FILTER (WHERE v.zustand IN ('neu', 'gesichtet'))::int AS n,
               round(avg(v.stars) FILTER (WHERE v.zustand IN ('neu', 'gesichtet'))::numeric, 1)::text AS wert,
               count(*) FILTER (WHERE (v.zustand IN ('neu', 'gesichtet')) <> (v.public_id = ${id}::uuid))::int AS n_danach,
               round(avg(v.stars) FILTER (WHERE (v.zustand IN ('neu', 'gesichtet')) <> (v.public_id = ${id}::uuid))::numeric, 1)::text AS wert_danach
          FROM place_review v JOIN place p ON p.id = v.place_id WHERE p.public_id = ${zeile.ort_id}::uuid
    `;
    const zahl = (wert: string | null | undefined): number | null =>
        wert === null || wert === undefined ? null : Number(wert);
    const meldungen = await db<{ id: string; grund: string; zustand: string; ergebnis: string | null }[]>`
        SELECT v.id::text AS id, b.bewertung_grund AS grund, v.zustand, v.ergebnis
          FROM avesmaps_community.vorgang v JOIN avesmaps_community.bezug b ON b.vorgang_id = v.id
         WHERE b.bewertung_id = ${id}::uuid AND v.papierkorb_at IS NULL
         ORDER BY v.id
    `;
    const ereignisse = await db<
        {
            art: BewertungVerlauf["art"];
            von_id: string | null;
            von_name: string | null;
            text: string | null;
            at: Date;
        }[]
    >`
        SELECT e.art, e.von_person::text AS von_id, p.display_name AS von_name, e.text, e.at
          FROM avesmaps_community.bewertung_ereignis e LEFT JOIN avesmaps_auth.person p ON p.id = e.von_person
         WHERE e.bewertung_id = ${id}::uuid ORDER BY e.seq
    `;
    return {
        zeile: zeileAus(zeile),
        ort: {
            id: zeile.ort_id,
            name: zeile.ort_name,
            art: zeile.art,
            lage: zeile.x === null || zeile.y === null ? null : { x: zeile.x, y: zeile.y },
            jetzt: { n: schnitt?.n ?? 0, wert: zahl(schnitt?.wert) },
            danach: { n: schnitt?.n_danach ?? 0, wert: zahl(schnitt?.wert_danach) },
        },
        meldungen: meldungen.map((m) => ({
            nummer: comNummer(m.id),
            grund: m.grund,
            zustand: m.zustand,
            ergebnis: m.ergebnis,
        })),
        verlauf: [
            {
                art: "eingang",
                von: null,
                text: zeile.herkunft === "legacy" ? "legacy" : "website",
                at: zeile.eingang.toISOString(),
            },
            ...ereignisse.map((e): BewertungVerlauf => ({
                art: e.art,
                von: e.von_id === null ? null : { id: e.von_id, name: e.von_name ?? "" },
                text: e.art === "gemeldet" || e.art === "verborgen" || e.art === "freigegeben" ? e.text : null,
                at: e.at.toISOString(),
            })),
        ],
    };
}
