import {
    type EditorPathStreet,
    type InhalteKorpusVorgabe,
    type InhalteQuelleAendernBody,
    type InhalteQuelleAnlegenBody,
    type InhalteTraegerArt,
    type InhalteVerwendungAenderung,
    type InhalteVerwendungVorher,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { mapEditConflict } from "../editor/place-edit.ts";
import type { MapActor, MapAuditEntry, MapChange } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { urlHash } from "../migration/sources.ts";
import { titelOhneAuszeichnung } from "../wiki/infobox/text.ts";
import { adressVergleich, findeGleicheQuelle, korpusSchluesselDerAdresse } from "./adress-vergleich.ts";
import { aktualisiereKanon, type BeruehrteTraeger } from "./kanon-folgen.ts";
import { bestandDerDomain, korpusForm } from "./korpora-lesen.ts";
import { gibtVor, KEIN_BESTAND, rechteDerNeuenQuelle, vorgabeVon } from "./korpora-vorgabe.ts";
import { inhalteOperation, type InhalteArbeit } from "./operation.ts";
import { TRAEGER } from "./traeger.ts";
import { eintrag } from "./traeger-quellen-stand.ts";
import {
    aendereStrassenQuelle,
    leseStrasse,
    sperreStrasse,
    wegEintrag,
    type StrassenAenderung,
    type StrassenLage,
} from "./traeger-quellen-weg.ts";
import { fehlerbild, nurText, wendeVerwendungAn } from "./verknuepfung-schreiben.ts";

/**
 * Schreiben für den Reiter „Quellen“ (WI-0254): `source.create` und `source.update`, je EINE Operation mit Protokoll (`map_operation`,
 * `map_audit_event`, Ziel `source_public_id`, Migration 0232).
 *
 * - 🔴 **Eine Operation, ein Stand:** `source.update` sperrt die Quelle (`FOR UPDATE`) und prüft `baseRevision`; ein veralteter Stand ist
 *   409 `edit_conflict` mit wer und wann (`mapEditConflict`). Stammdaten und Verwendungen gehen zusammen durch oder gar nicht; jede
 *   Änderung zählt die Revision der Quelle genau einmal hoch.
 * - 🔴 **Bestandsschutz** (Kapitel 9.37, manuell schlägt Wiki): Was der Editor ändert oder anlegt, trägt `source_system = 'editor'`; der
 *   Legacy-Zug fasst solche Zeilen nie an und legt sie nicht still (`migration/sources-import.ts`, `protectedWhere`). Eine Änderung nur
 *   an den Verwendungen lässt die Stammdaten der Quelle beim Zug.
 * - **Stilllegen, nie löschen:** Eine Verwendung aus Legacy wird unterdrückt (`suppressed`, der Zug belebt sie nie), eine eigene gelöst
 *   (`retired`), jede mit `retired_origin = editor` und wiederherstellbar. Eine Quelle wird mit `aktiv: false` still, nicht gelöscht.
 *   Der Kern, der eine Verknüpfung anlegt, ändert, löst und holt, steht in `verknuepfung-schreiben.ts`: Ihn teilt der Weg vom Objekt her
 *   (`traeger-quellen-schreiben.ts`, die Klappbox der Karteneditoren).
 * - 🔴 **Ein Weg ist immer die ganze Straße** (Betreiber 2026-10-28): Eine Verwendung mit `kind = path` schreibt über denselben Straßen-Kern wie der Wegeditor
 *   (`traeger-quellen-weg.ts`: `sperreStrasse`, `aendereStrassenQuelle`), nicht über `wendeVerwendungAn`; `carrierId` ist irgendein Abschnitt der Straße, der Server findet sie
 *   (die Oberfläche sendet den Anker). Die Quelle selbst hat eine Revision, die Straße nicht: Darum trägt jede Änderung an einem Weg `vorher`, die Sicht, die die Oberfläche las
 *   (409 `edit_conflict`, wenn sie nicht mehr stimmt; für andere Träger gilt `vorher` nicht, 400).
 * - 🔴 **Die Reihenfolge der Sperren ist fest**, damit zwei Fenster sich nicht verklemmen: erst die Quelle (`FOR UPDATE`), dann alle Straßen des Körpers nach AUFSTEIGENDEM
 *   Anker (`pg_advisory_xact_lock`, wie sie auch der Wegeditor nimmt), dann die Verknüpfungen (`FOR UPDATE` an den Zeilen, in der Folge des Körpers, je Straße nach Nummer).
 *   Dieselbe Straße zweimal in einem Körper ist 400. Der Wegeditor (`traeger.sources`) nimmt nur die Sperre der Straße und die Verknüpfungen, nie die Quelle: Es gibt keinen Kreis.
 * - **Protokoll:** `source.updated` nennt die Straße in `changes.links` mit ihrem Namen. Dazu schreibt die Operation für jede geänderte Straße den Eintrag `path.sources_changed` am Anker
 *   (`wegEintrag`, derselbe wie im Wegeditor): Der Verlauf der Straße liest Einträge, die an einem ihrer Abschnitte hängen, und findet so auch, was vom Reiter „Quellen“ kam.
 * - **Identität:** Die Adresse ist die Identität (`source_key = url:<sha256>`, Migration 0066) und wird hier nur beim Anlegen gesetzt. Eine
 *   bekannte Adresse legt nichts an, sondern meldet die vorhandene Quelle (409 `source_exists`): verknüpfen statt überschreiben. Das gilt auch für dieselbe Seite in einer anderen Schreibweise (http/https, `www.`,
 *   Schrägstrich am Schluss; `adress-vergleich.ts`, WI-0277). Eine
 *   URL-lose Quelle legt dieser Weg nicht an (offene Fachentscheidung, WI-0254 §10).
 * - 🔴 **Was der Korpus vorgibt, gehört dem Korpus** (WI-0254, Runde 4; Vali: „überall“): Hat die Domain einen Korpus mit der Anzeigeform Belegstelle und
 *   setzt er Art, „offiziell“, Lizenz oder Namensnennung, ändern sich diese Felder nur dort; an der einzelnen Quelle sind sie gesperrt (400 `korpus`), und eine
 *   neue Quelle der Domain bekommt die Vorgabe. Ausnahmen je Quelle gibt es nicht.
 * - **Das Etikett der Träger** (Kanon, Rang 1 bis 3) wird für die berührten Träger in derselben Transaktion neu gerechnet
 *   (`kanon-folgen.ts`): bei einer Verwendung für ihren Träger, bei Art, „offiziell“ oder Stilllegen der Quelle für alle ihre Träger.
 */

type Zeile = Record<string, string | number | boolean | null>;

/** Die Adresse, wie sie die Identität bildet: genau wie geliefert, nur getrimmt, mit https oder http und einem Host. */
export function pruefeAdresse(roh: string): string {
    const url = roh.trim();
    let geparst: URL;
    try {
        geparst = new URL(url);
    } catch {
        throw fehlerbild("url", "format", "Die Adresse ist keine gültige Webadresse.");
    }
    if ((geparst.protocol !== "https:" && geparst.protocol !== "http:") || geparst.hostname === "") {
        throw fehlerbild("url", "format", "Die Adresse muss mit https:// oder http:// beginnen.");
    }
    return url;
}

/** `url:` plus SHA-256 (hex) der Adresse, genau wie geliefert: Legacys `url_hash` und die Prüfung `feature_source_url_is_the_key`. */
export const schluesselDerAdresse = (url: string): string => `url:${urlHash(url)}`;

// ---------------------------------------------------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------------------------------------------------

export async function legeQuelleAn(
    database: Database,
    actor: MapActor,
    body: InhalteQuelleAnlegenBody,
): Promise<OperationReceipt & { publicId: string }> {
    const url = pruefeAdresse(body.url);
    const title = titelOhneAuszeichnung(body.title).trim();
    if (title === "") throw fehlerbild("title", "required", "Eine Quelle braucht einen Titel.");
    const schluessel = schluesselDerAdresse(url);
    let publicId = "";
    const quittung = await inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "source.create", body },
        async (tx) => {
            // Zwei Schreibweisen derselben Seite haben verschiedene Schlüssel, die Eindeutigkeit der Tafel trennt sie nicht: Wer gleichzeitig anlegt, stellt sich hier an.
            const vergleich = adressVergleich(url) ?? url;
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source.create:${vergleich}`}, 0))`;
            const [vorhanden] = await tx<{ public_id: string; is_active: boolean }[]>`
                SELECT public_id::text, is_active FROM feature_source WHERE source_key = ${schluessel}
            `;
            const gleich = vorhanden === undefined ? await findeGleicheQuelle(tx, url) : undefined;
            if (vorhanden !== undefined || gleich !== undefined) {
                throw new ApiError(
                    409,
                    "source_exists",
                    "Diese Adresse gehört schon zu einer Quelle des Katalogs. Sie wird verknüpft, nicht neu angelegt.",
                    { sourceId: vorhanden?.public_id ?? gleich?.id, active: vorhanden?.is_active ?? gleich?.is_active },
                );
            }
            // Der Korpus der Domain, wenn es ihn gibt: seine dokumentierten Rechte gelten für die neue Quelle (Lizenz und Namensnennung,
            // nie Art und „offiziell“: die gehören bei Werken der Quelle, WI-0254 §5).
            const domain = korpusSchluesselDerAdresse(url);
            const [korpus] =
                domain === ""
                    ? []
                    : await tx<
                          {
                              corpus_key: string;
                              form: string;
                              source_type: string | null;
                              is_official: boolean | null;
                              license_statement: string;
                              license_key: string | null;
                              attribution: string | null;
                          }[]
                      >`SELECT corpus_key, form, source_type, is_official, license_statement, license_key, attribution
                           FROM source_corpus WHERE corpus_key = ${domain}`;
            // Bei einer Belegstelle mit Vorgabe gilt sie für die neue Quelle (Art und „offiziell“ eingeschlossen); sonst bleiben beide an der Quelle.
            const vorgabe = korpus === undefined ? undefined : vorgabeVon(korpusAngaben(korpus));
            // Was der Korpus nicht trägt, kommt von dem, was die Quellen seiner Domain gemeinsam sagen (`bestandVon`, WI-0277); was der Mensch wählt, geht vor.
            const bestand =
                korpus === undefined
                    ? KEIN_BESTAND
                    : await bestandDerDomain(tx, korpus.corpus_key, korpusForm(korpus.form));
            const typ = vorgabe?.sourceType ?? body.sourceType ?? bestand.sourceType ?? "sonstiges";
            const offiziell = vorgabe?.isOfficial ?? body.isOfficial ?? bestand.isOfficial;
            const rechte = rechteDerNeuenQuelle(url, korpus, bestand);
            const [neu] = await tx<{ public_id: string; revision: number }[]>`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, license_statement,
                                            license_key, attribution, corpus_key, source_system)
                VALUES (${schluessel}, 'final', ${url}, ${title}, ${typ}, ${offiziell},
                        ${rechte.aussage}, ${rechte.key},
                        ${rechte.attribution}, ${korpus?.corpus_key ?? null}, 'editor')
                RETURNING public_id::text, revision::int
            `;
            publicId = neu!.public_id;
            return {
                receipt: {
                    affected: [{ kind: "source", id: publicId, revision: neu!.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `Quelle „${title}“ angelegt`,
                entries: [
                    {
                        action: "source.created",
                        sourceId: publicId,
                        revisionAfter: neu!.revision,
                        changes: {
                            url: { after: url },
                            title: { after: title },
                            sourceType: { after: typ },
                            isOfficial: { after: offiziell },
                        },
                    },
                ],
            };
        },
    );
    // Eine wiederholte Anfrage (`replayed`) kennt die Kennung nur aus der Quittung.
    const kennung = publicId !== "" ? publicId : (quittung.affected.find((e) => e.kind === "source")?.id ?? "");
    return { ...quittung, publicId: kennung };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ändern
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Die Verwendungen einer Quelle, die die Rücknahme direkt auf einen Stand setzt (WI-0265 B6g3, `editor/ruecknahme-traeger-quellen.ts`), statt sie als Änderungen (`links`) durch die Vorwärts-Operation
 * zu schicken: was `source.updated` als `changes.links` festhält, der Eintrag je Straße am Anker, und die berührten Träger für das Etikett.
 */
export interface ExakteVerwendungen {
    vorher: Record<string, unknown>[];
    nachher: Record<string, unknown>[];
    beruehrt: Partial<Record<InhalteTraegerArt, Set<string>>>;
    eintraegeWege: MapAuditEntry[];
}

/** Die Hand der Rücknahme: schreibt die Verwendungen einer gesperrten Quelle direkt (`ExakteVerwendungen`). */
export type SchreibeExakt = (
    tx: Sql,
    quelle: { id: string; title: string; is_active: boolean; publicId: string },
) => Promise<ExakteVerwendungen>;

export interface QuelleSperre {
    id: string;
    revision: number;
    updated_at: Date;
    title: string;
    source_type: string;
    is_official: boolean;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
    editor_note: string | null;
    is_active: boolean;
    source_system: string;
}

export async function aendereQuelle(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: InhalteQuelleAendernBody,
): Promise<OperationReceipt> {
    const felder = body.fields ?? {};
    const links = body.links ?? [];
    if (Object.keys(felder).length === 0 && links.length === 0) {
        throw fehlerbild("fields", "required", "Es ist nichts zu ändern.");
    }
    const wegVorher = pruefeWegVorher(links);
    return inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "source.update", body: { sourceId: publicId, ...body } },
        (tx) => schreibeQuelleAendern(tx, publicId, body, wegVorher),
    );
}

/**
 * Die Arbeit von `source.update` in der Transaktion der Schreibnaht: die Quelle sperren, gegen `baseRevision` prüfen, Stammdaten und Verwendungen schreiben, das Etikett der Träger neu
 * rechnen. Herausgezogen, damit die Rücknahme (`editor/ruecknahme-quelle.ts`, WI-0265 B6g1) dieselben Regeln und denselben Schreibweg in ihrer eigenen Transaktion nimmt, statt sie zu
 * kopieren: Korpus-Vorgabe, Lizenzprüfung, Revision, Kanon. Die Verwendungen setzt die Rücknahme mit `exakt` direkt auf den Stand vor der Serie (WI-0265 B6g3), nicht über `links`: Die Revision zählt
 * trotzdem genau einmal, und `source.updated` hält sie wie das Original fest (`changes.links`).
 */
export async function schreibeQuelleAendern(
    tx: Sql,
    publicId: string,
    body: Pick<InhalteQuelleAendernBody, "baseRevision" | "fields" | "links">,
    wegVorher: ReadonlyMap<number, InhalteVerwendungVorher | null>,
    exakt?: SchreibeExakt,
): Promise<InhalteArbeit> {
    const felder = body.fields ?? {};
    const links = body.links ?? [];
    const [quelle] = await tx<QuelleSperre[]>`
        SELECT id::text AS id, revision::int AS revision, updated_at, title, source_type, is_official, license_statement,
               license_key, attribution, editor_note, is_active, source_system
          FROM feature_source WHERE public_id = ${publicId}::uuid FOR UPDATE
    `;
    if (quelle === undefined) throw new ApiError(404, "not_found", "Diese Quelle gibt es nicht.");
    if (quelle.revision !== body.baseRevision) {
        throw await mapEditConflict(
            tx,
            { kind: "source", publicId },
            { revision: quelle.revision, changedAt: quelle.updated_at },
        );
    }

    await pruefeKorpusVorgabe(tx, quelle, felder);

    const aenderungen: Record<string, MapChange> = {};
    const setze: Zeile = {};
    const stammdatenGeaendert = await wendeFelderAn(tx, quelle, felder, setze, aenderungen);

    const beruehrt: Partial<Record<InhalteTraegerArt, Set<string>>> = {};
    const vermerke = (art: InhalteTraegerArt, ids: Iterable<string>): void => {
        const menge = beruehrt[art] ?? new Set<string>();
        for (const id of ids) menge.add(id);
        beruehrt[art] = menge;
    };
    const vorher: Record<string, unknown>[] = [];
    const nachher: Record<string, unknown>[] = [];
    const eintraegeWege: MapAuditEntry[] = [];
    // Erst die Straßen (aufsteigend nach Anker), dann die Verknüpfungen: die feste Folge der Sperren.
    const strassen = await sperreStrassen(tx, links);
    const quelleZeile = { id: quelle.id, title: quelle.title, is_active: quelle.is_active };
    for (const [index, aenderung] of links.entries()) {
        if (aenderung.kind === "path") {
            const lage = strassen.get(aenderung.carrierId)!;
            const ergebnis = await aendereStrassenQuelle(
                tx,
                lage,
                quelleZeile,
                publicId,
                alsStrassenAenderung(aenderung, wegVorher.get(index)!),
                quelle.revision,
            );
            if (ergebnis === undefined) continue;
            vermerke(
                "path",
                lage.abschnitte.map((abschnitt) => abschnitt.id),
            );
            // Die Quelle nennt die Straße mit ihrem Namen; die Straße schreibt der Eintrag am Anker (Verlauf des Wegeditors).
            vorher.push({ ...ergebnis.vorher, name: lage.strasse.name });
            nachher.push({ ...ergebnis.nachher, name: lage.strasse.name });
            eintraegeWege.push(
                wegEintrag(
                    lage,
                    [eintrag(quelleZeile, publicId, ergebnis.vorher)],
                    [eintrag(quelleZeile, publicId, ergebnis.nachher)],
                ),
            );
            continue;
        }
        const ergebnis = await wendeVerwendungAn(tx, quelle.id, aenderung);
        if (ergebnis === undefined) continue;
        vermerke(aenderung.kind, [ergebnis.traegerId]);
        vorher.push(ergebnis.vorher);
        nachher.push(ergebnis.nachher);
    }
    if (exakt !== undefined) {
        const gesetzt = await exakt(tx, { ...quelleZeile, publicId });
        vorher.push(...gesetzt.vorher);
        nachher.push(...gesetzt.nachher);
        for (const [art, ids] of Object.entries(gesetzt.beruehrt) as [InhalteTraegerArt, Set<string>][])
            vermerke(art, ids);
        eintraegeWege.push(...gesetzt.eintraegeWege);
    }
    if (vorher.length > 0) aenderungen["links"] = { before: vorher, after: nachher };

    if (Object.keys(aenderungen).length === 0) {
        // Nichts hat sich geändert (etwa derselbe Titel noch einmal): keine Revision, kein Protokoll.
        return {
            receipt: {
                affected: [{ kind: "source", id: publicId, revision: quelle.revision }],
                derivedWork: [],
                warnings: [],
            },
            entries: [],
        };
    }

    // Art, „offiziell“ oder Stilllegen ändern die Auskunft ALLER Träger der Quelle (Rang 2 und 3 der Kanon-Regel).
    if ("sourceType" in aenderungen || "isOfficial" in aenderungen || "active" in aenderungen) {
        for (const art of Object.keys(TRAEGER) as InhalteTraegerArt[]) {
            const tafeln = TRAEGER[art];
            const zeilen = await tx.unsafe<{ id: string }[]>(
                `SELECT DISTINCT ${tafeln.foreignKey}::text AS id FROM ${tafeln.link} WHERE source_id = $1::bigint AND is_active AND state = 'active'`,
                [quelle.id],
            );
            vermerke(
                art,
                zeilen.map((zeile) => zeile.id),
            );
        }
    }

    const spalten = Object.entries(setze);
    const zuweisungen = spalten.map(([spalte], index) => `${spalte} = $${String(index + 3)}`);
    if (stammdatenGeaendert) zuweisungen.push("source_system = 'editor'");
    const [neu] = await tx.unsafe<{ revision: number }[]>(
        `UPDATE feature_source SET ${[...zuweisungen, "revision = $2::bigint"].join(", ")}
          WHERE id = $1::bigint RETURNING revision::int AS revision`,
        [quelle.id, quelle.revision + 1, ...spalten.map(([, wert]) => wert)] as never[],
    );
    const revision = neu!.revision;
    await aktualisiereKanon(tx, beruehrt as BeruehrteTraeger);
    const titelJetzt = typeof aenderungen["title"]?.after === "string" ? aenderungen["title"].after : quelle.title;
    return {
        receipt: { affected: [{ kind: "source", id: publicId, revision }], derivedWork: [], warnings: [] },
        summary: `Quelle „${titelJetzt}“ geändert`,
        entries: [
            {
                action: "source.updated",
                sourceId: publicId,
                revisionBefore: quelle.revision,
                revisionAfter: revision,
                changes: aenderungen,
            },
            ...eintraegeWege,
        ],
    };
}

/**
 * Zu jedem Weg im Körper gehört der gesehene Stand (`vorher`), zu jedem anderen Träger nicht (400). Gibt `vorher` je Platz im Körper zurück, nur für die Wege. Vor allen Sperren: Ein Körper, der
 * so nicht gelten kann, kostet keine Transaktion.
 */
function pruefeWegVorher(links: readonly InhalteVerwendungAenderung[]): Map<number, InhalteVerwendungVorher | null> {
    const vorher = new Map<number, InhalteVerwendungVorher | null>();
    for (const [index, aenderung] of links.entries()) {
        const pfad = `links.${String(index)}.vorher`;
        if (aenderung.kind !== "path") {
            if (aenderung.vorher !== undefined) {
                throw fehlerbild(pfad, "additionalProperties", "Der gesehene Stand gilt nur für einen Weg.");
            }
            continue;
        }
        if (aenderung.vorher === undefined) {
            throw fehlerbild(pfad, "required", "Zu einem Weg gehört der gesehene Stand (vorher).");
        }
        vorher.set(index, aenderung.vorher);
    }
    return vorher;
}

/** Die Änderung an einem Weg in der Form des Straßen-Kerns (der Kern kennt die Straße, nicht den Träger). */
function alsStrassenAenderung(
    aenderung: InhalteVerwendungAenderung,
    vorher: InhalteVerwendungVorher | null,
): StrassenAenderung {
    if (aenderung.op === "add" || aenderung.op === "update") {
        return {
            op: aenderung.op,
            vorher,
            referenceKind: aenderung.referenceKind,
            pages: aenderung.pages,
            note: aenderung.note,
        };
    }
    return { op: aenderung.op, vorher };
}

/**
 * Die Straßen der Wege im Körper sperren, aufsteigend nach Anker (die feste Folge; `sperreStrasse` nimmt die Sperre auf den Anker): 404, wo es einen Abschnitt nicht gibt; 400, wo zwei Einträge
 * dieselbe Straße meinen oder die Straße nicht auf der Karte ist. Schlüssel der Antwort ist die `carrierId` des Körpers.
 */
async function sperreStrassen(
    tx: Sql,
    links: readonly InhalteVerwendungAenderung[],
): Promise<Map<string, StrassenLage>> {
    const vorab: { kennung: string; strasse: EditorPathStreet }[] = [];
    const ankerVon = new Set<string>();
    for (const [index, aenderung] of links.entries()) {
        if (aenderung.kind !== "path") continue;
        const strasse = await leseStrasse(tx, aenderung.carrierId);
        if (ankerVon.has(strasse.id)) {
            throw fehlerbild(
                `links.${String(index)}.carrierId`,
                "unique",
                "Dieselbe Straße darf in einem Speichern nur einmal vorkommen.",
            );
        }
        ankerVon.add(strasse.id);
        vorab.push({ kennung: aenderung.carrierId, strasse });
    }
    const lagen = new Map<string, StrassenLage>();
    for (const { kennung, strasse } of vorab.sort((a, b) => (a.strasse.id < b.strasse.id ? -1 : 1))) {
        lagen.set(kennung, await sperreStrasse(tx, kennung, strasse));
    }
    return lagen;
}

/** Die Angaben eines Korpus für `vorgabeVon`, wie die Tafel sie trägt. */
function korpusAngaben(korpus: {
    form: string;
    source_type: string | null;
    is_official: boolean | null;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
}): Parameters<typeof vorgabeVon>[0] {
    return {
        form: korpus.form === "werk" || korpus.form === "belegstelle" ? korpus.form : "",
        sourceType: korpus.source_type,
        isOfficial: korpus.is_official,
        lizenzAussage: korpus.license_statement,
        lizenzKey: korpus.license_key,
        attribution: korpus.attribution,
    };
}

/**
 * Was der Korpus der Domain vorgibt, ändert sich nur dort (Vali: überall heißt überall). Eine Änderung an einem solchen Feld, die einen anderen Wert setzt, ist 400;
 * derselbe Wert noch einmal ist keine Änderung. Eine Quelle ohne Korpus, mit einem Werk-Korpus oder ohne Vorgabe ist frei.
 */
export async function pruefeKorpusVorgabe(
    tx: Queryable,
    quelle: Pick<
        QuelleSperre,
        "id" | "source_type" | "is_official" | "license_statement" | "license_key" | "attribution"
    >,
    felder: NonNullable<InhalteQuelleAendernBody["fields"]>,
): Promise<void> {
    const aendertSich =
        felder.sourceType !== undefined ||
        felder.isOfficial !== undefined ||
        felder.lizenzAussage !== undefined ||
        felder.lizenzKey !== undefined ||
        felder.attribution !== undefined;
    if (!aendertSich) return;
    const [korpus] = await tx<
        {
            form: string;
            source_type: string | null;
            is_official: boolean | null;
            license_statement: string;
            license_key: string | null;
            attribution: string | null;
        }[]
    >`
        SELECT c.form, c.source_type, c.is_official, c.license_statement, c.license_key, c.attribution
          FROM feature_source f JOIN source_corpus c ON c.corpus_key = f.corpus_key
         WHERE f.id = ${quelle.id}::bigint
    `;
    if (korpus === undefined) return;
    const vorgabe = vorgabeVon(korpusAngaben(korpus));
    const gehoert = new Set<InhalteKorpusVorgabe>(gibtVor(vorgabe));
    if (gehoert.size === 0) return;
    const verbieten = (feld: InhalteKorpusVorgabe, pfad: string): never => {
        throw fehlerbild(
            pfad,
            "korpus",
            "Dieses Feld gibt der Korpus der Domain vor (Belegstelle): Es ändert sich dort, nicht an der einzelnen Quelle.",
        );
    };
    if (gehoert.has("sourceType") && felder.sourceType !== undefined && felder.sourceType !== quelle.source_type)
        verbieten("sourceType", "fields.sourceType");
    if (gehoert.has("isOfficial") && felder.isOfficial !== undefined && felder.isOfficial !== quelle.is_official)
        verbieten("isOfficial", "fields.isOfficial");
    if (
        gehoert.has("attribution") &&
        felder.attribution !== undefined &&
        nurText(felder.attribution) !== quelle.attribution
    )
        verbieten("attribution", "fields.attribution");
    if (gehoert.has("lizenz") && (felder.lizenzAussage !== undefined || felder.lizenzKey !== undefined)) {
        const aussage = felder.lizenzAussage ?? quelle.license_statement;
        const schluessel =
            aussage === "license" ? (felder.lizenzKey !== undefined ? felder.lizenzKey : quelle.license_key) : null;
        if (aussage !== quelle.license_statement || schluessel !== quelle.license_key)
            verbieten("lizenz", "fields.lizenzAussage");
    }
}

/** Die Felder der Quelle gegen den Stand prüfen und die Spalten sammeln; `true`, wenn ein Wert der Quelle selbst sich ändert. */
async function wendeFelderAn(
    tx: Sql,
    quelle: QuelleSperre,
    felder: NonNullable<InhalteQuelleAendernBody["fields"]>,
    setze: Zeile,
    aenderungen: Record<string, MapChange>,
): Promise<boolean> {
    const merke = (feld: string, spalte: string, vorher: unknown, nachher: string | number | boolean | null): void => {
        if (vorher === nachher) return;
        setze[spalte] = nachher;
        aenderungen[feld] = { before: vorher, after: nachher };
    };
    if (felder.title !== undefined) {
        const titel = titelOhneAuszeichnung(felder.title).trim();
        if (titel === "") throw fehlerbild("fields.title", "required", "Eine Quelle braucht einen Titel.");
        merke("title", "title", quelle.title, titel);
    }
    if (felder.sourceType !== undefined) merke("sourceType", "source_type", quelle.source_type, felder.sourceType);
    if (felder.isOfficial !== undefined) merke("isOfficial", "is_official", quelle.is_official, felder.isOfficial);
    if (felder.attribution !== undefined)
        merke("attribution", "attribution", quelle.attribution, nurText(felder.attribution));
    if (felder.editorNote !== undefined)
        merke("editorNote", "editor_note", quelle.editor_note, nurText(felder.editorNote));

    // Lizenz: Aussage und Schlüssel gehören zusammen (CHECK in 0066); ein Schlüssel nur bei `license`, und nur aus dem Katalog.
    if (felder.lizenzAussage !== undefined || felder.lizenzKey !== undefined) {
        const aussage = felder.lizenzAussage ?? quelle.license_statement;
        let schluessel = felder.lizenzKey !== undefined ? felder.lizenzKey : quelle.license_key;
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
        merke("licenseStatement", "license_statement", quelle.license_statement, aussage);
        merke("licenseKey", "license_key", quelle.license_key, schluessel);
    }
    const stammdaten = Object.keys(setze).length > 0;

    if (felder.aktiv !== undefined && felder.aktiv !== quelle.is_active) {
        setze["is_active"] = felder.aktiv;
        // Die Spalten der Stilllegung folgen der Prüfung `feature_source_retired_consistent` (0066): alle drei zusammen oder keine.
        if (felder.aktiv) {
            setze["retired_at"] = null;
            setze["retired_origin"] = null;
        } else {
            setze["retired_at"] = new Date().toISOString();
            setze["retired_origin"] = "editor";
        }
        aenderungen["active"] = { before: quelle.is_active, after: felder.aktiv };
        return true;
    }
    return stammdaten;
}
