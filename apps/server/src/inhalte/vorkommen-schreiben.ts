import {
    INHALTE_KONTINENTE,
    SOURCE_REFERENCE_KINDS,
    type InhalteVorkommenAendernBody,
    type InhalteVorkommenAnlegenBody,
    type InhalteVorkommenOrtAenderung,
    type InhalteVorkommenQuelleAenderung,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { mapEditConflict } from "../editor/place-edit.ts";
import type { MapActor, MapChange } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { hitCells, isContinentKey, resolveLorePlace } from "../migration/lore-keys.ts";
import { readLoreResolution } from "../migration/lore-import.ts";
import { inhalteOperation } from "./operation.ts";
import { TRAEGER } from "./traeger.ts";
import { KONTINENT_NAMEN, wikiSchluesselVon } from "./vorkommen-lesen.ts";
import { fehlerbild, wendeRegelnAn } from "./vorkommen-regeln-schreiben.ts";

/**
 * Schreiben für den Reiter „Vorkommen“ (WI-0254, Runde 3): `lore.update` und `lore.create`, je EINE Operation mit Protokoll (`map_operation`,
 * `map_audit_event`, Ziel `lore_public_id`, Migration 0234). `lore.create` legt einen Eintrag OHNE Wiki-Artikel an (Vali wählte B am Betreiber-Gate
 * WI-0254 §10, Migration 0235): kein Wiki-Schlüssel (es wird nie einer erfunden), die Identität ist `public_id`, `source_system = 'editor'` schützt ihn
 * vor dem Legacy-Zug von Anfang an.
 *
 * - 🔴 **Eine Operation, ein Stand:** `lore.update` sperrt den Eintrag (`FOR UPDATE`) und prüft `baseRevision`; ein veralteter Stand ist 409
 *   `edit_conflict` mit wer und wann. Stammdaten, Ortszeilen und Quellen gehen zusammen durch oder gar nicht; jede Änderung zählt die Revision des
 *   Eintrags genau einmal hoch.
 * - 🔴 **Bestandsschutz** (Kapitel 9.37, manuell schlägt Wiki): Was der Editor ändert, macht den Eintrag zu einem der Redaktion
 *   (`source_system = 'editor'`); der Legacy-Zug fasst ihn samt Ortszeilen, Regeln, Quellen und Herkunftsvermerken nicht mehr an und legt ihn nicht still
 *   (`migration/lore-import.ts`). Die abgeleiteten Treffer der Zeilen rechnet der Zug trotzdem bei jedem Lauf neu.
 * - 🔴 **Das Ziel einer Ortszeile ist ein Wiki-Artikel ODER ein Name:** Gewählt wird ein Kartenobjekt, dem die Zuordnung einen Wiki-Schlüssel gibt (nie
 *   geraten), oder ein Kontinentbegriff; die Treffer (`lore_place_target`) rechnet derselbe Lookup wie der Import (`resolveLorePlace`). Ein ungeklärter Name
 *   („ungeklärt übernehmen“) steht ohne Schlüssel und ohne Treffer da (`place_wiki_key NULL`, `unresolved`); er wird nie gegen Kartenobjekte verglichen.
 * - **Entfernen legt still, es löscht nie:** eine Zeile oder Verknüpfung aus Legacy wird unterdrückt (`suppressed`, der Zug belebt sie nie), eine
 *   eigene gelöst (`retired`), beide mit `retired_origin = editor`.
 * - **Regeln** (Regeleditor, WI-0254 `--weiter`, `vorkommen-regeln-schreiben.ts`): anlegen, ersetzen und still legen laufen in derselben Operation. 🔴 Eine Regeländerung macht den Eintrag NICHT zu einem der
 *   Redaktion (`lore_entry.source_system` bleibt; Entscheidung Claudia zu WI-0253 §26): Nur die Regel gehört der Redaktion (`lore_rule.source_system = editor`), und ihr Schutz vor dem Legacy-Zug und
 *   dem WikiSync sitzt an der Regel (`ruleSpec.protectedWhere`, `wiki/regeln/uebernehmen.ts`). Stammdaten, Ortszeilen und Quellen machen ihn weiter zu einem der Redaktion.
 */

export type Zeile = Record<string, string | number | boolean | null>;
export const nurText = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};

interface EintragSperre {
    id: string;
    wiki_key: string | null;
    revision: number;
    updated_at: Date;
    name: string;
    kind: string;
    gruppe: string | null;
    lebensraum: string | null;
    synonyme: string | null;
    editor_note: string | null;
    is_active: boolean;
    state: string;
}

/** Das Feld des Vertrags (`lore_entry_field_origin.field`) zu einem Feld der Schnittstelle. */
export const FELD_HERKUNFT: Readonly<Record<string, string>> = {
    name: "name",
    art: "kind",
    gruppe: "gruppe",
    lebensraum: "lebensraum",
    synonyme: "synonyme",
};

/** Ein Eintrag im Protokoll: wer, in welchem Zustand. Bei einem ungeklärten Namen steht `wikiKey: null` und der Name in `name`. */
export interface OrtProtokoll {
    rowId: string;
    wikiKey: string | null;
    name: string | null;
    relation: string;
    state: string;
}
export interface QuelleProtokoll {
    sourceId: string;
    state: string;
    referenceKind: string | null;
    pages: string | null;
    note: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Anlegen (ohne Wiki-Artikel)
// ---------------------------------------------------------------------------------------------------------------------

export async function legeVorkommenAn(
    database: Database,
    actor: MapActor,
    body: InhalteVorkommenAnlegenBody,
): Promise<OperationReceipt & { publicId: string }> {
    const name = body.name.trim();
    if (name === "") throw fehlerbild("name", "required", "Ein Eintrag braucht einen Namen.");
    const gruppe = nurText(body.gruppe);
    const lebensraum = nurText(body.lebensraum);
    const synonyme = nurText(body.synonyme);
    const notiz = nurText(body.editorNote);
    let publicId = "";
    const quittung = await inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "lore.create", body },
        async (tx) => {
            const neu = await legeEintragAn(tx, { name, art: body.art, gruppe, lebensraum, synonyme, notiz });
            publicId = neu.publicId;
            return {
                receipt: {
                    affected: [{ kind: "lore", id: publicId, revision: neu.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `Vorkommen „${name}“ angelegt`,
                entries: [
                    {
                        action: "lore.created",
                        loreId: publicId,
                        revisionAfter: neu.revision,
                        changes: neu.aenderungen,
                    },
                ],
            };
        },
    );
    const kennung = publicId !== "" ? publicId : (quittung.affected.find((eines) => eines.kind === "lore")?.id ?? "");
    return { ...quittung, publicId: kennung };
}

/**
 * Der Kern von `lore.create`, in der Transaktion des Aufrufers: ein Eintrag OHNE Wiki-Artikel, `source_system = 'editor'`, die Herkunft je Feld `manual`. Ihn nutzt auch „Regeln als Text“ (`lore.rules_text`,
 * `regeln-text/schreiben.ts`) für `Name (Kategorie, neu)`. Gibt die interne Nummer, die Kennung, die Revision (1) und die Änderungen für das Fachprotokoll zurück; Name und Art sind geprüft, die übrigen Felder `null` oder getrimmt.
 */
export async function legeEintragAn(
    tx: Sql,
    eingabe: {
        name: string;
        art: string;
        gruppe?: string | null;
        lebensraum?: string | null;
        synonyme?: string | null;
        notiz?: string | null;
    },
): Promise<{ id: string; publicId: string; revision: number; aenderungen: Record<string, MapChange> }> {
    const { name, art } = eingabe;
    const gruppe = eingabe.gruppe ?? null;
    const lebensraum = eingabe.lebensraum ?? null;
    const synonyme = eingabe.synonyme ?? null;
    const notiz = eingabe.notiz ?? null;
    // Ein gleichlautender Name ist kein Beweis für denselben Eintrag (WI-0254): nichts wird zusammengelegt oder abgelehnt. Kein Wiki-Schlüssel:
    // die Identität ist `public_id`, `source_system = 'editor'` schützt den Eintrag vor dem Legacy-Zug.
    const [neu] = await tx<{ id: string; public_id: string; revision: number }[]>`
        INSERT INTO lore_entry (wiki_key, kind, name, gruppe, lebensraum, synonyme, editor_note, legacy_origin, state, source_system, is_active)
        VALUES (NULL, ${art}, ${name}, ${gruppe}, ${lebensraum}, ${synonyme}, ${notiz}, 'manual', 'active', 'editor', TRUE)
        RETURNING id::text, public_id::text, revision::int
    `;
    const mitVermerk = ["name", "kind"];
    const aenderungen: Record<string, MapChange> = {
        name: { after: name },
        art: { after: art },
    };
    if (gruppe !== null) {
        mitVermerk.push("gruppe");
        aenderungen["gruppe"] = { after: gruppe };
    }
    if (lebensraum !== null) {
        mitVermerk.push("lebensraum");
        aenderungen["lebensraum"] = { after: lebensraum };
    }
    if (synonyme !== null) {
        mitVermerk.push("synonyme");
        aenderungen["synonyme"] = { after: synonyme };
    }
    if (notiz !== null) aenderungen["editorNote"] = { after: notiz };
    for (const feld of mitVermerk) {
        await tx`
            INSERT INTO lore_entry_field_origin (lore_entry_id, field, origin)
            VALUES (${neu!.id}::bigint, ${feld}, 'manual')
            ON CONFLICT (lore_entry_id, field) DO UPDATE SET origin = 'manual'
        `;
    }
    return { id: neu!.id, publicId: neu!.public_id, revision: neu!.revision, aenderungen };
}

export async function aendereVorkommen(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: InhalteVorkommenAendernBody,
): Promise<OperationReceipt> {
    const felder = body.fields ?? {};
    if (
        Object.keys(felder).length === 0 &&
        (body.orte ?? []).length === 0 &&
        (body.quellen ?? []).length === 0 &&
        (body.regeln ?? []).length === 0
    ) {
        throw fehlerbild("fields", "required", "Es ist nichts zu ändern.");
    }
    return inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "lore.update", body: { loreId: publicId, ...body } },
        async (tx) => {
            const [eintrag] = await tx<EintragSperre[]>`
                SELECT id::text AS id, wiki_key, revision::int AS revision, updated_at, name, kind, gruppe, lebensraum, synonyme, editor_note, is_active, state
                  FROM lore_entry WHERE public_id = ${publicId}::uuid FOR UPDATE
            `;
            if (eintrag === undefined) throw new ApiError(404, "not_found", "Diesen Eintrag gibt es nicht.");
            if (eintrag.revision !== body.baseRevision) {
                throw await mapEditConflict(
                    tx,
                    { kind: "lore", publicId },
                    { revision: eintrag.revision, changedAt: eintrag.updated_at },
                );
            }
            // Ein unterdrückter Eintrag lässt sich nur zurückholen; was sonst in der Anfrage steht, wird abgelehnt.
            const wirdAktiv = felder.aktiv ?? eintrag.is_active;
            const ausserAktiv = Object.keys(felder).some((feld) => feld !== "aktiv");
            if (
                !wirdAktiv &&
                (ausserAktiv ||
                    (body.orte ?? []).length > 0 ||
                    (body.quellen ?? []).length > 0 ||
                    (body.regeln ?? []).length > 0)
            ) {
                throw fehlerbild(
                    "fields",
                    "state",
                    "Ein unterdrückter Eintrag lässt sich nur zurückholen; erst dann lässt er sich ändern.",
                );
            }

            const aenderungen: Record<string, MapChange> = {};
            const setze: Zeile = {};
            const mitVermerk = wendeFelderAn(eintrag, felder, setze, aenderungen);

            const ortErgebnis = await wendeOrteAn(tx, database, eintrag.id, body.orte ?? []);
            if (ortErgebnis !== undefined)
                aenderungen["places"] = { before: ortErgebnis.vorher, after: ortErgebnis.nachher };
            const quellenErgebnis = await wendeQuellenAn(tx, eintrag.id, body.quellen ?? []);
            if (quellenErgebnis !== undefined) {
                aenderungen["sources"] = { before: quellenErgebnis.vorher, after: quellenErgebnis.nachher };
            }
            const regelErgebnis = await wendeRegelnAn(
                tx,
                { id: eintrag.id, publicId, wikiKey: eintrag.wiki_key },
                body.regeln ?? [],
            );
            if (regelErgebnis !== undefined) {
                aenderungen["rules"] = { before: regelErgebnis.vorher, after: regelErgebnis.nachher };
            }

            if (Object.keys(aenderungen).length === 0) {
                // Nichts hat sich geändert (etwa derselbe Name noch einmal): keine Revision, kein Protokoll.
                return {
                    receipt: {
                        affected: [{ kind: "lore", id: publicId, revision: eintrag.revision }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [],
                };
            }

            // Jede Änderung an Stammdaten, Ortszeilen oder Quellen macht den Eintrag zu einem der Redaktion (Importschutz auf Eintragsebene). 🔴 Eine reine Regeländerung nicht: Dann gehört nur die Regel
            // der Redaktion (WI-0254 `--weiter`, Entscheidung Claudia zu WI-0253 §26); sie schützt sich selbst (`lore_rule.source_system`).
            const redaktion = Object.keys(aenderungen).some((schluessel) => schluessel !== "rules");
            const revision = await schreibeEintragSpalten(tx, eintrag, setze, mitVermerk, redaktion);
            const nameJetzt = typeof aenderungen["name"]?.after === "string" ? aenderungen["name"].after : eintrag.name;
            return {
                receipt: { affected: [{ kind: "lore", id: publicId, revision }], derivedWork: [], warnings: [] },
                summary: `Vorkommen „${nameJetzt}“ geändert`,
                entries: [
                    {
                        action: "lore.updated",
                        loreId: publicId,
                        revisionBefore: eintrag.revision,
                        revisionAfter: revision,
                        changes: aenderungen,
                    },
                ],
            };
        },
    );
}

/**
 * Schreibt die gesammelten Spalten des Eintrags, den Herkunftsvermerk je Feld und zählt die Revision genau einmal hoch; gibt die neue Revision zurück. Der Kern, den `lore.update` und die Rücknahme
 * (`ruecknahme-vorkommen.ts`, WI-0265 B6g2) gemeinsam benutzen. `redaktion` macht den Eintrag zu einem der Redaktion (`source_system = 'editor'`, Importschutz); `eintrag` ist der gesperrte Stand.
 */
export async function schreibeEintragSpalten(
    tx: Sql,
    eintrag: { id: string; revision: number },
    setze: Zeile,
    mitVermerk: readonly string[],
    redaktion: boolean,
): Promise<number> {
    // Herkunft je Feld: was die Redaktion geändert hat, trägt den Vermerk „manuell“.
    for (const feld of mitVermerk) {
        await tx`
            INSERT INTO lore_entry_field_origin (lore_entry_id, field, origin)
            VALUES (${eintrag.id}::bigint, ${feld}, 'manual')
            ON CONFLICT (lore_entry_id, field) DO UPDATE SET origin = 'manual'
        `;
    }
    const spalten = Object.entries(setze);
    const zuweisungen = spalten.map(([spalte], index) => `${spalte} = $${String(index + 3)}`);
    if (redaktion) zuweisungen.push("source_system = 'editor'");
    const [neu] = await tx.unsafe<{ revision: number }[]>(
        `UPDATE lore_entry SET ${[...zuweisungen, "revision = $2::bigint"].join(", ")}
          WHERE id = $1::bigint RETURNING revision::int AS revision`,
        [eintrag.id, eintrag.revision + 1, ...spalten.map(([, wert]) => wert)] as never[],
    );
    return neu!.revision;
}

/** Die Felder des Eintrags gegen den Stand prüfen und die Spalten sammeln; gibt die Felder des Vertrags zurück, die einen Herkunftsvermerk bekommen. */
function wendeFelderAn(
    eintrag: EintragSperre,
    felder: NonNullable<InhalteVorkommenAendernBody["fields"]>,
    setze: Zeile,
    aenderungen: Record<string, MapChange>,
): string[] {
    const mitVermerk: string[] = [];
    const merke = (feld: string, spalte: string, vorher: unknown, nachher: string | number | boolean | null): void => {
        if (vorher === nachher) return;
        setze[spalte] = nachher;
        aenderungen[feld] = { before: vorher, after: nachher };
        const vermerk = FELD_HERKUNFT[feld];
        if (vermerk !== undefined) mitVermerk.push(vermerk);
    };
    if (felder.name !== undefined) {
        const name = felder.name.trim();
        if (name === "") throw fehlerbild("fields.name", "required", "Ein Eintrag braucht einen Namen.");
        merke("name", "name", eintrag.name, name);
    }
    if (felder.art !== undefined) merke("art", "kind", eintrag.kind, felder.art);
    if (felder.gruppe !== undefined) merke("gruppe", "gruppe", eintrag.gruppe, nurText(felder.gruppe));
    if (felder.lebensraum !== undefined)
        merke("lebensraum", "lebensraum", eintrag.lebensraum, nurText(felder.lebensraum));
    if (felder.synonyme !== undefined) merke("synonyme", "synonyme", eintrag.synonyme, nurText(felder.synonyme));
    if (felder.editorNote !== undefined)
        merke("editorNote", "editor_note", eintrag.editor_note, nurText(felder.editorNote));
    if (felder.aktiv !== undefined && felder.aktiv !== eintrag.is_active) {
        setze["is_active"] = felder.aktiv;
        // Die Spalten der Stilllegung folgen den Prüfungen `lore_entry_state_matches_activity` und `lore_entry_retired_consistent` (0074).
        setze["state"] = felder.aktiv ? "active" : "suppressed";
        setze["retired_at"] = felder.aktiv ? null : new Date().toISOString();
        setze["retired_origin"] = felder.aktiv ? null : "editor";
        aenderungen["active"] = { before: eintrag.is_active, after: felder.aktiv };
    }
    return mitVermerk;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ortszeilen
// ---------------------------------------------------------------------------------------------------------------------

export interface OrtZeile {
    id: string;
    place_wiki_key: string | null;
    place_title: string | null;
    relation: string;
    state: string;
    is_active: boolean;
    source_system: string;
}

export const protokollOrt = (zeile: OrtZeile, state = zeile.state): OrtProtokoll => ({
    rowId: zeile.id,
    wikiKey: zeile.place_wiki_key,
    name: zeile.place_wiki_key === null ? zeile.place_title : null,
    relation: zeile.relation,
    state,
});

/** Der Lookup der Auflösung (Zuordnung „Wiki-Schlüssel → Kartenobjekt“, Träger, Flächen), wie der Import ihn liest. */
export type LoreAufloesung = Awaited<ReturnType<typeof readLoreResolution>>;

/**
 * Die Treffer einer Ortszeile neu rechnen und schreiben (abgeleitet, wie bei jedem Lauf des Imports). Der Kern, den `lore.update` (hinzufügen, zurückholen) und die Rücknahme (`ruecknahme-vorkommen.ts`,
 * WI-0265 B6g2: eine Zeile wird wieder aktiv) gemeinsam benutzen; `lookups` liest den Lookup erst, wenn er gebraucht wird (er steht außerhalb der Transaktion).
 */
export async function schreibeTreffer(
    tx: Sql,
    zeilenId: string,
    schluessel: string,
    lookups: () => Promise<LoreAufloesung>,
): Promise<void> {
    // Nur die Rolle `ort` trifft (WI-0253 §23): Eine Zeile, der der WikiSync eine andere Rolle gab, behält ihren Link, aber nie ein Ziel.
    const [rolle] = await tx<{ role: string | null }[]>`SELECT role FROM lore_place WHERE id = ${zeilenId}::bigint`;
    if (rolle?.role != null && rolle.role !== "ort") {
        await tx`UPDATE lore_place SET key_class = 'other', target_state = 'unmatched', target_count = 0, updated_at = now() WHERE id = ${zeilenId}::bigint`;
        await tx`DELETE FROM lore_place_target WHERE lore_place_id = ${zeilenId}::bigint`;
        return;
    }
    const geladen = await lookups();
    const aufloesung = resolveLorePlace(schluessel, geladen.wikiKeys, geladen.carrierIds);
    await tx`
        UPDATE lore_place SET key_class = ${aufloesung.keyClass}, target_state = ${aufloesung.state}, target_count = ${aufloesung.hits.length},
                              updated_at = now()
         WHERE id = ${zeilenId}::bigint
    `;
    await tx`DELETE FROM lore_place_target WHERE lore_place_id = ${zeilenId}::bigint`;
    for (const treffer of aufloesung.hits) {
        const [ort, gebiet, landschaft, gipfel] = hitCells(treffer);
        await tx`
            INSERT INTO lore_place_target (lore_place_id, place_id, territory_id, region_id, terrain_peak_id)
            VALUES (${zeilenId}::bigint, ${ort ?? null}::bigint, ${gebiet ?? null}::bigint, ${landschaft ?? null}::bigint, ${gipfel ?? null}::bigint)
        `;
    }
}

/** Die Ortszeilen ändern: hinzufügen, entfernen, zurückholen. Gibt vorher und nachher der berührten Zeilen zurück, `undefined`, wo nichts geschah. */
async function wendeOrteAn(
    tx: Sql,
    database: Database,
    eintragId: string,
    aenderungen: readonly InhalteVorkommenOrtAenderung[],
): Promise<{ vorher: OrtProtokoll[]; nachher: OrtProtokoll[] } | undefined> {
    if (aenderungen.length === 0) return undefined;
    const vorher: OrtProtokoll[] = [];
    const nachher: OrtProtokoll[] = [];
    let lookups: LoreAufloesung | undefined;
    const lookupsHolen = async (): Promise<LoreAufloesung> => {
        // Derselbe Lookup wie im Import (Zuordnung „Wiki-Schlüssel → Kartenobjekt“); er liest nur und steht außerhalb der Transaktion, damit die
        // Sperre des Eintrags nicht länger hält als nötig.
        lookups ??= await readLoreResolution(database);
        return lookups;
    };
    const trefferSchreiben = (zeilenId: string, schluessel: string): Promise<void> =>
        schreibeTreffer(tx, zeilenId, schluessel, lookupsHolen);

    for (const [index, aenderung] of aenderungen.entries()) {
        const pfad = `orte.${String(index)}`;
        if (aenderung.op === "add" && "name" in aenderung) {
            // Ein ungeklärter Name: kein Schlüssel, keine Treffer; derselbe Name in derselben Beziehung steht nur einmal (Groß- und Kleinschreibung gleich).
            const name = aenderung.name.trim();
            if (name === "") throw fehlerbild(`${pfad}.name`, "required", "Ein Name darf nicht leer sein.");
            const [bisher] = await tx<OrtZeile[]>`
                SELECT id::text AS id, place_wiki_key, place_title, relation, state, is_active, source_system
                  FROM lore_place
                 WHERE lore_entry_id = ${eintragId}::bigint AND place_wiki_key IS NULL AND lower(place_title) = lower(${name})
                   AND relation = ${aenderung.relation}
                   FOR UPDATE
            `;
            if (bisher?.is_active === true) throw fehlerbild(pfad, "unique", "Dieser Name steht schon da.");
            if (bisher !== undefined) {
                await tx`
                    UPDATE lore_place
                       SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'editor', updated_at = now()
                     WHERE id = ${bisher.id}::bigint
                `;
                vorher.push(protokollOrt(bisher));
                nachher.push(protokollOrt(bisher, "active"));
                continue;
            }
            const [neu] = await tx<{ id: string }[]>`
                INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count,
                                        target_origin, legacy_origin, state, source_system, is_active)
                VALUES (${eintragId}::bigint, NULL, ${aenderung.relation}, ${name}, 9999, 'other', 'unresolved', 0, 'editor', 'manual', 'active',
                        'editor', TRUE)
                RETURNING id::text AS id
            `;
            nachher.push({
                rowId: neu!.id,
                wikiKey: null,
                name,
                relation: aenderung.relation,
                state: "active",
            });
            continue;
        }
        if (aenderung.op === "add") {
            let schluessel: string;
            let titel: string;
            if ("kontinent" in aenderung) {
                if (
                    !(INHALTE_KONTINENTE as readonly string[]).includes(aenderung.kontinent) ||
                    !isContinentKey(aenderung.kontinent)
                ) {
                    throw fehlerbild(`${pfad}.kontinent`, "enum", "Diesen Kontinentbegriff gibt es nicht.");
                }
                schluessel = aenderung.kontinent;
                titel = KONTINENT_NAMEN[aenderung.kontinent];
            } else {
                const tafeln = TRAEGER[aenderung.kind];
                const [traeger] = await tx.unsafe<{ name: string | null; is_active: boolean }[]>(
                    `SELECT name, is_active FROM ${tafeln.carrier} WHERE public_id = $1::uuid`,
                    [aenderung.carrierId],
                );
                if (traeger === undefined) throw new ApiError(404, "not_found", "Dieses Objekt gibt es nicht.");
                if (!traeger.is_active) {
                    throw fehlerbild(`${pfad}.carrierId`, "state", "Ein stilles Objekt ist kein Ziel.");
                }
                const wiki = await wikiSchluesselVon(tx, aenderung.kind, aenderung.carrierId);
                if (wiki === undefined) {
                    throw fehlerbild(
                        `${pfad}.carrierId`,
                        "wiki_key",
                        "Diesem Objekt ist kein Wiki-Schlüssel zugewiesen; ohne Artikel ist es kein Ziel.",
                    );
                }
                schluessel = wiki;
                titel = (traeger.name ?? "").trim() === "" ? wiki : (traeger.name ?? "");
            }
            const [bisher] = await tx<OrtZeile[]>`
                SELECT id::text AS id, place_wiki_key, place_title, relation, state, is_active, source_system
                  FROM lore_place
                 WHERE lore_entry_id = ${eintragId}::bigint AND place_wiki_key = ${schluessel} AND relation = ${aenderung.relation}
                   FOR UPDATE
            `;
            if (bisher?.is_active === true) {
                throw fehlerbild(pfad, "unique", "Diese Verknüpfung steht schon da.");
            }
            if (bisher !== undefined) {
                // Eine unterdrückte oder gelöste Zeile desselben Ziels in derselben Beziehung kommt zurück.
                await tx`
                    UPDATE lore_place
                       SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'editor', updated_at = now()
                     WHERE id = ${bisher.id}::bigint
                `;
                await trefferSchreiben(bisher.id, schluessel);
                vorher.push(protokollOrt(bisher));
                nachher.push(protokollOrt(bisher, "active"));
                continue;
            }
            // Von Hand hinzugefügte Zeilen tragen 9999 (Legacys Regel), das Ziel steht von Hand (`target_origin editor`).
            const geladen = await lookupsHolen();
            const aufloesung = resolveLorePlace(schluessel, geladen.wikiKeys, geladen.carrierIds);
            const [neu] = await tx<{ id: string }[]>`
                INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count,
                                        target_origin, legacy_origin, state, source_system, is_active)
                VALUES (${eintragId}::bigint, ${schluessel}, ${aenderung.relation}, ${titel}, 9999, ${aufloesung.keyClass}, ${aufloesung.state},
                        ${aufloesung.hits.length}, 'editor', 'manual', 'active', 'editor', TRUE)
                RETURNING id::text AS id
            `;
            for (const treffer of aufloesung.hits) {
                const [ort, gebiet, landschaft, gipfel] = hitCells(treffer);
                await tx`
                    INSERT INTO lore_place_target (lore_place_id, place_id, territory_id, region_id, terrain_peak_id)
                    VALUES (${neu!.id}::bigint, ${ort ?? null}::bigint, ${gebiet ?? null}::bigint, ${landschaft ?? null}::bigint, ${gipfel ?? null}::bigint)
                `;
            }
            nachher.push({
                rowId: neu!.id,
                wikiKey: schluessel,
                name: null,
                relation: aenderung.relation,
                state: "active",
            });
            continue;
        }
        const [zeile] = await tx<OrtZeile[]>`
            SELECT id::text AS id, place_wiki_key, place_title, relation, state, is_active, source_system
              FROM lore_place WHERE id = ${aenderung.rowId}::bigint AND lore_entry_id = ${eintragId}::bigint FOR UPDATE
        `;
        if (zeile === undefined) {
            throw fehlerbild(`${pfad}.rowId`, "unknown", "Diese Zeile gibt es nicht mehr; der Stand ist veraltet.");
        }
        if (aenderung.op === "remove") {
            if (!zeile.is_active) throw fehlerbild(`${pfad}.rowId`, "state", "Diese Zeile ist schon gelöst.");
            // Eine Zeile aus Legacy oder dem Wiki wird unterdrückt (der Zug belebt sie nie wieder), eine eigene gelöst.
            const neuerState = zeile.source_system === "legacy" ? "suppressed" : "retired";
            await tx`
                UPDATE lore_place
                   SET state = ${neuerState}, is_active = FALSE, retired_at = now(), retired_origin = 'editor', source_system = 'editor', updated_at = now()
                 WHERE id = ${zeile.id}::bigint
            `;
            vorher.push(protokollOrt(zeile));
            nachher.push(protokollOrt(zeile, neuerState));
        } else {
            if (zeile.is_active) throw fehlerbild(`${pfad}.rowId`, "state", "Diese Zeile ist nicht gelöst.");
            await tx`
                UPDATE lore_place
                   SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'editor', updated_at = now()
                 WHERE id = ${zeile.id}::bigint
            `;
            // Ein ungeklärter Name hat nie Treffer; nur ein Schlüssel wird gegen die Träger gerechnet.
            if (zeile.place_wiki_key !== null) await trefferSchreiben(zeile.id, zeile.place_wiki_key);
            vorher.push(protokollOrt(zeile));
            nachher.push(protokollOrt(zeile, "active"));
        }
    }
    return { vorher, nachher };
}

// ---------------------------------------------------------------------------------------------------------------------
// Quellenverknüpfungen
// ---------------------------------------------------------------------------------------------------------------------

export interface QuelleZeile {
    id: string;
    state: string;
    is_active: boolean;
    reference_kind: string | null;
    pages: string | null;
    note: string | null;
    source_system: string;
}

export const protokollQuelle = (
    sourceId: string,
    zeile: Pick<QuelleZeile, "state" | "reference_kind" | "pages" | "note"> | undefined,
): QuelleProtokoll => ({
    sourceId,
    state: zeile?.state ?? "none",
    referenceKind: zeile?.reference_kind ?? null,
    pages: zeile?.pages ?? null,
    note: zeile?.note ?? null,
});

const bezugGueltig = (wert: string | null | undefined): boolean =>
    wert === null || wert === undefined || (SOURCE_REFERENCE_KINDS as readonly string[]).includes(wert);

/** Die Quellenverknüpfungen ändern (anhängen, ändern, lösen, zurückholen); auch „Regeln als Text“ hängt so die Quelle einer `Quelle:`-Zeile an. Gibt vorher und nachher der berührten Verknüpfungen zurück, `undefined`, wo nichts geschah. */
export async function wendeQuellenAn(
    tx: Sql,
    eintragId: string,
    aenderungen: readonly InhalteVorkommenQuelleAenderung[],
): Promise<{ vorher: QuelleProtokoll[]; nachher: QuelleProtokoll[] } | undefined> {
    if (aenderungen.length === 0) return undefined;
    const vorher: QuelleProtokoll[] = [];
    const nachher: QuelleProtokoll[] = [];
    for (const [index, aenderung] of aenderungen.entries()) {
        const pfad = `quellen.${String(index)}`;
        const [quelle] = await tx<{ id: string; is_active: boolean }[]>`
            SELECT id::text AS id, is_active FROM feature_source WHERE public_id = ${aenderung.sourceId}::uuid
        `;
        if (quelle === undefined) throw new ApiError(404, "not_found", "Diese Quelle gibt es nicht.");
        const [bisher] = await tx<QuelleZeile[]>`
            SELECT id::text AS id, state, is_active, reference_kind, pages, note, source_system
              FROM lore_entry_source WHERE lore_entry_id = ${eintragId}::bigint AND source_id = ${quelle.id}::bigint FOR UPDATE
        `;
        const angaben =
            aenderung.op === "add" || aenderung.op === "update"
                ? {
                      referenceKind: aenderung.referenceKind,
                      pages: aenderung.pages === undefined ? undefined : nurText(aenderung.pages),
                      note: aenderung.note === undefined ? undefined : nurText(aenderung.note),
                  }
                : undefined;
        if (angaben !== undefined && !bezugGueltig(angaben.referenceKind)) {
            throw fehlerbild(`${pfad}.referenceKind`, "enum", "Diese Art des Belegs gibt es nicht.");
        }
        const davor = protokollQuelle(aenderung.sourceId, bisher);

        if (aenderung.op === "add") {
            if (!quelle.is_active)
                throw fehlerbild(`${pfad}.sourceId`, "state", "Eine stille Quelle lässt sich nicht anhängen.");
            if (bisher?.state === "active")
                throw fehlerbild(`${pfad}.sourceId`, "unique", "Diese Quelle ist schon angehängt.");
            const art = angaben?.referenceKind === undefined ? (bisher?.reference_kind ?? null) : angaben.referenceKind;
            const seiten = angaben?.pages === undefined ? (bisher?.pages ?? null) : angaben.pages;
            const notiz = angaben?.note === undefined ? (bisher?.note ?? null) : angaben.note;
            if (bisher === undefined) {
                await tx`
                    INSERT INTO lore_entry_source (lore_entry_id, source_id, reference_kind, pages, note, legacy_origin, position, state, is_active, source_system)
                    VALUES (${eintragId}::bigint, ${quelle.id}::bigint, ${art}, ${seiten}, ${notiz}, 'manual',
                            (SELECT coalesce(max(position) + 1, 0) FROM lore_entry_source WHERE lore_entry_id = ${eintragId}::bigint),
                            'active', TRUE, 'editor')
                `;
            } else {
                await tx`
                    UPDATE lore_entry_source
                       SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, reference_kind = ${art}, pages = ${seiten},
                           note = ${notiz}, source_system = 'editor', updated_at = now()
                     WHERE id = ${bisher.id}::bigint
                `;
            }
            vorher.push(davor);
            nachher.push(
                protokollQuelle(aenderung.sourceId, {
                    state: "active",
                    reference_kind: art,
                    pages: seiten,
                    note: notiz,
                }),
            );
            continue;
        }

        if (bisher === undefined)
            throw new ApiError(404, "not_found", "Diese Quelle ist an diesem Eintrag nicht angehängt.");

        if (aenderung.op === "update") {
            if (bisher.state !== "active") {
                throw fehlerbild(
                    `${pfad}.sourceId`,
                    "state",
                    "Eine gelöste Verknüpfung lässt sich nicht ändern; erst wiederherstellen.",
                );
            }
            const art = angaben?.referenceKind === undefined ? bisher.reference_kind : angaben.referenceKind;
            const seiten = angaben?.pages === undefined ? bisher.pages : angaben.pages;
            const notiz = angaben?.note === undefined ? bisher.note : angaben.note;
            if (art === bisher.reference_kind && seiten === bisher.pages && notiz === bisher.note) continue;
            await tx`
                UPDATE lore_entry_source SET reference_kind = ${art}, pages = ${seiten}, note = ${notiz}, source_system = 'editor', updated_at = now()
                 WHERE id = ${bisher.id}::bigint
            `;
            vorher.push(davor);
            nachher.push(
                protokollQuelle(aenderung.sourceId, {
                    state: "active",
                    reference_kind: art,
                    pages: seiten,
                    note: notiz,
                }),
            );
            continue;
        }

        if (aenderung.op === "remove") {
            if (bisher.state !== "active")
                throw fehlerbild(`${pfad}.sourceId`, "state", "Diese Verknüpfung ist schon gelöst.");
            // Eine Verknüpfung aus Legacy oder dem Wiki wird unterdrückt (der Zug belebt sie nie wieder), eine eigene gelöst.
            const neuerState = bisher.source_system === "legacy" ? "suppressed" : "retired";
            await tx`
                UPDATE lore_entry_source
                   SET state = ${neuerState}, is_active = FALSE, retired_at = now(), retired_origin = 'editor', source_system = 'editor', updated_at = now()
                 WHERE id = ${bisher.id}::bigint
            `;
            vorher.push(davor);
            nachher.push(protokollQuelle(aenderung.sourceId, { ...bisher, state: neuerState }));
            continue;
        }

        // restore
        if (bisher.state === "active")
            throw fehlerbild(`${pfad}.sourceId`, "state", "Diese Verknüpfung ist nicht gelöst.");
        await tx`
            UPDATE lore_entry_source
               SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'editor', updated_at = now()
             WHERE id = ${bisher.id}::bigint
        `;
        vorher.push(davor);
        nachher.push(protokollQuelle(aenderung.sourceId, { ...bisher, state: "active" }));
    }
    return vorher.length === 0 && nachher.length === 0 ? undefined : { vorher, nachher };
}
