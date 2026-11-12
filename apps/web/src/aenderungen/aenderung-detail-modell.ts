import type { MapHistoryChange, MapHistoryEntry, MapHistoryObject } from "@avesmaps3d/shared";
import { GEBIRGE_PRAEFIX } from "./aenderung-modell";
import { ladeKnotenNamen } from "./aenderung-namen";
import { istRohNeben } from "./aenderung-text";

/**
 * Was das gemeinsame Detail zeigt, ohne Vue (WI-0265 B5a; Probierseite Szene 4 „Vorher/Nachher als Zeilen“): je Gegenstand die Felder mit
 * ihrem Wert vorher und nachher, die großen Werte, die erst die Detail-Route liefert (`omitted`), und die Felder, deren frühere Form das
 * Protokoll nicht führt (`formFehlt`). Der Reiter „Änderungen“ und der Objektverlauf zeigen es gleich.
 *
 * 🔴 **Nie ein „Vorher“ erfinden.** Fehlt `before` im Protokoll, steht dort „nicht gespeichert“ (bei einem schon vorhandenen Gegenstand)
 * oder „–“ (bei einem neu angelegten); die Oberfläche ergänzt nichts aus dem heutigen Stand (Fachvertrag Gate 4, WI-0265 §1.4, U11).
 */

export interface DetailZeile {
    readonly feld: string;
    readonly vorher: unknown;
    readonly nachher: unknown;
    /** Das Protokoll führt einen Wert vorher (auch `null`). */
    readonly hatVorher: boolean;
    readonly hatNachher: boolean;
    /** Der Wert ist in der Liste weggelassen; das Detail lädt ihn nach. */
    readonly omitted: boolean;
    /** Die frühere Form steht nicht im Protokoll (nur im Detail gesetzt). */
    readonly formFehlt: boolean;
}

export interface DetailGegenstand {
    readonly gegenstand: MapHistoryObject;
    readonly zeilen: readonly DetailZeile[];
}

/**
 * Der Grund einer Rücknahme steht im Protokoll als Feld `restoreReason` (nur `after`, an jedem Eintrag der Rücknahme; Server: `mitGrund`). Er ist kein Feld des Gegenstands: Die Liste zeigt ihn als
 * eigenen Satz (`reason` am Eintrag), nicht als Zeile „Restore reason“ im Detail und nicht als Name in der Zeile unter dem Titel.
 */
export const RUECKNAHME_GRUND_FELD = "restoreReason";
export const istGrundFeld = (feld: string): boolean => feld === RUECKNAHME_GRUND_FELD;

/** Ein Feld, das nur die Herkunft eines anderen Felds führt (`nameOrigin` neben `name`): keine eigene Zeile. */
const istHerkunftNeben = (feld: string, felder: readonly string[]): boolean =>
    feld.endsWith("Origin") && felder.includes(feld.slice(0, -"Origin".length));

/**
 * Hat ein Feld keine eigene Zeile? Kein Feld des Gegenstands ist der Grund einer Rücknahme (er steht als Satz), die Herkunft neben ihrem Feld (`nameOrigin`), und der Wiki-Quelltext neben
 * seiner bereinigten Fassung (`rohSchrift` neben `schrift`, WI-0265 B6i): Beide stünden sonst doppelt da. Steht das Rohfeld allein, bleibt es (als „<Feld> (Wiki-Quelltext)“).
 */
export const istNebenfeld = (feld: string, felder: readonly string[]): boolean =>
    istHerkunftNeben(feld, felder) || istRohNeben(feld, felder);

function zeileVon(feld: string, wechsel: MapHistoryChange, gegenstand: MapHistoryObject): DetailZeile {
    const hatVorher = "before" in wechsel;
    const omitted = wechsel.omitted === true;
    return {
        feld,
        vorher: wechsel.before,
        nachher: wechsel.after,
        hatVorher,
        hatNachher: "after" in wechsel,
        omitted,
        // Das Detail nennt die Felder ohne frühere Form ausdrücklich (`formFehlt`); dieselbe Regel gilt, wo nur die Liste eines Objekts da ist:
        // Gab es den Gegenstand schon (Revision vorher) und steht kein `before` im Protokoll, ist die frühere Form nicht gespeichert.
        formFehlt:
            gegenstand.formFehlt?.includes(feld) === true ||
            (!hatVorher && !omitted && gegenstand.revisionBefore !== null),
    };
}

const istSpalten = (wert: unknown): wert is Readonly<Record<string, unknown>> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

/**
 * Die Zeilen eines Felds. Das Gebirge (`gebirge`) ist eine Tafel von Spalten; sie steht als eine Zeile je geänderter Spalte da
 * (`gebirge:grat_breite`: „Gratbreite 14 → 18“), nicht als zwei ganze Tafeln. Sind die Werte noch nicht geladen (`omitted`) oder hat das
 * Protokoll keine Tafel, bleibt es eine Zeile.
 */
function zeilenVon(feld: string, wechsel: MapHistoryChange, gegenstand: MapHistoryObject): DetailZeile[] {
    const roh = zeileVon(feld, wechsel, gegenstand);
    if (feld !== "gebirge" || roh.omitted) return [roh];
    const vor = istSpalten(wechsel.before) ? wechsel.before : undefined;
    const nach = istSpalten(wechsel.after) ? wechsel.after : undefined;
    if (vor === undefined && nach === undefined) return [roh];
    const spalten = [...new Set([...Object.keys(vor ?? {}), ...Object.keys(nach ?? {})])];
    const zeilen = spalten
        .filter(
            (spalte) =>
                !(
                    vor &&
                    nach &&
                    spalte in vor &&
                    spalte in nach &&
                    JSON.stringify(vor[spalte]) === JSON.stringify(nach[spalte])
                ),
        )
        .map((spalte): DetailZeile => {
            const hatVorher = vor !== undefined && spalte in vor;
            return {
                ...roh,
                feld: `${GEBIRGE_PRAEFIX}${spalte}`,
                vorher: vor?.[spalte],
                nachher: nach?.[spalte],
                hatVorher,
                hatNachher: nach !== undefined && spalte in nach,
                formFehlt: roh.formFehlt && !hatVorher,
            };
        });
    return zeilen.length > 0 ? zeilen : [roh];
}

interface MitZeilen {
    readonly kind: string;
    readonly name: string | undefined;
    readonly zeilen: readonly Pick<
        DetailZeile,
        "feld" | "vorher" | "nachher" | "hatVorher" | "omitted" | "formFehlt"
    >[];
}

/**
 * Gleiche Wechsel an mehreren Gegenständen einmal (wie `Verlauf.felder` es für den Objektverlauf tut): Eine Kraftlinie ändert ihren Namen an jedem Abschnitt,
 * und die Operation nennt jeden. Wer zwei Gegenstände nur an Art, Name und gleichen Werten erkennt, zeigt sie als einen. Zeilen, deren Werte noch fehlen
 * (`omitted`), gelten nie als gleich: Zwei Abschnitte einer Straße haben verschiedene Kurven.
 */
function ohneDoppelte<T>(liste: readonly T[], sicht: (eintrag: T) => MitZeilen): T[] {
    const gesehen = new Set<string>();
    return liste.filter((eintrag) => {
        const gegenstand = sicht(eintrag);
        if (gegenstand.zeilen.some((zeile) => zeile.omitted)) return true;
        const schluessel = JSON.stringify([
            gegenstand.kind,
            gegenstand.name ?? null,
            gegenstand.zeilen.map((z) => [z.feld, z.hatVorher, z.vorher ?? null, z.nachher ?? null, z.formFehlt]),
        ]);
        if (gesehen.has(schluessel)) return false;
        gesehen.add(schluessel);
        return true;
    });
}

/** Die Gegenstände einer Operation mit ihren Feldzeilen; `auswahl` beschränkt auf die Gegenstände, die zum Objekt gehören. */
export function detailGegenstaende(
    eintrag: MapHistoryEntry,
    auswahl?: (gegenstand: MapHistoryObject) => boolean,
): DetailGegenstand[] {
    const alle = eintrag.objects
        .filter((gegenstand) => auswahl === undefined || auswahl(gegenstand))
        .map((gegenstand) => {
            const felder = Object.keys(gegenstand.changes);
            // Die Enden eines Abschnitts stehen als Kennung im Protokoll; die Linie nennt die Knoten mit Namen (WI-0265 B6b).
            if (gegenstand.kind === "powerline" && (felder.includes("from") || felder.includes("to")))
                void ladeKnotenNamen(gegenstand.id);
            return {
                gegenstand,
                zeilen: felder
                    .filter((feld) => !istNebenfeld(feld, felder) && !istGrundFeld(feld))
                    .flatMap((feld) => zeilenVon(feld, gegenstand.changes[feld]!, gegenstand)),
            };
        });
    return ohneDoppelte(alle, ({ gegenstand, zeilen }) => ({ kind: gegenstand.kind, name: gegenstand.name, zeilen }));
}

/** Ein Feld, wie ein Objektverlauf es schon ausgewählt hat (`Verlauf.felder`): welches, vorher und nachher. */
export interface GewaehltesFeld {
    readonly feld: string;
    readonly vorher: unknown;
    readonly nachher: unknown;
}

/**
 * Die Zeilen für ein Detail, dessen Felder der Objektverlauf schon ausgewählt, geordnet und von Herkunftsfeldern befreit hat: Dazu kommt,
 * was nur die Gegenstände wissen (gab es einen Wert vorher? fehlt die frühere Form?).
 */
export function zeilenAusFeldern(
    felder: readonly GewaehltesFeld[],
    gegenstaende: readonly MapHistoryObject[],
): DetailZeile[] {
    return felder.flatMap((gewaehlt): DetailZeile[] => {
        for (const gegenstand of gegenstaende) {
            const wechsel = gegenstand.changes[gewaehlt.feld];
            if (wechsel === undefined) continue;
            const zeilen = zeilenVon(gewaehlt.feld, wechsel, gegenstand);
            // Eine Zeile bleibt, wie der Verlauf sie gewählt hat; eine in Spalten zerlegte Tafel (Gebirge) trägt die Werte ihrer Spalten.
            return zeilen.length === 1 && zeilen[0]!.feld === gewaehlt.feld
                ? [{ ...zeilen[0]!, vorher: gewaehlt.vorher, nachher: gewaehlt.nachher }]
                : zeilen;
        }
        return [
            {
                feld: gewaehlt.feld,
                vorher: gewaehlt.vorher,
                nachher: gewaehlt.nachher,
                hatVorher: gewaehlt.vorher !== undefined,
                hatNachher: gewaehlt.nachher !== undefined,
                omitted: false,
                formFehlt: false,
            },
        ];
    });
}

/** Fehlt in dieser Operation ein Wert, den erst das Detail liefert? */
export const brauchtDetail = (eintrag: MapHistoryEntry): boolean =>
    eintrag.objects.some((gegenstand) => Object.values(gegenstand.changes).some((wechsel) => wechsel.omitted === true));

/** Die Operation mit der vollen Nutzlast des Details; Kopf und Zustand bleiben die der Liste (sie sind dieselben). */
export const mitDetail = (eintrag: MapHistoryEntry, detail: MapHistoryEntry): MapHistoryEntry => ({
    ...eintrag,
    objects: detail.objects,
});

// --- Serien ----------------------------------------------------------------------------------------------------------

/** Ein Feld eines Gegenstands über eine ganze Serie: der Wert vor dem ersten und nach dem letzten Mitglied, das es änderte. */
export interface SerienZeile {
    readonly feld: string;
    readonly vorher: unknown;
    readonly nachher: unknown;
    readonly hatVorher: boolean;
    readonly hatNachher: boolean;
    readonly omitted: boolean;
    readonly formFehlt: boolean;
    /** Die Mitglieder, deren Nutzlast diese Zeile braucht (erstes und letztes, das das Feld änderte). */
    readonly braucht: readonly string[];
}

export interface SerienGegenstand {
    readonly kind: MapHistoryObject["kind"];
    readonly id: string;
    readonly name: string | undefined;
    readonly zeilen: readonly SerienZeile[];
}

export interface SerienDetail {
    readonly gegenstaende: readonly SerienGegenstand[];
    /** Mitglieder, deren Detail noch fehlt, damit alle Werte da sind. */
    readonly fehlend: readonly string[];
}

/**
 * Vorher vor dem ersten, Nachher nach dem letzten „Fertig“ der Serie (WI-0265 §1.4): Je Gegenstand und Feld zählt das älteste Mitglied,
 * das es änderte, für „vorher“, und das neueste für „nachher“. `mitglieder` laufen vom ältesten zum neuesten; `geladen` hält die
 * Nutzlast der Mitglieder, deren Werte die Liste weggelassen hat. `fehlend` nennt nur Mitglieder, deren Wert eine Zeile wirklich braucht
 * (das erste und das letzte, das das Feld änderte), nicht alle bis zu hundert.
 */
export function serienDetail(
    mitglieder: readonly MapHistoryEntry[],
    geladen: ReadonlyMap<string, MapHistoryEntry>,
): SerienDetail {
    interface Spanne {
        erstes: DetailZeile;
        ersterId: string;
        letztes: DetailZeile;
        letzterId: string;
    }
    const gegenstaende = new Map<
        string,
        { kind: MapHistoryObject["kind"]; id: string; name: string | undefined; felder: Map<string, Spanne> }
    >();
    for (const roh of mitglieder) {
        const mitglied = geladen.get(roh.operationId) ?? roh;
        for (const gegenstand of mitglied.objects) {
            const schluessel = `${gegenstand.kind}:${gegenstand.id}`;
            let eintrag = gegenstaende.get(schluessel);
            if (eintrag === undefined) {
                eintrag = { kind: gegenstand.kind, id: gegenstand.id, name: gegenstand.name, felder: new Map() };
                gegenstaende.set(schluessel, eintrag);
            }
            eintrag.name ??= gegenstand.name;
            const felder = Object.keys(gegenstand.changes);
            for (const feld of felder) {
                if (istNebenfeld(feld, felder) || istGrundFeld(feld)) continue;
                for (const zeile of zeilenVon(feld, gegenstand.changes[feld]!, gegenstand)) {
                    const bisher = eintrag.felder.get(zeile.feld);
                    if (bisher === undefined)
                        eintrag.felder.set(zeile.feld, {
                            erstes: zeile,
                            ersterId: roh.operationId,
                            letztes: zeile,
                            letzterId: roh.operationId,
                        });
                    else {
                        bisher.letztes = zeile;
                        bisher.letzterId = roh.operationId;
                    }
                }
            }
        }
    }
    // Welche Spalten des Gebirges ein Mitglied änderte, sagt nur sein Detail: Das Gebirge braucht deshalb JEDES Mitglied, nicht nur das erste und das letzte.
    const fehlend = new Set<string>(
        mitglieder
            .filter((m) => !geladen.has(m.operationId) && m.objects.some((g) => g.changes["gebirge"]?.omitted === true))
            .map((m) => m.operationId),
    );
    const raus: SerienGegenstand[] = [];
    for (const { felder, ...rest } of gegenstaende.values()) {
        const zeilen: SerienZeile[] = [];
        for (const [feld, spanne] of felder) {
            const omitted = spanne.erstes.omitted || spanne.letztes.omitted;
            if (omitted) for (const id of [spanne.ersterId, spanne.letzterId]) if (!geladen.has(id)) fehlend.add(id);
            zeilen.push({
                feld,
                vorher: spanne.erstes.vorher,
                nachher: spanne.letztes.nachher,
                hatVorher: spanne.erstes.hatVorher,
                hatNachher: spanne.letztes.hatNachher,
                omitted,
                formFehlt: spanne.erstes.formFehlt,
                braucht: spanne.ersterId === spanne.letzterId ? [spanne.ersterId] : [spanne.ersterId, spanne.letzterId],
            });
        }
        raus.push({ ...rest, zeilen });
    }
    return { gegenstaende: ohneDoppelte(raus, (g) => g), fehlend: [...fehlend] };
}
