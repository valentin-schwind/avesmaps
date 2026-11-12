import {
    editorTerritoryFormUrl,
    editorTerritoryUrl,
    pointInGeometry,
    type EditorTerritoryForm,
    type TerritoryUpdateBody,
    type TerritoryUpdateReceipt,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, type Fetcher } from "../auth/api";
import type { HandgriffWahl } from "../editor-menu/action";
import { TEILE_GRIFF } from "../editor-menu/handgriffe-gebiet";
import { sende } from "../fenster/entwurf-senden";
import { formatDecimal, t } from "../i18n/i18n";
import { ableitungAus, type AusstehendeFlaeche } from "./ausstehende-gebiete";

/**
 * „Unterpolygone löschen …“ am Herrschaftsgebiet (OPS-000075; Melder auf der Stage, wörtlich: „Beim Editieren entstandene Unterpolygone wie z.B.
 * außer halb von Uhdenwald sind nicht löschbar. Das muss über einen rechtsklick auf ein Unterpolygon gehen (oder rechtslick auf ein volles und du
 * machst Unterpolygone löschen -> 1, 2, 3... und markierst die betroffenen in dem augenblick rot)“).
 *
 * Eine Fläche des Gebiets (`territory_area.geom`) ist ein MultiPolygon; das Editieren hinterlässt Splitter, die kein Griff der Form fasst. Hier
 * steht, was das Kartenmenü dafür braucht (der Eintrag selbst: `editor-menu/handgriffe-gebiet.ts`):
 *
 * - **Lesen** beim Öffnen des Menüs: der schlanke Lesepfad der Form (`GET …/territories/:id/form?x=&y=&nur=flaechen`, nur die eigenen Flächen mit
 *   Revision, ohne Nachbarn und Kanten). Mit dem Klickpunkt gilt an einem abgeleiteten Gebiet die Baronie darunter, wie bei „Gebietsform bearbeiten“.
 *   Sobald die Teile da sind, baut `app.vue` das Menü noch einmal (`bereit`); jede neue Kachelrevision macht sie alt (`vergiss`).
 * - **Die Liste** nennt die Teile einer Fläche mit mehr als einem Teil: kleinster zuerst, je Zeile „Teil n“ und die Größe in Karteneinheiten. Liegt der
 *   Rechtsklick auf einem kleinen Teil, steht dieser vorn und ist vorgewählt (`vorgewaehlt`). Die Hauptfläche steht in der Liste, ist aber nicht
 *   löschbar, solange sie der größte Teil ist (Zeile grau mit Grund). Zeigen oder Fokus lässt genau den Teil auf der Karte rot leuchten
 *   (`map/gebiet-teile-leuchten.ts`, `umriss`).
 * - **Löschen** je Zeile, sofort: Es gibt keinen eigenen Schreibweg. Die Fläche ohne den Teil geht als `territory.update` mit `areas` an den Server
 *   (`PATCH …/territories/:id`), gegen die Revision der Fläche gelesen; das Fachprotokoll trägt die Form davor und danach
 *   (`territory_area.reshaped`), ↺ in „Änderungen“ holt den Teil zurück (`ruecknahme-gebiet.ts`, Art „Felder“). Der letzte Teil einer Fläche
 *   lässt sich nie entfernen: Der Vertrag verlangt mindestens ein Polygon, der Server prüft es noch einmal (`pruefeGebietsflaechen`).
 */

type Ecke = readonly [number, number];
type Ring = readonly Ecke[];
/** Ein Teil einer Fläche: der äußere Ring, dann die Löcher; ohne Schlusspunkt, in Kartenkoordinaten. */
export type TeilPolygon = readonly Ring[];

/** Ein Teil einer Fläche des Gebiets. */
export interface GebietTeil {
    /** Die Kennung der Wahl im Menü: `<Fläche>:<Nummer des Polygons ab 0>`; über alle Gebiete eindeutig. */
    readonly wahl: string;
    /** Die Fläche (`territory_area.public_id`), zu der der Teil gehört. */
    readonly flaeche: string;
    /** Die Nummer des Polygons in der Folge, in der die Fläche gespeichert ist. */
    readonly index: number;
    /** Die Größe in Karteneinheiten zum Quadrat: außen minus die Löcher. */
    readonly groesse: number;
    readonly polygon: TeilPolygon;
    /** Der größte Teil seiner Fläche: Er bleibt. */
    readonly haupt: boolean;
}

/** Was ein Rechtsklick über ein Gebiet erfährt: die Flächen mit Revision und ihre Teile in der Folge des Menüs. */
export interface GebietTeile {
    /** Das Gebiet, dem die Flächen gehören (an einem abgeleiteten Gebiet die Baronie unter dem Klickpunkt) und sein Name. */
    readonly gebiet: string;
    readonly name: string;
    readonly flaechen: ReadonlyMap<string, { readonly revision: number; readonly polygons: readonly TeilPolygon[] }>;
    /** Nur Teile von Flächen mit mehr als einem Teil; der vorgewählte zuerst, dann kleinste zuerst. */
    readonly teile: readonly GebietTeil[];
    /** Der kleine Teil unter dem Rechtsklick (`GebietTeil.wahl`), sonst keiner. */
    readonly vorgewaehlt: string | undefined;
}

const flaecheEines = (ring: Ring): number => {
    let summe = 0;
    for (let i = 0; i < ring.length; i += 1) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[(i + 1) % ring.length]!;
        summe += ax * by - bx * ay;
    }
    return Math.abs(summe) / 2;
};

/** Die Größe eines Polygons: der äußere Ring ohne die Löcher. */
export const groesseVon = (polygon: TeilPolygon): number =>
    polygon.reduce((summe, ring, i) => summe + (i === 0 ? 1 : -1) * flaecheEines(ring), 0);

/** Liegt der Punkt im Polygon (Löcher zählen nicht)? */
const liegtIn = (polygon: TeilPolygon, punkt: { x: number; y: number }): boolean =>
    pointInGeometry([punkt.x, punkt.y], {
        type: "Polygon",
        coordinates: polygon.map((ring) => ring.map(([x, y]) => [x, y])),
    });

/**
 * Die Teile aus dem Lesepfad der Form. Flächen mit nur einem Teil tragen nichts bei; hat keine Fläche mehrere, gibt es nichts zu löschen
 * (`undefined`). `punkt` ist der Rechtsklick in Kartenkoordinaten.
 */
export function teileAus(form: EditorTerritoryForm, punkt?: { x: number; y: number }): GebietTeile | undefined {
    const flaechen = new Map<string, { revision: number; polygons: readonly TeilPolygon[] }>();
    const alle: GebietTeil[] = [];
    for (const flaeche of form.areas) {
        flaechen.set(flaeche.id, { revision: flaeche.revision, polygons: flaeche.polygons });
        if (flaeche.polygons.length < 2) continue;
        const teile = flaeche.polygons.map((polygon, index) => ({ index, polygon, groesse: groesseVon(polygon) }));
        // Der erste größte Teil ist die Hauptfläche (bei gleicher Größe der vordere).
        const haupt = teile.reduce((groesster, teil) => (teil.groesse > groesster.groesse ? teil : groesster));
        for (const teil of teile)
            alle.push({
                wahl: `${flaeche.id}:${String(teil.index)}`,
                flaeche: flaeche.id,
                index: teil.index,
                groesse: teil.groesse,
                polygon: teil.polygon,
                haupt: teil === haupt,
            });
    }
    if (alle.length === 0) return undefined;
    // Kleinste zuerst, bei gleicher Größe die Folge der Speicherung.
    const nachGroesse = alle
        .map((teil, i) => ({ teil, i }))
        .sort((a, b) => a.teil.groesse - b.teil.groesse || a.i - b.i)
        .map(({ teil }) => teil);
    const vorgewaehlt =
        punkt === undefined ? undefined : nachGroesse.find((teil) => !teil.haupt && liegtIn(teil.polygon, punkt));
    return {
        gebiet: form.id,
        name: form.name,
        flaechen,
        teile:
            vorgewaehlt === undefined
                ? nachGroesse
                : [vorgewaehlt, ...nachGroesse.filter((teil) => teil !== vorgewaehlt)],
        vorgewaehlt: vorgewaehlt?.wahl,
    };
}

/** Die Größe als Zahl der Sprache der Seite: wenige Stellen, bei kleinen Teilen genug Nachkommastellen („0,0005“, „158,8“, „12.345“). */
export function groesseText(groesse: number): string {
    if (groesse >= 1000) return formatDecimal(groesse, 0);
    if (groesse >= 10) return formatDecimal(groesse, 1);
    if (groesse >= 1) return formatDecimal(groesse, 2);
    if (groesse <= 0) return formatDecimal(0, 0);
    // Zwei gültige Ziffern, höchstens acht Nachkommastellen.
    return formatDecimal(groesse, Math.min(8, Math.ceil(-Math.log10(groesse)) + 1));
}

/** Das Untermenü: je Teil eine Zeile „Teil n“ mit der Größe; die Hauptfläche grau mit Grund. Die Nummer ist die Stelle in der Liste. */
export function wahlenAus(stand: GebietTeile): HandgriffWahl[] {
    return stand.teile.map((teil, i): HandgriffWahl => {
        const text = t("gebietseditor.unterpolygone.teil", { n: i + 1 });
        const groesse = groesseText(teil.groesse);
        return teil.haupt
            ? {
                  id: teil.wahl,
                  text,
                  hinweis: `${groesse} · ${t("gebietseditor.unterpolygone.haupt")}`,
                  grund: "gebietseditor.unterpolygone.hauptGrund",
              }
            : { id: teil.wahl, text, hinweis: groesse, vorschau: true };
    });
}

/** Die Fläche ohne den Teil, als Polygone zum Schreiben; `undefined`, wenn der Teil fehlt, die Hauptfläche ist oder der letzte wäre. */
export function ohneTeil(
    stand: GebietTeile,
    wahl: string,
): { flaeche: string; revision: number; rest: [number, number][][][] } | undefined {
    const teil = stand.teile.find((x) => x.wahl === wahl);
    const flaeche = teil === undefined ? undefined : stand.flaechen.get(teil.flaeche);
    if (teil === undefined || teil.haupt || flaeche === undefined) return undefined;
    const rest = flaeche.polygons
        .filter((_, i) => i !== teil.index)
        .map((polygon) => polygon.map((ring) => ring.map(([x, y]): [number, number] => [x, y])));
    // Der letzte Teil einer Fläche bleibt (der Server verlangt mindestens ein Polygon).
    return rest.length === 0 ? undefined : { flaeche: teil.flaeche, revision: flaeche.revision, rest };
}

/** Das Ergebnis des Löschens: die Quittung mit allem, was die Seite danach braucht, oder der Satz, der sagt, warum nicht. */
export type TeilLoeschen =
    | {
          readonly ok: true;
          readonly quittung: TerritoryUpdateReceipt;
          readonly name: string;
          /** Die geschriebene Fläche, bis die Ableitung sie zeichnet (`ausstehende-gebiete.ts`). */
          readonly flaeche: AusstehendeFlaeche;
      }
    | { readonly ok: false; readonly satz: string };

export interface GebietTeileDienst {
    /** Liest die Teile der Gebiete unter dem Rechtsklick (je Gebiet einmal) und wartet, bis alle da sind; `punkt` in Kartenkoordinaten. */
    bereit(ids: readonly string[], punkt: { x: number; y: number } | undefined): Promise<void>;
    /** Die Zeilen des Untermenüs an diesem Gebiet; leer, solange nicht gelesen, bei einem Fehler und bei nur einem Teil. */
    wahlen(id: string): readonly HandgriffWahl[];
    /** Der Umriss eines Teils (äußerer Ring und Löcher) für das rote Leuchten; `wahl` fehlt: der vorgewählte. */
    umriss(id: string, wahl: string | undefined): TeilPolygon | undefined;
    /** Löscht den Teil: EINE Operation `territory.update` gegen die Revision der Fläche, so wie gelesen. */
    loesche(id: string, wahl: string): Promise<TeilLoeschen>;
    /** Vergisst alles Gelesene (nach jeder neuen Kachelrevision). */
    vergiss(): void;
}

interface Gelesen {
    /** Gebiet und Stelle, für die gelesen wurde. */
    schluessel: string;
    stand: "laedt" | "da" | "fehler";
    daten?: GebietTeile | undefined;
    warte: Promise<void>;
}

/** Die Adresse des schlanken Lesepfads: nur die eigenen Flächen, mit dem Klickpunkt an einem abgeleiteten Gebiet die Baronie darunter. */
export const teileUrl = (id: string, punkt: { x: number; y: number } | undefined): string =>
    `${editorTerritoryFormUrl(id, punkt)}${punkt === undefined ? "?" : "&"}nur=flaechen`;

export function createGebietTeile(fetcher: Fetcher = (eingabe, init) => fetch(eingabe, init)): GebietTeileDienst {
    const gelesen = new Map<string, Gelesen>();

    const lies = (id: string, punkt: { x: number; y: number } | undefined): Gelesen => {
        const schluessel = punkt === undefined ? id : `${id}@${punkt.x.toFixed(3)},${punkt.y.toFixed(3)}`;
        const da = gelesen.get(id);
        if (da !== undefined && da.schluessel === schluessel && da.stand !== "fehler") return da;
        const neu: Gelesen = { schluessel, stand: "laedt", warte: Promise.resolve() };
        neu.warte = getJson<EditorTerritoryForm>(teileUrl(id, punkt), fetcher).then(
            (form) => {
                // Ein späteres Lesen an anderer Stelle gilt; dieses ist überholt.
                if (gelesen.get(id) !== neu) return;
                neu.daten = teileAus(form, punkt);
                neu.stand = "da";
            },
            () => {
                if (gelesen.get(id) === neu) neu.stand = "fehler";
            },
        );
        gelesen.set(id, neu);
        return neu;
    };

    return {
        async bereit(ids, punkt) {
            await Promise.all(ids.map((id) => lies(id, punkt).warte));
        },
        wahlen(id) {
            const daten = gelesen.get(id)?.daten;
            return daten === undefined ? [] : wahlenAus(daten);
        },
        umriss(id, wahl) {
            const daten = gelesen.get(id)?.daten;
            if (daten === undefined) return undefined;
            const gemeint = wahl ?? daten.vorgewaehlt;
            return daten.teile.find((teil) => teil.wahl === gemeint)?.polygon;
        },
        async loesche(id, wahl) {
            const daten = gelesen.get(id)?.daten;
            const ziel = daten === undefined ? undefined : ohneTeil(daten, wahl);
            if (daten === undefined || ziel === undefined)
                return { ok: false, satz: t("gebietseditor.unterpolygone.veraltet") };
            const body: TerritoryUpdateBody = {
                operationId: newOperationId(),
                areas: [{ id: ziel.flaeche, baseRevision: ziel.revision, polygons: ziel.rest }],
            };
            const antwort = await sende<TerritoryUpdateReceipt>(
                editorTerritoryUrl(daten.gebiet),
                body,
                "PATCH",
                fetcher,
            );
            // Was gelesen ist, ist jetzt alt (neue Revision der Fläche); das nächste Menü liest neu.
            gelesen.clear();
            if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
            const job = ableitungAus(antwort.quittung);
            return {
                ok: true,
                quittung: antwort.quittung,
                name: daten.name,
                flaeche: {
                    flaeche: ziel.flaeche,
                    gebiet: daten.gebiet,
                    polygone: ziel.rest,
                    ...(job === undefined ? {} : { job }),
                },
            };
        },
        vergiss() {
            gelesen.clear();
        },
    };
}

/**
 * Welcher Teil gerade rot leuchten soll, aus dem, was das Kartenmenü meldet (`MapContextMenu` `vorschau`): `unter` ist der offene Eintrag mit
 * Untermenü (`<Gebiet>|gebiet-unterpolygone-loeschen` in der Liste „Hier liegen N Flächen“, sonst ohne Gebiet davor), `eintrag` die gezeigte Zeile
 * (`…#<Teil>`). Ohne gezeigte Zeile gilt der vorgewählte Teil: Er leuchtet, sobald das Untermenü aufgeht. `einziges` ist das eine Gebiet unter
 * dem Rechtsklick, wenn es nur eines gibt.
 */
export function leuchtendeWahl(
    unter: string | undefined,
    eintrag: string | undefined,
    einziges: string | undefined,
): { gebiet: string; wahl: string | undefined } | undefined {
    const offen = unter?.split("#")[0];
    if (offen === undefined || offen.split("|").at(-1) !== TEILE_GRIFF) return undefined;
    const stelle = offen.indexOf("|");
    const gebiet = stelle < 0 ? einziges : offen.slice(0, stelle);
    if (gebiet === undefined) return undefined;
    const wahl = eintrag?.split("#")[1];
    return { gebiet, wahl };
}
