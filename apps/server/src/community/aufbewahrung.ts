import type { Queryable } from "../database.ts";
import { aufbewahren } from "./db.ts";
import { fristen, socialFreigabe, type FristErgebnis, type SocialGlockeErgebnis } from "./glocke.ts";

/**
 * Die Aufbewahrung der Community (WI-0268, Fachkonzept WI-0263 §10.2; Vali 2026-10-31: „name und e-mail werden nach 90 tagen gelöscht, text und
 * meldung bleibt im meldungsarchiv“).
 *
 * Der Worker ruft sie einmal am Tag als aufgezeichneten Job `community_aufbewahrung` (wie `kanal_aufbewahrung`), mit der Jobs-Rolle, die im Schema
 * nur `community_purge_expired()` ausführen darf (`db/community-grants.psql`): erledigte Vorgänge nach 30 Tagen ins Archiv, Kontaktdaten und
 * Statuslink 90 Tage nach dem Abschluss entfernen, den Papierkorb nach 30 Tagen endgültig leeren. Gelöscht wird nur in dieser Funktion.
 *
 * Im selben Lauf erinnert die Glocke an Rückfragen, die seit 30 Tagen unbeantwortet sind (`communityFristen`, WI-0268 C5): an die zuständige Person, ohne
 * Zuständigkeit an die Bearbeitenden, einmal je Rückfrage. Dafür liest die Jobs-Rolle genau fünf Spalten von `vorgang` (`db/community-grants.psql`), nie
 * einen Text, und ruft `benachrichtige()` (`db/system-grants.psql`).
 *
 * 🪤 Ein Eintrag im Protokoll entsteht hier nicht: Die Jobs-Rolle darf das Protokoll der Anmeldung nicht beschreiben
 * (`db/auth-grants.psql` gibt nur der App-Rolle INSERT), und der Kanal hält es ebenso. Was die Aufbewahrung tat, steht als Ergebnis des
 * aufgezeichneten Jobs in der Tafel der Aufträge (Statusseite).
 */
export const COMMUNITY_RETENTION_KIND = "community_aufbewahrung";

export interface CommunityAufbewahrungErgebnis {
    /** Erledigte Vorgänge, die ins Archiv gewandert sind. */
    archiviert: number;
    /** Vorgänge, deren Kontaktdaten und Statuslink entfernt wurden. */
    kontakt: number;
    /** Vorgänge, die der Papierkorb endgültig gelöscht hat. */
    geloescht: number;
}

/** Gibt es die Funktion schon (Migration 0265)? Aus dem Katalog, den jede Rolle lesen darf. */
export async function communityAufbewahrungBereit(db: Queryable): Promise<boolean> {
    const [row] = await db<{ ok: boolean }[]>`
        SELECT to_regprocedure('avesmaps_community.community_purge_expired()') IS NOT NULL AS ok
    `;
    return row?.ok === true;
}

export async function communityAufbewahrung(db: Queryable): Promise<CommunityAufbewahrungErgebnis> {
    return aufbewahren(db);
}

/** Die Fristen der Rückfragen (30 Tage) in die Glocke; die Umgebung ist die der Glocke dieses Ausführers (`AVESMAPS_ENV`). */
export async function communityFristen(db: Queryable, umgebung: string): Promise<FristErgebnis> {
    return fristen(db, umgebung);
}

export interface BeitragAufbewahrungErgebnis {
    /** Vorschläge der Routine, die nach sieben Tagen ohne Freigabe in den Papierkorb gingen (WI-0270 C11, Frischeprüfung). */
    beitraegeVerfallen: number;
    /** Beiträge, die der Papierkorb nach 30 Tagen endgültig gelöscht hat. */
    beitraegeGeloescht: number;
}

/** Gibt es die Funktion für die Beiträge schon (Migration 0269)? */
export async function communityBeitragAufbewahrungBereit(db: Queryable): Promise<boolean> {
    const [row] = await db<{ ok: boolean }[]>`
        SELECT to_regprocedure('avesmaps_community.beitrag_purge_expired()') IS NOT NULL AS ok
    `;
    return row?.ok === true;
}

/**
 * Die Frischeprüfung der Vorschläge der Routine und der Papierkorb der Beiträge (WI-0270 C11, Fachkonzept §15.3 und §15.4), mit der Jobs-Rolle: ein Vorschlag,
 * der sieben Tage liegt, verfällt in den Papierkorb; der Papierkorb ist nach 30 Tagen leer. Eine eigene Funktion neben `community_purge_expired`, damit deren
 * Ergebnis unverändert bleibt.
 */
export async function communityBeitragAufbewahrung(db: Queryable): Promise<BeitragAufbewahrungErgebnis> {
    const leer = { beitraegeVerfallen: 0, beitraegeGeloescht: 0 };
    const [row] = await db<{ ergebnis: Partial<BeitragAufbewahrungErgebnis> }[]>`
        SELECT avesmaps_community.beitrag_purge_expired() AS ergebnis
    `;
    return { ...leer, ...row?.ergebnis };
}

/** Die Vorschläge der Routine in die Glocke (WI-0270 C11): „Beitrag SOC-… wartet auf Freigabe“ an die Betreiber, einmal je Beitrag. */
export async function communitySocialFreigabe(db: Queryable, umgebung: string): Promise<SocialGlockeErgebnis> {
    return socialFreigabe(db, umgebung);
}
