import {
    MAP_HISTORY_OBJECT_KINDS,
    type MapHistoryEntry,
    type MapHistoryObject,
    type MapHistoryObjectKind,
    type MapHistorySeries,
    type MapHistoryStatus,
    type SubjectRef,
} from "@avesmaps3d/shared";

/**
 * Das Modell des Reiters „Änderungen“ ohne Vue und ohne Browser (WI-0265 B5a; Probierseite `review/wi-0265/aenderungen.html`, WI-0265 §11):
 * die Filter und die Frage an den Server, die Arbeitsserien als Gruppen der Liste, der Zustand als Kreis, das Ziel eines Sprungs in den
 * Objektverlauf. Alles, was ein Test ohne Bauteil prüfen soll, steht hier; die Bauteile in diesem Ordner zeichnen es nur.
 *
 * Gerechnet wird nichts, was der Server schon weiß: Zustand, Rücknahme-Bezug und Serien kommen fertig in der Antwort
 * (`packages/shared/src/editor-history.ts`), die Filter wirken dort. Die Oberfläche gruppiert und zählt nur, was geliefert wurde.
 */

export type Tab = "meine" | "alle";

/** Der Zeitraum, den der Trichter anbietet; der Server kennt `from` und `to` mit Zeitzone. */
export const ZEITRAEUME = ["heute", "tage7", "tage30", "jahr"] as const;
export type Zeitraum = (typeof ZEITRAEUME)[number];

/** Die Arten, die der Trichter anbietet: Teilflächen, Beschriftungen und Nodices findet ihre Fläche beziehungsweise Linie mit (Server, `kind`). */
export const FILTER_ARTEN = [
    "place",
    "path",
    "powerline",
    "landscape",
    "territory",
    "peak",
    "sprache",
    "sprache_artikel",
    "source",
    "work",
    "lore",
    "corpus",
] as const satisfies readonly MapHistoryObjectKind[];

export const STATUS_WERTE = [
    "ruecknehmbar",
    "bereits_zurueckgenommen",
    "nicht_ruecknehmbar",
] as const satisfies readonly MapHistoryStatus[];

/** Ein einzelner Gegenstand als Filter: die Kennung für den Server (`<art>:<kennung>`) und sein Name für das Etikett. */
export interface ObjektFilter {
    readonly ref: string;
    readonly name: string;
}

export interface AenderungenFilter {
    readonly tab: Tab;
    /** `actor.id` oder `geloescht`; unter „Meine“ gilt nur man selbst. */
    readonly person: string | undefined;
    readonly zeitraum: Zeitraum | undefined;
    readonly art: MapHistoryObjectKind | undefined;
    readonly objekt: ObjektFilter | undefined;
    readonly status: MapHistoryStatus | undefined;
    readonly q: string;
    /** Die Felder, deren angezeigter Name den Freitext enthält (nur die Oberfläche kennt die Namen). */
    readonly qFelder: readonly string[];
}

export const LEERER_FILTER: AenderungenFilter = {
    tab: "alle",
    person: undefined,
    zeitraum: undefined,
    art: undefined,
    objekt: undefined,
    status: undefined,
    q: "",
    qFelder: [],
};

/** Wie viele Filter der Trichter zählt: Person, Zeitraum, Art, Objekt und Zustand; „Meine“ und die Suche haben ihr eigenes Zeichen. */
export function gesetzteFilter(filter: AenderungenFilter): number {
    return [filter.person, filter.zeitraum, filter.art, filter.objekt, filter.status].filter(
        (wert) => wert !== undefined,
    ).length;
}

/** Der Anfang des Zeitraums in Ortszeit der Person, die ihn wählt; der Server bekommt ihn mit Zeitzone. */
export function zeitraumVon(zeitraum: Zeitraum, jetzt: Date): Date {
    if (zeitraum === "heute") return new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
    if (zeitraum === "jahr") return new Date(jetzt.getFullYear(), 0, 1);
    return new Date(jetzt.getTime() - (zeitraum === "tage7" ? 7 : 30) * 86_400_000);
}

export interface FrageOptionen {
    /** Der Cursor der Seite (die kleinste gelieferte `seq`). */
    readonly before?: number | undefined;
    readonly limit?: number | undefined;
    readonly jetzt: Date;
}

/** Die Frage an `GET /api/editor/changes` als Abfragetext (ohne `?`); alle Filter wirken auf dem Server. */
export function aenderungenFrage(filter: AenderungenFilter, optionen: FrageOptionen): string {
    const frage = new URLSearchParams();
    if (filter.tab === "meine") frage.set("mine", "true");
    else if (filter.person !== undefined) frage.set("person", filter.person);
    if (filter.zeitraum !== undefined) frage.set("from", zeitraumVon(filter.zeitraum, optionen.jetzt).toISOString());
    if (filter.art !== undefined) frage.set("kind", filter.art);
    if (filter.objekt !== undefined) frage.set("object", filter.objekt.ref);
    if (filter.status !== undefined) frage.set("status", filter.status);
    const text = filter.q.trim();
    if (text !== "") {
        frage.set("q", text);
        if (filter.qFelder.length > 0) frage.set("qFelder", filter.qFelder.join(","));
    }
    if (optionen.limit !== undefined) frage.set("limit", String(optionen.limit));
    if (optionen.before !== undefined) frage.set("before", String(optionen.before));
    return frage.toString();
}

/** Die Art eines Gegenstands als Schlüssel des Filters `object`. */
export const objektRef = (gegenstand: Pick<MapHistoryObject, "kind" | "id">): string =>
    `${gegenstand.kind}:${gegenstand.id}`;

// --- Zustand und Kreis -----------------------------------------------------------------------------------------------

/**
 * Die Stufe des Kreises einer Zeile. ● wirksam, ◐ teils zurückgenommen (nur eine Serie), ○ zurückgenommen, gesperrt: das Bauteil
 * zeichnet für „nicht rücknehmbar“ einen durchgestrichenen Kreis, weil die Liste einen vierten Zustand braucht (Probierseite).
 */
export type Kreis = "voll" | "halb" | "leer" | "gesperrt";

export function eintragsKreis(status: MapHistoryStatus | undefined): Kreis | undefined {
    if (status === undefined) return undefined;
    if (status === "ruecknehmbar") return "voll";
    return status === "bereits_zurueckgenommen" ? "leer" : "gesperrt";
}

// --- Serien ----------------------------------------------------------------------------------------------------------

export interface EintragsZeile {
    readonly art: "eintrag";
    readonly eintrag: MapHistoryEntry;
}

/** Eine Arbeitsserie in der Liste: die gelieferten Mitglieder, neueste zuerst (wie die Liste), an der Stelle des neuesten. */
export interface SerienZeile {
    readonly art: "serie";
    readonly id: string;
    readonly meta: MapHistorySeries | undefined;
    readonly mitglieder: readonly MapHistoryEntry[];
}

export type ListenZeile = EintragsZeile | SerienZeile;

/**
 * Gruppiert die Liste nach Arbeitsserien. Eine Serie steht dort, wo ihr neuestes gelieferte Mitglied steht; die übrigen Mitglieder
 * rücken in sie hinein, auch wenn andere Einträge dazwischen lagen (die Serie gilt je Gegenstand, nicht je Zeitfolge der ganzen Karte).
 * Ein Eintrag ohne `series` bleibt, was er ist. Die Reihenfolge der Eingabe (neueste zuerst) bleibt in jeder Gruppe erhalten.
 */
export function gruppiere(
    eintraege: readonly MapHistoryEntry[],
    serien: ReadonlyMap<string, MapHistorySeries>,
): ListenZeile[] {
    const zeilen: ListenZeile[] = [];
    const gruppen = new Map<string, MapHistoryEntry[]>();
    for (const eintrag of eintraege) {
        const id = eintrag.series?.id;
        if (id === undefined) {
            zeilen.push({ art: "eintrag", eintrag });
            continue;
        }
        const bisher = gruppen.get(id);
        if (bisher !== undefined) {
            bisher.push(eintrag);
            continue;
        }
        const mitglieder = [eintrag];
        gruppen.set(id, mitglieder);
        zeilen.push({ art: "serie", id, meta: serien.get(id), mitglieder });
    }
    return zeilen;
}

/** Wie viele Operationen eine Zeile trägt. */
export const zeilenGroesse = (zeile: ListenZeile): number => (zeile.art === "serie" ? zeile.mitglieder.length : 1);

/** Der Name der Serie: der Gegenstand der Serie, sonst der erste Name, den ein Mitglied nennt. */
export function serienName(zeile: SerienZeile): string | undefined {
    const aus = zeile.meta?.scope.name;
    if (aus !== undefined && aus !== "") return aus;
    for (const mitglied of zeile.mitglieder)
        for (const gegenstand of mitglied.objects) if (gegenstand.name !== undefined) return gegenstand.name;
    return undefined;
}

/** Die Gesamtzahl der Mitglieder: die der Serie, sonst die gelieferten. */
export const serienGroesse = (zeile: SerienZeile): number =>
    zeile.meta?.size ?? zeile.mitglieder[0]?.series?.size ?? zeile.mitglieder.length;

/** Das älteste und das neueste gelieferte Mitglied. */
export function serienEnden(zeile: SerienZeile): {
    readonly erstes: MapHistoryEntry;
    readonly letztes: MapHistoryEntry;
} {
    const letztes = zeile.mitglieder[0];
    const erstes = zeile.mitglieder[zeile.mitglieder.length - 1];
    if (letztes === undefined || erstes === undefined) throw new Error("Eine Serie hat mindestens ein Mitglied.");
    return { erstes, letztes };
}

/**
 * Der Zustand einer Serie aus den gelieferten Mitgliedern: ○, wenn alle zurückgenommen sind; ◐ mit der Zahl der zurückgenommenen, wenn
 * es einige sind; sonst ● (sind nur nicht rücknehmbare da: gesperrt). Mitglieder ohne Zustand zählen als wirksam.
 */
export function serienZustand(zeile: SerienZeile): { readonly kreis: Kreis; readonly zurueck: number } {
    const zurueck = zeile.mitglieder.filter((m) => m.status === "bereits_zurueckgenommen").length;
    if (zurueck === zeile.mitglieder.length) return { kreis: "leer", zurueck };
    if (zurueck > 0) return { kreis: "halb", zurueck };
    if (zeile.mitglieder.every((m) => m.status === "nicht_ruecknehmbar")) return { kreis: "gesperrt", zurueck };
    return { kreis: "voll", zurueck };
}

/** Die Zählung der Legende: Operationen je Zustand und Serien, die teils zurückgenommen sind. */
export interface Zaehlung {
    readonly wirksam: number;
    readonly zurueck: number;
    readonly gesperrt: number;
    readonly teils: number;
    readonly geladen: number;
}

export function zaehle(eintraege: readonly MapHistoryEntry[], zeilen: readonly ListenZeile[]): Zaehlung {
    let wirksam = 0;
    let zurueck = 0;
    let gesperrt = 0;
    for (const eintrag of eintraege) {
        if (eintrag.status === "bereits_zurueckgenommen") zurueck += 1;
        else if (eintrag.status === "nicht_ruecknehmbar") gesperrt += 1;
        else wirksam += 1;
    }
    const teils = zeilen.filter((zeile) => zeile.art === "serie" && serienZustand(zeile).kreis === "halb").length;
    return { wirksam, zurueck, gesperrt, teils, geladen: eintraege.length };
}

// --- Personen --------------------------------------------------------------------------------------------------------

/** Die Personen, die in den gelieferten Einträgen handeln (mit Kennung), für den Trichter; sortiert nach Name. */
export function personenAus(
    eintraege: readonly MapHistoryEntry[],
    bisher: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
    const raus = new Map(bisher);
    for (const eintrag of eintraege)
        if (eintrag.actor.kind === "person" && eintrag.actor.id !== undefined && eintrag.actor.name !== undefined)
            raus.set(eintrag.actor.id, eintrag.actor.name);
    return new Map([...raus].sort((a, b) => a[1].localeCompare(b[1])));
}

// --- Sprung in den Objektverlauf -------------------------------------------------------------------------------------

/** Wohin „Im Objektverlauf zeigen“ führt: die Art des Subjekts, das die Auswahl öffnet, und das Werkzeug, das den Verlauf trägt. */
export interface ObjektZiel {
    readonly subject: "place" | "path" | "powerline" | "area" | "territory" | "peak" | "sprache";
    readonly werkzeug:
        "ortseditor" | "wegeditor" | "kraftlinieneditor" | "landschaftseditor" | "gebietseditor" | "spracheditor";
}

const ZIELE: Partial<Record<MapHistoryObjectKind, ObjektZiel>> = {
    place: { subject: "place", werkzeug: "ortseditor" },
    path: { subject: "path", werkzeug: "wegeditor" },
    powerline: { subject: "powerline", werkzeug: "kraftlinieneditor" },
    // Die Derographie-Fläche heißt im Verlauf `landscape`, als Subjekt `area` (dieselbe Kennung: die der Region).
    landscape: { subject: "area", werkzeug: "landschaftseditor" },
    territory: { subject: "territory", werkzeug: "gebietseditor" },
    peak: { subject: "peak", werkzeug: "landschaftseditor" },
    sprache: { subject: "sprache", werkzeug: "spracheditor" },
};

export const objektZiel = (kind: MapHistoryObjectKind): ObjektZiel | undefined => ZIELE[kind];

/**
 * Das Subjekt, das die Auswahl für einen Gegenstand des Verlaufs öffnet. 🔴 Nicht jede Art nennt ihre Kennung `id`: Ein Weg und eine Kraftlinie
 * sind die Gruppe ihrer Abschnitte und tragen den `anchor` (`packages/shared/src/subject.ts`); eine Karte, die `{ kind: "path", id }` bekäme,
 * öffnete nichts. Der Verlauf nennt die Kennung des Abschnitts, und jeder Abschnitt kann Anker sein.
 */
export function subjektRefVon(ziel: ObjektZiel, id: string): SubjectRef {
    switch (ziel.subject) {
        case "path":
            return { kind: "path", anchor: id };
        case "powerline":
            return { kind: "powerline", anchor: id };
        case "place":
            return { kind: "place", id };
        case "area":
            return { kind: "area", id };
        case "territory":
            return { kind: "territory", id };
        case "peak":
            return { kind: "peak", id };
        case "sprache":
            return { kind: "sprache", id };
    }
}

/** Wie die Seite das Objekt eines Gegenstands öffnet: das Subjekt, das Werkzeug und die Art der Öffnung. */
export interface OeffnenPlan {
    readonly ref: SubjectRef;
    readonly werkzeug: ObjektZiel["werkzeug"];
    /** Der Ort öffnet sein Fenster über das Werkzeug für das gewählte Subjekt; alle anderen folgen einer Öffnung `map`. */
    readonly optionen: { readonly source: "link" | "map"; readonly camera: "target"; readonly still?: true };
    /** Das Werkzeug zuerst öffnen (Weg und Sprache folgen nur einem Fenster, das schon da ist)? */
    readonly werkzeugZuerst: boolean;
}

/**
 * 🔴 Die Fenster der Editoren öffnen sich für ein Subjekt nur bei `source: "map"` ohne `still` (`geoeffnet` in den `*-steuerung.ts`); mit `link`
 * und `still` wählte die Seite das Objekt, öffnete aber kein Fenster. Der Ortseditor ist die Ausnahme: ⚙ öffnet ihn über das Werkzeug für das
 * gewählte Subjekt (`oeffneWerkzeug`). Ein Wegefenster und ein Sprachfenster folgen nur einem offenen Fenster, das Werkzeug kommt darum zuerst.
 */
export function oeffnenPlan(ziel: ObjektZiel, id: string): OeffnenPlan {
    const ref = subjektRefVon(ziel, id);
    if (ziel.subject === "place")
        return {
            ref,
            werkzeug: ziel.werkzeug,
            optionen: { source: "link", camera: "target", still: true },
            werkzeugZuerst: false,
        };
    return {
        ref,
        werkzeug: ziel.werkzeug,
        optionen: { source: "map", camera: "target" },
        werkzeugZuerst: ziel.subject === "path" || ziel.subject === "sprache",
    };
}

/** Eine Spalte des Gebirges (`area.gebirge`) steht im Detail als eigene Zeile `gebirge:<Spalte>`: Vorher und Nachher je Wert, nicht als ganze Tafel. */
export const GEBIRGE_PRAEFIX = "gebirge:";

/** Der Gegenstand einer Operation, zu dem „Im Objektverlauf zeigen“ springt: der erste, der einen Objektverlauf hat. */
export const sprungGegenstand = (eintrag: MapHistoryEntry): MapHistoryObject | undefined =>
    eintrag.objects.find((gegenstand) => ZIELE[gegenstand.kind] !== undefined);

/** Ist `kind` eine Art, die der Server kennt (für eine Auswahl aus der Adresse oder dem Gedächtnis)? */
export const istObjektArt = (wert: string): wert is MapHistoryObjectKind =>
    (MAP_HISTORY_OBJECT_KINDS as readonly string[]).includes(wert);
