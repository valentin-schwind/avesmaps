import {
    editorPathFlussnetzUrl,
    fliessrichtungDemLaufNach,
    fliessrichtungGegeneinander,
    type EditorPathFlussnetz,
    type EditorPathStreetSegment,
    type Fliessrichtung,
} from "@avesmaps3d/shared";
import { getJson, type Fetcher } from "../auth/api";

/**
 * „Fließrichtung auf alle Abschnitte übernehmen“ im Wegeditor (OPS-000112; Mockup Flussumbau, Vali 2026-11-11 „A: in alle Arme“,
 * 2026-11-12 „ja, bauen“). Den gespeicherten Wert an alle Abschnitte zu kopieren, wie bisher bei (W), drehte am Mhanadi 27 Pfeile gegen den
 * Strom: `forward` heißt „in Zeichenrichtung“, und die Abschnitte eines Flusses sind verschieden herum gezeichnet.
 *
 * - **Der Knopf** gibt die Richtung des EINEN gewählten Abschnitts dem Lauf nach weiter (`fliessrichtungDemLaufNach` im gemeinsamen Paket):
 *   flussabwärts in alle Arme, flussaufwärts bis zur nächsten Gabelung, je Abschnitt in seiner Zeichenrichtung. Hinter einer Lücke hält er
 *   und nennt, was er nicht erreicht. EIN Schritt im Entwurf; „Fertig“ schreibt über `path.update`.
 * - **Das Netz** kommt vom Server (`GET …/street/flussnetz`), mit der Topologie der Wegfindung. Es gilt der gespeicherten Linie: Solange
 *   der Entwurf eine Kurve ändert, ist der Knopf gesperrt.
 * - **Bei (W)** gibt es keinen Wert für alle mehr, nur den Zustand des Flusses (`richtungsZustand`) und „Umkehren“, das den ganzen Fluss
 *   dreht und dabei stimmig bleibt.
 */

/** Das Flussnetz einer Straße beim Server. */
export function ladeFlussnetz(fetcher: Fetcher, strasseId: string): Promise<EditorPathFlussnetz> {
    return getJson<EditorPathFlussnetz>(editorPathFlussnetzUrl(strasseId), (url, init) =>
        fetcher(url, { ...init, cache: "no-store" }),
    );
}

/** Der Schlüssel, unter dem ein geladenes Netz noch gilt: die Abschnitte und ihre Revisionen (eine neue Linie hebt sie). */
export const flussnetzSchluessel = (segmente: readonly Pick<EditorPathStreetSegment, "id" | "revision">[]): string =>
    segmente.map((a) => `${a.id}@${String(a.revision)}`).join(",");

export type RichtungJeAbschnitt = Readonly<Record<string, Fliessrichtung | null | undefined>>;

/** Wie weit das Netz der offenen Straße ist: keins (die Straße hat als gespeichert keinen Fluss), es lädt, es fehlt, oder es ist da. */
export type FlussnetzLage =
    | { readonly art: "keins" }
    | { readonly art: "laedt" }
    | { readonly art: "fehler" }
    | { readonly art: "da"; readonly netz: EditorPathFlussnetz };

/** Warum der Knopf nicht geht; `neu`: der Abschnitt ist als Fluss noch nicht gespeichert. */
export type RichtungsSperre = "einer" | "ohne" | "form" | "laedt" | "fehler" | "neu" | "schon";

export type RichtungsUebernahme =
    | {
          readonly art: "geht";
          /** Die neue Richtung je erreichtem Abschnitt, der gewählte eingeschlossen. */
          readonly richtung: Readonly<Record<string, Fliessrichtung>>;
          /** Abschnitte, deren Richtung sich ändert: gedreht oder neu gesetzt. */
          readonly geaendert: readonly string[];
          readonly gedreht: readonly string[];
          readonly neuGesetzt: readonly string[];
          /** Wie viele Abschnitte außer dem gewählten der Lauf erreicht. */
          readonly erreicht: number;
          readonly unterbrochen: readonly string[];
          readonly gabelung: readonly string[];
      }
    | { readonly art: RichtungsSperre };

/**
 * Was der Knopf täte: für genau einen gewählten Abschnitt mit Richtung, wenn das Netz zur Straße passt und keine Kurve im Entwurf ist; gesperrt
 * auch, wenn sich nichts änderte.
 */
export function richtungsUebernahme(
    lage: FlussnetzLage,
    gewaehlt: readonly string[],
    richtung: RichtungJeAbschnitt,
    kurveImEntwurf: boolean,
): RichtungsUebernahme {
    const [start] = gewaehlt;
    if (gewaehlt.length !== 1 || start === undefined) return { art: "einer" };
    const eigene = richtung[start];
    if (eigene !== "forward" && eigene !== "reverse") return { art: "ohne" };
    if (kurveImEntwurf) return { art: "form" };
    if (lage.art === "laedt" || lage.art === "fehler") return { art: lage.art };
    const netz = lage.art === "da" ? lage.netz : undefined;
    if (netz === undefined || !netz.abschnitte.some((a) => a.id === start)) return { art: "neu" };
    const lauf = fliessrichtungDemLaufNach(netz.abschnitte, start, eigene);
    const gedreht: string[] = [];
    const neuGesetzt: string[] = [];
    for (const a of netz.abschnitte) {
        const neu = lauf.neu[a.id];
        const vorher = richtung[a.id] ?? null;
        if (neu === undefined || neu === vorher) continue;
        (vorher === null ? neuGesetzt : gedreht).push(a.id);
    }
    if (gedreht.length === 0 && neuGesetzt.length === 0) return { art: "schon" };
    return {
        art: "geht",
        richtung: lauf.neu,
        geaendert: [...gedreht, ...neuGesetzt],
        gedreht,
        neuGesetzt,
        erreicht: Object.keys(lauf.neu).length - 1,
        unterbrochen: lauf.unterbrochen,
        gabelung: lauf.gabelung,
    };
}

/** Der Zustand des ganzen Flusses für (W): wo die Pfeile gegeneinander zeigen, sonst wo er offen ist, sonst durchgehend. */
export type RichtungsZustand =
    | { readonly art: "gegeneinander"; readonly paare: readonly (readonly [string, string])[] }
    | { readonly art: "offen"; readonly ids: readonly string[] }
    | { readonly art: "durchgehend" };

export function richtungsZustand(
    netz: EditorPathFlussnetz,
    segmente: readonly Pick<EditorPathStreetSegment, "id">[],
    richtung: RichtungJeAbschnitt,
): RichtungsZustand {
    const paare = fliessrichtungGegeneinander(netz.abschnitte, richtung);
    if (paare.length > 0) return { art: "gegeneinander", paare };
    const imNetz = new Set(netz.abschnitte.map((a) => a.id));
    const ids = segmente.filter((a) => imNetz.has(a.id) && !richtung[a.id]).map((a) => a.id);
    return ids.length > 0 ? { art: "offen", ids } : { art: "durchgehend" };
}

/**
 * Die Nummern der Abschnitte (1-basiert, in der Folge der Straße) als Bereiche: Drei und mehr aufeinanderfolgende werden einer, `[4, 7]`
 * heißt „4 bis 7“; die übrigen stehen einzeln, `[3]`.
 */
export function nummernBereiche(
    alle: readonly { id: string }[],
    ids: readonly string[],
): (readonly [number] | readonly [number, number])[] {
    const nr = [...new Set(ids.map((id) => alle.findIndex((a) => a.id === id) + 1).filter((n) => n > 0))].sort(
        (a, b) => a - b,
    );
    const raus: (readonly [number] | readonly [number, number])[] = [];
    for (let i = 0; i < nr.length;) {
        let j = i;
        while (j + 1 < nr.length && nr[j + 1] === nr[j]! + 1) j++;
        if (j - i >= 2) raus.push([nr[i]!, nr[j]!]);
        else for (let k = i; k <= j; k++) raus.push([nr[k]!]);
        i = j + 1;
    }
    return raus;
}
