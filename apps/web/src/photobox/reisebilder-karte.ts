import type { GeoJSONSource, Map as MapLibreMap, MapGeoJSONFeature, StyleSpecification } from "maplibre-gl";
import { watch } from "vue";
import {
    AVENTURIA,
    FLY_MAX_BAND,
    PLACE_ZOOM_FLOOR,
    fromRenderLngLat,
    renderZoomForBand,
    roundMapCoordinate,
    type ReisebildKarte,
} from "@avesmaps3d/shared";
import { phoneViewport } from "../controls/phone-viewport";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner } from "../map/interaction/types";
import { PLACE_LABEL_LAYER_IDS, PLACE_MARKER_LAYERS } from "../map/place-layers";
import { registerRuntimeImages, type RuntimeImage } from "../map/runtime-images";
import { nachStilwechsel, styleTakesChanges } from "../map/style-ready";
import { createReisebilderAbruf } from "./reisebilder-abruf";
import { createVorschauSpeicher } from "./reisebilder-vorschau";
import { buendele, fangradius, lohntHineinzoomen, trenne, type BildPunkt, type Gruppe } from "./reisebilder-buendel";
import {
    REISEBILD_FAHNEN_QUELLE,
    REISEBILD_FAHNE_EBENE,
    REISEBILD_QUELLE,
    REISEBILD_TREFFER_EBENEN,
    REISEBILD_ZEICHEN_EBENE,
    ZEICHEN_BLENDE_MS,
    fahnenDaten,
    mitReisebildern,
    renderPunkt,
    zeichenDaten,
    type FahnenEintrag,
    type PunktDaten,
    type ReisebilderDaten,
    type ZeichenEintrag,
} from "./reisebilder-ebenen";
import { bildIdFahne, bildIdZeichen, zeichneFahne, zeichneZeichen } from "./reisebilder-zeichen";
import { folgeReisebildStand } from "./reisebilder-frisch";
import { reisebilder } from "./reisebilder-zustand";
import type { ReisebilderUmfeld } from "./reisebilder-start";

/**
 * Die Reisebilder auf der Karte (WI-0272 S4, Aufgabe 27): das nachgeladene Modul. Es fragt den Lesepfad je Sicht (`reisebilder-abruf.ts`), bündelt am Schirm (`reisebilder-buendel.ts`), schreibt
 * die Daten in die zwei Quellen (`reisebilder-ebenen.ts`) und hält den Zustand für Knopf, Leiste und Bildansicht (`reisebilder-zustand.ts`). Das Startpaket trägt davon nur `reisebilder-start.ts`.
 *
 * - **Die Ebenen stehen im Stil** (`mitAktuellenReisebildern`, vom `composeStyle` der Seite gerufen), die Daten kommen per `setData`, und zwar nur, wenn sich ihr Text geändert hat: Das hält die
 *   Karte im Leerlauf ruhig und bricht die Schleife über `idle`.
 * - **Auslöser:** Nach dem Ende einer Bewegung wartet es `LEISTE_RUHE_MS`, bei einer neuen Bewegung von vorn; erst dann fragt es, rechnet `imBild` und bündelt. Beim Zoomen bündelt es im Takt von
 *   `BUENDEL_TAKT_MS` neu (ohne Abruf). `idle` rechnet einmal nach einer Änderung noch einmal (späte Ortskacheln, die erst jetzt Marker und Namen liefern).
 * - 🔴 **Der Klick gehört dem Koordinator** (Besitzer `reisebild`, Rang in `priorities.ts`), nie einem eigenen Zuhörer auf der Karte.
 * - **Nur die Standardansicht:** Andere Ansichten nehmen die Ebenen aus dem Stil (`reisebilderImStil`), dieses Modul leert den Zustand und schweigt; die Rückkehr holt die Bilder aus dem Vorrat.
 */

/** Wie lange nach dem Ende einer Bewegung Ruhe sein muss, bevor die Leiste neu rechnet (Regler melden, WI §9: Ruhe). */
export const LEISTE_RUHE_MS = 180;
/** Der Takt, in dem Bündel beim Zoomen neu geordnet werden (Betreiber-Vorgabe der Probierseite: nicht je Bild). */
export const BUENDEL_TAKT_MS = 150;
/** Der Kasten um die Mitte einer Gruppe, in dem ein Ortsmarker oder -name sie in die Fahne holt, in Bildpunkten. */
export const ORT_TREFFER_PX = 15;
/** Wie lange der Pulsring nach „Auf der Karte zeigen“ steht. */
export const PULS_MS = 1900;
/** Wie weit außerhalb des Bildes Bilder noch mitbündeln, damit Gruppen am Rand nicht springen. */
const RAND_PX = 60;
/** Ab dieser Neigung (plus halber Bildwinkel) sieht die Karte über den Horizont: dann zählt die ganze Welt. */
const HORIZONT_GRAD = 88;
const BILDWINKEL_HALB = 18.4;
const FLY_MAX_ZOOM = renderZoomForBand(FLY_MAX_BAND);

const WELT = AVENTURIA.coordinateSpace;

// --- Der Stil ------------------------------------------------------------------------------------------------------

const LEERE_DATEN: PunktDaten = { type: "FeatureCollection", features: [] };
let aktuell: ReisebilderDaten = { zeichen: LEERE_DATEN, fahnen: LEERE_DATEN };

/** Hängt die Ebenen mit den aktuellen Daten an den Stil (vom `composeStyle` der Seite über `reisebilderImStil` gerufen). */
export function mitAktuellenReisebildern(stil: StyleSpecification): StyleSpecification {
    return mitReisebildern(stil, aktuell, { telefon: phoneViewport.value });
}

// --- Die Tafel der letzten Daten --------------------------------------------------------------------------------------

interface Eintrag {
    readonly schluessel: string;
    readonly ids: readonly string[];
    readonly lng: number;
    readonly lat: number;
    readonly art: "zeichen" | "fahne";
    readonly ortId?: string;
}

interface Treffer extends Claim {
    readonly schluessel: string;
}

const istZahl = (wert: unknown): wert is number => typeof wert === "number" && Number.isFinite(wert);

export interface ReisebilderKarte {
    destroy(): void;
}

export function installReisebilderKarte(map: MapLibreMap, umfeld: ReisebilderUmfeld): ReisebilderKarte {
    const abruf = createReisebilderAbruf();
    let tafel = new Map<string, Eintrag>();
    /** Die Bildpunkte der letzten Rechnung (für `lohntHineinzoomen`). */
    let punkteJetzt: readonly BildPunkt[] = [];
    let letzterText = { zeichen: "", fahnen: "" };
    const bilderListe = new Map<string, RuntimeImage>();
    let zerstoert = false;
    let nochmal = false;
    let ruhe: ReturnType<typeof setTimeout> | undefined;
    let takt: ReturnType<typeof setTimeout> | undefined;
    let ringe: { quelle: string; id: string; zustand: "hervor" | "puls" }[] = [];
    let pulsId: string | undefined;
    let pulsUhr: ReturnType<typeof setTimeout> | undefined;

    const standard = (): boolean => umfeld.ansicht() === "standard";
    /** Die Abzüge der Vorschau (Leiste offen): geladen, gezeichnet und angemeldet; fertig löst ein neues Bündeln aus. */
    // Fertige Kacheln kommen in Schüben: Ein Takt bündelt für alle, statt je Kachel einmal.
    let vorschauTakt: ReturnType<typeof setTimeout> | undefined;
    const vorschau = createVorschauSpeicher(map, {
        onFertig: () => {
            vorschauTakt ??= setTimeout(() => {
                vorschauTakt = undefined;
                buendeln();
            }, BUENDEL_TAKT_MS);
        },
    });

    // --- Bilder des Stils --------------------------------------------------------------------------------------------

    /** Meldet ein Bild an, das der Stil nennt; es bleibt in der Liste, damit ein Stilwechsel es neu anmeldet. */
    const merkeBild = (id: string, zeichne: () => ImageData): void => {
        if (!bilderListe.has(id)) bilderListe.set(id, [id, zeichne]);
        const bild = bilderListe.get(id);
        if (bild !== undefined) registerRuntimeImages(map, [bild]);
    };
    const bildFehlt = (ereignis: { id: string }): void => {
        const bild = bilderListe.get(ereignis.id);
        if (bild !== undefined) registerRuntimeImages(map, [bild]);
        else vorschau.nachmelden(ereignis.id);
    };
    map.on("styleimagemissing", bildFehlt);

    // --- Die Sicht ------------------------------------------------------------------------------------------------------

    const leinwand = (): { breite: number; hoehe: number } => {
        const flaeche = map.getCanvas();
        return { breite: flaeche.clientWidth, hoehe: flaeche.clientHeight };
    };

    /** Die sichtbare Welt in Karteneinheiten: vier Ecken; über dem Horizont oder bei nicht endlichen Ecken die ganze Welt. */
    const sicht = (): { x0: number; y0: number; x1: number; y1: number } => {
        const welt = WELT.bounds;
        const ganz = { x0: welt.minX, y0: welt.minY, x1: welt.maxX, y1: welt.maxY };
        if (map.getPitch() + BILDWINKEL_HALB >= HORIZONT_GRAD) return ganz;
        const { breite, hoehe } = leinwand();
        const ecken = [
            [0, 0],
            [breite, 0],
            [breite, hoehe],
            [0, hoehe],
        ] as const;
        const punkte = ecken.map(([x, y]) => fromRenderLngLat(WELT, map.unproject([x, y])));
        if (punkte.some((p) => !istZahl(p.x) || !istZahl(p.y))) return ganz;
        return {
            x0: Math.min(...punkte.map((p) => p.x)),
            y0: Math.min(...punkte.map((p) => p.y)),
            x1: Math.max(...punkte.map((p) => p.x)),
            y1: Math.max(...punkte.map((p) => p.y)),
        };
    };

    // --- Die Rechnung -----------------------------------------------------------------------------------------------

    /** Wo das Bild sichtbar steht: gebundene an ihrem Ort, freie an ihrer Stelle. */
    const punktDes = (bild: ReisebildKarte): { lng: number; lat: number } => renderPunkt(bild.ort?.lage ?? bild.lage);

    const frei = (): { oben: number; rechts: number; unten: number; links: number } => {
        const rand = umfeld.frei();
        return { oben: rand.top ?? 0, rechts: rand.right ?? 0, unten: rand.bottom ?? 0, links: rand.left ?? 0 };
    };

    /** Die Bilder in der freien Fläche des Bildes, von West nach Ost (Knopf und Leiste). */
    const rechneImBild = (bilder: readonly ReisebildKarte[]): void => {
        const { breite, hoehe } = leinwand();
        const rand = frei();
        // „Meine Reisebilder“ zeigt alle eigenen, wo auch immer sie liegen.
        const drin = reisebilder.nurMeine.value
            ? bilder
            : bilder.filter((bild) => {
                  const p = map.project(punktDes(bild));
                  return (
                      p.x >= rand.links && p.x <= breite - rand.rechts && p.y >= rand.oben && p.y <= hoehe - rand.unten
                  );
              });
        const vorher = reisebilder.imBild.value;
        const gleich = vorher.length === drin.length && drin.every((bild) => vorher.some((v) => v.id === bild.id));
        if (!gleich) reisebilder.setzeImBild(drin);
    };

    const nurVorhandene = (ids: readonly string[]): string[] => ids.filter((id) => map.getLayer(id) !== undefined);

    /** Der Marker oder Name eines Orts unter der Mitte der Gruppe, falls dort einer gezeichnet ist. */
    const ortUnter = (
        gruppe: Gruppe,
    ): { ortId: string; subtype: string; capitalBands?: string; lng: number; lat: number } | undefined => {
        const ebenen = nurVorhandene([...PLACE_MARKER_LAYERS, ...PLACE_LABEL_LAYER_IDS]);
        if (ebenen.length === 0) return undefined;
        let treffer: MapGeoJSONFeature[];
        try {
            treffer = map.queryRenderedFeatures(
                [
                    [gruppe.x - ORT_TREFFER_PX, gruppe.y - ORT_TREFFER_PX],
                    [gruppe.x + ORT_TREFFER_PX, gruppe.y + ORT_TREFFER_PX],
                ],
                { layers: ebenen },
            );
        } catch {
            return undefined;
        }
        for (const merkmal of treffer) {
            const eigenschaften = merkmal.properties as Record<string, unknown> | null;
            const kennung = eigenschaften?.public_id;
            const art = eigenschaften?.subtype;
            const geometrie = merkmal.geometry;
            if (typeof kennung !== "string" || typeof art !== "string" || geometrie.type !== "Point") continue;
            const [lng, lat] = geometrie.coordinates;
            if (!istZahl(lng) || !istZahl(lat)) continue;
            const baender = eigenschaften?.capital_bands;
            return {
                ortId: kennung,
                subtype: art,
                ...(typeof baender === "string" && baender !== "" ? { capitalBands: baender } : {}),
                lng,
                lat,
            };
        }
        return undefined;
    };

    /**
     * Der Ort je Bild aus der letzten Bündelung in Ruhe. Während des Zoomens läuft das Bündeln im Takt, und je Gruppe eine Abfrage der Karte kostet dort zu viel
     * (gemessen 500 Bilder, Gareth Zoom 5: p95 9,7 ms, mit offener Leiste 32,4 ms; Grenze 4 ms, WI-0272 Aufgabe 31). Also fragt nur die Ruhe, das Zoomen liest hier.
     */
    const ortVonBild = new Map<string, NonNullable<ReturnType<typeof ortUnter>>>();

    const ortDerGruppe = (gruppe: Gruppe): ReturnType<typeof ortUnter> => {
        if (map.isZooming()) {
            for (const id of gruppe.ids) {
                const ort = ortVonBild.get(id);
                if (ort !== undefined) return ort;
            }
            return undefined;
        }
        const ort = ortUnter(gruppe);
        for (const id of gruppe.ids) {
            if (ort === undefined) ortVonBild.delete(id);
            else ortVonBild.set(id, ort);
        }
        return ort;
    };

    interface Fahne {
        ortId: string;
        subtype: string;
        capitalBands?: string;
        lng: number;
        lat: number;
        ids: string[];
    }

    /** Bündelt neu aus den Bildern des Zustands (ohne Abruf). */
    const buendeln = (ausIdle = false): void => {
        if (zerstoert || !standard() || !styleTakesChanges(map)) return;
        const start = import.meta.env.DEV ? performance.now() : 0;
        rechneBuendel(ausIdle);
        // Die Lastmessung (`e2e/reisebild-last-review.spec.ts`) liest die Zeiten; nur im Entwicklungsbau.
        if (import.meta.env.DEV) {
            const g = globalThis as unknown as { avesmapsBuendelMs?: number[]; avesmapsBuendelZoomMs?: number[] };
            g.avesmapsBuendelMs?.push(performance.now() - start);
            if (map.isZooming()) g.avesmapsBuendelZoomMs?.push(performance.now() - start);
        }
    };

    const rechneBuendel = (ausIdle: boolean): void => {
        // Ausgeblendet leeren sich Quellen und Tafel: Nichts ist zu sehen oder zu treffen, und ein Stilwechsel bringt nichts zurück.
        const bilder = reisebilder.ausgeblendet.value ? [] : reisebilder.bilder.value;
        const { breite, hoehe } = leinwand();
        const zoom = map.getZoom();
        const nachId = new Map(bilder.map((bild) => [bild.id, bild]));

        const alle: BildPunkt[] = [];
        for (const bild of bilder) {
            const p = punktDes(bild);
            const am = map.project(p);
            if (am.x < -RAND_PX || am.x > breite + RAND_PX || am.y < -RAND_PX || am.y > hoehe + RAND_PX) continue;
            alle.push({
                id: bild.id,
                x: am.x,
                y: am.y,
                lng: p.lng,
                lat: p.lat,
                ...(bild.ort === undefined ? {} : { ortId: bild.ort.id }),
            });
        }
        punkteJetzt = alle;

        // Mit offener Leiste tragen die Symbole einen Abzug des ersten Bildes, solange er fertig ist; sonst das Zeichen. Der Fangradius ist dann größer (`vorschau`).
        const mitVorschau = reisebilder.leisteOffen.value;
        const { frei: freie, gebunden } = trenne(alle);
        const fahnen = new Map<string, Fahne>();
        for (const [ortId, punkte] of gebunden) {
            const ort = nachId.get(punkte[0]?.id ?? "")?.ort;
            if (ort === undefined) continue;
            const p = renderPunkt(ort.lage);
            fahnen.set(ortId, {
                ortId,
                subtype: ort.subtype,
                ...(ort.capitalBands === undefined ? {} : { capitalBands: ort.capitalBands }),
                lng: p.lng,
                lat: p.lat,
                ids: punkte.map((q) => q.id),
            });
        }

        const freieGruppen: Gruppe[] = [];
        for (const gruppe of buendele(freie, fangradius(zoom, mitVorschau ? "vorschau" : "zeichen"))) {
            const ort = ortDerGruppe(gruppe);
            if (ort === undefined) {
                freieGruppen.push(gruppe);
                continue;
            }
            const vorhanden = fahnen.get(ort.ortId);
            if (vorhanden !== undefined) {
                vorhanden.ids.push(...gruppe.ids);
                continue;
            }
            fahnen.set(ort.ortId, { ...ort, ids: [...gruppe.ids] });
        }

        const neueTafel = new Map<string, Eintrag>();
        const zeichen: ZeichenEintrag[] = [];
        const orte: FahnenEintrag[] = [];
        const ki = (ids: readonly string[]): boolean => ids.some((id) => nachId.get(id)?.entstehung === "ai_generated");

        for (const gruppe of freieGruppen) {
            const zahl = gruppe.ids.length;
            const mitKi = ki(gruppe.ids);
            const erstes = nachId.get(gruppe.ids[0] ?? "");
            const abzug =
                mitVorschau && erstes !== undefined ? vorschau.vorschauId(erstes, 40, zahl, mitKi) : undefined;
            const bild = abzug ?? bildIdZeichen(zahl, mitKi);
            if (abzug === undefined) merkeBild(bild, () => zeichneZeichen(zahl, mitKi));
            zeichen.push({ schluessel: gruppe.schluessel, bild, lng: gruppe.lng, lat: gruppe.lat });
            neueTafel.set(gruppe.schluessel, {
                schluessel: gruppe.schluessel,
                ids: gruppe.ids,
                lng: gruppe.lng,
                lat: gruppe.lat,
                art: "zeichen",
            });
        }
        for (const fahne of [...fahnen.values()].sort((a, b) => (a.ortId < b.ortId ? -1 : 1))) {
            const ids = [...new Set(fahne.ids)].sort();
            const schluessel = ids[0];
            if (schluessel === undefined) continue;
            const zahl = ids.length;
            const erstes = nachId.get(schluessel);
            const abzug =
                mitVorschau && erstes !== undefined ? vorschau.vorschauId(erstes, 30, zahl, ki(ids)) : undefined;
            const bild = abzug ?? bildIdFahne(zahl);
            if (abzug === undefined) merkeBild(bild, () => zeichneFahne(zahl));
            orte.push({
                schluessel,
                bild,
                lng: fahne.lng,
                lat: fahne.lat,
                ortId: fahne.ortId,
                subtype: fahne.subtype,
                ...(fahne.capitalBands === undefined ? {} : { capitalBands: fahne.capitalBands }),
            });
            neueTafel.set(schluessel, {
                schluessel,
                ids,
                lng: fahne.lng,
                lat: fahne.lat,
                art: "fahne",
                ortId: fahne.ortId,
            });
        }

        vorschau.rundeEnde();
        // Frisch gebaute Daten, nie ein Vue-Proxy; nur setzen, wenn sich der Text ändert.
        const daten: ReisebilderDaten = { zeichen: zeichenDaten(zeichen), fahnen: fahnenDaten(orte) };
        const text = { zeichen: JSON.stringify(daten.zeichen), fahnen: JSON.stringify(daten.fahnen) };
        const geaendert = text.zeichen !== letzterText.zeichen || text.fahnen !== letzterText.fahnen;
        tafel = neueTafel;
        if (geaendert) {
            letzterText = text;
            aktuell = daten;
            const zeichenQuelle = map.getSource(REISEBILD_QUELLE) as GeoJSONSource | undefined;
            const fahnenQuelle = map.getSource(REISEBILD_FAHNEN_QUELLE) as GeoJSONSource | undefined;
            zeichenQuelle?.setData(daten.zeichen as unknown as Parameters<GeoJSONSource["setData"]>[0]);
            fahnenQuelle?.setData(daten.fahnen as unknown as Parameters<GeoJSONSource["setData"]>[0]);
            setzeRinge();
        }
        // Späte Ortskacheln liefern Marker und Namen erst nach dem nächsten ruhigen Bild.
        nochmal = !ausIdle;
    };

    // --- Die Ringe (Hervorhebung, Puls) ----------------------------------------------------------------------------------

    /** Die Gruppe, in der das Bild liegt. */
    const gruppeVon = (id: string): Eintrag | undefined => {
        const direkt = tafel.get(id);
        if (direkt !== undefined) return direkt;
        for (const eintrag of tafel.values()) if (eintrag.ids.includes(id)) return eintrag;
        return undefined;
    };

    const quelleVon = (eintrag: Eintrag): string =>
        eintrag.art === "fahne" ? REISEBILD_FAHNEN_QUELLE : REISEBILD_QUELLE;

    /** Setzt den Zustand je Gruppe neu (nach jedem Bündeln und bei jeder Hervorhebung): Ein Ring an einer verschwundenen Gruppe bliebe sonst hängen. */
    function setzeRinge(): void {
        if (zerstoert || !styleTakesChanges(map)) return;
        for (const ring of ringe) {
            try {
                if (map.getSource(ring.quelle) !== undefined)
                    map.removeFeatureState({ source: ring.quelle, id: ring.id }, ring.zustand);
            } catch {
                // Die Quelle gibt es nicht mehr (anderer Stil): nichts zu entfernen.
            }
        }
        ringe = [];
        const neu: { quelle: string; id: string; zustand: "hervor" | "puls" }[] = [];
        const hervor = reisebilder.hervor.value;
        const gruppe = hervor === undefined ? undefined : gruppeVon(hervor);
        if (gruppe !== undefined) neu.push({ quelle: quelleVon(gruppe), id: gruppe.schluessel, zustand: "hervor" });
        const puls = pulsId === undefined ? undefined : gruppeVon(pulsId);
        if (puls !== undefined) neu.push({ quelle: quelleVon(puls), id: puls.schluessel, zustand: "puls" });
        for (const ring of neu) {
            try {
                if (map.getSource(ring.quelle) === undefined) continue;
                map.setFeatureState({ source: ring.quelle, id: ring.id }, { [ring.zustand]: true });
                ringe.push(ring);
            } catch {
                // Die Gruppe gibt es in der Quelle noch nicht: Der nächste Lauf setzt sie.
            }
        }
    }

    /**
     * Die Leiste geht auf oder zu: Zeichen und Vorschau blenden über (die Deckkraft geht auf 0, nach `ZEICHEN_BLENDE_MS` tauschen die Bilder, dann auf 1). Bei reduzierter Bewegung gleich. `icon-size` ist
     * Layout und nicht animierbar, darum überblendet das Symbol nur (Plan S4, Entscheidung 11).
     */
    let blende: ReturnType<typeof setTimeout> | undefined;
    const stelleDeckkraft = (wert: number): void => {
        if (!styleTakesChanges(map)) return;
        for (const ebene of [REISEBILD_ZEICHEN_EBENE, REISEBILD_FAHNE_EBENE])
            if (map.getLayer(ebene) !== undefined) map.setPaintProperty(ebene, "icon-opacity", wert);
    };
    const stopLeiste = watch(
        () => reisebilder.leisteOffen.value,
        () => {
            if (blende !== undefined) clearTimeout(blende);
            blende = undefined;
            if (!standard()) return;
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                buendeln();
                return;
            }
            stelleDeckkraft(0);
            blende = setTimeout(() => {
                blende = undefined;
                buendeln();
                stelleDeckkraft(1);
            }, ZEICHEN_BLENDE_MS);
        },
        { flush: "sync" },
    );

    const stopHervor = watch(
        () => [reisebilder.hervor.value, reisebilder.markiert.value] as const,
        () => setzeRinge(),
        { flush: "sync" },
    );

    // --- Abruf und Lauf ------------------------------------------------------------------------------------------------

    const verlassen = (): void => {
        // Eine andere Ansicht: Zustand, Daten und Tafel leeren. Der Vorrat des Abrufs bleibt, die Rückkehr braucht keine neue Anfrage.
        if (reisebilder.bilder.value.length === 0 && aktuell.zeichen.features.length === 0 && tafel.size === 0) return;
        // Die Leiste bleibt „offen“, wo sie nicht zu sehen ist: Wer zur Standardansicht zurückkehrt, findet sie wieder.
        const warOffen = reisebilder.leisteOffen.value;
        reisebilder.leere();
        if (warOffen) reisebilder.setzeLeiste(true);
        tafel = new Map();
        punkteJetzt = [];
        letzterText = { zeichen: "", fahnen: "" };
        aktuell = { zeichen: LEERE_DATEN, fahnen: LEERE_DATEN };
        ringe = [];
    };

    let abrufNr = 0;
    /** Der volle Lauf: fragen (oder den Vorrat nehmen), `imBild` rechnen, bündeln. */
    const lauf = async (): Promise<void> => {
        if (zerstoert) return;
        if (!standard()) {
            verlassen();
            return;
        }
        const nr = (abrufNr += 1);
        const antwort = await abruf.hole(sicht());
        if (zerstoert || nr !== abrufNr || !standard()) return;
        if (antwort !== undefined) reisebilder.setzeAntwort(antwort);
        rechneImBild(reisebilder.bilder.value);
        buendeln();
    };

    const planeRuhe = (): void => {
        if (ruhe !== undefined) clearTimeout(ruhe);
        ruhe = setTimeout(() => {
            ruhe = undefined;
            void lauf();
        }, LEISTE_RUHE_MS);
    };
    const beiBewegung = (): void => {
        // Bei jeder Bewegung von vorn: erst nach `LEISTE_RUHE_MS` Stille rechnet die Leiste.
        if (ruhe !== undefined) {
            clearTimeout(ruhe);
            ruhe = undefined;
        }
    };
    const beiBewegungsende = (): void => planeRuhe();
    const beiZoom = (): void => {
        if (takt !== undefined || !standard()) return;
        takt = setTimeout(() => {
            takt = undefined;
            buendeln();
        }, BUENDEL_TAKT_MS);
    };
    const beiIdle = (): void => {
        if (!nochmal) return;
        nochmal = false;
        buendeln(true);
    };
    const beiGroesse = (): void => planeRuhe();
    map.on("move", beiBewegung);
    map.on("moveend", beiBewegungsende);
    map.on("zoom", beiZoom);
    map.on("idle", beiIdle);
    map.on("resize", beiGroesse);

    // Nach einem Stilwechsel: Die Ebenen stehen im Stil, die Daten gehören hinein; wer die Ansicht wechselt, kommt hier vorbei.
    const stopStil = nachStilwechsel(map, () => {
        if (!standard()) {
            verlassen();
            return;
        }
        for (const bild of bilderListe.values()) registerRuntimeImages(map, [bild]);
        if (reisebilder.bilder.value.length === 0) void lauf();
        else {
            // Die Quellen des neuen Stils tragen die Daten, die `composeStyle` mitgab; nur Ringe neu.
            setzeRinge();
        }
    });

    // --- Der Besitzer des Klicks -------------------------------------------------------------------------------------

    const mitte = (eintrag: Eintrag): [number, number] => [eintrag.lng, eintrag.lat];

    const klick = (eintrag: Eintrag): void => {
        const ids = eintrag.ids;
        const erstes = ids[0];
        if (ids.length === 1 && erstes !== undefined && reisebilder.leisteOffen.value) {
            reisebilder.oeffneAnsicht(erstes);
            return;
        }
        reisebilder.setzeLeiste(true);
        reisebilder.markiere(ids);
        const gruppe: Gruppe = {
            schluessel: eintrag.schluessel,
            ids,
            x: 0,
            y: 0,
            lng: eintrag.lng,
            lat: eintrag.lat,
        };
        if (eintrag.art === "zeichen" && lohntHineinzoomen(gruppe, punkteJetzt, map.getZoom(), FLY_MAX_ZOOM)) {
            const kamera = umfeld.camera();
            void kamera?.showPoint(mitte(eintrag), Math.min(FLY_MAX_ZOOM, map.getZoom() + 1), { free: umfeld.frei() });
        }
    };

    const besitzer: InteractionOwner<Treffer> = {
        id: "reisebild",
        priority: INTERACTION_PRIORITY.reisebild,
        kinds: ["click", "hover"],
        layers: () => nurVorhandene(REISEBILD_TREFFER_EBENEN),
        enabled: standard,
        hit(kontext) {
            const merkmal = kontext.features(nurVorhandene(REISEBILD_TREFFER_EBENEN))[0];
            const schluessel = (merkmal?.properties as Record<string, unknown> | undefined)?.schluessel;
            if (typeof schluessel !== "string" || !tafel.has(schluessel)) return undefined;
            return { cursor: "pointer", schluessel };
        },
        apply(art, treffer) {
            const eintrag = tafel.get(treffer.schluessel);
            if (eintrag === undefined) return;
            if (art === "hover") reisebilder.setzeHervor(eintrag.schluessel);
            else if (art === "click") klick(eintrag);
        },
        lost() {
            reisebilder.setzeHervor(undefined);
        },
    };
    const abmelden = umfeld.interaction.register(besitzer);

    // Esc schließt die Leiste, nach der Infobox (Stufe `info-panel`, spät angemeldet, also nach dem sichtbaren Panel). 🪤 Nicht in `map-selection`: Dort verbraucht `escapeSelection` die Taste immer.
    const stopEscape = umfeld.escape.register("info-panel", () => {
        if (!reisebilder.leisteOffen.value || !standard()) return false;
        reisebilder.setzeLeiste(false);
        return true;
    });

    // --- Der Griff für Leiste und Bildansicht --------------------------------------------------------------------------

    const bildMit = (id: string): ReisebildKarte | undefined => reisebilder.bilder.value.find((b) => b.id === id);

    const fensterPunkt = (lng: number, lat: number): { x: number; y: number } => {
        const am = map.project([lng, lat]);
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + am.x, y: rahmen.top + am.y };
    };

    const abmeldenGriff = reisebilder.verbindeKarte({
        filterGeaendert() {
            if (zerstoert || !standard()) return;
            rechneImBild(reisebilder.bilder.value);
            buendeln();
        },
        schirmVon(id) {
            if (reisebilder.ausgeblendet.value) return undefined;
            const bild = bildMit(id);
            const gruppe = gruppeVon(id);
            if (bild === undefined && gruppe === undefined) return undefined;
            if (gruppe !== undefined && gruppe.art === "zeichen") return fensterPunkt(gruppe.lng, gruppe.lat);
            if (gruppe !== undefined && gruppe.art === "fahne") {
                // Die Fahne steht nur, wo der Marker steht; sonst endet die Linie am Punkt des Bildes.
                const gezeichnet = map
                    .queryRenderedFeatures({ layers: nurVorhandene([REISEBILD_FAHNE_EBENE]) })
                    .some((m) => (m.properties as Record<string, unknown> | null)?.schluessel === gruppe.schluessel);
                if (gezeichnet) return fensterPunkt(gruppe.lng, gruppe.lat);
            }
            if (bild === undefined) return undefined;
            const p = renderPunkt(bild.lage);
            return fensterPunkt(p.lng, p.lat);
        },
        gruppeVon(id) {
            return gruppeVon(id)?.ids ?? [id];
        },
        mitteFrei() {
            // Die Mitte der freien Fläche (ohne Panels und Leiste) als Stelle der Karte, auf die Einheit der Daten gerundet.
            const { breite, hoehe } = leinwand();
            const rand = frei();
            const lage = fromRenderLngLat(
                WELT,
                map.unproject([
                    rand.links + (breite - rand.links - rand.rechts) / 2,
                    rand.oben + (hoehe - rand.oben - rand.unten) / 2,
                ]),
            );
            return istZahl(lage.x) && istZahl(lage.y)
                ? { x: roundMapCoordinate(lage.x), y: roundMapCoordinate(lage.y) }
                : undefined;
        },
        zeige(id, lage) {
            const bild = bildMit(id);
            // Noch nicht geladen (das Panel im Ortseditor, die Karte steht woanders): zur Stelle, der Abruf holt das Bild dort.
            if (bild === undefined && lage === undefined) return;
            const gruppe = gruppeVon(id);
            const ziel =
                gruppe !== undefined
                    ? { lng: gruppe.lng, lat: gruppe.lat }
                    : bild !== undefined
                      ? punktDes(bild)
                      : renderPunkt(lage!);
            const kamera = umfeld.camera();
            if (kamera === undefined) return;
            const zoom = Math.max(map.getZoom(), renderZoomForBand(PLACE_ZOOM_FLOOR));
            void kamera.showPoint([ziel.lng, ziel.lat], zoom, { free: umfeld.frei() }).then(() => {
                // Nach der Fahrt ordnen sich die Gruppen neu; der Ring gilt der, in der das Bild dann liegt.
                pulsId = id;
                if (pulsUhr !== undefined) clearTimeout(pulsUhr);
                setTimeout(() => setzeRinge(), LEISTE_RUHE_MS + 120);
                pulsUhr = setTimeout(
                    () => {
                        pulsId = undefined;
                        setzeRinge();
                    },
                    PULS_MS + LEISTE_RUHE_MS + 120,
                );
            });
        },
        neuLaden() {
            abruf.vergiss();
            planeRuhe();
        },
    });

    // Die Browserfälle lesen den Zustand hier und zählen die Abrufe (nur Entwicklung, nicht im Bau).
    if (import.meta.env.DEV)
        (globalThis as unknown as { avesmapsReisebilder?: typeof reisebilder }).avesmapsReisebilder = reisebilder;

    // Neue Bilder erscheinen von selbst, im vorhandenen Takt und ohne Hinweis.
    map.once("remove", folgeReisebildStand({ kopfNeu: umfeld.kopfNeu }));

    // Der erste Lauf: Die Ebenen kommen in den Stil, dann die Daten.
    umfeld.stilNeu();
    void lauf();

    return {
        destroy(): void {
            zerstoert = true;
            if (ruhe !== undefined) clearTimeout(ruhe);
            if (takt !== undefined) clearTimeout(takt);
            if (pulsUhr !== undefined) clearTimeout(pulsUhr);
            map.off("move", beiBewegung);
            map.off("moveend", beiBewegungsende);
            map.off("zoom", beiZoom);
            map.off("idle", beiIdle);
            map.off("resize", beiGroesse);
            map.off("styleimagemissing", bildFehlt);
            stopStil();
            stopHervor();
            stopLeiste();
            if (blende !== undefined) clearTimeout(blende);
            if (vorschauTakt !== undefined) clearTimeout(vorschauTakt);
            vorschau.leere();
            stopEscape();
            abmelden();
            abmeldenGriff();
            abruf.vergiss();
        },
    };
}
