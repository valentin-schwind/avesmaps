<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, toRaw, useId, watch } from "vue";
import {
    EDITORPANEL,
    EDITOR_LANDSCAPE_LAYERS,
    GEBIRGS_PRESETS_VORGABE,
    GEFAHREN_ARTEN,
    gefahrWirkt,
    LANDSCHAFTSEDITOR,
    formtGelaende,
    isTerrainFrame,
    landscapeTypesOfLayer,
    type EditorLandscapeDetail,
    type EditorLandscapeLabel,
    type EditorLandscapeLayer,
    type EditorGebirge,
    type EditorGebirgeProfile,
    type EditorLandscapeList,
    type EditorLandmarkenKandidat,
    type EditorWikiEintrag,
    type LandscapeRetireBody,
    type OperationReceipt,
    type LandscapeSelection,
} from "@avesmaps3d/shared";
import { openAuthWindow } from "../auth/auth-windows";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmFeld from "../controls/avm-feld.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmMehrfachauswahl from "../controls/avm-mehrfachauswahl.vue";
import { gefahrName, gefahrenText } from "../gefahren/gefahr-texte";
import GefahrMarke from "../gefahren/gefahr-marke.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import WikiBox from "../fenster/wiki-box.vue";
import LandschaftEntfernen from "./landschaft-entfernen.vue";
import LandschaftKopieren from "./landschaft-kopieren.vue";
import LandschaftMehrfach from "./landschaft-mehrfach.vue";
import { createLandschaftSammelArt, sammelZeilen, type LandschaftSammelFelder } from "./landschaft-sammel";
import { createSammelEntwurf, type SammelEntwurf } from "../fenster/sammel";
import type { KopierZiel } from "./landschaft-kopieren";
import GebirgeReiter from "./gebirge-reiter.vue";
import { ladeGebirge, ladeGebirgsProfile } from "./gebirge-daten";
import {
    gebirgsVorschau,
    VORSCHAU_KANTE_FEIN,
    VORSCHAU_KANTE_GROB,
    type GebirgsVorschau,
    type VorschauAuftrag,
    type VorschauErgebnis,
} from "../gebirge-vorschau/vorschau";
import { alsDatenUrl, eingabeMitGipfeln, hoechsteStelle, vorschauEcken, vorschauPixel } from "./gebirge-vorschau-bild";
import {
    festeSkala,
    festerTalboden,
    nurPunkthoeheGeaendert,
    skalaSchluessel,
    talbodenArtSchluessel,
    talbodenSchluessel,
    type GemerkteSkala,
} from "./gebirge-vorschau-schluessel";
import { kartenRahmen, kartenvorschau, vorschauFlaeche, vorschauTalboden, zugVorschau } from "./gebirge-anzeige";
import type { GebirgeVorschauBild } from "./gebirge-vorschau-karte";
import GipfelEigenschaften from "./gipfel-eigenschaften.vue";
import LandmarkeKandidat from "./landmarke-kandidat.vue";
import WikiEintrag from "./wiki-eintrag.vue";
import { phoneViewport } from "../controls/phone-viewport";
import EditorListe from "../editor-liste/editor-liste.vue";
import type { ListenEinstellung } from "../editor-liste/listen-einstellung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import AvmFenster from "../fenster/avm-fenster.vue";
import EntwurfFuss from "../fenster/entwurf-fuss.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import type { Verlauf } from "../fenster/entwurf-verlauf";
import EntwurfVerlauf from "../fenster/entwurf-verlauf.vue";
import type { FensterBox } from "../fenster/fenster-lage";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import TraegerKarten from "../fenster/traeger-karten.vue";
import { useTraegerKarten } from "../fenster/traeger-karten";
import TraegerQuellen from "../fenster/traeger-quellen.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import Zoomspanne from "../fenster/zoomspanne.vue";
import ZoomspanneKopf from "../fenster/zoomspanne-kopf.vue";
import { formatNumber, isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import type { Beschriftungen } from "./beschriftung-anlegen";
import { listenBreite } from "../fenster/listen-schalter";
import { GRUND_FLAECHE, GRUND_GEBIRGE } from "../editor-menu/sonderrolle-grund";
import { gebirgeGelesen, istGebirge, type BeschriftungFelder, type LandschaftFelder } from "./landschaft-art";
import { mitKammhoeheSkaliert, rechnetMitRueckennetz, type GebirgsEntwurf } from "./gebirge-stand";
import type { GipfelBearbeitung, LandschaftBearbeitung } from "./landschaftseditor-steuerung";
import { umschalteAufKarte } from "../editor-liste/mehrfachauswahl";
import type { MehrfachZiel } from "../map/mehrfach-markierung";
import {
    LANDSCHAFTEN_LEGENDE,
    LANDSCHAFTEN_MASKEN,
    LANDSCHAFTEN_OPTIONEN,
    maskenName,
    artName,
    ebenenMaske,
    facettenName,
    sortierungsName,
    wertName,
    zeileVon,
    gipfelGegenstand,
    gipfelVon,
    gipfelZeileVon,
    kandidatVon,
    kandidatZeileVon,
    wikiEintragVon,
    wikiEintragZeileVon,
    LANDSCHAFTEN_SORTIERUNGEN,
    ebenenZaehlung,
    stapelText,
    stapelUmschalten,
} from "./landschaften-liste";

/**
 * Der Landschaftseditor (WI-0178 Pakete A3, B2; EDIT-0004 §2.2; Blatt „Landschaftseditor“, T27; EDIT-0003 T44): ein Werkzeugfenster wie
 * der Ortseditor (rechts angedockt, « » klappt die Liste ein), links die Liste der Landschaften (A2), rechts die Eigenschaften der
 * Landschaft DIESES Fensters mit den Reitern Eigenschaften, Form und Beschriftungen. Je Landschaft ein Fenster (T44, D19).
 *
 * - 🔴 **Die Ebene der Karte entscheidet** (T27 (1)): In der Ansicht „Landschaften“ zeigt die Liste nur die Ebene, die die Karte zeigt;
 *   eigene Reiter für Ebenen gibt es nicht. Außerhalb der Ansicht stehen alle da.
 * - **Schreiben** (B2, O3 `fenster/bearbeitung.ts`): Name, Ebene, Art und die Werte der Beschriftungen sind Felder des EINEN
 *   Entwurfs der Landschaft, zusammen mit der Form aus „Ecken bearbeiten“. Eine neue Ebene stellt die Karte auf diese Ebene (`ebene`,
 *   ohne Flug; Betreiber 2026-10-17: „und er dann ins Vegetationslayer geht“) und leert die Art; zur Wahl stehen die Arten der Ebene,
 *   bis eine gewählt ist, sperrt die Bearbeitung „Fertig“ mit Grund. Was der Wechsel neu rechnen lässt, sagt ein Hinweis mit Link aufs
 *   Höhenmodell (T18, T50 (a), Sätze von der Orchestrierung 2026-10-17 freigegeben); der Kontinent „Aventurien“ behält Name, Ebene und
 *   Art (`isTerrainFrame`). Die erste Änderung beginnt die Bearbeitung (Sperre, Leiste mit „Fertig“
 *   auf der Karte); ein Feld ist ein Schritt, sobald man es verlässt (T44). Der Fuß zeigt nur „n ungespeichert“ und den Zustand,
 *   Konflikt und „Sperre abgelaufen“ stehen als Kasten über den Reitern. Ohne Recht oder mit `MAP_EDITING` aus bleibt es lesend.
 * - Ein Klick in der Liste wählt und zeigt die Eigenschaften, die Kamera steht; Doppelklick und Enter fliegen zum Rahmen der
 *   Flächen (Ziel „Ausschnitt“, G3). Ohne Fläche fliegt nichts.
 * - **Telefon:** Liste und Eigenschaften als Drill-down mit „‹ Liste“, wie der Ortseditor.
 *
 * 🪤 Der Knopf « » und seine Fassung stehen bis O3 zweimal (hier und im Ortseditor); O3 zieht sie in einen Baustein unter `fenster/`.
 */
const props = defineProps<{
    fenster: WerkzeugFenster;
    /**
     * Meldet das Ziel des Umschalt-Klicks auf der Karte je Art (`map/mehrfach-markierung.ts`, `ziel`): Landschaften und Gipfel dieses
     * Fensters hakt er an oder ab. Gibt den Abbau zurück.
     */
    mehrfachZiel?: ((art: "landscape" | "peak", ziel: MehrfachZiel) => () => void) | undefined;
    liste: EditorLandscapeList | undefined;
    ladeFehler: string | undefined;
    einstellung: ListenEinstellung;
    /** Die Bearbeitung der Landschaft dieses Fensters (`landschaftseditor-steuerung.ts`); ohne Landschaft keine. */
    bearbeitung: LandschaftBearbeitung | undefined;
    /** Darf diese Sitzung Landschaften schreiben (Recht und `MAP_EDITING`)? */
    darf?: boolean | undefined;
    /** Hat diese Sitzung `edit_landscape_form`? Sonst steht der Reiter „Form“ grau mit der zuständigen Sonderrolle, Kopieren und Entfernen fehlen (WI-0279, E1, E2a). */
    darfForm?: boolean | undefined;
    /** Hat diese Sitzung `edit_mountains`? Sonst steht der Reiter „Gebirge“ grau, Ebene und Art eines Gebirges stehen still, Berggipfel und Vulkane lassen sich nur ansehen (E2, E2a). */
    darfGebirge?: boolean | undefined;
    /** Hat diese Sitzung das Recht `manage_sources`? Mit `darf` bearbeitet der Reiter „Quellen“ dann sofort (WI-0254 §12). */
    quellenRecht?: boolean | undefined;
    /** Der Verlauf dieser Fläche (D3), solange ein Fenster sie trägt. */
    verlauf?: Verlauf<unknown> | undefined;
    /** Die Beschriftung, die gerade auf der Karte verschoben werden kann (C4). */
    zieht?: string | undefined;
    /** „Fläche entfernen …“ (D2); fehlt ohne Schreibrecht. */
    entferne?:
        ((stage: LandscapeRetireBody["stage"]) => Promise<{ ok: true } | { ok: false; satz: string }>) | undefined;
    /** Das Kartenmenü bittet um das Blatt (`mal` zählt). */
    entfernenWunsch?: { id: string; mal: number } | undefined;
    /** „Kopieren …“ (Werkzeug 8) einer Teilfläche; fehlt ohne Schreibrecht. */
    kopiere?: ((areaId: string, ziel: KopierZiel) => Promise<{ ok: true } | { ok: false; satz: string }>) | undefined;
    /** Das Kartenmenü bittet um das Blatt „Fläche kopieren“ für diese Teilfläche (`mal` zählt). */
    kopierenWunsch?: { id: string; areaId: string; mal: number } | undefined;
    /** „Entfernen …“ für alle angehakten Landschaften (T57); fehlt ohne Schreibrecht. */
    entferneAlle?:
        | ((
              ids: readonly string[],
              stage: LandscapeRetireBody["stage"],
          ) => Promise<{ ok: true } | { ok: false; satz: string }>)
        | undefined;
    /** Trägt das Fenster einen Gipfel (P2, Gegenstand `gipfel:<Kennung>`), seine Bearbeitung; dann stehen seine Eigenschaften da. */
    gipfel?: GipfelBearbeitung | undefined;
    /** Läuft „Auf der Karte verschieben“ an diesem Gipfel? */
    gipfelZieht?: boolean | undefined;
    /** Läuft „Kämme zeichnen“ an dieser Landschaft (WI-0245)? Dann laden Gebirge und Vorschau auch ohne offenen Reiter. */
    kaemmeLaufen?: boolean | undefined;
    /** „Neue Fläche“ ist gespeichert (T47): der Name markiert, sobald das Feld steht; `mal` zählt. */
    nameWunsch?: { id: string; mal: number } | undefined;
    /** Die Ebene der Karte in der Ansicht „Landschaften“; `undefined` außerhalb der Ansicht. */
    ebene: LandscapeSelection | undefined;
    ablageZiel: () => DOMRect | undefined;
    /** Ein Handgriff der Karte verlangt einen Reiter (A4, „Beschriftung …“); `mal` zählt die Wünsche. */
    reiterWunsch?:
        | {
              reiter: "eigenschaften" | "form" | "beschriftungen" | "gebirge" | "quellen" | "karten" | "verlauf";
              mal: number;
          }
        | undefined;
    /** Ist die Liste eingezogen? Der Schalter liegt in `app.vue` (`listenSchalter`). */
    listeZu?: boolean | undefined;
    /** Dieselbe Gipfelhöhe nur in EINEM Entwurf (P5): wo sie gerade geändert wird, sonst nichts. */
    gipfelHoeheImGipfel?: ((id: string) => string | undefined) | undefined;
    gipfelHoeheImGebirge?: ((id: string) => string | undefined) | undefined;
    /** Beschriftungen anlegen, duplizieren, löschen und zurücksetzen (WI-0232); fehlt ohne Schreibrecht. */
    beschriftungen?: Beschriftungen | undefined;
}>();
const emit = defineEmits<{
    "update:auswahl": [id: string | undefined];
    /** Genau ein Haken in der Mehrfachauswahl: diese Landschaft ins Fenster, ohne die Ansicht der Karte zu wechseln (wie die Gebiete). */
    einzeln: [id: string];
    /** Doppelklick und Enter: zum Rahmen der Flächen fliegen. */
    fliege: [bounds: [number, number, number, number]];
    /** Doppelklick und Enter an einem Gipfel (P3): hin zu seinem Punkt. */
    zeige: [x: number, y: number];
    lage: [lage: "angedockt" | "geloest" | "versenkt", box?: FensterBox];
    /** Das Blatt „Fläche kopieren“ steht: Der Wunsch des Kartenmenüs ist erledigt. */
    kopierenGesehen: [];
    /** Die Mehrfachauswahl (T57): ihr Sammel-Entwurf für die Leiste der Seite, `undefined` ohne zwei angehakte. */
    sammel: [entwurf: SammelEntwurf<LandschaftSammelFelder> | undefined];
    /** Was in der Mehrfachauswahl angehakt ist, für die gelbe Markierung auf der Karte (`map/mehrfach-markierung.ts`); aus `[]`. */
    mehrfach: [angehakt: { landschaften: readonly string[]; gipfel: readonly string[] }];
    /** Der Sammel-Entwurf hat geschrieben: Kacheln, Fenster und Liste lesen neu. */
    sammelGeschrieben: [quittung: OperationReceipt];
    box: [box: FensterBox];
    vorn: [];
    schliesse: [];
    erneut: [];
    listeZu: [zu: boolean];
    /** Die Ebene im Entwurf hat gewechselt (auch über ↶ ↷ und Verwerfen): Die Karte zeigt sie. */
    ebene: [ebene: EditorLandscapeLayer];
    /** „Auf der Karte verschieben“ an einer Beschriftung (C4); `undefined`: „Verschieben beenden“. */
    verschiebe: [labelId: string | undefined];
    /** „Auf der Karte verschieben“ am Gipfel (P2): an oder aus. */
    verschiebeGipfel: [an: boolean];
    /** „● Auf der Karte setzen“ an einem Landmarken-Kandidaten (WI-0271 L7): das Setzen mit seiner Art und seinem Namen. */
    setzeKandidat: [kandidat: EditorLandmarkenKandidat];
    /** „● Fläche zeichnen“ an einem Wiki-Eintrag ohne Fläche (WI-0284): die Zeichnung für diesen Eintrag. */
    zeichneWikiEintrag: [eintrag: EditorWikiEintrag];
    /** Ein Klick auf eine Bandzahl über einer Zoomspanne: Die Karte zeigt dieses Band. */
    band: [band: number];
    /** „Zurückholen“ im Band einer verborgenen Landschaft (T41): schreibt sofort, wie im Kartenmenü. */
    zurueckholen: [];
    /** Die Gipfelliste des Gebirges (P5): einen Gipfel öffnen, ihn auf der Karte hervorheben (`undefined`: keinen mehr). */
    gipfel: [id: string];
    /** „Quelle öffnen“ in den Quellen der Landschaft: im Fenster „Inhalte bearbeiten“, Reiter Quellen, diese Quelle wählen (WI-0254 §12). */
    oeffneQuelle: [sourceId: string];
    gipfelZeigen: [lage: readonly [number, number] | undefined];
    /** Die Vorschau der Grundform (P6) für die Karte; `undefined`: keine (kein Entwurf am Gebirge, Fenster zu). */
    gebirgeVorschau: [bild: GebirgeVorschauBild | undefined];
    /** Das feine Bild im sichtbaren Ausschnitt großer Gebirge (WI-0245, „Ausschnitt fein“); `undefined` nimmt es weg. */
    gebirgeVorschauFein: [bild: GebirgeVorschauBild | undefined];
    /** Name als Link im Reiter „Gebirge“: Fluss oder Pass (Weg) bzw. See (Landschaft) öffnen. */
    objekt: [art: "weg" | "landschaft", id: string];
    /** „Kämme zeichnen“ an dieser Teilfläche des Gebirges (WI-0245 D2): Den Modus startet die Seite. */
    kaemmeZeichnen: [flaeche: string];
}>();

const kennung = computed(() => `landschaftseditor-${props.fenster.id}`);
/** Die Landschaft dieses Fensters (je Landschaft ein Fenster, T44). */
const auswahl = computed(() => props.fenster.gegenstand);
const detail = computed((): EditorLandscapeDetail | undefined => props.bearbeitung?.detail.value);
const detailFehler = computed(() => {
    const art = props.bearbeitung?.zustand.value.art;
    if (art === "fehlt") return t("entwurf.fehlt");
    if (art === "lesefehler") return t("entwurf.lesefehler");
    return undefined;
});
const stand = computed(() => props.bearbeitung?.stand.value);
/** Still (D2, T54): von der Karte genommen oder gelöscht; das Fenster liest dann nur, ↺ im Verlauf holt sie zurück. */
const still = computed(() => detail.value?.state);
const schreibt = computed(
    () =>
        props.darf === true &&
        props.bearbeitung !== undefined &&
        detail.value !== undefined &&
        still.value === undefined,
);
// --- Die Wiki-Box (WI-0253): der Artikel der Landschaft (die Region), Zuweisen · Sync · Entfernen. Sie wirkt auf dem Server, nicht im Entwurf; darum sperrt sie bei
// ungespeicherten Änderungen, und nach einer Änderung liest das Fenster die Landschaft neu. Die Landschaft trägt keinen Wiki-Wert im Fenster (der Name ist das einzige Feld, das ein
// Sync ändert); die Box nennt darum den Stand des Syncs, nicht „das Wiki ist neuer“. ---
const wikiBoxUngespeichert = computed(() => {
    const lage = props.bearbeitung?.lage.value;
    return lage !== undefined && (lage.ungespeichert > 0 || lage.form);
});
function wikiGeaendert(): void {
    void props.bearbeitung?.neuLesen();
    emit("erneut");
}
const entfernenOffen = ref(false);
const entfernenSendet = ref(false);
const entfernenSatz = ref<string | undefined>(undefined);
async function entfernen(stage: LandscapeRetireBody["stage"]): Promise<void> {
    if (props.entferne === undefined) return;
    entfernenSendet.value = true;
    entfernenSatz.value = undefined;
    const antwort = await props.entferne(stage);
    entfernenSendet.value = false;
    if (antwort.ok) entfernenOffen.value = false;
    else entfernenSatz.value = antwort.satz;
}
/**
 * Die Mehrfachauswahl (EDIT-0003 T57; Form wie Fassung 5 der Gebiete): Häkchen in der Liste (`editor-liste.vue`), ab zwei angehakten
 * Landschaften die Eigenschaften aller (`landschaft-mehrfach.vue`) und ein Sammel-Entwurf (`fenster/sammel.ts`), dessen Leiste die Seite
 * zeigt. Ein Wechsel der Auswahl beginnt einen neuen Entwurf (die Auswahl ist flüchtig).
 */
const mehrfach = ref(false);
const angehakt = ref<readonly string[]>([]);
// Gipfel und Vulkane gehen mit (Stage-Fund 2026-10-19: drei angehakte Vulkane ließen das Fenster leer; `sammelZeilen`).
const angehakteZeilen = computed(() => (mehrfach.value ? sammelZeilen(props.liste, angehakt.value) : []));
// Was angehakt ist, leuchtet auf der Karte gelb wie ein einzeln gewähltes (Betreiber 2026-10-20, gemeinsame Schnittstelle der Gebiete).
watch(
    () => (mehrfach.value ? angehakt.value : []),
    (ids) =>
        emit("mehrfach", {
            landschaften: ids.filter((id) => gipfelVon(id) === undefined),
            gipfel: ids.flatMap((id) => gipfelVon(id) ?? []),
        }),
    { immediate: true },
);
onBeforeUnmount(() => emit("mehrfach", { landschaften: [], gipfel: [] }));
/**
 * Umschalt-Klick auf der Karte (Betreiber 2026-10-20: „umschalten soll eigentlich ermöglichen die einzelnen objekte auf der karte
 * zusätzlich auszuwählen“): eine Landschaft oder einen Gipfel aufnehmen oder herausnehmen; aus schaltet er die Mehrfachauswahl ein, und
 * die gewählte zählt mit (`umschalteAufKarte`).
 */
function umschalteVonKarte(zeile: string): void {
    angehakt.value = umschalteAufKarte({ an: mehrfach.value, angehakt: angehakt.value }, auswahl.value, zeile);
    mehrfach.value = true;
}
const bereitFuerUmschalt = (): boolean => props.fenster.lage !== "versenkt";
/** Esc und ein Klick in die Karte heben die Mehrfachauswahl auf (zentral, `map/mehrfach-markierung.ts`, WI-0252). */
function hebeMehrfachAuf(): boolean {
    const war = mehrfach.value || angehakt.value.length > 0;
    angehakt.value = [];
    mehrfach.value = false;
    return war;
}
const umschaltAbbau = [
    props.mehrfachZiel?.("landscape", {
        bereit: bereitFuerUmschalt,
        umschalten: umschalteVonKarte,
        aufheben: hebeMehrfachAuf,
    }),
    props.mehrfachZiel?.("peak", {
        bereit: bereitFuerUmschalt,
        umschalten: (id) => umschalteVonKarte(gipfelGegenstand(id)),
        aufheben: hebeMehrfachAuf,
    }),
];
onBeforeUnmount(() => {
    for (const abbau of umschaltAbbau) abbau?.();
});
const sammelArt = createLandschaftSammelArt();
const sammel = shallowRef<SammelEntwurf<LandschaftSammelFelder> | undefined>(undefined);
watch(
    () => (angehakteZeilen.value.length >= 2 ? angehakteZeilen.value.map((zeile) => zeile.id).join(",") : ""),
    (ids) => {
        sammel.value =
            ids === ""
                ? undefined
                : createSammelEntwurf(sammelArt, ids.split(","), {
                      geschrieben: (quittung) => emit("sammelGeschrieben", quittung),
                  });
        emit("sammel", sammel.value);
    },
);
onBeforeUnmount(() => {
    if (sammel.value !== undefined) emit("sammel", undefined);
});
async function entferneAngehakte(
    stage: LandscapeRetireBody["stage"],
): Promise<{ ok: true } | { ok: false; satz: string }> {
    if (props.entferneAlle === undefined) return { ok: false, satz: t("landschaftseditor.detailLaedt") };
    // Gipfel gehen mit (`gipfel:<Kennung>`); die Steuerung trennt sie für den Schreibweg.
    const antwort = await props.entferneAlle(
        angehakteZeilen.value.map((zeile) => zeile.id),
        stage,
    );
    if (antwort.ok) angehakt.value = [];
    return antwort;
}
/** Das Blatt „Fläche kopieren“ (Werkzeug 8) an dieser Teilfläche; `undefined`: zu. */
const kopierenFlaeche = ref<string | undefined>(undefined);
const kopierenSendet = ref(false);
const kopierenSatz = ref<string | undefined>(undefined);
async function kopieren(ziel: KopierZiel): Promise<void> {
    const flaeche = kopierenFlaeche.value;
    if (props.kopiere === undefined || flaeche === undefined) return;
    kopierenSendet.value = true;
    kopierenSatz.value = undefined;
    const antwort = await props.kopiere(flaeche, ziel);
    kopierenSendet.value = false;
    if (antwort.ok) kopierenFlaeche.value = undefined;
    else kopierenSatz.value = antwort.satz;
}
// Auch beim Öffnen: Das Kartenmenü öffnet das Fenster erst, und die Landschaft wird danach gelesen. Gesehen meldet es zurück, damit der
// Wunsch beim nächsten Öffnen nicht wiederkommt.
watch(
    [() => props.kopierenWunsch?.mal, () => detail.value?.id],
    () => {
        const wunsch = props.kopierenWunsch;
        if (wunsch === undefined || wunsch.id !== detail.value?.id) return;
        kopierenSatz.value = undefined;
        kopierenFlaeche.value = wunsch.areaId;
        emit("kopierenGesehen");
    },
    { immediate: true },
);
watch(
    () => props.entfernenWunsch?.mal,
    () => {
        if (props.entfernenWunsch !== undefined && props.entfernenWunsch.id === detail.value?.id)
            entfernenOffen.value = true;
    },
);
/** Während gespeichert wird, ruhen die Felder: Eine Eingabe ginge sonst im Neulesen nach dem Schreiben verloren. */
const ruht = computed(() =>
    props.bearbeitung?.zustand.value.art === "speichert" ? t("entwurf.fertigSpeichert") : undefined,
);
const konflikt = computed(() => {
    const zustand = props.bearbeitung?.zustand.value;
    return zustand?.art === "konflikt" ? zustand : undefined;
});
/** Die Namen der Teile im Konfliktkasten. */
function teilName(teil: string): string {
    if (teil === "name") return t("landschaftseditor.feld.name");
    if (teil === "ebene") return t("landschaftseditor.feld.ebene");
    if (teil === "art") return t("landschaftseditor.feld.flaechenart");
    if (teil === "sperre") return t("landschaftseditor.feld.klick");
    if (teil === "verborgen") return t("landschaftseditor.feld.besucher");
    if (teil === "gefahr") return t("landschaftseditor.feld.gefahrenlage");
    if (teil === "kurve") return t("landschaftseditor.feld.kurve");
    if (teil === "platz") return t("landschaftseditor.feld.platz");
    if (teil === "beschriftungen") return t("landschaftseditor.teil.beschriftungen");
    if (teil === "gebirge") return t("landschaftseditor.teil.gebirge");
    if (teil === "gipfel") return t("landschaftseditor.teil.gipfel");
    return t("entwurf.form");
}
function setzeName(wert: string): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, name: wert }), "name");
}
/** Eine neue Ebene leert die Art; zurück auf der gelesenen gilt wieder deren Art. */
function setzeEbene(wert: string): void {
    const ebene = wert as EditorLandscapeLayer;
    const d = detail.value;
    props.bearbeitung?.feld((felder) =>
        felder.ebene === ebene ? felder : { ...felder, ebene, art: ebene === d?.layer ? d.type : undefined },
    );
}
/**
 * Die Gefahrenlage (WI-0308, Abschnitt „Merkmale“): eine Mehrfachauswahl, „ungefährlich“ oben als Vorgabe; jede Wahl ist ein Schritt im
 * Entwurf. Nur in Derographie, Vegetation und Topographie (`gefahrWirkt`); in jeder anderen Ebene ruht sie und die Auswahl steht still.
 */
const GEFAHR_OPTIONEN = computed(() => GEFAHREN_ARTEN.map((art) => ({ wert: art, text: gefahrName(art) })));
const gefahren = computed((): readonly string[] => stand.value?.felder.gefahren ?? detail.value?.hazards ?? []);
const gefahrGesperrt = computed(
    () =>
        ruht.value ??
        (stand.value !== undefined && !gefahrWirkt(stand.value.felder.ebene)
            ? t("landschaftseditor.gefahr.grund.ebene")
            : undefined),
);
function setzeGefahren(werte: readonly string[]): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, gefahren: [...werte] }));
}
/** Ohne Beschriftung keine Kurve (Läufe hängen an der ersten Beschriftung). */
const kurveGesperrt = computed(
    () => ruht.value ?? (detail.value?.labels.length === 0 ? t("landschaftseditor.grund.ohneBeschriftung") : undefined),
);
const LAEUFE = [1, 2, 3].map((n) => ({ wert: String(n), text: String(n) }));
function setzeFeld(aenderung: Partial<Pick<LandschaftFelder, "gesperrt" | "verborgen" | "kurve" | "laeufe">>): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, ...aenderung }));
}
/** Verschoben wird nur eine Beschriftung an einem Punkt (C4); entlang der Fläche stehen die Läufe. */
const verschiebenGrund = computed(
    () =>
        ruht.value ??
        (stand.value?.felder.kurve === true ? t("landschaftseditor.beschriftung.entlangGrund") : undefined),
);
// Beschriftungen anlegen, duplizieren, löschen und zurücksetzen (WI-0232). Neu, Duplizieren und Löschen schreiben sofort (wie „Gipfel
// setzen“), darum gesperrt, solange eine Bearbeitung läuft; „Position zurücksetzen“ ist ein Schritt im Entwurf wie das Verschieben (C4).
const beschriftungLaeuft = ref(false);
const beschriftungFehler = ref<string | undefined>();
const sofortGrund = computed(
    () =>
        ruht.value ??
        (beschriftungLaeuft.value ? t("entwurf.fertigSpeichert") : undefined) ??
        (props.bearbeitung?.lage.value.aktiv === true ? t("landschaftseditor.entfernen.erstFertig") : undefined) ??
        (detail.value?.curve?.enabled === true ? t("landschaftseditor.beschriftung.grund.entlang") : undefined),
);
/**
 * Entlang der Fläche beschriftet (WI-0232, Kleinfund der Hauptorchestrierung 2026-10-19: fünf fast gleiche Zeilen untereinander):
 * Sperrt das Entlang die Knöpfe der Beschriftungen, sagt es EIN Satz über ihnen, und die Knöpfe stehen ohne eigene Zeile
 * (`AvmKnopf` mit `grundBei`). Andere Gründe (liest nur, schreibt gerade) stehen weiter am Knopf.
 */
const entlangHinweisId = useId();
const grundBei = (grund: string | undefined): string | undefined =>
    grund === t("landschaftseditor.beschriftung.entlangGrund") ||
    grund === t("landschaftseditor.beschriftung.grund.entlang")
        ? entlangHinweisId
        : undefined;
const entlangHinweis = computed(
    () => grundBei(verschiebenGrund.value) !== undefined || grundBei(sofortGrund.value) !== undefined,
);
/** Die Rückfrage vor dem Löschen; `letzte`: Die Landschaft geht mit, über „Fläche entfernen …“ (Betreiber 2026-07-28 in Legacy). */
const loeschWahl = ref<{ id: string; letzte: boolean } | undefined>();
/** Die Rückfrage vor dem Zurücksetzen, wenn die Landschaft mehrere Beschriftungen trägt (Legacy, Owner 25.08.2026). */
const zuruecksetzWahl = ref<string | undefined>();
async function beschriftungSofort(
    arbeit: (beschriftungen: Beschriftungen, id: string) => Promise<unknown>,
): Promise<void> {
    const id = auswahl.value;
    if (props.beschriftungen === undefined || id === undefined || beschriftungLaeuft.value) return;
    beschriftungLaeuft.value = true;
    beschriftungFehler.value = undefined;
    try {
        await arbeit(props.beschriftungen, id);
    } finally {
        beschriftungLaeuft.value = false;
    }
}
const neueBeschriftung = (): Promise<void> => beschriftungSofort((b, id) => b.neu(id));
const dupliziereBeschriftung = (labelId: string): Promise<void> =>
    beschriftungSofort((b, id) => b.dupliziere(id, labelId));
function bitteLoeschen(labelId: string): void {
    zuruecksetzWahl.value = undefined;
    loeschWahl.value = { id: labelId, letzte: (detail.value?.labels.length ?? 0) <= 1 };
}
async function loescheBeschriftung(labelId: string): Promise<void> {
    const wahl = loeschWahl.value;
    if (wahl?.letzte === true) {
        // Die letzte Beschriftung: derselbe Weg wie „Fläche entfernen …“ (D2, ↺ über „Gelöscht“), kein zweiter.
        await beschriftungSofort(async () => {
            const ergebnis = await props.entferne?.("retire");
            if (ergebnis !== undefined && !ergebnis.ok) beschriftungFehler.value = ergebnis.satz;
        });
        loeschWahl.value = undefined;
        return;
    }
    await beschriftungSofort(async (b, id) => {
        const ausgang = await b.loesche(id, labelId);
        loeschWahl.value = ausgang === "letzte" ? { id: labelId, letzte: true } : undefined;
    });
}
const loeschFrage = (i: number): string =>
    loeschWahl.value?.letzte === true
        ? tPlural("landschaftseditor.beschriftung.letzteFrage", detail.value?.areas.length ?? 1, {
              name: stand.value?.felder.name ?? detail.value?.name ?? "",
              n: formatNumber(detail.value?.areas.length ?? 1, 0),
          })
        : t("landschaftseditor.beschriftung.loeschenFrage", { n: i + 1 });
/** Die Lage einer Beschriftung im Entwurf (verschoben oder zurückgesetzt), sonst die gespeicherte. */
function lageIm(labelId: string): [number, number] | undefined {
    const gespeichert = detail.value?.labels.find((label) => label.id === labelId);
    const felder = stand.value?.felder.labels[labelId];
    const x = felder?.x ?? gespeichert?.x;
    const y = felder?.y ?? gespeichert?.y;
    return x === undefined || y === undefined ? undefined : [x, y];
}
function bitteZuruecksetzen(labelId: string): void {
    loeschWahl.value = undefined;
    if ((detail.value?.labels.length ?? 0) > 1) zuruecksetzWahl.value = labelId;
    else setzeZurueck(labelId);
}
function setzeZurueck(labelId: string): void {
    zuruecksetzWahl.value = undefined;
    const lage = lageIm(labelId);
    if (props.beschriftungen === undefined || detail.value === undefined || lage === undefined) return;
    const andere = detail.value.labels
        .filter((label) => label.id !== labelId)
        .map((label) => lageIm(label.id))
        .filter((punkt): punkt is [number, number] => punkt !== undefined);
    const ziel = props.beschriftungen.zuruecksetzen(detail.value, { x: lage[0], y: lage[1] }, andere);
    if (ziel !== undefined) setzeBeschriftung(labelId, { x: ziel[0], y: ziel[1] });
}
/** Der Platz in der Ebene, `n` von `m` (D1); 1 liegt ganz vorn. */
const platzText = computed(() => {
    const d = detail.value;
    if (d === undefined) return "";
    return d.place === undefined
        ? ebeneName(d.layer)
        : t("landschaftseditor.platz", {
              n: formatNumber(d.place.n, 0),
              von: formatNumber(d.place.of, 0),
              ebene: ebeneName(d.layer),
          });
});
/**
 * „In den Vordergrund“ und „In den Hintergrund“ (D1): ganz nach vorn oder ganz nach hinten, mit „Fertig“; ein zweiter Druck nimmt den
 * Wunsch zurück. Wer schon dort liegt und die Ebene behält, hat nichts zu bewegen.
 */
function platzGrund(wohin: "vorn" | "hinten"): string | undefined {
    if (ruht.value !== undefined) return ruht.value;
    const d = detail.value;
    if (d?.place === undefined || stand.value?.felder.ebene !== d.layer || stand.value.felder.platz === wohin)
        return undefined;
    if (wohin === "vorn" && d.place.n === 1) return t("landschaftseditor.reihe.schonVorn");
    if (wohin === "hinten" && d.place.n === d.place.of) return t("landschaftseditor.reihe.schonHinten");
    return undefined;
}
function setzePlatz(wohin: "vorn" | "hinten"): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, platz: felder.platz === wohin ? undefined : wohin }));
}
function setzeArt(wert: string): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, art: wert === "" ? undefined : wert }));
}
const ebenen = computed(() => EDITOR_LANDSCAPE_LAYERS.map((ebene) => ({ wert: ebene, text: ebeneName(ebene) })));
/** Die Arten der Ebene im Entwurf; ohne Art zuerst „Art wählen …“, eine Art außerhalb der Tafel bleibt wählbar. */
const arten = computed(() => {
    const felder = stand.value?.felder;
    if (felder === undefined) return [];
    // Zum Gebirge wechselt nur, wer es darf (WI-0279, E2a).
    const liste = landscapeTypesOfLayer(felder.ebene).filter((art) => props.darfGebirge === true || art !== "gebirge");
    if (felder.art !== undefined && !liste.includes(felder.art)) liste.push(felder.art);
    const optionen = liste
        .map((art) => ({ wert: art, text: artName(art) }))
        .sort((a, b) => a.text.localeCompare(b.text));
    return felder.art === undefined
        ? [{ wert: "", text: t("landschaftseditor.art.waehlen"), gesperrt: true }, ...optionen]
        : optionen;
});
/** Der Kontinent „Aventurien“ rahmt das Gelände: Name, Ebene und Art bleiben (`isTerrainFrame`). */
const rahmen = computed(() =>
    detail.value !== undefined && isTerrainFrame(detail.value) ? t("landschaftseditor.grund.aventurien") : undefined,
);
/** Topographie und Vegetation speisen das Gelände (`config/terrain/aventuria/`); Derographie nur über den Kontinent. */
const SPEISEN_GELAENDE: readonly EditorLandscapeLayer[] = ["topographie", "vegetation"];
const WASSER: readonly (string | undefined)[] = ["meer", "see"];
/**
 * Was ein Wechsel von Ebene oder Art neu rechnen lässt (EDIT-0003 T50 (a), T18): Meer und See die Seewege und das Gelände, jede Art
 * der Topographie und Vegetation das Gelände; neu zu Gebirge ohne eigene Werte (T50 (c)). Das Wegenetz lädt selbst nach.
 */
const hinweise = computed((): MessageKey[] => {
    const d = detail.value;
    const felder = stand.value?.felder;
    if (d === undefined || felder === undefined || (felder.ebene === d.layer && felder.art === d.type)) return [];
    const raus: MessageKey[] = [];
    if (WASSER.includes(d.type) || WASSER.includes(felder.art)) raus.push("landschaftseditor.hinweis.wasser");
    else if (
        SPEISEN_GELAENDE.includes(d.layer) ||
        SPEISEN_GELAENDE.includes(felder.ebene) ||
        d.type === "kontinent" ||
        felder.art === "kontinent"
    )
        raus.push("landschaftseditor.hinweis.gelaende");
    if (felder.art === "gebirge" && d.type !== "gebirge") raus.push("landschaftseditor.hinweis.gebirge");
    return raus;
});
/** Die Seiten der Systemsteuerung, auf die ein Hinweis verlinkt (Festlegung der Koordination 2026-10-17); dort kommen die Knöpfe hin. */
const ZIELE = {
    hoehenmodell: "admin.tab.hoehenmodell",
    wegfindung: "admin.tab.wegfindung",
} as const satisfies Record<string, MessageKey>;
type Ziel = keyof typeof ZIELE;
const MARKE = "\u0000";
/** Ein Satz in Stücken: Text, dazwischen die Links (`{hoehenmodell}`, `{wegfindung}` im Satz). */
function stuecke(key: MessageKey): { text: string; ziel?: Ziel }[] {
    const marken = Object.fromEntries(Object.keys(ZIELE).map((ziel) => [ziel, `${MARKE}${ziel}${MARKE}`]));
    return t(key, marken)
        .split(MARKE)
        .map((teil, i) => (i % 2 === 1 ? { text: t(ZIELE[teil as Ziel]), ziel: teil as Ziel } : { text: teil }));
}
function oeffneZiel(ziel: Ziel): void {
    openAuthWindow({ name: "systemsteuerung", eintrag: ziel });
}
watch(
    () => [props.bearbeitung, stand.value?.felder.ebene] as const,
    ([bearbeitung, ebene], [vorherBearbeitung, vorher]) => {
        if (bearbeitung === vorherBearbeitung && ebene !== undefined && vorher !== undefined && ebene !== vorher)
            emit("ebene", ebene);
    },
);
function setzeBeschriftung(id: string, aenderung: Partial<BeschriftungFelder>, verschmelze?: string): void {
    props.bearbeitung?.feld(
        (felder) => ({ ...felder, labels: { ...felder.labels, [id]: { ...felder.labels[id]!, ...aenderung } } }),
        verschmelze,
    );
}
const PRIORITAET = Array.from({ length: 5 }, (_, i) => ({ wert: String(i + 1), text: String(i + 1) }));
/** Ein Wert der Auswahl als Zahl; leer bleibt ungesetzt. */
const zahl = (wert: string): number | undefined => (wert === "" ? undefined : Number(wert));
/** Die Größe aus dem Zahlenfeld (4 bis 60, wie `map_label.label_size`); ein anderer Wert ändert nichts. */
function setzeGroesse(id: string, ereignis: Event): void {
    const wert = Number((ereignis.target as HTMLInputElement).value);
    if (Number.isFinite(wert) && wert >= 4 && wert <= 60) setzeBeschriftung(id, { size: wert });
}
const offen = computed({
    get: () => true,
    set: (auf: boolean) => {
        if (!auf) emit("schliesse");
    },
});
/** Am Telefon gibt es kein gelöstes Fenster. */
const lage = computed(() =>
    phoneViewport.value && props.fenster.lage === "geloest" ? "angedockt" : props.fenster.lage,
);

// --- Die Liste (A2): Facetten aus dem Register, die Ebene der Karte als Maske ---
const facetten = (EDITORPANEL.eintraege.find((x) => x.id === "regionen") as { facetten: readonly string[] }).facetten;
const optionen = { ...LANDSCHAFTEN_OPTIONEN, facetten };
/** Der Titel der Spalte an einer Landmarke: „Eigenschaften des Gipfels“ bei Berg und Vulkan, sonst „der Landmarke“ (WI-0271 L4). */
const gipfelTitel = computed(() => {
    const art = props.gipfel?.stand.value?.felder.art ?? props.gipfel?.detail.value?.subtype;
    return art === undefined || formtGelaende(art)
        ? t("landschaftseditor.gipfel.eigenschaften")
        : t("landschaftseditor.landmarke.eigenschaften");
});
/** „Objekte: Alle · Flächen · Landmarken“ (WI-0271 L4): die eine Wahl im Trichter. */
const objektMasken = (Object.keys(LANDSCHAFTEN_MASKEN) as (keyof typeof LANDSCHAFTEN_MASKEN)[]).map((wert) => ({
    wert,
    text: maskenName(wert),
    passt: LANDSCHAFTEN_MASKEN[wert],
}));
const sortierungen = LANDSCHAFTEN_SORTIERUNGEN.map((wert) => ({ wert, text: sortierungsName(wert) }));
const legende = LANDSCHAFTEN_LEGENDE();
/** ☰ in der Leiste der Liste sagt dasselbe wie ☰ in der Ebenenleiste: die gesperrten Flächen der Ebene der Karte. */
const stapelSatz = computed(() => stapelText(ebenenZaehlung(props.liste?.rows ?? [], props.ebene ?? "alle").gesperrt));
/**
 * Wechselt die Ebene im Entwurf, steht die Landschaft schon in der Liste der neuen Ebene, gewählt und mit Unterzeile (Festlegung der
 * Orchestrierung 2026-10-17); nach „Fertig“ steht sie dort regulär, nach „Verwerfen“ wieder in der alten Ebene.
 */
const zeilen = computed(() => {
    const d = detail.value;
    const ebene = stand.value?.felder.ebene;
    const umgezogen = d !== undefined && ebene !== undefined && ebene !== d.layer ? d.id : undefined;
    const flaechen = (props.liste?.rows ?? []).map((row) => {
        const zeile = zeileVon(row);
        if (row.id !== umgezogen) return zeile;
        return {
            ...zeile,
            facetten: { ...zeile.facetten, ebene },
            unter: { text: t("landschaftseditor.unter.ebeneGeaendert"), ton: "warnung" as const },
        };
    });
    return [
        ...flaechen,
        ...(props.liste?.peaks ?? []).map(gipfelZeileVon),
        // Die Landmarken-Kandidaten des WikiSync (WI-0271 L7): ◐ „nur Wiki (nicht platziert)“.
        ...(props.liste?.kandidaten ?? []).map(kandidatZeileVon),
        // Die Wiki-Einträge ohne Fläche (WI-0284): dieselbe ◐-Zeile.
        ...(props.liste?.wikiEintraege ?? []).map(wikiEintragZeileVon),
    ];
});
const maske = computed(() => ebenenMaske(props.ebene));
/**
 * Die Wahl der Liste. In der Mehrfachauswahl (T57) hakt ein Klick nur an: Die zuletzt angeklickte Zeile bleibt hier (Anker für
 * Umschalt-Klick), statt das Fenster an eine andere Landschaft zu geben (D19 ließe sonst ein anderes Fenster an seine Stelle treten, und
 * die Auswahl stünde im verdeckten). Beim Ausschalten meldet die Liste die verbleibende Zeile wie gewohnt.
 */
const mehrfachGewaehlt = ref<string | undefined>(undefined);
watch(mehrfach, (an) => {
    if (!an) mehrfachGewaehlt.value = undefined;
});
/**
 * Hakt man auf eine herunter ab, steht sie im Fenster wie nach einem Klick, mit Eigenschaften und Titel (Regel 7, für alle Editoren
 * gleich; Stage-Fund 2026-10-20: zwei angehakt, eins abgehakt, und das Fenster bat wieder ums Anhaken). Die Liste meldet es als `klick`
 * (`editor-liste.vue`). Nicht `update:auswahl`: Die stellte die Karte auf die Ebene der Landschaft, und die Liste verlöre unter „Alle“
 * ihre Gipfel.
 */
function einzelnAngehakt(id: string): void {
    if (mehrfach.value && id !== auswahl.value) emit("einzeln", id);
}
const gewaehlt = computed({
    get: () => (mehrfach.value ? (mehrfachGewaehlt.value ?? auswahl.value) : auswahl.value),
    set: (id: string | undefined) => {
        if (mehrfach.value) {
            mehrfachGewaehlt.value = id;
            return;
        }
        emit("update:auswahl", id);
        if (id !== undefined && phoneViewport.value) telefonSeite.value = "eigenschaften";
    },
});
const zeile = computed(() => props.liste?.rows.find((row) => row.id === auswahl.value));
/** Ein Landmarken-Kandidat in der Wahl (WI-0271 L7): Er hat kein Detail, sein Fenster zeigt den Artikel und „● Auf der Karte setzen“. */
const kandidat = computed(() => {
    const id = kandidatVon(auswahl.value);
    return id === undefined ? undefined : props.liste?.kandidaten?.find((row) => row.id === id);
});
/** Ein Wiki-Eintrag ohne Fläche in der Wahl (WI-0284): Er hat kein Detail, sein Fenster zeigt den Artikel und „● Fläche zeichnen“. */
const wikiEintrag = computed(() => {
    const id = wikiEintragVon(auswahl.value);
    return id === undefined ? undefined : props.liste?.wikiEintraege?.find((row) => row.id === id);
});
function fliege(id: string): void {
    const gipfel = gipfelVon(id);
    if (gipfel !== undefined) {
        const position = props.liste?.peaks?.find((row) => row.id === gipfel)?.position;
        if (position !== undefined) emit("zeige", position[0], position[1]);
        return;
    }
    const bounds = props.liste?.rows.find((row) => row.id === id)?.bounds;
    if (bounds !== undefined) emit("fliege", bounds);
}

// --- « » (wie der Ortseditor, P1): Die Liste zieht sich auf die stehende Trennlinie zu ---
// Der Schalter liegt in `app.vue` (`listenSchalter`), wie beim Ortseditor: Nur so rücken die Laschen „Info“/„Editor“ mit (`slotBreite`).
const zu = computed(() => props.listeZu === true && !phoneViewport.value);
const einzug = computed(() => (phoneViewport.value ? undefined : zu.value ? listenBreite() : 0));
const schalterText = computed(() => t(zu.value ? "ortseditor.liste.ausklappen" : "ortseditor.liste.einklappen"));
const telefonSeite = ref<"liste" | "eigenschaften">("liste");

// --- Die Eigenschaften ---
// Die Reiter aus dem Register (`LANDSCHAFTSEDITOR`), wie der Ortseditor aus `ORTSEDITOR`.
type Reiter = (typeof LANDSCHAFTSEDITOR)["eintraege"][number]["id"];
const reiter = ref<Reiter>("eigenschaften");
/** Die Karten der Kartensammlung, die diese Fläche abbilden: Der Reiter steht nur, wenn es welche gibt. */
const karten = useTraegerKarten(
    () => (detail.value === undefined ? undefined : { kind: "area", id: detail.value.id }),
    () => {
        if (reiter.value === "karten") reiter.value = "eigenschaften";
    },
);
/** Die Zahl der aktiven Quellen, sobald der Reiter sie gelesen hat (`fenster/traeger-quellen.vue`); eine andere Landschaft beginnt ohne. */
const quellenZahl = ref<number | undefined>(undefined);
watch(auswahl, () => (quellenZahl.value = undefined));
const REITER_NAMEN = {
    eigenschaften: () => t("landschaftseditor.reiter.eigenschaften"),
    form: () => t("landschaftseditor.reiter.form"),
    beschriftungen: () =>
        t("landschaftseditor.reiter.beschriftungen", { n: formatNumber(detail.value?.labels.length ?? 0, 0) }),
    gebirge: () => t("landschaftseditor.reiter.gebirge"),
    quellen: () =>
        quellenZahl.value === undefined
            ? t("fenster.traegerQuellen.reiterOhne")
            : t("fenster.traegerQuellen.reiter", { n: formatNumber(quellenZahl.value, 0) }),
    karten: () => t("fenster.traegerKarten.reiter", { n: formatNumber(karten.value.length, 0) }),
    verlauf: () => t("landschaftseditor.reiter.verlauf"),
} as const satisfies Record<Reiter, () => string>;
/** Die Namen der Felder im Verlauf (D3), wie das Protokoll sie führt. */
const VERLAUF_FELDER: Readonly<Record<string, MessageKey>> = {
    name: "landschaftseditor.feld.name",
    layer: "landschaftseditor.feld.ebene",
    type: "landschaftseditor.feld.flaechenart",
    locked: "landschaftseditor.feld.klick",
    hidden: "landschaftseditor.feld.besucher",
    hazards: "landschaftseditor.feld.gefahrenlage",
    curve: "landschaftseditor.feld.kurve",
    order: "landschaftseditor.feld.platz",
    size: "landschaftseditor.feld.groesse",
    priority: "landschaftseditor.feld.prioritaet",
    zoom: "landschaftseditor.feld.zoom",
    showName: "landschaftseditor.feld.anzeigen",
    text: "landschaftseditor.feld.text",
    geometry: "entwurf.form",
    position: "landschaftseditor.feld.lage",
    active: "verlauf.aktiv",
    offMap: "editorListe.stand.nichtAufDerKarte",
    gebirge: "landschaftseditor.teil.gebirge",
};
const verlaufFeldName = (feld: string): string => {
    const key = VERLAUF_FELDER[feld];
    return key === undefined ? feld : t(key);
};
/** Ein Wert im Verlauf: Ebene und Art mit Namen, die Kurve und die Spanne als Satz, die Form als Zahl der Ecken. */
function verlaufWert(feld: string, wert: unknown): string | undefined {
    if (feld === "layer" && typeof wert === "string") return ebeneName(wert);
    if (feld === "type" && (typeof wert === "string" || wert === null)) return artName(wert ?? undefined);
    if (feld === "hazards" && Array.isArray(wert)) return gefahrenText(wert as string[]);
    if (feld === "curve" && typeof wert === "object" && wert !== null) {
        const kurve = wert as { enabled: boolean | null; max: number | null };
        return kurve.enabled === true
            ? t("landschaftseditor.beschriftung.entlang", { n: formatNumber(kurve.max ?? 1, 0) })
            : t("editorListe.nein");
    }
    if (feld === "zoom" && Array.isArray(wert)) {
        const [von, bis] = wert as [number | null, number | null];
        return von === null || bis === null
            ? t("landschaftseditor.beschriftung.vorgabe")
            : t("landschaftseditor.beschriftung.zoomEigen", { von, bis });
    }
    if (feld === "position" && Array.isArray(wert) && wert.length === 2) {
        const [x, y] = wert as [number, number];
        return `${formatNumber(x, 1)} · ${formatNumber(y, 1)}`;
    }
    if (feld === "gebirge" && typeof wert === "object" && wert !== null)
        return gebirgeText(wert as Record<string, unknown>);
    if (feld === "geometry" && Array.isArray(wert)) {
        const ecken = JSON.stringify(wert).match(/\[-?\d+(\.\d+)?,-?\d+(\.\d+)?\]/g)?.length ?? 0;
        return t("landschaftseditor.verlauf.ecken", { n: formatNumber(ecken, 0) });
    }
    return undefined;
}
/** Das Gebirge im Verlauf (P4, `area.gebirge`): je Spalte ihr Name und Wert; leer heißt „Vorgabe“. */
function gebirgeText(spalten: Record<string, unknown>): string {
    return Object.entries(spalten)
        .map(([spalte, wert]) => {
            // Das gezeichnete Netz (WI-0245) steht als Ganzes im Protokoll; der Verlauf nennt seine Größe.
            if (spalte === "netz" && typeof wert === "object" && wert !== null) {
                const netz = wert as { kaemme?: { rang?: string }[]; nebengipfel?: unknown[]; mulden?: unknown[] };
                return (
                    t("landschaftseditor.verlauf.netz", {
                        kaemme: formatNumber(netz.kaemme?.filter((k) => k.rang !== "tal").length ?? 0, 0),
                        gipfel: formatNumber(netz.nebengipfel?.length ?? 0, 0),
                    }) +
                    (netz.kaemme?.some((k) => k.rang === "tal")
                        ? ` · ${t("landschaftseditor.kaemme.rang.tal")} ${formatNumber(netz.kaemme.filter((k) => k.rang === "tal").length, 0)}`
                        : "") +
                    ((netz.mulden?.length ?? 0) > 0
                        ? ` · ${t("landschaftseditor.kaemme.werkzeug.mulde")} ${formatNumber(netz.mulden!.length, 0)}`
                        : "")
                );
            }
            const name =
                spalte === "gebirgstyp"
                    ? t("landschaftseditor.gebirge.typ.titel")
                    : spalte === "muster"
                      ? t("landschaftseditor.gebirge.muster.titel")
                      : spalte === "maximalhoehe"
                        ? t("landschaftseditor.gebirge.hoehe.kamm")
                        : isMessageKey(`landschaftseditor.gebirge.wert.${spalte}`)
                          ? t(`landschaftseditor.gebirge.wert.${spalte}` as MessageKey)
                          : spalte;
            if (wert === null) return `${name} ${t("landschaftseditor.gebirge.wert.vorgabe")}`;
            if (typeof wert === "number") return `${name} ${formatNumber(wert, wert % 1 === 0 ? 0 : 2)}`;
            const key =
                spalte === "gebirgstyp"
                    ? `landschaftseditor.gebirge.typ.${String(wert)}`
                    : `landschaftseditor.gebirge.muster.${String(wert)}`;
            return `${name} ${isMessageKey(key) ? t(key) : String(wert)}`;
        })
        .join(" · ");
}
/** Der Reiter „Gebirge“ steht nur an einem Gebirge (im Entwurf: sobald Ebene und Art es sagen). */
const zeigtGebirge = computed(() => {
    const felder =
        stand.value?.felder ?? (detail.value ? { ebene: detail.value.layer, art: detail.value.type } : undefined);
    return felder !== undefined && istGebirge(felder);
});
/** Der Grund eines grauen Reiters: die zuständige Sonderrolle. */
function reiterGrund(id: Reiter): MessageKey | undefined {
    if (id === "form" && props.darfForm !== true) return GRUND_FLAECHE;
    if (id === "gebirge" && props.darfGebirge !== true) return GRUND_GEBIRGE;
    return undefined;
}
const reiterListe = computed(() =>
    LANDSCHAFTSEDITOR.eintraege
        .filter((eintrag) => eintrag.id !== "gebirge" || zeigtGebirge.value)
        .filter((eintrag) => eintrag.id !== "karten" || karten.value.length > 0)
        .map((eintrag) => {
            const grund = reiterGrund(eintrag.id);
            return {
                id: eintrag.id,
                name: REITER_NAMEN[eintrag.id](),
                ...(grund === undefined ? {} : { spaeter: t(grund) }),
            };
        }),
);
// Auch ein Wunsch von außen (Kartenmenü, Sprung aus „Änderungen“) öffnet keinen grauen Reiter.
watch(
    [reiter, () => props.darfForm, () => props.darfGebirge],
    ([jetzt]) => {
        if (reiterGrund(jetzt) !== undefined) reiter.value = "eigenschaften";
    },
    { immediate: true, flush: "sync" },
);
/** Ebene und Art eines Gebirges gehören dem Topographen (E2a): Ein Wechsel weg vom Gebirge wäre einer. */
const gebirgeStill = computed(() => {
    const d = detail.value;
    return props.darfGebirge !== true && d !== undefined && istGebirge({ ebene: d.layer, art: d.type })
        ? t(GRUND_GEBIRGE)
        : undefined;
});
/** Berggipfel und Vulkan gehören dem Topographen (E2a): Ohne sein Recht lässt sich so ein Punkt nur ansehen; alle anderen Landmarken bleiben offen (E12). */
const darfGipfel = computed(() => {
    const art = props.gipfel?.detail.value?.subtype;
    return props.darf === true && (props.darfGebirge === true || (art !== undefined && !formtGelaende(art)));
});
/** Die Mehrfachauswahl nach denselben Regeln: Berggipfel und Vulkane darin verlangen das Gebirge, beim Entfernen Flächen die Form. */
const sammelGipfelFrei = computed(
    () =>
        props.darfGebirge === true ||
        angehakteZeilen.value.every((zeile) => zeile.gipfel !== true || !formtGelaende(zeile.type ?? "berggipfel")),
);
const sammelEntfernenFrei = computed(
    () =>
        props.darf === true &&
        sammelGipfelFrei.value &&
        (props.darfForm === true || angehakteZeilen.value.every((zeile) => zeile.gipfel === true)),
);
watch(zeigtGebirge, (zeigt) => {
    if (!zeigt && reiter.value === "gebirge") reiter.value = "eigenschaften";
});
// --- Der Reiter „Gebirge“ (P4): die erste Teilfläche (jedes der 232 Gebirge hat genau eine), Presets und Grundhöhe vom Server ---
const gebirgeFlaeche = computed(() => detail.value?.areas[0]?.id);
const gebirgeDaten = ref<EditorGebirge | undefined>(undefined);
/** Die Höhenprofile der Flüsse und Pässe (WI-0245); sie kommen nach den Daten und fehlen ohne Höhenmodell der Wegfindung. */
const gebirgeProfile = shallowRef<EditorGebirgeProfile | undefined>(undefined);
let gebirgeAbbruch: AbortController | undefined;
watch(
    () =>
        [
            gebirgeFlaeche.value,
            reiter.value === "gebirge" || props.kaemmeLaufen === true,
            detail.value?.revision,
        ] as const,
    ([flaeche, offen]) => {
        if (!offen || flaeche === undefined) return;
        gebirgeAbbruch?.abort();
        const abbruch = new AbortController();
        gebirgeAbbruch = abbruch;
        ladeGebirge(flaeche, abbruch.signal).then(
            (daten) => {
                if (abbruch.signal.aborted) return;
                gebirgeDaten.value = daten;
                if (reiter.value !== "gebirge" || daten === undefined) return;
                ladeGebirgsProfile(flaeche, abbruch.signal).then(
                    (profile) => {
                        if (!abbruch.signal.aborted) gebirgeProfile.value = profile;
                    },
                    () => {
                        if (!abbruch.signal.aborted) gebirgeProfile.value = undefined;
                    },
                );
            },
            () => {
                if (!abbruch.signal.aborted) gebirgeDaten.value = undefined;
            },
        );
    },
    { immediate: true },
);
const gebirgeStand = computed((): GebirgsEntwurf | undefined => {
    const d = detail.value;
    const flaeche = gebirgeFlaeche.value;
    if (d === undefined || flaeche === undefined) return undefined;
    return stand.value?.felder.gebirge?.[flaeche] ?? gebirgeGelesen(d, flaeche);
});
/** Überfahren in der Gipfelliste (P5): der Ring auf der Karte an der Lage des Gipfels. */
/** ⌖ an einem Gipfel im Reiter: die Kamera fliegt hin (wie Doppelklick auf einen Gipfel in der Liste). */
function fliegeZuGipfel(id: string): void {
    const lage = detail.value?.peaks?.find((p) => p.id === id)?.position;
    if (lage !== undefined) emit("zeige", lage[0], lage[1]);
}
function zeigeGipfelAufKarte(id: string | undefined): void {
    emit("gipfelZeigen", id === undefined ? undefined : detail.value?.peaks?.find((p) => p.id === id)?.position);
}
// --- Die Vorschau der Grundform (P6, Fassung 16): grob bei jedem Schritt, feiner kurz danach, im offenen Reiter oder solange das Gebirge im Entwurf geändert ist ---
let vorschau: GebirgsVorschau | undefined;
let vorschauGeneration = 0;
const vorschauAufloesung = ref<1 | 2 | 4>(1);
let feinZeit: ReturnType<typeof setTimeout> | undefined;
const vorschauText = ref<string | undefined>(undefined);
/**
 * Der Talboden-Speicher des Rückennetzes (WI-0245 D4, wie der Entwurf V17): je Typ, Gratwerten und Netz der abgeleitete Talboden der
 * letzten feinen Rechnung. Grob rechnet die Vorschau mit ihm (ohne ihn: Talboden des Typs, schnell), fein leitet sie ihn ab und merkt ihn.
 */
const talbodenSpeicher = new Map<string, number>();
/** Der Talboden der letzten feinen Rechnung je Teilfläche, Typ und Gratwerten, ohne das Netz: Die grobe Vorschau nimmt ihn nach einer Änderung des Netzes statt des Typ-Talbodens. */
const talbodenZuletzt = new Map<string, number>();
/**
 * Die letzte feine Rechnung (WI-0249 P9): Ende der Höhenskala (Tönung, Überhöhung), Talboden und Dauer. Ändert sich nur die Höhe eines
 * Punkts, bleibt die Skala stehen (sonst wanderte sie mit dem höchsten Punkt, und das übrige Gebirge würde dunkler und flacher, obwohl keine
 * seiner Höhen sich ändert), der Talboden gilt weiter (keine Ableitung), und die Vorschau rechnet gleich fein statt erst grob.
 */
let skalaGemerkt: GemerkteSkala | undefined;
/** Das Bild der letzten Rechnung für die große Vorschau im Reiter (V1, Bauvorlage V16/V17). */
/** Ohne Gipfelhöhen im Entwurf immer DASSELBE leere Objekt: Ein neues je Darstellung setzte ein angefangenes Höhenfeld zurück. */
const KEINE_GIPFELHOEHEN: Readonly<Record<string, number>> = Object.freeze({});
const vorschauBild = shallowRef<(GebirgeVorschauBild & { ecken: [number, number][]; hoechste: number }) | undefined>(
    undefined,
);
/** Rechnet die Vorschau? Im offenen Reiter und bei „Kämme zeichnen“ immer (V1), sonst nur mit einer Änderung (V2 auf der Karte). */
const vorschauRechnet = computed(
    () =>
        zeigtGebirge.value &&
        gebirgeDaten.value !== undefined &&
        (gebirgeImEntwurf.value || reiter.value === "gebirge" || props.kaemmeLaufen === true),
);
/** Der abgeleitete Talboden des Gebirges im Entwurf; die Zeile „Talboden“ zeigt ihn, solange kein eigener gesetzt ist. */
const talbodenAbgeleitet = ref<number | undefined>(undefined);
/** Steht das Bild der Vorschau auf der Karte (V2)? */
const aufKarte = computed(() => kartenvorschau.value && vorschauRechnet.value);
/** Ist am Gebirge im Entwurf etwas geändert (Werte oder Gipfelhöhen)? */
const gebirgeImEntwurf = computed(() => {
    const d = detail.value;
    const s = stand.value;
    if (d === undefined || s === undefined || props.bearbeitung === undefined || !zeigtGebirge.value) return false;
    const teile = props.bearbeitung.art.geaendert(d, s);
    return teile.includes("gebirge") || teile.includes("gipfel");
});
/** Die Eingabe der Vorschau: die der Fläche mit den Gipfelhöhen des Entwurfs und der gewürfelten Saat (Migration 0214), falls gesetzt. */
function eingabeDerVorschau(roh: EditorGebirge, s: GebirgsEntwurf): EditorGebirge["eingabe"] {
    return {
        ...eingabeMitGipfeln(roh.eingabe, toRaw(detail.value?.peaks ?? []), {
            ...stand.value?.felder.gipfelHoehen,
        }),
        ...(s.saat === undefined || s.saat === null ? {} : { saat: s.saat }),
    };
}
/** Jede Rechnung bekommt eine Nummer; ein Bild steht nur, wenn es jünger ist als das stehende (Züge überholen sich nicht). */
let vorschauNummer = 0;
let angezeigtNummer = 0;
/**
 * Steht für diese Teilfläche schon ein feines Bild (auch das eines Zugs)? Dann kommt kein grobes mehr darüber (WI-0249; Vali 2026-10-26: Beim
 * Ändern sprangen alle Gipfel auf den Stand des groben Bilds und wieder zurück): Das feine bleibt stehen, bis das neue feine fertig ist.
 */
let feinStehtFuer: string | undefined;
/** Läuft ein Zug schon (nur dessen erster Auftrag drängt eine laufende Rechnung beiseite)? */
let zugLaeuft = false;
/**
 * Die Vorschau rechnen. `zug`: das Netz eines laufenden Zugs im Kammeditor (`zugVorschau`, WI-0249 Leistung): fein und voll wie das Bild
 * danach (mit Erosion, sonst sprängen beim Ziehen alle Gipfel auf einen anderen Stand), mit dem Talboden der letzten Rechnung, ohne Ausschnitt
 * und ohne sich etwas zu merken; gedrosselt durch die Rechnung selbst.
 * `vorrang`: eine laufende Rechnung (bis 14 s bei großen Gebirgen) wird abgebrochen statt abgewartet.
 */
async function rechneVorschau(kante: number, zug?: GebirgsEntwurf["netz"], vorrang = false): Promise<void> {
    const generation = vorschauGeneration;
    const nummer = ++vorschauNummer;
    const daten = gebirgeDaten.value;
    const stand0 = gebirgeStand.value;
    if (daten === undefined || stand0 === undefined) return;
    const s: GebirgsEntwurf = zug === undefined ? stand0 : { ...stand0, netz: zug };
    vorschau ??= gebirgsVorschau();
    // 🪤 Nur rohe Daten an den Worker: Vues reaktive Hüllen lassen sich nicht übertragen (`postMessage` wirft `DataCloneError`).
    const roh = toRaw(daten);
    const preset = s.typ === null ? null : roh.presets.gruppe.typen[s.typ];
    const fein = kante !== VORSCHAU_KANTE_GROB;
    const schluessel = talbodenSchluessel(s);
    const art = talbodenArtSchluessel(gebirgeFlaeche.value ?? "", s);
    const eingabe = eingabeDerVorschau(roh, s);
    const skala = skalaSchluessel(s, eingabe, roh.grundhoehe);
    // Grob: der Talboden dieses Netzes, sonst der letzte derselben Art, sonst der des Typs. Fein: abgeleitet, außer es änderten sich nur
    // Punkthöhen seit der letzten feinen Rechnung (dann derselbe).
    const gemerkt = talbodenSpeicher.get(schluessel) ?? talbodenZuletzt.get(art);
    // Beim Zug: der Talboden der letzten feinen Rechnung (die Lage eines Punkts ändert ihn kaum; abgeleitet wird erst beim Loslassen).
    const festFein =
        zug !== undefined
            ? (skalaGemerkt?.talboden ?? gemerkt)
            : fein
              ? festerTalboden(skalaGemerkt, skala)
              : undefined;
    const rueckennetz =
        // Mit gezeichneten Kämmen immer das Rückennetz, wie das Gelände (der Umschalter „V12 heute“ ist weg, Betreiber 2026-10-21); mit
        // Köpfen des Typs auch nur mit Nebengipfeln (WI-0249 P2).
        rechnetMitRueckennetz(s, roh.presets.gruppe)
            ? {
                  kaemme: toRaw(s.netz!.kaemme).map((k) => ({
                      punkte: k.punkte.map(([x, y]) => [x, y] as [number, number]),
                      rang: k.rang,
                      // Höhe je Stützpunkt (WI-0249 P9): rechnet die Vorschau wie das Gelände.
                      ...(k.hoehen === undefined ? {} : { hoehen: [...k.hoehen] }),
                  })),
                  nebengipfel: toRaw(s.netz!.nebengipfel).map((n) => ({ ...n })),
                  mulden: toRaw(s.netz!.mulden ?? []).map((n) => ({ ...n })),
                  // Eigene Höhen an Flüssen und Seen (WI-0249), roh an den Worker.
                  ...(s.netz!.flussHoehen?.length
                      ? { flussHoehen: toRaw(s.netz!.flussHoehen).map((w) => ({ ...w })) }
                      : {}),
                  ...(s.netz!.seeHoehen?.length ? { seeHoehen: toRaw(s.netz!.seeHoehen).map((w) => ({ ...w })) } : {}),
                  typ: s.typ,
                  gruppe: roh.presets.gruppe,
                  modell: { ...s.modell },
                  // Ein eigener Talboden gilt immer; grob der gemerkte, fein wird er abgeleitet (und danach gemerkt).
                  talbodenFest: s.modell?.talboden ?? (fein ? festFein : gemerkt),
                  // Ein Zug leitet nie ab (langsam); ohne bekannten Talboden gilt dort der des Typs.
                  ableiten: zug === undefined && fein && festFein === undefined,
              }
            : undefined;
    const auftrag: VorschauAuftrag = {
        eingabe,
        preset,
        stand: { werte: { ...s.werte }, muster: s.muster, kammhoehe: s.kammhoehe },
        grundhoehe: roh.grundhoehe,
        kante,
        aufloesung: fein ? vorschauAufloesung.value : 1,
        ...(rueckennetz === undefined ? {} : { rueckennetz }),
    };
    const ergebnis = await vorschau.rechne(auftrag, { vorrang }).catch((fehler: unknown) => {
        console.warn("Gebirge-Vorschau:", fehler);
        if (vorschauRechnet.value) vorschauText.value = t("landschaftseditor.gebirge.vorschau.fehler");
        return null;
    });
    if (ergebnis === null || !vorschauRechnet.value || nummer <= angezeigtNummer) return;
    // Ein Zug zeigt jedes jüngere Bild, solange er läuft; sonst gilt nur das Bild des jüngsten Stands.
    if (zug !== undefined ? zugVorschau.value === undefined : generation !== vorschauGeneration) return;
    angezeigtNummer = nummer;
    if (zug !== undefined || fein) feinStehtFuer = gebirgeFlaeche.value;
    if (zug !== undefined) {
        zeigeZugBild(ergebnis, skala);
        return;
    }
    if (ergebnis.talboden !== undefined && fein && s.modell?.talboden === undefined) {
        talbodenSpeicher.set(schluessel, ergebnis.talboden);
        talbodenZuletzt.set(art, ergebnis.talboden);
        talbodenAbgeleitet.value = ergebnis.talboden;
        // Die Vorgaben der Täler und Mulden im Kammeditor (WI-0249 P9) rechnen mit demselben Talboden.
        if (gebirgeFlaeche.value !== undefined)
            vorschauTalboden.value = { flaeche: gebirgeFlaeche.value, talboden: ergebnis.talboden };
    }
    const pixel = vorschauPixel(ergebnis, festeSkala(skalaGemerkt, skala));
    // Die Höhen über den Punkten im Kammeditor lesen die Fläche am Punkt aus derselben Rechnung (WI-0249, „Höhen der Punkte“).
    if (gebirgeFlaeche.value !== undefined) vorschauFlaeche.value = { flaeche: gebirgeFlaeche.value, raster: ergebnis };
    if (fein)
        skalaGemerkt = { schluessel: skala, hoechste: pixel.hoechste, talboden: ergebnis.talboden, ms: ergebnis.ms };
    const bild = {
        url: alsDatenUrl(pixel),
        ecken: vorschauEcken(ergebnis),
        hoechste: pixel.hoechste,
        raster: ergebnis,
        aufloesung: auftrag.aufloesung ?? 1,
    };
    // Großes Gebirge im Rückennetz, fein gerechnet: Der sichtbare Ausschnitt kommt auf der Karte noch feiner darüber.
    ausschnittGrundlage =
        fein && auftrag.rueckennetz !== undefined && ergebnis.cell > AUSSCHNITT_AB_ZELLE
            ? {
                  auftrag: {
                      ...auftrag,
                      rueckennetz: { ...auftrag.rueckennetz, talbodenFest: ergebnis.talboden, ableiten: false },
                  },
                  hoechste: pixel.hoechste,
              }
            : undefined;
    planeAusschnitt();
    vorschauBild.value = bild;
    // Der Umschalter gilt auch im offenen Reiter ohne ungespeicherte Änderung.
    if (aufKarte.value) emit("gebirgeVorschau", bild);
    else emit("gebirgeVorschau", undefined);
    vorschauText.value =
        // Der Satz sagt, was gerechnet ist: das Rückennetz mit den gezeichneten Kämmen oder die Grundform der V12.
        t(
            rueckennetz === undefined
                ? "landschaftseditor.gebirge.vorschau.text"
                : "landschaftseditor.gebirge.vorschau.textRueckennetz",
            {
                w: formatNumber(ergebnis.w, 0),
                h: formatNumber(ergebnis.hh, 0),
                ms: formatNumber(Math.round(ergebnis.ms), 0),
            },
        ) +
        ` ${t("landschaftseditor.gebirge.vorschau.hoechste", { h: formatNumber(Math.round(hoechsteStelle(ergebnis)), 0) })}` +
        (pixel.ueberhoehung > 1.05
            ? ` ${t("landschaftseditor.gebirge.vorschau.ueberhoeht", { f: formatNumber(pixel.ueberhoehung, 1) })}`
            : "");
}
/** Das Bild eines Zugs: auf die Karte und an die Höhen über den Punkten, ohne Talboden, Skala oder Ausschnitt zu merken. */
function zeigeZugBild(ergebnis: VorschauErgebnis, skala: string): void {
    const pixel = vorschauPixel(ergebnis, festeSkala(skalaGemerkt, skala) ?? skalaGemerkt?.hoechste);
    if (gebirgeFlaeche.value !== undefined) vorschauFlaeche.value = { flaeche: gebirgeFlaeche.value, raster: ergebnis };
    const bild = {
        url: alsDatenUrl(pixel),
        ecken: vorschauEcken(ergebnis),
        hoechste: pixel.hoechste,
        raster: ergebnis,
        aufloesung: vorschauAufloesung.value,
    };
    vorschauBild.value = bild;
    if (aufKarte.value) emit("gebirgeVorschau", bild);
}
// --- „Ausschnitt fein“ (WI-0245, Bauplan Gebirge D4): große Gebirge im sichtbaren Ausschnitt auf höchstens 0,5 E je Zelle ---
/** Ab dieser Zellweite des ganzen Bilds (E) zeigt es keine Grate mehr (ein Gebirge ab 80 E auf 160 Zellen). */
const AUSSCHNITT_AB_ZELLE = 0.25;
/** Höchstens so viele Zellen je Seite im Ausschnitt; weiter herausgezoomt bleibt es beim ganzen Bild. */
const AUSSCHNITT_KANTE_MAX = 480;
let ausschnittGrundlage: { auftrag: VorschauAuftrag; hoechste: number } | undefined;
let ausschnittZeit: ReturnType<typeof setTimeout> | undefined;
let ausschnittNummer = 0;
function planeAusschnitt(): void {
    clearTimeout(ausschnittZeit);
    ausschnittZeit = setTimeout(() => void rechneAusschnitt(), 300);
}
async function rechneAusschnitt(): Promise<void> {
    const nummer = ++ausschnittNummer;
    const grundlage = ausschnittGrundlage;
    const sicht = kartenRahmen.value;
    if (grundlage === undefined || sicht === undefined || !aufKarte.value || vorschau === undefined) {
        emit("gebirgeVorschauFein", undefined);
        return;
    }
    const b = grundlage.auftrag.eingabe.bounds;
    const rahmen = {
        min_x: Math.max(b.min_x, sicht.min_x),
        min_y: Math.max(b.min_y, sicht.min_y),
        max_x: Math.min(b.max_x, sicht.max_x),
        max_y: Math.min(b.max_y, sicht.max_y),
    };
    const seite = Math.max(rahmen.max_x - rahmen.min_x, rahmen.max_y - rahmen.min_y);
    const kante = Math.ceil(seite / AUSSCHNITT_AB_ZELLE);
    if (rahmen.max_x <= rahmen.min_x || rahmen.max_y <= rahmen.min_y || kante > AUSSCHNITT_KANTE_MAX) {
        emit("gebirgeVorschauFein", undefined);
        return;
    }
    const ergebnis = await vorschau.rechne({ ...grundlage.auftrag, kante, ausschnitt: rahmen }).catch(() => null);
    // Nur das jüngste Ergebnis zählt; inzwischen kann die Karte weitergezogen oder das Gebirge geändert sein.
    if (ergebnis === null || nummer !== ausschnittNummer || ausschnittGrundlage !== grundlage || !aufKarte.value)
        return;
    const pixel = vorschauPixel(ergebnis, grundlage.hoechste);
    emit("gebirgeVorschauFein", { url: alsDatenUrl(pixel), ecken: vorschauEcken(ergebnis) });
}
watch(kartenRahmen, () => {
    if (ausschnittGrundlage !== undefined) planeAusschnitt();
});
// Ein vorhandenes Bild sofort ein-/ausblenden, ohne für einen reinen Sichtwechsel neu zu rechnen.
watch(aufKarte, (sichtbar) => {
    emit("gebirgeVorschau", sichtbar ? vorschauBild.value : undefined);
    if (sichtbar) planeAusschnitt();
    else {
        ++ausschnittNummer;
        clearTimeout(ausschnittZeit);
        emit("gebirgeVorschauFein", undefined);
    }
});
watch(
    () =>
        [
            vorschauRechnet.value,
            gebirgeStand.value,
            stand.value?.felder.gipfelHoehen,
            gebirgeDaten.value,
            vorschauAufloesung.value,
            zugVorschau.value,
        ] as const,
    ([offen, , , , , zugJetzt]) => {
        ++vorschauGeneration;
        clearTimeout(feinZeit);
        // Ein Zug im Kammeditor (WI-0249 Leistung): fein ohne Erosion, gedrosselt vom Kammeditor; der erste drängt eine laufende Rechnung
        // beiseite, die übrigen ersetzen nur den wartenden Auftrag (sonst käme während des Ziehens kein Bild fertig).
        if (offen && zugJetzt !== undefined && zugJetzt.flaeche === gebirgeFlaeche.value) {
            ausschnittGrundlage = undefined;
            clearTimeout(ausschnittZeit);
            ++ausschnittNummer;
            emit("gebirgeVorschauFein", undefined);
            void rechneVorschau(VORSCHAU_KANTE_FEIN, zugJetzt.netz, !zugLaeuft);
            zugLaeuft = true;
            return;
        }
        zugLaeuft = false;
        // Jede Änderung rechnet neu: Bis das ganze Bild fein steht, gilt kein Ausschnitt.
        ausschnittGrundlage = undefined;
        clearTimeout(ausschnittZeit);
        emit("gebirgeVorschauFein", undefined);
        if (!aufKarte.value) emit("gebirgeVorschau", undefined);
        if (!offen) {
            vorschauText.value = undefined;
            vorschauBild.value = undefined;
            feinStehtFuer = undefined;
            return;
        }
        vorschauText.value ??= t("landschaftseditor.gebirge.vorschau.rechnet");
        // Hat sich seit der letzten feinen Rechnung nur die Höhe von Punkten geändert (WI-0249 P9)? Dann gleich fein, ohne grobes Zwischenbild,
        // das höher oder tiefer läge als das feine: Das alte Bild bleibt stehen, bis das neue fertig ist.
        const daten = gebirgeDaten.value;
        const s = gebirgeStand.value;
        if (daten !== undefined && s !== undefined) {
            const roh = toRaw(daten);
            // Steht schon ein feines Bild (auch nach einem Zug), gleich fein: Es bleibt stehen, bis das neue fertig ist.
            if (
                feinStehtFuer === gebirgeFlaeche.value ||
                nurPunkthoeheGeaendert(skalaGemerkt, skalaSchluessel(s, eingabeDerVorschau(roh, s), roh.grundhoehe))
            ) {
                void rechneVorschau(VORSCHAU_KANTE_FEIN, undefined, true);
                return;
            }
        }
        // Eine laufende Rechnung eines älteren Stands wird abgebrochen, nicht abgewartet (bis 14 s bei großen Gebirgen).
        void rechneVorschau(VORSCHAU_KANTE_GROB, undefined, true);
        feinZeit = setTimeout(() => void rechneVorschau(VORSCHAU_KANTE_FEIN), 450);
    },
);
onBeforeUnmount(() => {
    clearTimeout(feinZeit);
    clearTimeout(ausschnittZeit);
    vorschau?.beenden();
    if (vorschauText.value !== undefined) emit("gebirgeVorschau", undefined);
    if (vorschauFlaeche.value?.flaeche === gebirgeFlaeche.value) vorschauFlaeche.value = undefined;
});
function setzeGipfelHoehe(id: string, hoehe: number): void {
    props.bearbeitung?.feld(
        (felder) => ({ ...felder, gipfelHoehen: { ...felder.gipfelHoehen, [id]: hoehe } }),
        `gipfel.${id}`,
    );
}
/**
 * Das Gebirge im Entwurf setzen; ändert sich die Kammhöhe, gehen die eigenen Punkthöhen des Netzes verhältnisgleich mit, im selben Schritt
 * (WI-0249 P9, `mitKammhoeheSkaliert`).
 */
function gebirgeMit(felder: LandschaftFelder, flaeche: string, neu: GebirgsEntwurf): LandschaftFelder {
    const d = detail.value;
    const vorher = felder.gebirge?.[flaeche] ?? (d === undefined ? undefined : gebirgeGelesen(d, flaeche));
    const stand =
        vorher === undefined ? neu : mitKammhoeheSkaliert(vorher, neu, gebirgeDaten.value?.grundhoehe ?? null);
    return { ...felder, gebirge: { ...felder.gebirge, [flaeche]: stand } };
}
/** „Werte einfügen“: Gebirge und Gipfelhöhen als EIN Schritt im Entwurf. */
function setzeGebirgeUndGipfel(neu: GebirgsEntwurf, gipfelHoehen: Record<string, number>): void {
    const flaeche = gebirgeFlaeche.value;
    if (flaeche === undefined) return;
    props.bearbeitung?.feld((felder) => ({ ...gebirgeMit(felder, flaeche, neu), gipfelHoehen }));
}
function setzeGebirge(neu: GebirgsEntwurf, verschmelze?: string): void {
    const flaeche = gebirgeFlaeche.value;
    if (flaeche === undefined) return;
    props.bearbeitung?.feld((felder) => gebirgeMit(felder, flaeche, neu), verschmelze);
}
watch(
    () => auswahl.value,
    () => {
        if (reiter.value === "beschriftungen" && detail.value?.labels.length === 0) reiter.value = "eigenschaften";
    },
);
watch(
    () => props.reiterWunsch?.mal,
    () => {
        if (props.reiterWunsch !== undefined) reiter.value = props.reiterWunsch.reiter;
    },
    { immediate: true },
);
/**
 * Nach „Neue Fläche“ steht der Name markiert (C3: „ihr Fenster offen, der Name markiert“): Der Griff „Fläche-001“ wird beim Tippen
 * überschrieben. Erst, wenn das Feld steht (der Stand ist gelesen), und je Wunsch einmal.
 */
const nameFeld = ref<InstanceType<typeof AvmEingabe>>();
let nameMarkiert = 0;
watch(
    [() => props.nameWunsch?.mal, () => stand.value !== undefined && schreibt.value, auswahl, reiter],
    async () => {
        const wunsch = props.nameWunsch;
        if (wunsch === undefined || wunsch.mal === nameMarkiert || wunsch.id !== auswahl.value) return;
        if (stand.value === undefined || !schreibt.value) return;
        await nextTick();
        if (nameFeld.value === undefined) return;
        nameMarkiert = wunsch.mal;
        nameFeld.value.focus();
        nameFeld.value.select();
    },
    { immediate: true },
);
/** Der Name der Ebene wie im Fächer der Karte (`layer.*`). */
const ebeneName = (ebene: string): string => {
    const key = `layer.${ebene}`;
    return isMessageKey(key) ? t(key) : ebene;
};
const ecken = computed(() =>
    (detail.value?.areas ?? []).reduce(
        (summe, flaeche) =>
            summe + flaeche.polygons.reduce((s, ringe) => s + ringe.reduce((r, ring) => r + ring.length, 0), 0),
        0,
    ),
);
const titel = computed(() => {
    // Mehrfachauswahl (T57): „Derographie bearbeiten · 3 gewählt“, wie Fassung 5.
    if (sammel.value !== undefined)
        return `${t("landschaftseditor.titel")} · ${t("landschaftseditor.mehrfach.titel", { n: formatNumber(angehakteZeilen.value.length, 0) })}`;
    const name = (zeile.value ?? detail.value)?.name;
    return name === undefined ? t("landschaftseditor.titel") : `${t("landschaftseditor.titel")} · ${name}`;
});
// --- Die Zoomspanne je Beschriftung (`fenster/zoomspanne.vue`; EDIT-0003 T27 Regel 7) ---
/** Die Spanne der Art; `undefined` ohne Tafel oder wenn die Art den Namen ausblendet. */
function vorgabeVon(label: EditorLandscapeLabel): { von: number; bis: number } | undefined {
    const d = label.zoomDefault;
    return d === undefined || d.max < d.min ? undefined : { von: d.min, bis: d.max };
}
/** Die wirksame Spanne: die eigene als Paar, sonst die der Art (Sicht `map_label_effective`, 0057; Vorrang WI-0221 F2). */
function wirksam(label: EditorLandscapeLabel, felder?: BeschriftungFelder): { von: number; bis: number } | undefined {
    const von = felder === undefined ? label.zoomMin : felder.zoomMin;
    const bis = felder === undefined ? label.zoomMax : felder.zoomMax;
    return von !== undefined && bis !== undefined ? { von, bis } : vorgabeVon(label);
}
/** Je Band, ob die Karte den Namen dort zeigt (für die Zellen der Spanne). */
const stufenVon = (spanne: { von: number; bis: number } | undefined): string[] =>
    Array.from({ length: 9 }, (_, b) =>
        spanne !== undefined && b >= spanne.von && b <= spanne.bis ? "gezeigt" : "aus",
    );
const eigeneSpanne = (felder: BeschriftungFelder): boolean =>
    felder.zoomMin !== undefined && felder.zoomMax !== undefined;
/** Was gilt, als Satz: die eigene Spanne, sonst die Vorgabe der Art. */
function zoomText(label: EditorLandscapeLabel, felder?: BeschriftungFelder): string {
    const von = felder === undefined ? label.zoomMin : felder.zoomMin;
    const bis = felder === undefined ? label.zoomMax : felder.zoomMax;
    if (von !== undefined && bis !== undefined) return t("landschaftseditor.beschriftung.zoomEigen", { von, bis });
    const d = label.zoomDefault;
    if (d === undefined) return t("landschaftseditor.beschriftung.zoomOhne");
    return d.max < d.min
        ? t("landschaftseditor.beschriftung.zoomAus")
        : t("landschaftseditor.beschriftung.zoomArt", { von: d.min, bis: d.max });
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="werkzeug"
        rumpf="spalten"
        :lage="lage"
        :box="fenster.box"
        :ablage-ziel="ablageZiel"
        :einzug="einzug"
        :titel="titel"
        :zusatz="
            schreibt || (gipfel !== undefined ? darfGipfel : (sammel !== undefined || mehrfach) && darf === true)
                ? undefined
                : t('editorPanel.verb.lesen')
        "
        :testid="kennung"
        @update:lage="(neu, box) => emit('lage', neu, box)"
        @update:box="(box) => emit('box', box)"
        @vorn="emit('vorn')"
    >
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'liste'"
            :id="`${kennung}-listenspalte`"
            :titel="t('landschaftseditor.liste')"
            breite="inspektor"
            :telefon="phoneViewport"
            :einziehbar="!phoneViewport"
            :inert="zu || undefined"
            :schliessen="t('fenster.liste.schliessen')"
            :testid="`${kennung}-liste`"
            @schliesse="phoneViewport ? (telefonSeite = 'eigenschaften') : emit('listeZu', true)"
        >
            <p v-if="ladeFehler" class="landschaftseditor__fehler">
                {{ ladeFehler }}
                <button type="button" class="landschaftseditor__verweis" @click="emit('erneut')">
                    {{ t("editorListe.erneut") }}
                </button>
            </p>
            <p v-else-if="!liste" class="landschaftseditor__fehler">{{ t("landschaftseditor.laedt") }}</p>
            <EditorListe
                v-else
                v-model:gewaehlt="gewaehlt"
                v-model:mehrfach="mehrfach"
                v-model:angehakt="angehakt"
                :zeilen="zeilen"
                :vorfilter="maske"
                :optionen="optionen"
                :facetten-name="facettenName"
                :wert-name="wertName"
                :sortierungen="sortierungen"
                :masken="objektMasken"
                :masken-titel="t('landschaftseditor.objekte.titel')"
                :legende="legende"
                :leer-text="t('landschaftseditor.leer')"
                :kennung="`${kennung}-landschaften`"
                :beschriftung="t('landschaftseditor.liste')"
                :einstellung="einstellung"
                @oeffne="fliege"
                @klick="(id: string) => einzelnAngehakt(id)"
            >
                <!-- ☰ „Reihenfolge und Sperren“ rechts neben der Sortierung (T47), derselbe Weg wie ☰ in der Ebenenleiste. -->
                <template #zeichen>
                    <button
                        type="button"
                        class="landschaftseditor__zeichenknopf"
                        :aria-pressed="einstellung.sortierung.value === 'reihenfolge'"
                        :aria-label="stapelSatz"
                        :title="stapelSatz"
                        :data-testid="`${kennung}-leiste-reihenfolge`"
                        @click="stapelUmschalten(einstellung, true)"
                    >
                        <span class="avm-versalmitte" aria-hidden="true">☰</span>
                    </button>
                </template>
            </EditorListe>
        </FensterSpalte>
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'eigenschaften'"
            :titel="
                gipfel
                    ? gipfelTitel
                    : kandidat
                      ? t('landschaftseditor.landmarke.eigenschaften')
                      : t('landschaftseditor.eigenschaften')
            "
            breite="fuellen"
            :telefon="phoneViewport"
            :testid="`${kennung}-eigenschaften-spalte`"
            :class="{ 'landschaftseditor__spalte--gebirge': reiter === 'gebirge' && !gipfel }"
        >
            <template #zurueck>
                <button
                    v-if="phoneViewport"
                    type="button"
                    class="landschaftseditor__verweis"
                    @click="telefonSeite = 'liste'"
                >
                    {{ t("ortseditor.zurListe") }}
                </button>
                <button
                    v-else
                    type="button"
                    class="landschaftseditor__listenschalter"
                    :aria-expanded="!zu"
                    :aria-controls="`${kennung}-listenspalte`"
                    :aria-label="schalterText"
                    :title="schalterText"
                    :data-testid="`${kennung}-listenschalter`"
                    @click="emit('listeZu', !zu)"
                >
                    <span class="avm-versalmitte" aria-hidden="true">{{ zu ? "»" : "«" }}</span>
                </button>
            </template>
            <LandschaftMehrfach
                v-if="sammel && angehakteZeilen.length >= 2"
                :zeilen="angehakteZeilen"
                :sammel="sammel"
                :kennung="kennung"
                :schreibt="darf === true && sammelGipfelFrei"
                :gebirge-frei="darfGebirge === true"
                :entferne="sammelEntfernenFrei && entferneAlle !== undefined ? entferneAngehakte : undefined"
            />
            <LandmarkeKandidat
                v-else-if="kandidat"
                :kandidat="kandidat"
                :darf="darf === true && (darfGebirge === true || !formtGelaende(kandidat.art))"
                :kennung="kennung"
                @setze="(k: EditorLandmarkenKandidat) => emit('setzeKandidat', k)"
                @erneut="emit('erneut')"
            />
            <WikiEintrag
                v-else-if="wikiEintrag"
                :eintrag="wikiEintrag"
                :darf="darf === true"
                :kennung="kennung"
                @zeichne="(e: EditorWikiEintrag) => emit('zeichneWikiEintrag', e)"
            />
            <GipfelEigenschaften
                v-else-if="gipfel"
                :bearbeitung="gipfel"
                :darf="darfGipfel"
                :gelaende-frei="darfGebirge === true"
                :zieht="gipfelZieht"
                :name-markieren="nameWunsch !== undefined && nameWunsch.id === auswahl ? nameWunsch.mal : undefined"
                :hoehe-gesperrt="gipfelHoeheImGebirge?.(gipfel.detail.value?.id ?? '')"
                :verlauf="verlauf"
                :entferne="darfGipfel && entferne !== undefined ? () => entferne!('retire') : undefined"
                :entfernen-wunsch="
                    entfernenWunsch !== undefined && entfernenWunsch.id === auswahl ? entfernenWunsch.mal : undefined
                "
                :kennung="kennung"
                :quellen-recht="quellenRecht"
                @verschiebe="(an: boolean) => emit('verschiebeGipfel', an)"
                @erneut="emit('erneut')"
                @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
            />
            <p
                v-else-if="mehrfach && !zeile && !detail"
                class="landschaftseditor__leer"
                :data-testid="`${kennung}-mehrfach-anhaken`"
            >
                {{ t("landschaftseditor.mehrfach.anhaken") }}
            </p>
            <p v-else-if="!zeile && !detail" class="landschaftseditor__leer">{{ t("landschaftseditor.keineWahl") }}</p>
            <template v-else>
                <div class="landschaftseditor__name">
                    <strong>{{ (zeile ?? detail)?.name }}</strong>
                    <small
                        >{{ artName((zeile ?? detail)?.type) }} · {{ ebeneName((zeile ?? detail)?.layer ?? "") }}</small
                    >
                </div>
                <div v-if="still" class="landschaftseditor__stand" :data-testid="`${kennung}-stand`">
                    <span>{{
                        still === "off_map"
                            ? t("landschaftseditor.stand.abgenommen")
                            : t("landschaftseditor.stand.geloescht")
                    }}</span>
                    <AvmKnopf
                        v-if="reiter !== 'verlauf'"
                        groesse="zeile"
                        :testid="`${kennung}-zum-verlauf`"
                        @click="reiter = 'verlauf'"
                    >
                        {{ t("landschaftseditor.reiter.verlauf") }}
                    </AvmKnopf>
                </div>
                <div v-else-if="detail?.hidden" class="landschaftseditor__stand" :data-testid="`${kennung}-verborgen`">
                    <span>{{ t("landschaftseditor.verborgen.band") }}</span>
                    <AvmKnopf
                        v-if="darf === true"
                        groesse="zeile"
                        :testid="`${kennung}-zurueckholen`"
                        @click="emit('zurueckholen')"
                    >
                        {{ t("landschaftseditor.griff.zurueckholen") }}
                    </AvmKnopf>
                </div>
                <EntwurfKonflikt
                    v-if="konflikt && bearbeitung"
                    :bearbeitung="bearbeitung"
                    :konflikt="konflikt"
                    :feld-name="teilName"
                    :kennung="kennung"
                />
                <FensterReiter
                    v-model="reiter"
                    :reiter="reiterListe"
                    :beschriftung="t('landschaftseditor.reiter')"
                    :kennung="kennung"
                />
                <div
                    :id="`${kennung}-inhalt-${reiter}`"
                    class="landschaftseditor__rumpf"
                    :class="{ 'landschaftseditor__rumpf--gebirge': reiter === 'gebirge' }"
                    role="tabpanel"
                    :data-testid="`${kennung}-eigenschaften`"
                >
                    <p v-if="detailFehler" class="landschaftseditor__fehler">{{ detailFehler }}</p>
                    <p v-else-if="!detail" class="landschaftseditor__fehler">
                        {{ t("landschaftseditor.detailLaedt") }}
                    </p>
                    <template v-else-if="reiter === 'eigenschaften'">
                        <section class="landschaftseditor__abschnitt">
                            <h4 class="landschaftseditor__titel">{{ t("landschaftseditor.abschnitt.identitaet") }}</h4>
                            <FensterFeldzeilen>
                                <dt>{{ t("landschaftseditor.feld.name") }}</dt>
                                <dd v-if="schreibt && stand">
                                    <AvmEingabe
                                        ref="nameFeld"
                                        :model-value="stand.felder.name"
                                        :gesperrt="ruht ?? rahmen"
                                        :aria-label="t('landschaftseditor.feld.name')"
                                        :testid="`${kennung}-feld-name`"
                                        @update:model-value="setzeName"
                                        @blur="bearbeitung?.feldVerlassen()"
                                    />
                                </dd>
                                <dd v-else>{{ detail.name }}</dd>
                                <dt>{{ t("landschaftseditor.feld.ebene") }}</dt>
                                <dd v-if="schreibt && stand">
                                    <AvmAuswahl
                                        :model-value="stand.felder.ebene"
                                        :optionen="ebenen"
                                        :gesperrt="ruht ?? rahmen ?? gebirgeStill"
                                        :aria-label="t('landschaftseditor.feld.ebene')"
                                        :testid="`${kennung}-feld-ebene`"
                                        @update:model-value="setzeEbene"
                                    />
                                </dd>
                                <dd v-else>{{ ebeneName(detail.layer) }}</dd>
                                <dt>{{ t("landschaftseditor.feld.flaechenart") }}</dt>
                                <dd v-if="schreibt && stand">
                                    <AvmAuswahl
                                        :model-value="stand.felder.art ?? ''"
                                        :optionen="arten"
                                        :gesperrt="ruht ?? rahmen ?? gebirgeStill"
                                        :aria-label="t('landschaftseditor.feld.flaechenart')"
                                        :testid="`${kennung}-feld-art`"
                                        @update:model-value="setzeArt"
                                    />
                                </dd>
                                <dd v-else>{{ artName(detail.type) }}</dd>
                            </FensterFeldzeilen>
                            <p
                                v-for="key in hinweise"
                                :key="key"
                                class="landschaftseditor__leer"
                                :data-testid="`${kennung}-hinweis`"
                            >
                                <template v-for="(stueck, i) in stuecke(key)" :key="i"
                                    ><button
                                        v-if="stueck.ziel"
                                        type="button"
                                        class="landschaftseditor__verweis"
                                        :data-testid="`${kennung}-${stueck.ziel}`"
                                        @click="oeffneZiel(stueck.ziel)"
                                    >
                                        {{ stueck.text }}</button
                                    ><template v-else>{{ stueck.text }}</template></template
                                >
                            </p>
                        </section>
                        <section class="landschaftseditor__abschnitt" :data-testid="`${kennung}-merkmale`">
                            <h4 class="landschaftseditor__titel">{{ t("landschaftseditor.abschnitt.merkmale") }}</h4>
                            <FensterFeldzeilen>
                                <dt>{{ t("landschaftseditor.feld.gefahrenlage") }}</dt>
                                <dd v-if="schreibt && stand">
                                    <AvmMehrfachauswahl
                                        :model-value="gefahren"
                                        :optionen="GEFAHR_OPTIONEN"
                                        :leer="t('gefahr.ungefaehrlich')"
                                        :leer-zusatz="t('landschaftseditor.gefahr.vorgabe')"
                                        ton="gefahr"
                                        :gesperrt="gefahrGesperrt"
                                        :aria-label="t('landschaftseditor.feld.gefahrenlage')"
                                        :testid="`${kennung}-feld-gefahr`"
                                        @update:model-value="setzeGefahren"
                                    />
                                </dd>
                                <dd
                                    v-else
                                    :class="{ landschaftseditor__gefahr: gefahren.length > 0 }"
                                    :data-testid="`${kennung}-gefahr`"
                                >
                                    {{ gefahrenText(gefahren) }}
                                </dd>
                            </FensterFeldzeilen>
                            <p
                                class="landschaftseditor__leer landschaftseditor__gefahrhinweis"
                                :data-testid="`${kennung}-gefahr-hinweis`"
                            >
                                <GefahrMarke
                                    v-if="gefahren.length > 0 && gefahrWirkt(stand?.felder.ebene ?? detail.layer)"
                                />
                                {{
                                    !gefahrWirkt(stand?.felder.ebene ?? detail.layer)
                                        ? t("landschaftseditor.gefahr.grund.ebene")
                                        : gefahren.length > 0
                                          ? t("landschaftseditor.gefahr.hinweis")
                                          : t("landschaftseditor.gefahr.hinweisLeer")
                                }}
                            </p>
                        </section>
                        <section class="landschaftseditor__abschnitt">
                            <WikiBox
                                :id="detail.id"
                                art="region"
                                :recht="schreibt ? 'schreiben' : 'lesen'"
                                :ungespeichert="wikiBoxUngespeichert"
                                :felder="[]"
                                :lesestand="detail.revision"
                                :kennung="kennung"
                                @geaendert="wikiGeaendert"
                            />
                        </section>
                        <section
                            v-if="schreibt && darfForm === true && kopiere && kopierenFlaeche"
                            class="landschaftseditor__abschnitt"
                            :data-testid="`${kennung}-kopieren-abschnitt`"
                        >
                            <LandschaftKopieren
                                :key="kopierenWunsch?.mal ?? 0"
                                :detail="detail"
                                :area-id="kopierenFlaeche"
                                :zeilen="liste?.rows ?? []"
                                :kennung="kennung"
                                :gesperrt="
                                    kopierenSendet
                                        ? t('landschaftseditor.kopieren.sendet')
                                        : bearbeitung?.lage.value.aktiv
                                          ? t('landschaftseditor.entfernen.erstFertig')
                                          : undefined
                                "
                                :fehler="kopierenSatz"
                                @kopieren="(ziel: KopierZiel) => void kopieren(ziel)"
                                @abbrechen="kopierenFlaeche = undefined"
                            />
                        </section>
                        <section
                            v-if="schreibt && darfForm === true && entferne"
                            class="landschaftseditor__abschnitt"
                            :data-testid="`${kennung}-entfernen-abschnitt`"
                        >
                            <LandschaftEntfernen
                                v-if="entfernenOffen"
                                :frage="t('landschaftseditor.entfernen.frage', { name: detail.name })"
                                :flaechen="detail.areas.length"
                                :beschriftungen="detail.labels.length"
                                :kennung="kennung"
                                :gesperrt="
                                    entfernenSendet
                                        ? t('landschaftseditor.entfernen.sendet')
                                        : bearbeitung?.lage.value.aktiv
                                          ? t('landschaftseditor.entfernen.erstFertig')
                                          : undefined
                                "
                                @entfernen="(stage) => void entfernen(stage)"
                                @abbrechen="entfernenOffen = false"
                            />
                            <AvmKnopf
                                v-else
                                art="gefahr"
                                groesse="zeile"
                                :gesperrt="
                                    bearbeitung?.lage.value.aktiv
                                        ? t('landschaftseditor.entfernen.erstFertig')
                                        : undefined
                                "
                                :testid="`${kennung}-entfernen-oeffnen`"
                                @click="entfernenOffen = true"
                            >
                                {{ t("landschaftseditor.entfernen.oeffnen") }}
                            </AvmKnopf>
                            <p v-if="entfernenSatz" class="landschaftseditor__fehler" role="alert">
                                {{ entfernenSatz }}
                            </p>
                        </section>
                    </template>
                    <template v-else-if="reiter === 'form'">
                        <section class="landschaftseditor__abschnitt" :data-testid="`${kennung}-form`">
                            <h4 class="landschaftseditor__titel">{{ t("landschaftseditor.abschnitt.form") }}</h4>
                            <FensterFeldzeilen>
                                <dt>{{ t("landschaftseditor.feld.unterflaechen") }}</dt>
                                <dd>
                                    {{
                                        detail.areas.length === 0
                                            ? t("landschaftseditor.unter.ohneFlaeche")
                                            : formatNumber(detail.areas.length, 0)
                                    }}
                                </dd>
                                <dt>{{ t("landschaftseditor.feld.ecken") }}</dt>
                                <dd>{{ formatNumber(ecken, 0) }}</dd>
                                <dt>{{ t("landschaftseditor.feld.gemeinsam") }}</dt>
                                <dd v-if="detail.neighbors.length === 0">
                                    {{ t("landschaftseditor.gemeinsam.keine") }}
                                </dd>
                                <dd v-else>
                                    <span v-for="(nachbar, i) in detail.neighbors" :key="nachbar.id"
                                        >{{ i > 0 ? ", " : ""
                                        }}{{
                                            t("landschaftseditor.gemeinsam.nachbar", {
                                                name: nachbar.name,
                                                n: formatNumber(nachbar.sharedCorners, 0),
                                            })
                                        }}</span
                                    >
                                </dd>
                            </FensterFeldzeilen>
                        </section>
                        <section class="landschaftseditor__abschnitt">
                            <h4 class="landschaftseditor__titel">{{ t("landschaftseditor.abschnitt.reihenfolge") }}</h4>
                            <FensterFeldzeilen>
                                <dt>{{ t("landschaftseditor.feld.platz") }}</dt>
                                <dd :data-testid="`${kennung}-platz`">{{ platzText }}</dd>
                                <template v-if="schreibt && stand">
                                    <dt></dt>
                                    <dd class="landschaftseditor__knoepfe">
                                        <AvmKnopf
                                            v-for="wohin in ['vorn', 'hinten'] as const"
                                            :key="wohin"
                                            groesse="zeile"
                                            :art="stand.felder.platz === wohin ? 'gefuellt' : 'weich'"
                                            :aria-pressed="stand.felder.platz === wohin"
                                            :zweite="
                                                stand.felder.platz === wohin
                                                    ? t('landschaftseditor.reihe.mitFertig')
                                                    : undefined
                                            "
                                            :gesperrt="platzGrund(wohin)"
                                            :testid="`${kennung}-platz-${wohin}`"
                                            @click="setzePlatz(wohin)"
                                        >
                                            {{
                                                wohin === "vorn"
                                                    ? t("landschaftseditor.griff.vorn")
                                                    : t("landschaftseditor.griff.hinten")
                                            }}
                                        </AvmKnopf>
                                    </dd>
                                </template>
                                <dt>{{ t("landschaftseditor.feld.klick") }}</dt>
                                <dd v-if="schreibt && stand">
                                    <AvmKaestchen
                                        art="checkbox"
                                        :checked="stand.felder.gesperrt"
                                        :gesperrt="ruht"
                                        :testid="`${kennung}-feld-klick`"
                                        @change="(an: boolean) => setzeFeld({ gesperrt: an })"
                                    >
                                        {{ t("landschaftseditor.unter.klickGesperrt") }}
                                    </AvmKaestchen>
                                </dd>
                                <dd v-else>
                                    {{
                                        detail.clickLocked
                                            ? t("landschaftseditor.unter.klickGesperrt")
                                            : t("landschaftseditor.klick.frei")
                                    }}
                                </dd>
                                <dt>{{ t("landschaftseditor.feld.besucher") }}</dt>
                                <dd v-if="schreibt && stand">
                                    <AvmKaestchen
                                        art="checkbox"
                                        :checked="stand.felder.verborgen === true"
                                        :gesperrt="ruht"
                                        mehrzeilig
                                        :testid="`${kennung}-feld-verborgen`"
                                        @change="(an: boolean) => setzeFeld({ verborgen: an })"
                                    >
                                        <span
                                            >{{ t("landschaftseditor.unter.verborgen")
                                            }}<small class="landschaftseditor__merkmalsatz">{{
                                                t("landschaftseditor.merkmal.verborgenSatz")
                                            }}</small></span
                                        >
                                    </AvmKaestchen>
                                </dd>
                                <dd v-else>
                                    {{
                                        detail.hidden
                                            ? t("landschaftseditor.unter.verborgen")
                                            : t("landschaftseditor.besucher.sichtbar")
                                    }}
                                </dd>
                            </FensterFeldzeilen>
                        </section>
                    </template>
                    <template v-else-if="reiter === 'gebirge'">
                        <p v-if="!gebirgeStand" class="landschaftseditor__leer">
                            {{ t("landschaftseditor.unter.ohneFlaeche") }}
                        </p>
                        <GebirgeReiter
                            v-model:aufloesung="vorschauAufloesung"
                            v-else
                            :stand="gebirgeStand"
                            :gelesen="gebirgeGelesen(detail, gebirgeFlaeche!)"
                            :presets="gebirgeDaten?.presets.gruppe ?? GEBIRGS_PRESETS_VORGABE"
                            :preset-quelle="gebirgeDaten?.presets.quelle ?? 'vorgabe'"
                            :grundhoehe="gebirgeDaten?.grundhoehe ?? null"
                            :gesperrt="schreibt ? ruht : t('landschaftseditor.gipfel.nurLesen')"
                            :peaks="detail.peaks ?? []"
                            :gipfel-hoehen="stand?.felder.gipfelHoehen ?? KEINE_GIPFELHOEHEN"
                            :gipfel-gesperrt="gipfelHoeheImGipfel"
                            :vorschau="vorschauText"
                            :talboden-abgeleitet="talbodenAbgeleitet"
                            :vorschau-bild="vorschauBild"
                            :kaemme-laufen="kaemmeLaufen === true"
                            :eingabe="gebirgeDaten?.eingabe"
                            :profile="gebirgeProfile"
                            :kennung="kennung"
                            @aendere="setzeGebirge"
                            @gipfel-hoehe="setzeGipfelHoehe"
                            @gipfel-oeffnen="(id: string) => emit('gipfel', id)"
                            @gipfel-zeigen="(id: string | undefined) => zeigeGipfelAufKarte(id)"
                            @gipfel-ziel="fliegeZuGipfel"
                            @kaemme="emit('kaemmeZeichnen', gebirgeFlaeche!)"
                            @einfuegen="setzeGebirgeUndGipfel"
                            @fliege="(bounds: [number, number, number, number]) => emit('fliege', bounds)"
                            @objekt="(art: 'weg' | 'landschaft', id: string) => emit('objekt', art, id)"
                            :gebirge-name="detail.name"
                        />
                    </template>
                    <TraegerKarten v-else-if="reiter === 'karten'" :karten="karten" :kennung="kennung" />
                    <TraegerQuellen
                        v-else-if="reiter === 'quellen'"
                        :id="detail.id"
                        kind="area"
                        :recht="quellenRecht === true"
                        :schreibt="schreibt"
                        :kennung="kennung"
                        @zahl="(n: number) => (quellenZahl = n)"
                        @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
                    />
                    <template v-else-if="reiter === 'verlauf'">
                        <EntwurfVerlauf
                            v-if="verlauf"
                            :verlauf="verlauf"
                            :kennung="kennung"
                            :feld-name="verlaufFeldName"
                            :wert="verlaufWert"
                            :quellen="{ ziel: { kind: 'area', id: detail.id }, recht: quellenRecht === true, schreibt }"
                        />
                    </template>
                    <template v-else>
                        <section
                            v-if="schreibt && stand"
                            class="landschaftseditor__abschnitt"
                            :data-testid="`${kennung}-kurve`"
                        >
                            <AvmKaestchen
                                art="checkbox"
                                :checked="stand.felder.kurve === true"
                                :gesperrt="kurveGesperrt"
                                :testid="`${kennung}-feld-kurve`"
                                @change="(an: boolean) => setzeFeld({ kurve: an })"
                            >
                                {{ t("landschaftseditor.feld.kurve") }}
                            </AvmKaestchen>
                            <FensterFeldzeilen>
                                <dt>{{ t("landschaftseditor.feld.laeufe") }}</dt>
                                <dd>
                                    <AvmAuswahl
                                        :model-value="String(stand.felder.laeufe ?? 1)"
                                        :optionen="LAEUFE"
                                        groesse="zeile"
                                        :gesperrt="
                                            kurveGesperrt ??
                                            (stand.felder.kurve === true
                                                ? undefined
                                                : t('landschaftseditor.grund.kurveAus'))
                                        "
                                        :aria-label="t('landschaftseditor.feld.laeufe')"
                                        :testid="`${kennung}-feld-laeufe`"
                                        @update:model-value="(wert: string) => setzeFeld({ laeufe: Number(wert) })"
                                    />
                                </dd>
                            </FensterFeldzeilen>
                        </section>
                        <p v-else-if="detail.curve?.enabled" class="landschaftseditor__leer">
                            {{
                                t("landschaftseditor.beschriftung.entlang", {
                                    n: formatNumber(detail.curve.max ?? 1, 0),
                                })
                            }}
                        </p>
                        <p v-if="detail.labels.length === 0" class="landschaftseditor__leer">
                            {{ t("landschaftseditor.beschriftung.keine") }}
                        </p>
                        <p v-if="schreibt && entlangHinweis" class="landschaftseditor__leer">
                            <AvmSperrgrund
                                :id="entlangHinweisId"
                                :text="t('landschaftseditor.beschriftung.grund.entlang')"
                            />
                        </p>
                        <section
                            v-for="(label, i) in detail.labels"
                            :key="label.id"
                            class="landschaftseditor__abschnitt"
                            :data-testid="`${kennung}-beschriftung`"
                        >
                            <h4 class="landschaftseditor__titel">
                                {{ t("landschaftseditor.beschriftung.titel", { n: i + 1 }) }}
                            </h4>
                            <FensterFeldzeilen v-if="schreibt && stand?.felder.labels[label.id]">
                                <dt>{{ t("landschaftseditor.feld.text") }}</dt>
                                <dd v-if="stand.felder.labels[label.id]!.followName">{{ stand.felder.name }}</dd>
                                <dd v-else>
                                    {{ label.text }}
                                    <span class="landschaftseditor__leer">{{
                                        t("landschaftseditor.beschriftung.weicht")
                                    }}</span>
                                    <button
                                        type="button"
                                        class="landschaftseditor__verweis"
                                        :disabled="ruht !== undefined"
                                        :data-testid="`${kennung}-beschriftung-${i}-namen`"
                                        @click="setzeBeschriftung(label.id, { followName: true })"
                                    >
                                        ↺ {{ t("landschaftseditor.beschriftung.namenUebernehmen") }}
                                    </button>
                                </dd>
                                <dt>{{ t("landschaftseditor.feld.groesse") }}</dt>
                                <dd>
                                    <AvmFeld
                                        type="number"
                                        min="4"
                                        max="60"
                                        step="0.5"
                                        class="landschaftseditor__zahl"
                                        :value="stand.felder.labels[label.id]!.size ?? ''"
                                        :disabled="ruht !== undefined"
                                        :aria-label="t('landschaftseditor.feld.groesse')"
                                        :data-testid="`${kennung}-beschriftung-${i}-groesse`"
                                        @change="(ereignis: Event) => setzeGroesse(label.id, ereignis)"
                                    />
                                </dd>
                                <dt>{{ t("landschaftseditor.feld.prioritaet") }}</dt>
                                <dd>
                                    <AvmAuswahl
                                        :model-value="String(stand.felder.labels[label.id]!.priority ?? '')"
                                        :optionen="PRIORITAET"
                                        groesse="zeile"
                                        :gesperrt="ruht"
                                        :aria-label="t('landschaftseditor.feld.prioritaet')"
                                        :testid="`${kennung}-beschriftung-${i}-prioritaet`"
                                        @update:model-value="
                                            (wert: string) => setzeBeschriftung(label.id, { priority: zahl(wert) })
                                        "
                                    />
                                </dd>
                                <dt>{{ t("landschaftseditor.feld.zoom") }}</dt>
                                <dd class="landschaftseditor__spanne">
                                    <ZoomspanneKopf
                                        :beschriftung="t('landschaftseditor.feld.zoom')"
                                        @band="(b: number) => emit('band', b)"
                                    />
                                    <span></span>
                                    <Zoomspanne
                                        :von="stand.felder.labels[label.id]!.zoomMin"
                                        :bis="stand.felder.labels[label.id]!.zoomMax"
                                        :vorgabe="vorgabeVon(label)"
                                        :stufen="stufenVon(wirksam(label, stand.felder.labels[label.id]))"
                                        paar
                                        tippen
                                        :gesperrt="ruht"
                                        :name="t('landschaftseditor.beschriftung.titel', { n: i + 1 })"
                                        :testid="`${kennung}-beschriftung-${i}-zoom`"
                                        @aendere="
                                            (spanne: { von: number | undefined; bis: number | undefined }) =>
                                                setzeBeschriftung(label.id, {
                                                    zoomMin: spanne.von,
                                                    zoomMax: spanne.bis,
                                                })
                                        "
                                    />
                                    <button
                                        v-if="eigeneSpanne(stand.felder.labels[label.id]!)"
                                        type="button"
                                        class="landschaftseditor__verweis"
                                        :title="t('landschaftseditor.beschriftung.vorgabe')"
                                        :aria-label="t('landschaftseditor.beschriftung.vorgabe')"
                                        :disabled="ruht !== undefined"
                                        :data-testid="`${kennung}-beschriftung-${i}-zoom-vorgabe`"
                                        @click="setzeBeschriftung(label.id, { zoomMin: undefined, zoomMax: undefined })"
                                    >
                                        ↺
                                    </button>
                                    <span v-else></span>
                                    <small class="landschaftseditor__spannentext">{{
                                        zoomText(label, stand.felder.labels[label.id])
                                    }}</small>
                                </dd>
                            </FensterFeldzeilen>
                            <AvmKaestchen
                                v-if="schreibt && stand?.felder.labels[label.id]"
                                art="checkbox"
                                :checked="stand.felder.labels[label.id]!.visible"
                                :gesperrt="ruht"
                                :testid="`${kennung}-beschriftung-${i}-anzeigen`"
                                @change="(an: boolean) => setzeBeschriftung(label.id, { visible: an })"
                            >
                                {{ t("landschaftseditor.feld.anzeigen") }}
                            </AvmKaestchen>
                            <div v-if="schreibt && stand?.felder.labels[label.id]" class="landschaftseditor__knoepfe">
                                <AvmKnopf
                                    groesse="zeile"
                                    :art="zieht === label.id ? 'gefuellt' : 'weich'"
                                    :aria-pressed="zieht === label.id"
                                    :gesperrt="zieht === label.id ? undefined : verschiebenGrund"
                                    :grund-bei="grundBei(verschiebenGrund)"
                                    :testid="`${kennung}-beschriftung-${i}-verschieben`"
                                    @click="emit('verschiebe', zieht === label.id ? undefined : label.id)"
                                >
                                    {{
                                        zieht === label.id
                                            ? t("landschaftseditor.beschriftung.verschiebenEnde")
                                            : t("landschaftseditor.beschriftung.verschieben")
                                    }}
                                </AvmKnopf>
                                <template v-if="beschriftungen">
                                    <AvmKnopf
                                        v-if="detail.areas.length > 0"
                                        groesse="zeile"
                                        art="weich"
                                        :gesperrt="verschiebenGrund"
                                        :grund-bei="grundBei(verschiebenGrund)"
                                        :testid="`${kennung}-beschriftung-${i}-zuruecksetzen`"
                                        @click="bitteZuruecksetzen(label.id)"
                                    >
                                        {{ t("landschaftseditor.beschriftung.zuruecksetzen") }}
                                    </AvmKnopf>
                                    <AvmKnopf
                                        groesse="zeile"
                                        art="weich"
                                        :gesperrt="sofortGrund"
                                        :grund-bei="grundBei(sofortGrund)"
                                        :testid="`${kennung}-beschriftung-${i}-duplizieren`"
                                        @click="dupliziereBeschriftung(label.id)"
                                    >
                                        {{ t("landschaftseditor.beschriftung.duplizieren") }}
                                    </AvmKnopf>
                                    <AvmKnopf
                                        groesse="zeile"
                                        art="weich"
                                        :gesperrt="sofortGrund"
                                        :grund-bei="grundBei(sofortGrund)"
                                        :testid="`${kennung}-beschriftung-${i}-loeschen`"
                                        @click="bitteLoeschen(label.id)"
                                    >
                                        {{ t("landschaftseditor.beschriftung.loeschen") }}
                                    </AvmKnopf>
                                </template>
                            </div>
                            <FensterFeldzeilen v-else>
                                <dt>{{ t("landschaftseditor.feld.text") }}</dt>
                                <dd>{{ label.text }}</dd>
                                <dt>{{ t("landschaftseditor.feld.groesse") }}</dt>
                                <dd>{{ label.size === undefined ? "–" : formatNumber(label.size, 0) }}</dd>
                                <dt>{{ t("landschaftseditor.feld.prioritaet") }}</dt>
                                <dd>{{ label.priority ?? "–" }}</dd>
                                <dt>{{ t("landschaftseditor.feld.zoom") }}</dt>
                                <dd>{{ zoomText(label) }}</dd>
                                <dt>{{ t("landschaftseditor.feld.anzeigen") }}</dt>
                                <dd>{{ label.visible ? t("editorListe.ja") : t("editorListe.nein") }}</dd>
                            </FensterFeldzeilen>
                            <AvmBestaetigung
                                v-if="loeschWahl?.id === label.id"
                                :frage="loeschFrage(i)"
                                :bestaetigen="
                                    loeschWahl.letzte
                                        ? t('landschaftseditor.entfernen.knopf')
                                        : t('landschaftseditor.beschriftung.loeschenKnopf')
                                "
                                :gesperrt="sofortGrund"
                                :testid="`${kennung}-beschriftung-${i}-loeschfrage`"
                                @bestaetigen="loescheBeschriftung(label.id)"
                                @abbrechen="loeschWahl = undefined"
                            />
                            <AvmBestaetigung
                                v-if="zuruecksetzWahl === label.id"
                                :frage="t('landschaftseditor.beschriftung.zuruecksetzenFrage')"
                                :bestaetigen="t('landschaftseditor.beschriftung.zuruecksetzenKnopf')"
                                :gesperrt="verschiebenGrund"
                                :testid="`${kennung}-beschriftung-${i}-zuruecksetzfrage`"
                                @bestaetigen="setzeZurueck(label.id)"
                                @abbrechen="zuruecksetzWahl = undefined"
                            />
                        </section>
                        <div v-if="schreibt && beschriftungen" class="landschaftseditor__knoepfe">
                            <AvmKnopf
                                groesse="zeile"
                                art="weich"
                                :gesperrt="sofortGrund"
                                :grund-bei="grundBei(sofortGrund)"
                                :testid="`${kennung}-beschriftung-neu`"
                                @click="neueBeschriftung()"
                            >
                                {{ t("landschaftseditor.beschriftung.neu") }}
                            </AvmKnopf>
                        </div>
                        <p v-if="beschriftungFehler" class="landschaftseditor__leer" role="alert">
                            {{ beschriftungFehler }}
                        </p>
                    </template>
                </div>
            </template>
        </FensterSpalte>
        <template v-if="gipfel ?? bearbeitung" #fuss-hinweis>
            <EntwurfFuss :bearbeitung="(gipfel ?? bearbeitung)!" teil="hinweis" :testid="kennung" />
        </template>
        <template v-if="gipfel ?? bearbeitung" #fuss-haupt>
            <EntwurfFuss :bearbeitung="(gipfel ?? bearbeitung)!" teil="haupt" :testid="kennung" />
        </template>
    </AvmFenster>
</template>

<style scoped>
.landschaftseditor__name {
    display: grid;
    gap: var(--space-2);
}

.landschaftseditor__name strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.landschaftseditor__name small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.landschaftseditor__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.landschaftseditor__spalte--gebirge :deep(.fenster-spalte__inhalt) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.landschaftseditor__spalte--gebirge :deep(.fenster-spalte__inhalt > :not(.landschaftseditor__rumpf)) {
    flex: none;
}

.landschaftseditor__rumpf--gebirge {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
}

/* Wie die Abschnitte der Ortseigenschaften (`ortseditor-eigenschaften.vue`), bis O3 sie in einen Baustein zieht. */
.landschaftseditor__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.landschaftseditor__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.landschaftseditor__stand {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
}
.landschaftseditor__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}
/*
 * Kopf und Spanne in der Spalte des Felds, damit Zahlen und Zellen fluchten; ↺ in der Spalte von ↺. Die Zeile reicht darum über beide
 * Spalten der Feldkante (`fenster-feldzeile-raster.css`) und teilt sie genauso; das geht `FensterFeldzeilen` vor (`:slotted(dd)`, Spalte 2).
 */
.fenster-feldzeilen dd.landschaftseditor__spanne {
    display: grid;
    grid-column: 2 / -1;
    grid-template-columns: minmax(0, 1fr) var(--space-24);
    gap: calc(var(--space-2) / 2) var(--space-6);
    align-items: center;
}

/* Der Satz unter dem Merkmal (T41, wie am Ort): was „verborgen“ an einer Landschaft bewirkt. */
.landschaftseditor__merkmalsatz {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.landschaftseditor__spannentext {
    grid-column: 1 / -1;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.landschaftseditor__zahl {
    width: 100%;
}

.landschaftseditor__leer,
.landschaftseditor__fehler {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Der Hinweis unter der Gefahrenlage: die Marke „rot schraffiert“ vor dem Satz (WI-0308). */
.landschaftseditor__gefahrhinweis {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
}

/* Die Gefahrenlage im Lesen (WI-0308): in der Gefahrfarbe, wie im Feld der Mehrfachauswahl. */
.landschaftseditor__gefahr {
    color: var(--color-danger);
}

.landschaftseditor__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.landschaftseditor__verweis:hover {
    color: var(--color-link-hover);
}

/* « » wie im Ortseditor (`.ortseditor__listenschalter`), bis O3 ihn in einen Baustein zieht. */
.landschaftseditor__listenschalter {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-subhead);
    line-height: 1;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.landschaftseditor__listenschalter:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.landschaftseditor__listenschalter:active {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.landschaftseditor__listenschalter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* ☰ in der Leiste der Liste: die Fassung von Trichter und Sortierung (wie ✚ und Papierkorb im Ortseditor); gedrückt mit goldener Kante wie
   der Trichter mit gesetzten Filtern. */
.landschaftseditor__zeichenknopf {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    margin: 0 0 0 var(--space-4);
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.landschaftseditor__zeichenknopf:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.landschaftseditor__zeichenknopf[aria-pressed="true"] {
    border-color: var(--color-accent-strong);
    color: var(--color-text-strong);
}

.landschaftseditor__zeichenknopf:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}
</style>
