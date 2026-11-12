import { randomUUID } from "node:crypto";
import {
    KANAL_STATUS,
    leseOps,
    opsId,
    type KanalKategorie,
    type KanalPrioritaet,
    type KanalStatus,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

export { KANAL_STATUS, leseOps, opsId, type KanalKategorie, type KanalPrioritaet, type KanalStatus };

/**
 * Der Betreiber-Kanal in der Datenbank (WI-0124, Migration 0106, KANAL-0001 §3 bis §5): dünne Hüllen um die Funktionen des Schemas
 * `avesmaps_kanal`. Die Regeln (Übergänge, wer was darf, Idempotenz, Aufbewahrung) stehen in der Datenbank, nicht hier. Leicht: kein
 * Fastify, damit Kommandozeile, Worker und Routen sie gleich benutzen.
 *
 * Fehler der Funktionen kommen als SQLSTATE der Klasse `KA` und werden hier zu `KanalFehler` mit Fachcode.
 */

export type KanalAgent = "claudio" | "claudia";

export type KanalFehlerCode =
    "kanal_not_found" | "kanal_conflict" | "kanal_transition" | "kanal_forbidden" | "kanal_invalid";

const CODE_VON_SQLSTATE: Record<string, KanalFehlerCode> = {
    KA404: "kanal_not_found",
    KA403: "kanal_forbidden",
    KA422: "kanal_invalid",
};

export class KanalFehler extends Error {
    readonly code: KanalFehlerCode;
    constructor(code: KanalFehlerCode, message: string) {
        super(message);
        this.code = code;
    }
}

/** Ein Fehler der Funktionen als `KanalFehler`; alles andere unverändert. KA409 ist Konflikt (Revision) oder Übergang, je nach Text. */
export function kanalFehler(error: unknown): unknown {
    const code = (error as { code?: unknown } | undefined)?.code;
    if (typeof code !== "string" || !code.startsWith("KA")) return error;
    const message = error instanceof Error ? error.message : String(error);
    const fach =
        code === "KA409"
            ? message.startsWith("kanal_conflict")
                ? "kanal_conflict"
                : "kanal_transition"
            : CODE_VON_SQLSTATE[code];
    return new KanalFehler(fach ?? "kanal_invalid", message.replace(/^kanal_[a-z_]+:\s*/u, ""));
}

async function rufe<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (error) {
        throw kanalFehler(error);
    }
}

const neu = (operation?: string): string => operation ?? randomUUID();

// --- Agenten ---

export interface AbgeholterVorgang {
    id: number;
    art: string;
    kategorie: string;
    prioritaet: KanalPrioritaet;
    status: KanalStatus;
    zustaendig: string;
    titel: string | null;
    gemeldetAt: Date;
    neuesVomBetreiber: boolean;
}

export async function abholen(
    db: Queryable,
    optionen: { anzahl: number; alle?: boolean; als?: KanalAgent },
): Promise<AbgeholterVorgang[]> {
    const rows = await rufe(
        () =>
            db<
                {
                    id: string;
                    art: string;
                    kategorie: string;
                    prioritaet: KanalPrioritaet;
                    status: KanalStatus;
                    zustaendig: string;
                    titel: string | null;
                    gemeldet_at: Date;
                    neues_vom_betreiber: boolean;
                }[]
            >`SELECT * FROM avesmaps_kanal.kanal_abholen(${optionen.anzahl}::integer, ${optionen.alle === true}, ${optionen.als ?? null}::text)`,
    );
    return rows.map((row) => ({
        id: Number(row.id),
        art: row.art,
        kategorie: row.kategorie,
        prioritaet: row.prioritaet,
        status: row.status,
        zustaendig: row.zustaendig,
        titel: row.titel,
        gemeldetAt: row.gemeldet_at,
        neuesVomBetreiber: row.neues_vom_betreiber,
    }));
}

export async function lesen(db: Queryable, id: number, als?: KanalAgent): Promise<Record<string, unknown>> {
    const [row] = await rufe(
        () =>
            db<
                { v: Record<string, unknown> }[]
            >`SELECT avesmaps_kanal.kanal_lesen(${id}::bigint, ${als ?? null}::text) AS v`,
    );
    return row?.v ?? {};
}

export async function eintragen(
    db: Queryable,
    id: number,
    art: "rueckfrage" | "antwort" | "befund",
    text: string,
    optionen: { als?: KanalAgent; operation?: string } = {},
): Promise<void> {
    await rufe(
        () =>
            db`SELECT avesmaps_kanal.kanal_eintragen(${neu(optionen.operation)}::uuid, ${id}::bigint, ${art}, ${text}, ${optionen.als ?? null}::text)`,
    );
}

export async function status(
    db: Queryable,
    id: number,
    nach: KanalStatus,
    optionen: { text?: string; kurztitel?: string; als?: KanalAgent; operation?: string } = {},
): Promise<number> {
    const [row] = await rufe(
        () => db<{ r: number }[]>`
            SELECT avesmaps_kanal.kanal_status(${neu(optionen.operation)}::uuid, ${id}::bigint, ${nach}, ${optionen.text ?? null}::text,
                                               ${optionen.kurztitel ?? null}::text, ${optionen.als ?? null}::text) AS r
        `,
    );
    return Number(row?.r);
}

export async function einstufen(
    db: Queryable,
    id: number,
    optionen: { kategorie?: string; prioritaet?: string; begruendung: string; als?: KanalAgent; operation?: string },
): Promise<void> {
    await rufe(
        () => db`
            SELECT avesmaps_kanal.kanal_einstufen(${neu(optionen.operation)}::uuid, ${id}::bigint, ${optionen.kategorie ?? null}::text,
                                                  ${optionen.prioritaet ?? null}::text, ${optionen.begruendung}, ${optionen.als ?? null}::text)
        `,
    );
}

export interface AenderungEingabe {
    vorgang?: number;
    klasse: "A" | "B" | "C";
    art: "code" | "betrieb" | "diagnose";
    was: string;
    grund?: string;
    dateien?: string[];
    commit?: string;
    release?: string;
    tests?: string;
    ruecknahme?: string;
}

export async function aenderung(
    db: Queryable,
    eingabe: AenderungEingabe,
    optionen: { als?: KanalAgent; operation?: string } = {},
): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_aenderung(
                ${neu(optionen.operation)}::uuid, ${eingabe.vorgang ?? null}::bigint, ${eingabe.klasse}, ${eingabe.art}, ${eingabe.was},
                ${eingabe.grund ?? null}::text, ${eingabe.dateien ?? []}::text[], ${eingabe.commit ?? null}::text,
                ${eingabe.release ?? null}::text, ${eingabe.tests ?? null}::text, ${eingabe.ruecknahme ?? null}::text,
                ${optionen.als ?? null}::text
            ) AS id
        `,
    );
    return Number(row?.id);
}

export async function beobachtung(
    db: Queryable,
    aenderungId: number,
    ergebnis: "unauffaellig" | "fehler" | "fallback" | "rollback" | "offen",
    text: string | undefined,
    optionen: { als?: KanalAgent; operation?: string } = {},
): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_beobachtung(${neu(optionen.operation)}::uuid, ${aenderungId}::bigint, ${ergebnis},
                                                    ${text ?? null}::text, ${optionen.als ?? null}::text) AS id
        `,
    );
    return Number(row?.id);
}

export async function nachweis(
    db: Queryable,
    id: number,
    station: "fix_committed" | "auf_stage" | "production_live" | "production_zurueck",
    optionen: { commit?: string; release?: string; notiz?: string; als?: KanalAgent; operation?: string },
): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_nachweis(${neu(optionen.operation)}::uuid, ${id}::bigint, ${station}, ${optionen.commit ?? null}::text,
                                                 ${optionen.release ?? null}::text, ${optionen.notiz ?? null}::text, ${optionen.als ?? null}::text) AS id
        `,
    );
    return Number(row?.id);
}

/**
 * Eine Production-Freigabe abschließen (FREIGABE-0001, Migration 0123). 🔴 Nur Claudio, nur bei `art = 'freigabe'` und nur,
 * wenn der Nachweis `production_live` oder `production_zurueck` dasteht — das prüft die Funktion selbst. `false` heißt: war
 * schon abgeschlossen.
 */
export async function freigabeAbschluss(
    db: Queryable,
    id: number,
    optionen: { als?: KanalAgent; operation?: string } = {},
): Promise<boolean> {
    const [row] = await rufe(
        () => db<{ ok: boolean }[]>`
            SELECT avesmaps_kanal.kanal_freigabe_abschluss(${neu(optionen.operation)}::uuid, ${id}::bigint,
                                                           ${optionen.als ?? null}::text) AS ok
        `,
    );
    return row?.ok === true;
}

export async function nachpruefen(
    db: Queryable,
    aenderungId: number,
    ergebnis: "ok" | "nachbessern",
    notiz: string | undefined,
    optionen: { als?: KanalAgent; operation?: string } = {},
): Promise<void> {
    await rufe(
        () => db`
            SELECT avesmaps_kanal.kanal_nachpruefen(${neu(optionen.operation)}::uuid, ${aenderungId}::bigint, ${ergebnis},
                                                    ${notiz ?? null}::text, ${optionen.als ?? null}::text)
        `,
    );
}

export async function aenderungenOffen(db: Queryable, als?: KanalAgent): Promise<Record<string, unknown>[]> {
    const [row] = await rufe(
        () =>
            db<
                { v: Record<string, unknown>[] }[]
            >`SELECT avesmaps_kanal.kanal_aenderungen_offen(${als ?? null}::text) AS v`,
    );
    return row?.v ?? [];
}

// --- Betreiber (die App; Recht und Person hat sie geprüft) ---

export interface Meldung {
    environment: string;
    person: string;
    kategorie: KanalKategorie;
    prioritaet: KanalPrioritaet;
    titel: string;
    nachricht: string;
    schritte?: string;
    kontext?: Record<string, unknown>;
    folgtAuf?: number;
}

export async function melden(db: Queryable, meldung: Meldung, operation?: string): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_melden(
                ${neu(operation)}::uuid, ${meldung.environment}, ${meldung.person}::uuid, ${meldung.kategorie}, ${meldung.prioritaet},
                ${meldung.titel}, ${meldung.nachricht}, ${meldung.schritte ?? null}::text, ${db.json((meldung.kontext ?? {}) as never)}::jsonb,
                ${meldung.folgtAuf ?? null}::bigint
            ) AS id
        `,
    );
    return Number(row?.id);
}

/**
 * Eine Meldung aus Discord (WI-0255 Paket 2, Migration 0231): Sie kommt `zu_sichten` an, zuständig ist der Betreiber. Die App hat die Signatur
 * von Discord geprüft und Text und Namen bereinigt (`discord/interaktion.ts`); die Kennung der Person bleibt intern.
 */
export interface DiscordMeldung {
    environment: string;
    kategorie: "bug" | "idee" | "nutzerfrage";
    titel: string;
    nachricht: string;
    melderName: string;
    melderKennung: string | null;
    kontext: Record<string, string>;
}

export async function discordMelden(db: Queryable, meldung: DiscordMeldung, operation: string): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_discord_melden(
                ${operation}::uuid, ${meldung.environment}, ${meldung.kategorie}, ${meldung.titel}, ${meldung.nachricht},
                ${meldung.melderName}, ${meldung.melderKennung}::text, ${db.json(meldung.kontext as never)}::jsonb
            ) AS id
        `,
    );
    return Number(row?.id);
}

/** Ein Betreiber gibt einen Vorgang aus Discord frei: `zu_sichten` → `neu`, an Claudio oder Claudia (ohne `an`: Regel der Kategorie). */
export async function sichten(
    db: Queryable,
    id: number,
    person: string,
    revision: number,
    an: KanalAgent | undefined,
    operation?: string,
): Promise<number> {
    const [row] = await rufe(
        () => db<{ r: number }[]>`
            SELECT avesmaps_kanal.kanal_sichten(${neu(operation)}::uuid, ${id}::bigint, ${person}::uuid, ${revision}::integer,
                                                ${an ?? null}::text) AS r
        `,
    );
    return Number(row?.r);
}

/**
 * Ein Betreiber hat einen Vorgang aus Discord an die Community weitergeleitet und Production hat die COM-Nummer genannt (WI-0297, Migration 0332):
 * `zu_sichten` → `abgenommen`, Abschluss `an_community`. Dieselbe Nummer noch einmal ist nichts.
 */
export async function anCommunity(
    db: Queryable,
    id: number,
    person: string,
    revision: number,
    community: string,
    operation?: string,
): Promise<number> {
    const [row] = await rufe(
        () => db<{ r: number }[]>`
            SELECT avesmaps_kanal.kanal_an_community(${neu(operation)}::uuid, ${id}::bigint, ${person}::uuid, ${revision}::integer,
                                                     ${community}) AS r
        `,
    );
    return Number(row?.r);
}

export async function nachricht(
    db: Queryable,
    id: number,
    person: string,
    text: string,
    operation?: string,
): Promise<void> {
    await rufe(
        () =>
            db`SELECT avesmaps_kanal.kanal_nachricht(${neu(operation)}::uuid, ${id}::bigint, ${person}::uuid, ${text})`,
    );
}

export async function abnehmen(
    db: Queryable,
    id: number,
    person: string,
    revision: number,
    operation?: string,
): Promise<number> {
    const [row] = await rufe(
        () => db<{ r: number }[]>`
            SELECT avesmaps_kanal.kanal_abnehmen(${neu(operation)}::uuid, ${id}::bigint, ${person}::uuid, ${revision}::integer) AS r
        `,
    );
    return Number(row?.r);
}

/**
 * Der Betreiber schließt selbst ab (Migration 0127): `erledigt` oder `abgebrochen`, aus jedem offenen Status. Die Begründung ist
 * für `abgebrochen` Pflicht, das prüft die Funktion.
 */
export async function abschliessen(
    db: Queryable,
    id: number,
    person: string,
    revision: number,
    art: "erledigt" | "abgebrochen",
    begruendung: string | null,
    operation?: string,
): Promise<number> {
    const [row] = await rufe(
        () => db<{ r: number }[]>`
            SELECT avesmaps_kanal.kanal_abschliessen(${neu(operation)}::uuid, ${id}::bigint, ${person}::uuid,
                                                     ${revision}::integer, ${art}, ${begruendung}) AS r
        `,
    );
    return Number(row?.r);
}

export async function wiederOeffnen(
    db: Queryable,
    id: number,
    person: string,
    revision: number,
    kommentar: string,
    operation?: string,
): Promise<number> {
    const [row] = await rufe(
        () => db<{ r: number }[]>`
            SELECT avesmaps_kanal.kanal_wieder_oeffnen(${neu(operation)}::uuid, ${id}::bigint, ${person}::uuid, ${revision}::integer,
                                                       ${kommentar}) AS r
        `,
    );
    return Number(row?.r);
}

/** „Meldung jetzt löschen“: `true`, wenn sie jetzt geleert wurde; `false`, wenn es schon der Rest war. */
export async function loeschen(db: Queryable, id: number, person: string): Promise<boolean> {
    const [row] = await rufe(
        () => db<{ ok: boolean }[]>`SELECT avesmaps_kanal.kanal_loeschen(${id}::bigint, ${person}::uuid) AS ok`,
    );
    return row?.ok === true;
}

export async function wiederherstellungBeantragen(
    db: Queryable,
    eingabe: { environment: string; person: string; sicherung: string; umfang: string; grund: string },
    operation?: string,
): Promise<number> {
    const [row] = await rufe(
        () => db<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_wiederherstellung(${neu(operation)}::uuid, ${eingabe.environment}, ${eingabe.person}::uuid,
                                                          ${eingabe.sicherung}, ${eingabe.umfang}, ${eingabe.grund}) AS id
        `,
    );
    return Number(row?.id);
}
