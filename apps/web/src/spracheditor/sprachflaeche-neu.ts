import { t, type MessageKey } from "../i18n/i18n";
import { SPRACHE_ANLEGEN } from "../map/geometrie/arten";
import type { NeueFlaecheAndockung, NeueFlaecheErgebnis } from "../map/geometrie/neue-flaeche";
import type { SprachenDaten } from "./sprachen-daten";
import type { SprachSperre } from "./sprach-sperre";

/**
 * „Neue Teilfläche“ an einer Sprache (WI-0261 S5d2, seit Stufe 1 unter „Hier hinzufügen“ im Kartenmenü; Bauvorlage `karte.js` `startZeichnen`,
 * Modusleiste „Fläche zeichnen“): die Andockung der Sprachen an „Neue Fläche“ (`map/geometrie/neue-flaeche.ts`, EIN Anlegen-Ablauf für alle
 * Flächen). Die Ansicht ist Derographie › Sprachen, die Art `SPRACHE_ANLEGEN` (eckig, ohne Einrasten, E4), Ziele gibt es keine.
 *
 * - **Geschrieben** wird `sprache_flaeche.create` gegen die Revision der Sprache, als ein Polygon mit dem gezeichneten Ring. 🔴 Der Server
 *   verlangt die Sperre der Sprache: „Fertig“ nimmt sie für diesen einen Schreibweg (`SprachSperre.unter`) und gibt sie danach ab, es sei
 *   denn, ein Entwurf derselben Sprache hält sie ohnehin.
 * - **Danach** öffnet `geoeffnet` die Sprache im Spracheditor (sie war meist schon offen), die neue Teilfläche gewählt im Reiter „Flächen“, und
 *   liest sie neu; die Karte lädt die Kacheln der Sprachen mit der Revision der Quittung.
 */

export interface SprachflaecheNeuOptionen {
    readonly sprache: { readonly id: string; readonly name: string; readonly revision: number };
    readonly daten: Pick<SprachenDaten, "flaecheAnlegen">;
    readonly sperre: Pick<SprachSperre, "unter">;
    /** Warum es gerade nicht geht; ohne Grund geht es. */
    readonly darf?: () => MessageKey | undefined;
    /** Geschrieben: die Sprache im Editor öffnen und neu lesen. */
    readonly geoeffnet: (spracheId: string, flaecheId: string) => void;
}

export function sprachflaecheZeichnen(optionen: SprachflaecheNeuOptionen): NeueFlaecheAndockung {
    const { sprache } = optionen;
    let neueFlaeche: string | undefined;
    return {
        id: "sprache",
        art: SPRACHE_ANLEGEN,
        ansicht: { view: "landscapes", layer: "sprachen" },
        titel: "spracheditor.neu.titel",
        darf: () => optionen.darf?.(),
        objekt: () => t("spracheditor.neu.objekt", { name: sprache.name }),
        // Keine Ziele: Eine Sprachfläche rastet nirgends ein (E4).
        ziele: () => Promise.resolve([]),
        async schreibe(ring, operationId): Promise<NeueFlaecheErgebnis> {
            const ergebnis = await optionen.sperre.unter(sprache.id, () =>
                optionen.daten.flaecheAnlegen(sprache.id, {
                    operationId,
                    baseRevision: sprache.revision,
                    polygons: [[ring.map((p) => [p.x, p.y] as [number, number])]],
                }),
            );
            if (!("ok" in ergebnis))
                return ergebnis.art === "gesperrt"
                    ? { ok: false, satz: t("entwurf.gesperrt", { wer: ergebnis.sperre.person.name }) }
                    : { ok: false, satz: t("entwurf.sperrfehler") };
            if (!ergebnis.ok)
                return ergebnis.status === 0 || ergebnis.status >= 500
                    ? { ok: false, status: ergebnis.status }
                    : { ok: false, satz: ergebnis.fehler.message };
            neueFlaeche = ergebnis.quittung.flaecheId;
            return { ok: true, publicId: sprache.id, name: sprache.name, mapRevision: ergebnis.quittung.mapRevision };
        },
        geoeffnet: (neu) => optionen.geoeffnet(neu.publicId, neueFlaeche ?? ""),
    };
}
