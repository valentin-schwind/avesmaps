import type { Map as MapLibreMap } from "maplibre-gl";
import type { ReisebildKarte } from "@avesmaps3d/shared";
import { BILD_PIXELVERHAELTNIS, bildIdVorschau, zeichneVorschau, type AbzugKante } from "./reisebilder-zeichen";

/**
 * Die Vorschaubilder auf der Karte (WI-0272 S4, Aufgabe 29): Solange die Leiste offen ist, tragen die Symbole statt des Zeichens einen kleinen Abzug des ersten Bildes ihrer Gruppe. Der Speicher
 * holt die Kachel (`photobox_kachel`) nach, zeichnet den Abzug und meldet ihn der Karte als Bild an.
 *
 * - **Nachladen, nie warten:** `vorschauId` liefert die Kennung, wenn der Abzug fertig ist; sonst `undefined` (das Symbol bleibt das Zeichen) und das Laden beginnt. Fertig meldet `onFertig`, dann
 *   bündelt die Karte neu. Höchstens `gleichzeitig` Ladevorgänge zugleich (Regler melden, WI §9: Vorschaubilder), jedes Bild höchstens einmal.
 * - **Grenze:** Höchstens `grenze` Abzüge stehen als Bild in der Karte (`VORSCHAU_MAX`); `rundeEnde` wirft die ältesten über der Grenze heraus, nie einen, den die aktuelle Runde noch braucht.
 * - **Fehler schweigen:** Scheitert das Laden (404, kaputtes Bild), bleibt es beim Zeichen. Der Fehler wird gemerkt, es fragt nicht in jeder Runde neu.
 * - **Ein Bild, mehrere Abzüge:** Die Zahl der Gruppe und das KI-Zeichen sind in den Abzug eingezeichnet; bei anderer Zahl entsteht aus derselben geladenen Kachel ein neuer Abzug, ohne neues Laden.
 */

/** Wie viele Abzüge höchstens als Bild in der Karte stehen (Regler melden, WI §9: Vorschaubilder). */
export const VORSCHAU_MAX = 120;
/** Wie viele Kacheln höchstens zugleich geladen werden. */
export const VORSCHAU_GLEICHZEITIG = 4;
/** Die Breite, auf die die Kachel beim Dekodieren verkleinert wird: Das Zeichen misst 40 px, doppelt für scharfe Darstellung, mit Luft. */
export const VORSCHAU_BREITE = 120;
/** Wie viele Abzüge eine Runde des Bündelns höchstens neu zeichnet; der Rest bleibt bis zur nächsten Runde das Zeichen (Zeichnen und Anmelden kosten, gemessen bis 48 ms je Runde). */
export const VORSCHAU_NEU_JE_RUNDE = 4;

/** Eine geladene Kachel, wie `createImageBitmap` sie liefert (`close` gibt den Speicher frei). */
export type VorschauBitmap = Pick<ImageBitmap, "width" | "height"> & CanvasImageSource & { close?: () => void };

export interface VorschauOptionen {
    /** Die Kachel laden; Vorgabe: `fetch` und `createImageBitmap` auf `VORSCHAU_BREITE`. */
    readonly laden?: (url: string) => Promise<VorschauBitmap>;
    /** Den Abzug zeichnen; Vorgabe: `zeichneVorschau`. */
    readonly zeichne?: typeof zeichneVorschau;
    readonly grenze?: number;
    readonly gleichzeitig?: number;
    readonly neuJeRunde?: number;
    /** Ein Abzug ist fertig geladen: Die Karte bündelt neu. */
    readonly onFertig?: () => void;
}

export interface VorschauSpeicher {
    /** Die Bildkennung des Abzugs, wenn er fertig ist; sonst `undefined` und das Laden beginnt. */
    vorschauId(bild: ReisebildKarte, kante: AbzugKante, zahl: number, ki: boolean): string | undefined;
    /** Das Ende einer Runde des Bündelns: Überzählige und nicht mehr gebrauchte Abzüge fallen. */
    rundeEnde(): void;
    /** Die Karte vermisst ein Bild (`styleimagemissing`): Es wird aus der geladenen Kachel neu gezeichnet. `true`, wenn es eins von uns war. */
    nachmelden(bildId: string): boolean;
    /** Alles abmelden und freigeben (die Karte räumt ab). */
    leere(): void;
}

type KarteMitBildern = Pick<MapLibreMap, "hasImage" | "addImage" | "removeImage">;

async function ladeKachel(url: string): Promise<ImageBitmap> {
    const antwort = await fetch(url, { credentials: "same-origin" });
    if (!antwort.ok) throw new Error(`Kachel ${url}: ${String(antwort.status)}`);
    return createImageBitmap(await antwort.blob(), { resizeWidth: VORSCHAU_BREITE, resizeQuality: "medium" });
}

interface Abzug {
    readonly bildId: string;
    readonly kante: AbzugKante;
    readonly zahl: number;
    readonly ki: boolean;
}

export function createVorschauSpeicher(map: KarteMitBildern, optionen: VorschauOptionen = {}): VorschauSpeicher {
    const laden = optionen.laden ?? ladeKachel;
    const zeichne = optionen.zeichne ?? zeichneVorschau;
    const grenze = optionen.grenze ?? VORSCHAU_MAX;
    const gleichzeitig = optionen.gleichzeitig ?? VORSCHAU_GLEICHZEITIG;
    const neuJeRunde = optionen.neuJeRunde ?? VORSCHAU_NEU_JE_RUNDE;
    let neuInRunde = 0;
    let nochOffen = false;

    /** Die geladenen Kacheln je Bildkennung (in der Reihenfolge der letzten Nutzung). */
    const kacheln = new Map<string, VorschauBitmap>();
    /** Die angemeldeten Abzüge je Bildkennung der Karte (in der Reihenfolge der letzten Nutzung). */
    const abzuege = new Map<string, Abzug>();
    const gescheitert = new Set<string>();
    const wartend: { bildId: string; url: string }[] = [];
    const bestellt = new Set<string>();
    let aktiv = 0;
    /** Was die laufende Runde braucht: Das fällt nicht heraus. */
    let gebrauchtKacheln = new Set<string>();
    let gebrauchtAbzuege = new Set<string>();
    let zerstoert = false;

    const melde = (id: string, abzug: Abzug, kachel: VorschauBitmap): boolean => {
        try {
            const daten = zeichne(kachel, { kante: abzug.kante, zahl: abzug.zahl, ki: abzug.ki });
            if (map.hasImage(id)) map.removeImage(id);
            map.addImage(id, daten, { pixelRatio: BILD_PIXELVERHAELTNIS });
            abzuege.set(id, abzug);
            return true;
        } catch (fehler) {
            console.error(`Vorschau ${id} nicht angemeldet`, fehler);
            return false;
        }
    };

    const pumpe = (): void => {
        while (!zerstoert && aktiv < gleichzeitig) {
            const naechste = wartend.shift();
            if (naechste === undefined) return;
            aktiv += 1;
            laden(naechste.url)
                .then((kachel) => {
                    if (zerstoert) {
                        kachel.close?.();
                        return;
                    }
                    kacheln.set(naechste.bildId, kachel);
                    optionen.onFertig?.();
                })
                .catch(() => {
                    gescheitert.add(naechste.bildId);
                })
                .finally(() => {
                    aktiv -= 1;
                    bestellt.delete(naechste.bildId);
                    pumpe();
                });
        }
    };

    return {
        vorschauId(bild, kante, zahl, ki) {
            const id = bildIdVorschau(bild.id, kante, zahl, ki);
            gebrauchtKacheln.add(bild.id);
            const kachel = kacheln.get(bild.id);
            if (kachel !== undefined) {
                gebrauchtAbzuege.add(id);
                // Die Reihenfolge der letzten Nutzung: neu einsortieren.
                kacheln.delete(bild.id);
                kacheln.set(bild.id, kachel);
                if (abzuege.has(id) && map.hasImage(id)) {
                    const abzug = abzuege.get(id);
                    abzuege.delete(id);
                    if (abzug !== undefined) abzuege.set(id, abzug);
                    return id;
                }
                if (neuInRunde >= neuJeRunde) {
                    nochOffen = true;
                    return undefined;
                }
                neuInRunde += 1;
                return melde(id, { bildId: bild.id, kante, zahl, ki }, kachel) ? id : undefined;
            }
            if (gescheitert.has(bild.id) || bestellt.has(bild.id)) return undefined;
            bestellt.add(bild.id);
            wartend.push({ bildId: bild.id, url: bild.kachel?.url ?? bild.datei.url });
            pumpe();
            return undefined;
        },
        rundeEnde() {
            for (const [id] of abzuege) {
                if (abzuege.size <= grenze) break;
                if (gebrauchtAbzuege.has(id)) continue;
                if (map.hasImage(id)) map.removeImage(id);
                abzuege.delete(id);
            }
            for (const [bildId, kachel] of kacheln) {
                if (kacheln.size <= grenze) break;
                if (gebrauchtKacheln.has(bildId)) continue;
                kachel.close?.();
                kacheln.delete(bildId);
            }
            gebrauchtKacheln = new Set();
            gebrauchtAbzuege = new Set();
            neuInRunde = 0;
            // Was diese Runde nicht mehr zeichnen durfte, holt die nächste nach.
            if (nochOffen) {
                nochOffen = false;
                optionen.onFertig?.();
            }
        },
        nachmelden(bildId) {
            const abzug = abzuege.get(bildId);
            if (abzug === undefined) return false;
            const kachel = kacheln.get(abzug.bildId);
            if (kachel === undefined) return false;
            melde(bildId, abzug, kachel);
            return true;
        },
        leere() {
            zerstoert = true;
            for (const id of abzuege.keys()) if (map.hasImage(id)) map.removeImage(id);
            abzuege.clear();
            for (const kachel of kacheln.values()) kachel.close?.();
            kacheln.clear();
            wartend.length = 0;
        },
    };
}
