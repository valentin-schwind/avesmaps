import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    EDITOR_STATUS_URL,
    editorPlacePublicId,
    type EditorPlaceList,
    type EditorPlaceRow,
    type EditorStatus,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { createListenEinstellung, type ListenEinstellung } from "../editor-liste/listen-einstellung";
import { passtFilter } from "../editor-liste/liste-modell";
import {
    ladeOrte,
    ORTE_MASKEN,
    ORTE_OPTIONEN,
    zeileVon as listenZeileVon,
    type OrteMaske,
} from "../editor-liste/orte-liste";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import { t } from "../i18n/i18n";
import type { OpenSubjectOptions, SubjectSelection } from "../info-panel/subject-selection";
import { ansichtFuerHinflug, type HinflugAnsicht } from "../map/hinflug-ansicht";
import type { Ziellage } from "../editor-panel/hinflug";
import type { ListenSchalter } from "../fenster/listen-schalter";
import { entfernenFlug, entfernenMeldung } from "./ort-entfernen";

/**
 * Was die Seite für den Ortseditor hält (WI-0128 E6; EDIT-0001 §4.1, D14, D19; WI-0126 §11h): die Ortsliste (einmal geladen, von allen
 * Fenstern geteilt) samt Suche und Filter, die EINE Auswahl der Seite und die Wege, einen Ort zu öffnen. `app.vue` hängt nur noch ein.
 *
 * - 🔴 **Die Auswahl ist eine für die Seite und synchron mit der Karte** (D14): Ein Klick auf einen Ort der Karte wählt ihn in jeder
 *   Liste; eine Wahl in einer Liste markiert ihn auf der Karte (über die Öffnungsnaht der Auswahl, `still`: das Infopanel kommt dabei
 *   nicht nach vorn). Eine Stätte hat keinen Kartenpunkt; ihre Wahl bleibt in den Listen.
 * - 🔴 **Öffnen und ablegen** (D19): Ein Klick in der Liste öffnet den Ort an der Stelle dieses Fensters, das bisherige wird mit
 *   Entwurf abgelegt. Das Verb „⚙ Orte bearbeiten“ öffnet den gewählten Ort in einem neuen Fenster (oder holt seine Bearbeitung hervor).
 * - Die Liste lädt beim ersten offenen Ortseditor; Fehler stehen mit „Noch einmal versuchen“ in der Liste.
 *
 * **Hinflug** (E7, EDIT-0001 §4.5 mit D19): Ein Einfachklick wählt und öffnet, die Kamera steht (T7.1). Doppelklick und Enter fliegen
 * zusätzlich, das Fenster bleibt (Nr. 4). Das Verb fliegt zuerst und öffnet nach dem Ende DIESES Flugs, auch wenn eine Geste ihn
 * beendet; eine jüngere Wahl ersetzt die ältere, nur die letzte öffnet (Nr. 3, T7.4). Ziel ist die freie Fläche der Lage, in der der
 * Ortseditor nach der Landung steht (`hinflug.ts`). Ein Ort ohne Lage fliegt nicht; die Statuszeile sagt es (Nr. 7). Doppelklick, Enter
 * und Verb stellen die Karte dazu auf die Ansicht der Orte (EDIT-0003 T32 (1), `map/hinflug-ansicht.ts`): Standard.
 * 🔴 D19 ersetzt die Frage beim Wechsel (Nr. 5): Ein Entwurf wandert nach „Offene Bearbeitungen“, gefragt wird nur beim Schließen.
 *
 * **Karte** (Nr. 6): Ein Klick auf einen Ort wählt ihn in jeder Liste, die Listen rollen dorthin, das Fenster bleibt vorn. Dazu öffnet
 * er den Ort im vordersten Ortseditor wie ein Klick in dessen Liste (Betreiber 2026-10-11: „Ein klick auf einen Ort springt automatisch
 * zum item in der liste. wenn das tut soll natürlich auch der ort in "Eigenschaften und Overrides" kommen.“); das Bisherige wird mit
 * Entwurf abgelegt (D19), nach vorn kommt dabei nichts. Ein Klick auf etwas anderes holt das Infopanel nach vorn; ein angedockter
 * Ortseditor tritt dahinter zurück, die Lasche „Editor“ holt ihn wieder.
 */
export interface OrtseditorHinflug {
    /**
     * Fliegt zum Ort (`camera.showPoint` mit der freien Fläche nach der Landung); das Ergebnis wie dort. Ohne `optionen` nur, wenn der
     * Ort nicht frei sichtbar ist, auf den nahen Zoom der Ortsgröße; `immer` zentriert auch einen sichtbaren, `zoomBleibt` behält den
     * Zoom (nach dem Verschieben, Betreiber 2026-10-11). `ansicht` stellt die Karte vor dem Flug auf die Ansicht des Objekts
     * (EDIT-0003 T32 (1)); ohne bleibt sie, wie sie ist.
     */
    zeige(
        ort: Pick<EditorPlaceRow, "x" | "y" | "subtype">,
        ziel: Ziellage,
        optionen?: { immer?: boolean; zoomBleibt?: boolean; ansicht?: HinflugAnsicht },
    ): Promise<boolean>;
}

/** „✚ Neuer Ort“ in einem Fenster (E16 Teil b): mit Lage aus dem Kontextmenü, ohne aus dem Menüband. `nr` macht jede Bitte neu. */
export interface NeuAnfrage {
    readonly fenster: string;
    readonly position?: { readonly x: number; readonly y: number } | undefined;
    readonly nr: number;
}

/** Ein Hinweis in der Statuszeile eines Fensters (Ort ohne Lage). */
export interface FensterHinweis {
    readonly fenster: string;
    readonly text: string;
}

export interface OrtseditorSteuerung {
    readonly liste: Readonly<ShallowRef<EditorPlaceList | undefined>>;
    /** Suche, Filter, Sortierung und Maske der Ortsliste, für alle Fenster EINE (sonst stünde nach jedem geöffneten Ort alles neu). */
    readonly listenEinstellung: ListenEinstellung;
    readonly ladeFehler: Readonly<Ref<string | undefined>>;
    /** Der Stand des Bearbeitens (`MAP_EDITING`, E9), sobald der erste Ortseditor offen ist; ohne Antwort `undefined`. */
    readonly bearbeiten: Readonly<ShallowRef<EditorStatus | undefined>>;
    readonly auswahl: ComputedRef<string | undefined>;
    setzeAuswahl(key: string | undefined): void;
    /** Ein Klick in der Liste eines Fensters: wählen und öffnen, die Kamera steht. */
    oeffneOrt(fensterId: string, key: string): void;
    /** Doppelklick und Enter in der Liste eines Fensters: wie der Klick, dazu der Flug. */
    fliegeOrt(fensterId: string, key: string): void;
    /**
     * Das Verb „⚙ Orte bearbeiten“ aus dem Editorpanel: der gewählte Ort an der Stelle des vordersten Ortseditors (D19), sonst in einem
     * neuen Fenster; mit Lage erst nach dem Flug.
     */
    oeffneWerkzeug(): void;
    /**
     * Ein Ort aus Infopanel, Kontextmenü oder Menü am Objekt (E15): an der Stelle des vordersten Ortseditors (D19), sonst in einem neuen
     * Fenster; die Kamera steht, der Ort ist schon gewählt. Gibt das Fenster zurück.
     */
    oeffneFuer(key: string): string;
    /** „✚ Neuer Ort“: das Formular in diesem Fenster, sonst im vordersten oder in einem neuen. Gibt das Fenster zurück. */
    neuerOrt(fensterId?: string, position?: { x: number; y: number }): string;
    /** Das Formular schließen (angelegt oder abgebrochen). */
    neuFertig(fensterId: string): void;
    readonly neu: Readonly<ShallowRef<NeuAnfrage | undefined>>;
    /** Den Stand des Bearbeitens holen, auch ohne offenen Ortseditor (die Gruppe im Infopanel braucht ihn, E15). */
    ladeStand(): void;
    /** Ein Subject wurde geöffnet (`onOpened` der Auswahl): Ein anderes Objekt der Karte holt das Infopanel nach vorn (Nr. 6). */
    /**
     * Ein Objekt der Karte wurde geöffnet. Ein Ort öffnet sich im vordersten Ortseditor; gibt es keinen, öffnet ihn ein Klick im
     * Editor-Modus (`editorModus`, nicht während eines Modus) an diesem Ort, wenn die Lasche „Editor“ vorn ist (WI-0198, EDIT-0003
     * T34 (1); Betreiber 2026-10-16: „Bei Orten kommt er schon automatisch“). `true`, wenn er dafür aufging.
     */
    geoeffnet(ref: SubjectRef, options: OpenSubjectOptions, editorModus?: boolean): boolean;
    /** Was die Statuszeile eines Fensters gerade sagen muss. */
    readonly hinweis: Readonly<Ref<FensterHinweis | undefined>>;
    ladeListe(): void;
    /** Wohin ein abgelegtes Fenster fliegt: „Offene Bearbeitungen“, sonst die Lasche „Editor“. */
    ablageZiel(): DOMRect | undefined;
    destroy(): void;
}

/** Die Ansicht, in der ein Ort zu sehen ist (`map/hinflug-ansicht.ts`): Doppelklick, Enter und Verb stellen sie ein. */
const ORT_ANSICHT = ansichtFuerHinflug({ art: "ort" });

/**
 * `nurLesen`: Die Sitzung hat kein Schreibrecht (`verbModus`, Register); jedes Fenster öffnet dann „nur lesen“.
 */
export function createOrtseditorSteuerung(
    selection: SubjectSelection,
    fenster: Werkzeugfenster,
    nurLesen: boolean,
    hinflug?: OrtseditorHinflug,
    /** Der gemeinsame Schalter der Listen: Öffnet die Karte das Fenster erst, steht es mit eingeklappter Liste (EDIT-0003, Variante A). */
    listenSchalter?: Pick<ListenSchalter, "vorlaeufig">,
): OrtseditorSteuerung {
    const liste = shallowRef<EditorPlaceList | undefined>(undefined);
    const listenEinstellung = createListenEinstellung({
        vorbelegt: ORTE_OPTIONEN.vorbelegt,
        sortierung: "name",
        maske: "alle",
    });
    const ladeFehler = ref<string | undefined>(undefined);
    const bearbeiten = shallowRef<EditorStatus | undefined>(undefined);
    const listenWahl = ref<string | undefined>(undefined);
    const hinweis = ref<FensterHinweis | undefined>(undefined);
    const neu = shallowRef<NeuAnfrage | undefined>(undefined);
    let neuNr = 0;
    let steuerung: AbortController | undefined;
    const statusAbbruch = new AbortController();
    /** Die jüngste Wahl: Ein Flug, der danach endet, öffnet nur, wenn nach ihm nichts gewählt wurde (T7.4). */
    let runde = 0;

    /**
     * Nach einer Änderung (gespeichert, verschoben, gesetzt, verborgen, zurückgeholt, ein Bild gebunden): Das Infopanel liest den gezeigten
     * Ort neu, und mit ihm das Menü am Objekt (E19, „Infopanel und Liste zeigen das neue Wappen“; Betreiber 2026-10-11: „nach dem verbergen
     * fehlt "zurückholen"“, das Menü las den alten Stand), dann die Ortsliste. 🔴 Auch ohne geladene Liste: Verbergen geht aus dem
     * Infopanel, ohne dass je ein Ortseditor offen war.
     */
    function ladeListe(): void {
        if (selection.shown.value?.ref.kind === "place") selection.auffrischen();
        holeListe();
    }

    /** Die Ortsliste holen (`no-cache`, der ETag spart den Körper). */
    function holeListe(): void {
        steuerung?.abort();
        const eigene = new AbortController();
        steuerung = eigene;
        ladeFehler.value = undefined;
        ladeOrte(eigene.signal).then(
            (antwort) => {
                if (!eigene.signal.aborted) liste.value = antwort;
            },
            () => {
                if (!eigene.signal.aborted) ladeFehler.value = t("editorListe.fehler");
            },
        );
    }

    /** Der Stand des Bearbeitens; scheitert die Frage, bleibt er unbekannt, und der Ortseditor schweigt dazu. */
    function ladeBearbeiten(signal: AbortSignal): void {
        fetch(EDITOR_STATUS_URL, { signal, headers: { accept: "application/json" } })
            .then(async (antwort) => (antwort.ok ? ((await antwort.json()) as EditorStatus) : undefined))
            .then(
                (stand) => {
                    if (!signal.aborted) bearbeiten.value = stand;
                },
                () => undefined,
            );
    }

    // Die Liste und der Stand des Bearbeitens kommen, sobald der erste Ortseditor offen ist.
    const stopLaden = watch(
        () => fenster.stand.value.fenster.some((x) => x.werkzeug === "ortseditor"),
        (offen) => {
            if (!offen) return;
            if (liste.value === undefined && ladeFehler.value === undefined) holeListe();
            if (bearbeiten.value === undefined) ladeBearbeiten(statusAbbruch.signal);
        },
    );

    /** Ein Ort auf der Karte gewählt: Er ist die Auswahl jeder Liste. */
    const kartenWahl = computed(() => {
        const gewaehlt = selection.selected.value;
        return gewaehlt?.kind === "place" ? gewaehlt.id : undefined;
    });
    const stopKarte = watch(kartenWahl, (key) => {
        if (key !== undefined) listenWahl.value = key;
    });
    // Fenster, die vor der Liste aufgingen, bekommen ihren Titel, sobald die Liste da ist (für „Offene Bearbeitungen“).
    const stopTitel = watch(liste, () => {
        for (const offen of fenster.stand.value.fenster)
            if (offen.werkzeug === "ortseditor") fenster.markiere(offen.id, { titel: titelVon(offen.gegenstand) });
    });
    const auswahl = computed(() => listenWahl.value ?? kartenWahl.value);

    function setzeAuswahl(key: string | undefined): void {
        listenWahl.value = key;
        const zeile = key === undefined ? undefined : liste.value?.rows.find((row) => row.key === key);
        const publicId = zeile ? editorPlacePublicId(zeile) : undefined;
        if (publicId !== undefined && kartenWahl.value !== publicId) {
            selection.openSubject({ kind: "place", id: publicId }, { source: "link", camera: "none", still: true });
        }
    }

    const zeileVon = (key: string | undefined): EditorPlaceRow | undefined =>
        key === undefined ? undefined : liste.value?.rows.find((row) => row.key === key);
    const titelVon = (key: string | undefined): string => {
        const zeile = zeileVon(key);
        return zeile ? t("ortseditor.titelOrt", { name: zeile.name }) : t("nav.editorpanel.ortseditor");
    };
    /** Das vorderste sichtbare Ortseditor-Fenster: Dort öffnen Verb und Karte (D19). */
    const vordersterOrtseditor = (): WerkzeugFenster | undefined =>
        fenster.stand.value.fenster
            .filter((x) => x.werkzeug === "ortseditor" && x.lage !== "versenkt")
            .reduce<WerkzeugFenster | undefined>((best, x) => (best && best.vorn > x.vorn ? best : x), undefined);
    const ziellageVon = (offen: WerkzeugFenster): Ziellage => ({ lage: offen.lage, box: offen.box, id: offen.id });

    function oeffneAn(fensterId: string | undefined, key: string | undefined): string {
        hinweis.value = undefined;
        const wunsch = { werkzeug: "ortseditor", gegenstand: key, titel: titelVon(key), nurLesen };
        // Ohne Stelle ein neues Fenster in der gemerkten Lage (die `neueLage` dem Hinflug nennt).
        const id = fensterId === undefined ? fenster.oeffne(wunsch) : fenster.oeffneAnStelle(fensterId, wunsch);
        if (key !== undefined) setzeAuswahl(key);
        return id;
    }

    /** Ein Ort mit Lage; sonst steht der Hinweis in der Statuszeile des Fensters, sobald es offen ist. */
    const mitLage = (key: string | undefined): EditorPlaceRow | undefined => {
        const zeile = zeileVon(key);
        return zeile?.x !== undefined && zeile.y !== undefined ? zeile : undefined;
    };
    const ohneLage = (key: string, fensterId: string): void => {
        const zeile = zeileVon(key);
        if (zeile) hinweis.value = { fenster: fensterId, text: t("ortseditor.status.ohneLage", { name: zeile.name }) };
    };

    /**
     * „Bearbeiten“ aus einem Menü (Betreiber 2026-10-12: „orte kommen in der liste nicht automatisch, wenn man auf bearbeiten klickt. man
     * könnte "bearbeiten" und dann filtern“): Die Suche der Ortsliste trägt seinen Namen, eine Maske oder ein Filter, die ihn verbergen,
     * fallen; ✕ in der Suche bringt die ganze Liste zurück. Ist die Liste noch nicht da, folgt es einmal, sobald sie geladen ist.
     */
    let zeigenAusstehend: string | undefined;
    function zeigeInListe(key: string): void {
        const row = zeileVon(key);
        if (row === undefined) {
            zeigenAusstehend = key;
            return;
        }
        zeigenAusstehend = undefined;
        const zeile = listenZeileVon(row);
        listenEinstellung.suche.value = row.name;
        const maske = ORTE_MASKEN[listenEinstellung.maske.value as OrteMaske];
        if (maske !== undefined && !maske(zeile)) listenEinstellung.maske.value = "alle";
        const filter = listenEinstellung.filter.value;
        const bleibt = new Map(
            [...filter].filter(([facette, werte]) => passtFilter(zeile, new Map([[facette, werte]]))),
        );
        if (bleibt.size !== filter.size) listenEinstellung.filter.value = bleibt;
    }
    const stopZeigen = watch(liste, () => {
        const key = zeigenAusstehend;
        zeigenAusstehend = undefined;
        if (key !== undefined && zeileVon(key) !== undefined) zeigeInListe(key);
    });

    // „Ort entfernen“ (E22): Der Ort fliegt links neben das Blatt (mittig, Kanonbreite `entscheiden`), wenn er eine Lage hat. Danach
    // lädt die Liste (mit ihr das Infopanel) neu; ein gelöschter Ort schließt seine Fenster.
    const stopEntfernenFlug = watch(entfernenFlug, (ort) => {
        if (ort === undefined || hinflug === undefined) return;
        // Die Kanonbreite des Blatts, wie die Hülle sie zeichnet (`--avm-fenster-entscheiden`).
        const kanon = Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--avm-fenster-entscheiden"),
        );
        const breite = Math.min(Number.isFinite(kanon) && kanon > 0 ? kanon : 520, globalThis.innerWidth);
        void hinflug.zeige(ort, {
            lage: "geloest",
            box: {
                left: (globalThis.innerWidth - breite) / 2,
                top: globalThis.innerHeight * 0.15,
                width: breite,
                height: globalThis.innerHeight * 0.7,
            },
        });
    });
    const stopEntfernenMeldung = watch(entfernenMeldung, (meldung) => {
        if (meldung === undefined) return;
        if (meldung.art === "geloescht")
            for (const offen of fenster.stand.value.fenster)
                if (offen.werkzeug === "ortseditor" && offen.gegenstand === meldung.publicId)
                    fenster.schliesse(offen.id);
        ladeListe();
    });

    return {
        liste,
        listenEinstellung,
        neu,
        neuerOrt(fensterId, position) {
            const id =
                fensterId ??
                vordersterOrtseditor()?.id ??
                fenster.oeffne({ werkzeug: "ortseditor", gegenstand: undefined, titel: titelVon(undefined), nurLesen });
            neuNr += 1;
            neu.value = { fenster: id, position, nr: neuNr };
            return id;
        },
        neuFertig(fensterId) {
            if (neu.value?.fenster === fensterId) neu.value = undefined;
        },
        ladeFehler,
        bearbeiten,
        auswahl,
        hinweis,
        setzeAuswahl,
        oeffneOrt(fensterId, key) {
            runde += 1;
            oeffneAn(fensterId, key);
        },
        fliegeOrt(fensterId, key) {
            runde += 1;
            const id = oeffneAn(fensterId, key);
            const zeile = mitLage(key);
            const offen = fenster.stand.value.fenster.find((x) => x.id === id);
            if (!zeile) ohneLage(key, id);
            // Gemessen wird das Fenster, an dessen Stelle der Ort öffnet: Das neue steht genau dort, ist aber noch nicht gezeichnet.
            else if (offen && hinflug)
                void hinflug.zeige(zeile, { ...ziellageVon(offen), id: fensterId }, { ansicht: ORT_ANSICHT });
        },
        oeffneWerkzeug() {
            const meine = (runde += 1);
            const key = auswahl.value;
            const vorn = vordersterOrtseditor();
            const oeffnen = (): void => {
                if (meine !== runde) return;
                // Das vorderste Fenster kann während des Flugs abgelegt worden sein: dann ein neues.
                const stelle =
                    vorn && fenster.stand.value.fenster.some((x) => x.id === vorn.id && x.lage !== "versenkt");
                const id = oeffneAn(stelle ? vorn.id : undefined, key);
                if (key !== undefined && !mitLage(key)) ohneLage(key, id);
            };
            const zeile = mitLage(key);
            if (!zeile || !hinflug) {
                oeffnen();
                return;
            }
            const neu = fenster.neueLage("ortseditor");
            const ziel: Ziellage = vorn ? ziellageVon(vorn) : { lage: neu.lage ?? "angedockt", box: neu.box };
            // Nach dem Ende dieses Flugs, auch wenn eine Geste ihn beendet: Die Absicht war „öffnen“.
            void hinflug.zeige(zeile, ziel, { ansicht: ORT_ANSICHT }).then(oeffnen, oeffnen);
        },
        oeffneFuer(key) {
            runde += 1;
            const vorn = vordersterOrtseditor();
            const id = oeffneAn(vorn?.id, key);
            if (vorn === undefined) listenSchalter?.vorlaeufig(id, true, "ortseditor");
            zeigeInListe(key);
            return id;
        },
        ladeStand() {
            if (bearbeiten.value === undefined) ladeBearbeiten(statusAbbruch.signal);
        },
        geoeffnet(ref, options, editorModus = false) {
            if (options.source !== "map" || options.still === true) return false;
            if (ref.kind === "place") {
                const vorn = vordersterOrtseditor();
                if (vorn) {
                    oeffneAn(vorn.id, ref.id);
                    return false;
                }
                // 🔴 Nur, wenn die Lasche „Editor“ schon vorn ist (so startet der Rechner, dd9f7476): Wer „Info“ vorn hat, will das
                // Infopanel samt Gruppe „Bearbeiten · nur Editoren“ (E15) und das Menü am Ort - das angedockte Fenster deckte beides zu.
                if (!editorModus || selection.slot.value !== "editor") return false;
                // 🪤 Erst öffnen, dann stellen: In `listenSchalter?.vorlaeufig(oeffneAn(…))` fiele ohne Schalter auch das Öffnen weg.
                const id = oeffneAn(undefined, ref.id);
                listenSchalter?.vorlaeufig(id, true, "ortseditor");
                return true;
            }
            if (selection.slot.value !== "editor" || vordersterOrtseditor() === undefined) return false;
            selection.togglePanel();
            return false;
        },
        ladeListe,
        ablageZiel() {
            const ziele = ['[data-testid="editor-panel-bearbeitungen"]', '[data-testid="editor-panel-tab"]'];
            for (const ziel of ziele) {
                const element = document.querySelector<HTMLElement>(ziel);
                if (element && element.getClientRects().length > 0) return element.getBoundingClientRect();
            }
            return undefined;
        },
        destroy() {
            steuerung?.abort();
            statusAbbruch.abort();
            stopLaden();
            stopKarte();
            stopTitel();
            stopEntfernenFlug();
            stopZeigen();
            stopEntfernenMeldung();
        },
    };
}
