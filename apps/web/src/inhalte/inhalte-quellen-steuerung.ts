import type { Ref, ShallowRef } from "vue";
import type {
    InhalteQuelle,
    InhalteQuelleAendernBody,
    InhalteQuellenListe,
    InhalteQuellenSortierung,
    InhalteQuellenZeile,
    InhalteZiel,
    SourceReferenceKind,
} from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import type { InhalteClient } from "./inhalte-client";
import { createZielSuche } from "./inhalte-ziel-suche";
import { createKatalog, type Katalog, type KatalogAdapter } from "./inhalte-katalog-steuerung";
import {
    aendereVerwendung,
    entwurfAlsKoerper,
    haengeAn,
    loeseVerwendung,
    setzeFeld,
    setzeLizenz,
    stelleWiederHer,
    standAusQuelle,
    zaehleAenderungen,
    type QuellenFelder,
    type QuellenStand,
} from "./inhalte-quellen-modell";

export { SEITE } from "./inhalte-katalog-steuerung";
export type { AnlegenZustand, SpeicherZustand } from "./inhalte-katalog-steuerung";

/**
 * Der Zustand des Reiters „Quellen“ im Fenster „Inhalte bearbeiten“ (WI-0254): der gemeinsame Kern der Reiter (`inhalte-katalog-
 * steuerung.ts`: Liste mit Suche, Filter und Sortierung, Auswahl, Entwurf mit ↶ ↷, Speichern, Konflikt, Anlegen) mit dem, was nur die
 * Quellen wissen: die Rechnung am Entwurf (`inhalte-quellen-modell.ts`, ohne Vue, von Vitest geprüft), die Suche nach Trägern zum
 * Anhängen und das Anlegen mit Adresse (die Identität einer Quelle; eine bekannte Adresse legt nichts an, sondern wählt die vorhandene).
 */

type QuellenKatalog = Katalog<
    InhalteQuelle,
    InhalteQuellenZeile,
    InhalteQuellenListe,
    InhalteQuellenSortierung,
    QuellenStand
>;

export interface QuellenSteuerung extends Omit<
    QuellenKatalog,
    "legeAn" | "dokument" | "dokumentLaedt" | "dokumentFehler" | "jetzt" | "schritt"
> {
    readonly quelle: QuellenKatalog["dokument"];
    readonly quelleLaedt: QuellenKatalog["dokumentLaedt"];
    readonly quelleFehler: QuellenKatalog["dokumentFehler"];
    setzeFeldWert<K extends keyof QuellenFelder>(feld: K, wert: QuellenFelder[K]): void;
    setzeLizenzWert(wert: string): void;
    haengeZielAn(ziel: InhalteZiel, art: SourceReferenceKind | null): void;
    aendereAngaben(
        kind: string,
        carrierId: string,
        angaben: { referenceKind?: SourceReferenceKind | null; pages?: string; note?: string },
    ): void;
    loese(kind: string, carrierId: string): void;
    stelleHer(kind: string, carrierId: string): void;
    legeAn(url: string, titel: string): Promise<void>;
    // --- Ziele zum Anhängen ---
    readonly zielText: Ref<string>;
    readonly zielTreffer: ShallowRef<readonly InhalteZiel[]>;
    readonly zielLaedt: Ref<boolean>;
    leereZiele(): void;
}

export interface QuellenSteuerungOptionen {
    client: InhalteClient;
    /** Wartezeit der Suche in Millisekunden; Tests nehmen 0. */
    entprellMs?: number;
    neueOperationId?: () => string;
}

const ENTPRELL_VORGABE = 250;

const felderOhnePaare = new Set(["lizenzKey"]);
const traegerSchluessel = (aenderung: { kind: string; carrierId: string }): string =>
    `${aenderung.kind}:${aenderung.carrierId}`;

/** Die Fassung des Kerns für die Quellen: was nur sie über Stand, Körper, Überschneidung und Übertragen wissen. */
export function quellenAdapter(
    client: InhalteClient,
): KatalogAdapter<
    InhalteQuelle,
    InhalteQuellenZeile,
    InhalteQuellenListe,
    InhalteQuellenSortierung,
    QuellenStand,
    Pick<InhalteQuelleAendernBody, "fields" | "links">
> {
    return {
        quittungsArt: "source",
        idVon: (quelle) => quelle.id,
        revisionVon: (quelle) => quelle.revision,
        zeileId: (zeile) => zeile.id,
        zeilenVon: (liste) => liste.items,
        totalVon: (liste) => liste.total,
        haengeAn: (alt, neu) => ({ ...neu, items: [...alt.items, ...neu.items] }),
        ladeListe: (wunsch, signal) =>
            client.liste(
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
        ladeDokument: (id, signal) => client.quelle(id, signal),
        aendere: (id, body) => client.aendern(id, body),
        standAus: standAusQuelle,
        koerperAus: entwurfAlsKoerper,
        zaehle: zaehleAenderungen,
        pruefe: (jetzt) => (jetzt.felder.title.trim() === "" ? { code: "titel_leer", satz: "" } : undefined),
        konflikt(start, eigen, fremd) {
            const eigene = Object.keys(entwurfAlsKoerper(start, eigen)?.fields ?? {}).filter(
                (feld) => !felderOhnePaare.has(feld),
            );
            const vomServer = Object.keys(entwurfAlsKoerper(start, fremd)?.fields ?? {}).filter(
                (feld) => !felderOhnePaare.has(feld),
            );
            // Verwendungen überschneiden sich, wo beide Seiten denselben Träger anders haben.
            const eigeneTraeger = new Set((entwurfAlsKoerper(start, eigen)?.links ?? []).map(traegerSchluessel));
            const fremdeTraeger = new Set((entwurfAlsKoerper(start, fremd)?.links ?? []).map(traegerSchluessel));
            return {
                eigene: [...eigene, ...eigeneTraeger],
                fremde: [...vomServer, ...fremdeTraeger],
                beide: [
                    ...eigene.filter((feld) => vomServer.includes(feld)),
                    ...[...eigeneTraeger].filter((schluessel) => fremdeTraeger.has(schluessel)),
                ],
            };
        },
        uebertrage(fremd, start, eigen) {
            const koerper = entwurfAlsKoerper(start, eigen);
            let stand = fremd;
            for (const feld of Object.keys(koerper?.fields ?? {})) {
                if (feld === "lizenzKey") continue;
                if (feld === "lizenzAussage") {
                    stand = setzeLizenz(
                        stand,
                        eigen.felder.lizenzAussage === "license" && eigen.felder.lizenzKey !== null
                            ? `license:${eigen.felder.lizenzKey}`
                            : eigen.felder.lizenzAussage,
                    );
                    continue;
                }
                const key = feld as keyof QuellenFelder;
                stand = setzeFeld(stand, key, eigen.felder[key] as never);
            }
            for (const eine of eigen.verwendungen) {
                const vorher = start.verwendungen.find((v) => v.kind === eine.kind && v.carrierId === eine.carrierId);
                if (!eine.aenderbar) continue;
                if (vorher === undefined && eine.state === "active") {
                    stand = haengeAn(
                        stand,
                        {
                            kind: eine.kind as InhalteZiel["kind"],
                            carrierId: eine.carrierId,
                            name: eine.name,
                            ...(eine.subtype === undefined ? {} : { subtype: eine.subtype }),
                            ...(eine.canon === undefined ? {} : { canon: eine.canon }),
                        },
                        eine.referenceKind,
                    );
                } else if (vorher !== undefined && vorher.state === "active" && eine.state !== "active") {
                    stand = loeseVerwendung(stand, eine.kind, eine.carrierId);
                } else if (vorher !== undefined && vorher.state !== "active" && eine.state === "active") {
                    stand = stelleWiederHer(stand, eine.kind, eine.carrierId);
                }
                if (eine.state === "active") {
                    stand = aendereVerwendung(stand, eine.kind, eine.carrierId, {
                        referenceKind: eine.referenceKind,
                        pages: eine.pages,
                        note: eine.note,
                    });
                }
            }
            return stand;
        },
    };
}

export function createQuellenSteuerung(optionen: QuellenSteuerungOptionen): QuellenSteuerung {
    const { client } = optionen;
    const neueOperationId = optionen.neueOperationId ?? newOperationId;
    const entprellMs = optionen.entprellMs ?? ENTPRELL_VORGABE;
    const k = createKatalog({
        adapter: quellenAdapter(client),
        vorgabeSortierung: "title",
        entprellMs,
        neueOperationId,
    });

    // --- Der Entwurf ---
    function setzeFeldWert<K extends keyof QuellenFelder>(feld: K, wert: QuellenFelder[K]): void {
        const aktuell = k.jetzt();
        if (aktuell === undefined) return;
        k.schritt(setzeFeld(aktuell, feld, wert), `feld:${feld}`);
    }
    function setzeLizenzWert(wert: string): void {
        const aktuell = k.jetzt();
        if (aktuell !== undefined) k.schritt(setzeLizenz(aktuell, wert));
    }
    function haengeZielAn(ziel: InhalteZiel, art: SourceReferenceKind | null): void {
        const aktuell = k.jetzt();
        if (aktuell !== undefined) k.schritt(haengeAn(aktuell, ziel, art));
    }
    function aendereAngaben(
        kind: string,
        carrierId: string,
        angaben: { referenceKind?: SourceReferenceKind | null; pages?: string; note?: string },
    ): void {
        const aktuell = k.jetzt();
        if (aktuell === undefined) return;
        const verschmelze =
            angaben.pages !== undefined
                ? `seiten:${kind}:${carrierId}`
                : angaben.note !== undefined
                  ? `notiz:${kind}:${carrierId}`
                  : undefined;
        k.schritt(aendereVerwendung(aktuell, kind, carrierId, angaben), verschmelze);
    }
    function loese(kind: string, carrierId: string): void {
        const aktuell = k.jetzt();
        if (aktuell !== undefined) k.schritt(loeseVerwendung(aktuell, kind, carrierId));
    }
    function stelleHer(kind: string, carrierId: string): void {
        const aktuell = k.jetzt();
        if (aktuell !== undefined) k.schritt(stelleWiederHer(aktuell, kind, carrierId));
    }

    // --- Anlegen: eine Adresse ist die Identität der Quelle ---
    const legeAn = (url: string, titel: string): Promise<void> =>
        k.legeAn(() => client.anlegen({ operationId: neueOperationId(), url: url.trim(), title: titel.trim() }), {
            code: "source_exists",
            idAus: (details) => (details as { sourceId?: string } | undefined)?.sourceId,
        });

    // --- Ziele zum Anhängen ---
    const ziele = createZielSuche(client, entprellMs, { wege: true });

    const { dokument, dokumentLaedt, dokumentFehler, jetzt: _jetzt, schritt: _schritt, ...kern } = k;
    void _jetzt;
    void _schritt;
    return {
        ...kern,
        quelle: dokument,
        quelleLaedt: dokumentLaedt,
        quelleFehler: dokumentFehler,
        setzeFeldWert,
        setzeLizenzWert,
        haengeZielAn,
        aendereAngaben,
        loese,
        stelleHer,
        legeAn,
        ...ziele,
    };
}
