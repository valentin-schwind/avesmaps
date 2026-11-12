import { isCapability, type Capability } from "../auth/capabilities.ts";

/**
 * Das Navigationsregister (EDIT-0001 §3.2, WI-0128 E1). Betreiber 2026-10-10, wörtlich: „beachte noch in welchen sub-menüs das
 * register im editorpanel zu den orten führt (wenn du das gleich baust, haben wir mir allein zukünftigen navigations tabs keine
 * probleme mehr)“.
 *
 * 🔴 Ein künftiger Reiter oder ein künftiges Subjekt ist **eine Zeile** in einer Tafel, nie eine Bedingung in einem Bauteil. Die
 * Tafeln liegen in `packages/shared`, weil Server und Oberfläche dieselben Rechte prüfen. Namen stehen nicht hier, sondern in
 * der Sprachtafel der Oberfläche (`nav.<id>`).
 *
 * Legacys Regeln (Mirror `cfbbe69c8`, `docs/superpowers/specs/2026-07-22-editor-navigation-design.md`): eine Reiterzeile, nie
 * eine zweite; genau ein Verb je Subjekt; keine Anzahl je Zeile der Schiene; gemerkt wird nur die Kaskade der Reiter.
 */

/**
 * - `bereich`: ein Reiter oder ein Bereich der Schiene; mit `kinder` ein Knoten.
 * - `subjekt`: ein Karteninhalt in der Schiene (Orte, Wege …) mit genau einem Verb.
 * - `ansicht`: eine Ansicht der Liste eines Subjekts oder Werkzeugs (Alle · Platziert · Fehlt); nie gemerkt.
 * - `werkzeug`: ein Werkzeugfenster, das das Verb eines Subjekts öffnet; seine Reiter stehen in einer eigenen Tafel gleicher Kennung.
 * - `verweis`: eine eigene Seite in einem neuen Tab (`href`).
 * - `spaeter`: steht gestrichelt mit „später“ da und lässt sich nicht wählen (D16).
 */
export const NAV_ARTEN = ["bereich", "subjekt", "ansicht", "werkzeug", "verweis", "spaeter"] as const;
export type NavArt = (typeof NAV_ARTEN)[number];

/** Wie die Kinder eines Knotens erscheinen. */
export type NavDarstellung = "reiter" | "unterreiter" | "schiene" | "schiene-zweispaltig";

/** Die Form der Liste eines Karteninhalts (EDIT-0001 §4.7 G2). */
export type NavListe = "flach" | "gruppiert" | "baum";

/** Wohin ein Doppelklick fliegt (EDIT-0001 §4.7 G3): auf einen Punkt, auf einen Ausschnitt oder nirgendwohin. */
export type NavZiel = "punkt" | "ausschnitt" | "keins";

/** Das eine Verb eines Subjekts: es öffnet ein Werkzeug. */
export interface NavVerb {
    readonly id: string;
    readonly werkzeug: string;
    /** Eines genügt. */
    readonly rechte: readonly Capability[];
    /** Eines genügt zum Schreiben; ohne öffnet das Verb sein Werkzeug „nur lesen“ (Reviewer, EDIT-0001 §7.1 E3). */
    readonly schreiben?: readonly Capability[];
}

export interface NavEintrag {
    /** `^[a-z0-9-]+$`, eindeutig je Tafel; Teil des Tiefen Links und des Merkschlüssels. */
    readonly id: string;
    /** Der Knoten darüber; die Reihenfolge der Kinder ist die Reihenfolge in der Tafel. */
    readonly unter: string | null;
    readonly art: NavArt;
    /** Eines genügt; leer erbt vom Knoten darüber. */
    readonly rechte: readonly Capability[];
    /** Nur an Knoten mit Kindern. */
    readonly kinder?: NavDarstellung;
    /** Ob die Wahl unter dem Knoten darüber gemerkt wird; Vorgabe ja, bei Ansicht und Werkzeug nie. */
    readonly merken?: boolean;
    /** Schlüssel einer Zählquelle, die die Oberfläche auflöst; nie an einem Subjekt. */
    readonly zaehler?: string;
    /** Schlüssel des Stands in der rechten Spalte („22.07.“, „später“). */
    readonly stand?: string;
    readonly verb?: NavVerb;
    /** Filterabschnitte der Liste, in Reihenfolge; nur an Subjekt oder Werkzeug. */
    readonly facetten?: readonly string[];
    /** Nur an Subjekten (auch späteren). */
    readonly liste?: NavListe;
    readonly ziel?: NavZiel;
    /** Nur an Verweisen. */
    readonly href?: string;
    /** Legacys Werte für Tiefe Links („wiki-sync“, „locations“ …). */
    readonly alias?: readonly string[];
}

export interface NavTafel {
    readonly id: string;
    /** Wie die oberste Ebene erscheint. */
    readonly wurzel: NavDarstellung;
    /**
     * Wo die Sitzung ohne Gemerktes und ohne Link oben beginnt, wenn es wählbar ist; ohne Angabe der erste wählbare Eintrag. Das
     * Editorpanel beginnt bei „Karteninhalte“, auch seit „Änderungen“ davor wählbar ist (E17).
     */
    readonly vorgabe?: string;
    readonly eintraege: readonly NavEintrag[];
}

const KENNUNG = /^[a-z0-9-]+$/;
const WAEHLBAR: ReadonlySet<NavArt> = new Set(["bereich", "subjekt", "ansicht", "werkzeug"]);
const MERKBAR: ReadonlySet<NavArt> = new Set(["bereich", "subjekt"]);

const finde = (tafel: NavTafel, id: string): NavEintrag | undefined =>
    tafel.eintraege.find((eintrag) => eintrag.id === id);
const kinderAlle = (tafel: NavTafel, id: string | null): NavEintrag[] =>
    tafel.eintraege.filter((eintrag) => eintrag.unter === id);

/** Die Rechte, die für einen Eintrag gelten: seine eigenen, sonst die des nächsten Knotens darüber mit Rechten. */
function rechteVon(tafel: NavTafel, eintrag: NavEintrag): readonly Capability[] {
    for (
        let aktuell: NavEintrag | undefined = eintrag;
        aktuell;
        aktuell = aktuell.unter ? finde(tafel, aktuell.unter) : undefined
    ) {
        if (aktuell.rechte.length > 0) return aktuell.rechte;
    }
    return [];
}

/** Darf diese Sitzung den Eintrag und jeden Knoten darüber sehen? */
function erlaubt(tafel: NavTafel, eintrag: NavEintrag, rechte: readonly string[]): boolean {
    const noetig = rechteVon(tafel, eintrag);
    if (noetig.length > 0 && !noetig.some((recht) => rechte.includes(recht))) return false;
    const oben = eintrag.unter ? finde(tafel, eintrag.unter) : undefined;
    return oben === undefined || erlaubt(tafel, oben, rechte);
}

/** Lässt sich in diesem Zweig etwas wählen? Ein Knoten zählt nur, wenn darunter etwas Wählbares steht. */
function waehlbarerZweig(tafel: NavTafel, eintrag: NavEintrag, rechte: readonly string[]): boolean {
    if (!WAEHLBAR.has(eintrag.art) || !erlaubt(tafel, eintrag, rechte)) return false;
    const darunter = kinderAlle(tafel, eintrag.id);
    return darunter.length === 0 || darunter.some((kind) => waehlbarerZweig(tafel, kind, rechte));
}

function sichtbarIntern(tafel: NavTafel, eintrag: NavEintrag, rechte: readonly string[]): boolean {
    if (!erlaubt(tafel, eintrag, rechte)) return false;
    const oben = eintrag.unter ? finde(tafel, eintrag.unter) : undefined;
    if (oben && !sichtbarIntern(tafel, oben, rechte)) return false;
    // Ein Knoten ohne wählbaren Eintrag fällt weg (Systemsteuerung E6: ein Bereich nur mit Späterem erscheint nicht).
    if (kinderAlle(tafel, eintrag.id).length > 0) return waehlbarerZweig(tafel, eintrag, rechte);
    return true;
}

/** Alle Einträge, die eine Sitzung mit diesen Rechten sieht, in der Reihenfolge der Tafel. */
export function sichtbar(tafel: NavTafel, rechte: readonly string[]): NavEintrag[] {
    return tafel.eintraege.filter((eintrag) => sichtbarIntern(tafel, eintrag, rechte));
}

/** Die sichtbaren Kinder eines Knotens (`null`: die oberste Ebene). */
export function kinder(tafel: NavTafel, id: string | null, rechte: readonly string[]): NavEintrag[] {
    return kinderAlle(tafel, id).filter((eintrag) => sichtbarIntern(tafel, eintrag, rechte));
}

/** Sichtbar und wählbar (nicht „später“, kein Verweis). */
export function waehlbar(tafel: NavTafel, id: string, rechte: readonly string[]): boolean {
    const eintrag = finde(tafel, id);
    return eintrag !== undefined && WAEHLBAR.has(eintrag.art) && sichtbarIntern(tafel, eintrag, rechte);
}

/**
 * Wie das Verb eines Subjekts sein Werkzeug öffnet: `bearbeiten` mit einem Schreibrecht des Verbs, sonst `lesen`; `undefined`, wenn
 * die Sitzung das Verb nicht sieht (kein Subjekt, kein Verb, kein Recht des Verbs).
 */
export function verbModus(
    tafel: NavTafel,
    subjekt: string,
    rechte: readonly string[],
): "bearbeiten" | "lesen" | undefined {
    const verb = finde(tafel, subjekt)?.verb;
    if (verb === undefined || !waehlbar(tafel, subjekt, rechte)) return undefined;
    if (verb.rechte.length > 0 && !verb.rechte.some((recht) => rechte.includes(recht))) return undefined;
    return (verb.schreiben ?? []).some((recht) => rechte.includes(recht)) ? "bearbeiten" : "lesen";
}

/** Die Kette von der obersten Ebene bis zum Eintrag; `undefined` für eine unbekannte Kennung. */
export function pfad(tafel: NavTafel, id: string): string[] | undefined {
    const kette: string[] = [];
    for (let aktuell = finde(tafel, id); aktuell; aktuell = aktuell.unter ? finde(tafel, aktuell.unter) : undefined) {
        kette.unshift(aktuell.id);
    }
    return kette.length > 0 ? kette : undefined;
}

/**
 * Ein Tiefer Link (`?tab=`) nach Kennung oder Legacy-Alias. Nur gelesen, nie geschrieben (Legacy-Policy 2026-07-06); ob die
 * Sitzung dorthin darf, entscheidet `wiederherstellen`.
 */
export function ausTiefemLink(tafel: NavTafel, wert: string): string[] | undefined {
    const gesucht = wert.trim().toLowerCase();
    if (!KENNUNG.test(gesucht)) return undefined;
    const eintrag = tafel.eintraege.find((x) => x.id === gesucht || (x.alias ?? []).includes(gesucht));
    return eintrag ? pfad(tafel, eintrag.id) : undefined;
}

/** Der Speicherschlüssel der Wahl unter einem Knoten (`null`: oberste Ebene). */
export function merkschluessel(tafel: NavTafel, unter: string | null): string {
    return `avesmaps3d.nav.${tafel.id}.${unter ?? "wurzel"}`;
}

const merkbar = (eintrag: NavEintrag): boolean => MERKBAR.has(eintrag.art) && eintrag.merken !== false;

/** Was nach einer Wahl zu merken ist: je Knoten der Kette die Wahl darunter, ohne Ansichten und Werkzeuge. */
export function merkwerte(tafel: NavTafel, kette: readonly string[]): [string, string][] {
    const werte: [string, string][] = [];
    for (const id of kette) {
        const eintrag = finde(tafel, id);
        if (eintrag && merkbar(eintrag)) werte.push([merkschluessel(tafel, eintrag.unter), id]);
    }
    return werte;
}

/**
 * Wo die Sitzung nach dem Laden steht (Legacy `REVIEW_TAB_FAMILIES`): ein gültiger Tiefer Link zuerst, dann je Knoten die
 * gemerkte Wahl, sonst oben die Vorgabe der Tafel und darunter der erste wählbare Eintrag; Ansichten beginnen immer bei der ersten. Ein Werkzeug öffnet nur ein Tiefer
 * Link, nie das Gemerkte. `verwerfen` nennt die Schlüssel, deren Wert nicht mehr gilt (unbekannt, später, ohne Recht); die
 * Oberfläche löscht sie.
 */
export function wiederherstellen(
    tafel: NavTafel,
    gemerkt: ReadonlyMap<string, string>,
    rechte: readonly string[],
    tieferLink?: string,
): { pfad: string[]; verwerfen: string[] } {
    const verwerfen: string[] = [];
    const link = tieferLink === undefined ? undefined : ausTiefemLink(tafel, tieferLink);
    const kette: string[] = link && link.every((id) => waehlbar(tafel, id, rechte)) ? [...link] : [];
    for (;;) {
        const letzter = kette.length > 0 ? finde(tafel, kette[kette.length - 1]!) : undefined;
        if (letzter?.art === "werkzeug") break;
        const knoten = letzter?.id ?? null;
        const auswahl = kinder(tafel, knoten, rechte).filter((x) => x.art !== "werkzeug" && WAEHLBAR.has(x.art));
        if (auswahl.length === 0) break;
        const schluessel = merkschluessel(tafel, knoten);
        const wert = gemerkt.get(schluessel);
        const treffer = wert === undefined ? undefined : auswahl.find((x) => x.id === wert && merkbar(x));
        if (wert !== undefined && !treffer) verwerfen.push(schluessel);
        const vorgabe = knoten === null ? auswahl.find((x) => x.id === tafel.vorgabe) : undefined;
        kette.push((treffer ?? vorgabe ?? auswahl[0]!).id);
    }
    return { pfad: kette, verwerfen };
}

/**
 * Prüft eine Tafel gegen die Regeln des Registers und nennt jede Verletzung als Satz (leer: gültig). Die Tests fahren sie über
 * jede Tafel; eine neue Zeile, die eine Regel bricht, fällt dort auf.
 */
export function pruefeTafel(tafel: NavTafel): string[] {
    const probleme: string[] = [];
    const gesehen = new Set<string>();
    const aliasse = new Set<string>();
    const alleIds = new Set(tafel.eintraege.map((eintrag) => eintrag.id));
    for (const eintrag of tafel.eintraege) {
        const { id } = eintrag;
        if (!KENNUNG.test(id)) probleme.push(`${id}: Kennung nur aus [a-z0-9-]`);
        if (gesehen.has(id)) probleme.push(`${id}: Kennung mehrfach vergeben`);
        if (eintrag.unter !== null && !gesehen.has(eintrag.unter))
            probleme.push(`${id}: Knoten „${eintrag.unter}“ fehlt oder steht erst danach`);
        gesehen.add(id);
        for (const recht of eintrag.rechte)
            if (!isCapability(recht)) probleme.push(`${id}: Recht ${recht} steht nicht im Katalog`);
        for (const recht of [...(eintrag.verb?.rechte ?? []), ...(eintrag.verb?.schreiben ?? [])])
            if (!isCapability(recht)) probleme.push(`${id}: Recht ${recht} des Verbs steht nicht im Katalog`);
        for (const alias of eintrag.alias ?? []) {
            if (!KENNUNG.test(alias)) probleme.push(`${id}: Alias ${alias} nur aus [a-z0-9-]`);
            if (alleIds.has(alias)) probleme.push(`${id}: Alias ${alias} ist schon eine Kennung`);
            if (aliasse.has(alias)) probleme.push(`${id}: Alias ${alias} mehrfach vergeben`);
            aliasse.add(alias);
        }
        const oben = eintrag.unter === null ? undefined : finde(tafel, eintrag.unter);
        const darunter = kinderAlle(tafel, id);
        // Ein Werkzeug steht nicht in der Navigation, das Verb öffnet es; es braucht keine Darstellung.
        const gezeigt = darunter.filter((kind) => kind.art !== "werkzeug");
        if (gezeigt.length > 0 && eintrag.kinder === undefined)
            probleme.push(`${id}: Knoten ohne Darstellung der Kinder`);
        if (gezeigt.length === 0 && eintrag.kinder !== undefined) probleme.push(`${id}: Darstellung ohne Kinder`);
        if (eintrag.art === "ansicht") {
            // Eine Ansicht ist eine Reiterzeile einer Liste (unter Subjekt oder Werkzeug) oder ein Eintrag einer Schiene, der den
            // Rumpf wählt (Systemsteuerung, EDIT-0001 §3.3).
            const inSchiene =
                oben?.art === "bereich" && (oben.kinder === "schiene" || oben.kinder === "schiene-zweispaltig");
            if (oben?.art !== "subjekt" && oben?.art !== "werkzeug" && !inSchiene)
                probleme.push(
                    `${id}: eine Ansicht steht nur unter einem Subjekt, einem Werkzeug oder in einer Schiene`,
                );
            if (darunter.length > 0)
                probleme.push(`${id}: eine Ansicht hat keine Kinder (eine Reiterzeile, nie eine zweite)`);
            if (eintrag.merken === true) probleme.push(`${id}: eine Ansicht wird nie gemerkt`);
        }
        if (eintrag.art === "subjekt") {
            if (eintrag.zaehler !== undefined)
                probleme.push(`${id}: keine Zählung an einem Subjekt (Legacy: keine Anzahl je Zeile)`);
            if (eintrag.verb === undefined) probleme.push(`${id}: ein Subjekt hat genau ein Verb`);
            else {
                const werkzeug = finde(tafel, eintrag.verb.werkzeug);
                // Ein Werkzeug steht unter dem Subjekt, dessen Verb es nennt. Mehrere Subjekte dürfen EIN Werkzeug teilen (das Fenster
                // „Inhalte bearbeiten“, WI-0254: vier Karteninhalte, ein Fenster); dann steht es unter einem von ihnen.
                const teilende = tafel.eintraege
                    .filter((x) => x.art === "subjekt" && x.verb?.werkzeug === eintrag.verb!.werkzeug)
                    .map((x) => x.id);
                if (werkzeug?.art !== "werkzeug" || werkzeug.unter === null || !teilende.includes(werkzeug.unter))
                    probleme.push(`${id}: das Werkzeug ${eintrag.verb.werkzeug} des Verbs steht nicht darunter`);
                if (!KENNUNG.test(eintrag.verb.id)) probleme.push(`${id}: Verb ${eintrag.verb.id} nur aus [a-z0-9-]`);
            }
            if (eintrag.liste === undefined || eintrag.ziel === undefined)
                probleme.push(`${id}: Liste und Ziel fehlen`);
        } else if (eintrag.verb !== undefined) probleme.push(`${id}: ein Verb steht nur an einem Subjekt`);
        if (
            (eintrag.liste !== undefined || eintrag.ziel !== undefined) &&
            eintrag.art !== "subjekt" &&
            eintrag.art !== "spaeter"
        )
            probleme.push(`${id}: Liste und Ziel nur an einem Subjekt`);
        if (eintrag.art === "werkzeug" && oben?.art !== "subjekt")
            probleme.push(`${id}: ein Werkzeug steht unter einem Subjekt`);
        if (eintrag.facetten !== undefined) {
            if (eintrag.art !== "subjekt" && eintrag.art !== "werkzeug")
                probleme.push(`${id}: Facetten nur an Subjekt oder Werkzeug`);
            if (new Set(eintrag.facetten).size !== eintrag.facetten.length) probleme.push(`${id}: Facette mehrfach`);
            for (const facette of eintrag.facetten)
                if (!KENNUNG.test(facette)) probleme.push(`${id}: Facette ${facette} nur aus [a-z0-9-]`);
        }
        if ((eintrag.art === "verweis") !== (eintrag.href !== undefined))
            probleme.push(`${id}: href genau an einem Verweis`);
    }
    return probleme;
}
