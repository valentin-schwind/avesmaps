import { computed } from "vue";
import { EDITOR_PLACE_TEXT_FIELDS, editorPlaceHistoryUrl, type MapHistoryEntry } from "@avesmaps3d/shared";
import { ruecknahmeFamilie } from "../aenderungen/aenderung-ruecknahme";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import { istQuellenEintrag } from "../fenster/quellen-verlauf-modell";
import {
    createVerlauf,
    type Ruecknahme,
    type Verlauf,
    type VerlaufBearbeitung,
    type VerlaufOptionen,
    type VerlaufsArt,
} from "../fenster/entwurf-verlauf";
import type { OrtBearbeitung } from "./ort-bearbeitung";

/**
 * Der Verlauf eines Orts als Anschluss an den gemeinsamen Verlauf (WI-0265 B6d; WI-0128 E17, EDIT-0001 §7.1 E17, WI-0126 §5.8; `fenster/entwurf-verlauf.ts`, Muster
 * `wegeditor/weg-verlauf.ts`): jede Operation an diesem Ort (`GET /api/editor/places/:id/history`), neueste zuerst, mit Serien, Zustand und dem gemeinsamen Detail
 * (`aenderungen/aenderung-detail.vue`). Eine eigene Darstellung des Orts gibt es nicht mehr.
 *
 * - **Ein Eintrag ist eine Operation**: wer, wann, Quelle, Zusammenfassung, und je Feld alt → neu. Die Herkunft eines Texts (`…Origin`) steht nicht als eigenes Feld da (`herkunft`,
 *   `herkunftsfelder`: Name und Ortsgröße führt der Katalog, Einwohner, Lage, Oberhaupt und Beschreibung stehen in `place_detail`), ebenso nicht `staetten`, die Liste der Beziehungen,
 *   die eine Operation bewegt hat (E10b, E22 G2): Was geschehen ist, sagt die Zusammenfassung des Eintrags; eine Zeile „Stätten: [280] → []“ sagt niemandem etwas.
 * - **Die Lage** steht als Koordinaten da (`ortseditor-texte.ts`, `verlaufWert`); auf der Karte zeigt sie „⊕ Auf der Karte zeigen“ im gemeinsamen Detail (WI-0265 B5b: Vorher und
 *   Nachher, verbunden). Das ⊕ an der Zeile der Lage mit dem Flug zur früheren Stelle (E17) ist darin aufgegangen.
 * - **↺ nimmt der Server zurück** (WI-0265 B5c): Felder, Lage samt Wegenden und Löschen gehen als neue Operation der Quelle `restore` über `POST /api/editor/places/:id/restore-series`,
 *   einzeln oder als ganze Arbeitsserie (Vorprüfung, Rückfrage, `aenderungen/aenderung-ruecknahme.vue`). Dieser Anschluss spielt nichts selbst zurück (`ruecknahme` sagt immer `nicht`);
 *   `ruecknahmeZiel` nennt dem Verlauf die Adresse, aber nur, wo der Ort Schreibrecht hat und gelesen ist. Ohne Schreibrecht ist der Verlauf lesend.
 * - **Die Bearbeitung** reicht der Ort als Sicht (`ortVerlaufBearbeitung`): Die Revision liest den Verlauf neu, wenn der Ort auf der Karte verschoben oder per Wiki gesynct wurde; ein
 *   ungespeicherter Entwurf sperrt ↺ (T44) wie bei allen Editoren; nach ↺ liest `nachVerschieben` den Ort neu und behält den Entwurf.
 */

const MERKMALE = ["hidden", "ruined", "seaport", "nodix", "underground", "withdrawn", "approximate"] as const;

/** Der Gegenstand dieses Orts in einer Operation. */
const ortIn = (eintrag: MapHistoryEntry, publicId: string) =>
    eintrag.objects.find((gegenstand) => gegenstand.kind === "place" && gegenstand.id === publicId);

/** Was der Verlauf vom gelesenen Ort weiß: seine Kennung, und die Revision, sobald die Bearbeitung ihn gelesen hat. */
export interface OrtVerlaufStand {
    readonly publicId: string;
    readonly revision: number | undefined;
}

type KeineRuecknahme = never;

/** Die Art; `darfZuruecknehmen`: Der Ort ist gelesen und hat Schreibrecht (sonst bietet der Verlauf kein ↺ an). */
export function createOrtVerlaufsArt(darfZuruecknehmen: () => boolean): VerlaufsArt<OrtVerlaufStand, KeineRuecknahme> {
    return {
        url: editorPlaceHistoryUrl,
        gehoert: (g, d) => g.kind === "place" && g.id === d.publicId,
        // Der Server nimmt zurück; der Anschluss spielt nichts mehr selbst.
        ruecknahme: (): Ruecknahme<KeineRuecknahme> => ({ art: "nicht" }),
        // Die Quellen eines Objekts (`<art>.sources_changed`) nimmt der Server in „Änderungen“ zurück (WI-0265 B6g3); in diesem Verlauf haben sie ihr eigenes ↺ je Quelle (`quellen-verlauf-eintrag.vue`), hier keine Adresse.
        ruecknahmeZiel: (eintrag, id) =>
            darfZuruecknehmen() &&
            !istQuellenEintrag(eintrag) &&
            ruecknahmeFamilie(eintrag) === "place" &&
            ortIn(eintrag, id) !== undefined
                ? { familie: "place", id }
                : undefined,
        // Unerreichbar: `ruecknahme` bietet nie etwas an, das hier geschrieben würde.
        schreibe: (): Promise<SchreibAntwort> =>
            Promise.resolve({
                ok: false,
                status: 0,
                fehler: { code: "not_revertable", message: "Der Server nimmt Orte zurück." },
            }),
        revision: (d) => d.revision,
        feldFolge: ["name", "subtype", "kind", "position", ...EDITOR_PLACE_TEXT_FIELDS, ...MERKMALE, "wiki", "active"],
        herkunft: "place",
        herkunftsfelder: EDITOR_PLACE_TEXT_FIELDS,
        ohneFelder: ["staetten"],
    };
}

const BEREIT = { art: "bereit" } as const;

/**
 * Die Sicht des Verlaufs auf die Bearbeitung des Orts. Sie gilt nur, solange die Bearbeitung zu DIESEM Ort gehört (ein anderer Ort in demselben Fenster lässt sie kurz verwaist);
 * ohne sie (Ort ohne Schreibrecht, noch nicht gelesen) liest der Verlauf trotzdem, nur ohne Revision und ohne ↺.
 */
export function ortVerlaufBearbeitung(
    publicId: string,
    bearbeitung: () => OrtBearbeitung | undefined,
): VerlaufBearbeitung<OrtVerlaufStand> {
    const eigene = (): OrtBearbeitung | undefined => {
        const b = bearbeitung();
        return b?.detail.value?.publicId === publicId ? b : undefined;
    };
    return {
        detail: computed(() => ({ publicId, revision: eigene()?.detail.value?.revision })),
        zustand: computed(() => eigene()?.zustand.value ?? BEREIT),
        // Eine Bearbeitung läuft: ein ungeschriebener Entwurf, ein Speichern oder ein Konflikt (T44).
        lage: computed(() => {
            const b = eigene();
            const art = b?.zustand.value.art;
            return { aktiv: b !== undefined && (b.ungespeichert.value || art === "speichert" || art === "konflikt") };
        }),
        // Der Ort liest sich neu und behält den Entwurf (E12, T12.8); ohne Bearbeitung gibt es nichts zu lesen.
        neuLesen: async () => {
            await eigene()?.nachVerschieben();
        },
    };
}

/** Der Verlauf dieses Orts im Fenster; `zurueckgenommen` meldet die Kachelrevision einer Rücknahme (Liste und Karte ziehen nach). */
export function createOrtVerlauf(
    publicId: string,
    bearbeitung: () => OrtBearbeitung | undefined,
    optionen: Pick<VerlaufOptionen<OrtVerlaufStand>, "zurueckgenommen" | "fetcher" | "neueKennung"> = {},
): Verlauf<KeineRuecknahme> {
    const sicht = ortVerlaufBearbeitung(publicId, bearbeitung);
    // Die Revision gibt es erst, wenn die Bearbeitung des Orts (mit Schreibrecht) ihn gelesen hat: erst dann bietet der Verlauf ↺ an.
    const gelesen = (): boolean => sicht.detail.value?.revision !== undefined;
    return createVerlauf(createOrtVerlaufsArt(gelesen), { id: publicId, bearbeitung: sicht, ...optionen });
}
