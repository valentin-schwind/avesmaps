import {
    PATH_NAME_MAX,
    STRASSEN_ASSISTENT_MAX,
    isPathHandle,
    type StrasseStreckeAntwort,
    type StrasseZuweisenBody,
    type StrassenAbschnitt,
    type StrassenOrt,
    type StrassenZustand,
} from "@avesmaps3d/shared";

/**
 * Der Straßen-Assistent im Wegeditor (WI-0310; Vali 2026-11-11, Entwurf Fassung 3): die Rechnung hinter dem Fenster, ohne DOM und ohne Texte,
 * damit Vitest sie prüft (`test/strassen-assistent.test.ts`). Die Strecke zwischen den Orten rechnet der Server
 * (`POST /api/editor/paths/strassen-assistent/strecke`); hier steht, was die Oberfläche daraus macht:
 *
 * - **Welche Abschnitte sich änderten** (`geaendert`): die angehakten auf der Strecke. Angehakt ist von selbst, was ◐ (ohne Artikel) oder ○
 *   (ohne Namen) ist; ein fertiger Abschnitt ändert nichts, und ein Abschnitt einer anderen Straße (⇄) bleibt, bis jemand ihn anhakt.
 * - **Der Zustand folgt dem Namen im Feld.** Der Server nennt den Zustand für den Namen und den Artikel, die er selbst vorschlug. Ändert der
 *   Mensch das Namensfeld oder wählt er den Artikel ab, rechnet die Oberfläche den Zustand aus Name, Wegtyp und Hauptartikel des Abschnitts
 *   selbst nach (`zustandFuer`, dieselbe Regel wie der Server); die Strecke selbst und die Abschnitte abseits bleiben die des Servers.
 * - **„Zuweisen würde schreiben“** (`schreibt`): je Punkt eine Zahl, aus denselben Abschnitten, die der Körper (`zuweisenBody`) schickt.
 * - **Warum „Zuweisen“ gesperrt ist** (`zuweisenGrund`): Fehler verhindern statt erklären.
 */

/** Ab diesem Verhältnis von Strecke zu Luftlinie gilt der Weg zwischen zwei Orten als Umweg. */
export const UMWEG_AB = 1.5;

/** Was der Mensch an der Vorgabe geändert hat. */
export interface AssistentWahl {
    /** Abschnitte ◐ ○, deren Haken er abgenommen hat. */
    readonly aus: ReadonlySet<string>;
    /** Abschnitte ⇄ (andere Straße), die er angehakt hat. */
    readonly rein: ReadonlySet<string>;
    /** Was mit den Abschnitten abseits der Strecke geschieht. */
    readonly abseits: "lassen" | "entfernen";
    /** Die Quellen der Straße an die Abschnitte geben, denen sie fehlen. */
    readonly quellen: boolean;
}

export const neueWahl = (): AssistentWahl => ({ aus: new Set(), rein: new Set(), abseits: "lassen", quellen: true });

export interface AssistentEingabe {
    readonly antwort: StrasseStreckeAntwort;
    /** Der Name im Feld (noch nicht getrimmt). */
    readonly name: string;
    /** Der Hauptartikel, der gelten soll; `null`: ohne Artikel. */
    readonly key: string | null;
    readonly wahl: AssistentWahl;
}

/** Der Zustand eines Abschnitts für einen Namen und einen Artikel (Fassung 3: ● fertig, ◐ ohne Artikel, ○ ohne Namen, ⇄ andere Straße). */
export function zustandFuer(abschnitt: StrassenAbschnitt, name: string, key: string | null): StrassenZustand {
    const soll = name.trim();
    if (soll !== "" && abschnitt.name.trim() === soll)
        return key === null || abschnitt.wiki?.key === key ? "fertig" : "artikel";
    return isPathHandle(abschnitt.name, abschnitt.subtype) ? "name" : "fremd";
}

export interface Schreibt {
    /** Wie viele Abschnitte die Operation schreibt (mit Namen, Artikel oder Quellen, dazu die abseits). */
    readonly abschnitte: number;
    /** Abschnitte, die einen anderen Namen bekommen. */
    readonly name: number;
    /** Abschnitte, die den Hauptartikel bekommen. */
    readonly artikel: number;
    /** An einem dieser Abschnitte hing ein anderer Artikel: Er geht in den Verlauf. */
    readonly artikelErsetzt: boolean;
    /** Abschnitte, die die Quellen der Straße bekommen. */
    readonly quellen: number;
    /** Wie viele Quellen die Straße hat. */
    readonly quellenAnzahl: number;
    /** Abschnitte abseits, die Namen und Artikel verlieren. */
    readonly abseits: number;
}

export interface AssistentModell {
    /** Die Abschnitte der Strecke in Fahrtfolge, jeder einmal. */
    readonly strecke: readonly string[];
    readonly zustand: Readonly<Record<string, StrassenZustand>>;
    /** Die Abschnitte der Strecke, die das Zuweisen schreibt. */
    readonly geaendert: ReadonlySet<string>;
    /** Die Abschnitte abseits, die das Zuweisen entfernt (leer bei „lassen“). */
    readonly entfernen: readonly string[];
    readonly zaehlung: Readonly<Record<StrassenZustand, number>>;
    /** Summe der Wege zwischen den Orten in Meilen. */
    readonly laenge: number;
    readonly schreibt: Schreibt;
}

/** Gilt für diese Eingabe noch, was der Server für seinen Vorschlag rechnete? */
const beimVorschlag = (e: AssistentEingabe): boolean =>
    e.name.trim() === e.antwort.name && e.key === (e.antwort.artikel?.key ?? null);

export function rechneAssistent(e: AssistentEingabe): AssistentModell {
    const { antwort, wahl } = e;
    const strecke = [...new Set(antwort.teile.flatMap((teil) => teil.abschnitte))].filter(
        (id) => antwort.abschnitte[id] !== undefined,
    );
    const vorschlag = beimVorschlag(e);
    const zustand: Record<string, StrassenZustand> = {};
    for (const id of [...strecke, ...antwort.abseits]) {
        const a = antwort.abschnitte[id];
        if (a !== undefined) zustand[id] = vorschlag ? a.zustand : zustandFuer(a, e.name, e.key);
    }
    const geaendert = new Set(
        strecke.filter((id) => {
            const z = zustand[id];
            return z === "fertig" ? false : z === "fremd" ? wahl.rein.has(id) : !wahl.aus.has(id);
        }),
    );
    const zaehlung: Record<StrassenZustand, number> = { fertig: 0, artikel: 0, name: 0, fremd: 0 };
    for (const id of strecke) zaehlung[zustand[id] ?? "fremd"] += 1;
    const entfernen = wahl.abseits === "entfernen" ? antwort.abseits.filter((id) => antwort.abschnitte[id]) : [];

    const name = e.name.trim();
    const mit = [...geaendert].flatMap((id) => antwort.abschnitte[id] ?? []);
    const quellenAnzahl = antwort.quellen.length;
    const schreibt: Schreibt = {
        abschnitte: geaendert.size + entfernen.length,
        name: mit.filter((a) => a.name.trim() !== name).length,
        artikel: e.key === null ? 0 : mit.filter((a) => a.wiki?.key !== e.key).length,
        artikelErsetzt: e.key !== null && mit.some((a) => a.wiki !== null && a.wiki.key !== e.key),
        quellen: wahl.quellen && quellenAnzahl > 0 ? mit.filter((a) => a.quellen < quellenAnzahl).length : 0,
        quellenAnzahl,
        abseits: entfernen.length,
    };
    const laenge = antwort.teile.reduce((summe, teil) => summe + (teil.laenge ?? 0), 0);
    return { strecke, zustand, geaendert, entfernen, zaehlung, laenge, schreibt };
}

/** Der Körper für „Zuweisen“: die angehakten Abschnitte mit der Revision, die das Fenster gelesen hat. */
export function zuweisenBody(m: AssistentModell, e: AssistentEingabe, operationId: string): StrasseZuweisenBody {
    const mitRevision = (id: string): { publicId: string; baseRevision: number } => ({
        publicId: id,
        baseRevision: e.antwort.abschnitte[id]?.revision ?? 1,
    });
    return {
        operationId,
        name: e.name.trim(),
        key: e.key,
        quellen: e.wahl.quellen && e.antwort.quellen.length > 0,
        sections: m.strecke.filter((id) => m.geaendert.has(id)).map(mitRevision),
        entfernen: m.entfernen.map(mitRevision),
    };
}

export type ZuweisenGrund = "recht" | "laedt" | "laeuft" | "kein-name" | "griff" | "zu-lang" | "zu-viele" | "nichts";

/** Warum „Zuweisen“ gerade nichts tut; `undefined`, wenn es geht. */
export function zuweisenGrund(
    m: AssistentModell,
    e: AssistentEingabe,
    lage: { readonly darf: boolean; readonly laedt: boolean; readonly laeuft: boolean },
): ZuweisenGrund | undefined {
    if (!lage.darf) return "recht";
    if (lage.laeuft) return "laeuft";
    if (lage.laedt) return "laedt";
    const name = e.name.trim();
    if (name === "") return "kein-name";
    const arten = [...m.geaendert].flatMap((id) => e.antwort.abschnitte[id]?.subtype ?? []);
    if ((arten.length === 0 ? [""] : arten).some((art) => isPathHandle(name, art))) return "griff";
    if (name.length > PATH_NAME_MAX) return "zu-lang";
    if (m.geaendert.size > STRASSEN_ASSISTENT_MAX || m.entfernen.length > STRASSEN_ASSISTENT_MAX) return "zu-viele";
    if (m.schreibt.abschnitte === 0) return "nichts";
    return undefined;
}

// --- Die Liste der Orte ---

const abstand = (a: Pick<StrassenOrt, "x" | "y">, b: Pick<StrassenOrt, "x" | "y">): number =>
    Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Fügt einen Ort an der Stelle mit dem kleinsten Umweg ein (die Strecke zwischen den Nachbarn wird am wenigsten länger). Steht er schon in
 * der Liste, geschieht nichts (`undefined`).
 */
export function fuegeOrtEin(
    liste: readonly StrassenOrt[],
    ort: StrassenOrt,
): { readonly liste: StrassenOrt[]; readonly stelle: number } | undefined {
    if (liste.some((o) => o.id === ort.id)) return undefined;
    let stelle = liste.length;
    let beste = Infinity;
    for (let i = 0; i <= liste.length; i += 1) {
        const davor = liste[i - 1];
        const danach = liste[i];
        const kosten =
            davor !== undefined && danach !== undefined
                ? abstand(davor, ort) + abstand(ort, danach) - abstand(davor, danach)
                : abstand(davor ?? danach ?? ort, ort) * 1.0001;
        if (kosten < beste) {
            beste = kosten;
            stelle = i;
        }
    }
    return { liste: [...liste.slice(0, stelle), ort, ...liste.slice(stelle)], stelle };
}

/** Verschiebt einen Ort; ungültige Stellen und „an dieselbe Stelle“ geben die Liste selbst zurück. */
export function verschiebeOrt(liste: readonly StrassenOrt[], von: number, nach: number): readonly StrassenOrt[] {
    if (von === nach || von < 0 || nach < 0 || von >= liste.length || nach >= liste.length) return liste;
    const neu = [...liste];
    const [ort] = neu.splice(von, 1);
    if (ort !== undefined) neu.splice(nach, 0, ort);
    return neu;
}

// --- Befunde ---

export type Befund =
    | { readonly art: "zu-wenig" }
    | { readonly art: "kein-weg"; readonly von: string; readonly nach: string }
    | {
          readonly art: "umweg";
          readonly von: string;
          readonly nach: string;
          readonly laenge: number;
          readonly faktor: number;
          readonly abschnitte: readonly string[];
      }
    | { readonly art: "unbekannt"; readonly namen: readonly string[] }
    | { readonly art: "fremd"; readonly anzahl: number; readonly namen: readonly string[] }
    | { readonly art: "fertig"; readonly anzahl: number };

/** Die Befunde unter der Strecke: je Ortspaar „kein Weg“ und „Umweg“, dann andere Straße und, wenn alles stimmt, „fertig“. */
export function befundeVon(e: AssistentEingabe, m: AssistentModell): Befund[] {
    const { antwort } = e;
    const befunde: Befund[] = [];
    if (antwort.orte.length < 2) befunde.push({ art: "zu-wenig" });
    for (const teil of antwort.teile) {
        if (teil.laenge === null) befunde.push({ art: "kein-weg", von: teil.von, nach: teil.nach });
        else if (teil.umweg !== null && teil.umweg >= UMWEG_AB)
            befunde.push({
                art: "umweg",
                von: teil.von,
                nach: teil.nach,
                laenge: teil.laenge,
                faktor: teil.umweg,
                abschnitte: teil.abschnitte,
            });
    }
    if (antwort.unbekannt.length > 0) befunde.push({ art: "unbekannt", namen: antwort.unbekannt });
    const fremd = m.strecke.filter((id) => m.zustand[id] === "fremd");
    if (fremd.length > 0) {
        const namen = [...new Set(fremd.flatMap((id) => antwort.abschnitte[id]?.name.trim() ?? []))].filter(
            (n) => n !== "",
        );
        befunde.push({ art: "fremd", anzahl: fremd.length, namen });
    }
    if (m.strecke.length > 0 && m.geaendert.size === 0 && fremd.length === 0 && antwort.orte.length >= 2)
        befunde.push({ art: "fertig", anzahl: m.strecke.length });
    return befunde;
}

// --- Rahmen zum Zeigen ---

export type Rahmen = [number, number, number, number];

/** Was auf der Karte leuchtet: die Abschnitte in Fahrtfolge (ihre Nummern) und die hervorgehobenen (Form von `AbschnitteBild`). */
export interface AssistentBild {
    readonly ids: readonly string[];
    readonly hervor: readonly string[];
}

/** Der Kasten um die Linien der Abschnitte; ohne Linie keiner. */
export function rahmenVon(abschnitte: readonly Pick<StrassenAbschnitt, "coordinates">[]): Rahmen | undefined {
    let r: Rahmen | undefined;
    for (const a of abschnitte)
        for (const [x, y] of a.coordinates)
            r =
                r === undefined
                    ? [x, y, x, y]
                    : [Math.min(r[0], x), Math.min(r[1], y), Math.max(r[2], x), Math.max(r[3], y)];
    return r;
}

/** Der Kasten um alle Abschnitte abseits der Strecke. */
export function abseitsRahmen(antwort: StrasseStreckeAntwort): Rahmen | undefined {
    return rahmenVon(antwort.abseits.flatMap((id) => antwort.abschnitte[id] ?? []));
}
