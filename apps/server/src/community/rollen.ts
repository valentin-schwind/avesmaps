import {
    AVENTURIA,
    REGIONALE_ROLLEN,
    SONDERROLLEN_NAMEN,
    isSonderrolle,
    rollenDesBezugs,
    rollenGeordnet,
    sonderrolleSpec,
    type CommunityLage,
    type CommunityPerson,
    type RollenInhaber,
    type VorgangDetail,
    type VorgangRolle,
} from "@avesmaps3d/shared";
import { sonderrollenLesbar } from "../auth/sonderrollen.ts";
import type postgres from "postgres";
import type { Queryable } from "../database.ts";
import { rufe } from "./db.ts";
import { bearbeitende, bestenfalls, rollenZugewiesen, type GlockeLog } from "./glocke.ts";
import { lageDesObjekts } from "./regionen.ts";

/**
 * Meldungen an Sonderrollen in der Datenbank (WI-0279, Migration 0339; Vertrag `packages/shared/src/community-rollen.ts`). Wer eine Rolle hat, rechnet hier; was gilt
 * (Menge setzen, Revision, Verlauf, nur beim Eingang), steht in den Funktionen `community_rollen` und `community_rollen_eingang`.
 *
 * - **Inhaber** einer Rolle für eine Meldung: aktive Personen dieser Umgebung mit der Rolle, die Meldungen bearbeiten dürfen (`moderate_submissions`); bei regionalen
 *   Rollen nur in einer Region der Meldung. 🔴 Wer die Meldung nicht öffnen kann (etwa ein Tester mit der Rolle), zählt nicht: Er bekommt keine Glocke, und für ihn setzt
 *   der Eingang keine Rolle (Claudias Setzung, im Bericht genannt).
 * - **Regionen einer Meldung:** die festgehaltenen (`vorgang_region`, die kleinste zuerst), sonst die an der Stelle (gemeldete Lage, Vorschlag, sonst das Objekt).
 * - 🪤 **Ohne `community-grants.psql`** (Rechte an den neuen Tafeln fehlen noch) oder ohne Leserecht an den Sonderrollen gibt es keine Rollen: Liste und Fenster laufen wie
 *   vorher, statt an einem gescheiterten Lesen die Transaktion zu verlieren.
 */

type Bezug = NonNullable<VorgangDetail["bezug"]>;
type Stelle = Pick<Bezug, "objektArt" | "objektId" | "lage" | "vorschlagLage">;
export interface Region {
    readonly id: string;
    readonly name: string;
}

/** Darf diese Datenbankrolle die Rollen der Meldungen lesen (Migration 0339 und `community-grants.psql`)? */
export async function rollenLesbar(db: Queryable): Promise<boolean> {
    const [row] = await db<{ ja: boolean | null }[]>`
        SELECT has_table_privilege(current_user, to_regclass('avesmaps_community.vorgang_rolle')::oid, 'SELECT')
           AND has_table_privilege(current_user, to_regclass('avesmaps_community.vorgang_region')::oid, 'SELECT') AS ja
    `;
    return row?.ja === true;
}

/** Meine Sonderrollen in dieser Umgebung, bei regionalen je Region eine Zeile. Für „Meine“ in der Liste. */
export async function meineRollen(
    db: Queryable,
    umgebung: string,
    person: string,
): Promise<{ global: string[]; regional: { rolle: string; region: string }[] }> {
    const meine = { global: [] as string[], regional: [] as { rolle: string; region: string }[] };
    if (!(await sonderrollenLesbar(db))) return meine;
    const rows = await db<{ sonderrolle: string; region: string | null }[]>`
        SELECT z.sonderrolle, z.region_public_id::text AS region
          FROM avesmaps_auth.sonderrolle_zuteilung z
         WHERE z.person_id = ${person}::uuid AND z.environment = ${umgebung} AND z.revoked_at IS NULL
    `;
    for (const row of rows) {
        if (!isSonderrolle(row.sonderrolle)) continue;
        if (sonderrolleSpec(row.sonderrolle).regional === true) {
            if (row.region !== null) meine.regional.push({ rolle: row.sonderrolle, region: row.region });
        } else meine.global.push(row.sonderrolle);
    }
    return meine;
}

/** Die Regionen (Ebene `derographisch`) an einem Punkt, die kleinste zuerst. */
async function regionenAmPunkt(db: Queryable, punkt: CommunityLage): Promise<Region[]> {
    return db<Region[]>`
        SELECT r.public_id::text AS id, r.name
          FROM region_area a
          JOIN region r ON r.id = a.region_id
         WHERE a.map_domain_id = ${AVENTURIA.mapDomain} AND a.is_active AND r.is_active AND r.region_layer = 'derographisch'
           AND ST_Covers(a.geom, ST_SetSRID(ST_MakePoint(${punkt.x}, ${punkt.y}), 0))
         GROUP BY r.public_id, r.name
         ORDER BY min(ST_Area(a.geom)), r.name, r.public_id
    `;
}

/** Die Regionen an der Stelle eines Bezugs: gemeldete Lage, sonst Vorschlag, sonst das Objekt selbst. Ohne Stelle: keine. */
export async function regionenAnStelle(db: Queryable, bezug: Stelle | null): Promise<Region[]> {
    if (bezug === null) return [];
    const punkt = bezug.lage ?? bezug.vorschlagLage ?? (await lageDesObjekts(db, bezug));
    return punkt === null ? [] : regionenAmPunkt(db, punkt);
}

/** Die Regionen einer Meldung: festgehalten (seit der ersten Rolle), sonst an der Stelle. */
export async function regionenDerMeldung(db: Queryable, id: number, bezug: Stelle | null): Promise<Region[]> {
    const fest = await db<Region[]>`
        SELECT g.region_public_id::text AS id, COALESCE(r.name, '') AS name
          FROM avesmaps_community.vorgang_region g
          LEFT JOIN region r ON r.public_id = g.region_public_id AND r.map_domain_id = ${AVENTURIA.mapDomain}
         WHERE g.vorgang_id = ${id}::bigint
         ORDER BY g.rang, r.name
    `;
    return fest.length > 0 ? fest : regionenAnStelle(db, bezug);
}

/** Der Bezug einer Meldung, so weit die Regionen ihn brauchen. */
export async function stelleVon(db: Queryable, id: number): Promise<Stelle | null> {
    const [b] = await db<
        {
            objekt_art: Bezug["objektArt"];
            objekt_id: string | null;
            lage_x: number | null;
            lage_y: number | null;
            vorschlag_x: number | null;
            vorschlag_y: number | null;
        }[]
    >`
        SELECT objekt_art, objekt_id::text, lage_x, lage_y, vorschlag_x, vorschlag_y
          FROM avesmaps_community.bezug WHERE vorgang_id = ${id}::bigint ORDER BY id LIMIT 1
    `;
    if (b === undefined) return null;
    const lage = (x: number | null, y: number | null) => (x === null || y === null ? null : { x, y });
    return {
        objektArt: b.objekt_art,
        objektId: b.objekt_id,
        lage: lage(b.lage_x, b.lage_y),
        vorschlagLage: lage(b.vorschlag_x, b.vorschlag_y),
    };
}

export interface Inhaber {
    readonly personen: CommunityPerson[];
    /** Die Regionen der Meldung, in denen jemand die (regionale) Rolle hat, in der Reihenfolge der Meldung. */
    readonly regionen: string[];
}

/**
 * Wer die Rollen für eine Meldung hat: aktiv, in dieser Umgebung, darf Meldungen bearbeiten; regionale Rollen nur in einer der Regionen. Ohne Leserecht an den
 * Sonderrollen: niemand.
 */
export async function inhaberJeRolle(
    db: Queryable,
    umgebung: string,
    rollen: readonly string[],
    regionen: readonly string[],
): Promise<Map<string, Inhaber>> {
    const ergebnis = new Map<string, Inhaber>();
    if (rollen.length === 0 || !(await sonderrollenLesbar(db))) return ergebnis;
    const rows = await db<{ sonderrolle: string; region: string | null; id: string; name: string }[]>`
        SELECT z.sonderrolle, z.region_public_id::text AS region, p.id::text AS id, p.display_name AS name
          FROM avesmaps_auth.sonderrolle_zuteilung z
          JOIN avesmaps_auth.person p ON p.id = z.person_id AND p.status = 'active'
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = z.environment AND a.status = 'active'
         WHERE z.environment = ${umgebung} AND z.revoked_at IS NULL AND z.sonderrolle = ANY(${[...rollen]}::text[])
           AND (z.region_public_id IS NULL OR z.region_public_id = ANY(${[...regionen]}::uuid[]))
         ORDER BY z.sonderrolle, lower(p.display_name), p.id
    `;
    if (rows.length === 0) return ergebnis;
    const duerfen = new Set(await bearbeitende(db, umgebung));
    for (const row of rows) {
        if (!isSonderrolle(row.sonderrolle) || !duerfen.has(row.id)) continue;
        const regional = sonderrolleSpec(row.sonderrolle).regional === true;
        if (regional && row.region === null) continue;
        const eintrag = ergebnis.get(row.sonderrolle) ?? { personen: [], regionen: [] };
        if (!eintrag.personen.some((person) => person.id === row.id))
            eintrag.personen.push({ id: row.id, name: row.name });
        if (regional && row.region !== null && !eintrag.regionen.includes(row.region))
            eintrag.regionen.push(row.region);
        ergebnis.set(row.sonderrolle, eintrag);
    }
    for (const eintrag of ergebnis.values()) eintrag.regionen.sort((a, b) => regionen.indexOf(a) - regionen.indexOf(b));
    return ergebnis;
}

/** Die Empfänger der Glocke je Rolle (Kennungen). */
const empfaengerVon = (rollen: readonly string[], inhaber: ReadonlyMap<string, Inhaber>): Map<string, string[]> =>
    new Map(rollen.map((rolle) => [rolle, (inhaber.get(rolle)?.personen ?? []).map((person) => person.id)]));

export interface RollenErgebnis {
    readonly rollen: string[];
    /** Je neu gesetzter Rolle, wer sie hat (für die Glocke). */
    readonly empfaenger: Map<string, string[]>;
}

/**
 * Zuweisen beim Eingang (Vali 2026-11-11, „wenn möglich“): aus der Art des Bezugs und „Etwas fehlt“ (`rollenDesBezugs`), dazu Ortskundiger und Regionalkanzler, wenn die
 * Stelle in einer Region liegt; gesetzt wird nur, was jemand hat. Aufzurufen in DERSELBEN Transaktion, die die Meldung anlegt (die Funktion prüft es); eine Wiederholung
 * setzt nichts.
 */
export async function rollenBeimEingang(db: Queryable, umgebung: string, id: number): Promise<RollenErgebnis> {
    const leer: RollenErgebnis = { rollen: [], empfaenger: new Map() };
    const [vorgang] = await db<{ art: string; fehlt_art: string | null; frisch: boolean }[]>`
        SELECT art, fehlt_art, eingegangen_at = now() AS frisch FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
    `;
    if (vorgang === undefined || vorgang.art !== "meldung" || !vorgang.frisch) return leer;
    const [bezug] = await db<{ art: string; objekt_art: string | null; typ: string | null }[]>`
        SELECT art, objekt_art, typ FROM avesmaps_community.bezug WHERE vorgang_id = ${id}::bigint ORDER BY id LIMIT 1
    `;
    const fachlich = rollenDesBezugs(
        bezug?.art === "objekt" ? { objektArt: bezug.objekt_art, typ: bezug.typ } : null,
        vorgang.fehlt_art,
    );
    const regionen = await regionenAnStelle(db, await stelleVon(db, id));
    const kandidaten = rollenGeordnet([...fachlich, ...(regionen.length > 0 ? REGIONALE_ROLLEN : [])]);
    if (kandidaten.length === 0 && regionen.length === 0) return leer;
    const ids = regionen.map((region) => region.id);
    const inhaber = await inhaberJeRolle(db, umgebung, kandidaten, ids);
    const moeglich = kandidaten.filter((rolle) => (inhaber.get(rolle)?.personen.length ?? 0) > 0);
    const [row] = await rufe(
        () => db<{ gesetzt: string[] }[]>`
            SELECT avesmaps_community.community_rollen_eingang(${id}::bigint, ${moeglich}::text[], ${ids}::uuid[]) AS gesetzt
        `,
    );
    const rollen = row?.gesetzt ?? [];
    return { rollen, empfaenger: empfaengerVon(rollen, inhaber) };
}

export interface RollenSetzen {
    operationId: string;
    id: number;
    person: string;
    revision: number;
    rollen: readonly string[];
}

/** Eine Person setzt die ganze Menge; gibt die Revision, was hinzukam und was herausfiel, und die Empfänger der hinzugekommenen Rollen zurück. */
export async function rollenSetzen(
    db: Queryable,
    umgebung: string,
    s: RollenSetzen,
): Promise<{ revision: number; hinzu: string[]; heraus: string[]; empfaenger: Map<string, string[]> }> {
    const regional = s.rollen.some((rolle) => isSonderrolle(rolle) && sonderrolleSpec(rolle).regional === true);
    const stelle = await stelleVon(db, s.id);
    const regionen = regional ? await regionenDerMeldung(db, s.id, stelle) : [];
    const [row] = await rufe(
        () => db<{ ergebnis: { revision: number; hinzu: string[]; heraus: string[] } }[]>`
            SELECT avesmaps_community.community_rollen(
                ${s.operationId}::uuid, ${s.id}::bigint, ${s.person}::uuid, ${s.revision}::int, ${[...s.rollen]}::text[],
                ${regionen.map((region) => region.id)}::uuid[]
            ) AS ergebnis
        `,
    );
    const ergebnis = row?.ergebnis ?? { revision: s.revision, hinzu: [], heraus: [] };
    if (ergebnis.hinzu.length === 0) return { ...ergebnis, empfaenger: new Map() };
    const nachher = await regionenDerMeldung(db, s.id, stelle);
    const inhaber = await inhaberJeRolle(
        db,
        umgebung,
        ergebnis.hinzu,
        nachher.map((region) => region.id),
    );
    return { ...ergebnis, empfaenger: empfaengerVon(ergebnis.hinzu, inhaber) };
}

/**
 * Was das Vorgangsfenster zu den Rollen braucht: die zugewiesenen mit Absender, Zeit, Inhabern und Regionen (Kasten „Zuständig“) und zu jeder Rolle des Katalogs die Inhaber
 * (Blatt „Sonderrollen zuweisen“). Ohne Leserecht: nichts.
 */
export async function rollenImDetail(
    db: Queryable,
    umgebung: string,
    id: number,
    bezug: Stelle | null,
): Promise<{ rollen?: VorgangRolle[]; rollenInhaber?: RollenInhaber[] }> {
    if (!(await rollenLesbar(db))) return {};
    const zeilen = await db<
        {
            sonderrolle: string;
            von_art: "person" | "system";
            von_id: string | null;
            von_name: string | null;
            at: Date;
        }[]
    >`
        SELECT x.sonderrolle, x.von_art, x.von_person::text AS von_id, p.display_name AS von_name, x.at
          FROM avesmaps_community.vorgang_rolle x
          LEFT JOIN avesmaps_auth.person p ON p.id = x.von_person
         WHERE x.vorgang_id = ${id}::bigint
    `;
    const regionen = await regionenDerMeldung(db, id, bezug);
    const name = (region: string): string => regionen.find((r) => r.id === region)?.name ?? "";
    const inhaber = await inhaberJeRolle(
        db,
        umgebung,
        SONDERROLLEN_NAMEN,
        regionen.map((region) => region.id),
    );
    const rollen = rollenGeordnet(zeilen.map((zeile) => zeile.sonderrolle)).map((rolle): VorgangRolle => {
        const zeile = zeilen.find((z) => z.sonderrolle === rolle)!;
        const wer = inhaber.get(rolle);
        const regional = sonderrolleSpec(rolle).regional === true;
        const dort = (wer?.regionen ?? []).map(name).filter((text) => text !== "");
        return {
            sonderrolle: rolle,
            von: {
                art: zeile.von_art,
                person: zeile.von_id === null ? null : { id: zeile.von_id, name: zeile.von_name ?? "" },
            },
            at: zeile.at.toISOString(),
            inhaber: wer?.personen ?? [],
            regionen: !regional ? [] : dort.length > 0 ? dort : regionen.slice(0, 1).map((region) => region.name),
        };
    });
    return {
        ...(rollen.length === 0 ? {} : { rollen }),
        rollenInhaber: SONDERROLLEN_NAMEN.map((rolle) => ({
            sonderrolle: rolle,
            personen: inhaber.get(rolle)?.personen ?? [],
        })),
    };
}

/**
 * Zuweisen beim Eingang samt Glocke, je in einem Savepoint (`bestenfalls`): Scheitert es (etwa weil `community-grants.psql` noch fehlt), gilt die Meldung trotzdem, und eine Zeile
 * im Protokoll sagt es. In DER Transaktion, die die Meldung anlegt (Website, Kanal, „Als Meldung weiterführen“).
 */
export async function rollenAmEingang(
    tx: postgres.TransactionSql,
    log: GlockeLog,
    umgebung: string,
    id: number,
): Promise<void> {
    const stand: { gesetzt?: RollenErgebnis } = {};
    await bestenfalls(tx, log, "Sonderrollen beim Eingang", async (q) => {
        stand.gesetzt = await rollenBeimEingang(q, umgebung, id);
    });
    const gesetzt = stand.gesetzt;
    if (gesetzt === undefined || gesetzt.rollen.length === 0) return;
    await bestenfalls(tx, log, "Sonderrollen beim Eingang", (q) =>
        rollenZugewiesen(q, umgebung, { id, empfaenger: gesetzt.empfaenger, von: null, operationId: null }),
    );
}
