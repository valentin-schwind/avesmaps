import {
    computed,
    ref,
    shallowRef,
    watch,
    type ComputedRef,
    type InjectionKey,
    type Ref,
    type ShallowRef,
    type WatchStopHandle,
} from "vue";
import {
    SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX,
    type LoreKind,
    type RouteUnterwegsGegendenResponse,
    type RouteUnterwegsRequest,
    type SearchEintragGegend,
    type SearchLeuchtAnfrage,
    type SearchLeuchten,
} from "@avesmaps3d/shared";
import { vereinigtSchluessel } from "../search/leuchten-vereinigen";
import type { SuchLeuchtenZugang } from "../search/such-leuchten-steuerung";
import { freierPlatz, vorkommenFarbe } from "../search/vorkommen-farben";
import { fetchUnterwegsGegenden, type UnterwegsZeile } from "./unterwegs";

/**
 * Die Auswahl in „Vorkommen unterwegs“ (WI-0257 S5, Vali 2026-10-29 und 2026-10-30): MEHRERE Einträge der Reise zugleich. Der Kreis einer Zeile legt den Eintrag
 * in die Auswahl oder nimmt ihn heraus; alle gewählten färben ihre Etappen und leuchten zusammen auf der Karte, jeder in seiner Farbe.
 *
 * Sie gehört der App, nicht dem Planer: Das Infopanel zeigt aus ihr den Sammelscreen „Ausgewählte Vorkommen“, und der Planer und das Panel sind Geschwister.
 * `app.vue` legt sie an und reicht sie über `UNTERWEGS_AUSWAHL` herum; ohne sie (eine Probeseite, ein Bauteiltest) legt sich der Planer eine eigene an, die nur
 * die Etappen färbt und leuchten lässt.
 *
 * - **Das Infopanel folgt der Wahl:** Ändert sie sich, zeigt es ab zwei gewählten den Sammelscreen, bei genau einem dessen Infobox; bei keinem bleibt es, wie
 *   es ist. Steht die Infobox des Ankers schon vorn, öffnet nichts neu, und am Telefon klappt das Panel nicht auf (dieselbe Hand wie jede Infobox: `zeigeEintrag`).
 * - **Der Anker** ist der Eintrag, dessen Infobox die Auswahl zuletzt geöffnet hat; der Sammelscreen liegt über seinem Panel. Eine Infobox, die die Auswahl
 *   öffnet (Name in der Box, Name im Sammelscreen), trägt bei zwei oder mehr gewählten den Rückweg „‹ Ausgewählte Vorkommen (N)“.
 * - 🔴 **Je gewähltem Eintrag eine Farbe** (Vali 2026-10-30: „die jeweiligen regionen … sollten sich farblich unterscheiden“): ein Platz der Tafel
 *   `mapVorkommen<n>` (`search/vorkommen-farben.ts`) in der Reihenfolge der Wahl, der erste freie. Er bleibt am Eintrag, solange der gewählt ist: Wird einer
 *   entfernt, behalten die anderen ihre Farbe, und ein neuer nimmt die frei gewordene. Auf der Karte leuchtet jeder in seiner Farbe und trägt seinen Namen;
 *   die Kästchen der Box und die Karten des Sammelscreens zeigen dieselbe Farbe. Mit der Wahl enden die Farben.
 * - 🔴 **Die Kamera fliegt zu dem Vorkommen, das ein Klick zeigt oder hinzunimmt** (ersetzt „die Kamera bewegt sich nie“ aus S4). Vali 2026-10-30:
 *   „bei den ausgewählten vorkommen wärs schön, wenn bei "infobox öffnen" die kamera auch auf die ausgewählte fläche/stelle fliegt. hier wären die farben
 *   wichtig, dass man bei verschiedenen vorkommen eine andere farbe hat“ und „doch ein klick auf die auswahl bei den vorkommen unterwegs kann auch
 *   dahinfliegen, man sieht ja dann das ding auch in der infobox“. Geflogen wird beim Hinzunehmen (Kreis oder Zeile) und bei jedem Öffnen der Infobox
 *   (`oeffne`: der Name in der Liste, der Name eines Kästchens, der Name im Sammelscreen), auf den Rahmen seiner leuchtenden Flächen und
 *   Orte (`fliegeZu` im Umfeld). Nie beim Herausnehmen (Kreis, ✕, „alle entfernen“), bei einer neuen Route, beim Wechsel des Reiters und beim Suchen; ohne
 *   Fläche („Überall in Aventurien“) auch nicht. Alle gewählten behalten dabei Farbe und Namen.
 * - 🔴 **Die Wahl folgt dem Leuchten** (wie in S4): Endet es anderswo - ein anderes Subject, ein Klick in die freie Karte, eine neue Suche -, sobald es einmal
 *   stand, endet die Wahl mit, ohne das Panel anzufassen. Ein Öffnen aus der Auswahl selbst beendet sie nicht: Es lässt danach wieder leuchten (die Antworten
 *   sind gemerkt, `zeigeVereinigt`), und eine Frage, die noch läuft, zählt nicht als Ende.
 * - 🔴 **Ein gewählter Eintrag leuchtet nur an der Route** (Vali 2026-10-31: „kannst du bei selektionen von "vorkommen unterwegs" nur die gegenden anzeigen (also
 *   auch mehrfachauswahl zulassen), die von der route durchkreuzt werden (die auswahl rechts in der infobox) und in der farbe lassen (es wird gerade immer gelb,
 *   egal was ich drück), die es von "Ausgewählte vorkommen" erhalten hat und oben im icon hat“). Je gewähltem Eintrag fragt die Wahl einmal je Reise nach den
 *   Gegenden, die die Route kreuzt (`POST /api/route/unterwegs/gegenden`), und lässt nur sie leuchten. Seine Infobox listet nur sie; ein Klick wählt eine Gegend
 *   an oder ab (mehrere zugleich), „Alle an der Route“ nimmt die Wahl zurück. Das Leuchten bleibt dabei das der Wahl, in der Farbe des Eintrags; erst eine Gegend
 *   aus einer Infobox ohne Wahl lässt golden leuchten. Ohne Antwort (keine Reise, keine Fläche an der Route) leuchtet er ganz, und die Infobox ist die gewohnte.
 */
export interface UnterwegsAuswahl {
    /** Die gewählten Zeilen in der Reihenfolge der Wahl. */
    readonly zeilen: Readonly<ShallowRef<readonly UnterwegsZeile[]>>;
    /** Die Kennungen der gewählten. */
    readonly ids: ComputedRef<ReadonlySet<string>>;
    /** Je gewähltem Eintrag sein Platz in der Farbtafel (ab 1, `search/vorkommen-farben.ts`). */
    readonly farben: Readonly<ShallowRef<ReadonlyMap<string, number>>>;
    /** Was das Infopanel zeigt, solange zwei oder mehr gewählt sind: den Sammelscreen oder eine Infobox, die die Auswahl geöffnet hat. */
    readonly ansicht: Readonly<Ref<"sammel" | "eintrag">>;
    /** Der Eintrag, dessen Infobox die Auswahl zuletzt geöffnet hat; der Sammelscreen liegt über seinem Panel. */
    readonly anker: Readonly<Ref<string | undefined>>;
    /** Legt eine Zeile in die Auswahl oder nimmt sie heraus. */
    umschalten(zeile: UnterwegsZeile): void;
    /** Nimmt einen Eintrag aus der Auswahl. */
    entferne(id: string): void;
    /** Leert die Auswahl („alle entfernen“, eine neue Route) und beendet ihr Leuchten; das Panel bleibt, wie es ist. */
    leere(): void;
    /** Öffnet die Infobox eines Eintrags, ohne die Auswahl zu ändern (der Name ist ein Link), und lässt die Kamera auf sein Leuchten fliegen. */
    oeffne(zeile: Pick<UnterwegsZeile, "id" | "name" | "kind">): void;
    /** „‹ Ausgewählte Vorkommen (N)“: zurück zum Sammelscreen. */
    zurueck(): void;
    /** Trägt die Infobox dieses Eintrags den Rückweg zum Sammelscreen? Dann die Zahl der gewählten, sonst `undefined`. */
    rueckweg(id: string): number | undefined;
    /** Baut die Auswahl ab: Ihr Leuchten endet, die Wahl auch. */
    abbauen(): void;
    /** Die Reise, zu der die Wahl gehört (der Sammelscreen nennt sie im Kopf und misst den Anteil an ihren Etappen); `undefined`, solange kein Planer sie meldet. */
    readonly reise: Readonly<ShallowRef<UnterwegsReise | undefined>>;
    /** Der Planer meldet die Reise, sobald sie steht oder sich ändert (`route-overview.vue`). */
    setzeReise(reise: UnterwegsReise | undefined): void;
    /** Je gewähltem Eintrag seine Gegenden an der Route und welche davon leuchten; ein Eintrag ohne Antwort fehlt (er leuchtet ganz). */
    readonly anDerRoute: Readonly<ShallowRef<ReadonlyMap<string, UnterwegsGegenden>>>;
    /** Wählt eine Gegend des Eintrags an der Route an oder ab; zu einer, die dazukommt, fliegt die Kamera. */
    schalteGegend(id: string, key: string): void;
    /** „Alle an der Route“: Der Eintrag leuchtet wieder überall an der Route, und die Kamera fliegt hin. */
    alleAnDerRoute(id: string): void;
}

/** Start, Ziel und Zahl der Etappen der Reise, so wie der Planer sie nennt; dazu die Etappen als Anfrage (dieselbe wie für die Liste), wo es sie gibt. */
export interface UnterwegsReise {
    readonly von: string;
    readonly bis: string;
    readonly etappen: number;
    readonly anfrage?: RouteUnterwegsRequest | undefined;
}

/** Die Gegenden eines gewählten Eintrags an der Route (`POST /api/route/unterwegs/gegenden`) und die angewählten. */
export interface UnterwegsGegenden {
    readonly gegenden: readonly SearchEintragGegend[];
    /** Was er an der Route hat, auch Flächen ohne Namen: so leuchtet er, solange keine Gegend angewählt ist. */
    readonly alle: readonly SearchLeuchtAnfrage[];
    /** Die angewählten Gegenden (`key`); leer heißt „Alle an der Route“. */
    readonly gewaehlt: ReadonlySet<string>;
}

/**
 * Die angewählten Gegenden eines Eintrags als möglichst wenige Anfragen: alle Landschaften in einer (zu höchstens `SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX`), jedes Gebiet für
 * sich, denn eine Anfrage schneidet Landschaften mit EINEM Gebiet, statt sie zu vereinigen.
 */
export function zieleVereinigt(eintrag: string, ziele: readonly SearchLeuchtAnfrage[]): SearchLeuchtAnfrage[] {
    const landschaften = [...new Set(ziele.flatMap((ziel) => ziel.landschaften ?? []))];
    const gebiete = [...new Set(ziele.flatMap((ziel) => (ziel.gebiet === undefined ? [] : [ziel.gebiet])))];
    const anfragen: SearchLeuchtAnfrage[] = [];
    for (let at = 0; at < landschaften.length; at += SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX)
        anfragen.push({ eintrag, landschaften: landschaften.slice(at, at + SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX) });
    for (const gebiet of gebiete) anfragen.push({ eintrag, gebiet });
    return anfragen;
}

export interface UnterwegsAuswahlUmfeld {
    /** Das Leuchten der Suche (`SUCH_LEUCHTEN_ZUGANG`); ohne es färbt die Wahl nur die Etappen. */
    readonly zugang?: SuchLeuchtenZugang | undefined;
    /** Öffnet die Infobox eines Eintrags wie ein Treffer der Suche (`zeigeEintrag` in `app.vue`): Titel sofort, am Telefon eingeklappt mit der Pille. */
    readonly oeffneEintrag?: ((id: string, name: string, kind: LoreKind) => void) | undefined;
    /**
     * Die Kennung des Eintrags, dessen Infobox gerade steht: am Rechner nur, wenn das Panel vorn ist, am Telefon auch eingeklappt (dort ist das die Regel);
     * `undefined`, wo keine steht. Ohne diese Angabe öffnet die Auswahl nie ein Panel.
     */
    readonly eintragImPanel?: (() => string | undefined) | undefined;
    /** Lässt die Kamera auf das Leuchten eines Eintrags fliegen (`app.vue`: sein Rahmen samt Orten, die Ränder der Panels eingerechnet); ohne sie fliegt nichts. */
    readonly fliegeZu?: ((leuchten: SearchLeuchten) => void) | undefined;
    /** Fragt nach den Gegenden eines Eintrags an der Route; ohne Angabe der Server (`fetchUnterwegsGegenden`). */
    readonly holeGegenden?: typeof fetchUnterwegsGegenden | undefined;
}

export const UNTERWEGS_AUSWAHL: InjectionKey<UnterwegsAuswahl> = Symbol("unterwegs-auswahl");

const anfrageVon = (zeile: Pick<UnterwegsZeile, "id">): SearchLeuchtAnfrage => ({ eintrag: zeile.id });

export function createUnterwegsAuswahl(umfeld: UnterwegsAuswahlUmfeld = {}): UnterwegsAuswahl {
    const zugang = umfeld.zugang;
    const zeilen = shallowRef<readonly UnterwegsZeile[]>([]);
    const ansicht = ref<"sammel" | "eintrag">("eintrag");
    const anker = ref<string | undefined>(undefined);
    const ids = computed((): ReadonlySet<string> => new Set(zeilen.value.map((zeile) => zeile.id)));
    const farben = shallowRef<ReadonlyMap<string, number>>(new Map());
    const reise = shallowRef<UnterwegsReise | undefined>(undefined);
    const anDerRoute = shallowRef<ReadonlyMap<string, UnterwegsGegenden>>(new Map());
    const holeGegenden = umfeld.holeGegenden ?? fetchUnterwegsGegenden;

    type Geholt = Pick<UnterwegsGegenden, "gegenden" | "alle"> | null;
    /** Die Antworten zur jetzigen Reise je Eintrag (`null`: keine, er leuchtet ganz) und die laufenden Fragen; eine neue Reise beginnt beide neu. */
    let geholt = new Map<string, Geholt>();
    let fragen = new Map<string, Promise<void>>();
    let reiseFrage = new AbortController();

    /** `anDerRoute` folgt der Wahl: je gewähltem Eintrag mit Antwort seine Gegenden, die angewählten bleiben. */
    function anDerRouteNachfuehren(): void {
        const neu = new Map<string, UnterwegsGegenden>();
        for (const zeile of zeilen.value) {
            const daten = geholt.get(zeile.id);
            if (daten === undefined || daten === null) continue;
            neu.set(zeile.id, { ...daten, gewaehlt: anDerRoute.value.get(zeile.id)?.gewaehlt ?? new Set() });
        }
        anDerRoute.value = neu;
    }

    /** Fragt nach den Gegenden der gewählten, die noch fehlen; `undefined`, wenn nichts fehlt (dann leuchtet die Wahl noch im selben Zug). */
    function holeFehlende(): Promise<void> | undefined {
        const anfrage = reise.value?.anfrage;
        if (anfrage === undefined) return undefined;
        const offen = zeilen.value.filter((zeile) => !geholt.has(zeile.id));
        if (offen.length === 0) return undefined;
        const meine = geholt;
        const signal = reiseFrage.signal;
        return Promise.all(
            offen.map((zeile) => {
                let frage = fragen.get(zeile.id);
                if (frage === undefined) {
                    frage = holeGegenden({ eintrag: zeile.id, stages: anfrage.stages }, signal).then(
                        (antwort: RouteUnterwegsGegendenResponse | null) => {
                            if (meine !== geholt) return;
                            fragen.delete(zeile.id);
                            geholt.set(
                                zeile.id,
                                antwort === null || antwort.alle.length === 0
                                    ? null
                                    : { gegenden: antwort.gegenden, alle: antwort.alle },
                            );
                        },
                    );
                    fragen.set(zeile.id, frage);
                }
                return frage;
            }),
        ).then(() => anDerRouteNachfuehren());
    }

    /** Was für einen gewählten Eintrag leuchtet: die angewählten Gegenden, sonst alles an der Route, ohne Antwort der ganze Eintrag. */
    function anfragenDer(zeile: Pick<UnterwegsZeile, "id">): SearchLeuchtAnfrage[] {
        const daten = anDerRoute.value.get(zeile.id);
        if (daten === undefined) return [anfrageVon(zeile)];
        if (daten.gewaehlt.size === 0) return [...daten.alle];
        return zieleVereinigt(
            zeile.id,
            daten.gegenden.filter((gegend) => daten.gewaehlt.has(gegend.key)).map((gegend) => gegend.ziel),
        );
    }

    /** Die Farben folgen der Wahl: Ein Neuer nimmt den ersten freien Platz, ein Entfernter gibt seinen frei, die übrigen bleiben. */
    function farbenNachfuehren(): void {
        const neu = new Map<string, number>();
        for (const zeile of zeilen.value) {
            const platz = farben.value.get(zeile.id);
            if (platz !== undefined) neu.set(zeile.id, platz);
        }
        for (const zeile of zeilen.value) if (!neu.has(zeile.id)) neu.set(zeile.id, freierPlatz(neu.values()));
        farben.value = neu;
    }

    /** Der Schlüssel des Leuchtens, das zur Wahl gehört (`vereinigtSchluessel`); `undefined` ohne Wahl. */
    let soll: string | undefined;
    /** Hat das Leuchten der jetzigen Wahl schon gestanden? Erst dann heißt „es endet“, dass die Wahl endet. */
    let hatGeleuchtet = false;
    /** Läuft die Frage nach dem Leuchten noch? Dann zählt ein Ende nicht (das alte Leuchten steht noch oder ist gerade für das Öffnen beendet). */
    let laufend = false;
    /** Zählt jedes `leuchte`: Wartet eines auf Gegenden, leuchtet es danach nur, wenn kein jüngeres kam. */
    let leuchtRunde = 0;

    /** Die Wahl endet, weil ihr Leuchten anderswo endete: nichts beenden, was nicht uns gehört, das Panel nicht anfassen. */
    function verwerfe(): void {
        zeilen.value = [];
        farben.value = new Map();
        anDerRoute.value = new Map();
        ansicht.value = "eintrag";
        soll = undefined;
        hatGeleuchtet = false;
        laufend = false;
        leuchtRunde += 1;
    }

    /** Beendet das eigene Leuchten - seines oder die laufende Frage danach; ein fremdes (eine neue Suche) bleibt. */
    function beendeLeuchten(): void {
        if (zugang !== undefined && soll !== undefined && (laufend || zugang.aktiv.value === soll)) zugang.beende();
        soll = undefined;
        hatGeleuchtet = false;
        laufend = false;
        leuchtRunde += 1;
    }

    /**
     * Lässt alle gewählten zusammen leuchten, jeden in seiner Farbe mit seinem Namen, nur an der Route; erfüllt sich, sobald das Leuchten steht. Fehlen die Gegenden
     * eines gewählten noch, wartet es auf sie (das alte Leuchten bleibt so lange stehen).
     */
    function leuchte(): Promise<void> | undefined {
        if (zugang === undefined || zeilen.value.length === 0) return undefined;
        leuchtRunde += 1;
        const runde = leuchtRunde;
        const warten = holeFehlende();
        if (warten === undefined) return leuchteJetzt(zugang);
        laufend = true;
        return warten.then(() => (runde === leuchtRunde && zeilen.value.length > 0 ? leuchteJetzt(zugang) : undefined));
    }

    function leuchteJetzt(steuerung: SuchLeuchtenZugang): Promise<void> {
        // Je Anfrage die Farbe ihres Eintrags: Mehrere Anfragen eines Eintrags (Landschaften, Gebiete) werden auf der Karte wieder EIN Teil.
        const teile = zeilen.value.flatMap((zeile) => {
            const farbe = {
                farbe: vorkommenFarbe(farben.value.get(zeile.id) ?? 1),
                name: zeile.name,
                kind: zeile.kind,
            };
            return anfragenDer(zeile).map((anfrage) => ({ anfrage, farbe }));
        });
        const anfragen = teile.map((teil) => teil.anfrage);
        const farbig = teile.map((teil) => teil.farbe);
        const key = vereinigtSchluessel(anfragen);
        soll = key;
        hatGeleuchtet = false;
        laufend = true;
        return steuerung.zeigeVereinigt(anfragen, farbig).then((antwort) => {
            if (soll !== key) return;
            laufend = false;
            const aktiv = steuerung.aktiv.value;
            if (aktiv === key) {
                hatGeleuchtet = true;
                return;
            }
            // Während unsere Frage lief, hat eine fremde das Leuchten übernommen (eine neue Suche): Die Wahl folgt ihm.
            if (antwort === undefined && aktiv !== undefined) verwerfe();
        });
    }

    function oeffneInfobox(zeile: Pick<UnterwegsZeile, "id" | "name" | "kind">): void {
        anker.value = zeile.id;
        umfeld.oeffneEintrag?.(zeile.id, zeile.name, zeile.kind);
    }

    /**
     * Lässt die Kamera auf das Leuchten dieses Eintrags fliegen, sobald das Leuchten der Wahl steht: aus der Antwort, die die Karte gerade zeigt, sonst (ein
     * nicht gewählter Eintrag, dessen Name die Infobox öffnet) aus der gemerkten oder einmal geholten Antwort. Hat sich die Wahl inzwischen geändert, fliegt nichts.
     */
    function fliegeNach(zeile: Pick<UnterwegsZeile, "id">, steht: Promise<void> | undefined): void {
        const fliege = umfeld.fliegeZu;
        if (fliege === undefined || zugang === undefined) return;
        // Hat sich die Wahl inzwischen geändert (ein Eintrag mehr oder weniger), fliegt nichts.
        const vorher = zeilen.value;
        void (async () => {
            await steht;
            const key = soll;
            if (zeilen.value !== vorher) return;
            const teil = zugang.bild.value?.teile?.find((eintrag) => eintrag.id === zeile.id);
            const leuchten = teil?.leuchten ?? (await zugang.leuchtenVon(anfrageVon(zeile)));
            if (leuchten !== undefined && soll === key) fliege(leuchten);
        })();
    }

    /** Wie `fliegeNach`, zu einer einzelnen Gegend (ihre Antwort, gemerkt oder einmal geholt). */
    function fliegeZurGegend(ziel: SearchLeuchtAnfrage, steht: Promise<void> | undefined): void {
        const fliege = umfeld.fliegeZu;
        if (fliege === undefined || zugang === undefined) return;
        // Hat sich die Wahl inzwischen geändert (ein Eintrag mehr oder weniger), fliegt nichts.
        const vorher = zeilen.value;
        void (async () => {
            await steht;
            const key = soll;
            if (zeilen.value !== vorher) return;
            const leuchten = await zugang.leuchtenVon(ziel);
            if (leuchten !== undefined && soll === key) fliege(leuchten);
        })();
    }

    /** Nach jeder Änderung der Wahl: das Panel nachführen (ab zwei der Sammelscreen, bei einem dessen Infobox, bei keinem nichts) und neu leuchten. */
    function nachWahl(zuletzt: UnterwegsZeile | undefined): Promise<void> | undefined {
        farbenNachfuehren();
        anDerRouteNachfuehren();
        const liste = zeilen.value;
        if (liste.length === 0) {
            ansicht.value = "eintrag";
            beendeLeuchten();
            return undefined;
        }
        const offen = umfeld.eintragImPanel?.();
        if (liste.length === 1) {
            const einzige = liste[0] as UnterwegsZeile;
            ansicht.value = "eintrag";
            if (offen === einzige.id) anker.value = einzige.id;
            else if (umfeld.eintragImPanel !== undefined) oeffneInfobox(einzige);
        } else {
            ansicht.value = "sammel";
            if (umfeld.eintragImPanel !== undefined && (offen === undefined || offen !== anker.value))
                oeffneInfobox(zuletzt ?? (liste[liste.length - 1] as UnterwegsZeile));
        }
        return leuchte();
    }

    function umschalten(zeile: UnterwegsZeile): void {
        if (ids.value.has(zeile.id)) {
            zeilen.value = zeilen.value.filter((eintrag) => eintrag.id !== zeile.id);
            void nachWahl(undefined);
        } else {
            zeilen.value = [...zeilen.value, zeile];
            // Hinzunehmen fliegt zum neuen Eintrag, Herausnehmen nie.
            fliegeNach(zeile, nachWahl(zeile));
        }
    }

    function entferne(id: string): void {
        if (!ids.value.has(id)) return;
        zeilen.value = zeilen.value.filter((eintrag) => eintrag.id !== id);
        void nachWahl(undefined);
    }

    function leere(): void {
        if (zeilen.value.length === 0) return;
        zeilen.value = [];
        void nachWahl(undefined);
    }

    function oeffne(zeile: Pick<UnterwegsZeile, "id" | "name" | "kind">): void {
        ansicht.value = "eintrag";
        oeffneInfobox(zeile);
        // Das Öffnen beendet das Leuchten (`present` in `app.vue`): Die Wahl bleibt und leuchtet wieder, aus den gemerkten Antworten noch im selben Zug.
        fliegeNach(zeile, leuchte());
    }

    function zurueck(): void {
        if (zeilen.value.length >= 2) ansicht.value = "sammel";
    }

    function rueckweg(id: string): number | undefined {
        const n = zeilen.value.length;
        return n >= 2 && ansicht.value === "eintrag" && anker.value === id ? n : undefined;
    }

    const stop: WatchStopHandle = watch(
        () => zugang?.aktiv.value,
        (aktiv) => {
            if (zeilen.value.length === 0 || laufend || soll === undefined) return;
            if (aktiv === soll) {
                hatGeleuchtet = true;
                return;
            }
            if (hatGeleuchtet) verwerfe();
        },
    );

    function abbauen(): void {
        stop();
        reiseFrage.abort();
        if (zeilen.value.length === 0) return;
        zeilen.value = [];
        farben.value = new Map();
        anDerRoute.value = new Map();
        ansicht.value = "eintrag";
        beendeLeuchten();
    }

    function setzeReise(neu: UnterwegsReise | undefined): void {
        const alt = reise.value;
        if (
            alt?.von === neu?.von &&
            alt?.bis === neu?.bis &&
            alt?.etappen === neu?.etappen &&
            alt?.anfrage === neu?.anfrage
        )
            return;
        reise.value = neu;
        // Andere Etappen, andere Gegenden: Die Antworten der alten Reise gelten nicht mehr.
        if (alt?.anfrage !== neu?.anfrage) {
            reiseFrage.abort();
            reiseFrage = new AbortController();
            geholt = new Map();
            fragen = new Map();
            anDerRoute.value = new Map();
        }
    }

    function setzeGewaehlt(id: string, daten: UnterwegsGegenden, gewaehlt: ReadonlySet<string>): void {
        const neu = new Map(anDerRoute.value);
        neu.set(id, { ...daten, gewaehlt });
        anDerRoute.value = neu;
    }

    function schalteGegend(id: string, key: string): void {
        const daten = anDerRoute.value.get(id);
        const gegend = daten?.gegenden.find((kandidat) => kandidat.key === key);
        if (daten === undefined || gegend === undefined) return;
        const gewaehlt = new Set(daten.gewaehlt);
        const dazu = !gewaehlt.has(key);
        if (dazu) gewaehlt.add(key);
        else gewaehlt.delete(key);
        setzeGewaehlt(id, daten, gewaehlt);
        const steht = leuchte();
        // Eine Gegend, die dazukommt, holt die Kamera; abwählen bewegt sie nicht.
        if (dazu) fliegeZurGegend(gegend.ziel, steht);
    }

    function alleAnDerRoute(id: string): void {
        const daten = anDerRoute.value.get(id);
        if (daten === undefined) return;
        if (daten.gewaehlt.size > 0) setzeGewaehlt(id, daten, new Set());
        fliegeNach({ id }, leuchte());
    }

    return {
        zeilen,
        ids,
        farben,
        ansicht,
        anker,
        umschalten,
        entferne,
        leere,
        oeffne,
        zurueck,
        rueckweg,
        abbauen,
        reise,
        setzeReise,
        anDerRoute,
        schalteGegend,
        alleAnDerRoute,
    };
}
