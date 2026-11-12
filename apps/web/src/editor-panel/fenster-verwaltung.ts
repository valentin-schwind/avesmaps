import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";

/**
 * Die Fensterverwaltung des Editorpanels (WI-0128 E6; EDIT-0001 §4.1, D14, D15, D19; WI-0126 §11e bis §11h; Gesamtmockup WI-0126).
 * Reine Funktionen über einem unveränderlichen Stand, damit Vitest sie ohne Browser prüft; das Panel hält den Stand und zeichnet.
 *
 * - **Drei Lagen** (D14): `angedockt` am rechten Rand, `geloest` als eigenes Fenster über der Karte, `versenkt` als Zeile unter
 *   „Offene Bearbeitungen“ im Editorpanel.
 * - 🔴 **Rechts höchstens eins angedockt** (D15): Ein zweites Andocken legt das erste ab. Die Lasche „Info“ legt das angedockte ab.
 * - 🔴 **Mehrere Fenster derselben Art** (Betreiber 2026-10-10: „es sollen auch mehrere von derselben sorte möglich sein“), aber
 *   **ein Gegenstand steht in höchstens einer Bearbeitung** (WI-0126 §11h): Öffnet man ihn noch einmal, kommt seine Bearbeitung
 *   nach vorn, statt dass eine zweite entsteht.
 * - 🔴 **Öffnen und ablegen** (D19): Ein Klick in der Liste öffnet den Ort an der Stelle des vordersten Fensters; die bisherige
 *   Bearbeitung wandert mit ihrem Entwurf nach „Offene Bearbeitungen“. Keine Rückfrage beim Wechsel.
 * - 🔴 **Schließen verwirft nie ohne Frage** (Koordination 2026-10-10, Betreiber F1 „ja. immer“): ✕ und Escape im Fenster legen ein
 *   Fenster mit Änderungen mit seinem Entwurf ab (`schliesse`). Unter „Offene Bearbeitungen“ liegt es dann schon: Dort fragen ✕ und
 *   „Alle schließen“ bei einem Entwurf „Trotzdem schließen?“, und erst „OK“ verwirft (`schliesseZeile`, `schliesseAlle`; Betreiber
 *   2026-10-19, WI-0231). Vorher taten beide dort nichts, ohne ein Wort.
 * - Ein abgelegtes Fenster kehrt in die Lage zurück, aus der es kam (`letzteLage`).
 */

export type FensterLage = Exclude<FensterHuellenLage, "modal">;
export type SichtbareLage = Exclude<FensterLage, "versenkt">;
export type Box = FensterBox;

export interface WerkzeugFenster {
    readonly id: string;
    /** Das Werkzeug aus dem Register (`ortseditor`, später `wegeditor` …). */
    readonly werkzeug: string;
    /** Was bearbeitet wird (Ort: sein Schlüssel aus der Liste); `undefined`, wenn das Fenster noch nichts trägt. */
    readonly gegenstand: string | undefined;
    readonly titel: string;
    readonly ungespeichert: boolean;
    /** Nur lesen (ohne Schreibrecht, EDIT-0001 §7.1 E3). */
    readonly nurLesen: boolean;
    readonly lage: FensterLage;
    /** Wohin „▣ Hervorholen“ zurückkehrt. */
    readonly letzteLage: SichtbareLage;
    /** Lage und Größe des gelösten Fensters; ohne eine gemerkte steht es an der Vorgabe der Oberfläche. */
    readonly box: Box | undefined;
    /** Reihenfolge nach vorn: das zuletzt berührte Fenster hat die höchste Zahl. */
    readonly vorn: number;
}

export interface FensterStand {
    readonly fenster: readonly WerkzeugFenster[];
    /** Der nächste Zähler für `vorn` und für Kennungen. */
    readonly zaehler: number;
}

export const LEERER_STAND: FensterStand = { fenster: [], zaehler: 0 };

/** Das vorderste sichtbare Fenster (angedockt oder gelöst). */
export function vorderstes(stand: FensterStand): WerkzeugFenster | undefined {
    return stand.fenster
        .filter((fenster) => fenster.lage !== "versenkt")
        .reduce<WerkzeugFenster | undefined>(
            (best, fenster) => (best && best.vorn > fenster.vorn ? best : fenster),
            undefined,
        );
}

/** Das angedockte Fenster, falls eins da ist. */
export const angedockt = (stand: FensterStand): WerkzeugFenster | undefined =>
    stand.fenster.find((fenster) => fenster.lage === "angedockt");

/** Die abgelegten Fenster, zuletzt berührte oben (die Zeilen von „Offene Bearbeitungen“). */
export const abgelegt = (stand: FensterStand): WerkzeugFenster[] =>
    stand.fenster.filter((fenster) => fenster.lage === "versenkt").sort((a, b) => b.vorn - a.vorn);

/**
 * Steht ein sichtbares Fenster an einem Gegenstand dieser Art? Hilfen auf der Karte, die nur beim Bearbeiten gelten, hängen daran: die
 * Nähte beim Bearbeiten von Gebirgen (OPS-000089), die Seen beim Bearbeiten von Flüssen (OPS-000116). Ein abgelegtes Fenster unter
 * „Offene Bearbeitungen“ zählt nicht: Nach dem Neuladen liegen gesicherte Entwürfe dort, und die Hilfe stünde wieder dauernd.
 */
export const sichtbarAn = (
    fenster: readonly Pick<WerkzeugFenster, "lage" | "gegenstand">[],
    gilt: (gegenstand: string) => boolean,
): boolean =>
    fenster.some(
        (eintrag) => eintrag.lage !== "versenkt" && eintrag.gegenstand !== undefined && gilt(eintrag.gegenstand),
    );

/** Die Bearbeitung eines Gegenstands, falls es eine gibt. */
export const bearbeitungVon = (
    stand: FensterStand,
    werkzeug: string,
    gegenstand: string,
): WerkzeugFenster | undefined =>
    stand.fenster.find((fenster) => fenster.werkzeug === werkzeug && fenster.gegenstand === gegenstand);

function ersetze(stand: FensterStand, id: string, aenderung: Partial<WerkzeugFenster>): FensterStand {
    return {
        ...stand,
        fenster: stand.fenster.map((fenster) => (fenster.id === id ? { ...fenster, ...aenderung } : fenster)),
    };
}

/** Legt jedes andere angedockte Fenster ab (rechts steht höchstens eins). */
function raeumeRechts(stand: FensterStand, ausser: string): FensterStand {
    return {
        ...stand,
        fenster: stand.fenster.map((fenster) =>
            fenster.lage === "angedockt" && fenster.id !== ausser
                ? { ...fenster, lage: "versenkt" as const, letzteLage: "angedockt" as const }
                : fenster,
        ),
    };
}

/** Bringt ein Fenster in eine Lage und nach vorn. Andocken legt das bisher angedockte ab; Ablegen merkt die Lage davor. */
export function setzeLage(stand: FensterStand, id: string, lage: FensterLage, box?: Box): FensterStand {
    const fenster = stand.fenster.find((x) => x.id === id);
    if (!fenster) return stand;
    let neu = lage === "angedockt" ? raeumeRechts(stand, id) : stand;
    const letzteLage: SichtbareLage =
        lage === "versenkt" ? (fenster.lage === "versenkt" ? fenster.letzteLage : fenster.lage) : lage;
    neu = ersetze(neu, id, {
        lage,
        letzteLage,
        ...(box === undefined ? {} : { box }),
        ...(lage === "versenkt" ? {} : { vorn: neu.zaehler + 1 }),
    });
    return lage === "versenkt" ? neu : { ...neu, zaehler: neu.zaehler + 1 };
}

/** „▣ Hervorholen“: zurück in die Lage, aus der es kam, und nach vorn. */
export const hervorholen = (stand: FensterStand, id: string): FensterStand => {
    const fenster = stand.fenster.find((x) => x.id === id);
    return fenster ? setzeLage(stand, id, fenster.lage === "versenkt" ? fenster.letzteLage : fenster.lage) : stand;
};

export interface Oeffnen {
    readonly werkzeug: string;
    readonly gegenstand: string | undefined;
    readonly titel: string;
    readonly nurLesen: boolean;
    /** Wo ein neues Fenster erscheint (die gemerkte Lage dieses Werkzeugs, sonst angedockt). */
    readonly lage?: SichtbareLage;
    readonly box?: Box | undefined;
}

/**
 * Öffnet einen Gegenstand in einem neuen Fenster. 🔴 Steht er schon in einer Bearbeitung, kommt diese nach vorn (in ihre letzte
 * Lage), und es entsteht keine zweite.
 */
export function oeffne(stand: FensterStand, wunsch: Oeffnen): { stand: FensterStand; id: string } {
    if (wunsch.gegenstand !== undefined) {
        const da = bearbeitungVon(stand, wunsch.werkzeug, wunsch.gegenstand);
        if (da) return { stand: hervorholen(stand, da.id), id: da.id };
    }
    const id = `fenster-${String(stand.zaehler + 1)}`;
    const lage = wunsch.lage ?? "angedockt";
    const fenster: WerkzeugFenster = {
        id,
        werkzeug: wunsch.werkzeug,
        gegenstand: wunsch.gegenstand,
        titel: wunsch.titel,
        ungespeichert: false,
        nurLesen: wunsch.nurLesen,
        lage,
        letzteLage: lage,
        box: wunsch.box,
        vorn: stand.zaehler + 1,
    };
    const mit = { fenster: [...stand.fenster, fenster], zaehler: stand.zaehler + 1 };
    return { stand: lage === "angedockt" ? raeumeRechts(mit, id) : mit, id };
}

/**
 * 🔴 Öffnen und ablegen (D19): Der Gegenstand öffnet an der Stelle des Fensters `an` (Lage und Box), die bisherige Bearbeitung
 * dort wandert mit ihrem Entwurf nach „Offene Bearbeitungen“. Ohne Fenster an dieser Stelle öffnet es wie `oeffne`. Steht der
 * Gegenstand schon in einer Bearbeitung, tauschen die beiden die Plätze. Mit `ohneEntwurfSchliessen` (ein Handgriff der
 * Mehrfachauswahl, `editor-liste/mehrfachauswahl.ts`) wird die bisherige ohne Entwurf nicht abgelegt: Das Fenster übernimmt den neuen
 * Gegenstand selbst (dieselbe Kennung); steht er schon anderswo in Bearbeitung, geht es zu, und jene tritt an seine Stelle.
 */
export function oeffneAnStelle(
    stand: FensterStand,
    an: string | undefined,
    wunsch: Omit<Oeffnen, "lage" | "box">,
    optionen: AnStelle = {},
): { stand: FensterStand; id: string } {
    const stelle = an === undefined ? undefined : stand.fenster.find((x) => x.id === an && x.lage !== "versenkt");
    if (!stelle) return oeffne(stand, wunsch);
    if (stelle.gegenstand === wunsch.gegenstand && stelle.werkzeug === wunsch.werkzeug)
        return { stand: setzeLage(stand, stelle.id, stelle.lage), id: stelle.id };
    // Ein leeres Fenster (noch kein Gegenstand) hat nichts zu bewahren: Es übernimmt den Gegenstand selbst, statt als leere Zeile
    // unter „Offene Bearbeitungen“ zu landen. Steht der Gegenstand schon anderswo in Bearbeitung, tritt diese an seine Stelle.
    if (stelle.gegenstand === undefined && stelle.werkzeug === wunsch.werkzeug) {
        const da =
            wunsch.gegenstand === undefined ? undefined : bearbeitungVon(stand, wunsch.werkzeug, wunsch.gegenstand);
        if (da)
            return {
                stand: setzeLage(verwirf(stand, stelle.id), da.id, stelle.lage as SichtbareLage, stelle.box),
                id: da.id,
            };
        return {
            stand: setzeLage(
                markiere(stand, stelle.id, { gegenstand: wunsch.gegenstand, titel: wunsch.titel }),
                stelle.id,
                stelle.lage,
            ),
            id: stelle.id,
        };
    }
    const lage = stelle.lage as SichtbareLage;
    const schliessen = optionen.ohneEntwurfSchliessen === true && !stelle.ungespeichert;
    const ohneStelle = schliessen ? verwirf(stand, stelle.id) : setzeLage(stand, stelle.id, "versenkt");
    const da =
        wunsch.gegenstand === undefined ? undefined : bearbeitungVon(ohneStelle, wunsch.werkzeug, wunsch.gegenstand);
    if (da) return { stand: setzeLage(ohneStelle, da.id, lage, stelle.box), id: da.id };
    // In der Mehrfachauswahl übernimmt das Fenster ohne Entwurf den Gegenstand selbst (wie ein leeres): Es bleibt dasselbe Fenster, und
    // was der Editor je Fenster hält (die Häkchen der Liste), bleibt mit ihm.
    if (schliessen)
        return {
            stand: setzeLage(
                markiere(stand, stelle.id, { gegenstand: wunsch.gegenstand, titel: wunsch.titel }),
                stelle.id,
                stelle.lage,
            ),
            id: stelle.id,
        };
    return oeffne(ohneStelle, { ...wunsch, lage, box: stelle.box });
}

/** Wie `oeffneAnStelle` mit dem bisherigen Fenster umgeht. */
export interface AnStelle {
    /** Ohne Entwurf schließen statt ablegen (ein Handgriff der Mehrfachauswahl); mit Entwurf wird es abgelegt wie immer. */
    readonly ohneEntwurfSchliessen?: boolean;
}

/**
 * ✕ und Escape (Koordination 2026-10-10, Betreiber F1 „ja. immer“): 🔴 Schließen verwirft nie einen Entwurf. Ein Fenster ohne
 * Änderungen geht zu; eines mit Änderungen wird mit seinem Entwurf abgelegt. Verwerfen ist eine eigene Handlung (`verwirf`).
 */
export function schliesse(stand: FensterStand, id: string): FensterStand {
    const fenster = stand.fenster.find((x) => x.id === id);
    if (!fenster) return stand;
    return fenster.ungespeichert ? setzeLage(stand, id, "versenkt") : verwirf(stand, id);
}

/** „Verwerfen“: Das Fenster geht zu, sein Entwurf ist weg. Nur diese Handlung verwirft. */
export const verwirf = (stand: FensterStand, id: string): FensterStand => ({
    ...stand,
    fenster: stand.fenster.filter((fenster) => fenster.id !== id),
});

/** „Alle schließen“: Was ohne Änderungen ist, geht zu; was einen Entwurf trägt, bleibt abgelegt. */
export function alleSchliessen(stand: FensterStand): FensterStand {
    return stand.fenster.reduce((neu, fenster) => schliesse(neu, fenster.id), stand);
}

/**
 * Die Frage „Trotzdem schließen?“ unter „Offene Bearbeitungen“ (Betreiber 2026-10-19 über die Editor-Orchestrierung, wörtlich: „pop up
 * mit ".... trotzdem schließen? ok, abbrechen"“): die Fenster, die einen Entwurf tragen. „OK“ verwirft sie (`verwirf`), „Abbrechen“
 * lässt sie liegen.
 */
export interface SchliessFrage {
    readonly ids: readonly string[];
    /** Der Titel, wenn das ✕ einer Zeile fragt; „Alle schließen“ nennt stattdessen die Zahl. */
    readonly titel: string | undefined;
}

/** ✕ an einer Zeile unter „Offene Bearbeitungen“: Ohne Entwurf geht sie zu; mit Entwurf kommt die Frage, und alles bleibt, wie es ist. */
export function schliesseZeile(
    stand: FensterStand,
    id: string,
): { stand: FensterStand; frage: SchliessFrage | undefined } {
    const fenster = stand.fenster.find((x) => x.id === id);
    if (!fenster) return { stand, frage: undefined };
    if (fenster.ungespeichert) return { stand, frage: { ids: [id], titel: fenster.titel } };
    return { stand: verwirf(stand, id), frage: undefined };
}

/** „Alle schließen“: Was ohne Entwurf ist, geht sofort zu, jeder Entwurf liegt abgelegt; gibt es welche, fragt EINE Frage für alle. */
export function schliesseAlle(stand: FensterStand): { stand: FensterStand; frage: SchliessFrage | undefined } {
    const neu = alleSchliessen(stand);
    const offen = ungespeicherte(neu);
    return { stand: neu, frage: offen.length === 0 ? undefined : { ids: offen.map((x) => x.id), titel: undefined } };
}

/** Ändert Titel oder Entwurfszustand eines Fensters. */
export const markiere = (
    stand: FensterStand,
    id: string,
    aenderung: Partial<Pick<WerkzeugFenster, "titel" | "ungespeichert" | "gegenstand">>,
): FensterStand => ersetze(stand, id, aenderung);

/** Ein Fenster nach vorn, ohne die Lage zu ändern (Klick auf ein gelöstes Fenster). */
export const nachVorn = (stand: FensterStand, id: string): FensterStand =>
    stand.fenster.some((x) => x.id === id && x.lage !== "versenkt")
        ? { ...ersetze(stand, id, { vorn: stand.zaehler + 1 }), zaehler: stand.zaehler + 1 }
        : stand;

/** Die Lasche „Info“ legt das angedockte Fenster ab (D14); der Entwurf bleibt. */
export const infoLasche = (stand: FensterStand): FensterStand => {
    const rechts = angedockt(stand);
    return rechts ? setzeLage(stand, rechts.id, "versenkt") : stand;
};

/**
 * Die Lasche „Editor“ holt zurück, was die Lasche „Info“ abgelegt hat (EDIT-0001 §4.5 Nr. 6: „Lasche ‚Editor‘ bringt ihn zurück“):
 * nur, wenn es noch abgelegt ist und rechts inzwischen nichts anderes angedockt steht.
 */
export function ausInfoZurueck(stand: FensterStand, id: string | undefined): FensterStand {
    const fenster = id === undefined ? undefined : stand.fenster.find((x) => x.id === id);
    if (!fenster || fenster.lage !== "versenkt" || fenster.letzteLage !== "angedockt" || angedockt(stand)) return stand;
    return hervorholen(stand, fenster.id);
}

/** „Alle schließen“ nur, wenn kein Entwurf offen ist; sonst nennt die Antwort, welche fragen müssen. */
export const ungespeicherte = (stand: FensterStand): WerkzeugFenster[] =>
    stand.fenster.filter((fenster) => fenster.ungespeichert);

/** Was der Browser je Werkzeug merkt: die zuletzt gewählte sichtbare Lage und die Box des gelösten Fensters. */
export interface GemerkteLage {
    readonly lage: SichtbareLage;
    readonly box?: Box;
}

export const merkSchluessel = (werkzeug: string): string => `avesmaps3d.fenster.${werkzeug}`;

/** Liest eine gemerkte Lage; alles, was nicht passt, gilt als nicht gemerkt (Vorgabe angedockt). */
export function leseGemerkt(text: string | null): GemerkteLage | undefined {
    if (text === null) return undefined;
    try {
        const wert = JSON.parse(text) as { lage?: unknown; box?: Partial<Record<keyof Box, unknown>> };
        if (wert.lage !== "angedockt" && wert.lage !== "geloest") return undefined;
        const b = wert.box;
        const zahl = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
        const box =
            b && zahl(b.left) && zahl(b.top) && zahl(b.width) && zahl(b.height)
                ? { left: b.left, top: b.top, width: b.width, height: b.height }
                : undefined;
        return box === undefined ? { lage: wert.lage } : { lage: wert.lage, box };
    } catch {
        return undefined;
    }
}
