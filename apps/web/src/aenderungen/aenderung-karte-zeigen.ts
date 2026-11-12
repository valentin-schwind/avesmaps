import { reactive } from "vue";
import type { MapChangeLage, MapHistoryEntry } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { brauchtDetail, detailGegenstaende, mitDetail, serienDetail } from "./aenderung-detail-modell";
import { hatBild, hatKartenFelder, kartenBild, type KartenGegenstand } from "./aenderung-karte-modell";
import { bildAusLage, lageFrage } from "./aenderung-lage-modell";
import type { AenderungenDaten } from "./aenderungen-daten";
import {
    kartenWunsch,
    schliesseKarte,
    schliesseKarteFuer,
    zeigeAufKarte,
    zeigtKarte,
    type KartenRueckweg,
} from "./karte-ablage";

/**
 * „⊕ Auf der Karte zeigen“ für JEDE Änderung (WI-0265 B9; Vali 2026-11-01: „kannst du bei den änderungensitems immer (wenn möglich) 'Auf Karte anzeigen' machen, sodass die Ansicht hinfliegt, wo die Änderung war?
 * sonst muss man ewig suchen“): EIN Ablauf für die Zeile der Liste, das Detail einer Änderung und das Detail einer Serie, ohne Vue-Bauteil, damit die Neugestaltung „Änderungen neu“ ihn übernimmt.
 *
 * 1. Zeigt diese Überlagerung schon, nimmt der Druck sie weg.
 * 2. (a) **Das Protokoll:** Trägt die Änderung Geometrie, ist es Vorher und Nachher, wie seit B5b. Die Liste lässt Geometrie weg; wo sie gebraucht wird, lädt `umfeld.gegenstaende` das Detail nach.
 * 3. (b) **Die Datenbank:** Sonst fragt der Ablauf den Server, wo die Gegenstände jetzt liegen (`daten.lage`), und legt den heutigen Ort auf die Karte.
 * 4. (c) **Keine Lage:** Weiß auch der Server keine, zeigt der Knopf kurz „Keine Lage bekannt“ (`zeigtStatus`).
 *
 * Die Kamera fliegt nach `map/aenderungen-overlay.ts` (`showBounds`, nie ein Sprung), am Telefon blendet sich das Panel dabei weg.
 */

/** Wem die Überlagerung einer Änderung im Detail oder in der Zeile gehört: der Reiter und der Objektverlauf zählen getrennt (`kennung`). */
export const besitzerEintrag = (kennung: string, operationId: string): string => `${kennung}:${operationId}`;
/** Wem die Überlagerung einer Arbeitsserie gehört. */
export const besitzerSerie = (kennung: string, serie: string): string => `${kennung}:serie:${serie}`;

export type ZeigenErgebnis = "gezeigt" | "weg" | "keineLage" | "fehler" | "abgebrochen" | "laeuft";

/** Was der Ablauf von seiner Umgebung braucht: die Gegenstände (mit Geometrie, wo sie gebraucht wird), die Lage vom Server und ob die Frage noch gilt. */
export interface ZeigenUmfeld {
    /** Die Gegenstände der Änderung mit ihren Feldern; `undefined`, wenn das Laden scheiterte. Lädt nur nach, wo Geometrie gebraucht wird. */
    gegenstaende(): Promise<readonly KartenGegenstand[] | undefined>;
    /** Wo die Gegenstände heute liegen; `undefined`, wenn die Frage scheiterte. */
    lage(): Promise<MapChangeLage | null | undefined>;
    /** Gilt die Frage noch (die Zeile ist nicht gewechselt, das Detail nicht geschlossen)? */
    gilt(): boolean;
}

// --- Was der Knopf kurz sagt ----------------------------------------------------------------------------------------------

type Kurz = "keineLage" | "fehler";
/** Wie lange „Keine Lage bekannt“ am Knopf steht. */
export const KURZ_MS = 4000;
const kurz = reactive(new Map<string, Kurz>());
const laufend = reactive(new Set<string>());
const timer = new Map<string, ReturnType<typeof setTimeout>>();

function sage(besitzer: string, was: Kurz): void {
    clearTimeout(timer.get(besitzer));
    kurz.set(besitzer, was);
    timer.set(
        besitzer,
        setTimeout(() => {
            kurz.delete(besitzer);
            timer.delete(besitzer);
        }, KURZ_MS),
    );
}

/** Was der Knopf dieses Besitzers gerade kurz sagt (`keineLage`, `fehler`); sonst nichts. */
export const zeigtStatus = (besitzer: string): Kurz | undefined => kurz.get(besitzer);
/** Läuft für diesen Besitzer gerade eine Frage? */
export const laedtKarte = (besitzer: string): boolean => laufend.has(besitzer);

/** Was der Knopf dieses Besitzers gerade kurz sagt, in Worten; `undefined`, wenn er nichts sagt. */
export function statusText(besitzer: string): string | undefined {
    const status = kurz.get(besitzer);
    if (status === "keineLage") return t("aenderungen.karte.keineLage");
    if (status === "fehler") return t("aenderungen.karte.lageFehler");
    return undefined;
}

/** Der Text am Knopf: sein gewöhnlicher, solange er nichts Besonderes sagt. */
export function karteKnopfText(besitzer: string): string {
    return (
        statusText(besitzer) ??
        (zeigtKarte(besitzer) ? t("aenderungen.karte.wegnehmen") : t("aenderungen.karte.zeigen"))
    );
}

/** Der Name des Zeichenknopfs ⊕ (WI-0265 B10, ohne Symbol: das trägt der Knopf selbst): Er zeigt, nimmt weg oder sagt kurz, dass es keine Lage gibt. */
export function karteTitel(besitzer: string): string {
    return (
        statusText(besitzer) ??
        (zeigtKarte(besitzer) ? t("aenderungen.karte.wegnehmenTitel") : t("aenderungen.karte.zeigenTitel"))
    );
}

/** Nimmt die Überlagerung weg, wenn sie einem Besitzer mit dieser Vorsilbe gehört (der Reiter geht, mit ihm alles, was seine Zeilen zeigten). */
export function schliesseKarteMit(vorsilbe: string): void {
    if (kartenWunsch.value?.besitzer.startsWith(vorsilbe) === true) schliesseKarte();
}

/** Den kurzen Hinweis wegnehmen (das Bauteil räumt auf). */
export function vergissStatus(besitzer: string): void {
    clearTimeout(timer.get(besitzer));
    timer.delete(besitzer);
    kurz.delete(besitzer);
}

// --- Der Ablauf -------------------------------------------------------------------------------------------------------------

/** Zeigt die Überlagerung dieses Besitzers oder nimmt sie weg; siehe oben. `rueckweg` ist, wohin „‹ Zurück“ am Telefon führt. */
export async function zeigeKarteFuer(
    besitzer: string,
    umfeld: ZeigenUmfeld,
    rueckweg: KartenRueckweg = "detail",
): Promise<ZeigenErgebnis> {
    if (zeigtKarte(besitzer)) {
        schliesseKarteFuer(besitzer);
        return "weg";
    }
    // Ein zweiter Druck, solange der erste fragt, fragt nicht noch einmal.
    if (laufend.has(besitzer)) return "laeuft";
    laufend.add(besitzer);
    vergissStatus(besitzer);
    try {
        // (a) das Protokoll
        const gegenstaende = await umfeld.gegenstaende();
        if (!umfeld.gilt()) return "abgebrochen";
        if (gegenstaende === undefined) return "fehler";
        const bild = kartenBild(gegenstaende);
        if (hatBild(bild)) {
            zeigeAufKarte(besitzer, bild, rueckweg);
            return "gezeigt";
        }
        // (b) die Datenbank
        const lage = await umfeld.lage();
        if (!umfeld.gilt()) return "abgebrochen";
        if (lage === undefined) {
            sage(besitzer, "fehler");
            return "fehler";
        }
        const heute = lage === null ? undefined : bildAusLage(lage);
        if (heute === undefined) {
            // (c) keine Lage
            sage(besitzer, "keineLage");
            return "keineLage";
        }
        zeigeAufKarte(besitzer, heute, rueckweg);
        return "gezeigt";
    } finally {
        laufend.delete(besitzer);
    }
}

// --- Die Umgebung der Zeile -------------------------------------------------------------------------------------------------

const kartenGegenstaende = (eintrag: MapHistoryEntry): KartenGegenstand[] =>
    detailGegenstaende(eintrag).map(({ gegenstand, zeilen }) => ({ kind: gegenstand.kind, zeilen }));

/** Eine Frage ohne Antwort ist ein Fehler dieser Frage, kein Abbruch der anderen. */
const frage = async <T>(aufruf: () => Promise<T>): Promise<T | undefined> => {
    try {
        return await aufruf();
    } catch {
        return undefined;
    }
};

/**
 * Die Umgebung für eine Zeile der Liste, die kein offenes Detail hat: Die Gegenstände kommen aus dem Eintrag der Liste; das Detail wird nur geladen, wenn der Eintrag Lage-Felder hat, deren Wert die
 * Liste weglässt (Geometrie, Netz).
 */
export function umfeldFuerEintrag(
    daten: AenderungenDaten,
    eintrag: MapHistoryEntry,
    signal: AbortSignal,
): ZeigenUmfeld {
    return {
        async gegenstaende() {
            const roh = kartenGegenstaende(eintrag);
            if (!hatKartenFelder(roh) || !brauchtDetail(eintrag)) return roh;
            const detail = await frage(() => daten.detail(eintrag.operationId, signal));
            return detail ? kartenGegenstaende(mitDetail(eintrag, detail)) : undefined;
        },
        lage: () => frage(() => daten.lage(eintrag.operationId, [], signal)),
        gilt: () => !signal.aborted,
    };
}

/** So viele Mitglieder einer Serie lädt die Zeile gleichzeitig nach (wie das Detail der Serie). */
const NACHLADEN_GLEICHZEITIG = 6;

/**
 * Die Umgebung für die Zeile einer Arbeitsserie: Vorher vor dem ersten, Nachher nach dem letzten Mitglied (`serienDetail`); nachgeladen werden nur die Mitglieder, deren Wert eine Lage-Zeile braucht.
 * `mitglieder` laufen von neu nach alt, wie die Liste sie führt.
 */
export function umfeldFuerSerie(
    daten: AenderungenDaten,
    mitglieder: readonly MapHistoryEntry[],
    signal: AbortSignal,
): ZeigenUmfeld {
    const altZuNeu = [...mitglieder].reverse();
    return {
        async gegenstaende() {
            const geladen = new Map<string, MapHistoryEntry>();
            let detail = serienDetail(altZuNeu, geladen);
            if (!hatKartenFelder(detail.gegenstaende)) return detail.gegenstaende;
            const noetig = detail.fehlend;
            for (let i = 0; i < noetig.length; i += NACHLADEN_GLEICHZEITIG) {
                const antworten = await Promise.all(
                    noetig.slice(i, i + NACHLADEN_GLEICHZEITIG).map((id) => frage(() => daten.detail(id, signal))),
                );
                if (signal.aborted) return undefined;
                for (const [j, antwort] of antworten.entries()) {
                    const roh = altZuNeu.find((m) => m.operationId === noetig[i + j]);
                    if (antwort === undefined || antwort === null || roh === undefined) return undefined;
                    geladen.set(roh.operationId, { ...roh, objects: antwort.objects });
                }
            }
            detail = serienDetail(altZuNeu, geladen);
            return detail.gegenstaende;
        },
        lage() {
            const fragen = lageFrage(mitglieder.map((m) => m.operationId));
            return fragen === undefined
                ? Promise.resolve(null)
                : frage(() => daten.lage(fragen.operationId, fragen.mit, signal));
        },
        gilt: () => !signal.aborted,
    };
}
