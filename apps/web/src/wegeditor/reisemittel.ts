import {
    AVENTURIA_TRAVEL_MODEL,
    CALENDAR_MONTHS,
    allowedTransportsForPath,
    offeredTransports,
    pathSeasonWindow,
    type EditorPathReisen,
    type EditorPathSaison,
    type EditorPathStreet,
    type TravelModel,
} from "@avesmaps3d/shared";

/**
 * Die Reisemittel der gewählten Abschnitte im Wege-Fenster (WI-0177, Vorschlag 3 „Auswahl (W) (1) (2)“, Betreiber 2026-10-19: „variante 3 ist
 * genau die richtung die ich wollte“): eine Zeile je Reisemittel, das einer der Abschnitte anbietet, mit Haken und Zeitfenster.
 *
 * 🔴 Gerechnet wird mit DENSELBEN Funktionen wie die Wegfindung (`allowedTransportsForPath`, `pathSeasonWindow`, `travel-model.ts`), aus dem,
 * was gespeichert ist (`EditorPathReisen`). So zeigt das Fenster nie etwas anderes, als beim Routen gilt (Abgleich mit der Wegfindung
 * 2026-10-19): eine leere Altliste ohne Domäne gilt als Vorgabe, Karren und Fuhrwerk erben von der Kutsche, der Schlitten von der
 * Reisegruppe zu Pferd, und ein Fenster ohne eigenes Mittel kommt vom Vorbild. Ist ein Abschnitt vom Editor vollständig geschrieben
 * (`geschrieben`, Migration 0208, F16 „A“), erbt nichts.
 *
 * **Ändern** (Vorschlag 3 Schritt 3): `mitMittel` und `mitFenster` ändern die Reisemittel EINES Abschnitts. Vor der ersten Änderung
 * schreiben sie den Stand aus, wie die Wegfindung ihn rechnet (`ausgeschrieben`): die wirksame Liste samt geerbter Mittel und Fenster,
 * damit sich dadurch keine Reisezeit ändert. Was sich nicht ändert, bleibt, wie es war (auch ungeschrieben).
 */

/** Ein Abschnitt, wie das Fenster ihn für die Reisemittel braucht. */
type Abschnitt = EditorPathStreet["segments"][number];

export interface ReisemittelZeile {
    readonly mittel: string;
    /** Fährt es? `null`: Die gewählten Abschnitte sind sich nicht einig. */
    readonly faehrt: boolean | null;
    /** Das Zeitfenster: `null` ganzjährig (oder fährt nicht), `undefined` uneinig. */
    readonly fenster: EditorPathSaison | null | undefined;
    /** Erbt es Haken oder Fenster von seinem Vorbild (`freigabeErbe`)? */
    readonly erbt: boolean;
    /** An wie vielen der gewählten Abschnitte es angeboten wird (der Wegtyp entscheidet). */
    readonly angeboten: number;
    /** Wie viele Abschnitte gewählt sind. */
    readonly von: number;
}

const OHNE_LISTE: EditorPathReisen = { liste: null, domaene: null, fenster: {} };

/** Wegtyp, Bach und gespeicherte Reisemittel eines Abschnitts; ein älterer Stand ohne die Felder nimmt die der Straße. */
export function reisenDes(
    abschnitt: Abschnitt,
    strasse: Pick<EditorPathStreet, "subtype" | "isBach">,
): { art: string; bach: boolean; reisen: EditorPathReisen } {
    return {
        art: abschnitt.art ?? abschnitt.subtype ?? strasse.subtype,
        bach: abschnitt.bach ?? strasse.isBach,
        reisen: abschnitt.reisen ?? OHNE_LISTE,
    };
}

const gleich = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Was auf dem Abschnitt fährt, wie die Wegfindung es rechnet. */
const wirksam = (reisen: EditorPathReisen, art: string, model: TravelModel): string[] =>
    allowedTransportsForPath(model, art, reisen.liste, reisen.domaene, reisen.geschrieben === true);
/** Das Fenster eines Mittels, wie die Wegfindung es rechnet; `undefined`: ganzjährig. */
const fensterVon = (reisen: EditorPathReisen, mittel: string, model: TravelModel): EditorPathSaison | undefined =>
    pathSeasonWindow(model, reisen.fenster, mittel, reisen.geschrieben === true) as EditorPathSaison | undefined;

/**
 * F16 „A“ (Betreiber 2026-10-18): der Stand eines Abschnitts ausgeschrieben, wie die Wegfindung ihn rechnet (die wirksame Liste samt
 * geerbter Mittel, je Mittel sein wirksames Fenster); danach erbt nichts mehr. Ein geschriebener bleibt, wie er ist.
 */
export function ausgeschrieben(
    reisen: EditorPathReisen,
    art: string,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): EditorPathReisen {
    if (reisen.geschrieben === true) return reisen;
    const liste = wirksam(reisen, art, model);
    const fenster: Record<string, EditorPathSaison> = {};
    for (const mittel of liste) {
        const f = fensterVon(reisen, mittel, model);
        if (f !== undefined) fenster[mittel] = { ...f };
    }
    return { liste, domaene: reisen.domaene, fenster, geschrieben: true };
}

/** Ein Mittel an- oder abwählen, nur wenn der Wegtyp es anbietet; ohne Haken fällt auch sein Fenster weg. */
export function mitMittel(
    reisen: EditorPathReisen,
    art: string,
    mittel: string,
    an: boolean,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): EditorPathReisen {
    const angebot = offeredTransports(model, art);
    if (!angebot.includes(mittel) || wirksam(reisen, art, model).includes(mittel) === an) return reisen;
    const voll = ausgeschrieben(reisen, art, model);
    const liste = new Set(voll.liste ?? []);
    const fenster = { ...voll.fenster };
    if (an) liste.add(mittel);
    else {
        liste.delete(mittel);
        delete fenster[mittel];
    }
    return { ...voll, liste: angebot.filter((m) => liste.has(m)), fenster };
}

/** Das Fenster eines Mittels setzen (`null`: ganzjährig), nur wo es fährt. */
export function mitFenster(
    reisen: EditorPathReisen,
    art: string,
    mittel: string,
    f: EditorPathSaison | null,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): EditorPathReisen {
    if (!wirksam(reisen, art, model).includes(mittel) || gleich(fensterVon(reisen, mittel, model) ?? null, f))
        return reisen;
    const voll = ausgeschrieben(reisen, art, model);
    const fenster = { ...voll.fenster };
    if (f === null) delete fenster[mittel];
    else fenster[mittel] = { ...f };
    return { ...voll, fenster };
}

/**
 * „Auf alle Abschnitte übernehmen“ (OPS-000112, Entwurf Fassung 2, Vali 2026-11-11 „ja bauen“): Was die gewählten Abschnitte fahren, geht an
 * alle Abschnitte der Straße, alle Zeilen (großer Knopf) oder nur eine (`nur`, der kleine Knopf der Zeile). Je Zeile Haken und Zeitfenster
 * wie an den gewählten, geschrieben mit `mitMittel` und `mitFenster`, also wie ein Klick auf den Haken an jedem Abschnitt: Was sein Wegtyp
 * nicht anbietet, bleibt, wie es ist, und eine andere Zeile ändert sich nicht (auch nicht eine, die von dieser erbte).
 *
 * - `uneins`: Die gewählten fahren in einer der Zeilen verschieden; es gibt nichts Eindeutiges zu übernehmen.
 * - `schon`: Alle Abschnitte fahren schon so.
 * - `geht`: die neuen Reisemittel der Abschnitte, die sich ändern, und ihre Kennungen in der Folge der Straße.
 */
export type Uebernahme =
    | { readonly art: "uneins" }
    | { readonly art: "schon" }
    | {
          readonly art: "geht";
          readonly reisen: Readonly<Record<string, EditorPathReisen>>;
          readonly geaendert: readonly string[];
      };

export function uebernahme(
    abschnitte: readonly Abschnitt[],
    gewaehlt: readonly string[],
    strasse: Pick<EditorPathStreet, "subtype" | "isBach">,
    nur?: string,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): Uebernahme {
    const quelle = reisemittelZeilen(
        abschnitte.filter((a) => gewaehlt.includes(a.id)),
        strasse,
        model,
    ).filter((z) => nur === undefined || z.mittel === nur);
    if (quelle.some((z) => z.faehrt === null || z.fenster === undefined)) return { art: "uneins" };
    const reisen: Record<string, EditorPathReisen> = {};
    const geaendert: string[] = [];
    for (const a of abschnitte) {
        const { art, reisen: vorher } = reisenDes(a, strasse);
        let r = vorher;
        for (const z of quelle) {
            r = mitMittel(r, art, z.mittel, z.faehrt === true, model);
            if (z.faehrt === true) r = mitFenster(r, art, z.mittel, z.fenster ?? null, model);
        }
        if (r === vorher) continue;
        reisen[a.id] = r;
        geaendert.push(a.id);
    }
    return geaendert.length === 0 ? { art: "schon" } : { art: "geht", reisen, geaendert };
}

/** Die Zeilen der Reisemittel für die gewählten Abschnitte, in der Reihenfolge des Modells (Land, dann Fluss). */
export function reisemittelZeilen(
    abschnitte: readonly Abschnitt[],
    strasse: Pick<EditorPathStreet, "subtype" | "isBach">,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): ReisemittelZeile[] {
    const teile = abschnitte.map((a) => {
        const { art, reisen } = reisenDes(a, strasse);
        const angeboten = offeredTransports(model, art);
        const faehrt = wirksam(reisen, art, model);
        return { art, reisen, angeboten, faehrt };
    });
    const reihe = [...model.transportmittel.wert.land, ...model.transportmittel.wert.river];
    const alle = new Set(teile.flatMap((t) => t.angeboten));
    return reihe
        .filter((mittel, i) => alle.has(mittel) && reihe.indexOf(mittel) === i)
        .map((mittel) => {
            const mit = teile.filter((t) => t.angeboten.includes(mittel));
            const faehrtJe = mit.map((t) => t.faehrt.includes(mittel));
            const fensterJe = mit.map((t, i) => (faehrtJe[i] ? (fensterVon(t.reisen, mittel, model) ?? null) : null));
            const vorbild = model.freigabeErbe.wert[mittel];
            const erbt = mit.some(
                (t, i) =>
                    faehrtJe[i] === true &&
                    t.reisen.geschrieben !== true &&
                    vorbild !== undefined &&
                    ((t.reisen.liste !== null && !t.reisen.liste.includes(mittel)) ||
                        (t.reisen.fenster[mittel] === undefined && t.reisen.fenster[vorbild] !== undefined)),
            );
            const faehrt = faehrtJe.every((x) => x === faehrtJe[0]) ? (faehrtJe[0] ?? false) : null;
            const fenster = fensterJe.every((f) => gleich(f, fensterJe[0])) ? (fensterJe[0] ?? null) : undefined;
            return { mittel, faehrt, fenster, erbt, angeboten: mit.length, von: abschnitte.length };
        });
}

/** Die Tage des Jahres 0 bis 364: zwölf Monate zu 30 Tagen, dann die fünf Namenlosen Tage (wie `calendar.ts`, `dayOfYear` minus 1). */
export const TAGE_IM_JAHR = 365;
const tagIndex = (monat: string, tag: number): number => CALENDAR_MONTHS.indexOf(monat as never) * 30 + tag - 1;

/** Die Jahreszeit eines Tages wie die Wegfindung (`seasonOfDay`): je drei Monate, die Namenlosen Tage erben den Frühling. */
const JAHRESZEITEN = ["sommer", "herbst", "winter", "fruehling"] as const;
const jahreszeitVon = (i: number): (typeof JAHRESZEITEN)[number] =>
    JAHRESZEITEN[Math.floor(Math.min(11, Math.floor(i / 30)) / 3)] ?? "fruehling";

/**
 * An welchen Tagen das Mittel fährt (für die Spur unter der Monatsleiste): `faehrt` false heißt nie, kein Fenster heißt immer, sonst das
 * Fenster samt Jahreswechsel (`windowContains`). Ein Mittel mit Bodenpflicht (Schlitten) fährt nur in den Jahreszeiten seines Bodens
 * (über der Schneegrenze auch sonst; das weiß nur die Wegfindung mit dem Gelände).
 */
export function fahrtage(
    mittel: string,
    faehrt: boolean,
    fenster: EditorPathSaison | null,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): boolean[] {
    const offen = new Array<boolean>(TAGE_IM_JAHR).fill(faehrt && fenster === null);
    if (faehrt && fenster !== null) {
        const bis = tagIndex(fenster.to_month, fenster.to_day);
        for (
            let i = tagIndex(fenster.from_month, fenster.from_day), n = 0;
            n < TAGE_IM_JAHR;
            i = (i + 1) % TAGE_IM_JAHR, n++
        ) {
            offen[i] = true;
            if (i === bis) break;
        }
    }
    const pflicht = model.bodenPflicht.wert[mittel];
    if (pflicht)
        for (let i = 0; i < TAGE_IM_JAHR; i++) if (!pflicht.jahreszeiten.includes(jahreszeitVon(i))) offen[i] = false;
    return offen;
}

/**
 * Hat ein Abschnitt eine Sperrung (das Zeichen an seiner Nummer)? Wie Legacy (Owner 01.09.2026): weniger Reisemittel als die Vorgabe des
 * Wegtyps (beim Bach: keine Boote), oder ein Zeitfenster an einem, das fährt.
 */
export function hatSperrung(
    abschnitt: Abschnitt,
    strasse: Pick<EditorPathStreet, "subtype" | "isBach">,
    model: TravelModel = AVENTURIA_TRAVEL_MODEL,
): boolean {
    const { art, bach, reisen } = reisenDes(abschnitt, strasse);
    const faehrt = wirksam(reisen, art, model);
    // Ein Bach hat die Vorgabe „keine Boote“ (F14): Seine leere Liste ist keine Sperrung.
    const vorgabe = bach ? [] : allowedTransportsForPath(model, art, null, null);
    return vorgabe.some((m) => !faehrt.includes(m)) || faehrt.some((m) => fensterVon(reisen, m, model) !== undefined);
}
