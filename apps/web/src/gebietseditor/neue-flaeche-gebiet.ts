import {
    TERRITORY_TARGETS_MAX_SIDE,
    editorTerritoryAreasUrl,
    editorTerritoryTargetsUrl,
    editorTerritoryUrl,
    EDITOR_TERRITORIES_URL,
    type EditorTerritoryDetail,
    type EditorTerritoryRef,
    type EditorTerritoryTargets,
    type TerritoryAreaCreateBody,
    type TerritoryAreaCreateReceipt,
    type TerritoryCreateBody,
    type TerritoryCreateReceipt,
} from "@avesmaps3d/shared";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";
import { t, type MessageKey } from "../i18n/i18n";
import { GEBIET_ANLEGEN } from "../map/geometrie/arten";
import type { Punkt, Ziel } from "../map/geometrie/geometrie";
import type { NeueFlaecheAndockung, NeueFlaecheErgebnis, NeueFlaecheKasten } from "../map/geometrie/neue-flaeche";
import { ableitungAus, type AusstehendeFlaeche } from "./ausstehende-gebiete";
import { abweichungVorgabe, einheit, farbVariante } from "./farben";

/**
 * Die Andockung der Herrschaftsgebiete an „Neue Fläche“ (WI-0209 C3; Ablauf `map/geometrie/neue-flaeche.ts`, Vertrag im Kopf von
 * `TerritoryCreateBody` in `packages/shared/src/territory-editor.ts`; EDIT-0003 §6 „Neue Fläche“, Fragen 1 bis 4). Die Ansicht ist
 * „Politisch“, die Art `GEBIET_ANLEGEN` (eckig wie die Karte), die Ziele sind Ecken und Kanten der Gebietsflächen im Kasten.
 *
 * - **Neues Gebiet** (`gebietAnlegen` ohne festes Obergebiet; „Hier hinzufügen › Neues Herrschaftsgebiet“): Das Obergebiet ist
 *   das Gebiet, das die Karte im aktuellen Band an der ersten Ecke zeigt (`amPunkt`), sonst keins (Wurzel); die Leiste nennt es vorher
 *   (Frage 2), und mit genau diesem schreibt „Fertig“. Umgehängt wird danach im Fenster (D1).
 * - **Untergebiet** (`gebietAnlegen` mit `obergebiet`; „Untergebiet anlegen“ im Fenster): das Obergebiet steht fest.
 * - **Farbe** (D4): eine Variante des Obergebiets mit Legacys Rechnung (`farbVariante`, Abweichung seiner Ebene aus Legacys Bereichen,
 *   Platz unter den Geschwistern gewürfelt); ohne Obergebiet Legacys Grau. Das Obergebiet liest sie beim Schreiben (Farbe, Kette,
 *   Untergebiete), nicht während des Zeichnens.
 * - **Grenze zeichnen** (`grenzeZeichnen`): eine Fläche an einem Gebiet ohne eigene Fläche, auch mit abgeleiteter Grenze (◐, ●; Frage 4),
 *   gegen seine Revision.
 * - Nach „Fertig“ öffnet `geoeffnet` das Gebiet im Gebietseditor; der Platzhaltername steht dort markiert, bis jemand umbenennt (Frage 3).
 * - Gespeichert meldet `gespeichert` die Fläche, damit die Karte sie zeigt, bis die Ableitung sie zeichnet (Betreiber 2026-10-19: „sofort
 *   von der karte verschwunden“; `ausstehende-gebiete.ts`).
 */

/** Legacys Farbe eines neuen Gebiets ohne Obergebiet (`createRegionAt`, `js/map-features/map-features-region-crud.js`). */
export const FARBE_OHNE_OBERGEBIET = "#888888";

export interface GebietAnlegenDaten {
    ziele(kasten: NeueFlaecheKasten, signal: AbortSignal): Promise<EditorTerritoryTargets | null>;
    gebiet(id: string): Promise<EditorTerritoryDetail | null>;
    legeAn(body: TerritoryCreateBody): Promise<SchreibAntwort<TerritoryCreateReceipt>>;
    zeichneGrenze(id: string, body: TerritoryAreaCreateBody): Promise<SchreibAntwort<TerritoryAreaCreateReceipt>>;
}

export function createGebietAnlegenDaten(
    fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init),
): GebietAnlegenDaten {
    const lies = async <T>(url: string, signal?: AbortSignal): Promise<T | null> => {
        const antwort = await fetcher(url, {
            ...(signal === undefined ? {} : { signal }),
            cache: "no-store",
            headers: { accept: "application/json" },
        });
        return antwort.ok ? ((await antwort.json()) as T) : null;
    };
    return {
        ziele: (kasten, signal) => lies<EditorTerritoryTargets>(editorTerritoryTargetsUrl(kasten), signal),
        gebiet: (id) => lies<EditorTerritoryDetail>(editorTerritoryUrl(id)),
        legeAn: (body) => sende<TerritoryCreateReceipt>(EDITOR_TERRITORIES_URL, body, "POST", fetcher),
        zeichneGrenze: (id, body) =>
            sende<TerritoryAreaCreateReceipt>(editorTerritoryAreasUrl(id), body, "POST", fetcher),
    };
}

/** Die Ziele aus der Antwort: Ecken und Kanten der Gebietsflächen; der Name ist der des Gebiets. */
export function zieleAusGebieten(antwort: EditorTerritoryTargets): Ziel[] {
    return [
        ...antwort.corners.map((ecke): Ziel => ({
            art: "ecke",
            at: { x: ecke.x, y: ecke.y },
            objekt: ecke.areaId,
            name: ecke.name,
        })),
        ...antwort.edges.map((kante): Ziel => ({
            art: "kante",
            at: { x: kante.a[0], y: kante.a[1] },
            bis: { x: kante.b[0], y: kante.b[1] },
            objekt: kante.areaId,
            name: kante.name,
        })),
    ];
}

/**
 * Der Kasten der Ziele: der sichtbare Ausschnitt, und ist eine Seite länger als `TERRITORY_TARGETS_MAX_SIDE`, ein Kasten dieser Größe um
 * `um` (die letzte Ecke), wie bei den Wegen.
 */
export function gebietsKasten(sichtbar: NeueFlaecheKasten, um: Punkt | undefined): NeueFlaecheKasten {
    const seite = (a: number, b: number, mitte: number | undefined): [number, number] => {
        if (b - a <= TERRITORY_TARGETS_MAX_SIDE) return [a, b];
        const m = mitte ?? (a + b) / 2;
        return [m - TERRITORY_TARGETS_MAX_SIDE / 2, m + TERRITORY_TARGETS_MAX_SIDE / 2];
    };
    const [x0, x1] = seite(Math.min(sichtbar.x0, sichtbar.x1), Math.max(sichtbar.x0, sichtbar.x1), um?.x);
    const [y0, y1] = seite(Math.min(sichtbar.y0, sichtbar.y1), Math.max(sichtbar.y0, sichtbar.y1), um?.y);
    return { x0, y0, x1, y1 };
}

/**
 * Die Farbe eines neuen Untergebiets (D4): Legacys Variante der Farbe des Obergebiets (`createHueVariant` wie „Farbhierarchie
 * erstellen“), mit der Abweichung seiner Ebene und einem gewürfelten Platz unter den Geschwistern; `seed` macht sie wiederholbar.
 */
export function neueGebietsfarbe(
    eltern: Pick<EditorTerritoryDetail, "color" | "parents" | "children"> | undefined,
    seed: string,
    zufall: () => number = Math.random,
): string {
    if (eltern === undefined) return FARBE_OHNE_OBERGEBIET;
    const ebene = eltern.parents.length + 1;
    const vorgabe = abweichungVorgabe(zufall);
    const anzahl = eltern.children.length + 1;
    const platz = (art: string): number => Math.min(anzahl - 1, Math.floor(einheit(`${seed}:${art}`) * anzahl));
    return farbVariante(eltern.color, {
        index: platz("hue"),
        anzahl,
        hellIndex: platz("val"),
        seed,
        abweichung: vorgabe[Math.min(ebene, vorgabe.length) - 1] ?? 0,
    }).toLowerCase();
}

/** Aus der Antwort des Servers das Ergebnis für den Ablauf. */
function ergebnisAus(antwort: SchreibAntwort<TerritoryCreateReceipt>): NeueFlaecheErgebnis {
    if (antwort.ok) {
        const { publicId, name, mapRevision, minZoom } = antwort.quittung;
        // Ein Untergebiet zeigt die Karte erst ab seinem Band (Vorgabe nach Tiefe); darunter stünde es auch nach der Ableitung nicht da.
        const hinweis =
            minZoom !== undefined && minZoom > 0 ? t("gebietseditor.neu.abBand", { band: minZoom }) : undefined;
        return { ok: true, publicId, name, mapRevision, ...(hinweis === undefined ? {} : { hinweis }) };
    }
    return antwort.status === 0 || antwort.status >= 500
        ? { ok: false, status: antwort.status }
        : { ok: false, satz: antwort.fehler.message };
}

interface Gemeinsam {
    readonly daten: GebietAnlegenDaten;
    /** Warum es gerade nicht geht (etwa: die Gebiete der Karte sind noch nicht geladen). */
    readonly darf?: () => MessageKey | undefined;
    /** Gespeichert: das Gebiet im Gebietseditor öffnen. */
    readonly geoeffnet: (neu: { readonly publicId: string; readonly name: string }) => void;
    /** Gespeichert: die Fläche zeigen, bis die Ableitung sie zeichnet (`ausstehende-gebiete.ts`). */
    readonly gespeichert?: (flaeche: AusstehendeFlaeche) => void;
}

/** Die gespeicherte Fläche aus Quittung und Ring, für die Karte bis zur Ableitung. */
function ausstehend(
    quittung: TerritoryCreateReceipt,
    ring: readonly Punkt[],
    farbe: string | undefined,
): AusstehendeFlaeche {
    return {
        flaeche: quittung.areaId,
        gebiet: quittung.publicId,
        farbe,
        polygone: [[ring.map((p) => [p.x, p.y] as const)]],
        job: ableitungAus(quittung),
    };
}

const ansicht = { view: "political" } as const;

async function zieleFuer(
    daten: GebietAnlegenDaten,
    kasten: NeueFlaecheKasten,
    um: Punkt | undefined,
    signal: AbortSignal,
): Promise<readonly Ziel[] | null> {
    const antwort = await daten.ziele(gebietsKasten(kasten, um), signal);
    return antwort === null ? null : zieleAusGebieten(antwort);
}

/** „Neues Herrschaftsgebiet“ oder „Untergebiet anlegen“ (mit `obergebiet`): `territory.create`. */
export function gebietAnlegen(
    optionen: Gemeinsam & {
        /** Das feste Obergebiet („Untergebiet anlegen“); ohne gilt das Gebiet, das die Karte an der ersten Ecke zeigt. */
        readonly obergebiet?: EditorTerritoryRef | undefined;
        /** Das Gebiet, das die Karte im aktuellen Band an diesem Punkt zeigt (`gebiete-am-punkt.ts`), kleinste zuerst. */
        readonly amPunkt?: (punkt: Punkt) => EditorTerritoryRef | undefined;
        readonly zufall?: () => number;
    },
): NeueFlaecheAndockung {
    let ober: EditorTerritoryRef | undefined = optionen.obergebiet;
    return {
        id: optionen.obergebiet === undefined ? "gebiet" : "untergebiet",
        art: GEBIET_ANLEGEN,
        ansicht,
        titel: "gebietseditor.neu.titel",
        darf: () => optionen.darf?.(),
        objekt(ecke) {
            if (optionen.obergebiet === undefined) ober = ecke === undefined ? undefined : optionen.amPunkt?.(ecke);
            if (ecke === undefined && optionen.obergebiet === undefined) return undefined;
            return ober === undefined
                ? t("gebietseditor.neu.wurzel")
                : t("gebietseditor.neu.unter", { name: ober.name });
        },
        ziele: (kasten, um, signal) => zieleFuer(optionen.daten, kasten, um, signal),
        async schreibe(ring, operationId) {
            const eltern = ober === undefined ? undefined : await optionen.daten.gebiet(ober.id);
            if (ober !== undefined && eltern === null) return { ok: false, satz: t("gebietseditor.neu.obergebietWeg") };
            const color = neueGebietsfarbe(eltern ?? undefined, operationId, optionen.zufall);
            const antwort = await optionen.daten.legeAn({
                operationId,
                ...(ober === undefined ? {} : { parent: ober.id }),
                color,
                ring: ring.map((p) => [p.x, p.y] as [number, number]),
            });
            if (antwort.ok) optionen.gespeichert?.(ausstehend(antwort.quittung, ring, color));
            return ergebnisAus(antwort);
        },
        geoeffnet: (neu) => optionen.geoeffnet(neu),
    };
}

/** „Grenze zeichnen“ an einem Gebiet ohne eigene Fläche (Frage 4: auch mit abgeleiteter Grenze): `territory_area.create`. */
export function grenzeZeichnen(
    optionen: Gemeinsam & {
        readonly gebiet: { readonly id: string; readonly name: string; readonly revision: number };
    },
): NeueFlaecheAndockung {
    const { gebiet } = optionen;
    return {
        id: "gebiet-grenze",
        art: GEBIET_ANLEGEN,
        ansicht,
        titel: "gebietseditor.neu.titel",
        darf: () => optionen.darf?.(),
        objekt: () => t("gebietseditor.neu.grenze", { name: gebiet.name }),
        ziele: (kasten, um, signal) => zieleFuer(optionen.daten, kasten, um, signal),
        async schreibe(ring, operationId) {
            const antwort = await optionen.daten.zeichneGrenze(gebiet.id, {
                operationId,
                baseRevision: gebiet.revision,
                ring: ring.map((p) => [p.x, p.y] as [number, number]),
            });
            if (antwort.ok) optionen.gespeichert?.(ausstehend(antwort.quittung, ring, undefined));
            return ergebnisAus(antwort);
        },
        geoeffnet: (neu) => optionen.geoeffnet(neu),
    };
}
