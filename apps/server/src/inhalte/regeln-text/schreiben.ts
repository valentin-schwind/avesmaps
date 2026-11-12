import type {
    InhalteRegelTextUebernehmenBody,
    InhalteRegelTextUebernommen,
    InhalteVorkommenQuelleAenderung,
    InhalteVorkommenRegelAenderung,
    InhalteVorkommenRegelBedingung,
    OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database } from "../../database.ts";
import type { MapActor, MapAuditEntry, MapChange } from "../../editor/map-operation.ts";
import { ApiError } from "../../http/api-error.ts";
import { inhalteOperation } from "../operation.ts";
import { legeEintragAn, wendeQuellenAn } from "../vorkommen-schreiben.ts";
import { fehlerbild, wendeRegelnAn } from "../vorkommen-regeln-schreiben.ts";
import { pruefeText } from "./ergebnis.ts";
import { ladeWelt } from "./laden.ts";
import { begrenzeText } from "./lesen.ts";
import { planLeer, type PlanEintrag } from "./plan.ts";
import type { BedingungInnen } from "./typen.ts";

/**
 * „Übernehmen“ von „Regeln als Text“ (WI-0254 §13 und §14; Operation `lore.rules_text`, Schreibklasse `map`): Der Server liest den Text noch einmal, in der Transaktion, und legt nur an, was dann „neu“ ist. Nichts davon
 * kennt die Oberfläche vorab; sie hält nur den Text.
 *
 * - 🔴 **EINE Operation über alle Einträge** (wie das Durchschreiben eines Korpus): eine `map_operation` mit Protokoll, eine Transaktion; alles geht zusammen durch oder gar nicht. Die Revision jedes berührten Eintrags
 *   zählt (ein offener Entwurf desselben Eintrags im Fenster bekommt danach beim Speichern 409); ein neu angelegter Eintrag steht mit Revision 1 da. Die Einträge werden in der Folge ihrer Nummer gesperrt (`FOR UPDATE`),
 *   damit zwei Übernahmen oder ein Speichern im Fenster einander nicht verklemmen.
 * - **Derselbe Kern wie `lore.update` und `lore.create`:** die Regeln über `wendeRegelnAn` (Herkunft `manual`, es sei denn, der Fingerabdruck ist der des Vorschlags des Wikis; eine stillgelegte Regel mit demselben Fingerabdruck
 *   lebt wieder auf), die Quelle der `Quelle:`-Zeile über `wendeQuellenAn` (Art des Belegs ohne Angabe, Fundstelle = Seiten), ein neuer Eintrag über `legeEintragAn` (`lore.create`). Eine Quellenverknüpfung macht den Eintrag
 *   zu einem der Redaktion (`source_system = 'editor'`, Importschutz), eine reine Regel nicht (Entscheidung zu WI-0253 §26).
 * - **Nichts zu übernehmen** (alles „gibt es schon“, Rückfrage oder Fehler): 200 mit Nullen, ohne Operation und ohne Protokoll; `rest` ist der Text, der bleibt. Ein zweites Übernehmen desselben Texts legt so nichts an.
 * - **Die Antwort** trägt die Zahlen und `rest` auch in der gespeicherten Quittung: Eine Wiederholung mit derselben `operationId` bekommt dieselbe Antwort (`status: replayed`).
 * - Scheitert eine Regel im Schreiber (eine Prüfung, die der Leser nicht kennt, oder ein Wettlauf mit einem anderen Speichern), bricht alles ab, und der Satz nennt den Eintrag und seine Zeile im Text.
 */

/** Der Text enthielt nichts, was „Übernehmen“ anlegte; kein Fehler, nur kein Schreiben (die Transaktion endet unverändert). */
class NichtsZuTun extends Error {
    readonly rest: string;
    readonly schon: number;
    constructor(rest: string, schon: number) {
        super("Nichts zu übernehmen.");
        this.name = "NichtsZuTun";
        this.rest = rest;
        this.schon = schon;
    }
}

/** Eine Bedingung des Lesers als Bedingung im Körper von `lore.update` (was der Schreiber erwartet). */
function alsKoerper(b: BedingungInnen): InhalteVorkommenRegelBedingung {
    return {
        verknuepfung: b.v,
        arten: b.arten.map((a) => ({ ebene: a.ebene, art: a.art })),
        ...(b.flaeche === null
            ? {}
            : b.flaeche.offen
              ? { wartetAuf: b.flaeche.gespeichert ?? b.flaeche.titel }
              : { flaeche: b.flaeche.kennung }),
        ...(b.klima === null ? {} : { klima: { von: b.klima.von, bis: b.klima.bis } }),
        ...(b.lage === null ? {} : { lage: { richtung: b.lage.richtung, orte: b.lage.orte.map((o) => o.id) } }),
    };
}

/** Ein Fehler des Schreibers, mit dem Eintrag und der Zeile im Text davor (der Text ist die einzige Quelle: Die Redaktion soll die Stelle finden). */
function mitEintrag(fehler: unknown, p: PlanEintrag): unknown {
    if (!(fehler instanceof ApiError)) return fehler;
    return new ApiError(
        fehler.statusCode,
        fehler.code,
        `Eintrag „${p.name}“ (Zeile ${String(p.zeile + 1)}): ${fehler.message}`,
        fehler.details,
    );
}

interface Sperre {
    id: string;
    public_id: string;
    wiki_key: string | null;
    revision: number;
    is_active: boolean;
    name: string;
}

export async function uebernehmeRegelText(
    database: Database,
    actor: MapActor,
    body: InhalteRegelTextUebernehmenBody,
): Promise<InhalteRegelTextUebernommen> {
    begrenzeText(body.text);
    let quittung: OperationReceipt;
    try {
        quittung = await inhalteOperation(
            database,
            actor,
            { operationId: body.operationId, operation: "lore.rules_text", body: { text: body.text } },
            async (tx) => {
                const welt = await ladeWelt(tx);
                const { gelesen, plan, ergebnis } = pruefeText(body.text, welt);
                if (planLeer(plan)) throw new NichtsZuTun(ergebnis.rest, gelesen.zahlen.schon);

                const vorhandene = plan.eintraege.flatMap((p) => (p.id === null ? [] : [p.id]));
                const gesperrt =
                    vorhandene.length === 0
                        ? []
                        : await tx<Sperre[]>`
                              SELECT id::text AS id, public_id::text AS public_id, wiki_key, revision::int AS revision, is_active, name
                                FROM lore_entry WHERE public_id = ANY(${vorhandene}::uuid[]) ORDER BY id FOR UPDATE
                          `;
                const nachKennung = new Map(gesperrt.map((s) => [s.public_id, s]));

                const entries: MapAuditEntry[] = [];
                const affected: { kind: string; id: string; revision: number }[] = [];
                let regeln = 0;
                let quellen = 0;
                let angelegt = 0;
                let beruehrt = 0;
                for (const p of plan.eintraege) {
                    if (p.regeln.length === 0 && p.quellen.length === 0 && !p.neuAnlegen) continue;
                    let eintrag: { id: string; publicId: string; wikiKey: string | null };
                    let revisionVorher: number | null = null;
                    const aenderungen: Record<string, MapChange> = {};
                    if (p.neuAnlegen) {
                        const neu = await legeEintragAn(tx, { name: p.name, art: p.kind });
                        eintrag = { id: neu.id, publicId: neu.publicId, wikiKey: null };
                        Object.assign(aenderungen, neu.aenderungen);
                        angelegt += 1;
                    } else {
                        const s = p.id === null ? undefined : nachKennung.get(p.id);
                        if (s === undefined) {
                            throw fehlerbild(
                                "text",
                                "unknown",
                                `Der Eintrag „${p.name}“ (Zeile ${String(p.zeile + 1)}) ist inzwischen weg; bitte neu prüfen.`,
                            );
                        }
                        if (!s.is_active) {
                            throw fehlerbild(
                                "text",
                                "state",
                                `Der Eintrag „${p.name}“ (Zeile ${String(p.zeile + 1)}) ist inzwischen unterdrückt; bitte neu prüfen.`,
                            );
                        }
                        eintrag = { id: s.id, publicId: s.public_id, wikiKey: s.wiki_key };
                        revisionVorher = s.revision;
                    }

                    if (p.regeln.length > 0) {
                        const aenderung: InhalteVorkommenRegelAenderung[] = p.regeln.map((r) => ({
                            op: "add",
                            relation: r.relation!,
                            bedingungen: r.bedingungen.map(alsKoerper),
                        }));
                        try {
                            const ergebnisRegeln = await wendeRegelnAn(tx, eintrag, aenderung);
                            if (ergebnisRegeln !== undefined) {
                                aenderungen["rules"] = { before: ergebnisRegeln.vorher, after: ergebnisRegeln.nachher };
                                regeln += ergebnisRegeln.nachher.length;
                            }
                        } catch (fehler) {
                            throw mitEintrag(fehler, p);
                        }
                    }
                    let quelleAngehaengt = false;
                    if (p.quellen.length > 0) {
                        const aenderung: InhalteVorkommenQuelleAenderung[] = p.quellen.map((q) => ({
                            op: "add",
                            sourceId: q.id,
                            ...(q.seiten === "" ? {} : { pages: q.seiten }),
                        }));
                        try {
                            const ergebnisQuellen = await wendeQuellenAn(tx, eintrag.id, aenderung);
                            if (ergebnisQuellen !== undefined) {
                                aenderungen["sources"] = {
                                    before: ergebnisQuellen.vorher,
                                    after: ergebnisQuellen.nachher,
                                };
                                quellen += ergebnisQuellen.nachher.length;
                                quelleAngehaengt = true;
                            }
                        } catch (fehler) {
                            throw mitEintrag(fehler, p);
                        }
                    }

                    // Die Revision jedes berührten Eintrags zählt (der Auslöser `lore_entry_revision` hebt sie bei jeder Zeile in der Spaltenliste). Ein neuer Eintrag steht mit Revision 1 da.
                    let revision = 1;
                    if (revisionVorher !== null) {
                        const [neu] = quelleAngehaengt
                            ? await tx<{ revision: number }[]>`
                                  UPDATE lore_entry SET revision = revision, source_system = 'editor' WHERE id = ${eintrag.id}::bigint RETURNING revision::int AS revision
                              `
                            : await tx<{ revision: number }[]>`
                                  UPDATE lore_entry SET revision = revision WHERE id = ${eintrag.id}::bigint RETURNING revision::int AS revision
                              `;
                        revision = neu?.revision ?? revisionVorher + 1;
                    }
                    beruehrt += p.regeln.length > 0 || p.quellen.length > 0 ? 1 : 0;
                    affected.push({ kind: "lore", id: eintrag.publicId, revision });
                    entries.push({
                        action: p.neuAnlegen ? "lore.created" : "lore.rules_text",
                        loreId: eintrag.publicId,
                        ...(revisionVorher === null ? {} : { revisionBefore: revisionVorher }),
                        revisionAfter: revision,
                        changes: aenderungen,
                    });
                }

                const schon = gelesen.zahlen.schon;
                const zahlen = { regeln, eintraege: beruehrt, quellen, angelegt, schon, rest: ergebnis.rest };
                const teile = [
                    `${String(regeln)} ${regeln === 1 ? "Regel" : "Regeln"} an ${String(beruehrt)} ${beruehrt === 1 ? "Eintrag" : "Einträgen"}`,
                ];
                if (quellen > 0) teile.push(`${String(quellen)} ${quellen === 1 ? "Quelle" : "Quellen"} angehängt`);
                if (angelegt > 0) teile.push(`${String(angelegt)} ${angelegt === 1 ? "Eintrag" : "Einträge"} angelegt`);
                // Die Zahlen und der Rest stehen in der gespeicherten Quittung: eine Wiederholung mit derselben Kennung bekommt dieselbe Antwort.
                const receipt = { affected, derivedWork: [], warnings: [], ...zahlen };
                return { receipt, summary: `Regeln als Text übernommen: ${teile.join(", ")}`, entries };
            },
        );
    } catch (fehler) {
        if (!(fehler instanceof NichtsZuTun)) throw fehler;
        return {
            operationId: body.operationId,
            status: "applied",
            environment: actor.environment,
            affected: [],
            derivedWork: [],
            warnings: [],
            regeln: 0,
            eintraege: 0,
            quellen: 0,
            angelegt: 0,
            schon: fehler.schon,
            rest: fehler.rest,
        };
    }
    return quittung as InhalteRegelTextUebernommen;
}
