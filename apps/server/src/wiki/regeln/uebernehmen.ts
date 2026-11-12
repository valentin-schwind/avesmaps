import {
    UUID_PATTERN,
    WIKISYNC_LAGE_ORTSARTEN,
    type OperationReceipt,
    type WikisyncRegelBedingung,
} from "@avesmaps3d/shared";
import type { Sql } from "../../auth/session-store.ts";
import type { MapAuditEntry } from "../../editor/map-operation.ts";
import { ApiError } from "../../http/api-error.ts";
import { lageProtokoll } from "../../migration/lore-keys.ts";
import { titelAusWikiAdresse } from "../vorschau/adresse.ts";
import type { VorschlagBeziehung } from "./vorschlag.ts";

/**
 * Die Übernahme der ausgewählten Regelvorschläge und ihre Rücknahme (WI-0253 Scheibe Regelvorschläge, §24). Geschrieben wird allein, was im Fenster angehakt ist:
 *
 * - **Nur `lore_rule` mit Herkunft `wiki_verbreitung`** (`source_system = 'wikisync'`). Eine Regel der Redaktion (Herkunft `manual`) oder mit unbekannter Herkunft überschreibt, löscht und ersetzt diese Übernahme
 *   nie; eine manuell bearbeitete abgeleitete Regel gehört ab dann der Redaktion (der Editor setzt die Herkunft). Ein Eintrag der Redaktion (`source_system = 'editor'`) bleibt ganz. Die Ortszeilen
 *   fasst sie nicht an: Eine Regel tritt NEBEN die genannten Orte, nie an ihre Stelle.
 * - **Nur, wo der Stand noch der der Ableitung ist:** die bisherigen wiki-abgeleiteten Regeln (Fingerabdrücke) stehen noch so da, jede Fläche der Bedingungen gibt es noch und ist noch dieselbe, und eine
 *   offene Fläche hat noch immer keinen Artikel. Sonst bleibt der Vorschlag liegen (Warnung `seit_vorschau_geaendert`) und wird neu abgeleitet.
 * - **Anlegen statt ändern:** Eine Regel ändert sich nie in ihrer Kette, eine andere Kette ist eine andere Regel (`rule_key`). Die alte wird still gelegt (`retired_origin = 'wikisync'`, nie gelöscht).
 * - 🔴 **Was die Redaktion gestaltet hat, bleibt** (Regeleditor im Reiter „Vorkommen“, WI-0254, Entscheidung Claudia zu WI-0253 §26: nur die Regel gehört der Redaktion, nicht der Eintrag): Eine Beziehung, in der die
 *   Redaktion eine Regel ersetzt oder entfernt hat (`retired_origin = 'editor'`) und keine Wiki-Regel mehr steht, fasst die Übernahme nicht an; sie belebt nie eine Regel, die die Redaktion still legte, nur die, die
 *   sie selbst still legte (`retired_origin = 'wikisync'`). Was das Wiki seitdem sagt, steht im Editor als „Das Wiki sagt seitdem …“ an der Regel von Hand.
 * - **Die Lage zu einer Linie** (WI-0254, Migration 0250): Die Orte einer Bedingung stehen im Vorschlag mit ihrer Kennung (`place.public_id`) und werden hier auf `place.id` gelöst. Fehlt ein Ort oder ist er still gelegt
 *   oder keine Siedlung mehr, ist der Vorschlag veraltet (Warnung `seit_vorschau_geaendert`, nichts wird geschrieben); eine Bedingung nur mit Lage „träfe“ nicht alles, sie sagt „alles südlich von …“.
 * - **Rücknahme je Übernahme:** Die angelegten Regeln werden still gelegt, die still gelegten leben wieder auf, je Regel nur, wo sie noch so dasteht.
 * - Fachprotokoll wie der Editor (\`map_operation\` und \`map_audit_event\`, Art \`lore\`, Feld \`rules\`), die Revision des Eintrags zählt hoch (ein offener Entwurf im Fenster „Inhalte bearbeiten“ bekommt 409).
 */

interface Akteur {
    personId: string | null;
    label: string;
}

type Tx = Sql;

interface RegelZeile {
    id: string;
    lore_entry_id: string;
    relation: string;
    rule_key: string;
    legacy_origin: string;
    state: string;
    source_system: string;
    retired_origin: string | null;
}

interface VorschlagZeile {
    id: number;
    lore_entry_id: string;
    eintrag_name: string;
    waehlbar: boolean;
    payload: { regeln: (VorschlagBeziehung & { bisherIds?: string[] })[] };
}

export interface RegelArbeit {
    receipt: Omit<OperationReceipt, "operationId" | "status" | "environment">;
    entries: MapAuditEntry[];
    summary: string;
}

const warnung = (code: string, text: string): { code: string; message: string } => ({ code, message: text });

const UUID = new RegExp(UUID_PATTERN, "u");

/** Der Lauf, aus dem übernommen wird, ist die Grundlage: der jüngste fertige mit Regelvorschlägen, nach der heutigen Begriffstafel gerechnet. */
async function pruefeLauf(tx: Tx, lauf: number): Promise<void> {
    const [neuester] = await tx<{ lauf_id: number; begriffe_revision: number | null }[]>`
        SELECT r.lauf_id::int AS lauf_id, r.begriffe_revision::int AS begriffe_revision
          FROM wikisync_regel_lauf r JOIN wikisync_lauf l ON l.id = r.lauf_id
         WHERE l.status = 'fertig' ORDER BY r.lauf_id DESC LIMIT 1
    `;
    if (neuester === undefined || neuester.lauf_id !== lauf) {
        throw new ApiError(
            409,
            "vorschau_veraltet",
            "Es gibt eine neuere Ableitung; die Vorschläge dieses Laufs sind nicht mehr die Grundlage.",
            {
                lauf: neuester?.lauf_id ?? null,
            },
        );
    }
    const [stand] = await tx<
        { revision: number }[]
    >`SELECT revision::int AS revision FROM wikisync_begriff_state WHERE id = 1`;
    if (stand !== undefined && neuester.begriffe_revision !== stand.revision) {
        throw new ApiError(
            409,
            "begriffe_geaendert",
            "Die Begriffstafel hat sich seit der Ableitung geändert; die Vorschläge müssen erst neu abgeleitet werden.",
            {
                lauf,
            },
        );
    }
}

const arten = (b: WikisyncRegelBedingung): string => b.arten.map((a) => `${a.ebene}/${a.art}`).join(",");

/** Eine Regel für das Fachprotokoll. */
const regelProtokoll = (
    relation: string,
    id: string | null,
    schluessel: string | null,
    bedingungen: readonly WikisyncRegelBedingung[],
): Record<string, unknown> => ({
    relation,
    ruleId: id,
    ruleKey: schluessel,
    bedingungen: bedingungen.map((b) => ({
        verknuepfung: b.verknuepfung,
        flaeche: b.flaeche === null ? null : (b.flaeche.kennung ?? `wiki:${b.flaeche.titel ?? b.flaeche.name}`),
        arten: arten(b),
        klima: b.klima === null ? null : `${b.klima.von}-${b.klima.bis}`,
        // Nur mit Lage (`richtung:kennung/kennung`): ohne bleibt das Protokoll wie vor 0250.
        ...(b.lage === undefined
            ? {}
            : { lage: lageProtokoll({ richtung: b.lage.richtung, orte: b.lage.orte.map((ort) => ort.kennung) }) }),
    })),
});

/**
 * Übernimmt die ausgewählten Vorschläge des Laufs `lauf`. In der Transaktion von `inhalteOperation`; der Aufrufer prüft Recht, Passkey und dass der Bereich dem WikiSync gehört.
 */
export async function uebernimmRegeln(
    tx: Tx,
    eingabe: { lauf: number; vorschlaege: readonly number[]; operationId: string; actor: Akteur },
): Promise<RegelArbeit> {
    await pruefeLauf(tx, eingabe.lauf);
    const vorschlaege = await tx<VorschlagZeile[]>`
        SELECT v.id::int AS id, v.lore_entry_id::text AS lore_entry_id, v.eintrag_name, v.waehlbar, v.payload
          FROM wikisync_regel_vorschlag v
         WHERE v.lauf_id = ${eingabe.lauf} AND v.id = ANY(${[...eingabe.vorschlaege]}::bigint[])
         ORDER BY v.position
    `;
    if (vorschlaege.length !== eingabe.vorschlaege.length) {
        throw new ApiError(404, "not_found", "Ein gewählter Vorschlag gehört nicht zu diesem Lauf.");
    }
    const eintragIds = [...new Set(vorschlaege.map((v) => v.lore_entry_id))].sort((a, b) => Number(a) - Number(b));
    // Die Sperre des Eintrags wie im Editor (FOR UPDATE): Während die Regeln wechseln, schreibt niemand sonst an diesem Eintrag.
    const eintraege = await tx<
        { id: string; public_id: string; revision: number; source_system: string; state: string; is_active: boolean }[]
    >`
        SELECT id::text AS id, public_id::text AS public_id, revision::int AS revision, source_system, state, is_active
          FROM lore_entry WHERE id = ANY(${eintragIds}::bigint[]) ORDER BY id FOR UPDATE
    `;
    const eintragNach = new Map(eintraege.map((e) => [e.id, e]));
    const regeln = await tx<RegelZeile[]>`
        SELECT id::text AS id, lore_entry_id::text AS lore_entry_id, relation, rule_key, legacy_origin, state, source_system, retired_origin
          FROM lore_rule WHERE lore_entry_id = ANY(${eintragIds}::bigint[]) ORDER BY lore_entry_id, sort_order, id
    `;
    const kennungen = new Set<string>();
    for (const v of vorschlaege)
        for (const regel of v.payload.regeln)
            for (const b of regel.bedingungen) if (b.flaeche?.kennung != null) kennungen.add(b.flaeche.kennung);
    const flaechenNachKennung = new Map(
        (kennungen.size === 0
            ? []
            : await tx<{ id: string; kennung: string; is_active: boolean }[]>`
                      SELECT id::text AS id, public_id::text AS kennung, is_active FROM region WHERE public_id = ANY(${[...kennungen]}::uuid[])
                  `
        ).map((r) => [r.kennung, r]),
    );
    // Die Orte der Linien (Lage zu einer Linie): Kennung → Nummer, Zustand und Größe; eine Kennung, die es nicht mehr gibt, fehlt in der Tafel.
    const ortKennungen = new Set<string>();
    for (const v of vorschlaege)
        for (const regel of v.payload.regeln)
            for (const b of regel.bedingungen)
                for (const ort of b.lage?.orte ?? [])
                    if (UUID.test(ort.kennung)) ortKennungen.add(ort.kennung.toLowerCase());
    const orteNachKennung = new Map(
        (ortKennungen.size === 0
            ? []
            : await tx<{ id: string; kennung: string; is_active: boolean; subtype: string }[]>`
                      SELECT id::text AS id, public_id::text AS kennung, is_active, subtype FROM place WHERE public_id = ANY(${[...ortKennungen]}::uuid[])
                  `
        ).map((o) => [o.kennung, o]),
    );
    // Welche Wiki-Titel inzwischen eine Fläche tragen (eine offene Bedingung ist dann veraltet).
    const titelMitFlaeche = new Set<string>();
    for (const zeile of await tx<
        { wiki_url: string }[]
    >`SELECT wiki_url FROM region WHERE is_active AND wiki_url IS NOT NULL AND region_layer <> 'klima'`) {
        const titel = titelAusWikiAdresse(zeile.wiki_url);
        if (titel !== null) titelMitFlaeche.add(titel.replaceAll("_", " ").trim().toLowerCase());
    }

    const [uebernahme] = await tx<{ id: number }[]>`
        INSERT INTO wikisync_regel_uebernahme (lauf_id, operation_id, actor_person_id, actor_label)
        VALUES (${eingabe.lauf}, ${eingabe.operationId}::uuid, ${eingabe.actor.personId}::uuid, ${eingabe.actor.label})
        RETURNING id::int AS id
    `;
    const uebernahmeId = (uebernahme as { id: number }).id;

    const warnungen: { code: string; message: string }[] = [];
    const entries: MapAuditEntry[] = [];
    const betroffen: string[] = [];
    let angelegt = 0;
    let stillgelegt = 0;

    for (const vorschlag of vorschlaege) {
        const eintrag = eintragNach.get(vorschlag.lore_entry_id);
        const name = vorschlag.eintrag_name;
        if (eintrag === undefined || !eintrag.is_active || eintrag.state !== "active") {
            warnungen.push(warnung("eintrag_weg", `${name}: Der Eintrag ist nicht mehr aktiv`));
            continue;
        }
        if (eintrag.source_system === "editor") {
            warnungen.push(warnung("redaktion", `${name}: Der Eintrag gehört inzwischen der Redaktion`));
            continue;
        }
        if (!vorschlag.waehlbar) {
            warnungen.push(warnung("nicht_waehlbar", `${name}: Dieser Vorschlag ist nicht wählbar`));
            continue;
        }
        const vorher: Record<string, unknown>[] = [];
        const nachher: Record<string, unknown>[] = [];
        for (const regel of vorschlag.payload.regeln) {
            if (regel.status !== "neu" && regel.status !== "geaendert" && regel.status !== "entfaellt") continue;
            const aktive = regeln.filter(
                (r) =>
                    r.lore_entry_id === vorschlag.lore_entry_id &&
                    r.relation === regel.beziehung &&
                    r.state === "active",
            );
            // Eine Regel der Redaktion (oder mit unbekannter Herkunft) bleibt, wie sie ist.
            if (aktive.some((r) => r.legacy_origin !== "wiki_verbreitung")) {
                warnungen.push(
                    warnung("manuell", `${name} (${regel.beziehung}): Eine Regel der Redaktion bleibt, wie sie ist`),
                );
                continue;
            }
            const wiki = aktive.filter((r) => r.legacy_origin === "wiki_verbreitung");
            // Hat die Redaktion hier eine Regel ersetzt oder entfernt und steht keine Wiki-Regel mehr, hat sie die Beziehung selbst gestaltet: Die Übernahme legt nichts daneben und belebt nichts.
            if (
                wiki.length === 0 &&
                regeln.some(
                    (r) =>
                        r.lore_entry_id === vorschlag.lore_entry_id &&
                        r.relation === regel.beziehung &&
                        r.retired_origin === "editor",
                )
            ) {
                warnungen.push(
                    warnung(
                        "manuell",
                        `${name} (${regel.beziehung}): Die Redaktion hat diese Beziehung selbst gestaltet; sie bleibt, wie sie ist`,
                    ),
                );
                continue;
            }
            const gesehen = [...(regel.bisherSchluessel ?? [])].sort();
            const heute = wiki.map((r) => r.rule_key).sort();
            if (gesehen.length !== heute.length || gesehen.some((k, i) => k !== heute[i])) {
                warnungen.push(
                    warnung(
                        "seit_vorschau_geaendert",
                        `${name} (${regel.beziehung}): Die Regeln des Eintrags haben sich seit der Ableitung geändert`,
                    ),
                );
                continue;
            }
            let schluessel: string | null = null;
            let flaechen: (string | null)[] = [];
            let lagen: ({ richtung: string; ortIds: string[] } | null)[] = [];
            if (regel.status !== "entfaellt") {
                if (regel.bedingungen.length === 0 || regel.schluessel == null) continue;
                schluessel = regel.schluessel;
                let veraltet: string | null = null;
                flaechen = regel.bedingungen.map((b) => {
                    if (b.flaeche === null) {
                        if (b.arten.length === 0 && b.klima === null && b.lage === undefined)
                            veraltet = "Eine Bedingung ohne Fläche, Art, Klima und Lage träfe alles";
                        return null;
                    }
                    if (b.flaeche.offen) {
                        if (b.flaeche.titel !== null && titelMitFlaeche.has(b.flaeche.titel.toLowerCase()))
                            veraltet = `Die Fläche „${b.flaeche.name}“ ist inzwischen zugewiesen`;
                        return null;
                    }
                    const fl = b.flaeche.kennung === null ? undefined : flaechenNachKennung.get(b.flaeche.kennung);
                    if (fl === undefined || !fl.is_active)
                        veraltet = `Die Fläche „${b.flaeche.name}“ gibt es nicht mehr`;
                    return fl?.id ?? null;
                });
                // Die Orte der Linien: jeder muss es noch geben, aktiv und eine Siedlung sein, und die Linie nennt keinen zweimal (die Prüfung der Tafel verwürfe sonst die ganze Übernahme).
                lagen = [];
                for (const b of regel.bedingungen) {
                    if (b.lage === undefined) {
                        lagen.push(null);
                        continue;
                    }
                    const ortIds: string[] = [];
                    const gesehen = new Set<string>();
                    for (const ort of b.lage.orte) {
                        const kennung = ort.kennung.toLowerCase();
                        const da = orteNachKennung.get(kennung);
                        if (
                            da === undefined ||
                            !da.is_active ||
                            !(WIKISYNC_LAGE_ORTSARTEN as readonly string[]).includes(da.subtype)
                        ) {
                            veraltet = `Der Ort „${ort.name}“ ist keine Siedlung der Karte mehr`;
                            continue;
                        }
                        if (gesehen.has(kennung)) {
                            veraltet = `Die Linie nennt den Ort „${ort.name}“ zweimal`;
                            continue;
                        }
                        gesehen.add(kennung);
                        ortIds.push(da.id);
                    }
                    lagen.push({ richtung: b.lage.richtung, ortIds });
                }
                if (veraltet !== null) {
                    warnungen.push(warnung("seit_vorschau_geaendert", `${name} (${regel.beziehung}): ${veraltet}`));
                    continue;
                }
            }
            // Anlegen, dann still legen: eine Regel ändert sich nie in ihrer Kette.
            let neueId: string | null = null;
            if (schluessel !== null) {
                const [neu] = await tx<{ id: string }[]>`
                    INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, state, source_system, is_active)
                    VALUES (${vorschlag.lore_entry_id}::bigint, ${schluessel}, ${regel.beziehung},
                            (SELECT COALESCE(max(sort_order), -1) + 1 FROM lore_rule WHERE lore_entry_id = ${vorschlag.lore_entry_id}::bigint),
                            'wiki_verbreitung', 'active', 'wikisync', TRUE)
                    ON CONFLICT (lore_entry_id, rule_key) DO NOTHING
                    RETURNING id::text AS id
                `;
                if (neu === undefined) {
                    // Dieselbe Kette gab es schon: eine Regel, die die Übernahme selbst still legte, lebt wieder auf; alles andere bleibt, wie es ist.
                    const [da] = await tx<
                        { id: string; state: string; source_system: string; retired_origin: string | null }[]
                    >`
                        SELECT id::text AS id, state, source_system, retired_origin FROM lore_rule WHERE lore_entry_id = ${vorschlag.lore_entry_id}::bigint AND rule_key = ${schluessel}
                    `;
                    if (
                        da !== undefined &&
                        da.state !== "active" &&
                        da.source_system === "wikisync" &&
                        da.retired_origin === "wikisync"
                    ) {
                        await tx`
                            UPDATE lore_rule SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now() WHERE id = ${da.id}::bigint
                        `;
                        neueId = da.id;
                    } else {
                        warnungen.push(
                            warnung("regel_besteht", `${name} (${regel.beziehung}): Diese Regel gibt es schon`),
                        );
                        continue;
                    }
                } else {
                    neueId = neu.id;
                    for (const [seq, b] of regel.bedingungen.entries()) {
                        const flaecheId = flaechen[seq] ?? null;
                        const lage = lagen[seq] ?? null;
                        const [term] = await tx<{ id: string }[]>`
                            INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id, wiki_area_title, climate_from, climate_to,
                                                        line_direction, line_place_a_id, line_place_b_id)
                            VALUES (${neueId}::bigint, ${seq}, ${seq === 0 ? "und" : b.verknuepfung}, ${flaecheId}::bigint,
                                    ${b.flaeche !== null && b.flaeche.offen ? (b.flaeche.titel ?? b.flaeche.name) : null},
                                    ${b.klima?.von ?? null}, ${b.klima?.bis ?? null},
                                    ${lage?.richtung ?? null}, ${lage?.ortIds[0] ?? null}::bigint, ${lage?.ortIds[1] ?? null}::bigint)
                            RETURNING id::text AS id
                        `;
                        for (const art of b.arten) {
                            await tx`
                                INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type)
                                VALUES (${(term as { id: string }).id}::bigint, ${art.ebene}, ${art.art})
                                ON CONFLICT DO NOTHING
                            `;
                        }
                    }
                }
                angelegt += 1;
            }
            const stillIds = wiki.map((r) => r.id).filter((id) => id !== neueId);
            if (stillIds.length > 0) {
                await tx`
                    UPDATE lore_rule SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'wikisync', updated_at = now()
                     WHERE id = ANY(${stillIds}::bigint[]) AND state = 'active' AND legacy_origin = 'wiki_verbreitung'
                `;
                stillgelegt += stillIds.length;
                for (const id of stillIds) {
                    const alt = wiki.find((r) => r.id === id);
                    if (alt !== undefined)
                        vorher.push(regelProtokoll(regel.beziehung, id, alt.rule_key, regel.bisher ?? []));
                }
            }
            if (neueId !== null) nachher.push(regelProtokoll(regel.beziehung, neueId, schluessel, regel.bedingungen));
            await tx`
                INSERT INTO wikisync_regel_uebernahme_zeile (uebernahme_id, lore_entry_id, relation, angelegt_rule_id, stillgelegt_rule_ids)
                VALUES (${uebernahmeId}, ${vorschlag.lore_entry_id}::bigint, ${regel.beziehung}, ${neueId}::bigint, ${stillIds}::bigint[])
            `;
        }
        if (vorher.length === 0 && nachher.length === 0) continue;
        const [neu] = await tx<{ revision: number }[]>`
            UPDATE lore_entry SET revision = revision WHERE id = ${vorschlag.lore_entry_id}::bigint RETURNING revision::int AS revision
        `;
        betroffen.push(eintrag.public_id);
        entries.push({
            action: "lore.rules_wikisync",
            loreId: eintrag.public_id,
            revisionBefore: eintrag.revision,
            revisionAfter: neu?.revision ?? eintrag.revision,
            changes: { rules: { before: vorher, after: nachher } },
        });
    }
    return {
        receipt: {
            affected: [
                { kind: "wikisync_regel_uebernahme", id: String(uebernahmeId) },
                ...betroffen.map((id) => ({ kind: "lore", id })),
            ],
            derivedWork: [],
            warnings: warnungen,
        },
        entries,
        summary: `Regeln übernommen: ${String(angelegt)} angelegt, ${String(stillgelegt)} still gelegt`,
    };
}

/** Nimmt eine Übernahme zurück: Die angelegten Regeln werden still gelegt, die still gelegten leben wieder auf, je Regel nur, wo sie noch so dasteht. */
export async function nimmRegelnZurueck(tx: Tx, eingabe: { uebernahme: number; actor: Akteur }): Promise<RegelArbeit> {
    const [kopf] = await tx<{ id: number; zurueckgenommen_am: Date | null }[]>`
        SELECT id::int AS id, zurueckgenommen_am FROM wikisync_regel_uebernahme WHERE id = ${eingabe.uebernahme} FOR UPDATE
    `;
    if (kopf === undefined) throw new ApiError(404, "not_found", "Diese Übernahme gibt es nicht.");
    if (kopf.zurueckgenommen_am !== null)
        throw new ApiError(409, "schon_zurueckgenommen", "Diese Übernahme ist schon zurückgenommen.");
    const zeilen = await tx<
        { lore_entry_id: string; relation: string; angelegt_rule_id: string | null; stillgelegt_rule_ids: string[] }[]
    >`
        SELECT lore_entry_id::text AS lore_entry_id, relation, angelegt_rule_id::text AS angelegt_rule_id, stillgelegt_rule_ids::text[] AS stillgelegt_rule_ids
          FROM wikisync_regel_uebernahme_zeile WHERE uebernahme_id = ${eingabe.uebernahme} ORDER BY id
    `;
    const eintragIds = [...new Set(zeilen.map((z) => z.lore_entry_id))].sort((a, b) => Number(a) - Number(b));
    const eintraege = await tx<{ id: string; public_id: string; revision: number }[]>`
        SELECT id::text AS id, public_id::text AS public_id, revision::int AS revision FROM lore_entry WHERE id = ANY(${eintragIds}::bigint[]) ORDER BY id FOR UPDATE
    `;
    const warnungen: { code: string; message: string }[] = [];
    const entries: MapAuditEntry[] = [];
    let still = 0;
    let belebt = 0;
    for (const eintrag of eintraege) {
        const vorher: Record<string, unknown>[] = [];
        const nachher: Record<string, unknown>[] = [];
        for (const zeile of zeilen.filter((z) => z.lore_entry_id === eintrag.id)) {
            // Hat die Redaktion die angelegte Regel inzwischen übernommen, bleibt sie, und die alte lebt nicht daneben auf.
            let angelegtWeg = zeile.angelegt_rule_id === null;
            if (zeile.angelegt_rule_id !== null) {
                const weg = await tx<{ id: string }[]>`
                    UPDATE lore_rule SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'wikisync', updated_at = now()
                     WHERE id = ${zeile.angelegt_rule_id}::bigint AND state = 'active' AND source_system = 'wikisync' AND legacy_origin = 'wiki_verbreitung' RETURNING id::text AS id
                `;
                if (weg.length === 0)
                    warnungen.push(
                        warnung(
                            "seit_uebernahme_geaendert",
                            `Eine angelegte Regel (${zeile.relation}) wurde seit der Übernahme geändert`,
                        ),
                    );
                else {
                    angelegtWeg = true;
                    still += 1;
                    vorher.push({ relation: zeile.relation, ruleId: zeile.angelegt_rule_id, state: "active" });
                    nachher.push({ relation: zeile.relation, ruleId: zeile.angelegt_rule_id, state: "retired" });
                }
            }
            for (const id of zeile.stillgelegt_rule_ids) {
                if (!angelegtWeg) {
                    warnungen.push(
                        warnung(
                            "seit_uebernahme_geaendert",
                            `Eine still gelegte Regel (${zeile.relation}) bleibt still: Die angelegte Regel steht noch`,
                        ),
                    );
                    continue;
                }
                const da = await tx<{ id: string }[]>`
                    UPDATE lore_rule SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
                     WHERE id = ${id}::bigint AND state = 'retired' AND retired_origin = 'wikisync' AND legacy_origin = 'wiki_verbreitung' RETURNING id::text AS id
                `;
                if (da.length === 0)
                    warnungen.push(
                        warnung(
                            "seit_uebernahme_geaendert",
                            `Eine still gelegte Regel (${zeile.relation}) wurde seit der Übernahme geändert`,
                        ),
                    );
                else {
                    belebt += 1;
                    vorher.push({ relation: zeile.relation, ruleId: id, state: "retired" });
                    nachher.push({ relation: zeile.relation, ruleId: id, state: "active" });
                }
            }
        }
        if (vorher.length === 0) continue;
        const [neu] = await tx<
            { revision: number }[]
        >`UPDATE lore_entry SET revision = revision WHERE id = ${eintrag.id}::bigint RETURNING revision::int AS revision`;
        entries.push({
            action: "lore.rules_wikisync_undo",
            loreId: eintrag.public_id,
            revisionBefore: eintrag.revision,
            revisionAfter: neu?.revision ?? eintrag.revision,
            changes: { rules: { before: vorher, after: nachher } },
        });
    }
    await tx`
        UPDATE wikisync_regel_uebernahme
           SET zurueckgenommen_am = now(), zurueckgenommen_von = ${eingabe.actor.personId}::uuid, zurueckgenommen_label = ${eingabe.actor.label}
         WHERE id = ${eingabe.uebernahme}
    `;
    return {
        receipt: {
            affected: [
                { kind: "wikisync_regel_uebernahme", id: String(eingabe.uebernahme) },
                ...eintraege
                    .filter((e) => entries.some((x) => x.loreId === e.public_id))
                    .map((e) => ({ kind: "lore", id: e.public_id })),
            ],
            derivedWork: [],
            warnings: warnungen,
        },
        entries,
        summary: `Übernahme von Regeln zurückgenommen: ${String(still)} still gelegt, ${String(belebt)} belebt`,
    };
}

interface WiederZeile {
    id: string;
    state: string;
    retired_origin: string | null;
    source_system: string;
    legacy_origin: string;
}

/**
 * Nimmt die Rücknahme einer Übernahme zurück (WI-0265 B8e; Operation `lore.rules_wikisync_redo`): Die Übernahme gilt wieder. Die Regeln, die sie anlegte, leben wieder auf, die, die sie still legte, werden
 * wieder still gelegt, je Zeile nur, wo sie noch so dastehen, wie die Rücknahme sie hinterließ (die Rücknahme legte die angelegte still, `retired_origin = 'wikisync'`, und belebte die alten).
 *
 * - **Eine Zeile ganz oder gar nicht, wo eine angelegte Regel zurückkäme:** Stünde eine der alten Regeln nicht mehr so da (die Redaktion hat sie bearbeitet) oder hätte jemand die angelegte inzwischen
 *   übernommen, bliebe die Zeile, wie sie ist (Warnung `seit_uebernahme_geaendert`): Sonst stünden alte und neue Regel nebeneinander. Eine Zeile ohne angelegte Regel (das Wiki lässt die Beziehung entfallen)
 *   legt jede alte Regel einzeln still.
 * - **Geschrieben wird nur, was sich ändert.** Ändert sich nichts, ist es 409 `nichts_wiederherzustellen` und nichts wird geschrieben; die Übernahme gälte sonst, obwohl ihre Regeln nicht mehr da sind.
 * - Das Fachprotokoll wie bei der Übernahme und der Rücknahme (`lore`, Feld `rules`, Vorher → Nachher); die Revision des Eintrags zählt hoch.
 */
export async function stelleRegelnWiederHer(
    tx: Tx,
    eingabe: { uebernahme: number; actor: Akteur },
): Promise<RegelArbeit> {
    const [kopf] = await tx<{ id: number; zurueckgenommen_am: Date | null }[]>`
        SELECT id::int AS id, zurueckgenommen_am FROM wikisync_regel_uebernahme WHERE id = ${eingabe.uebernahme} FOR UPDATE
    `;
    if (kopf === undefined) throw new ApiError(404, "not_found", "Diese Übernahme gibt es nicht.");
    if (kopf.zurueckgenommen_am === null)
        throw new ApiError(
            409,
            "nicht_zurueckgenommen",
            "Diese Übernahme gilt schon; es gibt nichts wiederherzustellen.",
        );
    const zeilen = await tx<
        { lore_entry_id: string; relation: string; angelegt_rule_id: string | null; stillgelegt_rule_ids: string[] }[]
    >`
        SELECT lore_entry_id::text AS lore_entry_id, relation, angelegt_rule_id::text AS angelegt_rule_id, stillgelegt_rule_ids::text[] AS stillgelegt_rule_ids
          FROM wikisync_regel_uebernahme_zeile WHERE uebernahme_id = ${eingabe.uebernahme} ORDER BY id
    `;
    const eintragIds = [...new Set(zeilen.map((z) => z.lore_entry_id))].sort((a, b) => Number(a) - Number(b));
    const eintraege = await tx<{ id: string; public_id: string; revision: number }[]>`
        SELECT id::text AS id, public_id::text AS public_id, revision::int AS revision FROM lore_entry WHERE id = ANY(${eintragIds}::bigint[]) ORDER BY id FOR UPDATE
    `;
    const warnungen: { code: string; message: string }[] = [];
    const entries: MapAuditEntry[] = [];
    let still = 0;
    let belebt = 0;
    const retire = (ids: string[]): Promise<{ id: string }[]> =>
        tx<{ id: string }[]>`
            UPDATE lore_rule SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'wikisync', updated_at = now()
             WHERE id = ANY(${ids}::bigint[]) AND state = 'active' AND legacy_origin = 'wiki_verbreitung' RETURNING id::text AS id
        `;
    for (const eintrag of eintraege) {
        const vorher: Record<string, unknown>[] = [];
        const nachher: Record<string, unknown>[] = [];
        for (const zeile of zeilen.filter((z) => z.lore_entry_id === eintrag.id)) {
            if (zeile.angelegt_rule_id !== null) {
                const regeln = await tx<WiederZeile[]>`
                    SELECT id::text AS id, state, retired_origin, source_system, legacy_origin FROM lore_rule
                     WHERE id = ANY(${[zeile.angelegt_rule_id, ...zeile.stillgelegt_rule_ids]}::bigint[]) ORDER BY id FOR UPDATE
                `;
                const angelegt = regeln.find((r) => r.id === zeile.angelegt_rule_id);
                const alte = zeile.stillgelegt_rule_ids.map((id) => regeln.find((r) => r.id === id));
                const steht =
                    angelegt?.state === "retired" &&
                    angelegt.retired_origin === "wikisync" &&
                    angelegt.source_system === "wikisync" &&
                    angelegt.legacy_origin === "wiki_verbreitung" &&
                    alte.every((r) => r?.state === "active" && r.legacy_origin === "wiki_verbreitung");
                if (!steht) {
                    warnungen.push(
                        warnung(
                            "seit_uebernahme_geaendert",
                            `Die Regeln (${zeile.relation}) wurden seit der Rücknahme geändert; sie bleiben, wie sie sind`,
                        ),
                    );
                    continue;
                }
                const weg = await retire(zeile.stillgelegt_rule_ids);
                for (const alt of weg) {
                    still += 1;
                    vorher.push({ relation: zeile.relation, ruleId: alt.id, state: "active" });
                    nachher.push({ relation: zeile.relation, ruleId: alt.id, state: "retired" });
                }
                await tx`
                    UPDATE lore_rule SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
                     WHERE id = ${zeile.angelegt_rule_id}::bigint
                `;
                belebt += 1;
                vorher.push({ relation: zeile.relation, ruleId: zeile.angelegt_rule_id, state: "retired" });
                nachher.push({ relation: zeile.relation, ruleId: zeile.angelegt_rule_id, state: "active" });
                continue;
            }
            // Das Wiki lässt die Beziehung entfallen: Jede alte Regel, die noch dasteht, wird wieder still gelegt.
            for (const id of zeile.stillgelegt_rule_ids) {
                const weg = await retire([id]);
                if (weg.length === 0) {
                    warnungen.push(
                        warnung(
                            "seit_uebernahme_geaendert",
                            `Eine Regel (${zeile.relation}) wurde seit der Rücknahme geändert; sie bleibt, wie sie ist`,
                        ),
                    );
                    continue;
                }
                still += 1;
                vorher.push({ relation: zeile.relation, ruleId: id, state: "active" });
                nachher.push({ relation: zeile.relation, ruleId: id, state: "retired" });
            }
        }
        if (vorher.length === 0) continue;
        const [neu] = await tx<
            { revision: number }[]
        >`UPDATE lore_entry SET revision = revision WHERE id = ${eintrag.id}::bigint RETURNING revision::int AS revision`;
        entries.push({
            action: "lore.rules_wikisync_redo",
            loreId: eintrag.public_id,
            revisionBefore: eintrag.revision,
            revisionAfter: neu?.revision ?? eintrag.revision,
            changes: { rules: { before: vorher, after: nachher } },
        });
    }
    if (entries.length === 0)
        throw new ApiError(
            409,
            "nichts_wiederherzustellen",
            "Keine der Regeln dieser Übernahme steht noch so da, wie die Rücknahme sie hinterließ.",
            { warnungen: warnungen.length },
        );
    await tx`
        UPDATE wikisync_regel_uebernahme
           SET zurueckgenommen_am = NULL, zurueckgenommen_von = NULL, zurueckgenommen_label = NULL
         WHERE id = ${eingabe.uebernahme}
    `;
    return {
        receipt: {
            affected: [
                { kind: "wikisync_regel_uebernahme", id: String(eingabe.uebernahme) },
                ...eintraege
                    .filter((e) => entries.some((x) => x.loreId === e.public_id))
                    .map((e) => ({ kind: "lore", id: e.public_id })),
            ],
            derivedWork: [],
            warnings: warnungen,
        },
        entries,
        summary: `Rücknahme der Übernahme von Regeln zurückgenommen: ${String(belebt)} belebt, ${String(still)} still gelegt`,
    };
}
