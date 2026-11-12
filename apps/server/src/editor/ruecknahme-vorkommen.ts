import {
    INHALTE_VORKOMMEN_ARTEN,
    type MapHistoryChange,
    type MapHistoryEntry,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { readLoreResolution } from "../migration/lore-import.ts";
import { beleben, stilllegen, type RegelProtokoll } from "../inhalte/vorkommen-regeln-schreiben.ts";
import {
    FELD_HERKUNFT,
    protokollOrt,
    protokollQuelle,
    schreibeEintragSpalten,
    schreibeTreffer,
    type LoreAufloesung,
    type OrtProtokoll,
    type OrtZeile,
    type QuelleProtokoll,
    type QuelleZeile,
    type Zeile,
} from "../inhalte/vorkommen-schreiben.ts";
import { eintraegeNachKennung } from "./history.ts";
import type { MapActor, MapAuditEntry, MapChange } from "./map-operation.ts";
import type { RuecknahmeSchreiben } from "./ruecknahme-ablauf.ts";
import { RUECKNAHME_VORKOMMEN_OPERATION, VORKOMMEN_OPERATIONEN } from "./ruecknahme-arten.ts";
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
    type FeldZiel,
} from "./ruecknahme-inhalte.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt, Vorpruefung } from "./ruecknahme.ts";

/**
 * Vorkommen zurücknehmen (WI-0265 B6g2; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` B.2, C.2, C.3, F.1, Gate 2 und 3; Testvertrag U4 bis U9): der Adapter des Eintrags
 * der Lore (Fenster „Inhalte bearbeiten“, Reiter „Vorkommen“) für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `lore.restore_series` (Quelle `restore`, `reverts` =
 * die offenen Mitglieder in Serienfolge; Ablauf, Fehler und Naht der Inhalte in `ruecknahme-ablauf.ts` und `ruecknahme-inhalte.ts`). Die Route hängt an EINEM Eintrag (`:id`); jedes Mitglied berührt ihn.
 *
 * 🔴 **Die Prüfung der Protokolleinträge (was hält genug fest?)** Ein Eintrag der Lore hat vier Teile, und `lore.update` hält jeden so fest, dass sein Stand VOR der Operation herstellbar ist:
 *
 * - **Die Felder** (`name`, `art`, `gruppe`, `lebensraum`, `synonyme`, `editorNote`, `active`): je Feld `{ before, after }`. Sie gehen auf den Wert VOR dem ersten Mitglied zurück, das sie berührt.
 * - **Die Ortszeilen** (`places`): je berührter Zeile vorher und nachher mit Nummer und Zustand (`active`, `retired`, `suppressed`). Eine Zeile wird nie gelöscht, nur still gelegt oder belebt; die Rücknahme
 *   setzt jede Zeile auf den Zustand, den sie VOR der Serie hatte. Eine Zeile, die die Serie anlegte (das Protokoll kennt sie nur nachher), wird still gelegt (`retired`), nie gelöscht. Wird eine Zeile
 *   wieder aktiv, rechnet die Rücknahme ihre Treffer neu (`lore_place_target`): derselbe Kern wie beim Hinzufügen und Zurückholen (`schreibeTreffer`).
 * - **Die Quellenverknüpfungen** (`sources`): je Quelle vorher und nachher mit Zustand und Angaben (Art des Belegs, Seiten, Notiz). Sie gehen genauso zurück; eine angelegte (`none` davor) wird still gelegt.
 * - **Die Regeln** (`rules`): Eine Regel hängt an ihrem Fingerabdruck und wird nie geändert, nur still gelegt oder belebt (`vorkommen-regeln-schreiben.ts`). Je berührter Regel steht ihr Zustand vorher und
 *   nachher im Protokoll; die Rücknahme setzt ihn zurück (`beleben`, `stilllegen`: derselbe Kern wie das Ersetzen und Entfernen). Eine Regel, die die Serie anlegte, wird still gelegt.
 *
 * Das reicht für ganz oder gar nichts. Was zurückgeht, ist damit vollständig; eine Rücknahme geht nie halb durch (Revision und Werte müssen stehen, wie die Serie sie hinterließ).
 *
 * 🔴 **Entscheidung zu `lore.rules_text`** („Regeln als Text“): EINE Operation über mehrere Einträge, mit Regeln und Quellen je Eintrag im selben Format wie `lore.update`. Nach Fachvertrag B.2 bildet
 * eine Operation mit mehreren Gegenständen keine Serie mit anderen, sondern steht als Einzeleintrag; die Rücknahme hängt an einem der Einträge (`:id`), prüft aber alle und schreibt alle (wie „Ort verschieben
 * samt Wegenden“), ganz oder gar nicht. **Rücknehmbar**, wo sie Regeln und Quellen an bestehenden Einträgen anlegte, und seit WI-0265 B8d auch, wo sie einen Eintrag anlegte (die Aktion `lore.created`
 * unter ihren Einträgen): Der angelegte Eintrag wird stillgelegt, seine Regeln und Quellen gehen auf den Zustand davor (still gelegt); die Rücknahme dieser Rücknahme belebt alles wieder.
 *
 * Was nur der WikiSync schreibt (Typ, Kontinent, Kurzbeschreibung, der Wiki-Stand, die Rolle einer Ortszeile, `lore.rules_wikisync`),
 * ist nie Mitglied (Grund `quelle`, aus der Liste); steht es doch an einem Mitglied, nimmt die Vorprüfung es nicht mit (`art`).
 *
 * 🔴 **Folgen wie beim Vorwärts-Schreiben:** `lore.update` löst außer den Treffern der Ortszeilen nichts aus. Es gibt keinen Auftrag, keine Ableitung und kein Ereignis `map.changed` (`inhalteOperation`); die
 * Leuchten und Flächen der Vorkommen (`vorkommen/regeln.ts`), der Suchindex (`search/vorkommen-index.ts`) und das Infopanel (`search/eintrag.ts`) folgen einem Stempel aus Zählung, höchster Nummer und jüngster
 * Änderung an Eintrag, Regeln, Ortszeilen und Treffern. Die Rücknahme setzt `updated_at` an jeder Zeile, die sie schreibt (Regeln: `stilllegen`/`beleben`; Zeilen: dieselben Anweisungen; Eintrag: der Auslöser
 * der Revision), und rechnet die Treffer jeder wieder aktiven Ortszeile neu, mit denselben Schreibfunktionen wie das Original. Damit ändert sich der Stempel; derselbe Weg, kein zweiter.
 *
 * 🔴 **Grenze der Genauigkeit:** Die Herkunft je Feld (`lore_entry_field_origin`) bleibt „manuell“ und der Eintrag (sowie jede geschriebene Zeile) `source_system = 'editor'`: Das Protokoll kennt die frühere
 * Herkunft nicht, und der Importschutz gilt für alles, was der Editor anfasst. Eine Zeile, die die Rücknahme still legt, trägt `retired_origin = editor` (wie beim Entfernen). Ein Eintrag, der vorher
 * wegen des Wikis `retired` war und im Editor belebt wurde, geht als `suppressed` zurück (das Protokoll führt `active` nur als Wahrheitswert).
 *
 * 🔴 **Das Anlegen** (`lore.create` und ein Eintrag, den „Regeln als Text“ anlegte; WI-0265 B8d): Zurück heißt stillgelegt (`active: false`, Zustand `suppressed`, Herkunft `editor`, wie das Entfernen im Editor),
 * nie gelöscht; die Rücknahme dieser Rücknahme belebt wieder. Die Regeln, Ortszeilen und Quellenverknüpfungen, die dieselbe Serie (oder dieselbe Operation) an dem Eintrag anlegte, gehen wie bei jeder Serie
 * auf den Zustand davor zurück, also still gelegt; die Felder, die das Anlegen und die Folgeänderungen schrieben, bleiben (ohne Belang für einen stillgelegten Eintrag). Das ersetzt die frühere Entscheidung,
 * das Anlegen sei `art`: Die Rücknahme zieht den Eintrag samt seinen Regeln still, und alles Stillgelegte lässt sich beleben. Hängt seither etwas am Eintrag, das die Serie nicht anlegte (eine aktive Ortszeile,
 * Quellenverknüpfung oder Regel, ein Wiki-Schlüssel), lehnt die Vorprüfung ab (Konflikt `wert`, Schlüssel `inhalt_verwendet`): Ein stillgelegter Eintrag mit fremden Regeln nähme sie mit aus der Suche.
 *
 * **Bedingung:** Revision des Eintrags und Werte stehen heute gleich wie nach dem letzten Mitglied (Kern: die Revision; hier zusätzlich die Werte der Felder und der Zeilen darunter, damit der Konflikt
 * nennt, was sich geändert hat, und eine Änderung ohne Operation – etwa eine Zeile, die der Zug neu setzte – nicht überschrieben wird).
 */

// --- Die Teile des Eintrags ------------------------------------------------------------------------------------------------

/** Die Felder des Eintrags, wie `lore.update` sie ins Protokoll schreibt; `restoreReason` ist kein Feld des Eintrags. */
const FELDER = ["name", "art", "gruppe", "lebensraum", "synonyme", "editorNote", "active"] as const;
type Feld = (typeof FELDER)[number];
/** Die Listen darunter: Ortszeilen, Quellenverknüpfungen, Regeln. */
const LISTEN = ["places", "sources", "rules"] as const;
const BEKANNT: ReadonlySet<string> = new Set<string>([...FELDER, ...LISTEN]);
const OHNE_FELD = "restoreReason";

/** Die Aktionen, die `lore.update` und `lore.rules_text` an bestehenden Einträgen schreiben, dazu das Anlegen `lore.created` (`lore.create`, ein Eintrag aus „Regeln als Text“; WI-0265 B8d). */
const AKTIONEN: ReadonlySet<string> = new Set(["lore.updated", "lore.rules_text", "lore.created"]);

const istVorkommenArt = (operation: string, aktionen: readonly string[]): boolean =>
    VORKOMMEN_OPERATIONEN.has(operation) && aktionen.length > 0 && aktionen.every((aktion) => AKTIONEN.has(aktion));

type Zustand = "active" | "retired" | "suppressed";
const ZUSTAENDE: ReadonlySet<string> = new Set<Zustand>(["active", "retired", "suppressed"]);

/** Was eine Zeile über die Serie hinweg erlebt hat: ihr Stand vor dem ersten Mitglied, das sie berührt (`undefined`: es gab sie nicht), und nach dem letzten. */
interface ZeilenZiel<T> {
    vorher: T | undefined;
    nachher: T;
}

/** Ein Eintrag der Lore, wie die Serie ihn berührt hat. */
export interface VorkommenPlan {
    name?: string;
    felder: Map<string, FeldZiel>;
    /** Ein Mitglied legte den Eintrag an (WI-0265 B8d): Zurück heißt stillgelegt, die übrigen Felder bleiben. */
    angelegt: boolean;
    /** Je Zeile der Ortsliste (Nummer der Zeile). */
    orte: Map<string, ZeilenZiel<OrtProtokoll>>;
    /** Je Quelle (öffentliche Kennung der Quelle). */
    quellen: Map<string, ZeilenZiel<QuelleProtokoll>>;
    /** Je Regel (Nummer der Regel). */
    regeln: Map<string, ZeilenZiel<RegelProtokoll>>;
}

const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);
const istText = (wert: unknown): wert is string => typeof wert === "string";
const istTextOderLeer = (wert: unknown): wert is string | null => wert === null || typeof wert === "string";

const istOrt = (wert: unknown): wert is OrtProtokoll =>
    istObjekt(wert) &&
    istText(wert["rowId"]) &&
    istTextOderLeer(wert["wikiKey"]) &&
    istTextOderLeer(wert["name"]) &&
    istText(wert["relation"]) &&
    istText(wert["state"]) &&
    ZUSTAENDE.has(wert["state"]);
const istQuelle = (wert: unknown): wert is QuelleProtokoll =>
    istObjekt(wert) &&
    istText(wert["sourceId"]) &&
    istText(wert["state"]) &&
    (wert["state"] === "none" || ZUSTAENDE.has(wert["state"])) &&
    istTextOderLeer(wert["referenceKind"]) &&
    istTextOderLeer(wert["pages"]) &&
    istTextOderLeer(wert["note"]);
const istRegel = (wert: unknown): wert is RegelProtokoll =>
    istObjekt(wert) &&
    istText(wert["ruleId"]) &&
    istText(wert["relation"]) &&
    istText(wert["ruleKey"]) &&
    istText(wert["state"]) &&
    ZUSTAENDE.has(wert["state"]) &&
    istText(wert["ursprung"]) &&
    Array.isArray(wert["bedingungen"]);

/**
 * Die Zeilen einer Liste (`places`, `sources`, `rules`) über die Mitglieder in Serienfolge: Der Stand vor dem ersten Mitglied, das die Zeile berührt, ist ihr `vorher` (fehlt er, gab es sie nicht),
 * der nach dem letzten ihr `nachher`. Das Protokoll führt je Operation nur die berührten Zeilen.
 */
function sammleZeilen<T>(
    ziel: Map<string, ZeilenZiel<T>>,
    wechsel: MapHistoryChange | undefined,
    schluessel: (zeile: T) => string,
    gueltig: (wert: unknown) => wert is T,
    feld: string,
): void {
    if (wechsel === undefined) return;
    if (wechsel.omitted === true) throw nichtRuecknehmbar("des Vorkommens", feld);
    const alsListe = (wert: unknown): T[] => {
        if (wert === undefined || wert === null) return [];
        if (!Array.isArray(wert) || !wert.every(gueltig)) throw nichtRuecknehmbar("des Vorkommens", feld);
        return wert as T[];
    };
    const davor = new Map(alsListe(wechsel.before).map((zeile) => [schluessel(zeile), zeile] as const));
    for (const zeile of alsListe(wechsel.after)) {
        const key = schluessel(zeile);
        const bisher = ziel.get(key);
        if (bisher === undefined) ziel.set(key, { vorher: davor.get(key), nachher: zeile });
        else bisher.nachher = zeile;
    }
}

/**
 * Der Plan der Rücknahme je Eintrag aus den Protokolleinträgen der Mitglieder (volle Nutzlast): die Felder (Wert vor dem ersten und nach dem letzten Mitglied, das sie berührt) und die Zeilen der drei
 * Listen. Der Grund einer früheren Rücknahme (`restoreReason`) ist kein Feld des Eintrags.
 */
export function planVorkommen(eintraege: readonly MapHistoryEntry[]): Map<string, VorkommenPlan> {
    const plan = new Map<string, VorkommenPlan>();
    for (const [id, eins] of planAusEintraegen(eintraege, "lore"))
        plan.set(id, {
            ...(eins.name !== undefined ? { name: eins.name } : {}),
            angelegt: eins.angelegt,
            felder: new Map([...eins.felder].filter(([feld]) => !(LISTEN as readonly string[]).includes(feld))),
            orte: new Map(),
            quellen: new Map(),
            regeln: new Map(),
        });
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== "lore") continue;
            const eins = plan.get(gegenstand.id);
            if (eins === undefined) continue;
            sammleZeilen(eins.orte, gegenstand.changes["places"], (z) => z.rowId, istOrt, "places");
            sammleZeilen(eins.quellen, gegenstand.changes["sources"], (z) => z.sourceId, istQuelle, "sources");
            sammleZeilen(eins.regeln, gegenstand.changes["rules"], (z) => z.ruleId, istRegel, "rules");
        }
    return plan;
}

/** Der Zustand, auf den eine Zeile zurückgeht: der vor der Serie; eine Zeile, die es vor ihr nicht gab, wird still gelegt (`retired`, nie gelöscht). */
const zielZustand = (vorher: { state: string } | undefined): Zustand =>
    vorher === undefined || vorher.state === "none" ? "retired" : (vorher.state as Zustand);

/** Die Werte der Felder, auf die der Eintrag zurückgeht; ein Wert, den kein Schreibweg setzen kann, hält die Rücknahme an (`not_revertable`). */
function pruefeFelder(plan: VorkommenPlan): void {
    for (const { feld, vorher } of zielFelder(plan).values()) {
        if (!BEKANNT.has(feld)) throw nichtRuecknehmbar("des Vorkommens", feld);
        switch (feld as Feld) {
            case "name":
                // Ein Eintrag braucht einen Namen: War er vorher leer, gibt es nichts, wohin er zurückgehen könnte.
                if (typeof vorher !== "string" || vorher.trim() === "") throw nichtRuecknehmbar("des Vorkommens", feld);
                break;
            case "art":
                if (typeof vorher !== "string" || !(INHALTE_VORKOMMEN_ARTEN as readonly string[]).includes(vorher))
                    throw nichtRuecknehmbar("des Vorkommens", feld);
                break;
            case "gruppe":
            case "lebensraum":
            case "synonyme":
            case "editorNote":
                if (vorher !== null && typeof vorher !== "string") throw nichtRuecknehmbar("des Vorkommens", feld);
                break;
            case "active":
                if (typeof vorher !== "boolean") throw nichtRuecknehmbar("des Vorkommens", feld);
                break;
        }
    }
}

// --- Der heutige Stand ------------------------------------------------------------------------------------------------------

interface EintragZeile {
    public_id: string;
    id: string;
    revision: number;
    wiki_key: string | null;
    name: string;
    kind: string;
    gruppe: string | null;
    lebensraum: string | null;
    synonyme: string | null;
    editor_note: string | null;
    is_active: boolean;
}

interface EintragIst {
    /** Die interne Nummer. */
    id: string;
    revision: number;
    name: string;
    werte: Record<Feld, unknown>;
}

type OrtIst = OrtZeile & { eintrag: string };
type QuelleIst = QuelleZeile & { eintrag: string; quelle: string };
interface RegelIst {
    id: string;
    eintrag: string;
    state: string;
    retired_origin: string | null;
}

interface Ist {
    eintraege: Map<string, EintragIst>;
    orte: Map<string, OrtIst>;
    /** Schlüssel: `<Eintrag>|<Quelle>` (öffentliche Kennungen). */
    quellen: Map<string, QuelleIst>;
    regeln: Map<string, RegelIst>;
}

const quellenSchluessel = (eintrag: string, quelle: string): string => `${eintrag}|${quelle}`;

/** Der heutige Stand der Einträge und der Zeilen, die der Plan nennt; was es nicht gibt, fehlt in der Antwort. */
async function leseIst(database: Queryable, plan: ReadonlyMap<string, VorkommenPlan>): Promise<Ist> {
    const ids = [...plan.keys()];
    const eintraege = new Map<string, EintragIst>();
    if (ids.length > 0)
        for (const zeile of await database<EintragZeile[]>`
            SELECT public_id::text AS public_id, id::text AS id, revision::int AS revision, wiki_key, name, kind, gruppe, lebensraum, synonyme, editor_note, is_active
              FROM lore_entry WHERE public_id = ANY(${ids}::uuid[])
        `)
            eintraege.set(zeile.public_id, {
                id: zeile.id,
                revision: zeile.revision,
                name: zeile.name,
                werte: {
                    name: zeile.name,
                    art: zeile.kind,
                    gruppe: zeile.gruppe,
                    lebensraum: zeile.lebensraum,
                    synonyme: zeile.synonyme,
                    editorNote: zeile.editor_note,
                    active: zeile.is_active,
                },
            });
    const orteIds = [...new Set([...plan.values()].flatMap((eins) => [...eins.orte.keys()]))];
    const orte = new Map<string, OrtIst>();
    if (orteIds.length > 0)
        for (const zeile of await database<(OrtZeile & { eintrag: string })[]>`
            SELECT p.id::text AS id, e.public_id::text AS eintrag, p.place_wiki_key, p.place_title, p.relation, p.state, p.is_active, p.source_system
              FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id WHERE p.id = ANY(${orteIds}::bigint[])
        `)
            orte.set(zeile.id, zeile);
    const quellenIds = [...new Set([...plan.values()].flatMap((eins) => [...eins.quellen.keys()]))];
    const quellen = new Map<string, QuelleIst>();
    if (quellenIds.length > 0)
        for (const zeile of await database<(QuelleZeile & { eintrag: string; quelle: string })[]>`
            SELECT s.id::text AS id, e.public_id::text AS eintrag, f.public_id::text AS quelle, s.state, s.is_active, s.reference_kind, s.pages, s.note, s.source_system
              FROM lore_entry_source s JOIN lore_entry e ON e.id = s.lore_entry_id JOIN feature_source f ON f.id = s.source_id
             WHERE e.public_id = ANY(${ids}::uuid[]) AND f.public_id = ANY(${quellenIds}::uuid[])
        `)
            quellen.set(quellenSchluessel(zeile.eintrag, zeile.quelle), zeile);
    const regelIds = [...new Set([...plan.values()].flatMap((eins) => [...eins.regeln.keys()]))];
    const regeln = new Map<string, RegelIst>();
    if (regelIds.length > 0)
        for (const zeile of await database<RegelIst[]>`
            SELECT r.id::text AS id, e.public_id::text AS eintrag, r.state, r.retired_origin
              FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE r.id = ANY(${regelIds}::bigint[])
        `)
            regeln.set(zeile.id, zeile);
    return { eintraege, orte, quellen, regeln };
}

/** Die Felder und Listen, die heute anders stehen als nach dem letzten Mitglied (Namen des Protokolls). */
function abweichendeTeile(id: string, plan: VorkommenPlan, ist: Ist, heute: EintragIst): string[] {
    const abweichend = new Set<string>();
    for (const ziel of plan.felder.values())
        if (BEKANNT.has(ziel.feld) && !gleichWert(heute.werte[ziel.feld as Feld], ziel.nachher))
            abweichend.add(ziel.feld);
    for (const [rowId, zeile] of plan.orte) {
        const da = ist.orte.get(rowId);
        if (da?.eintrag !== id || da.state !== zeile.nachher.state) abweichend.add("places");
    }
    for (const [quelle, zeile] of plan.quellen) {
        const da = ist.quellen.get(quellenSchluessel(id, quelle));
        if (
            da === undefined ||
            da.state !== zeile.nachher.state ||
            !gleichWert(da.reference_kind, zeile.nachher.referenceKind) ||
            !gleichWert(da.pages, zeile.nachher.pages) ||
            !gleichWert(da.note, zeile.nachher.note)
        )
            abweichend.add("sources");
    }
    for (const [ruleId, zeile] of plan.regeln) {
        const da = ist.regeln.get(ruleId);
        if (da?.eintrag !== id || da.state !== zeile.nachher.state) abweichend.add("rules");
    }
    return [...abweichend];
}

/**
 * Was an einem angelegten Eintrag hängt, das die Serie nicht anlegte (WI-0265 B8d): aktive Ortszeilen, Quellenverknüpfungen und Regeln, die der Plan nicht nennt, und ein Wiki-Schlüssel (ein im Editor
 * angelegter Eintrag hat keinen; der WikiSync vergibt ihn). Die Namen sind die Felder des Protokolls (`places`, `sources`, `rules`, `wiki`). Liest nur.
 */
async function fremdeTeile(database: Queryable, publicId: string, plan: VorkommenPlan): Promise<string[]> {
    const [zeile] = await database<
        { wiki_key: string | null; orte: string[] | null; quellen: string[] | null; regeln: string[] | null }[]
    >`
        SELECT e.wiki_key,
               (SELECT array_agg(p.id::text) FROM lore_place p WHERE p.lore_entry_id = e.id AND p.state = 'active') AS orte,
               (SELECT array_agg(f.public_id::text) FROM lore_entry_source s JOIN feature_source f ON f.id = s.source_id
                 WHERE s.lore_entry_id = e.id AND s.state = 'active') AS quellen,
               (SELECT array_agg(r.id::text) FROM lore_rule r WHERE r.lore_entry_id = e.id AND r.state = 'active') AS regeln
          FROM lore_entry e WHERE e.public_id = ${publicId}::uuid
    `;
    if (zeile === undefined) return [];
    const fremd: string[] = [];
    if ((zeile.orte ?? []).some((nummer) => !plan.orte.has(nummer))) fremd.push("places");
    if ((zeile.quellen ?? []).some((quelle) => !plan.quellen.has(quelle))) fremd.push("sources");
    if ((zeile.regeln ?? []).some((nummer) => !plan.regeln.has(nummer))) fremd.push("rules");
    if (zeile.wiki_key !== null) fremd.push("wiki");
    return fremd;
}

// --- Der Adapter ------------------------------------------------------------------------------------------------------------

/** Die Protokolleinträge der offenen Mitglieder, soweit sie zu diesem Adapter gehören, mit voller Nutzlast. */
async function ladeEintraege(
    database: Queryable,
    leser: RuecknahmeLeser,
    mitglieder: readonly string[],
): Promise<MapHistoryEntry[]> {
    return (
        await eintraegeNachKennung(database, [...mitglieder], { personId: leser.personId, nutzlast: "voll" })
    ).entries
        .filter((eintrag) =>
            istVorkommenArt(
                eintrag.operation,
                eintrag.objects.map((gegenstand) => gegenstand.action),
            ),
        )
        .sort((a, b) => a.seq - b.seq);
}

/** Der Adapter des Vorkommens für `vorpruefen` (siehe Kopf der Datei). */
export const VORKOMMEN_ADAPTER: RuecknahmeAdapter = {
    familie: "vorkommen",
    // Das Recht der Vorwärtsoperationen: `lore.update` und `lore.rules_text` verlangen `manage_sources` (`POST …/inhalte/vorkommen/:id/update`, `…/vorkommen-text/uebernehmen`).
    recht: () => "manage_sources",
    pruefeArt: (operation, aktionen) =>
        istVorkommenArt(operation, aktionen) ? { ok: true } : { ok: false, reason: "art" },
    pruefeListe(offen) {
        // Ein Mitglied, das mehr schreibt, als die Rücknahme versteht (Wiki-Stand, Typ, Kontinent …), nimmt sie nicht mit; ganz oder gar nicht.
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
        const eintraege = await ladeEintraege(
            database,
            kontext.leser,
            kontext.offen.map((m) => m.operationId),
        );
        if (eintraege.length === 0) return [];
        const plan = planVorkommen(eintraege);
        for (const eins of plan.values()) pruefeFelder(eins);
        const ist = await leseIst(database, plan);
        const konflikte: VorKonflikt[] = [];
        for (const [id, eins] of plan) {
            const heute = ist.eintraege.get(id);
            const name = eins.name === undefined ? {} : { name: eins.name };
            if (heute === undefined) {
                konflikte.push({ art: "geloescht", kind: "lore", id, ...name });
                continue;
            }
            const abweichend = abweichendeTeile(id, eins, ist, heute);
            if (abweichend.length > 0)
                konflikte.push({
                    art: "wert",
                    kind: "lore",
                    id,
                    ...name,
                    currentRevision: heute.revision,
                    felder: abweichend,
                    abweichung: { was: "felder" },
                    detail: `Heute anders als nach dem letzten Schritt: ${abweichend.join(", ")}.`,
                });
            else if (eins.angelegt) {
                const fremd = await fremdeTeile(database, id, eins);
                if (fremd.length > 0)
                    konflikte.push({
                        art: "wert",
                        kind: "lore",
                        id,
                        ...name,
                        currentRevision: heute.revision,
                        felder: fremd,
                        abweichung: { was: "inhalt_verwendet" },
                        detail: `Seit dem Anlegen hängt etwas am Eintrag: ${fremd.join(", ")}.`,
                    });
            }
        }
        return konflikte;
    },
};

// --- Schreiben ---------------------------------------------------------------------------------------------------------------

/** Setzt eine Ortszeile auf den Zustand (wie `lore.update` beim Entfernen und Zurückholen; eine stillgelegte trägt `retired_origin = editor`). */
async function setzeOrtZustand(tx: Sql, id: string, zustand: Zustand): Promise<void> {
    if (zustand === "active")
        await tx`
            UPDATE lore_place
               SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'editor', updated_at = now()
             WHERE id = ${id}::bigint
        `;
    else
        await tx`
            UPDATE lore_place
               SET state = ${zustand}, is_active = FALSE, retired_at = now(), retired_origin = 'editor', source_system = 'editor', updated_at = now()
             WHERE id = ${id}::bigint
        `;
}

/** Setzt eine Quellenverknüpfung auf Zustand und Angaben (`angaben` fehlt, wo nur der Zustand zurückgeht: eine Verknüpfung, die die Serie anlegte). */
async function setzeQuellenZustand(
    tx: Sql,
    id: string,
    zustand: Zustand,
    angaben: { referenceKind: string | null; pages: string | null; note: string | null } | undefined,
): Promise<void> {
    const mitAngaben =
        angaben === undefined
            ? tx``
            : tx`, reference_kind = ${angaben.referenceKind}, pages = ${angaben.pages}, note = ${angaben.note}`;
    if (zustand === "active")
        await tx`
            UPDATE lore_entry_source
               SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'editor', updated_at = now() ${mitAngaben}
             WHERE id = ${id}::bigint
        `;
    else
        await tx`
            UPDATE lore_entry_source
               SET state = ${zustand}, is_active = FALSE, retired_at = now(), retired_origin = 'editor', source_system = 'editor', updated_at = now() ${mitAngaben}
             WHERE id = ${id}::bigint
        `;
}

/**
 * Schreibt einen Eintrag auf den Stand vor der Serie: die Felder, dann die drei Listen. Gibt den Protokolleintrag und die neue Revision zurück, `undefined`, wo es nichts zu schreiben gab (der Stand war
 * schon der vom Anfang). Aufgerufen unter der Sperre des Eintrags und seiner Zeilen; die Werte hat die Vorprüfung eben geprüft.
 */
async function schreibeEintrag(
    tx: Sql,
    publicId: string,
    plan: VorkommenPlan,
    ist: Ist,
    lookups: () => Promise<LoreAufloesung>,
): Promise<{ entry: MapAuditEntry; revision: number } | undefined> {
    const heute = ist.eintraege.get(publicId);
    if (heute === undefined) throw new ApiError(404, "not_found", "Diesen Eintrag gibt es nicht.");
    const aenderungen: Record<string, MapChange> = {};

    // Die Felder des Eintrags: der Wert vor der Serie; `active` wie `lore.update` (Zustand, Zeitpunkt und Herkunft der Stilllegung gehören zusammen, `lore_entry_retired_consistent`).
    const setze: Zeile = {};
    const mitVermerk: string[] = [];
    for (const ziel of zielFelder(plan).values()) {
        const feld = ziel.feld as Feld;
        if (gleichWert(heute.werte[feld], ziel.vorher)) continue;
        switch (feld) {
            case "name":
                setze["name"] = ziel.vorher as string;
                break;
            case "art":
                setze["kind"] = ziel.vorher as string;
                break;
            case "gruppe":
            case "lebensraum":
            case "synonyme":
                setze[feld] = ziel.vorher as string | null;
                break;
            case "editorNote":
                setze["editor_note"] = ziel.vorher as string | null;
                break;
            case "active": {
                const aktiv = ziel.vorher as boolean;
                setze["is_active"] = aktiv;
                setze["state"] = aktiv ? "active" : "suppressed";
                setze["retired_at"] = aktiv ? null : new Date().toISOString();
                setze["retired_origin"] = aktiv ? null : "editor";
                break;
            }
        }
        const vermerk = FELD_HERKUNFT[feld];
        if (vermerk !== undefined) mitVermerk.push(vermerk);
        aenderungen[feld] = { before: heute.werte[feld], after: ziel.vorher };
    }

    // Die Ortszeilen: jede auf den Zustand vor der Serie; wird eine wieder aktiv, rechnet der Kern des Hinzufügens ihre Treffer neu.
    const orteVorher: OrtProtokoll[] = [];
    const orteNachher: OrtProtokoll[] = [];
    for (const [rowId, zeile] of plan.orte) {
        const da = ist.orte.get(rowId);
        // Jede Zeile muss zu diesem Eintrag gehören (die Vorprüfung hat es eben geprüft; hier gilt es noch einmal, bevor etwas geschrieben wird).
        if (da?.eintrag !== publicId) throw nichtRuecknehmbar("des Vorkommens", "places");
        const ziel = zielZustand(zeile.vorher);
        if (da.state === ziel) continue;
        await setzeOrtZustand(tx, da.id, ziel);
        if (ziel === "active" && da.place_wiki_key !== null)
            await schreibeTreffer(tx, da.id, da.place_wiki_key, lookups);
        orteVorher.push(protokollOrt(da));
        orteNachher.push(protokollOrt(da, ziel));
    }
    if (orteNachher.length > 0) aenderungen["places"] = { before: orteVorher, after: orteNachher };

    // Die Quellenverknüpfungen: Zustand und Angaben wie vor der Serie.
    const quellenVorher: QuelleProtokoll[] = [];
    const quellenNachher: QuelleProtokoll[] = [];
    for (const [quelle, zeile] of plan.quellen) {
        const da = ist.quellen.get(quellenSchluessel(publicId, quelle));
        if (da === undefined) throw nichtRuecknehmbar("des Vorkommens", "sources");
        const ziel = zielZustand(zeile.vorher);
        const davor = zeile.vorher !== undefined && zeile.vorher.state !== "none" ? zeile.vorher : undefined;
        const angaben =
            davor === undefined
                ? undefined
                : { referenceKind: davor.referenceKind, pages: davor.pages, note: davor.note };
        const gleich =
            da.state === ziel &&
            (angaben === undefined ||
                (gleichWert(da.reference_kind, angaben.referenceKind) &&
                    gleichWert(da.pages, angaben.pages) &&
                    gleichWert(da.note, angaben.note)));
        if (gleich) continue;
        await setzeQuellenZustand(tx, da.id, ziel, angaben);
        quellenVorher.push(protokollQuelle(quelle, da));
        quellenNachher.push(
            protokollQuelle(quelle, {
                state: ziel,
                reference_kind: angaben === undefined ? da.reference_kind : angaben.referenceKind,
                pages: angaben === undefined ? da.pages : angaben.pages,
                note: angaben === undefined ? da.note : angaben.note,
            }),
        );
    }
    if (quellenNachher.length > 0) aenderungen["sources"] = { before: quellenVorher, after: quellenNachher };

    // Die Regeln: jede auf den Zustand vor der Serie (belebt oder still gelegt, nie geändert oder gelöscht).
    const regelnVorher: RegelProtokoll[] = [];
    const regelnNachher: RegelProtokoll[] = [];
    for (const [ruleId, zeile] of plan.regeln) {
        const da = ist.regeln.get(ruleId);
        if (da?.eintrag !== publicId) throw nichtRuecknehmbar("des Vorkommens", "rules");
        const ziel = zielZustand(zeile.vorher);
        if (da.state === ziel) continue;
        if (ziel === "active") await beleben(tx, da);
        else await stilllegen(tx, da, ziel);
        regelnVorher.push({ ...zeile.nachher });
        regelnNachher.push({ ...zeile.nachher, state: ziel });
    }
    if (regelnNachher.length > 0) aenderungen["rules"] = { before: regelnVorher, after: regelnNachher };

    if (Object.keys(aenderungen).length === 0) return undefined;

    // Die Revision zählt genau einmal; jede Änderung außer den Regeln macht den Eintrag zu einem der Redaktion (Importschutz), eine reine Regeländerung nicht (wie `lore.update`).
    const redaktion = Object.keys(aenderungen).some((schluessel) => schluessel !== "rules");
    const revision = await schreibeEintragSpalten(tx, heute, setze, mitVermerk, redaktion);
    return {
        revision,
        entry: {
            action: "lore.updated",
            loreId: publicId,
            revisionBefore: heute.revision,
            revisionAfter: revision,
            changes: aenderungen,
        },
    };
}

// --- Die Routen --------------------------------------------------------------------------------------------------------------

const familieVon = (eintragId: string) =>
    inhalteFamilie(RUECKNAHME_VORKOMMEN_OPERATION, `lore:${eintragId}`, VORKOMMEN_ADAPTER);

/** 404, wenn es den Eintrag nicht gibt (die Route hängt an ihm). */
async function pruefeEintrag(database: Queryable, eintragId: string): Promise<void> {
    const [zeile] = await database<{ da: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM lore_entry WHERE public_id = ${eintragId}::uuid) AS da
    `;
    if (zeile?.da !== true) throw new ApiError(404, "not_found", "Diesen Eintrag gibt es nicht.");
}

/** `POST …/inhalte/vorkommen/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauVorkommen(
    database: Database,
    eintragId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    await pruefeEintrag(database, eintragId);
    return vorschauInhalte(database, familieVon(eintragId), "lore", body, leser);
}

/**
 * `POST …/inhalte/vorkommen/:id/restore-series`: nimmt die Mitglieder (Serie von `lore.update` und `lore.rules_text` an diesem Eintrag oder EINE Operation über mehrere Einträge) in EINER Operation zurück
 * (Ablauf: `fuehreRuecknahmeAus`). Hier steht, was das Vorkommen ausmacht: die Sperre des Eintrags und der Zeilen darunter (feste Reihenfolge: Einträge, Ortszeilen, Quellenverknüpfungen, Regeln) und die
 * Inverse über die Schreibfunktionen von `lore.update`.
 */
export async function ruecknehmenVorkommen(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    eintragId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    await pruefeEintrag(database, eintragId);
    return ruecknehmenInhalte({
        database,
        actor,
        leser,
        familie: familieVon(eintragId),
        body,
        schreiben: {
            async sperreZeilen(tx: Queryable, vorab: Vorpruefung) {
                const ids = vorab.gegenstaende.filter((g) => g.kind === "lore").map((g) => g.id);
                if (ids.length === 0) return;
                await tx`SELECT id FROM lore_entry WHERE public_id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
                const plan = planVorkommen(await ladeEintraege(tx, leser, vorab.offen));
                const orte = [...new Set([...plan.values()].flatMap((eins) => [...eins.orte.keys()]))];
                if (orte.length > 0)
                    await tx`SELECT id FROM lore_place WHERE id = ANY(${orte}::bigint[]) ORDER BY id FOR UPDATE`;
                const quellen = [...new Set([...plan.values()].flatMap((eins) => [...eins.quellen.keys()]))];
                if (quellen.length > 0)
                    await tx`
                        SELECT s.id FROM lore_entry_source s JOIN lore_entry e ON e.id = s.lore_entry_id JOIN feature_source f ON f.id = s.source_id
                         WHERE e.public_id = ANY(${ids}::uuid[]) AND f.public_id = ANY(${quellen}::uuid[]) ORDER BY s.id FOR UPDATE OF s
                    `;
                const regeln = [...new Set([...plan.values()].flatMap((eins) => [...eins.regeln.keys()]))];
                if (regeln.length > 0)
                    await tx`SELECT id FROM lore_rule WHERE id = ANY(${regeln}::bigint[]) ORDER BY id FOR UPDATE`;
            },
            async schreibe({ tx, offen, grund }: RuecknahmeSchreiben) {
                const eintraege = await ladeEintraege(tx, leser, offen);
                const plan = planVorkommen(eintraege);
                if (plan.size === 0) throw nichtRuecknehmbar("des Vorkommens");
                for (const eins of plan.values()) pruefeFelder(eins);
                const ist = await leseIst(tx, plan);
                // Derselbe Lookup wie im Import und beim Hinzufügen einer Ortszeile; er liest nur und steht außerhalb der Transaktion.
                let lookups: LoreAufloesung | undefined;
                const lookupsHolen = async (): Promise<LoreAufloesung> => {
                    lookups ??= await readLoreResolution(database);
                    return lookups;
                };
                // In der Folge der Nummern der Einträge, wie sie gesperrt sind.
                const reihenfolge = [...plan.keys()].sort(
                    (a, b) => Number(ist.eintraege.get(a)?.id ?? 0) - Number(ist.eintraege.get(b)?.id ?? 0),
                );
                const entries: MapAuditEntry[] = [];
                const affected: { kind: string; id: string; revision: number }[] = [];
                for (const id of reihenfolge) {
                    const geschrieben = await schreibeEintrag(tx, id, plan.get(id)!, ist, lookupsHolen);
                    if (geschrieben === undefined) {
                        const heute = ist.eintraege.get(id);
                        if (heute !== undefined) affected.push({ kind: "lore", id, revision: heute.revision });
                        continue;
                    }
                    entries.push(mitGrund(geschrieben.entry, grund));
                    affected.push({ kind: "lore", id, revision: geschrieben.revision });
                }
                const namen = reihenfolge.map((id) => plan.get(id)?.name ?? ist.eintraege.get(id)?.name ?? "");
                return {
                    receipt: { affected, derivedWork: [], warnings: [] },
                    summary:
                        reihenfolge.length === 1
                            ? zusammenfassung("Vorkommen", namen[0] ?? "", eintraege.length)
                            : `Vorkommen: ${String(reihenfolge.length)} Einträge, ${eintraege.length === 1 ? "Änderung" : `${String(eintraege.length)} Änderungen`} zurückgenommen`,
                    entries,
                };
            },
        },
    });
}
