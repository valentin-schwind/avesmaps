import { createHash } from "node:crypto";
import type { MapHistoryObjectKind } from "@avesmaps3d/shared";
import type postgres from "postgres";
import type { Queryable } from "../database.ts";
import { EINZEL_OPERATIONEN, istRuecknehmbareOperation } from "./ruecknahme-arten.ts";

/**
 * Arbeitsserien (WI-0265 B2a; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` B, Gate 1 „fein“, abgenommen 2026-10-31).
 *
 * Eine Arbeitsserie ist eine **Lesesicht**: Sie wird bei jedem Lesen aus `map_operation` und `map_audit_event` berechnet und nirgends gespeichert (keine Tabelle,
 * keine Spalte). Falsch gebildet kann sie nichts beschädigen, weil jede Rücknahme ihre Mitglieder ausdrücklich nennt und der Server jedes einzeln prüft
 * (`ruecknahme.ts`).
 *
 * **Die Regel** (V3, „Scope plus Zeit“):
 *
 * - Mitglied ist eine Operation mit `source = 'editor'`, einer Person als Handelndem und GENAU EINEM Gegenstand (Scope, B.2); eine Operation mit mehreren
 *   Gegenständen (Ort verschieben samt Wegenden, Zusammenführen) ist ein Einzeleintrag, nie Mitglied, und beendet die Serien jedes ihrer Gegenstände.
 *   Ebenso nie Mitglied: Anlegen (`*.create`), das keine Familie zurücknimmt (der Katalog `ruecknahme-arten.ts` entscheidet; Gebiet, Kraftlinie, Ort und Weg sind seit WI-0265 B8a/B8b Mitglied und
 *   dürfen eine Serie beginnen), Import, WikiSync, Rücknahmen, Zurücksetzen der Testwelt.
 * - Zwei Mitglieder gehören zusammen, wenn sie unmittelbar aufeinander folgen AM SELBEN GEGENSTAND (jede Operation, die ihn berührt, zählt, gleich von wem),
 *   von derselben Person sind und höchstens `SERIEN_PAUSE_MIN` Minuten auseinander liegen. Eine fremde Operation am Gegenstand, eine Rücknahme, ein Import oder
 *   ein Mehr-Gegenstand-Eintrag dazwischen beendet die Serie. Eine Operation der Person an einem ANDEREN Gegenstand tut es nicht (B.3: „A bearbeitet erst einen Weg,
 *   dann das Gebirge: zwei Scopes, zwei Einträge“).
 * - Höchstens `SERIEN_MAX_MITGLIEDER` Mitglieder, vom ältesten an gezählt; danach beginnt die nächste Serie. So bleibt die Kennung (die `operationId` des
 *   ÄLTESTEN Mitglieds) beim Wachsen nach vorn gleich.
 * - Eine Serie hat mindestens zwei Mitglieder; eine einzelne Operation ist keine.
 *
 * **Scope je Objektfamilie** (B.2, aus den Zielspalten des Protokolls): Fläche/Gebirge samt Teilflächen und Beschriftungen `region_public_id`, Herrschaftsgebiet
 * samt Flächen `territory_public_id`, Sprache samt Teilflächen `sprache_public_id`, sonst das Objekt selbst. 🪤 Abweichungen vom Fachvertrag, die B6 (Breite)
 * schließt: Ein Weg ist hier sein Abschnitt (`path_public_id`), nicht der Anker der Straße; eine Operation über mehrere Abschnitte ist also ein Einzeleintrag.
 * Ein Gipfel ist sein eigener Scope (sein Protokolleintrag nennt die Fläche nicht). Eine Kraftlinie ist ihr Abschnitt.
 *
 * Die Pause ist nicht festgesetzt, sondern ein Startwert (30 Minuten) und wird nach der Messung (Fachvertrag E.1) neu gesetzt: darum EINE benannte Konstante.
 */

/** Die Pause zwischen zwei Mitgliedern in Minuten (Gate 1: 30; nach Messung änderbar). */
export const SERIEN_PAUSE_MIN = 30;
export const SERIEN_PAUSE_MS = SERIEN_PAUSE_MIN * 60_000;
/** Eine Serie ist höchstens so lang (Fachvertrag B.1); danach beginnt „Serie 2“. */
export const SERIEN_MAX_MITGLIEDER = 100;

/**
 * Die Zielspalten von `map_audit_event` und die Art, die sie benennen, in der Reihenfolge, in der sie den Scope bestimmen: Die Teilfläche und die Beschriftung tragen
 * ihre Fläche mit (`region_public_id`), eine Fläche des Gebiets ihr Gebiet, eine der Sprache ihre Sprache; die Fläche geht vor.
 */
export const ZIEL_ARTEN = [
    { art: "landscape", spalte: "region_public_id" },
    { art: "territory", spalte: "territory_public_id" },
    { art: "sprache", spalte: "sprache_public_id" },
    { art: "place", spalte: "place_public_id" },
    { art: "path", spalte: "path_public_id" },
    { art: "powerline", spalte: "powerline_public_id" },
    { art: "nodix", spalte: "nodix_public_id" },
    { art: "peak", spalte: "peak_public_id" },
    { art: "source", spalte: "source_public_id" },
    { art: "work", spalte: "work_public_id" },
    { art: "lore", spalte: "lore_public_id" },
    { art: "corpus", spalte: "corpus_public_id" },
    { art: "sprache_artikel", spalte: "sprache_artikel_public_id" },
    // Nur, wenn die Elternfläche fehlt (so schreibt es heute kein Schreibweg); der Vollständigkeit halber.
    { art: "area", spalte: "region_area_public_id" },
    { art: "label", spalte: "map_label_public_id" },
    { art: "territory_area", spalte: "territory_area_public_id" },
    { art: "sprache_flaeche", spalte: "sprache_flaeche_public_id" },
] as const satisfies readonly { art: MapHistoryObjectKind; spalte: string }[];

export type ZielSpalte = (typeof ZIEL_ARTEN)[number]["spalte"];
/** Die Zielspalten EINES Protokolleintrags (nur Text; die Spalte, die er nicht nennt, ist `null`). */
export type ZielZeile = Readonly<Record<ZielSpalte, string | null>>;

/** Der Schlüssel des Gegenstands eines Protokolleintrags (`<art>:<kennung>`), oder `undefined`, wenn der Eintrag keinen nennt. */
export function scopeSchluessel(ziel: Readonly<Partial<Record<ZielSpalte, string | null>>>): string | undefined {
    for (const { art, spalte } of ZIEL_ARTEN) {
        const id = ziel[spalte];
        if (id !== null && id !== undefined) return `${art}:${id}`;
    }
    return undefined;
}

/** Die Gegenstände einer Operation: die verschiedenen Schlüssel ihrer Protokolleinträge, sortiert. */
export function scopesVon(ziele: readonly Readonly<Partial<Record<ZielSpalte, string | null>>>[]): string[] {
    const schluessel = new Set<string>();
    for (const ziel of ziele) {
        const eins = scopeSchluessel(ziel);
        if (eins !== undefined) schluessel.add(eins);
    }
    return [...schluessel].sort();
}

/** Eine Operation, wie die Serienbildung sie braucht. */
export interface SerienOperation {
    operationId: string;
    seq: number;
    /** `at` in Millisekunden. */
    atMs: number;
    source: string;
    /** Die benannte Operation, etwa `place.update`. */
    action: string;
    /** Die Person; `null` bei Agent, Kommandozeile und System. */
    personId: string | null;
    /** Die Gegenstände, die ihr Protokoll nennt (`scopesVon`). */
    scopes: readonly string[];
}

/**
 * Anlegen gehört zu keiner Serie, solange es nicht rücknehmbar ist (Fachvertrag A.3, Grund `art`). Eine Anlage, die der Katalog (`ruecknahme-arten.ts`) führt (WI-0265 B8a: Ort und Weg; B8b: Gebiet, Fläche
 * des Gebiets, Kraftlinie, Kraftlinienpunkt; B8c: Fläche, Beschriftung, Gipfel und Landmarke, Sprache und Teilfläche der Sprache, Kopie einer Fläche in eine Sprache), ist Mitglied wie jede Änderung: Eine Serie aus
 * Anlegen und den folgenden Änderungen derselben Person geht als Ganzes zurück (die Anlage wird stillgelegt).
 */
const ANLEGEN = /\.create(?:_[a-z]+)?$/u;

/**
 * Ob eine Operation nach Quelle, Handelndem und Aktion Mitglied einer Arbeitsserie sein kann. Das entscheidet vor dem Lesen ihrer Protokolleinträge: Von einer
 * Operation, die es nicht sein kann (ein Import mit Tausenden Einträgen), braucht die Serienbildung nur zu wissen, DASS sie einen Gegenstand berührt.
 */
export const koenntMitgliedSein = (op: Pick<SerienOperation, "source" | "personId" | "action">): boolean =>
    op.source === "editor" &&
    op.personId !== null &&
    !EINZEL_OPERATIONEN.has(op.action) &&
    (!ANLEGEN.test(op.action) || istRuecknehmbareOperation(op.action));

/** Ob die Operation Mitglied einer Arbeitsserie sein kann: dazu GENAU ein Gegenstand. */
export const istGruppierbar = (op: SerienOperation): boolean => koenntMitgliedSein(op) && op.scopes.length === 1;

/**
 * Die Ketten einer Zeitleiste: `zeitleiste` sind ALLE Operationen, die EINEN Gegenstand berühren (gleich von wem und welcher Quelle), aufsteigend nach `seq`.
 * Zurück kommen die Ketten mit mindestens zwei Mitgliedern, ältestes zuerst. Rein; die Regel steht im Kopf des Moduls.
 */
export function bildeSerien(
    zeitleiste: readonly SerienOperation[],
    pauseMs: number = SERIEN_PAUSE_MS,
): SerienOperation[][] {
    const ketten: SerienOperation[][] = [];
    let aktuelle: SerienOperation[] = [];
    const schliesse = (): void => {
        if (aktuelle.length >= 2) ketten.push(aktuelle);
        aktuelle = [];
    };
    for (const op of zeitleiste) {
        if (!istGruppierbar(op)) {
            schliesse();
            continue;
        }
        const letzte = aktuelle.at(-1);
        if (
            letzte !== undefined &&
            letzte.personId === op.personId &&
            Math.abs(op.atMs - letzte.atMs) <= pauseMs &&
            aktuelle.length < SERIEN_MAX_MITGLIEDER
        )
            aktuelle.push(op);
        else {
            schliesse();
            aktuelle = [op];
        }
    }
    schliesse();
    return ketten;
}

/** Eine Arbeitsserie: ihre Kennung ist die `operationId` des ältesten Mitglieds. */
export interface Serie {
    id: string;
    /** Der Gegenstand (`<art>:<kennung>`). */
    scope: string;
    /** Alle Mitglieder, das älteste zuerst. */
    mitglieder: readonly SerienOperation[];
}

/** Die Stelle einer Operation in ihrer Serie; `position` zählt von 1 an, das älteste Mitglied zuerst. */
export interface SerienStelle {
    serie: Serie;
    position: number;
}

/**
 * Die Prüfsumme einer Mitgliederliste: SHA-256 über die sortierten, klein geschriebenen Kennungen, mit Zeilenumbruch verbunden, hexadezimal. Die Liste ist eine
 * Menge: Reihenfolge und Schreibweise ändern sie nicht. Die Rücknahme schickt sie mit (Fachvertrag B.4/C.2, `membersHash`).
 */
export function mitgliederHash(operationIds: readonly string[]): string {
    const sortiert = [...new Set(operationIds.map((id) => id.toLowerCase()))].sort();
    return createHash("sha256").update(sortiert.join("\n")).digest("hex");
}

/** Der Gegenstand als Art und Kennung (`<art>:<kennung>` zerlegt). */
export function zerlegeScope(scope: string): { kind: MapHistoryObjectKind; id: string } {
    const i = scope.indexOf(":");
    return { kind: scope.slice(0, i) as MapHistoryObjectKind, id: scope.slice(i + 1) };
}

interface ZielRow {
    operation_id: string;
    place_public_id: string | null;
    path_public_id: string | null;
    powerline_public_id: string | null;
    nodix_public_id: string | null;
    region_public_id: string | null;
    region_area_public_id: string | null;
    map_label_public_id: string | null;
    territory_public_id: string | null;
    territory_area_public_id: string | null;
    peak_public_id: string | null;
    source_public_id: string | null;
    work_public_id: string | null;
    lore_public_id: string | null;
    corpus_public_id: string | null;
    sprache_artikel_public_id: string | null;
    sprache_public_id: string | null;
    sprache_flaeche_public_id: string | null;
}

interface BeruehrendRow extends Omit<ZielRow, "operation_id"> {
    operation_id: string;
    seq: string;
    at: Date;
    source: string;
    action: string;
    person_id: string | null;
}

/** Die Kennungen je Art, nach denen gesucht wird (`[]`, wenn keine). */
export type GegenstandsIds = (art: MapHistoryObjectKind) => readonly string[];

/**
 * Die Bedingung `WHERE` an `map_audit_event e`: Der Eintrag berührt einen der Gegenstände, nach Zielspalte (`ZIEL_ARTEN`). Ein Baustein zum Einsetzen in eine Abfrage
 * (`WHERE (${trifftGegenstaende(db, ids)})`); jede Zielspalte hat ihren Index (`(…_public_id, id DESC)`), eine leere Liste ihrer Art kostet nichts.
 */
export function trifftGegenstaende(database: Queryable, ids: GegenstandsIds): postgres.PendingQuery<postgres.Row[]> {
    const liste = (art: MapHistoryObjectKind): string[] => [...ids(art)];
    return database`
        e.region_public_id = ANY(${liste("landscape")}::uuid[])
        OR e.territory_public_id = ANY(${liste("territory")}::uuid[])
        OR e.sprache_public_id = ANY(${liste("sprache")}::uuid[])
        OR e.place_public_id = ANY(${liste("place")}::uuid[])
        OR e.path_public_id = ANY(${liste("path")}::uuid[])
        OR e.powerline_public_id = ANY(${liste("powerline")}::uuid[])
        OR e.nodix_public_id = ANY(${liste("nodix")}::uuid[])
        OR e.peak_public_id = ANY(${liste("peak")}::uuid[])
        OR e.source_public_id = ANY(${liste("source")}::uuid[])
        OR e.work_public_id = ANY(${liste("work")}::uuid[])
        OR e.lore_public_id = ANY(${liste("lore")}::uuid[])
        OR e.corpus_public_id = ANY(${liste("corpus")}::uuid[])
        OR e.sprache_artikel_public_id = ANY(${liste("sprache_artikel")}::uuid[])
        OR e.region_area_public_id = ANY(${liste("area")}::uuid[])
        OR e.map_label_public_id = ANY(${liste("label")}::uuid[])
        OR e.territory_area_public_id = ANY(${liste("territory_area")}::uuid[])
        OR e.sprache_flaeche_public_id = ANY(${liste("sprache_flaeche")}::uuid[])
    `;
}

/**
 * Der Gegenstand eines Protokolleintrags, wie die Verläufe ihn zeigen (`MapHistoryObject`): Die Teilfläche und die Beschriftung gehen ihrer Fläche vor, die
 * Gebietsfläche und die Sprachfläche ihrem Gebiet und ihrer Sprache. (Der Scope einer Arbeitsserie ist ein anderer, gröberer Begriff: `scopeSchluessel`.)
 */
export function gegenstandVon(
    ziel: Readonly<Partial<Record<ZielSpalte, string | null>>>,
): { kind: MapHistoryObjectKind; id: string } | undefined {
    const reihenfolge: readonly MapHistoryObjectKind[] = [
        "place",
        "powerline",
        "nodix",
        "area",
        "label",
        "landscape",
        "territory_area",
        "territory",
        "peak",
        "source",
        "work",
        "lore",
        "corpus",
        "sprache_artikel",
        "sprache_flaeche",
        "sprache",
        "path",
    ];
    for (const kind of reihenfolge) {
        const spalte = ZIEL_ARTEN.find((eintrag) => eintrag.art === kind)?.spalte;
        const id = spalte === undefined ? undefined : ziel[spalte];
        if (id !== null && id !== undefined) return { kind, id };
    }
    return undefined;
}

/** Die Zielspalte, die eine Art benennt. */
export const spalteVon = (kind: MapHistoryObjectKind): ZielSpalte =>
    ZIEL_ARTEN.find((eintrag) => eintrag.art === kind)!.spalte;

/** Die Zielspalten der Protokolleinträge der Operationen (ohne die Nutzlast `changes`: schlank), je Operation eine Liste. */
export async function leseZiele(
    database: Queryable,
    operationIds: readonly string[],
): Promise<Map<string, ZielZeile[]>> {
    const jeOperation = new Map<string, ZielZeile[]>();
    if (operationIds.length === 0) return jeOperation;
    const zeilen = await database<ZielRow[]>`
        SELECT e.operation_id::text AS operation_id, e.place_public_id::text AS place_public_id, e.path_public_id::text AS path_public_id,
               e.powerline_public_id::text AS powerline_public_id, e.nodix_public_id::text AS nodix_public_id,
               e.region_public_id::text AS region_public_id, e.region_area_public_id::text AS region_area_public_id,
               e.map_label_public_id::text AS map_label_public_id, e.territory_public_id::text AS territory_public_id,
               e.territory_area_public_id::text AS territory_area_public_id, e.peak_public_id::text AS peak_public_id,
               e.source_public_id::text AS source_public_id, e.work_public_id::text AS work_public_id,
               e.lore_public_id::text AS lore_public_id, e.corpus_public_id::text AS corpus_public_id,
               e.sprache_artikel_public_id::text AS sprache_artikel_public_id, e.sprache_public_id::text AS sprache_public_id,
               e.sprache_flaeche_public_id::text AS sprache_flaeche_public_id
          FROM map_audit_event e
         WHERE e.operation_id = ANY(${[...operationIds]}::uuid[])
    `;
    for (const { operation_id: id, ...ziel } of zeilen) {
        const liste = jeOperation.get(id);
        if (liste === undefined) jeOperation.set(id, [ziel]);
        else liste.push(ziel);
    }
    return jeOperation;
}

/** Eine Operation, die die Serienbildung prüft (die Liste, die gerade gelesen wird). */
export interface SerienKandidat {
    operationId: string;
    seq: number;
    at: Date;
    source: string;
    action: string;
    personId: string | null;
}

/**
 * Liest und berechnet Arbeitsserien zu einer Liste von Operationen. Ein Leser gehört zu EINER Anfrage: Er merkt sich die Protokollziele, die Zeitleisten und die
 * berechneten Serien, damit das Nachladen einer Seitengrenze (`history.ts`, B.4) nicht zweimal liest.
 *
 * Eine Zeitleiste ist die ganze Geschichte EINES Gegenstands (alle Operationen, die ihn berühren). Das ist, was die Regel braucht: Die Kette eines Mitglieds
 * endet erst an einer fremden Operation oder einer Pause, und die Zählung der Obergrenze beginnt am wirklichen Anfang der Kette. Die Geschichte eines Gegenstands
 * ist klein (Zehner bis wenige Hundert Operationen); gelesen wird sie nur für die Gegenstände der Mitglieder, die in der Liste stehen.
 */
export class SerienLeser {
    private readonly scopesJeOperation = new Map<string, string[]>();
    private readonly zeitleisten = new Map<string, SerienOperation[]>();
    private readonly stellen = new Map<string, SerienStelle>();
    private readonly serien = new Map<string, Serie>();

    private readonly database: Queryable;
    private readonly pauseMs: number;

    constructor(database: Queryable, pauseMs: number = SERIEN_PAUSE_MS) {
        this.database = database;
        this.pauseMs = pauseMs;
    }

    /** Die Serie mit dieser Kennung, wenn sie berechnet wurde. */
    serie(id: string): Serie | undefined {
        return this.serien.get(id);
    }

    /** Die Stelle einer bereits berechneten Operation. */
    stelle(operationId: string): SerienStelle | undefined {
        return this.stellen.get(operationId);
    }

    /** Die Gegenstände der Operationen (aus dem Protokoll; gemerkt). */
    async scopes(operationIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
        const fehlend = operationIds.filter((id) => !this.scopesJeOperation.has(id));
        if (fehlend.length > 0) {
            const gelesen = await leseZiele(this.database, fehlend);
            for (const id of fehlend) {
                const ziele = gelesen.get(id) ?? [];
                this.scopesJeOperation.set(id, scopesVon(ziele));
            }
        }
        return this.scopesJeOperation;
    }

    /**
     * Berechnet die Serien der Gegenstände der Mitglieder unter den Operationen und gibt die Stelle jeder zurück, die zu einer gehört (die anderen fehlen).
     */
    async laden(kandidaten: readonly SerienKandidat[]): Promise<ReadonlyMap<string, SerienStelle>> {
        await this.scopes(kandidaten.filter(koenntMitgliedSein).map((k) => k.operationId));
        const gebraucht = new Set<string>();
        for (const kandidat of kandidaten) {
            const op = this.alsOperation(kandidat);
            const scope = op.scopes[0];
            if (istGruppierbar(op) && scope !== undefined && !this.zeitleisten.has(scope)) gebraucht.add(scope);
        }
        if (gebraucht.size > 0) await this.ladeZeitleisten([...gebraucht]);
        const ergebnis = new Map<string, SerienStelle>();
        for (const kandidat of kandidaten) {
            const stelle = this.stellen.get(kandidat.operationId);
            if (stelle !== undefined) ergebnis.set(kandidat.operationId, stelle);
        }
        return ergebnis;
    }

    private alsOperation(kandidat: SerienKandidat): SerienOperation {
        return {
            operationId: kandidat.operationId,
            seq: kandidat.seq,
            atMs: kandidat.at.getTime(),
            source: kandidat.source,
            action: kandidat.action,
            personId: kandidat.personId,
            scopes: this.scopesJeOperation.get(kandidat.operationId) ?? [],
        };
    }

    /** Liest die Geschichte der Gegenstände (eine Abfrage) und bildet ihre Serien. */
    private async ladeZeitleisten(scopes: readonly string[]): Promise<void> {
        const jeArt: Record<string, string[]> = {};
        for (const scope of scopes) {
            const { kind, id } = zerlegeScope(scope);
            (jeArt[kind] ??= []).push(id);
        }
        const ids = (art: MapHistoryObjectKind): string[] => jeArt[art] ?? [];
        const beruehrend = await this.database<BeruehrendRow[]>`
            SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.source, o.action, o.actor_person_id::text AS person_id,
                   e.place_public_id::text AS place_public_id, e.path_public_id::text AS path_public_id,
                   e.powerline_public_id::text AS powerline_public_id, e.nodix_public_id::text AS nodix_public_id,
                   e.region_public_id::text AS region_public_id, e.region_area_public_id::text AS region_area_public_id,
                   e.map_label_public_id::text AS map_label_public_id, e.territory_public_id::text AS territory_public_id,
                   e.territory_area_public_id::text AS territory_area_public_id, e.peak_public_id::text AS peak_public_id,
                   e.source_public_id::text AS source_public_id, e.work_public_id::text AS work_public_id,
                   e.lore_public_id::text AS lore_public_id, e.corpus_public_id::text AS corpus_public_id,
                   e.sprache_artikel_public_id::text AS sprache_artikel_public_id, e.sprache_public_id::text AS sprache_public_id,
                   e.sprache_flaeche_public_id::text AS sprache_flaeche_public_id
              FROM map_audit_event e
              JOIN map_operation o ON o.operation_id = e.operation_id
             WHERE (${trifftGegenstaende(this.database, ids)})
        `;
        // Je Operation: was sie von den gesuchten Gegenständen berührt. Von einer, die Mitglied sein kann, liest der Leser danach ALLE Gegenstände (ein Eintrag
        // mit mehreren ist kein Mitglied); von einer, die es nicht sein kann (ein Import mit Tausenden Einträgen), genügt, dass sie den Gegenstand berührt.
        const gesucht = new Set(scopes);
        const kopf = new Map<string, SerienKandidat>();
        const beruehrt = new Map<string, Set<string>>();
        for (const zeile of beruehrend) {
            const schluessel = scopeSchluessel(zeile);
            if (schluessel === undefined || !gesucht.has(schluessel)) continue;
            kopf.set(zeile.operation_id, {
                operationId: zeile.operation_id,
                seq: Number(zeile.seq),
                at: zeile.at,
                source: zeile.source,
                action: zeile.action,
                personId: zeile.person_id,
            });
            const menge = beruehrt.get(zeile.operation_id);
            if (menge === undefined) beruehrt.set(zeile.operation_id, new Set([schluessel]));
            else menge.add(schluessel);
        }
        await this.scopes([...kopf.values()].filter(koenntMitgliedSein).map((k) => k.operationId));
        const jeScope = new Map<string, SerienOperation[]>(scopes.map((scope) => [scope, []]));
        for (const [id, k] of kopf) {
            const op: SerienOperation = {
                ...this.alsOperation(k),
                scopes: koenntMitgliedSein(k)
                    ? (this.scopesJeOperation.get(id) ?? [])
                    : [...(beruehrt.get(id) ?? [])].sort(),
            };
            for (const scope of op.scopes) jeScope.get(scope)?.push(op);
        }
        for (const [scope, liste] of jeScope) {
            liste.sort((a, b) => a.seq - b.seq);
            this.zeitleisten.set(scope, liste);
            for (const kette of bildeSerien(liste, this.pauseMs)) {
                const serie: Serie = { id: kette[0]!.operationId, scope, mitglieder: kette };
                this.serien.set(serie.id, serie);
                kette.forEach((mitglied, i) => this.stellen.set(mitglied.operationId, { serie, position: i + 1 }));
            }
        }
    }
}
