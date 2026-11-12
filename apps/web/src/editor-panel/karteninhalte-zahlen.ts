import { computed, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type {
    EditorLandscapeList,
    EditorPathList,
    EditorPlaceList,
    EditorPowerlineList,
    EditorTerritoryList,
    InhalteKorporaListe,
    InhalteQuellenListe,
    InhalteVorkommenListe,
    InhalteWerkListe,
    SpracheEditorListe,
} from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";
import { kreisVon, ladeOrte, ORTE_LEGENDE } from "../editor-liste/orte-liste";
import { GEBIETE_LEGENDE, ladeGebiete } from "../gebietseditor/gebiete-liste";
import { createInhalteClient, type InhalteClient } from "../inhalte/inhalte-client";
import { INHALTE_LEGENDE, KORPORA_LEGENDE } from "../inhalte/inhalte-listen";
import { KRAFTLINIEN_LEGENDE, ladeKraftlinien } from "../kraftlinieneditor/kraftlinien-liste";
import { LANDSCHAFTEN_LEGENDE, ladeLandschaften } from "../landschaftseditor/landschaften-liste";
import { ladeSprachen } from "../spracheditor/sprachen-daten";
import { SPRACHEN_LEGENDE, zaehlungAusSprachen } from "../spracheditor/sprachen-liste";
import { WEGE_LEGENDE, ladeWege } from "../wegeditor/wege-liste";
import type { WetterBestand } from "../wettereditor/wetter-editor-modell";
import { WETTER_LEGENDE, zaehlungAusWetter } from "../wettereditor/wetter-zaehlung";
import { zaehlungAus, zaehlungAusZahlen, type KarteninhaltId, type Zaehlung } from "./karteninhalte-kacheln";

/**
 * Die Zahlen der Kacheln „Karteninhalte“ (WI-0212, EDIT-0003 T37): je gebautem Inhalt, wie viele Einträge seine Liste hat und wie viele
 * in jedem Kreis stehen, mit den Namen der Kreise, die seine Liste unten nennt.
 *
 * - 🔴 **Kein eigener Lesepfad:** Gezählt wird aus den Listen der Editoren (`GET /api/editor/places`, `…/landscapes`, `…/powerlines`, `…/paths`, `…/territories`),
 *   mit denselben Kreisen wie dort (`kreisVon`, `row.circle`) und derselben Zählung (`kreisZaehlung`). Ein Zähl-Endpunkt hätte die vier
 *   Zustände der Orte, die der Browser aus Herkunft und Zuordnung ableitet, auf dem Server ein zweites Mal gebraucht.
 * - **Die Inhalte zum Nachschlagen** (Quellen, Literatur, Vorkommen, Korpora; Fenster „Inhalte bearbeiten“, WI-0254) zählen aus dem `zahlen`
 *   ihrer Listen (`zaehlungAusZahlen`): Der Server zählt dort über den ganzen Bestand, nicht über die geladene Seite, also genügt die
 *   erste Seite mit EINER Zeile (`limit: 1`); weitere Seiten werden nie nachgeladen. Diese Listen leben im Fenster, nicht in `app.vue`:
 *   Das Fenster reicht sie in `inhalteListen` weiter (`inhalte/inhalte-listen.ts`), und dort gilt, was es geladen hat, zuerst, wie bei den
 *   Editoren. Sonst hinge die Zahl nach dem Anlegen oder Stilllegen einer Quelle hinter der Zahl im Fenster her.
 * - **Was die Editoren und das Fenster schon geladen haben, gilt zuerst:** Ihre Listen bleiben nach jedem Speichern frisch, also auch die
 *   Zahlen. Nur was noch keiner geladen hat, holt diese Stelle selbst, und zwar erst, wenn der Reiter zu sehen ist (`gebraucht`), einmal je
 *   Seite und wenn der Browser Luft hat. Ein erneutes Öffnen lädt nichts nach; nach einem Fehler (auch bei fehlendem Recht) versucht es das
 *   nächste Öffnen noch einmal, und die Kachel steht bis dahin ohne Zahl.
 * - **Ein neuer Editor** trägt seine Liste in `Listen` und `ZAEHLBAR` ein; ohne Eintrag steht seine Kachel ohne Zahl.
 */

/** Die Listen der Editoren, die gezählt werden. */
interface Listen {
    orte: EditorPlaceList;
    landschaften: EditorLandscapeList;
    kraftlinien: EditorPowerlineList;
    wege: EditorPathList;
    herrschaftsgebiete: EditorTerritoryList;
    /** Die Sprachen (WI-0261 S5d2): Der Server zählt die vier Zustände selbst (`zahlen`), freie Wiki-Artikel eingeschlossen. */
    sprachen: SpracheEditorListe;
    /** Die Listen des Fensters „Inhalte bearbeiten“: gebraucht wird ihr `zahlen`, nicht ihre Zeilen. */
    quellen: InhalteQuellenListe;
    literatur: InhalteWerkListe;
    vorkommen: InhalteVorkommenListe;
    korpora: InhalteKorporaListe;
    /** Das Wetter (WI-0288 Stufe 3): Presets und Icons, aus demselben öffentlichen Leseweg wie die Karte. */
    wetter: WetterBestand;
}
type Quelle = keyof Listen;
const QUELLEN: readonly Quelle[] = [
    "orte",
    "landschaften",
    "kraftlinien",
    "wege",
    "herrschaftsgebiete",
    "sprachen",
    "quellen",
    "literatur",
    "vorkommen",
    "korpora",
    "wetter",
];

/** Je Liste: die Liste des Editors, sobald er sie geladen hat. */
export type KarteninhaltQuellen = { readonly [Q in Quelle]: Readonly<Ref<Listen[Q] | undefined>> };
/** Je Liste: wie sie geholt wird (ein Test gibt eigene Lader). */
export type KarteninhaltLader = { readonly [Q in Quelle]: (signal: AbortSignal) => Promise<Listen[Q]> };

/**
 * Welcher Inhalt aus welcher Liste zählt: die Zählung der Liste (aus den Kreisen ihrer Zeilen oder aus ihrem fertigen `zahlen`) und die
 * Namen der Legende dieser Liste.
 */
const ZAEHLBAR: {
    readonly [Q in Quelle]: {
        readonly inhalt: KarteninhaltId;
        readonly zaehlung: (liste: Listen[Q]) => Zaehlung;
        readonly legende: () => Partial<Record<Kreis, string>>;
    };
} = {
    orte: { inhalt: "orte", zaehlung: (liste) => zaehlungAus(liste.rows.map(kreisVon)), legende: ORTE_LEGENDE },
    landschaften: {
        inhalt: "regionen",
        // Die Wiki-Einträge ohne Fläche (WI-0284) stehen als ◐ in derselben Liste: Die Kachel zählt sie mit, sonst nennt sie „◐ 3“, wo die Liste 682 zeigt.
        zaehlung: (liste) =>
            zaehlungAus([
                ...liste.rows.map((row) => row.circle),
                ...(liste.wikiEintraege ?? []).map((): Kreis => "halb"),
            ]),
        legende: LANDSCHAFTEN_LEGENDE,
    },
    kraftlinien: {
        inhalt: "kraftlinien",
        // Gelöschtes zählt nicht (EDIT-0003 T54).
        zaehlung: (liste) => zaehlungAus(liste.rows.filter((row) => row.deleted !== true).map((row) => row.circle)),
        legende: KRAFTLINIEN_LEGENDE,
    },
    // Gelöschtes zählt nicht (EDIT-0003 T54).
    wege: {
        inhalt: "wege",
        zaehlung: (liste) => zaehlungAus(liste.rows.filter((row) => row.deleted !== true).map((row) => row.circle)),
        legende: WEGE_LEGENDE,
    },
    // Legacys Kreis über die Untergebiete (T26 (5)), mit Legacys Bedeutung in der Legende.
    herrschaftsgebiete: {
        inhalt: "territorien",
        // Gelöschtes zählt nicht (EDIT-0003 T54).
        zaehlung: (liste) => zaehlungAus(liste.rows.filter((row) => row.deleted !== true).map((row) => row.circle)),
        legende: GEBIETE_LEGENDE,
    },
    // Die Sprachen: aktive Sprachen und freie Artikel je Zustand, gezählt vom Server; stillgelegte zählen nicht.
    sprachen: { inhalt: "sprachen", zaehlung: (liste) => zaehlungAusSprachen(liste.zahlen), legende: SPRACHEN_LEGENDE },
    // Die Inhalte zum Nachschlagen: Der Server zählt über den ganzen Bestand, die Zählung kommt fertig mit der Liste (`zahlen`).
    quellen: { inhalt: "quellen", zaehlung: (liste) => zaehlungAusZahlen(liste.zahlen), legende: INHALTE_LEGENDE },
    literatur: { inhalt: "literatur", zaehlung: (liste) => zaehlungAusZahlen(liste.zahlen), legende: INHALTE_LEGENDE },
    vorkommen: { inhalt: "vorkommen", zaehlung: (liste) => zaehlungAusZahlen(liste.zahlen), legende: INHALTE_LEGENDE },
    korpora: { inhalt: "korpora", zaehlung: (liste) => zaehlungAusZahlen(liste.zahlen), legende: KORPORA_LEGENDE },
    // Das Wetter: alle Einträge der Liste, die Kreise nur der Icons (der Kreis der Presets zählt etwas anderes, Legende im Fenster).
    wetter: { inhalt: "wetter", zaehlung: zaehlungAusWetter, legende: WETTER_LEGENDE },
};

/** Wann geladen wird: wenn der Browser Luft hat (ein Test gibt eine eigene Planung). */
export type Planung = (arbeit: () => void) => () => void;

export interface InhaltZaehlung extends Zaehlung {
    /** Die Namen der Kreise, die die Liste dieses Inhalts kennt, in ihrer Sprache. */
    readonly legende: Partial<Record<Kreis, string>>;
}

export interface KarteninhaltZahlen {
    /** Je gezähltem Inhalt die Zählung; ein Inhalt fehlt, solange seine Liste nicht da ist. */
    readonly zaehlung: ComputedRef<Partial<Record<KarteninhaltId, InhaltZaehlung>>>;
    /** Der Reiter ist zu sehen: holt, was noch keiner geladen hat. */
    gebraucht(): void;
    destroy(): void;
}

/** Der Weg zu den Listen der Inhalte, erst beim ersten Bedarf (derselbe Client wie im Fenster „Inhalte bearbeiten“). */
let inhalteClient: InhalteClient | undefined;
const inhalte = (): InhalteClient => (inhalteClient ??= createInhalteClient());

const LADER: KarteninhaltLader = {
    orte: (signal) => ladeOrte(signal),
    landschaften: (signal) => ladeLandschaften(signal),
    kraftlinien: (signal) => ladeKraftlinien(signal),
    wege: (signal) => ladeWege(signal),
    herrschaftsgebiete: (signal) => ladeGebiete(signal),
    sprachen: (signal) => ladeSprachen(signal),
    // Eine Zeile genügt: Das `zahlen` der Liste zählt über den ganzen Bestand, unabhängig von Seite und Filter.
    quellen: (signal) => inhalte().liste({ limit: 1 }, signal),
    literatur: (signal) => inhalte().werke({ limit: 1 }, signal),
    vorkommen: (signal) => inhalte().vorkommen({ limit: 1 }, signal),
    korpora: (signal) => inhalte().korpora({ limit: 1 }, signal),
    // Der Leseweg des Wetter-Editors lädt mit seiner Steuerung nach (Besucherpaket); Editoren haben ihn schon.
    wetter: (signal) =>
        import("../wettereditor/wetter-editor-daten")
            .then(({ createWetterEditorApi }) => createWetterEditorApi().lade(signal))
            .then((antwort) => ({ presets: antwort.presets, symbole: antwort.symbole })),
};

/** Im Leerlauf des Browsers, spätestens nach zwei Sekunden; ohne `requestIdleCallback` gleich danach. */
const imLeerlauf: Planung = (arbeit) => {
    if (typeof globalThis.requestIdleCallback === "function") {
        const id = globalThis.requestIdleCallback(arbeit, { timeout: 2000 });
        return () => globalThis.cancelIdleCallback(id);
    }
    const id = setTimeout(arbeit, 0);
    return () => clearTimeout(id);
};

export function createKarteninhaltZahlen(
    quellen: KarteninhaltQuellen,
    lader: KarteninhaltLader = LADER,
    planung: Planung = imLeerlauf,
): KarteninhaltZahlen {
    const eigene: { readonly [Q in Quelle]: ShallowRef<Listen[Q] | undefined> } = {
        orte: shallowRef(undefined),
        landschaften: shallowRef(undefined),
        kraftlinien: shallowRef(undefined),
        wege: shallowRef(undefined),
        herrschaftsgebiete: shallowRef(undefined),
        sprachen: shallowRef(undefined),
        quellen: shallowRef(undefined),
        literatur: shallowRef(undefined),
        vorkommen: shallowRef(undefined),
        korpora: shallowRef(undefined),
        wetter: shallowRef(undefined),
    };
    const laufend = new Map<Quelle, AbortController>();
    /** Eine geplante Runde, die noch nicht lief; `abbrechen` nimmt sie zurück. */
    let geplant = false;
    let abbrechen: (() => void) | undefined;

    // Hat ein Editor seine Liste geladen, gilt sie; die eigene Abschrift wird nicht mehr gebraucht.
    const stops = QUELLEN.map((quelle) =>
        watch(quellen[quelle], (liste) => {
            if (liste !== undefined) eigene[quelle].value = undefined;
        }),
    );

    /** Die Zählung einer Liste: die des Editors, sonst die eigene Abschrift. */
    function zaehle<Q extends Quelle>(quelle: Q, aus: Partial<Record<KarteninhaltId, InhaltZaehlung>>): void {
        const liste = quellen[quelle].value ?? eigene[quelle].value;
        if (liste === undefined) return;
        const { inhalt, zaehlung, legende } = ZAEHLBAR[quelle];
        aus[inhalt] = { ...zaehlung(liste), legende: legende() };
    }

    const zaehlung = computed(() => {
        const aus: Partial<Record<KarteninhaltId, InhaltZaehlung>> = {};
        for (const quelle of QUELLEN) zaehle(quelle, aus);
        return aus;
    });

    /** Eine Liste holen, wenn sie weder ein Editor noch diese Stelle hat und keine Frage danach läuft. */
    function hole<Q extends Quelle>(quelle: Q): void {
        const vomEditor = quellen[quelle];
        const eigen = eigene[quelle];
        if (vomEditor.value !== undefined || eigen.value !== undefined || laufend.has(quelle)) return;
        const steuer = new AbortController();
        laufend.set(quelle, steuer);
        lader[quelle](steuer.signal).then(
            (liste) => {
                if (steuer.signal.aborted) return;
                laufend.delete(quelle);
                if (vomEditor.value === undefined) eigen.value = liste;
            },
            // Ohne Liste bleibt die Kachel ohne Zahl; das nächste Öffnen versucht es noch einmal.
            () => {
                if (laufend.get(quelle) === steuer) laufend.delete(quelle);
            },
        );
    }

    function gebraucht(): void {
        if (geplant) return;
        geplant = true;
        abbrechen = planung(() => {
            geplant = false;
            for (const quelle of QUELLEN) hole(quelle);
        });
    }

    function destroy(): void {
        for (const stop of stops) stop();
        if (geplant) abbrechen?.();
        geplant = false;
        for (const steuer of laufend.values()) steuer.abort();
        laufend.clear();
    }

    return { zaehlung, gebraucht, destroy };
}
