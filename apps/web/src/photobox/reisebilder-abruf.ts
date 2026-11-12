import {
    AVENTURIA,
    MEDIA_REISEBILDER_PUBLIC_URL,
    ausschnittAufRaster,
    ausschnittGueltig,
    type ReisebildKarte,
    type ReisebildRahmen,
    type ReisebilderAntwort,
    type ReisebilderAusschnitt,
} from "@avesmaps3d/shared";

/**
 * Der Abruf der Reisebilder im Browser (WI-0272 S4, Aufgabe 25; Server: `GET /api/media/reisebilder`, Vertrag `packages/shared/src/photobox-karte.ts`). Ohne Karte und ohne DOM, damit
 * Vitest ihn ohne Browser prüft.
 *
 * - **Vorrat:** Gefragt wird ein Ausschnitt, der die Sicht um ein Viertel nach allen Seiten überragt und auf das Raster des Servers gerundet ist (`erweitereSicht`). Solange die Sicht darin liegt und
 *   die Antwort jünger als `VORRAT_MS` ist, fragt der Abruf nicht noch einmal: Das Verschieben der Karte kostet dann keine Anfrage. Der Server und der Browser halten ihren eigenen Speicher
 *   (`no-cache` mit ETag, 15 s am Server); die 60 s hier sind die dritte Stufe.
 * - **Der neueste gewinnt:** Ein neuer Abruf bricht den laufenden ab (`AbortController`); dessen Antwort zählt nie.
 * - **Fehler schweigen:** 429, 5xx und ein Netzfehler lassen den letzten Stand stehen, ohne Meldung (die Karte ist dann wie vorher). Danach wartet der Abruf `FEHLER_PAUSE_MS`, statt bei jedem Schritt
 *   der Karte neu zu fragen und eine Drossel zu verlängern. 🪤 Die Pause liegt unter dem Vorrat: Ein Fehler verlängert ihn nicht.
 * - 🔴 **`an: false` leert die Bilder**, auch wenn der Server welche mitschickt (der Schalter `media.role.photobox` ist aus): nie zeigen, was der Server nicht zeigen will.
 */

/** Wie weit der gefragte Ausschnitt die Sicht überragt, als Anteil von Breite und Höhe der Sicht (Regler melden, WI §9: Vorrat). */
export const VORRAT_ANTEIL = 0.25;
/** Wie lange eine Antwort gilt, ohne dass der Abruf neu fragt. */
export const VORRAT_MS = 60_000;
/** Wie lange der Abruf nach einem Fehler schweigt. */
export const FEHLER_PAUSE_MS = 10_000;

const WELT = AVENTURIA.coordinateSpace.bounds;

const klemme = (wert: number, min: number, max: number): number => Math.min(max, Math.max(min, wert));

/** Ein Rahmen mit geordneten Ecken (kleine zuerst), auf die Welt geklemmt. */
function geordnet(box: ReisebildRahmen): ReisebildRahmen {
    return {
        x0: klemme(Math.min(box.x0, box.x1), WELT.minX, WELT.maxX),
        y0: klemme(Math.min(box.y0, box.y1), WELT.minY, WELT.maxY),
        x1: klemme(Math.max(box.x0, box.x1), WELT.minX, WELT.maxX),
        y1: klemme(Math.max(box.y0, box.y1), WELT.minY, WELT.maxY),
    };
}

/** Der Ausschnitt, der gefragt wird: die Sicht mit einem Viertel Rand, nach außen auf das Raster gerundet. */
export function erweitereSicht(box: ReisebildRahmen): ReisebilderAusschnitt {
    const x0 = Math.min(box.x0, box.x1);
    const x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1);
    const y1 = Math.max(box.y0, box.y1);
    const randX = (x1 - x0) * VORRAT_ANTEIL;
    const randY = (y1 - y0) * VORRAT_ANTEIL;
    return ausschnittAufRaster({ x0: x0 - randX, y0: y0 - randY, x1: x1 + randX, y1: y1 + randY });
}

/** Liegt `innen` ganz in `aussen`? */
const liegtIn = (innen: ReisebildRahmen, aussen: ReisebildRahmen): boolean =>
    innen.x0 >= aussen.x0 && innen.y0 >= aussen.y0 && innen.x1 <= aussen.x1 && innen.y1 <= aussen.y1;

const istZahl = (wert: unknown): wert is number => typeof wert === "number" && Number.isFinite(wert);

function istDatei(wert: unknown): boolean {
    const d = wert as { url?: unknown; breite?: unknown; hoehe?: unknown } | null;
    return d !== null && typeof d === "object" && typeof d.url === "string" && istZahl(d.breite) && istZahl(d.hoehe);
}

function istOrt(wert: unknown): boolean {
    const o = wert as { id?: unknown; lage?: { x?: unknown; y?: unknown } | null; subtype?: unknown } | null;
    return (
        o !== null &&
        typeof o === "object" &&
        typeof o.id === "string" &&
        typeof o.subtype === "string" &&
        typeof o.lage === "object" &&
        o.lage !== null &&
        istZahl(o.lage.x) &&
        istZahl(o.lage.y)
    );
}

/** Trägt das Bild, was die Karte braucht? Ein halbes Bild fiele später in der Karte auf (kein Symbol, kein Treffer); hier fällt es leise heraus. */
function istBild(wert: unknown): wert is ReisebildKarte {
    const b = wert as Partial<ReisebildKarte> | null;
    if (b === null || typeof b !== "object") return false;
    return (
        typeof b.id === "string" &&
        typeof b.lage === "object" &&
        b.lage !== null &&
        istZahl(b.lage.x) &&
        istZahl(b.lage.y) &&
        istDatei(b.datei) &&
        (b.kachel === undefined || istDatei(b.kachel)) &&
        (b.ort === undefined || istOrt(b.ort))
    );
}

/** Die Antwort, wenn sie dem Vertrag gleicht; sonst `undefined`. */
function liesAntwort(wert: unknown): ReisebilderAntwort | undefined {
    const a = wert as { an?: unknown; bilder?: unknown; gekappt?: unknown } | null;
    if (a === null || typeof a !== "object" || typeof a.an !== "boolean" || !Array.isArray(a.bilder)) return undefined;
    if (!a.an) return { an: false, bilder: [], gekappt: false };
    return { an: true, bilder: a.bilder.filter(istBild), gekappt: a.gekappt === true };
}

export interface ReisebilderAbruf {
    /**
     * Die Bilder in der Sicht (Karteneinheiten). `undefined` heißt: nichts Neues, der Stand der Karte gilt weiter (Abbruch durch einen neueren Abruf, Fehler, Pause, ungültige Sicht).
     * Liegt die Sicht im Vorrat, kommt die gemerkte Antwort ohne Anfrage.
     */
    hole(sicht: ReisebildRahmen): Promise<ReisebilderAntwort | undefined>;
    /** Den Vorrat leeren und einen laufenden Abruf abbrechen: Die nächste Sicht fragt neu. */
    vergiss(): void;
}

type Fetcher = typeof fetch;

export function createReisebilderAbruf(
    fetcher: Fetcher = (eingabe, init) => fetch(eingabe, init),
    jetzt: () => number = () => Date.now(),
): ReisebilderAbruf {
    let vorrat:
        | { readonly ausschnitt: ReisebilderAusschnitt; readonly zeit: number; readonly antwort: ReisebilderAntwort }
        | undefined;
    let laufend: AbortController | undefined;
    let pausiertBis = 0;

    return {
        async hole(sicht) {
            const innen = geordnet(sicht);
            if (vorrat !== undefined && jetzt() - vorrat.zeit < VORRAT_MS && liegtIn(innen, vorrat.ausschnitt)) {
                return vorrat.antwort;
            }
            if (jetzt() < pausiertBis) return undefined;
            const ausschnitt = erweitereSicht(sicht);
            if (!ausschnittGueltig(ausschnitt)) return undefined;

            laufend?.abort();
            const steuerung = new AbortController();
            laufend = steuerung;
            const adresse = `${MEDIA_REISEBILDER_PUBLIC_URL}?x0=${String(ausschnitt.x0)}&y0=${String(ausschnitt.y0)}&x1=${String(ausschnitt.x1)}&y1=${String(ausschnitt.y1)}`;
            try {
                // Kein `cache: "no-store"`: Der Server sagt `no-cache` mit ETag, der Browser fragt zurück und bekommt bei Gleichem ein 304.
                const response = await fetcher(adresse, {
                    method: "GET",
                    headers: { accept: "application/json" },
                    credentials: "same-origin",
                    signal: steuerung.signal,
                });
                if (steuerung.signal.aborted) return undefined;
                if (!response.ok) {
                    pausiertBis = jetzt() + FEHLER_PAUSE_MS;
                    return undefined;
                }
                const antwort = liesAntwort(await response.json());
                if (steuerung.signal.aborted) return undefined;
                if (antwort === undefined) {
                    pausiertBis = jetzt() + FEHLER_PAUSE_MS;
                    return undefined;
                }
                vorrat = { ausschnitt, zeit: jetzt(), antwort };
                return antwort;
            } catch {
                // Abbruch durch einen neueren Abruf ist kein Fehler des Servers; alles andere (Netz, kaputtes JSON) lässt den Stand stehen.
                if (!steuerung.signal.aborted) pausiertBis = jetzt() + FEHLER_PAUSE_MS;
                return undefined;
            } finally {
                if (laufend === steuerung) laufend = undefined;
            }
        },
        vergiss() {
            vorrat = undefined;
            pausiertBis = 0;
            laufend?.abort();
            laufend = undefined;
        },
    };
}
