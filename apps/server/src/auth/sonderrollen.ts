import {
    AVENTURIA,
    isSonderrolle,
    sonderrolleSpec,
    type RegionRef,
    type SonderrolleAnzeige,
    type SonderrolleName,
} from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";
import { recordEvent, type AuditEvent } from "./audit.ts";
import type { AuthEnvironment } from "./config.ts";
import type { Sql } from "./session-store.ts";

/**
 * Sonderrollen in der Datenbank (WI-0279, Migration 0303). Eine Zuteilung gehört einer Person in einer Umgebung und nennt bei regionalen
 * Rollen genau eine Region; beendet wird sie mit `revoked_at`, nie gelöscht, damit der Verlauf bleibt. Was die Rolle darf, steht im Katalog
 * (`packages/shared/src/auth/sonderrollen.ts`); hier steht nur, wer sie hat.
 *
 * 🪤 Die Rechte an den zwei Tafeln kommen nicht mit der Migration: `auth-grants.psql` spielt Claudio ein, nie der Korridor. Bis dahin
 * müssen Anmeldung, Einladungen und Auflösen weiterlaufen, deshalb die Prüfung `sonderrollenLesbar` statt eines gescheiterten
 * Lesens: Eine gescheiterte Anweisung nähme jeder Anfrage die Anmeldung und bräche jede laufende Transaktion ab.
 */
export interface SonderrollenWahl {
    sonderrolle: SonderrolleName;
    /** Bei regionalen Rollen je gewählte Region, sonst genau `null`. */
    regionen: (RegionRef | null)[];
}

/** Darf diese Datenbankrolle die Tafeln schon lesen? Solange nicht, gibt es für sie keine Sonderrollen. */
export async function sonderrollenLesbar(sql: Sql): Promise<boolean> {
    const [row] = await sql<{ lesbar: boolean | null }[]>`
        SELECT has_table_privilege(current_user, to_regclass('avesmaps_auth.invitation_sonderrolle')::oid, 'SELECT') AS lesbar
    `;
    return row?.lesbar === true;
}

/**
 * Die geltenden Sonderrollen fürs Anzeigen (WI-0279 E9b), je Person und bei regionalen Rollen je Region eine Zeile. Mit `personen` nur die
 * genannten. Eine Rolle, die dieser Katalog nicht kennt, zählt nicht; ohne Leserecht auf die Tafel gibt es keine.
 */
export async function sonderrollenJePerson(
    sql: Sql,
    environment: string,
    personen?: readonly string[],
): Promise<Map<string, SonderrolleAnzeige[]>> {
    const ergebnis = new Map<string, SonderrolleAnzeige[]>();
    if (!(await sonderrollenLesbar(sql))) return ergebnis;
    const rows = await sql<{ person_id: string; sonderrolle: string; region: string | null }[]>`
        SELECT z.person_id::text AS person_id, z.sonderrolle, r.name AS region
          FROM avesmaps_auth.sonderrolle_zuteilung z
          LEFT JOIN region r ON r.public_id = z.region_public_id
         WHERE z.environment = ${environment} AND z.revoked_at IS NULL
           ${personen === undefined ? sql`` : sql`AND z.person_id = ANY(${[...personen]}::uuid[])`}
         ORDER BY z.sonderrolle, lower(r.name)
    `;
    for (const row of rows) {
        if (!isSonderrolle(row.sonderrolle)) continue;
        const liste = ergebnis.get(row.person_id) ?? [];
        liste.push({ sonderrolle: row.sonderrolle, region: row.region });
        ergebnis.set(row.person_id, liste);
    }
    return ergebnis;
}

/** Die Regionen zur Auswahl: die aktiven Flächen der Ebene `derographisch` (E3b). */
export async function ladeRegionen(sql: Sql): Promise<RegionRef[]> {
    return sql<RegionRef[]>`
        SELECT public_id::text AS id, name FROM region
         WHERE map_domain_id = ${AVENTURIA.mapDomain} AND region_layer = 'derographisch' AND is_active
         ORDER BY lower(name), public_id
    `;
}

/** Prüft eine Wahl gegen den Katalog und die Regionen: 400 bei allem, was die Oberfläche so nicht senden kann. */
export async function pruefeWahl(
    sql: Sql,
    sonderrolle: string,
    regionen: readonly string[] | undefined,
): Promise<SonderrollenWahl> {
    if (!isSonderrolle(sonderrolle)) {
        throw new ApiError(400, "sonderrolle_unbekannt", "Diese Sonderrolle gibt es nicht.");
    }
    const ids = [...new Set(regionen ?? [])];
    if (sonderrolleSpec(sonderrolle).regional !== true) {
        if (ids.length > 0) throw new ApiError(400, "sonderrolle_ohne_region", "Diese Sonderrolle hat keine Regionen.");
        return { sonderrolle, regionen: [null] };
    }
    if (ids.length === 0) throw new ApiError(400, "region_fehlt", "Diese Sonderrolle braucht mindestens eine Region.");
    const gefunden = await sql<RegionRef[]>`
        SELECT public_id::text AS id, name FROM region
         WHERE public_id = ANY(${ids}::uuid[]) AND map_domain_id = ${AVENTURIA.mapDomain} AND region_layer = 'derographisch' AND is_active
         ORDER BY lower(name), public_id
    `;
    if (gefunden.length !== ids.length) {
        throw new ApiError(400, "region_unbekannt", "Eine der Regionen gibt es nicht mehr.");
    }
    return { sonderrolle, regionen: gefunden };
}

/** Höchstens eine Person je Region (E3): 409 mit dem Namen, wenn eine andere Person die Rolle dort schon hat. */
export async function pruefeEinePersonJeRegion(
    sql: Sql,
    environment: AuthEnvironment,
    wahl: SonderrollenWahl,
    personId: string | null,
): Promise<void> {
    if (sonderrolleSpec(wahl.sonderrolle).einePersonJeRegion !== true) return;
    const ids = wahl.regionen.flatMap((region) => (region === null ? [] : [region.id]));
    const [halter] = await sql<{ display_name: string; region: string }[]>`
        SELECT p.display_name, z.region_public_id::text AS region
          FROM avesmaps_auth.sonderrolle_zuteilung z
          JOIN avesmaps_auth.person p ON p.id = z.person_id
         WHERE z.environment = ${environment} AND z.sonderrolle = ${wahl.sonderrolle} AND z.revoked_at IS NULL
           AND z.region_public_id = ANY(${ids}::uuid[]) AND z.person_id IS DISTINCT FROM ${personId}::uuid
         ORDER BY lower(p.display_name)
         LIMIT 1
    `;
    if (halter !== undefined) {
        const name = wahl.regionen.find((region) => region?.id === halter.region)?.name ?? "";
        throw new ApiError(
            409,
            "region_vergeben",
            `${name} hat schon jemanden in dieser Rolle: ${halter.display_name}. Höchstens eine Person je Region.`,
        );
    }
}

/** Trägt eine Wahl ein; was die Person schon hat oder was der Index abweist, bleibt aus. Gibt die eingetragenen Regionen zurück. */
export async function trageEin(
    tx: Sql,
    input: {
        personId: string;
        environment: AuthEnvironment;
        wahl: SonderrollenWahl;
        vergebenVon: string | null;
        grund: string;
    },
): Promise<{ id: string; region: RegionRef | null }[]> {
    const eingetragen: { id: string; region: RegionRef | null }[] = [];
    for (const region of input.wahl.regionen) {
        const [row] = await tx<{ id: string }[]>`
            INSERT INTO avesmaps_auth.sonderrolle_zuteilung
                (person_id, environment, sonderrolle, region_public_id, granted_by, reason)
            VALUES (${input.personId}, ${input.environment}, ${input.wahl.sonderrolle}, ${region?.id ?? null}::uuid,
                    ${input.vergebenVon}, ${input.grund})
            ON CONFLICT DO NOTHING
            RETURNING id::text
        `;
        if (row !== undefined) eingetragen.push({ id: row.id, region });
    }
    return eingetragen;
}

/** Merkt die Sonderrollen einer neuen Einladung; wirksam werden sie erst beim Einlösen. */
export async function merkeFuerEinladung(
    tx: Sql,
    invitationId: string,
    wahlen: readonly SonderrollenWahl[],
    grund: string,
): Promise<void> {
    for (const wahl of wahlen) {
        for (const region of wahl.regionen) {
            await tx`
                INSERT INTO avesmaps_auth.invitation_sonderrolle (invitation_id, sonderrolle, region_public_id, reason)
                VALUES (${invitationId}, ${wahl.sonderrolle}, ${region?.id ?? null}::uuid, ${grund})
                ON CONFLICT DO NOTHING
            `;
        }
    }
}

/** „Neu ausstellen“: Die neue Einladung trägt dieselben Sonderrollen wie die alte. */
export async function kopiereEinladung(tx: Sql, vonId: string, nachId: string): Promise<void> {
    await tx`
        INSERT INTO avesmaps_auth.invitation_sonderrolle (invitation_id, sonderrolle, region_public_id, reason)
        SELECT ${nachId}, sonderrolle, region_public_id, reason
          FROM avesmaps_auth.invitation_sonderrolle WHERE invitation_id = ${vonId}
    `;
}

export type EinladungsRolle = { sonderrolle: string; region: RegionRef | null };

/** Die Sonderrollen mehrerer Einladungen, für die Liste. Ohne Leserecht auf die Tafel: keine. */
export async function ladeEinladungsRollen(
    sql: Sql,
    einladungen: readonly string[],
): Promise<Map<string, EinladungsRolle[]>> {
    const ergebnis = new Map<string, EinladungsRolle[]>();
    if (einladungen.length === 0 || !(await sonderrollenLesbar(sql))) return ergebnis;
    const rows = await sql<
        { invitation_id: string; sonderrolle: string; region_id: string | null; region_name: string | null }[]
    >`
        SELECT s.invitation_id, s.sonderrolle, s.region_public_id::text AS region_id, r.name AS region_name
          FROM avesmaps_auth.invitation_sonderrolle s
          LEFT JOIN region r ON r.public_id = s.region_public_id
         WHERE s.invitation_id = ANY(${[...einladungen]}::uuid[])
         ORDER BY s.sonderrolle, lower(r.name)
    `;
    for (const row of rows) {
        const liste = ergebnis.get(row.invitation_id) ?? [];
        liste.push({
            sonderrolle: row.sonderrolle,
            region: row.region_id === null ? null : { id: row.region_id, name: row.region_name ?? "" },
        });
        ergebnis.set(row.invitation_id, liste);
    }
    return ergebnis;
}

/**
 * Löst die Sonderrollen einer Einladung ein, in der Transaktion der Annahme. Hat inzwischen eine andere Person eine Region mit
 * „höchstens eine Person“, bleibt nur diese eine Zuteilung aus (der Index weist sie ab) und steht als `uebersprungen` im Protokoll: Die
 * Einladung selbst gilt weiter, die Person soll nicht an einer Zuständigkeit scheitern, die ein Betreiber danach klären kann.
 */
export async function loeseEinladungEin(
    tx: Sql,
    input: { invitationId: string; personId: string; environment: AuthEnvironment },
    meta: Pick<AuditEvent, "ipPrefix" | "clientLabel">,
): Promise<void> {
    if (!(await sonderrollenLesbar(tx))) return;
    const rows = await tx<
        {
            sonderrolle: string;
            region_id: string | null;
            region_name: string | null;
            reason: string;
            created_by: string | null;
        }[]
    >`
        SELECT s.sonderrolle, s.region_public_id::text AS region_id, r.name AS region_name, s.reason, i.created_by
          FROM avesmaps_auth.invitation_sonderrolle s
          JOIN avesmaps_auth.invitation i ON i.id = s.invitation_id
          LEFT JOIN region r ON r.public_id = s.region_public_id
         WHERE s.invitation_id = ${input.invitationId}
         ORDER BY s.sonderrolle, lower(r.name)
    `;
    if (rows.length === 0) return;
    const eingetragen: string[] = [];
    const uebersprungen: string[] = [];
    for (const row of rows) {
        if (!isSonderrolle(row.sonderrolle)) continue;
        const region = row.region_id === null ? null : { id: row.region_id, name: row.region_name ?? "" };
        const treffer = await trageEin(tx, {
            personId: input.personId,
            environment: input.environment,
            wahl: { sonderrolle: row.sonderrolle, regionen: [region] },
            vergebenVon: row.created_by,
            grund: row.reason,
        });
        const text = region === null ? row.sonderrolle : `${row.sonderrolle} (${region.name})`;
        (treffer.length > 0 ? eingetragen : uebersprungen).push(text);
    }
    await recordEvent(tx, {
        environment: input.environment,
        action: "sonderrolle.eingeladen",
        actorKind: "person",
        actorPersonId: input.personId,
        targetPersonId: input.personId,
        targetRef: input.invitationId,
        details: { sonderrollen: eingetragen, uebersprungen },
        ...meta,
    });
}
