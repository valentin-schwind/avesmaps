import { shallowRef, type ShallowRef } from "vue";
import {
    MEDIA_PHOTOBOX_STAPEL_URL,
    PHOTOBOX_GLOCKEN_ARTEN,
    PHOTOBOX_STAPEL_MAX,
    type Benachrichtigung,
    type PhotoboxStapel,
} from "@avesmaps3d/shared";
import { getJson, type Fetcher } from "../auth/api";

/**
 * Der Stapel neuer Reisebilder oben in Community › Meldungen (WI-0272 S3, Aufgabe 19): was die Oberfläche rechnet; wie er aussieht, in `photobox-stapel.vue`.
 *
 * - **Nur mit `view_media_private`, nur bei `offen > 0`.** Der Server prüft das Recht selbst (`GET /api/editor/media/photobox/stapel`); hier steuert es nur die Ansicht.
 * - **Kein eigener Takt.** Die Zahl wird beim Öffnen des Reiters geladen und dann aufgefrischt, wenn sich in der Glocke etwas für die Reisebilder ändert (`stapelSignatur`): Die Glocke fragt ohnehin
 *   im Takt nach (ETag, sonst 304), und eine neue Einreichung lässt ihre Zeile wachsen oder legt eine neue an.
 * - **Ein Fehler zeigt nichts.** Scheitert die Abfrage, bleibt der Stand, wie er war (anfangs: kein Stapel); die Liste der Redaktion bleibt die Wahrheit, der Stapel ein Hinweis.
 */

export const STAPEL_RECHT = "view_media_private";

/** Zeigt die Seite den Stapel? Mit dem Recht und nur, wenn etwas offen ist. */
export function stapelZeigen(rechte: readonly string[], stapel: PhotoboxStapel | null | undefined): boolean {
    return rechte.includes(STAPEL_RECHT) && stapel !== null && stapel !== undefined && stapel.offen > 0;
}

/** Die Drehung je Schritt um die Mitte (Grad): leicht, ruhig. Fünf Bilder drehen sich um höchstens 7 Grad. */
const DREHUNG_GRAD = 3.5;
/** Der Versatz zum nächsten Bild als Bruchteil der Bildbreite: Die Bilder überlappen, jedes zeigt ein Drittel mehr. */
const VERSATZ = 0.34;

/** Ein Bild im Fächer: Kennung und Adresse der Vorschau, dazu seine Lage. */
export interface FaecherBild {
    publicId: string;
    url: string;
    /** Die Drehung in Grad, um die Mitte des Fächers verteilt (Summe 0). */
    drehung: number;
    /** Der Versatz von links als Bruchteil der Bildbreite (0 für das erste). */
    versatz: number;
    /** Die Ebene: Das neueste (das erste der Antwort) liegt zuoberst. */
    ebene: number;
}

/** Der Fächer der Vorschauen: höchstens fünf, in der Reihenfolge der Antwort (neueste zuerst), leicht gedreht um die Mitte, überlappend. */
export function faecher(vorschau: readonly { publicId: string; url: string }[]): FaecherBild[] {
    const bilder = vorschau.slice(0, PHOTOBOX_STAPEL_MAX);
    const mitte = (bilder.length - 1) / 2;
    return bilder.map((bild, i) => ({
        publicId: bild.publicId,
        url: bild.url,
        drehung: (i - mitte) * DREHUNG_GRAD,
        versatz: i * VERSATZ,
        ebene: bilder.length - i,
    }));
}

/** Die Breite des Fächers in Bildbreiten: das erste Bild ganz, dazu der Versatz des letzten. Auf zwei Stellen gerundet (kein Gleitkommarauschen im Stil). */
export function faecherWeite(bilder: readonly FaecherBild[]): number {
    return Math.round((1 + (bilder[bilder.length - 1]?.versatz ?? 0)) * 100) / 100;
}

/**
 * Der Stand der Reisebilder in der Glocke als eine Zeichenkette: Kennung, Zahl und Zeit der Einträge der Reisebilder. Sie ändert sich, wenn eine Einreichung die Zeile wachsen lässt (neue Zahl, neue
 * Zeit) oder eine neue anlegt, nicht beim Lesen (`gelesenAt`) und nicht bei Einträgen anderer Arten. Ohne Einträge der Reisebilder ist sie leer.
 */
export function stapelSignatur(eintraege: readonly Benachrichtigung[] | undefined): string {
    return (eintraege ?? [])
        .filter((eintrag) => PHOTOBOX_GLOCKEN_ARTEN.includes(eintrag.art))
        .map((eintrag) => `${String(eintrag.id)}:${eintrag.text ?? ""}:${eintrag.erstelltAt}`)
        .join("|");
}

/**
 * Der Eintrag der Glocke, an dem die offenen Bilder stehen: der jüngste der Reisebilder (die Liste kommt neueste zuerst). Ältere Zeilen zeigen keine Bilder: Der Stapel weiß, was jetzt offen ist, nicht, was
 * eine alte Meldung meinte.
 */
export function stapelEintrag(eintraege: readonly Benachrichtigung[]): number | undefined {
    return eintraege.find((eintrag) => PHOTOBOX_GLOCKEN_ARTEN.includes(eintrag.art))?.id;
}

/** Holt den Stapel; ein Fehler (kein Recht, keine Verbindung, ein älterer Server) heißt `null`. */
export async function ladeStapel(fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<PhotoboxStapel | null> {
    try {
        return await getJson<PhotoboxStapel>(MEDIA_PHOTOBOX_STAPEL_URL, (url, init) =>
            fetcher(url, signal === undefined ? init : { ...init, signal }),
        );
    } catch {
        return null;
    }
}

/** Der eine Stapel der Seite. */
export const stapelZustand: { readonly stapel: ShallowRef<PhotoboxStapel | null> } = {
    stapel: shallowRef<PhotoboxStapel | null>(null),
};

let lauf: AbortController | undefined;

/** Lädt den Stapel neu; ein jüngerer Wunsch bricht den älteren ab (AGENTS: Abbrechen ist Pflicht). Ein Fehler lässt den Stand, wie er war. */
export async function ladeStapelNeu(fetcher: Fetcher = fetch): Promise<void> {
    lauf?.abort();
    const mein = new AbortController();
    lauf = mein;
    const stapel = await ladeStapel(fetcher, mein.signal);
    if (!mein.signal.aborted && stapel !== null) stapelZustand.stapel.value = stapel;
}
