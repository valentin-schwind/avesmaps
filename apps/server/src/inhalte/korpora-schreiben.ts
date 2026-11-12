import {
    SOURCE_TYPES,
    type InhalteKorpusAendernBody,
    type InhalteKorpusAnlegenBody,
    type InhalteKorpusFelder,
    type InhalteKorpusWirkung,
    type InhalteKorpusWirkungBody,
    type InhalteTraegerArt,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { mapEditConflict } from "../editor/place-edit.ts";
import type { MapActor, MapChange } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { pgArray } from "../migration/sync-table.ts";
import { corpusKeyOfUrl } from "../migration/subject-details.ts";
import { aktualisiereKanon, type BeruehrteTraeger } from "./kanon-folgen.ts";
import {
    angabenMit,
    korpusZeile,
    quellenDerDomain,
    traegerDerDomain,
    werteVon,
    wirkungVon,
    type KorpusZeile,
} from "./korpora-lesen.ts";
import { vorgabeVon, weichtAb, type QuellenWerte } from "./korpora-vorgabe.ts";
import { inhalteOperation } from "./operation.ts";
import { TRAEGER } from "./traeger.ts";

/**
 * Schreiben für den Reiter „Korpora“ (WI-0254, Runde 4): `corpus.create` und `corpus.update`, je EINE Operation mit Protokoll (`map_operation`,
 * `map_audit_event`, Ziel `corpus_public_id`, Migration 0236), und „Wirkung prüfen“ (nur rechnen).
 *
 * - 🔴 **Eine Operation, ein Stand, EINE Transaktion:** `corpus.update` sperrt den Korpus (`FOR UPDATE`) und seine Quellen, prüft `baseRevision` (veraltet ist 409
 *   `edit_conflict` mit wer und wann) und schreibt Angaben und Durchschreiben zusammen oder gar nicht; die Revision zählt genau einmal hoch, die der geänderten
 *   Quellen zählt ihr Trigger.
 * - 🔴 **Überall heißt überall (Vali):** Bei der Anzeigeform \`belegstelle\` schreibt eine Änderung an Art, „offiziell“, Lizenz oder Namensnennung auf ALLE aktiven
 *   Quellen der Domain durch (\`korpora-vorgabe.ts\`); Ausnahmen je Quelle gibt es nicht. Bei \`werk\` und unentschiedener Form schreibt nichts durch, und die
 *   Felder sind am Korpus gesperrt (400, solange die Form nach der Änderung keine Belegstelle ist). Ab \`INHALTE_KORPUS_BESTAETIGUNG_AB\` Quellen, die sich ändern,
 *   verlangt die Operation \`bestaetigt\` (409 \`corpus_confirm_required\`).
 * - **Das Protokoll hält die Wirkung rücknehmbar fest:** \`quellen\` trägt vorher und nachher je geänderter Quelle die vier Felder (höchstens \`PROTOKOLL_QUELLEN_MAX\`,
 *   darüber nur die Zahl). Das Etikett der Träger (Kanon, Rang 2 und 3) wird für die Träger der geänderten Quellen in derselben Transaktion neu gerechnet.
 * - 🔴 **Bestandsschutz** (Kapitel 9.37, manuell schlägt Wiki): Was der Editor ändert oder anlegt, trägt \`source_system = 'editor'\`; der Legacy-Zug fasst die
 *   Korpuszeile nie an (\`migration/sources-import.ts\`, \`protectedWhere\`) und rechnet ihre Vorgabe nach dem Abgleich erneut auf die Quellen. Die Quellen selbst
 *   werden NICHT einzeln als \`editor\` gesperrt.
 * - **Der Schlüssel ist die Domain und unveränderlich.** \`corpus.create\` prüft ihn gegen dieselbe Regel, die ihn aus einer Adresse rechnet (kein \`www\`, kein Pfad);
 *   ein vorhandener Korpus ist 409 \`corpus_exists\`. Quellen mit dieser Domain ohne Korpus gehören danach dazu (ihre Zugehörigkeit kommt aus der Adresse).
 */

/** So viele Quellen trägt der Eintrag im Protokoll höchstens einzeln (die Belegstellen-Korpora haben unter hundert); darüber nur die Zahl. */
export const PROTOKOLL_QUELLEN_MAX = 500;

const nurText = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};
const fehlerbild = (pfad: string, regel: string, satz: string): ApiError =>
    new ApiError(400, "validation_failed", satz, { issues: [{ path: pfad, rule: regel }] });

/** Die Regel, die in Legacy einen Schlüssel zulässt: eine registrierbare Domain, so wie `corpusKeyOfUrl` sie aus einer Adresse rechnet. */
export function pruefeSchluessel(roh: string): string {
    const key = roh.trim().toLowerCase().replace(/\.$/, "");
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(key) || corpusKeyOfUrl(`https://${key}/`) !== key) {
        throw fehlerbild(
            "key",
            "format",
            "Das ist keine registrierbare Domain: Der Schlüssel steht ohne www und ohne Pfad da, etwa beispiel.de.",
        );
    }
    return key;
}

// ---------------------------------------------------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------------------------------------------------

export async function legeKorpusAn(
    database: Database,
    actor: MapActor,
    body: InhalteKorpusAnlegenBody,
): Promise<OperationReceipt & { publicId: string }> {
    const key = pruefeSchluessel(body.key);
    const label = nurText(body.label) ?? "";
    let publicId = "";
    const quittung = await inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "corpus.create", body },
        async (tx) => {
            const [vorhanden] = await tx<{ public_id: string; is_active: boolean }[]>`
                SELECT public_id::text, is_active FROM source_corpus WHERE corpus_key = ${key}
            `;
            if (vorhanden !== undefined) {
                throw new ApiError(409, "corpus_exists", "Zu dieser Domain gibt es schon einen Korpus.", {
                    corpusId: vorhanden.public_id,
                    active: vorhanden.is_active,
                });
            }
            const [neu] = await tx<{ public_id: string; revision: number }[]>`
                INSERT INTO source_corpus (corpus_key, label, form, source_system)
                VALUES (${key}, ${label}, '', 'editor')
                RETURNING public_id::text, revision::int
            `;
            publicId = neu!.public_id;
            // Quellen dieser Domain ohne Korpus gehören danach dazu: Ihre Zugehörigkeit kommt allein aus der Adresse.
            const ohne = await tx<{ id: string; url: string }[]>`
                SELECT id::text, url FROM feature_source WHERE corpus_key IS NULL AND url IS NOT NULL
            `;
            const dazu = ohne.filter((quelle) => corpusKeyOfUrl(quelle.url) === key).map((quelle) => quelle.id);
            if (dazu.length > 0) {
                await tx`UPDATE feature_source SET corpus_key = ${key} WHERE id = ANY(${pgArray(dazu)}::bigint[])`;
            }
            return {
                receipt: {
                    affected: [{ kind: "corpus", id: publicId, revision: neu!.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `Korpus „${key}“ angelegt`,
                entries: [
                    {
                        action: "corpus.created",
                        corpusId: publicId,
                        revisionAfter: neu!.revision,
                        changes: { key: { after: key }, ...(label === "" ? {} : { label: { after: label } }) },
                    },
                ],
            };
        },
    );
    const kennung = publicId !== "" ? publicId : (quittung.affected.find((eines) => eines.kind === "corpus")?.id ?? "");
    return { ...quittung, publicId: kennung };
}

// ---------------------------------------------------------------------------------------------------------------------
// Wirkung prüfen
// ---------------------------------------------------------------------------------------------------------------------

export async function pruefeWirkung(
    database: Queryable,
    publicId: string,
    body: InhalteKorpusWirkungBody,
): Promise<InhalteKorpusWirkung> {
    const zeile = await korpusZeile(database, publicId);
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diesen Korpus gibt es nicht.");
    const quellen = await quellenDerDomain(database, zeile.corpus_key);
    return wirkungVon(zeile, body.fields, quellen, await traegerDerDomain(database, zeile.corpus_key));
}

// ---------------------------------------------------------------------------------------------------------------------
// Ändern
// ---------------------------------------------------------------------------------------------------------------------

type Zeile = Record<string, string | number | boolean | null>;

/** Die Felder der Vorgabe, die der Entwurf anfasst (Art, offiziell, Lizenz, Namensnennung). */
const beruehrtVorgabe = (felder: InhalteKorpusFelder): boolean =>
    felder.sourceType !== undefined ||
    felder.isOfficial !== undefined ||
    felder.lizenzAussage !== undefined ||
    felder.lizenzKey !== undefined ||
    felder.attribution !== undefined;

/** Die Angaben des Korpus gegen den Stand prüfen und die Spalten sammeln. */
async function wendeFelderAn(
    tx: Sql,
    zeile: KorpusZeile,
    felder: InhalteKorpusFelder,
    setze: Zeile,
    aenderungen: Record<string, MapChange>,
): Promise<void> {
    const merke = (feld: string, spalte: string, vorher: unknown, nachher: string | number | boolean | null): void => {
        if (vorher === nachher) return;
        setze[spalte] = nachher;
        aenderungen[feld] = { before: vorher, after: nachher };
    };
    if (felder.label !== undefined) merke("label", "label", zeile.label, felder.label.trim());
    if (felder.form !== undefined) merke("form", "form", zeile.form, felder.form);
    if (
        felder.sourceType !== undefined &&
        felder.sourceType !== null &&
        !(SOURCE_TYPES as readonly string[]).includes(felder.sourceType)
    ) {
        throw fehlerbild("fields.sourceType", "enum", "Diese Art der Quelle gibt es nicht.");
    }
    if (felder.sourceType !== undefined) merke("sourceType", "source_type", zeile.source_type, felder.sourceType);
    if (felder.isOfficial !== undefined) merke("isOfficial", "is_official", zeile.is_official, felder.isOfficial);
    if (felder.attribution !== undefined)
        merke("attribution", "attribution", zeile.attribution, nurText(felder.attribution));
    if (felder.editorNote !== undefined)
        merke("editorNote", "editor_note", zeile.editor_note, nurText(felder.editorNote));
    // Lizenz: Aussage und Schlüssel gehören zusammen (CHECK in 0066); ein Schlüssel nur bei `license`, und nur aus dem Katalog.
    if (felder.lizenzAussage !== undefined || felder.lizenzKey !== undefined) {
        const aussage = felder.lizenzAussage ?? zeile.license_statement;
        let schluessel = felder.lizenzKey !== undefined ? felder.lizenzKey : zeile.license_key;
        if (aussage !== "license") {
            if (felder.lizenzKey !== undefined && felder.lizenzKey !== null) {
                throw fehlerbild("fields.lizenzKey", "format", "Ein Lizenzschlüssel gehört nur zur Aussage „Lizenz“.");
            }
            schluessel = null;
        } else {
            if (schluessel === null)
                throw fehlerbild("fields.lizenzKey", "required", "Eine Lizenz braucht ihren Schlüssel.");
            const [bekannt] = await tx<{ key: string }[]>`SELECT key FROM license_catalog WHERE key = ${schluessel}`;
            if (bekannt === undefined)
                throw fehlerbild("fields.lizenzKey", "enum", "Diese Lizenz gibt es im Katalog nicht.");
        }
        merke("licenseStatement", "license_statement", zeile.license_statement, aussage);
        merke("licenseKey", "license_key", zeile.license_key, schluessel);
    }
}

/**
 * Die Träger, die die aktiven Verwendungen der Quellen (interne Nummern) zitieren, je Art in `ziel` gesammelt: Art und „offiziell“ ändern die Auskunft ALLER Träger dieser Quellen (Rang 2 und 3 der
 * Kanon-Regel), ihr Etikett rechnet `aktualisiereKanon` neu. Auch die Rücknahme eines Korpus (`editor/ruecknahme-korpus.ts`, WI-0265 B6g1) braucht sie.
 */
export async function traegerDerQuellen(
    tx: Queryable,
    quellenIds: readonly string[],
    ziel: Partial<Record<InhalteTraegerArt, Set<string>>>,
): Promise<void> {
    if (quellenIds.length === 0) return;
    const ids = pgArray([...quellenIds]);
    for (const art of Object.keys(TRAEGER) as InhalteTraegerArt[]) {
        const tafeln = TRAEGER[art];
        const zeilen = await tx.unsafe<{ id: string }[]>(
            `SELECT DISTINCT ${tafeln.foreignKey}::text AS id FROM ${tafeln.link}
              WHERE source_id = ANY($1::bigint[]) AND is_active AND state = 'active'`,
            [ids],
        );
        const menge = ziel[art] ?? new Set<string>();
        for (const eine of zeilen) menge.add(eine.id);
        ziel[art] = menge;
    }
}

interface QuellenZeile extends QuellenWerte {
    id: string;
    publicId: string;
}

export async function aendereKorpus(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: InhalteKorpusAendernBody,
): Promise<OperationReceipt> {
    const felder = body.fields;
    if (Object.keys(felder).length === 0) throw fehlerbild("fields", "required", "Es ist nichts zu ändern.");
    return inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "corpus.update", body: { corpusId: publicId, ...body } },
        async (tx) => {
            const [zeile] = await tx.unsafe<KorpusZeile[]>(
                `SELECT c.public_id::text AS public_id, c.revision::int AS revision, c.corpus_key, c.label, c.form, c.source_type,
                        c.is_official, c.license_statement, c.license_key, c.attribution, c.editor_note, c.source_system, c.is_active, c.updated_at
                   FROM source_corpus c WHERE c.public_id = $1::uuid FOR UPDATE`,
                [publicId],
            );
            if (zeile === undefined) throw new ApiError(404, "not_found", "Diesen Korpus gibt es nicht.");
            if (zeile.revision !== body.baseRevision) {
                throw await mapEditConflict(
                    tx,
                    { kind: "corpus", publicId },
                    { revision: zeile.revision, changedAt: zeile.updated_at },
                );
            }
            if (!zeile.is_active) throw fehlerbild("fields", "state", "Dieser Korpus ist stillgelegt.");
            const nachher = angabenMit(zeile, felder);
            // Bei einem Werk und bei unentschiedener Form bleiben Art, „offiziell“, Lizenz und Namensnennung an der Quelle: am Korpus gesperrt.
            if (beruehrtVorgabe(felder) && nachher.form !== "belegstelle") {
                throw fehlerbild(
                    "fields",
                    "form",
                    "Art, Offiziell, Lizenz und Namensnennung gibt nur eine Belegstelle vor; bei einem Werk bleiben sie an der Quelle. Erst die Anzeigeform Belegstelle wählen.",
                );
            }

            const aenderungen: Record<string, MapChange> = {};
            const setze: Zeile = {};
            await wendeFelderAn(tx, zeile, felder, setze, aenderungen);

            // ---- Durchschreiben (nur Belegstelle): die Vorgabe, die danach gilt, auf ALLE aktiven Quellen der Domain ------------------
            const vorgabe = vorgabeVon(nachher);
            let geschrieben: QuellenZeile[] = [];
            const traegerIds: Partial<Record<InhalteTraegerArt, Set<string>>> = {};
            if (nachher.form === "belegstelle") {
                const quellen = await quellenDerDomain(tx, zeile.corpus_key, { sperren: true });
                const betroffen = quellen
                    .filter((quelle) => weichtAb(vorgabe, werteVon(quelle)).length > 0)
                    .map((quelle) => ({ id: quelle.id, publicId: quelle.public_id, ...werteVon(quelle) }));
                const wirkung = wirkungVon(zeile, felder, quellen, 0);
                if (wirkung.bestaetigungNoetig && body.bestaetigt !== true) {
                    throw new ApiError(
                        409,
                        "corpus_confirm_required",
                        `Diese Änderung gilt für alle ${String(wirkung.aendernGesamt)} Quellen, die sich ändern.`,
                        {
                            quellen: wirkung.quellenGesamt,
                            aendern: wirkung.aendernGesamt,
                            traeger: await traegerDerDomain(tx, zeile.corpus_key),
                        },
                    );
                }
                if (betroffen.length > 0) {
                    await tx.unsafe(
                        `UPDATE feature_source f SET
                            source_type = COALESCE($2::text, f.source_type),
                            is_official = COALESCE($3::boolean, f.is_official),
                            license_statement = CASE WHEN $4::boolean THEN $5::text ELSE f.license_statement END,
                            license_key = CASE WHEN $4::boolean THEN $6::text ELSE f.license_key END,
                            attribution = COALESCE($7::text, f.attribution)
                          WHERE f.id = ANY($1::bigint[])`,
                        [
                            pgArray(betroffen.map((quelle) => quelle.id)),
                            vorgabe.sourceType,
                            vorgabe.isOfficial,
                            vorgabe.lizenz !== null,
                            vorgabe.lizenz?.aussage ?? null,
                            vorgabe.lizenz?.key ?? null,
                            vorgabe.attribution,
                        ] as never[],
                    );
                    geschrieben = betroffen;
                    // Art und „offiziell“ ändern die Auskunft ALLER Träger dieser Quellen (Rang 2 und 3 der Kanon-Regel).
                    const kanonBetroffen = betroffen.filter((quelle) => {
                        const art = vorgabe.sourceType !== null && quelle.sourceType !== vorgabe.sourceType;
                        const offiziell = vorgabe.isOfficial !== null && quelle.isOfficial !== vorgabe.isOfficial;
                        return art || offiziell;
                    });
                    await traegerDerQuellen(
                        tx,
                        kanonBetroffen.map((quelle) => quelle.id),
                        traegerIds,
                    );
                    const nachWerten = (quelle: QuellenZeile): Record<string, unknown> => ({
                        id: quelle.publicId,
                        ...(vorgabe.sourceType === null ? {} : { sourceType: vorgabe.sourceType }),
                        ...(vorgabe.isOfficial === null ? {} : { isOfficial: vorgabe.isOfficial }),
                        ...(vorgabe.lizenz === null
                            ? {}
                            : { lizenzAussage: vorgabe.lizenz.aussage, lizenzKey: vorgabe.lizenz.key }),
                        ...(vorgabe.attribution === null ? {} : { attribution: vorgabe.attribution }),
                    });
                    const vorWerten = (quelle: QuellenZeile): Record<string, unknown> => ({
                        id: quelle.publicId,
                        sourceType: quelle.sourceType,
                        isOfficial: quelle.isOfficial,
                        lizenzAussage: quelle.lizenzAussage,
                        lizenzKey: quelle.lizenzKey,
                        attribution: quelle.attribution,
                    });
                    aenderungen["quellen"] =
                        betroffen.length <= PROTOKOLL_QUELLEN_MAX
                            ? { before: betroffen.map(vorWerten), after: betroffen.map(nachWerten) }
                            : { before: { anzahl: betroffen.length }, after: { anzahl: betroffen.length } };
                }
            }

            if (Object.keys(aenderungen).length === 0) {
                // Nichts hat sich geändert (etwa derselbe Name noch einmal): keine Revision, kein Protokoll.
                return {
                    receipt: {
                        affected: [{ kind: "corpus", id: publicId, revision: zeile.revision }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [],
                };
            }

            const spalten = Object.entries(setze);
            const zuweisungen = spalten.map(([spalte], index) => `${spalte} = $${String(index + 3)}`);
            // Jede Änderung macht den Korpus zu einem der Redaktion (Importschutz).
            zuweisungen.push("source_system = 'editor'");
            const [neu] = await tx.unsafe<{ revision: number }[]>(
                `UPDATE source_corpus SET ${[...zuweisungen, "revision = $2::bigint"].join(", ")}
                  WHERE corpus_key = $1 RETURNING revision::int AS revision`,
                [zeile.corpus_key, zeile.revision + 1, ...spalten.map(([, wert]) => wert)] as never[],
            );
            const revision = neu!.revision;
            await aktualisiereKanon(tx, traegerIds as BeruehrteTraeger);
            const titelJetzt =
                (typeof aenderungen["label"]?.after === "string" ? aenderungen["label"].after : zeile.label).trim() ||
                zeile.corpus_key;
            return {
                receipt: { affected: [{ kind: "corpus", id: publicId, revision }], derivedWork: [], warnings: [] },
                summary:
                    geschrieben.length > 0
                        ? `Korpus „${titelJetzt}“ geändert, ${String(geschrieben.length)} Quellen`
                        : `Korpus „${titelJetzt}“ geändert`,
                entries: [
                    {
                        action: "corpus.updated",
                        corpusId: publicId,
                        revisionBefore: zeile.revision,
                        revisionAfter: revision,
                        changes: aenderungen,
                    },
                ],
            };
        },
    );
}
