import type {
    InhalteWerk,
    InhalteWerkAendernBody,
    InhalteWerkListe,
    InhalteWerkRolle,
    InhalteWerkSortierung,
    InhalteWerkZeile,
    InhalteZiel,
} from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import type { InhalteClient } from "./inhalte-client";
import { createKatalog, type Katalog, type KatalogAdapter } from "./inhalte-katalog-steuerung";
import {
    aktiveOrte,
    aussage,
    entwurfAlsKoerper,
    haengeNamenAn,
    haengeOrtAn,
    istAktiv,
    loeseOrt,
    schalteStart,
    setzeFeld,
    setzeRolle,
    standAusWerk,
    stelleOrtWiederHer,
    verschiebeOrt,
    zaehleAenderungen,
    type EntwurfOrt,
    type WerkFelder,
    type WerkStand,
} from "./inhalte-literatur-modell";
import { createZielSuche, type ZielSuche } from "./inhalte-ziel-suche";

/**
 * Der Zustand des Reiters „Literatur“ im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 2): der gemeinsame Kern der Reiter
 * (`inhalte-katalog-steuerung.ts`: Liste, Auswahl, Entwurf mit ↶ ↷, Speichern, Konflikt, Anlegen) mit dem, was nur die Literatur weiß:
 * die Rechnung am Entwurf (`inhalte-literatur-modell.ts`, ohne Vue, von Vitest geprüft), die Ortsliste mit ihrer Reihenfolge und die Suche
 * nach Zielen.
 *
 * - 🔴 **Ein Entwurf gehört zu EINEM Werk**; wer ein anderes wählt, während der Entwurf Änderungen trägt, bekommt die Frage.
 * - **Konflikt (409):** „eigene Änderungen anwenden“ legt die Felder und die Ortsliste auf den fremden Stand. Zeilen, die die andere Seite
 *   neu angelegt hat, bleiben hinter den eigenen stehen; eine Zeile, die der Entwurf löste, bleibt gelöst.
 */

type WerkKatalog = Katalog<InhalteWerk, InhalteWerkZeile, InhalteWerkListe, InhalteWerkSortierung, WerkStand>;

export interface LiteraturSteuerung
    extends
        Omit<WerkKatalog, "legeAn" | "dokument" | "dokumentLaedt" | "dokumentFehler" | "jetzt" | "schritt">,
        ZielSuche {
    readonly werk: WerkKatalog["dokument"];
    readonly werkLaedt: WerkKatalog["dokumentLaedt"];
    readonly werkFehler: WerkKatalog["dokumentFehler"];
    setzeFeldWert<K extends keyof WerkFelder>(feld: K, wert: WerkFelder[K]): void;
    haengeZielAn(ziel: InhalteZiel, rolle: InhalteWerkRolle): void;
    haengeNamenAn(name: string, rolle: InhalteWerkRolle): void;
    verschiebe(schluessel: string, richtung: -1 | 1): void;
    waehleRolle(schluessel: string, rolle: InhalteWerkRolle): void;
    schalteStart(schluessel: string): void;
    loese(schluessel: string): void;
    stelleHer(schluessel: string): void;
    legeAn(titel: string, art: string): Promise<void>;
}

export interface LiteraturSteuerungOptionen {
    client: InhalteClient;
    /** Wartezeit der Suche in Millisekunden; Tests nehmen 0. */
    entprellMs?: number;
    neueOperationId?: () => string;
}

const ENTPRELL_VORGABE = 250;

/** Die eigenen Änderungen der Ortsliste auf den fremden Stand legen (siehe Kopf). */
function uebertrageOrte(fremd: WerkStand, start: WerkStand, eigen: WerkStand): WerkStand {
    const fremdNachSchluessel = new Map(fremd.orte.map((o) => [o.schluessel, o]));
    const startAktiv = new Set(aktiveOrte(start).map((o) => o.schluessel));
    const platziert = new Set<string>();
    const orte: EntwurfOrt[] = [];
    for (const o of aktiveOrte(eigen)) {
        const dort = o.rowId === undefined ? undefined : fremdNachSchluessel.get(o.rowId);
        if (dort !== undefined) {
            orte.push({ ...dort, role: o.role, davor: o.davor, state: "active" });
            platziert.add(dort.schluessel);
            continue;
        }
        // Eine neu angehängte Zeile bleibt neu, es sei denn, die andere Seite führt dasselbe Ziel in derselben Rolle schon.
        const doppelt = fremd.orte.some(
            (f) => istAktiv(f) && !platziert.has(f.schluessel) && aussage(f) === aussage(o),
        );
        if (!doppelt) orte.push(o);
    }
    for (const f of fremd.orte) {
        if (platziert.has(f.schluessel)) continue;
        // Was der Entwurf gelöst hat, bleibt gelöst; was die andere Seite neu angelegt hat, bleibt hinter den eigenen Zeilen stehen.
        if (istAktiv(f) && startAktiv.has(f.schluessel)) {
            orte.push({ ...f, state: f.herkunft === "legacy" ? "suppressed" : "retired" });
        } else {
            orte.push(f);
        }
    }
    return { ...fremd, orte };
}

/** Die Fassung des Kerns für die Literatur: was nur sie über Stand, Körper, Überschneidung und Übertragen wissen. */
export function literaturAdapter(
    client: InhalteClient,
): KatalogAdapter<
    InhalteWerk,
    InhalteWerkZeile,
    InhalteWerkListe,
    InhalteWerkSortierung,
    WerkStand,
    Pick<InhalteWerkAendernBody, "fields" | "orte">
> {
    return {
        quittungsArt: "work",
        idVon: (werk) => werk.id,
        revisionVon: (werk) => werk.revision,
        zeileId: (zeile) => zeile.id,
        zeilenVon: (liste) => liste.items,
        totalVon: (liste) => liste.total,
        haengeAn: (alt, neu) => ({ ...neu, items: [...alt.items, ...neu.items] }),
        ladeListe: (wunsch, signal) =>
            client.werke(
                {
                    q: wunsch.q,
                    offset: wunsch.offset,
                    limit: wunsch.limit,
                    sort: wunsch.sort,
                    ...(wunsch.herkunft === "alle" ? {} : { herkunft: wunsch.herkunft }),
                    stand: wunsch.stand,
                },
                signal,
            ),
        ladeDokument: (id, signal) => client.werk(id, signal),
        aendere: (id, body) => client.werkAendern(id, body),
        standAus: standAusWerk,
        koerperAus: entwurfAlsKoerper,
        zaehle: zaehleAenderungen,
        pruefe: (jetzt) => (jetzt.felder.title.trim() === "" ? { code: "titel_leer", satz: "" } : undefined),
        konflikt(start, eigen, fremd) {
            const meins = entwurfAlsKoerper(start, eigen);
            const seins = entwurfAlsKoerper(start, fremd);
            const eigene = Object.keys(meins?.fields ?? {});
            const fremde = Object.keys(seins?.fields ?? {});
            const eigeneOrte = meins?.orte !== undefined;
            const fremdeOrte = seins?.orte !== undefined;
            return {
                eigene: [...eigene, ...(eigeneOrte ? ["orte"] : [])],
                fremde: [...fremde, ...(fremdeOrte ? ["orte"] : [])],
                beide: [
                    ...eigene.filter((feld) => fremde.includes(feld)),
                    ...(eigeneOrte && fremdeOrte ? ["orte"] : []),
                ],
            };
        },
        uebertrage(fremd, start, eigen) {
            const koerper = entwurfAlsKoerper(start, eigen);
            let stand = fremd;
            for (const feld of Object.keys(koerper?.fields ?? {})) {
                const key = feld as keyof WerkFelder;
                stand = setzeFeld(stand, key, eigen.felder[key] as never);
            }
            return koerper?.orte === undefined ? stand : uebertrageOrte(stand, start, eigen);
        },
    };
}

export function createLiteraturSteuerung(optionen: LiteraturSteuerungOptionen): LiteraturSteuerung {
    const { client } = optionen;
    const neueOperationId = optionen.neueOperationId ?? newOperationId;
    const entprellMs = optionen.entprellMs ?? ENTPRELL_VORGABE;
    const k = createKatalog({
        adapter: literaturAdapter(client),
        vorgabeSortierung: "title",
        entprellMs,
        neueOperationId,
    });

    function aendere(rechne: (stand: WerkStand) => WerkStand, verschmelze?: string): void {
        const aktuell = k.jetzt();
        if (aktuell !== undefined) k.schritt(rechne(aktuell), verschmelze);
    }

    const legeAn = (titel: string, art: string): Promise<void> =>
        k.legeAn(() => client.werkAnlegen({ operationId: neueOperationId(), title: titel.trim(), productType: art }));

    const ziele = createZielSuche(client, entprellMs);
    const { dokument, dokumentLaedt, dokumentFehler, jetzt: _jetzt, schritt: _schritt, ...kern } = k;
    void _jetzt;
    void _schritt;
    return {
        ...kern,
        werk: dokument,
        werkLaedt: dokumentLaedt,
        werkFehler: dokumentFehler,
        setzeFeldWert: (feld, wert) => aendere((stand) => setzeFeld(stand, feld, wert), `feld:${feld}`),
        haengeZielAn: (ziel, rolle) => aendere((stand) => haengeOrtAn(stand, ziel, rolle)),
        haengeNamenAn: (name, rolle) => aendere((stand) => haengeNamenAn(stand, name, rolle)),
        verschiebe: (schluessel, richtung) => aendere((stand) => verschiebeOrt(stand, schluessel, richtung)),
        waehleRolle: (schluessel, rolle) => aendere((stand) => setzeRolle(stand, schluessel, rolle)),
        schalteStart: (schluessel) => aendere((stand) => schalteStart(stand, schluessel)),
        loese: (schluessel) => aendere((stand) => loeseOrt(stand, schluessel)),
        stelleHer: (schluessel) => aendere((stand) => stelleOrtWiederHer(stand, schluessel)),
        legeAn,
        ...ziele,
    };
}
