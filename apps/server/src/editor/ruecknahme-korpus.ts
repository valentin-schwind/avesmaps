import {
    INHALTE_KORPUS_FORMEN,
    INHALTE_LIZENZ_AUSSAGEN,
    SOURCE_TYPES,
    type InhalteKorpusForm,
    type InhalteTraegerArt,
    type MapHistoryEntry,
    type OperationReceipt,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { pgArray } from "../migration/sync-table.ts";
import { aktualisiereKanon, type BeruehrteTraeger } from "../inhalte/kanon-folgen.ts";
import { quellenDerDomain, werteVon } from "../inhalte/korpora-lesen.ts";
import { PROTOKOLL_QUELLEN_MAX, traegerDerQuellen } from "../inhalte/korpora-schreiben.ts";
import { vorgabeVon, weichtAb, type KorpusAngaben, type QuellenWerte } from "../inhalte/korpora-vorgabe.ts";
import { eintraegeNachKennung } from "./history.ts";
import type { MapActor, MapAuditEntry, MapChange } from "./map-operation.ts";
import type { RuecknahmeSchreiben } from "./ruecknahme-ablauf.ts";
import { KORPUS_OPERATIONEN, RUECKNAHME_KORPUS_OPERATION } from "./ruecknahme-arten.ts";
import {
    gleichWert,
    inhalteFamilie,
    mitGrund,
    nichtRuecknehmbar,
    planAusEintraegen,
    ruecknehmenInhalte,
    vorschauInhalte,
    zusammenfassung,
    type InhaltePlan,
} from "./ruecknahme-inhalte.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt } from "./ruecknahme.ts";

/**
 * Korpora zurücknehmen (WI-0265 B6g1; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3, F.1, Gate 2 und 3; Testvertrag U4 bis U9): der Adapter des
 * Korpus für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `corpus.restore_series` (Quelle `restore`, `reverts` = die offenen Mitglieder in Serienfolge;
 * Ablauf, Fehler und Naht der Inhalte in `ruecknahme-ablauf.ts` und `ruecknahme-inhalte.ts`). Die Route hängt an EINEM Korpus (`:id`); jedes Mitglied berührt ihn.
 *
 * 🔴 **Was zurückgeht** (`corpus.update` und die Rücknahme selbst): Name, Anzeigeform, Art, „offiziell“, Lizenz (Aussage und Schlüssel), Namensnennung, Notiz UND die Wirkung auf die Quellen. Die
 * Änderung einer Belegstelle schrieb ihre Vorgabe auf alle Quellen der Domain durch; das Protokoll hält je geänderter Quelle die vier Felder samt Namensnennung vorher und nachher fest
 * (`quellen`, höchstens `PROTOKOLL_QUELLEN_MAX`). Die Rücknahme setzt die Angaben des Korpus UND diese Quellen auf den Stand davor, in EINER Operation: ganz oder gar nicht. Das Etikett der Träger
 * (Kanon) rechnet sie für die Quellen neu, deren Art oder „offiziell“ sich ändert, wie `corpus.update` es tat. Mehrere Mitglieder sind eine Arbeitsserie (derselbe Korpus, dieselbe Person):
 * je Feld und je Quelle der Wert VOR dem ersten Mitglied, das sie berührt.
 *
 * 🔴 **Entscheidung: Die Wirkung ist nur rücknehmbar, wo das Protokoll sie vollständig führt.** Hat die Änderung mehr als `PROTOKOLL_QUELLEN_MAX` Quellen berührt, nennt das Protokoll nur die Zahl;
 * dann ist die Wirkung nicht wiederherzustellen, und die Vorprüfung meldet einen Konflikt am Feld `quellen` (ehrlich, statt die Angaben ohne die Quellen zurückzunehmen: Das wäre eine halbe
 * Rücknahme). Dasselbe gilt, wenn eine Quelle der Wirkung heute nicht mehr so steht, wie die Änderung sie hinterließ (jemand hat sie seither geändert), und wenn die Rücknahme die Anzeigeform auf
 * Belegstelle zurücksetzt, während Quellen der Domain von der Vorgabe abweichen (das Durchschreiben schriebe Quellen, die das Protokoll nicht kennt).
 * 🔴 **Das Anlegen** (`corpus.create`, WI-0265 B8d): Zurück heißt stillgelegt (`is_active = false`, `retired_origin = editor`), nie gelöscht; die Rücknahme dieser Rücknahme belebt wieder. Der Korpus hat keinen
 * Schreibweg zum Stilllegen im Editor; die Rücknahme schreibt Zustand, Zeitpunkt und Herkunft zusammen (`source_corpus_retired_consistent`) und zählt die Revision. Was die Serie danach an Angaben schrieb,
 * geht auf den Stand beim Anlegen zurück (Anzeigeform leer, keine Vorgabe, Lizenz „nicht erfasst“): Ein stillgelegter Korpus mit einer Vorgabe schriebe sie weiter jeder neuen Quelle der Domain vor
 * (`legeQuelleAn`, `pruefeKorpusVorgabe` fragen nicht nach `is_active`). Die Wirkung auf die Quellen geht wie bei jeder Serie zurück. Die Quellen der Domain, die das Anlegen dem Korpus zuordnete
 * (`corpus_key`, allein aus der Adresse berechnet), behalten ihn: ohne Vorgabe ist das ohne Wirkung.
 * Import, Zurücksetzen der Testwelt (Grund `quelle`) und WikiSync (eigene Rücknahme) sind nie Mitglied.
 *
 * **Bedingung:** Revision und Werte stehen heute gleich wie nach dem letzten Mitglied (Kern: die Revision des Korpus; hier zusätzlich die Werte der Angaben und der Quellen der Wirkung).
 */

const FELDER = [
    "key",
    "label",
    "form",
    "sourceType",
    "isOfficial",
    "licenseStatement",
    "licenseKey",
    "attribution",
    "editorNote",
    "quellen",
    "active",
] as const;
type Feld = (typeof FELDER)[number];
/** Die Angaben, die eine Spalte des Korpus sind; `key` steht nur beim Anlegen im Protokoll, `active` ist der Zustand (WI-0265 B8d), `quellen` die Wirkung. */
type AngabenFeld = Exclude<Feld, "quellen" | "active" | "key">;
const BEKANNT: ReadonlySet<string> = new Set<string>(FELDER);
/** Der Grund einer früheren Rücknahme steht im Protokoll, ist aber kein Feld des Korpus. */
const OHNE_FELD = "restoreReason";

const SPALTE: Readonly<Record<AngabenFeld, string>> = {
    label: "label",
    form: "form",
    sourceType: "source_type",
    isOfficial: "is_official",
    licenseStatement: "license_statement",
    licenseKey: "license_key",
    attribution: "attribution",
    editorNote: "editor_note",
};
/** Die Felder, aus denen die Vorgabe des Korpus entsteht (`korpora-vorgabe.ts`). */
const VORGABE_FELDER: readonly string[] = [
    "form",
    "sourceType",
    "isOfficial",
    "licenseStatement",
    "licenseKey",
    "attribution",
];

/** `corpus.updated` ändert, `corpus.created` legt an (WI-0265 B8d). */
const FELDER_AKTIONEN: ReadonlySet<string> = new Set(["corpus.updated", "corpus.created"]);

/** Der Stand der Angaben beim Anlegen (`legeKorpusAn`: Spalten mit ihren Vorgaben); dorthin geht ein angelegter Korpus zurück. Der Name bleibt. */
const ANGELEGT_STAND: Readonly<Record<Exclude<AngabenFeld, "label">, unknown>> = {
    form: "",
    sourceType: null,
    isOfficial: null,
    licenseStatement: "unrecorded",
    licenseKey: null,
    attribution: null,
    editorNote: null,
};

const istFelderArt = (operation: string, aktionen: readonly string[]): boolean =>
    KORPUS_OPERATIONEN.has(operation) && aktionen.length > 0 && aktionen.every((aktion) => FELDER_AKTIONEN.has(aktion));

// --- Die Wirkung auf die Quellen -------------------------------------------------------------------------------------------

/** Die fünf Werte einer Quelle, die die Vorgabe berührt, in der Form, in der das Protokoll sie führt (ohne die Kennung). */
interface QuellenStand {
    sourceType: string;
    isOfficial: boolean;
    lizenzAussage: string;
    lizenzKey: string | null;
    attribution: string | null;
}
const QUELLEN_SCHLUESSEL = ["sourceType", "isOfficial", "lizenzAussage", "lizenzKey", "attribution"] as const;

interface QuellenZiel {
    /** Der Stand vor dem ersten Mitglied, das die Quelle berührt: dorthin geht die Rücknahme. */
    vorher: QuellenStand;
    /** Der Stand, den die Mitglieder zusammen hinterlassen haben (nur die Schlüssel, die sie gesetzt haben, über dem Stand davor). */
    erwartet: QuellenStand;
}

interface QuellenPlan {
    quellen: Map<string, QuellenZiel>;
    /** Das Protokoll nennt die Wirkung nur als Zahl (mehr als `PROTOKOLL_QUELLEN_MAX` Quellen) oder in einer Form, die die Rücknahme nicht kennt. */
    unvollstaendig: boolean;
}

const istStand = (wert: unknown): wert is Record<string, unknown> & { id: string } =>
    typeof wert === "object" && wert !== null && typeof (wert as { id?: unknown }).id === "string";

/** Die Wirkung auf die Quellen aus den Einträgen der Mitglieder des Korpus `korpusId`, älteste zuerst. */
function quellenPlanAus(eintraege: readonly MapHistoryEntry[], korpusId: string): QuellenPlan {
    const plan: QuellenPlan = { quellen: new Map(), unvollstaendig: false };
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== "corpus" || gegenstand.id !== korpusId) continue;
            const wechsel = gegenstand.changes["quellen"];
            if (wechsel === undefined) continue;
            if (!Array.isArray(wechsel.before) || !Array.isArray(wechsel.after)) {
                plan.unvollstaendig = true;
                continue;
            }
            for (const davor of wechsel.before as unknown[]) {
                if (!istStand(davor) || !QUELLEN_SCHLUESSEL.every((schluessel) => schluessel in davor)) {
                    plan.unvollstaendig = true;
                    continue;
                }
                const stand = Object.fromEntries(
                    QUELLEN_SCHLUESSEL.map((s) => [s, davor[s]]),
                ) as unknown as QuellenStand;
                const bisher = plan.quellen.get(davor.id);
                // Die erste Nennung gibt den Stand davor; die folgenden legen ihre gesetzten Schlüssel darüber.
                const grund = bisher?.erwartet ?? stand;
                const danach = (wechsel.after as unknown[]).find((eine) => istStand(eine) && eine.id === davor.id);
                const setzt = istStand(danach)
                    ? Object.fromEntries(QUELLEN_SCHLUESSEL.filter((s) => s in danach).map((s) => [s, danach[s]]))
                    : {};
                plan.quellen.set(davor.id, {
                    vorher: bisher?.vorher ?? stand,
                    erwartet: { ...grund, ...setzt } as QuellenStand,
                });
            }
        }
    return plan;
}

interface QuellenZeile {
    public_id: string;
    id: string;
    source_type: string;
    is_official: boolean;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
}

/** Der heutige Stand der Quellen der Wirkung (öffentliche Kennung → interne Nummer und Werte); was es nicht gibt, fehlt in der Antwort. */
async function leseQuellen(
    database: Queryable,
    ids: readonly string[],
    sperren = false,
): Promise<Map<string, { id: string; stand: QuellenStand }>> {
    if (ids.length === 0) return new Map();
    const zeilen = sperren
        ? await database<QuellenZeile[]>`
              SELECT public_id::text AS public_id, id::text AS id, source_type, is_official, license_statement, license_key, attribution
                FROM feature_source WHERE public_id = ANY(${ids as string[]}::uuid[]) ORDER BY id FOR UPDATE
          `
        : await database<QuellenZeile[]>`
              SELECT public_id::text AS public_id, id::text AS id, source_type, is_official, license_statement, license_key, attribution
                FROM feature_source WHERE public_id = ANY(${ids as string[]}::uuid[])
          `;
    return new Map(
        zeilen.map((zeile) => [
            zeile.public_id,
            {
                id: zeile.id,
                stand: {
                    sourceType: zeile.source_type,
                    isOfficial: zeile.is_official,
                    lizenzAussage: zeile.license_statement,
                    lizenzKey: zeile.license_key,
                    attribution: zeile.attribution,
                },
            },
        ]),
    );
}

// --- Der Korpus selbst -----------------------------------------------------------------------------------------------------

interface KorpusIst {
    revision: number;
    key: string;
    name: string;
    aktiv: boolean;
    werte: Record<AngabenFeld, unknown>;
}

interface KorpusZeile {
    public_id: string;
    corpus_key: string;
    revision: number;
    label: string;
    form: string;
    source_type: string | null;
    is_official: boolean | null;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
    editor_note: string | null;
    is_active: boolean;
}

/** Der heutige Stand der Korpora; was es nicht gibt, fehlt in der Antwort. */
async function leseIst(database: Queryable, ids: readonly string[]): Promise<Map<string, KorpusIst>> {
    if (ids.length === 0) return new Map();
    const zeilen = await database<KorpusZeile[]>`
        SELECT public_id::text AS public_id, corpus_key, revision::int AS revision, label, form, source_type, is_official,
               license_statement, license_key, attribution, editor_note, is_active
          FROM source_corpus WHERE public_id = ANY(${ids as string[]}::uuid[])
    `;
    return new Map(
        zeilen.map((zeile) => [
            zeile.public_id,
            {
                revision: zeile.revision,
                key: zeile.corpus_key,
                name: zeile.label.trim() === "" ? zeile.corpus_key : zeile.label,
                aktiv: zeile.is_active,
                werte: {
                    label: zeile.label,
                    form: zeile.form,
                    sourceType: zeile.source_type,
                    isOfficial: zeile.is_official,
                    licenseStatement: zeile.license_statement,
                    licenseKey: zeile.license_key,
                    attribution: zeile.attribution,
                    editorNote: zeile.editor_note,
                },
            },
        ]),
    );
}

/** Die Angaben, die heute anders stehen als nach dem letzten Mitglied (Namen des Protokolls); `quellen` prüft die Wirkung selbst. */
const abweichendeFelder = (plan: InhaltePlan, ist: KorpusIst): string[] =>
    [...plan.felder.values()]
        .filter(
            (ziel) =>
                BEKANNT.has(ziel.feld) &&
                ziel.feld !== "quellen" &&
                ziel.feld !== "key" &&
                (ziel.feld === "active"
                    ? ist.aktiv !== ziel.nachher
                    : !gleichWert(ist.werte[ziel.feld as AngabenFeld], ziel.nachher)),
        )
        .map((ziel) => ziel.feld);

/** Der Wert, den das Feld nach der Rücknahme hat; ein Wert, den kein Schreibweg setzen kann, hält die Rücknahme an. */
function zielWert(feld: AngabenFeld, vorher: unknown): unknown {
    switch (feld) {
        case "label":
            if (typeof vorher !== "string") break;
            return vorher;
        case "form":
            if (typeof vorher !== "string" || !(INHALTE_KORPUS_FORMEN as readonly string[]).includes(vorher)) break;
            return vorher;
        case "sourceType":
            if (
                vorher !== null &&
                (typeof vorher !== "string" || !(SOURCE_TYPES as readonly string[]).includes(vorher))
            )
                break;
            return vorher;
        case "isOfficial":
            if (vorher !== null && typeof vorher !== "boolean") break;
            return vorher;
        case "licenseStatement":
            if (typeof vorher !== "string" || !(INHALTE_LIZENZ_AUSSAGEN as readonly string[]).includes(vorher)) break;
            return vorher;
        case "licenseKey":
        case "attribution":
        case "editorNote":
            if (vorher !== null && typeof vorher !== "string") break;
            return vorher;
    }
    throw nichtRuecknehmbar("des Korpus", feld);
}

/** Der Wert, auf den eine Angabe des Korpus zurückgeht: der vor der Serie, bei einem angelegten Korpus der Stand beim Anlegen (`label` bleibt). */
function zielWertVon(plan: InhaltePlan, feld: AngabenFeld, vorher: unknown): unknown {
    return plan.angelegt && feld !== "label" ? ANGELEGT_STAND[feld] : zielWert(feld, vorher);
}

/** Die Angaben des Korpus nach der Rücknahme: die heutigen, mit den Werten davor darüber. */
function angabenNach(ist: KorpusIst, plan: InhaltePlan): KorpusAngaben {
    const wert = (feld: AngabenFeld): unknown => {
        const ziel = plan.felder.get(feld);
        return ziel === undefined ? ist.werte[feld] : zielWertVon(plan, feld, ziel.vorher);
    };
    const aussage = wert("licenseStatement") as string;
    return {
        form: wert("form") as InhalteKorpusForm,
        sourceType: wert("sourceType") as string | null,
        isOfficial: wert("isOfficial") as boolean | null,
        lizenzAussage: aussage,
        lizenzKey: aussage === "license" ? (wert("licenseKey") as string | null) : null,
        attribution: wert("attribution") as string | null,
    };
}

/** Der Adapter des Korpus für `vorpruefen` (siehe Kopf der Datei). */
export const KORPUS_ADAPTER: RuecknahmeAdapter = {
    familie: "korpus",
    // Das Recht der Vorwärtsoperation: `corpus.update` verlangt `manage_sources` (`POST …/inhalte/korpora/:id/update`).
    recht: () => "manage_sources",
    pruefeArt: (operation, aktionen) =>
        istFelderArt(operation, aktionen) ? { ok: true } : { ok: false, reason: "art" },
    pruefeListe(offen) {
        // Ein Mitglied mit einem Feld, das die Rücknahme nicht kennt (`key` steht nur beim Anlegen), nimmt sie nicht mit; ganz oder gar nicht.
        const verworfen = new Map<string, "art">();
        for (const mitglied of offen)
            if (
                mitglied.gegenstaende.some((gegenstand) =>
                    gegenstand.felder.some((feld) => feld !== OHNE_FELD && !BEKANNT.has(feld)),
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
            istFelderArt(
                eintrag.operation,
                eintrag.objects.map((g) => g.action),
            ),
        );
        if (eintraege.length === 0) return [];
        const plan = planAusEintraegen(eintraege, "corpus");
        const ist = await leseIst(database, [...plan.keys()]);
        const konflikte: VorKonflikt[] = [];
        for (const [id, korpus] of plan) {
            const heute = ist.get(id);
            const name = korpus.name === undefined ? {} : { name: korpus.name };
            // Ein Korpus, den die Serie stilllegte (die Rücknahme eines Anlegens), ist heute still und soll es sein; sonst gilt ein stiller Korpus als weg.
            if (heute === undefined || (!heute.aktiv && korpus.felder.get("active")?.nachher !== false)) {
                konflikte.push({ art: "geloescht", kind: "corpus", id, ...name });
                continue;
            }
            const wert = (felder: string[], satz: string): VorKonflikt => ({
                art: "wert",
                kind: "corpus",
                id,
                ...name,
                currentRevision: heute.revision,
                felder,
                abweichung: { was: "felder" },
                detail: satz,
            });
            const abweichend = abweichendeFelder(korpus, heute);
            if (abweichend.length > 0) {
                konflikte.push(
                    wert(abweichend, `Heute anders als nach dem letzten Schritt: ${abweichend.join(", ")}.`),
                );
                continue;
            }
            // Die Wirkung auf die Quellen: vollständig im Protokoll, und jede Quelle steht heute noch so, wie die Änderung sie hinterließ.
            const quellen = quellenPlanAus(eintraege, id);
            if (quellen.unvollstaendig) {
                konflikte.push(
                    wert(
                        ["quellen"],
                        `Das Protokoll nennt die Wirkung auf die Quellen nur als Zahl (mehr als ${String(PROTOKOLL_QUELLEN_MAX)}): Sie lässt sich nicht zurücknehmen.`,
                    ),
                );
                continue;
            }
            const heuteQuellen = await leseQuellen(database, [...quellen.quellen.keys()]);
            const abgewichen = [...quellen.quellen].filter(([quelle, ziel]) => {
                const jetzt = heuteQuellen.get(quelle)?.stand;
                return jetzt === undefined || !gleichWert(jetzt, ziel.erwartet);
            });
            if (abgewichen.length > 0) {
                konflikte.push(
                    wert(
                        ["quellen"],
                        `${String(abgewichen.length)} Quellen der Wirkung stehen heute anders als nach dem letzten Schritt.`,
                    ),
                );
                continue;
            }
            // Setzt die Rücknahme die Anzeigeform auf Belegstelle (oder ändert sie die Vorgabe einer Belegstelle), müssen die Quellen der Domain der Vorgabe folgen,
            // die danach gilt; sonst schriebe das Durchschreiben Quellen, die das Protokoll nicht kennt.
            if (VORGABE_FELDER.some((feld) => korpus.felder.has(feld))) {
                const nach = angabenNach(heute, korpus);
                if (nach.form === "belegstelle") {
                    const vorgabe = vorgabeVon(nach);
                    const abweichler = (await quellenDerDomain(database, heute.key)).filter((quelle) => {
                        const werte: QuellenWerte = quellen.quellen.get(quelle.public_id)?.vorher ?? werteVon(quelle);
                        return weichtAb(vorgabe, werte).length > 0;
                    });
                    if (abweichler.length > 0)
                        konflikte.push(
                            wert(
                                ["quellen"],
                                `${String(abweichler.length)} Quellen der Domain weichen von der Vorgabe ab, die nach der Rücknahme gilt.`,
                            ),
                        );
                }
            }
        }
        return konflikte;
    },
};

const familieVon = (korpusId: string) =>
    inhalteFamilie(RUECKNAHME_KORPUS_OPERATION, `corpus:${korpusId}`, KORPUS_ADAPTER);

/** 404, wenn es den Korpus nicht gibt (die Route hängt an ihm). */
async function pruefeKorpus(database: Queryable, korpusId: string): Promise<void> {
    const [zeile] = await database<{ da: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM source_corpus WHERE public_id = ${korpusId}::uuid) AS da
    `;
    if (zeile?.da !== true) throw new ApiError(404, "not_found", "Diesen Korpus gibt es nicht.");
}

/** `POST …/inhalte/korpora/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauKorpus(
    database: Database,
    korpusId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    await pruefeKorpus(database, korpusId);
    return vorschauInhalte(database, familieVon(korpusId), "corpus", body, leser);
}

/**
 * `POST …/inhalte/korpora/:id/restore-series`: nimmt die Mitglieder (Angaben und Wirkung einer Serie von `corpus.update`) in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`). Hier steht,
 * was der Korpus ausmacht: die Sperre seiner Zeile und der Quellen der Wirkung (in fester Reihenfolge) und die Inverse.
 */
export async function ruecknehmenKorpus(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    korpusId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    await pruefeKorpus(database, korpusId);
    const lade = async (tx: Queryable, offen: readonly string[]) =>
        (await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })).entries.sort(
            (a, b) => a.seq - b.seq,
        );
    return ruecknehmenInhalte({
        database,
        actor,
        leser,
        familie: familieVon(korpusId),
        body,
        schreiben: {
            // Erst der Korpus, dann die Quellen der Wirkung (wie `corpus.update`), damit zwei Rücknahmen sich nicht verklemmen.
            async sperreZeilen(tx, vorab) {
                await tx`SELECT corpus_key FROM source_corpus WHERE public_id = ${korpusId}::uuid FOR UPDATE`;
                const quellen = quellenPlanAus(await lade(tx, vorab.offen), korpusId);
                await leseQuellen(tx, [...quellen.quellen.keys()], true);
            },
            async schreibe({ tx, offen, grund }: RuecknahmeSchreiben) {
                const eintraege = await lade(tx, offen);
                const plan = planAusEintraegen(eintraege, "corpus").get(korpusId);
                if (plan === undefined) throw nichtRuecknehmbar("des Korpus");
                const ist = (await leseIst(tx, [korpusId])).get(korpusId);
                // Ein stiller Korpus lässt sich nur beleben (die Rücknahme der Rücknahme eines Anlegens).
                if (ist === undefined || (!ist.aktiv && plan.felder.get("active")?.vorher !== true))
                    throw new ApiError(404, "not_found", "Diesen Korpus gibt es nicht.");
                const quellenPlan = quellenPlanAus(eintraege, korpusId);
                if (quellenPlan.unvollstaendig) throw nichtRuecknehmbar("des Korpus", "quellen");

                // Die Angaben: je Feld der Wert vor der Serie, soweit er sich vom heutigen unterscheidet.
                const aenderungen: Record<string, MapChange> = {};
                const spalten: [string, unknown][] = [];
                for (const { feld, vorher } of plan.felder.values()) {
                    if (!BEKANNT.has(feld)) throw nichtRuecknehmbar("des Korpus", feld);
                    if (feld === "quellen" || feld === "key") continue;
                    if (feld === "active") {
                        // Stilllegen und Beleben schreiben Zustand, Zeitpunkt und Herkunft zusammen (CHECK `source_corpus_retired_consistent`).
                        if (typeof vorher !== "boolean") throw nichtRuecknehmbar("des Korpus", feld);
                        if (ist.aktiv === vorher) continue;
                        spalten.push(["is_active", vorher]);
                        spalten.push(["retired_at", vorher ? null : new Date().toISOString()]);
                        spalten.push(["retired_origin", vorher ? null : "editor"]);
                        aenderungen["active"] = { before: ist.aktiv, after: vorher };
                        continue;
                    }
                    const ziel = zielWertVon(plan, feld as AngabenFeld, vorher);
                    const heute = ist.werte[feld as AngabenFeld];
                    if (gleichWert(heute, ziel)) continue;
                    spalten.push([SPALTE[feld as AngabenFeld], ziel]);
                    aenderungen[feld] = { before: heute, after: ziel };
                }

                // Die Quellen der Wirkung: auf den Stand davor, soweit sie davon abweichen.
                const heuteQuellen = await leseQuellen(tx, [...quellenPlan.quellen.keys()]);
                const zurueck = [...quellenPlan.quellen]
                    .map(([publicId, ziel]) => ({ publicId, ziel, jetzt: heuteQuellen.get(publicId) }))
                    .filter(
                        (eine): eine is typeof eine & { jetzt: NonNullable<typeof eine.jetzt> } =>
                            eine.jetzt !== undefined && !gleichWert(eine.jetzt.stand, eine.ziel.vorher),
                    )
                    .sort((a, b) => (a.publicId < b.publicId ? -1 : 1));
                const quellenRevision = new Map<string, number>();
                if (zurueck.length > 0) {
                    const zeilen = await tx.unsafe<{ public_id: string; revision: number }[]>(
                        `UPDATE feature_source f SET source_type = t.st, is_official = t.io, license_statement = t.ls, license_key = t.lk, attribution = t.at
                           FROM unnest($1::uuid[], $2::text[], $3::boolean[], $4::text[], $5::text[], $6::text[]) AS t(id, st, io, ls, lk, at)
                          WHERE f.public_id = t.id
                          RETURNING f.public_id::text AS public_id, f.revision::int AS revision`,
                        // Feldliterale statt JS-Arrays: Der Treiber leitet den Feldtyp aus dem ersten Element ab und scheitert an Wahrheitswerten.
                        [
                            pgArray(zurueck.map((eine) => eine.publicId)),
                            pgArray(zurueck.map((eine) => eine.ziel.vorher.sourceType)),
                            pgArray(zurueck.map((eine) => eine.ziel.vorher.isOfficial)),
                            pgArray(zurueck.map((eine) => eine.ziel.vorher.lizenzAussage)),
                            pgArray(zurueck.map((eine) => eine.ziel.vorher.lizenzKey)),
                            pgArray(zurueck.map((eine) => eine.ziel.vorher.attribution)),
                        ] as never[],
                    );
                    for (const zeile of zeilen) quellenRevision.set(zeile.public_id, zeile.revision);
                    // Das Protokoll hält die Wirkung wie `corpus.update` fest: vorher und nachher je Quelle (ein Rücknehmen der Rücknahme liest sie genauso).
                    aenderungen["quellen"] = {
                        before: zurueck.map((eine) => ({ id: eine.publicId, ...eine.jetzt.stand })),
                        after: zurueck.map((eine) => ({ id: eine.publicId, ...eine.ziel.vorher })),
                    };
                }

                if (Object.keys(aenderungen).length === 0) {
                    // Der Stand war schon der vom Anfang: keine Revision, kein Protokolleintrag; die Verknüpfung zu den Originalen schreibt die Naht trotzdem.
                    return {
                        receipt: {
                            affected: [{ kind: "corpus", id: korpusId, revision: ist.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        summary: zusammenfassung("Korpus", ist.name, eintraege.length),
                        entries: [],
                    };
                }

                // Jede Änderung macht den Korpus zu einem der Redaktion (Importschutz), wie bei `corpus.update`.
                const zuweisungen = spalten.map(([spalte], index) => `${spalte} = $${String(index + 3)}`);
                zuweisungen.push("source_system = 'editor'");
                const [neu] = await tx.unsafe<{ revision: number }[]>(
                    `UPDATE source_corpus SET ${[...zuweisungen, "revision = $2::bigint"].join(", ")}
                      WHERE corpus_key = $1 RETURNING revision::int AS revision`,
                    [ist.key, ist.revision + 1, ...spalten.map(([, wert]) => wert)] as never[],
                );
                const revision = neu!.revision;

                // Art und „offiziell“ ändern die Auskunft ALLER Träger dieser Quellen (Rang 2 und 3 der Kanon-Regel): ihr Etikett neu rechnen.
                const traeger: Partial<Record<InhalteTraegerArt, Set<string>>> = {};
                const kanonQuellen = zurueck
                    .filter(
                        (eine) =>
                            eine.jetzt.stand.sourceType !== eine.ziel.vorher.sourceType ||
                            eine.jetzt.stand.isOfficial !== eine.ziel.vorher.isOfficial,
                    )
                    .map((eine) => eine.jetzt.id);
                await traegerDerQuellen(tx, kanonQuellen, traeger);
                await aktualisiereKanon(tx, traeger as BeruehrteTraeger);

                const eintrag: MapAuditEntry = {
                    action: "corpus.updated",
                    corpusId: korpusId,
                    revisionBefore: ist.revision,
                    revisionAfter: revision,
                    changes: aenderungen,
                };
                const affected: OperationReceipt["affected"] = [
                    { kind: "corpus", id: korpusId, revision },
                    ...zurueck.map((eine) => ({
                        kind: "source",
                        id: eine.publicId,
                        revision: quellenRevision.get(eine.publicId) ?? 0,
                    })),
                ];
                return {
                    receipt: { affected, derivedWork: [], warnings: [] },
                    summary:
                        zurueck.length > 0
                            ? `${zusammenfassung("Korpus", ist.name, eintraege.length)}, ${String(zurueck.length)} Quellen`
                            : zusammenfassung("Korpus", ist.name, eintraege.length),
                    entries: [mitGrund(eintrag, grund)],
                };
            },
        },
    });
}
