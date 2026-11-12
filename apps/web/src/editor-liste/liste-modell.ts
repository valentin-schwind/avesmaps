import { foldName } from "@avesmaps3d/shared";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";

/**
 * Das Listenmodell der Karteninhalte (WI-0128 E5; EDIT-0001 §4.2, §4.7 G2; Legacy `js/review/review-settlement-list.js`, Mirror
 * `cfbbe69c8`). Reine Funktionen, damit Vitest sie ohne Browser prüft; das Bauteil `editor-liste.vue` zeichnet nur, was hier steht.
 *
 * - **Eine Liste, drei Formen** (G2): `flach`, `gruppiert` (eine Gruppe mit aufklappbaren Gliedern; die Zeile der Gruppe wählt die
 *   ganze Gruppe) und `baum` (Kinder unter ihrem Elternteil; ein Treffer bringt seine Vorfahren als Zusammenhang mit).
 * - **Facetten mit Zahlen** (Legacy rsl:221-237): Jede Facette zählt ihre Werte unter allen anderen Filtern, ohne sich selbst, sonst
 *   zählte jeder Wert nur sich. Reiter über der Liste gibt es nicht (Betreiber 2026-10-11: „Alle“, „Platziert“, „Fehlt“ in den
 *   Trichter, „weil nicht ganz klar ist, ob die Filter mit oder dagegen zählen“); was ein Reiter war, ist eine Facette.
 * - **Facetten** gelten nur, wo die Zeile einen Wert hat: Eine Stadt liegt nicht „innerorts“, also lässt der Filter „Lage“ sie stehen
 *   (Legacy `settlementScopeApplies`). Ein gewählter Wert, den es in den Zeilen nicht (mehr) gibt, filtert nicht unsichtbar weiter;
 *   das Bauteil wählt ihn ab (`ohneVerwaiste` gegen `vorhandeneWerte`, Legacy `wikiSyncPruneFacetState`). Gemessen an ALLEN Zeilen,
 *   nicht an der Suche: Sonst nähme eine Suche, die eine Facette kurz leer macht, die Wahl für immer mit (gefunden 2026-10-11).
 * - **Die Bilanzzeile** („9 Treffer · ● 1 · ◐ 1 · ○ 7“) steht nur, wenn Suche oder Filter die Menge ändern (Owner 14.08.2026).
 * - **Suche** nach dem gefalteten Namen (`foldName`: ohne Akzente, ß als ss), wie Wegpunktsuche und Server.
 */

export type Kreis = "leer" | "halb" | "halb-rechts" | "voll";
export type ListenForm = "flach" | "gruppiert" | "baum";

/** Wie eine Unterzeile klingt: bestätigt (✓), Warnung (⚠) oder leise. */
export type UnterTon = "gut" | "warnung" | "leise";

export interface ListenZeile {
    readonly key: string;
    readonly name: string;
    readonly kreis: Kreis;
    /** Je Facette der Wert; fehlt, wo die Facette für die Zeile nicht gilt. */
    readonly facetten: Readonly<Record<string, string | undefined>>;
    /** Rechts in der Zeile, etwa die Art („Stadt“, „Garnison“). */
    readonly rechts?: string;
    readonly unter?: { readonly text: string; readonly ton: UnterTon };
    /**
     * Eine Gefahrenlage (WI-0308): eine eigene Zeile unter der Unterzeile in der Gefahrfarbe, etwa „⚠︎ Kriminalität, Wildnis“. Additiv:
     * ohne Angabe bleibt die Zeile, wie sie war.
     */
    readonly gefahr?: { readonly text: string };
    /** Ein Zeichen hinter dem Namen, etwa das durchgestrichene Auge einer für Besucher verborgenen Landschaft (WI-0178 T41). */
    readonly zeichen?: { readonly name: EditorZeichenName; readonly titel: string };
    /** Zahl der Bilder, unten rechts; erst ab 1. */
    readonly bilder?: number;
    /**
     * Ein kleines Bild links in der Zeile, etwa das Wappen eines Orts (Gesamtmockup Version 7). Steht `bild` da, hält jede Zeile den
     * Platz, auch ohne Adresse (dann leer), damit die Namen untereinander stehen.
     */
    readonly bild?: { readonly url: string | undefined };
    /** Ein Farbpunkt vor dem Namen, etwa die Farbe einer Sprache auf der Karte (WI-0261 S5d2); `#rrggbb`. */
    readonly farbe?: string;
    /**
     * Ein Zeichen links in der Zeile, an der Stelle des Bilds (WI-0288 Stufe 3: die Art eines Wetter-Icons, die Uhr eines Presets). Additiv:
     * ohne Angabe bleibt die Zeile, wie sie war.
     */
    readonly vorzeichen?: EditorZeichenName;
    /** Die Gruppe (Form `gruppiert`) und ihr Name. */
    readonly gruppe?: string;
    readonly gruppenName?: string;
    /** Der Elternteil (Form `baum`). */
    readonly eltern?: string;
    /** Vergleichswerte der Sortierungen (`ortsgroesse` …). */
    readonly rang?: Readonly<Record<string, number>>;
    /** Zählt in keiner Legende (EDIT-0003 T54: Gelöschtes steht unter seiner Facette, aber nie in den Zahlen der Kreise). */
    readonly zaehltNicht?: true;
}

export interface ListenStand {
    readonly suche: string;
    readonly filter: ReadonlyMap<string, ReadonlySet<string>>;
    readonly sortierung: string;
    /** Eine Maske lässt nur Zeilen durch, die sie annimmt (`undefined`: alle). */
    readonly maske?: ((zeile: ListenZeile) => boolean) | undefined;
    /** Aufgeklappte Gruppen und Knoten. */
    readonly offen: ReadonlySet<string>;
}

export interface FacettenOption {
    readonly wert: string;
    readonly zahl: number;
}

/** Eine Zeile der Darstellung: eine Zeile der Liste oder der Kopf einer Gruppe. */
export type Darstellungszeile =
    | {
          readonly art: "zeile";
          readonly key: string;
          readonly zeile: ListenZeile;
          readonly tiefe: number;
          /** Nur im Baum: Zahl der sichtbaren Kinder und ob der Knoten offen ist. */
          readonly kinder?: number;
          readonly offen?: boolean;
          /** Nur im Baum: Die Zeile steht als Zusammenhang eines Treffers da, nicht selbst als Treffer. */
          readonly zusammenhang?: boolean;
      }
    | {
          readonly art: "gruppe";
          readonly key: string;
          readonly name: string;
          readonly kreis: Kreis;
          readonly glieder: readonly ListenZeile[];
          readonly offen: boolean;
      };

export interface ListenErgebnis {
    /** Die Treffer, sortiert (ohne Gruppenköpfe). */
    readonly treffer: readonly ListenZeile[];
    readonly darstellung: readonly Darstellungszeile[];
    /** Je Facette die Werte mit Zahl unter allen anderen Filtern. */
    readonly facettenOptionen: Readonly<Record<string, readonly FacettenOption[]>>;
    /** Die Bilanz der Kreise unter den Treffern; `zeigen` nur, wenn Suche oder Filter die Menge ändern. */
    readonly bilanz: { readonly zeigen: boolean; readonly treffer: number } & Readonly<Record<Kreis, number>>;
    /** Zahl der aktiven Filterwerte (für „▽ Filter (n)“). */
    readonly filterAnzahl: number;
}

export interface ListenOptionen {
    readonly form: ListenForm;
    /** Die Facetten in Reihenfolge (aus dem Register, T1.6). */
    readonly facetten: readonly string[];
    /**
     * Was beim Öffnen schon gewählt ist (Legacy: Lage „außerorts + unklar“). Es zählt wie jede Wahl im Knopf „Filter (n)“, damit die
     * Liste nichts ausblendet, ohne es zu sagen; „Filter lösen“ nimmt es mit weg.
     */
    readonly vorbelegt?: ReadonlyMap<string, ReadonlySet<string>>;
    readonly sortierungen: Readonly<Record<string, (a: ListenZeile, b: ListenZeile) => number>>;
    /**
     * Nur `gruppiert`: Die Gruppen sind Abschnitte der Liste, keine Objekte (WI-0288 Stufe 3: „Presets“ und „Icons“ des Wetters, Probierseite
     * Idee A). Sie stehen offen, ihr Kopf trägt keinen Kreis, und ein Klick auf ihn klappt sie, statt die Gruppe zu wählen. Ohne Angabe
     * bleibt es, wie es war: zu, mit Kreis, die Zeile wählt die ganze Gruppe.
     */
    readonly gruppenAlsAbschnitte?: boolean;
}

const COLLATOR = new Intl.Collator("de", { sensitivity: "base", numeric: true });
/** Nach Name, deutsch und mit Zahlen in der richtigen Folge; bei Gleichstand nach Schlüssel, damit die Folge fest ist. */
export const nachName = (a: ListenZeile, b: ListenZeile): number =>
    COLLATOR.compare(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
/** Nach einem Rang (kleiner zuerst, ohne Rang zuletzt), dann nach Name. */
export const nachRang =
    (rang: string) =>
    (a: ListenZeile, b: ListenZeile): number =>
        (a.rang?.[rang] ?? Number.MAX_SAFE_INTEGER) - (b.rang?.[rang] ?? Number.MAX_SAFE_INTEGER) || nachName(a, b);

/** Passt die Zeile zu allen Filtern, außer der genannten Facette? */
export function passtFilter(zeile: ListenZeile, filter: ListenStand["filter"], ausser?: string): boolean {
    for (const [facette, werte] of filter) {
        if (facette === ausser || werte.size === 0) continue;
        const wert = zeile.facetten[facette];
        if (wert !== undefined && !werte.has(wert)) return false;
    }
    return true;
}

/** Zahl der gewählten Filterwerte. */
export const filterAnzahl = (filter: ListenStand["filter"]): number =>
    [...filter.values()].reduce((summe, werte) => summe + werte.size, 0);

/**
 * Wie viele Wahlen im Trichter vom Start (`vorbelegt`) abweichen.
 */
export function abweichung(filter: ListenStand["filter"], vorbelegt: ListenOptionen["vorbelegt"]): number {
    let n = 0;
    for (const key of new Set([...filter.keys(), ...(vorbelegt?.keys() ?? [])])) {
        const jetzt = filter.get(key) ?? new Set<string>();
        const start = vorbelegt?.get(key) ?? new Set<string>();
        for (const wert of jetzt) if (!start.has(wert)) n += 1;
        for (const wert of start) if (!jetzt.has(wert)) n += 1;
    }
    return n;
}

/**
 * Engt der Trichter ein? Erst dann klappt ein Baum zu seinen Treffern auf. Der Start (etwa „Aktiv“ ohne „Gelöscht“, EDIT-0003 T54) und
 * ein leerer Trichter zeigen den Baum, wie er ohne Trichter stünde.
 */
const eingeengt = (filter: ListenStand["filter"], vorbelegt: ListenOptionen["vorbelegt"]): boolean =>
    filterAnzahl(filter) > 0 && abweichung(filter, vorbelegt) > 0;

/** Je Facette die Werte, die in den Zeilen überhaupt vorkommen, ohne Suche, Filter und Maske: wogegen `ohneVerwaiste` misst. */
export function vorhandeneWerte(
    zeilen: readonly ListenZeile[],
    facetten: readonly string[],
): Record<string, FacettenOption[]> {
    const werte: Record<string, FacettenOption[]> = {};
    for (const facette of facetten) {
        const zaehler = new Map<string, number>();
        for (const zeile of zeilen) {
            const wert = zeile.facetten[facette];
            if (wert !== undefined) zaehler.set(wert, (zaehler.get(wert) ?? 0) + 1);
        }
        werte[facette] = [...zaehler.entries()].map(([wert, zahl]) => ({ wert, zahl }));
    }
    return werte;
}

/** Ein Filter ohne Werte, die es nicht mehr gibt (Legacy `wikiSyncPruneFacetState`). */
export function ohneVerwaiste(
    filter: ListenStand["filter"],
    optionen: ListenErgebnis["facettenOptionen"],
): Map<string, Set<string>> {
    const neu = new Map<string, Set<string>>();
    for (const [facette, werte] of filter) {
        const da = new Set((optionen[facette] ?? []).map((option) => option.wert));
        const bleibt = new Set([...werte].filter((wert) => da.has(wert)));
        if (bleibt.size > 0) neu.set(facette, bleibt);
    }
    return neu;
}

export function berechne(zeilen: readonly ListenZeile[], stand: ListenStand, optionen: ListenOptionen): ListenErgebnis {
    const suche = foldName(stand.suche);
    const gesucht = (zeile: ListenZeile): boolean => suche === "" || foldName(zeile.name).includes(suche);
    const maske = stand.maske ?? (() => true);
    const grund = zeilen.filter((zeile) => maske(zeile) && gesucht(zeile));

    const facettenOptionen: Record<string, FacettenOption[]> = {};
    for (const facette of optionen.facetten) {
        const zaehler = new Map<string, number>();
        for (const zeile of grund) {
            const wert = zeile.facetten[facette];
            if (wert === undefined || !passtFilter(zeile, stand.filter, facette)) continue;
            zaehler.set(wert, (zaehler.get(wert) ?? 0) + 1);
        }
        facettenOptionen[facette] = [...zaehler.entries()]
            .map(([wert, zahl]) => ({ wert, zahl }))
            .sort((a, b) => COLLATOR.compare(a.wert, b.wert));
    }

    const vergleich = optionen.sortierungen[stand.sortierung] ?? nachName;
    const treffer = grund.filter((zeile) => passtFilter(zeile, stand.filter)).sort(vergleich);
    const darstellung =
        optionen.form === "gruppiert"
            ? gruppiere(treffer, stand.offen, optionen.gruppenAlsAbschnitte === true)
            : optionen.form === "baum"
              ? baue(
                    zeilen,
                    treffer,
                    stand.offen,
                    vergleich,
                    suche !== "" || eingeengt(stand.filter, optionen.vorbelegt),
                )
              : treffer.map((zeile): Darstellungszeile => ({ art: "zeile", key: zeile.key, zeile, tiefe: 0 }));

    // „N Treffer“ nur, wenn Suche, Trichter oder Maske die Liste ändern: Die Start-Belegung des Trichters (`vorbelegt`, etwa „Stand“ ohne
    // „Gelöscht“, EDIT-0003 T54) ändert nichts.
    const bilanz = {
        zeigen: suche !== "" || abweichung(stand.filter, optionen.vorbelegt) > 0 || stand.maske !== undefined,
        treffer: treffer.length,
        ...kreisZaehlung(treffer.filter((zeile) => zeile.zaehltNicht !== true).map((zeile) => zeile.kreis)),
    };

    return { treffer, darstellung, facettenOptionen, bilanz, filterAnzahl: filterAnzahl(stand.filter) };
}

/**
 * Wie viele Zeilen in welchem Kreis stehen: die Zahlen der Legende unter einer Liste und, über alle Zeilen eines Inhalts, die Zahlen
 * seiner Kachel im Editorpanel (WI-0212, EDIT-0003 T37). EINE Zählung für beide, damit Liste und Panel nie verschieden zählen.
 */
export function kreisZaehlung(kreise: readonly Kreis[]): Record<Kreis, number> {
    const zahlen: Record<Kreis, number> = { leer: 0, halb: 0, "halb-rechts": 0, voll: 0 };
    for (const kreis of kreise) zahlen[kreis] += 1;
    return zahlen;
}

/** Der Kreis einer Gruppe: voll, wenn alle voll sind, leer, wenn alle leer sind, sonst halb. */
export function gruppenKreis(glieder: readonly ListenZeile[]): Kreis {
    if (glieder.length > 0 && glieder.every((zeile) => zeile.kreis === "voll")) return "voll";
    if (glieder.every((zeile) => zeile.kreis === "leer")) return "leer";
    return "halb";
}

/** `gruppe:<key>`: der Schlüssel des Kopfs einer Gruppe; eine Wahl darauf wählt die ganze Gruppe. */
export const gruppenKey = (gruppe: string): string => `gruppe:${gruppe}`;

/** `offen` nennt die umgeklappten Gruppen: ohne `vorgabeOffen` die offenen, mit ihr die geschlossenen. */
function gruppiere(
    treffer: readonly ListenZeile[],
    offen: ReadonlySet<string>,
    vorgabeOffen: boolean,
): Darstellungszeile[] {
    const gruppen = new Map<string, ListenZeile[]>();
    const folge: (string | ListenZeile)[] = [];
    for (const zeile of treffer) {
        if (zeile.gruppe === undefined) {
            folge.push(zeile);
            continue;
        }
        const glieder = gruppen.get(zeile.gruppe);
        if (glieder) glieder.push(zeile);
        else {
            gruppen.set(zeile.gruppe, [zeile]);
            folge.push(zeile.gruppe);
        }
    }
    return folge.flatMap((eintrag): Darstellungszeile[] => {
        if (typeof eintrag !== "string") return [{ art: "zeile", key: eintrag.key, zeile: eintrag, tiefe: 0 }];
        const glieder = gruppen.get(eintrag)!;
        const key = gruppenKey(eintrag);
        const auf = vorgabeOffen ? !offen.has(key) : offen.has(key);
        return [
            {
                art: "gruppe",
                key,
                name: glieder[0]!.gruppenName ?? eintrag,
                kreis: gruppenKreis(glieder),
                glieder,
                offen: auf,
            },
            ...(auf
                ? glieder.map((zeile): Darstellungszeile => ({ art: "zeile", key: zeile.key, zeile, tiefe: 1 }))
                : []),
        ];
    });
}

/**
 * Der Baum: Wurzeln sind Zeilen ohne (bekannten) Elternteil. Mit Suche oder Filter zeigt er die Treffer samt ihren Vorfahren und
 * klappt diese auf; ohne zeigt er, was aufgeklappt ist.
 */
function baue(
    alle: readonly ListenZeile[],
    treffer: readonly ListenZeile[],
    offen: ReadonlySet<string>,
    vergleich: (a: ListenZeile, b: ListenZeile) => number,
    eingeengt: boolean,
): Darstellungszeile[] {
    const nachKey = new Map(alle.map((zeile) => [zeile.key, zeile]));
    const getroffen = new Set(treffer.map((zeile) => zeile.key));
    const sichtbar = new Set(getroffen);
    for (const zeile of treffer) {
        for (
            let eltern = zeile.eltern;
            eltern !== undefined && nachKey.has(eltern);
            eltern = nachKey.get(eltern)!.eltern
        ) {
            if (sichtbar.has(eltern)) break;
            sichtbar.add(eltern);
        }
    }
    const kinderVon = new Map<string | undefined, ListenZeile[]>();
    for (const zeile of alle) {
        if (!sichtbar.has(zeile.key)) continue;
        const eltern = zeile.eltern !== undefined && nachKey.has(zeile.eltern) ? zeile.eltern : undefined;
        const liste = kinderVon.get(eltern);
        if (liste) liste.push(zeile);
        else kinderVon.set(eltern, [zeile]);
    }
    for (const liste of kinderVon.values()) liste.sort(vergleich);
    const aus: Darstellungszeile[] = [];
    const gehe = (eltern: string | undefined, tiefe: number): void => {
        for (const zeile of kinderVon.get(eltern) ?? []) {
            const kinder = kinderVon.get(zeile.key)?.length ?? 0;
            const auf = kinder > 0 && (eingeengt || offen.has(zeile.key));
            aus.push({
                art: "zeile",
                key: zeile.key,
                zeile,
                tiefe,
                kinder,
                offen: auf,
                ...(getroffen.has(zeile.key) ? {} : { zusammenhang: true }),
            });
            if (auf) gehe(zeile.key, tiefe + 1);
        }
    };
    gehe(undefined, 0);
    return aus;
}

/**
 * Pfeiltasten in der Liste (EDIT-0001 §4.2: Pfeile wählen ohne Flug): ↓ ↑ wandern über die Darstellung, Pos1 und Ende springen an
 * die Ränder, Bild ab und auf um eine Seite. Am Rand bleibt die Wahl stehen (eine Liste läuft nicht im Kreis).
 */
export function naechsteWahl(
    darstellung: readonly Darstellungszeile[],
    aktuell: string | undefined,
    taste: string,
    seite = 10,
): string | undefined {
    if (darstellung.length === 0) return undefined;
    const index = aktuell === undefined ? -1 : darstellung.findIndex((zeile) => zeile.key === aktuell);
    const letzter = darstellung.length - 1;
    const ziel =
        taste === "ArrowDown"
            ? index < 0
                ? 0
                : Math.min(letzter, index + 1)
            : taste === "ArrowUp"
              ? index < 0
                  ? letzter
                  : Math.max(0, index - 1)
              : taste === "Home"
                ? 0
                : taste === "End"
                  ? letzter
                  : taste === "PageDown"
                    ? Math.min(letzter, Math.max(0, index) + seite)
                    : taste === "PageUp"
                      ? Math.max(0, index - seite)
                      : undefined;
    return ziel === undefined ? undefined : darstellung[ziel]!.key;
}

/** Welche Zeilen ein virtuelles Fenster zeichnet: Anfang und Ende (exklusiv) samt Überhang. */
export function fenster(
    anzahl: number,
    hoehe: number,
    scrollTop: number,
    sichtHoehe: number,
    ueberhang = 8,
): { anfang: number; ende: number } {
    if (anzahl === 0 || hoehe <= 0) return { anfang: 0, ende: 0 };
    const anfang = Math.max(0, Math.floor(scrollTop / hoehe) - ueberhang);
    const ende = Math.min(anzahl, Math.ceil((scrollTop + Math.max(sichtHoehe, hoehe)) / hoehe) + ueberhang);
    return { anfang, ende };
}

/** Wohin ein Container rollen muss, damit eine Zeile ganz sichtbar ist; `undefined`, wenn sie es schon ist. */
export function rollenZu(index: number, hoehe: number, scrollTop: number, sichtHoehe: number): number | undefined {
    const oben = index * hoehe;
    const unten = oben + hoehe;
    if (oben < scrollTop) return oben;
    if (unten > scrollTop + sichtHoehe) return unten - sichtHoehe;
    return undefined;
}
