import {
    INHALTE_LIZENZ_AUSSAGEN,
    SOURCE_TYPES,
    type InhalteQuelleFelder,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { pruefeKorpusVorgabe, schreibeQuelleAendern } from "../inhalte/quellen-schreiben.ts";
import { TRAEGER } from "../inhalte/traeger.ts";
import type { Sql } from "../auth/session-store.ts";
import { readEditorPathStreet } from "./path-list.ts";
import type { MapActor } from "./map-operation.ts";
import { eintraegeNachKennung } from "./history.ts";
import type { RuecknahmeSchreiben } from "./ruecknahme-ablauf.ts";
import { QUELLE_OPERATIONEN, RUECKNAHME_QUELLE_OPERATION } from "./ruecknahme-arten.ts";
import {
    gleichWert,
    inhalteFamilie,
    mitGrund,
    nichtRuecknehmbar,
    planAusEintraegen,
    ruecknehmenInhalte,
    vorschauInhalte,
    zielFelder,
    zusammenfassung,
    type InhaltePlan,
} from "./ruecknahme-inhalte.ts";
import {
    exakteVerwendungen,
    konflikteAnDerQuelle,
    planAusQuelle,
    pruefeQuellen,
    sperreQuellen,
    type QuellenPlan,
    type TraegerAenderung,
} from "./ruecknahme-traeger-quellen.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt } from "./ruecknahme.ts";

/**
 * Quellen zurücknehmen (WI-0265 B6g1; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3, F.1, Gate 2 und 3; Testvertrag U4 bis U9): der Adapter der
 * Katalogquelle für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `source.restore_series` (Quelle `restore`, `reverts` = die offenen Mitglieder in
 * Serienfolge; Ablauf, Fehler und Naht der Inhalte in `ruecknahme-ablauf.ts` und `ruecknahme-inhalte.ts`). Die Route hängt an EINER Quelle (`:id`); jedes Mitglied berührt sie.
 *
 * 🔴 **Was zurückgeht** (`source.update` und die Rücknahme selbst, wenn das Protokoll nur Felder der Quelle nennt): Titel, Art, „offiziell“, Lizenz (Aussage und Schlüssel zusammen),
 * Namensnennung, Notiz und Stillgelegt. Mehrere Mitglieder sind eine Arbeitsserie (dieselbe Quelle, dieselbe Person): je Feld der Wert VOR dem ersten Mitglied, das es berührt, in EINER
 * Operation. Geschrieben wird mit dem Schreibweg von `source.update` selbst (`schreibeQuelleAendern`): Korpus-Vorgabe, Lizenzprüfung, Revision, Etikett der Träger (Kanon, wenn Art, „offiziell“ oder
 * Stilllegen sich ändern) und `source_system = 'editor'` gelten hier wie dort.
 *
 * 🔴 **Die Verwendungen gehen mit zurück** (WI-0265 B6g3). Eine `source.update`, die auch `links` ändert (Verwendungen an Orten, Gebieten, Flächen, Gipfeln, Wegen), hält die Verwendung je Zeile vorher und
 * nachher fest; dieselbe Rücknahme wie `traeger.sources` vom Träger her, mit demselben Kern (`ruecknahme-traeger-quellen.ts`): Jede Verknüpfung geht direkt auf Zustand und Angaben vor der Serie
 * (eine, die die Serie anlegte, wird still gelegt, nie gelöscht), das Etikett der Träger wird neu gerechnet, beim Weg gilt die ganze Straße. Geschrieben wird in der Transaktion von `source.update` selbst
 * (`schreibeQuelleAendern` mit der Hand `exakt`): Die Revision der Quelle zählt genau einmal, und `source.updated` hält die Verwendungen wie das Original in `changes.links` fest (beim Weg zusätzlich
 * `path.sources_changed` am Anker). Mehrere Träger in einer Operation: alle werden geprüft, alle geschrieben, oder keiner. Eine Operation, die einen Weg berührt, hat zwei Gegenstände (die Quelle und die
 * Straße) und ist darum ein Einzeleintrag (Fachvertrag B.2), nie Mitglied einer Serie.
 * 🔴 **Das Anlegen** (`source.create`, WI-0265 B8d): Zurück heißt stillgelegt (`aktiv: false`, über denselben Schreibweg), nie gelöscht; die Rücknahme dieser Rücknahme belebt wieder. Eine Serie darf mit dem
 * Anlegen beginnen (Felder und Verwendungen danach) und geht als Ganzes zurück: Die Verwendungen, die sie selbst anlegte, werden still gelegt; was die Felder danach schrieben, bleibt (ohne Belang für eine
 * stillgelegte Quelle). Hängt seither eine Verwendung an einem Träger, die die Serie nicht anlegte, lehnt die Vorprüfung ab (Konflikt `wert`, Schlüssel `inhalt_verwendet`, Feld `links`): Das Etikett
 * des Trägers und die Auskunft des Infopanels zitieren die Quelle. Import, Zurücksetzen der Testwelt (Grund `quelle`) und WikiSync (eigene Rücknahme) sind nie Mitglied.
 *
 * **Bedingung:** Revision und Werte stehen heute gleich wie nach dem letzten Mitglied (Kern: die Revision der Quelle; hier zusätzlich die Werte, damit der Konflikt die Felder nennt, und die
 * Regel des Korpus, die die Rücknahme nicht verletzen darf: Gibt der Korpus der Domain ein Feld vor, kehrt kein früherer Wert dorthin zurück). Eine Änderung am Korpus, die auf die Quellen
 * durchschrieb, schreibt keine Operation an der Quelle: Sie zeigt sich als Revision, die das Protokoll der Quelle nicht kennt (Konflikt `revision`).
 */

/** Die Felder, die `source.update` schreibt; ein anderes im Protokoll (`links`, `url`, `created`) nimmt die Rücknahme nicht zurück. */
const FELDER = [
    "title",
    "sourceType",
    "isOfficial",
    "attribution",
    "editorNote",
    "licenseStatement",
    "licenseKey",
    "active",
] as const;
type Feld = (typeof FELDER)[number];
const BEKANNT: ReadonlySet<string> = new Set<string>(FELDER);
/** Der Grund einer früheren Rücknahme steht im Protokoll, ist aber kein Feld der Quelle. */
const OHNE_FELD = "restoreReason";

/** Das Feld, in dem `source.update` die Verwendungen an Trägern festhält (`changes.links`): Es geht über den Kern der Quellen am Träger, nicht über die Felder der Quelle. */
const LINKS = "links";

/**
 * Die Aktionen, die `source.update` schreibt: `source.updated` für die Quelle und, wo die Änderung eine Straße berührt, `path.sources_changed` am Anker (dieselbe Information wie `links`, für den Verlauf des Wegs).
 * Mindestens ein `source.updated` gehört dazu.
 */
const istQuelleArt = (operation: string, aktionen: readonly string[]): boolean =>
    QUELLE_OPERATIONEN.has(operation) &&
    aktionen.length > 0 &&
    // Das Anlegen schreibt genau `source.created` (WI-0265 B8d).
    (aktionen.every((aktion) => aktion === "source.created") ||
        (aktionen.some((aktion) => aktion === "source.updated") &&
            aktionen.every((aktion) => aktion === "source.updated" || aktion === "path.sources_changed")));

interface QuelleIst {
    /** Die interne Nummer (die Prüfung der Korpus-Vorgabe liest die Quelle über sie). */
    id: string;
    revision: number;
    name: string;
    werte: Record<Feld, unknown>;
    zeile: {
        id: string;
        source_type: string;
        is_official: boolean;
        license_statement: string;
        license_key: string | null;
        attribution: string | null;
    };
}

interface QuelleZeile {
    public_id: string;
    id: string;
    revision: number;
    title: string;
    source_type: string;
    is_official: boolean;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
    editor_note: string | null;
    is_active: boolean;
}

/** Der heutige Stand der Quellen; was es nicht gibt, fehlt in der Antwort. */
async function leseIst(database: Queryable, ids: readonly string[]): Promise<Map<string, QuelleIst>> {
    if (ids.length === 0) return new Map();
    const zeilen = await database<QuelleZeile[]>`
        SELECT public_id::text AS public_id, id::text AS id, revision::int AS revision, title, source_type, is_official,
               license_statement, license_key, attribution, editor_note, is_active
          FROM feature_source WHERE public_id = ANY(${ids as string[]}::uuid[])
    `;
    return new Map(
        zeilen.map((zeile) => [
            zeile.public_id,
            {
                id: zeile.id,
                revision: zeile.revision,
                name: zeile.title,
                werte: {
                    title: zeile.title,
                    sourceType: zeile.source_type,
                    isOfficial: zeile.is_official,
                    attribution: zeile.attribution,
                    editorNote: zeile.editor_note,
                    licenseStatement: zeile.license_statement,
                    licenseKey: zeile.license_key,
                    active: zeile.is_active,
                },
                zeile: {
                    id: zeile.id,
                    source_type: zeile.source_type,
                    is_official: zeile.is_official,
                    license_statement: zeile.license_statement,
                    license_key: zeile.license_key,
                    attribution: zeile.attribution,
                },
            },
        ]),
    );
}

/** Die Felder, die heute anders stehen als nach dem letzten Mitglied (Namen des Protokolls). */
const abweichendeFelder = (plan: InhaltePlan, ist: QuelleIst): string[] =>
    [...plan.felder.values()]
        .filter((ziel) => BEKANNT.has(ziel.feld) && !gleichWert(ist.werte[ziel.feld as Feld], ziel.nachher))
        .map((ziel) => ziel.feld);

/** Die Felder der Quelle, wie `source.update` sie nimmt: der Wert VOR der Serie. Ein Wert, den kein Schreibweg setzen kann, hält die Rücknahme an. */
function felderAus(plan: InhaltePlan): InhalteQuelleFelder {
    const felder: { -readonly [K in keyof InhalteQuelleFelder]: InhalteQuelleFelder[K] } = {};
    for (const { feld, vorher } of zielFelder(plan).values()) {
        // Die Verwendungen gehen über den Kern der Quellen am Träger (`planAusQuelle`), nicht über die Felder der Quelle.
        if (feld === LINKS) continue;
        if (!BEKANNT.has(feld)) throw nichtRuecknehmbar("der Quelle", feld);
        switch (feld as Feld) {
            case "title":
                // Eine Quelle braucht einen Titel: War er vorher leer, gibt es nichts, wohin er zurückgehen könnte.
                if (typeof vorher !== "string" || vorher.trim() === "") throw nichtRuecknehmbar("der Quelle", feld);
                felder.title = vorher;
                break;
            case "sourceType":
                if (typeof vorher !== "string" || !(SOURCE_TYPES as readonly string[]).includes(vorher))
                    throw nichtRuecknehmbar("der Quelle", feld);
                felder.sourceType = vorher as (typeof SOURCE_TYPES)[number];
                break;
            case "isOfficial":
                if (typeof vorher !== "boolean") throw nichtRuecknehmbar("der Quelle", feld);
                felder.isOfficial = vorher;
                break;
            case "attribution":
            case "editorNote":
                if (vorher !== null && typeof vorher !== "string") throw nichtRuecknehmbar("der Quelle", feld);
                felder[feld as "attribution" | "editorNote"] = vorher;
                break;
            case "licenseStatement":
                if (typeof vorher !== "string" || !(INHALTE_LIZENZ_AUSSAGEN as readonly string[]).includes(vorher))
                    throw nichtRuecknehmbar("der Quelle", feld);
                felder.lizenzAussage = vorher as (typeof INHALTE_LIZENZ_AUSSAGEN)[number];
                break;
            case "licenseKey":
                if (vorher !== null && typeof vorher !== "string") throw nichtRuecknehmbar("der Quelle", feld);
                felder.lizenzKey = vorher;
                break;
            case "active":
                if (typeof vorher !== "boolean") throw nichtRuecknehmbar("der Quelle", feld);
                felder.aktiv = vorher;
                break;
        }
    }
    return felder;
}

/**
 * Die Arten der Träger, an denen heute eine Verwendung der Quelle hängt, die die Serie nicht anlegte (WI-0265 B8d, nur bei einer angelegten Quelle): jede aktive Verknüpfung, die der Plan der
 * Serie nicht als „danach aktiv“ nennt. Beim Weg zählt die ganze Straße (jeder ihrer Abschnitte trägt eine Zeile). Liest nur.
 */
async function fremdeVerwendungen(
    database: Queryable,
    quelleNummer: string,
    verwendungen: QuellenPlan,
): Promise<string[]> {
    const eigene = new Set<string>();
    for (const ziel of verwendungen.values()) {
        if (ziel.nachher.state !== "active") continue;
        if (ziel.kind !== "path") {
            eigene.add(`${ziel.kind}|${ziel.carrierId}`);
            continue;
        }
        const strasse = await readEditorPathStreet(database as Sql, ziel.carrierId);
        for (const abschnitt of strasse?.segments ?? []) eigene.add(`path|${abschnitt.id}`);
    }
    const fremd: string[] = [];
    for (const [art, tafeln] of Object.entries(TRAEGER)) {
        const zeilen = await database.unsafe<{ id: string }[]>(
            `SELECT c.public_id::text AS id FROM ${tafeln.link} l JOIN ${tafeln.carrier} c ON c.id = l.${tafeln.foreignKey}
              WHERE l.source_id = $1::bigint AND l.is_active AND l.state = 'active'`,
            [quelleNummer],
        );
        if (zeilen.some((zeile) => !eigene.has(`${art}|${zeile.id}`))) fremd.push(art);
    }
    return fremd;
}

/** Der Adapter der Quelle für `vorpruefen` (siehe Kopf der Datei). */
export const QUELLE_ADAPTER: RuecknahmeAdapter = {
    familie: "quelle",
    // Das Recht der Vorwärtsoperation: `source.update` verlangt `manage_sources` (`POST …/inhalte/quellen/:id/update`).
    recht: () => "manage_sources",
    pruefeArt: (operation, aktionen) =>
        istQuelleArt(operation, aktionen) ? { ok: true } : { ok: false, reason: "art" },
    pruefeListe(offen) {
        // Ein Mitglied, das mehr als die Felder und die Verwendungen der Quelle schreibt, nimmt die Rücknahme nicht mit; ganz oder gar nicht.
        const verworfen = new Map<string, "art">();
        for (const mitglied of offen)
            if (
                mitglied.gegenstaende.some(
                    (gegenstand) =>
                        gegenstand.action === "source.updated" &&
                        gegenstand.felder.some((feld) => feld !== OHNE_FELD && feld !== LINKS && !BEKANNT.has(feld)),
                )
            )
                verworfen.set(mitglied.operationId, "art");
        return verworfen;
    },
    async pruefeWerte(database, kontext): Promise<readonly VorKonflikt[]> {
        const eintraege = (
            await eintraegeNachKennung(
                database,
                kontext.offen.map((m) => m.operationId),
                { personId: kontext.leser.personId, nutzlast: "voll" },
            )
        ).entries.filter((eintrag) =>
            istQuelleArt(
                eintrag.operation,
                eintrag.objects.map((g) => g.action),
            ),
        );
        if (eintraege.length === 0) return [];
        const plan = planAusEintraegen(eintraege, "source");
        const ist = await leseIst(database, [...plan.keys()]);
        const konflikte: VorKonflikt[] = [];
        for (const [id, quelle] of plan) {
            const heute = ist.get(id);
            const name = quelle.name === undefined ? {} : { name: quelle.name };
            if (heute === undefined) {
                konflikte.push({ art: "geloescht", kind: "source", id, ...name });
                continue;
            }
            const abweichend = abweichendeFelder(quelle, heute);
            if (abweichend.length > 0) {
                konflikte.push({
                    art: "wert",
                    kind: "source",
                    id,
                    ...name,
                    currentRevision: heute.revision,
                    felder: abweichend,
                    abweichung: { was: "felder" },
                    detail: `Heute anders als nach dem letzten Schritt: ${abweichend.join(", ")}.`,
                });
                continue;
            }
            // Eine angelegte Quelle wird still gelegt: Hängt seither eine Verwendung an ihr, die die Serie nicht anlegte, bleibt sie, wie sie ist (WI-0265 B8d).
            if (
                quelle.angelegt &&
                (await fremdeVerwendungen(database, heute.id, planAusQuelle(eintraege))).length > 0
            ) {
                konflikte.push({
                    art: "wert",
                    kind: "source",
                    id,
                    ...name,
                    currentRevision: heute.revision,
                    felder: [LINKS],
                    abweichung: { was: "inhalt_verwendet" },
                    detail: "Seit dem Anlegen hängt eine Verwendung an einem Objekt an der Quelle.",
                });
                continue;
            }
            // Gibt der Korpus der Domain ein Feld vor, kehrt kein früherer Wert dorthin zurück (`source.update` lehnte es ab): der Konflikt nennt die Felder.
            try {
                await pruefeKorpusVorgabe(database, heute.zeile, felderAus(quelle));
            } catch (fehler) {
                if (!(fehler instanceof ApiError)) throw fehler;
                konflikte.push({
                    art: "wert",
                    kind: "source",
                    id,
                    ...name,
                    currentRevision: heute.revision,
                    felder: [...quelle.felder.keys()].filter((feld) => feld !== LINKS),
                    abweichung: { was: "felder" },
                    detail: fehler.message,
                });
            }
        }
        // Die Verwendungen an Trägern: Jede Verknüpfung steht heute so, wie die Serie sie hinterließ (auch eine, die jemand ohne Operation an der Quelle änderte), und ihr Ziel gibt es noch.
        const schon = new Set(konflikte.map((konflikt) => konflikt.id));
        const verwendungen = await pruefeQuellen(database, planAusQuelle(eintraege));
        konflikte.push(...konflikteAnDerQuelle(verwendungen).filter((konflikt) => !schon.has(konflikt.id)));
        return konflikte;
    },
};

const familieVon = (quelleId: string) =>
    inhalteFamilie(RUECKNAHME_QUELLE_OPERATION, `source:${quelleId}`, QUELLE_ADAPTER);

/** 404, wenn es die Quelle nicht gibt (die Route hängt an ihr). */
async function pruefeQuelle(database: Queryable, quelleId: string): Promise<void> {
    const [zeile] = await database<{ da: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM feature_source WHERE public_id = ${quelleId}::uuid) AS da
    `;
    if (zeile?.da !== true) throw new ApiError(404, "not_found", "Diese Quelle gibt es nicht.");
}

/** `POST …/inhalte/quellen/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauQuelle(
    database: Database,
    quelleId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    await pruefeQuelle(database, quelleId);
    return vorschauInhalte(database, familieVon(quelleId), "source", body, leser);
}

/**
 * `POST …/inhalte/quellen/:id/restore-series`: nimmt die Mitglieder (Felder und Verwendungen einer Serie von `source.update`) in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`). Hier steht, was die
 * Quelle ausmacht: die Sperre ihrer Zeile und der Träger ihrer Verwendungen und die Inverse über den Schreibweg von `source.update`.
 */
export async function ruecknehmenQuelle(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    quelleId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    await pruefeQuelle(database, quelleId);
    return ruecknehmenInhalte({
        database,
        actor,
        leser,
        familie: familieVon(quelleId),
        body,
        schreiben: {
            async sperreZeilen(tx, vorab) {
                // Die feste Folge wie `source.update`: erst die Quelle, dann die Träger ihrer Verwendungen (aufsteigend) und deren Zeilen.
                await tx`SELECT id FROM feature_source WHERE public_id = ${quelleId}::uuid ORDER BY id FOR UPDATE`;
                const eintraege = (
                    await eintraegeNachKennung(tx, vorab.offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries;
                await sperreQuellen(tx, planAusQuelle(eintraege));
            },
            async schreibe({ tx, offen, grund }: RuecknahmeSchreiben) {
                const eintraege = (
                    await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries.sort((a, b) => a.seq - b.seq);
                const quelle = planAusEintraegen(eintraege, "source").get(quelleId);
                if (quelle === undefined) throw nichtRuecknehmbar("der Quelle");
                const ist = (await leseIst(tx, [quelleId])).get(quelleId);
                if (ist === undefined) throw new ApiError(404, "not_found", "Diese Quelle gibt es nicht.");
                // Der Schreibweg von `source.update`, gegen die Revision, die wir eben unter der Sperre gelesen haben (die Vorprüfung ist gleich ausgefallen).
                // Die Verwendungen gehen direkt auf den Stand vor der Serie (Kern der Quellen am Träger), in derselben Transaktion und mit derselben einen Revision.
                const verwendungen = planAusQuelle(eintraege);
                const traeger: TraegerAenderung[] = [];
                const arbeit = await schreibeQuelleAendern(
                    tx,
                    quelleId,
                    { baseRevision: ist.revision, fields: felderAus(quelle) },
                    new Map(),
                    verwendungen.size === 0 ? undefined : exakteVerwendungen(verwendungen, traeger),
                );
                // Die Träger, deren Verwendung sich änderte, stehen auch in der Quittung: Ein offenes Fenster (Ort, Gebiet, Landschaft, Weg) liest seine Quellen danach neu.
                const affected = new Map<string, (typeof arbeit.receipt.affected)[number]>();
                for (const eines of [...arbeit.receipt.affected, ...traeger.flatMap((eines) => eines.affected)])
                    affected.set(`${eines.kind}:${eines.id}`, eines);
                return {
                    receipt: { ...arbeit.receipt, affected: [...affected.values()] },
                    summary: zusammenfassung("Quelle", ist.name, eintraege.length),
                    entries: arbeit.entries.map((eintrag) => mitGrund(eintrag, grund)),
                };
            },
        },
    });
}
