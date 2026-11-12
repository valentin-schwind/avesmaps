<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import GefahrMarke from "../gefahren/gefahr-marke.vue";
import { formatNumber, t } from "../i18n/i18n";
import { createListenEinstellung, type ListenEinstellung } from "./listen-einstellung";
import {
    alleAnhaken,
    alsMehrfachauswahl,
    ausschalten,
    einschalten,
    einschaltenMitBereich,
    klickeHaken,
    klickeKontext,
    ohneKontext,
    waehlbareReihe,
} from "./mehrfachauswahl";
import {
    berechne,
    fenster,
    naechsteWahl,
    ohneVerwaiste,
    vorhandeneWerte,
    rollenZu,
    type Kreis,
    type ListenOptionen,
    type ListenZeile,
} from "./liste-modell";

/**
 * Die Liste der Karteninhalte (WI-0128 E5; EDIT-0001 §4.2, §4.7 G2; WI-0126 §4.1; Blatt Fassung 3, „N1 Listenzeilen“): Legacys
 * Listendesign („das listendesign in legacy ist lange überlegt“, Betreiber), EIN Bauteil für jeden Karteninhalt. Die Daten macht
 * ein Adapter (`orte-liste.ts`), die Regeln das Modell (`liste-modell.ts`); hier steht nur, wie es aussieht und sich bedient.
 *
 * - **Kopf: die Leiste jeder Liste** (`AvmListenleiste`, Design Guide §13.45; Betreiber 2026-10-11): links die Suche, die den Rest
 *   der Zeile nimmt, rechtsbündig der Trichter (`AvmFilterknopf`, darin die Facetten und als Abschnitt „Arten“ die frühere Maske) und
 *   die Sortierung (`AvmMenueknopf` mit `AvmSortierzeichen`: Name A–Z, Ortsgröße Balken, Zustand ◐). Darunter die Bilanzzeile, wenn
 *   Suche oder Filter die Menge ändern.
 *   Keine Reiter über der Liste (Betreiber 2026-10-11): Was einer war, steht als Facette im Trichter, damit klar ist, dass alles
 *   zusammen filtert.
 * - **Zeile:** Name mit Kreis ○ ◐ ●, rechts die Art, darunter die Unterzeile (✓ gut, ⚠ Warnung, leise), unten rechts die Zahl der
 *   Bilder; die gewählte Zeile mit Fläche und Goldkante (Guide §13.12, drittes Aktivmittel).
 * - **Einstellung geteilt:** Suche, Filter, Sortierung und Maske kommen von außen, wenn mehrere Bauteile dieselbe Liste zeigen
 *   (`listen-einstellung.ts`): Jeder geöffnete Ort hat sein eigenes Fenster, die Einstellung bleibt.
 * - 🔴 **Bedienung** (EDIT-0001 D19, D17): Einfachklick wählt, Doppelklick und Enter öffnen (`oeffne`). Pfeile wählen ohne Flug,
 *   Pos1, Ende, Bild auf und ab. Eine Wahl von außen (Karte) rollt die Liste dorthin, ohne die Seite zu bewegen (D14).
 * - **Viele Zeilen:** Gezeichnet wird nur, was sichtbar ist (feste Zeilenhöhe, `fenster`); 9.000 Zeilen bleiben flüssig.
 * - **Legende und Zählung in EINER Zeile unter der Liste** (WI-0187; EDIT-0003 T26 (5); Betreiber 2026-10-16, wörtlich: „ich wollte
 *   dass du die legende mit der zählung kombinierst. z.B. beim Ortseditor statt Oben: ● 13 · ◐ 18 · ○ 0 nur Unten: platziert und dem
 *   Wiki zugewiesen ● 13 · nur im Wiki, nicht platziert ◐ 18 · platziert, ohne Wiki-Artikel ◑ 0 - nicht platziert, ohne Wiki-Artikel
 *   ○ 0“): je Zustand Name, Kreis und Zahl der Treffer, leise und klein. Oben steht nur noch „N Treffer“, wenn Suche, Trichter oder
 *   Maske die Liste ändern. Welche Zustände eine Liste kennt und wie sie heißen, sagt die Liste (`legende`).
 * - **Mehrfachauswahl** (EDIT-0003 T57, additiv; Fassung 5 der Gebiete, Betreiber 2026-10-19: „perfekt genau das wollen wir“): Wer
 *   `v-model:mehrfach` bindet, bekommt den Umschalter ☑ „Mehrfachauswahl“ in der Leiste vor dem Trichter, Vorgabe aus. An stehen
 *   Häkchen an den Zeilen (`v-model:angehakt`): Ein Klick hakt an oder ab, Umschalt-Klick einen Bereich, Strg+A alle; die Zeile darunter
 *   sagt „n angehakt“ mit „Alle N“ und „✕ Haken lösen“. `gewaehlt` bleibt die zuletzt angeklickte Zeile; beim Ausschalten bleibt sie
 *   allein gewählt. Ein Klick meldet dann nicht `klick` (kein Öffnen am Ort, D19). Rechnung: `mehrfachauswahl.ts`, Felder:
 *   `fenster/sammel.ts`. 🔴 Zeilen, die der Baum bei Suche oder Filter nur als Kontext eines Treffers zeigt (`zusammenhang`), sind nie
 *   wählbar: „Alle N“, Strg+A und der Umschalt-Bereich zählen nur Treffer, ein Klick hakt sie nicht an (Doppelklick und Einzelwahl
 *   außerhalb der Mehrfachauswahl öffnen sie wie bisher).
 * - **Ablegen auf eine Zeile** (`ablegen`, WI-0209 D1, additiv): Zeilen lassen sich auf andere Zeilen ziehen; beim Überfahren steht
 *   „hierher“ oder der Satz, warum nicht. Ohne die Angabe bleibt alles wie zuvor, auch das Ziehen auf die Karte (E16).
 */
const props = defineProps<{
    zeilen: readonly ListenZeile[];
    /**
     * Ein Vorfilter vor Suche und Trichter (WI-0178: die Ebene der Karte in der Derographie), ohne eigene Bilanz. Das Abwählen verwaister
     * Trichterwerte misst trotzdem an ALLEN Zeilen: Sonst wählte eine Ebene ohne „Nicht auf der Karte“ diesen Wert still ab, und nach dem
     * Wechsel der Ebene fehlten solche Flächen (Fund 2026-10-19, „Bragenauer Aue“).
     */
    vorfilter?: ((zeile: ListenZeile) => boolean) | undefined;
    optionen: ListenOptionen;
    facettenName: (id: string) => string;
    wertName: (facette: string, wert: string) => string;
    sortierungen: readonly { wert: string; text: string }[];
    masken?:
        readonly { wert: string; text: string; passt: ((zeile: ListenZeile) => boolean) | undefined }[] | undefined;
    /** Der Titel der einen Wahl im Trichter; ohne Angabe „Arten“ (`editorListe.maske`), in der Derographie „Objekte“ (WI-0271 L4). */
    maskenTitel?: string | undefined;
    legende: Partial<Record<Kreis, string>>;
    /** Der Satz, wenn Suche und Filter nichts übrig lassen; ohne Angabe der der Ortsliste (WI-0178: die Landschaften sagen ihren). */
    leerText?: string | undefined;
    kennung: string;
    beschriftung: string;
    /** Suche, Filter, Sortierung und Maske, geteilt mit anderen Bauteilen derselben Liste; ohne eigene. */
    einstellung?: ListenEinstellung | undefined;
    /** Welche Zeilen sich auf die Karte ziehen lassen, und unter welchem Typ sie ihren Schlüssel tragen (E16). */
    ziehen?: { typ: string; darf: (key: string) => boolean } | undefined;
    /**
     * Eine Zeile auf eine andere ziehen (WI-0209 D1, Umhängen im Baum): `darf` sagt je Ziel und gezogener Zeile `true` oder den Satz,
     * warum nicht; `hierher` ist der Satz für ein erlaubtes Ziel; `ab` bekommt den Wurf. Ohne Angabe ist keine Zeile ein Ziel.
     */
    ablegen?:
        | {
              typ: string;
              hierher: string;
              darf: (ziel: string, quelle: string) => true | string;
              ab: (ziel: string, quelle: string) => void;
          }
        | undefined;
}>();
const gewaehlt = defineModel<string | undefined>("gewaehlt", { default: undefined });
/** Die Mehrfachauswahl (T57): an, aus, oder `undefined` (ohne Umschalter, wer sie nicht bindet). */
const mehrfach = defineModel<boolean | undefined>("mehrfach", { default: undefined });
/** Die angehakten Zeilen, solange die Mehrfachauswahl an ist. */
const angehakt = defineModel<readonly string[]>("angehakt", { default: () => [] });
const emit = defineEmits<{
    /** Doppelklick und Enter. */
    oeffne: [key: string];
    /** Ein Klick auf eine Zeile (wählt sie auch); der Ortseditor öffnet den Ort damit an der Stelle seines Fensters (D19). */
    klick: [key: string];
}>();

const { suche, filter, sortierung, maske, oben } =
    props.einstellung ??
    createListenEinstellung({
        vorbelegt: props.optionen.vorbelegt,
        sortierung: props.sortierungen[0]?.wert ?? "name",
        maske: props.masken?.[0]?.wert ?? "",
    });
const offen = shallowRef(new Set<string>());

const ergebnis = computed(() =>
    berechne(
        props.vorfilter === undefined ? props.zeilen : props.zeilen.filter(props.vorfilter),
        {
            suche: suche.value,
            filter: filter.value,
            sortierung: sortierung.value,
            maske: props.masken?.find((m) => m.wert === maske.value)?.passt,
            offen: offen.value,
        },
        props.optionen,
    ),
);

// Ein gewählter Wert, den es in den Zeilen nicht (mehr) gibt, filtert nicht unsichtbar weiter (Legacy `wikiSyncPruneFacetState`).
// Gemessen an allen Zeilen, nicht an Suche oder Filter: Eine Suche, die eine Facette kurz leert, nimmt die Wahl nicht mit. Sofort,
// sobald Zeilen da sind, nicht beim nächsten Neuberechnen: Sonst spränge die Liste später unter dem Zeiger (gefunden 2026-10-11).
watch(
    () => vorhandeneWerte(props.zeilen, props.optionen.facetten),
    (werte) => {
        if (props.zeilen.length === 0) return;
        const bereinigt = ohneVerwaiste(filter.value, werte);
        const vorher = [...filter.value.values()].reduce((summe, werte) => summe + werte.size, 0);
        const nachher = [...bereinigt.values()].reduce((summe, werte) => summe + werte.size, 0);
        if (nachher !== vorher) filter.value = bereinigt;
    },
    { immediate: true },
);

// --- Der Trichter: die Facetten (mehrere Werte) und die Arten (eine Wahl, „alle“ zuerst), die frühere Maske ---
const MASKE = "maske";
const ersteMaske = computed(() => props.masken?.[0]?.wert);
const filterAbschnitte = computed<FilterAbschnitt[]>(() => {
    const facetten: FilterAbschnitt[] = props.optionen.facetten.map((id) => ({
        id,
        titel: props.facettenName(id),
        art: "mehrere",
        werte: (ergebnis.value.facettenOptionen[id] ?? []).map((option) => ({
            wert: option.wert,
            text: props.wertName(id, option.wert),
            zahl: option.zahl,
        })),
    }));
    if (!props.masken) return facetten;
    const arten: FilterAbschnitt = {
        id: MASKE,
        titel: props.maskenTitel ?? t("editorListe.maske"),
        art: "eins",
        werte: props.masken.slice(1).map((m) => ({ wert: m.wert, text: m.text })),
    };
    // „Auf der Karte“ bleibt die erste Facette (Betreiber 2026-10-11); die Arten gleich danach.
    return [...facetten.slice(0, 1), arten, ...facetten.slice(1)];
});
const filterWahl = computed<FilterWahl>(() => ({
    ...Object.fromEntries([...filter.value].map(([id, werte]) => [id, [...werte]])),
    ...(props.masken && maske.value !== ersteMaske.value ? { [MASKE]: [maske.value] } : {}),
}));
function setzeAbschnitt(id: string, werte: string[]): void {
    if (id === MASKE) {
        maske.value = werte[0] ?? ersteMaske.value ?? maske.value;
        return;
    }
    const neu = new Map(filter.value);
    if (werte.length > 0) neu.set(id, new Set(werte));
    else neu.delete(id);
    filter.value = neu;
}
/** „Filter lösen“: die Facetten und die Arten. */
function loesen(): void {
    filter.value = new Map();
    if (ersteMaske.value !== undefined) maske.value = ersteMaske.value;
}

// --- Die Sortierung: der Menüknopf mit dem Zeichen der Ordnung ---
type SortierArt = "name" | "menge" | "zustand" | "zeit" | "art";
const SORTIER_ART: Readonly<Record<string, SortierArt>> = {
    name: "name",
    groesse: "menge",
    // Die Sprachen nach Fläche, größte zuerst (WI-0261 S5d2): dasselbe Zeichen wie die Ortsgröße.
    flaeche: "menge",
    kreis: "zustand",
    // Das Wetter (WI-0288 Stufe 3): „Kalender und Anlage“ mit der Uhr, „Art“ mit den drei Formen, wie in der Probierseite.
    kalender: "zeit",
    art: "art",
};
const sortierArt = (wert: string): SortierArt => SORTIER_ART[wert] ?? "name";
const sortierName = computed(
    () => props.sortierungen.find((option) => option.wert === sortierung.value)?.text ?? sortierung.value,
);

// --- Das virtuelle Fenster ---

/** Eine Zeile misst zwei Textzeilen samt Polster (Legacy-Liste 46 px). */
const HOEHE = 46;
const rumpf = useTemplateRef<HTMLDivElement>("rumpf");
const scrollTop = ref(0);
const sichtHoehe = ref(0);
const listeId = useId();
const zeileId = (key: string): string => `${listeId}-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

const darstellung = computed(() => ergebnis.value.darstellung);
const bereich = computed(() => fenster(darstellung.value.length, HOEHE, scrollTop.value, sichtHoehe.value));
const sichtbar = computed(() =>
    darstellung.value
        .slice(bereich.value.anfang, bereich.value.ende)
        .map((zeile, i) => ({ zeile, index: bereich.value.anfang + i })),
);

/** War der Rumpf beim letzten Messen gezeichnet? Ein eben eingehängtes oder abgelegtes Fenster ist zu (Höhe 0). */
let warSichtbar = false;

function messen(): void {
    if (!rumpf.value) return;
    const sichtbarJetzt = rumpf.value.clientHeight > 0;
    // 🔴 Jedes Mal, wenn die Liste (wieder) zu sehen ist, steht sie, wo die Liste zuletzt stand: Ein Klick öffnet den Ort in einem neuen
    // Fenster oder holt sein abgelegtes zurück (D19), und dessen Liste stand woanders. Ohne das „springt sie nach der Auswahl“
    // (Betreiber 2026-10-11). Zur Wahl rollt sie nur, wenn die dort nicht zu sehen ist.
    if (sichtbarJetzt && !warSichtbar) {
        if (rumpf.value.scrollTop !== oben.value) rumpf.value.scrollTop = oben.value;
        void zurWahl();
    }
    warSichtbar = sichtbarJetzt;
    scrollTop.value = rumpf.value.scrollTop;
    sichtHoehe.value = rumpf.value.clientHeight;
}

/** Gerollt: messen und die Lage für die nächste sichtbare Liste derselben Art merken (nur, solange diese gezeichnet ist). */
function gerollt(): void {
    messen();
    if (rumpf.value && warSichtbar) oben.value = rumpf.value.scrollTop;
}
let beobachter: ResizeObserver | undefined;
onMounted(() => {
    messen();
    beobachter = new ResizeObserver(messen);
    if (rumpf.value) beobachter.observe(rumpf.value);
});
onBeforeUnmount(() => beobachter?.disconnect());

/** Rollt zur gewählten Zeile, wenn sie nicht ganz sichtbar ist - nur den Rumpf, nie die Seite. */
async function zurWahl(): Promise<void> {
    await nextTick();
    const index = darstellung.value.findIndex((zeile) => zeile.key === gewaehlt.value);
    if (index < 0 || !rumpf.value) return;
    const ziel = rollenZu(index, HOEHE, rumpf.value.scrollTop, rumpf.value.clientHeight);
    if (ziel !== undefined) {
        rumpf.value.scrollTop = ziel;
        messen();
    }
}
watch(gewaehlt, () => void zurWahl());
// Eine Suche oder ein Filter beginnt oben; die Wahl bleibt, wenn sie noch da ist.
watch([suche, filter, sortierung, maske], () => {
    if (rumpf.value) rumpf.value.scrollTop = 0;
    messen();
    void zurWahl();
});

function waehle(key: string): void {
    gewaehlt.value = key;
}

/**
 * Eine Zeile wird gezogen: Sie trägt ihren Schlüssel; die Karte nimmt ihn an (`map/place-set.ts`). Mit `ablegen` trägt sie ihn auch
 * unter dessen Typ, und die Liste merkt sich, welche Zeile unterwegs ist (beim Überfahren ist der Inhalt des Zugs nicht lesbar).
 */
function ziehStart(event: DragEvent, key: string): void {
    const aufKarte = props.ziehen?.darf(key) === true;
    if ((!aufKarte && props.ablegen === undefined) || !event.dataTransfer) {
        event.preventDefault();
        return;
    }
    if (aufKarte) event.dataTransfer.setData(props.ziehen!.typ, key);
    if (props.ablegen !== undefined) {
        event.dataTransfer.setData(props.ablegen.typ, key);
        unterwegs = { typ: props.ablegen.typ, key };
    }
    event.dataTransfer.effectAllowed =
        aufKarte && props.ablegen !== undefined ? "copyMove" : aufKarte ? "copy" : "move";
}

// --- Ablegen auf eine Zeile (`ablegen`) ---
/** Die Zeile, die gerade gezogen wird, und das Ziel unter dem Zeiger mit seinem Urteil. */
let unterwegs: { typ: string; key: string } | undefined;
const ablage = ref<{ ziel: string; satz: string; geht: boolean } | undefined>(undefined);
function ziehUeber(event: DragEvent, ziel: string): void {
    const ab = props.ablegen;
    if (ab === undefined || unterwegs?.typ !== ab.typ) return;
    const urteil = ab.darf(ziel, unterwegs.key);
    ablage.value = { ziel, satz: urteil === true ? ab.hierher : urteil, geht: urteil === true };
    if (urteil !== true) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
/** Erst wenn der Zeiger die Zeile ganz verlässt (nicht beim Wechsel zwischen ihren Teilen). */
function ziehWeg(event: DragEvent, ziel: string): void {
    const zeile = event.currentTarget as HTMLElement | null;
    if (zeile !== null && event.relatedTarget instanceof Node && zeile.contains(event.relatedTarget)) return;
    if (ablage.value?.ziel === ziel) ablage.value = undefined;
}
function abgelegt(event: DragEvent, ziel: string): void {
    const ab = props.ablegen;
    const quelle = unterwegs?.key;
    ablage.value = undefined;
    unterwegs = undefined;
    if (ab === undefined || quelle === undefined || ab.darf(ziel, quelle) !== true) return;
    event.preventDefault();
    ab.ab(ziel, quelle);
}
function ziehEnde(): void {
    unterwegs = undefined;
    ablage.value = undefined;
}

/**
 * Die Schlüssel der wählbaren Zeilen in der Folge der Liste: die Reihe für Umschalt-Klick, Strg+A und „Alle N“ (samt Zahl).
 * 🔴 Nur echte Treffer: Die Vorfahren, die der Baum bei Suche oder Filter als Kontext zeigt (`zusammenhang`), sind nie wählbar
 * (Fund 2026-10-25: „Alle n“ hakte sie mit an, und das Entfernen löschte am 20.10. Thorwal und Orkreich mit).
 */
const reihe = computed(() => waehlbareReihe(darstellung.value));
function klick(key: string, event?: MouseEvent): void {
    const zeile = darstellung.value.find((x) => x.key === key);
    const kontext = zeile?.art === "zeile" && zeile.zusammenhang === true;
    if (mehrfach.value === true && zeile?.art === "zeile") {
        alsMehrfachauswahl(() => {
            angehakt.value = kontext
                ? klickeKontext(angehakt.value, key)
                : klickeHaken(
                      { angehakt: angehakt.value, anker: gewaehlt.value },
                      key,
                      event?.shiftKey === true,
                      reihe.value,
                  ).angehakt;
            waehle(key);
        });
        return;
    }
    // Umschalt-Klick schaltet die Mehrfachauswahl selbst ein und hakt den Bereich an (die Häkchen zuerst, wie beim Umschalter). Gewählt
    // bleibt, was es war: Ein gemeldetes Wählen legte sonst das Fenster ab, bevor die Mehrfachauswahl steht. Eine Kontext-Zeile
    // schaltet nichts ein: Sie wählt und öffnet wie ein Klick ohne Umschalt.
    if (mehrfach.value === false && event?.shiftKey === true && zeile?.art === "zeile" && !kontext) {
        alsMehrfachauswahl(() => {
            angehakt.value = einschaltenMitBereich(ohneKontext(gewaehlt.value, darstellung.value), key, reihe.value);
            mehrfach.value = true;
        });
        return;
    }
    // Gruppen als Abschnitte (WI-0288 Stufe 3): Der Kopf klappt, er wählt nichts.
    if (zeile?.art === "gruppe" && props.optionen.gruppenAlsAbschnitte === true) {
        umklappen(key);
        return;
    }
    waehle(key);
    emit("klick", key);
}
/**
 * Bleibt in der Mehrfachauswahl genau eines angehakt, zeigt das Fenster dieses eine wie bei der Einzelauswahl (Regel 7, ein Verhalten
 * für alle Editoren; Editor-Orchestrierung 2026-10-20): Hakt man auf eines herunter ab, meldet die Liste es als `klick`, gleich wodurch
 * (Haken, Umschalt-Klick auf der Karte). Das Fenster übernimmt es selbst, die Häkchen bleiben (`oeffneAnStelle` in einem Handgriff der Mehrfachauswahl).
 */
watch(
    () => (mehrfach.value === true ? angehakt.value : []),
    (jetzt, vorher) => {
        // Nur beim Herunterhaken (zwei oder mehr auf eins): Das erste Häkchen wählt nichts, sonst stellte die Wahl Ansicht oder Ebene um.
        const key = jetzt.length === 1 && vorher.length >= 2 ? jetzt[0] : undefined;
        if (key !== undefined) alsMehrfachauswahl(() => emit("klick", key));
    },
);
/** Der Umschalter: an die Häkchen (die Wahl ist das erste), aus bleibt die zuletzt angeklickte Zeile allein gewählt. */
function schalteMehrfach(): void {
    if (mehrfach.value === true) {
        const bleibt = ausschalten(angehakt.value, gewaehlt.value);
        alsMehrfachauswahl(() => {
            angehakt.value = [];
            mehrfach.value = false;
            if (bleibt[0] !== undefined && bleibt[0] !== gewaehlt.value) {
                waehle(bleibt[0]);
                emit("klick", bleibt[0]);
            }
        });
        return;
    }
    // Eine nur als Kontext gezeigte Zeile wird nicht das erste Häkchen.
    angehakt.value = einschalten(ohneKontext(gewaehlt.value, darstellung.value));
    mehrfach.value = true;
}
function alleHaken(): void {
    alsMehrfachauswahl(() => (angehakt.value = alleAnhaken(angehakt.value, reihe.value)));
}
function hakenLoesen(): void {
    alsMehrfachauswahl(() => (angehakt.value = []));
}

function umklappen(key: string): void {
    const neu = new Set(offen.value);
    if (neu.has(key)) neu.delete(key);
    else neu.add(key);
    offen.value = neu;
}

function taste(event: KeyboardEvent): void {
    if (mehrfach.value === true && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        alleHaken();
        return;
    }
    if (event.key === "Enter" && gewaehlt.value !== undefined) {
        event.preventDefault();
        emit("oeffne", gewaehlt.value);
        return;
    }
    const zeile = darstellung.value.find((x) => x.key === gewaehlt.value);
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && zeile !== undefined) {
        const klappbar = zeile.art === "gruppe" || (zeile.kinder ?? 0) > 0;
        const auf = zeile.art === "gruppe" ? zeile.offen : zeile.offen === true;
        if (klappbar && auf === (event.key === "ArrowLeft")) {
            event.preventDefault();
            umklappen(zeile.key);
        }
        return;
    }
    const seite = Math.max(1, Math.floor(sichtHoehe.value / HOEHE) - 1);
    const naechste = naechsteWahl(darstellung.value, gewaehlt.value, event.key, seite);
    if (naechste === undefined) return;
    event.preventDefault();
    waehle(naechste);
}

/** Der Name eines Kreises, wie die Liste ihn nennt; Folge und Auswahl der Legende regelt `AvmKreisLegende`. */
const kreisName = (kreis: Kreis): string => props.legende[kreis] ?? "";
</script>

<template>
    <div class="liste" :data-testid="kennung">
        <AvmListenleiste
            v-model="suche"
            class="liste__zeile"
            :platzhalter="t('editorListe.suche.platzhalter')"
            :beschriftung="t('editorListe.suche')"
            :testid="`${kennung}-leiste`"
        >
            <button
                v-if="mehrfach !== undefined"
                type="button"
                class="liste__mehrfach"
                :aria-pressed="mehrfach"
                :aria-label="t('editorListe.mehrfach')"
                :title="t('editorListe.mehrfachTitel')"
                :data-testid="`${kennung}-mehrfach`"
                @click="schalteMehrfach"
            >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <rect x="1.5" y="2" width="5" height="5" rx="1" />
                    <path d="m2.8 4.4 1 1 1.6-2" />
                    <rect x="1.5" y="9" width="5" height="5" rx="1" />
                    <path d="M9 4.5h5.5M9 11.5h5.5" />
                </svg>
            </button>
            <AvmFilterknopf
                :abschnitte="filterAbschnitte"
                :wahl="filterWahl"
                :testid="`${kennung}-filter`"
                @setze="setzeAbschnitt"
                @loesen="loesen"
            />
            <AvmMenueknopf
                v-model="sortierung"
                :optionen="sortierungen"
                :bezeichnung="t('editorListe.sortierung.knopf', { wahl: sortierName })"
                :menue-bezeichnung="t('editorListe.sortierung')"
                :testid="`${kennung}-sortierung`"
            >
                <template #zeichen="{ wert }"><AvmSortierzeichen :art="sortierArt(wert)" /></template>
            </AvmMenueknopf>
            <!-- Handlungen des Fensters nach Trichter und Sortierung, etwa ✚ und Papierkorb im Ortseditor (WI-0183). -->
            <slot name="zeichen" />
        </AvmListenleiste>
        <p v-if="ergebnis.bilanz.zeigen" class="liste__bilanz" :data-testid="`${kennung}-bilanz`">
            {{ t("editorListe.bilanz", { n: formatNumber(ergebnis.bilanz.treffer, 0) }) }}
        </p>
        <p v-if="mehrfach === true" class="liste__haken-zeile" :data-testid="`${kennung}-haken`">
            <span>{{
                angehakt.length === 0
                    ? t("editorListe.nichtsAngehakt")
                    : t("editorListe.angehakt", { n: formatNumber(angehakt.length, 0) })
            }}</span>
            <span class="liste__haken-knoepfe">
                <button type="button" class="liste__haken-knopf" :data-testid="`${kennung}-alle`" @click="alleHaken">
                    {{ t("editorListe.alleAnhaken", { n: formatNumber(reihe.length, 0) }) }}
                </button>
                <button
                    v-if="angehakt.length > 0"
                    type="button"
                    class="liste__haken-knopf"
                    :data-testid="`${kennung}-haken-loesen`"
                    @click="hakenLoesen"
                >
                    {{ t("editorListe.hakenLoesen") }}
                </button>
            </span>
        </p>
        <slot name="hinweis" />
        <div
            ref="rumpf"
            class="liste__rumpf"
            role="listbox"
            tabindex="0"
            :aria-label="beschriftung"
            :aria-activedescendant="gewaehlt !== undefined ? zeileId(gewaehlt) : undefined"
            :data-testid="`${kennung}-rumpf`"
            @scroll="gerollt"
            @keydown="taste"
        >
            <div class="liste__raum" :style="{ height: `${String(darstellung.length * HOEHE)}px` }">
                <div
                    v-for="{ zeile, index } in sichtbar"
                    :id="zeileId(zeile.key)"
                    :key="zeile.key"
                    class="liste__eintrag"
                    :class="{
                        'is-gewaehlt': mehrfach === true ? angehakt.includes(zeile.key) : zeile.key === gewaehlt,
                        'is-gruppe': zeile.art === 'gruppe',
                        'is-zusammenhang': zeile.art === 'zeile' && zeile.zusammenhang,
                    }"
                    role="option"
                    :aria-selected="mehrfach === true ? angehakt.includes(zeile.key) : zeile.key === gewaehlt"
                    :data-key="zeile.key"
                    :data-testid="`${kennung}-zeile`"
                    :style="{
                        transform: `translateY(${String(index * HOEHE)}px)`,
                        '--tiefe': zeile.art === 'zeile' ? zeile.tiefe : 0,
                    }"
                    :draggable="
                        ziehen?.darf(zeile.key) === true || (ablegen && zeile.art === 'zeile') ? 'true' : undefined
                    "
                    :data-ziehbar="ziehen?.darf(zeile.key) === true ? '' : undefined"
                    :data-ablage="ablage?.ziel === zeile.key ? (ablage.geht ? 'ja' : 'nein') : undefined"
                    @click="klick(zeile.key, $event)"
                    @dblclick="emit('oeffne', zeile.key)"
                    @dragstart="ziehStart($event, zeile.key)"
                    @dragover="ziehUeber($event, zeile.key)"
                    @dragleave="ziehWeg($event, zeile.key)"
                    @drop="abgelegt($event, zeile.key)"
                    @dragend="ziehEnde"
                >
                    <span
                        v-if="ablage?.ziel === zeile.key"
                        class="liste__ablage"
                        role="status"
                        :data-testid="`${kennung}-ablage`"
                        >{{ ablage.satz }}</span
                    >
                    <button
                        v-if="zeile.art === 'gruppe' || (zeile.kinder ?? 0) > 0"
                        type="button"
                        class="liste__klappe"
                        tabindex="-1"
                        :aria-expanded="zeile.art === 'gruppe' ? zeile.offen : zeile.offen === true"
                        @click.stop="umklappen(zeile.key)"
                        @dblclick.stop
                    >
                        <span aria-hidden="true">›</span>
                    </button>
                    <template v-if="zeile.art === 'gruppe'">
                        <span class="liste__name">
                            <span class="liste__text einzeilig">{{ zeile.name }}</span>
                            <AvmKreis
                                v-if="optionen.gruppenAlsAbschnitte !== true"
                                :fuellung="zeile.kreis"
                                :name="kreisName(zeile.kreis)"
                            />
                        </span>
                        <span class="liste__rechts">{{ zeile.glieder.length }}</span>
                    </template>
                    <template v-else>
                        <!-- Was man auf die Karte ziehen kann, trägt den Griff des Hauses (⠿, Design Guide „Die Listenzeile als Raster“;
                             Betreiber 2026-10-11: „die auf die karte gedraggt werden können … sollen unser 6-punkt-drag-symbol erhalten“). -->
                        <span
                            v-if="ziehen?.darf(zeile.key) === true && !(zeile.kinder ?? 0)"
                            class="liste__griff"
                            aria-hidden="true"
                            :data-testid="`${kennung}-zeile-griff`"
                        ></span>
                        <!-- Ein Zeichen statt eines Bilds (WI-0288 Stufe 3: die Art eines Wetter-Icons, die Uhr eines Presets). -->
                        <span
                            v-else-if="zeile.zeile.vorzeichen && !(zeile.kinder ?? 0)"
                            class="liste__bild liste__bild--zeichen"
                            aria-hidden="true"
                            :data-testid="`${kennung}-zeile-vorzeichen`"
                            ><EditorZeichen :name="zeile.zeile.vorzeichen"
                        /></span>
                        <span
                            v-else-if="zeile.zeile.bild && !(zeile.kinder ?? 0)"
                            class="liste__bild"
                            :class="{ 'liste__bild--leer': !zeile.zeile.bild.url }"
                            :data-testid="`${kennung}-zeile-bild`"
                        >
                            <img
                                v-if="zeile.zeile.bild.url"
                                :src="zeile.zeile.bild.url"
                                alt=""
                                loading="lazy"
                                draggable="false"
                            />
                        </span>
                        <span class="liste__name">
                            <span
                                v-if="mehrfach === true"
                                class="liste__haken"
                                :class="{
                                    'is-an': angehakt.includes(zeile.key),
                                    'is-kontext': zeile.zusammenhang === true && !angehakt.includes(zeile.key),
                                }"
                                aria-hidden="true"
                                :data-testid="`${kennung}-zeile-haken`"
                            ></span>
                            <!-- Der Farbpunkt einer Zeile (WI-0261 S5d2: die Farbe der Sprache), vor dem Namen. -->
                            <span
                                v-if="zeile.zeile.farbe"
                                class="liste__farbe"
                                :style="{ '--farbe': zeile.zeile.farbe }"
                                aria-hidden="true"
                                :data-testid="`${kennung}-zeile-farbe`"
                            ></span>
                            <span class="liste__text einzeilig">{{ zeile.zeile.name }}</span>
                            <span
                                v-if="zeile.zeile.zeichen"
                                class="liste__zeichen"
                                :title="zeile.zeile.zeichen.titel"
                                :data-testid="`${kennung}-zeile-zeichen`"
                                ><EditorZeichen :name="zeile.zeile.zeichen.name"
                            /></span>
                            <AvmKreis :fuellung="zeile.zeile.kreis" :name="kreisName(zeile.zeile.kreis)" />
                        </span>
                        <span v-if="zeile.zeile.rechts" class="liste__rechts">{{ zeile.zeile.rechts }}</span>
                        <span
                            v-if="zeile.zeile.unter"
                            class="liste__unter einzeilig"
                            :class="`liste__unter--${zeile.zeile.unter.ton}`"
                            >{{ zeile.zeile.unter.text }}</span
                        >
                        <span
                            v-if="zeile.zeile.gefahr"
                            class="liste__gefahr einzeilig"
                            :data-testid="`${kennung}-zeile-gefahr`"
                            >{{ zeile.zeile.gefahr.text }}</span
                        >
                        <GefahrMarke v-if="zeile.zeile.gefahr" class="liste__schraffur" />
                        <span
                            v-if="zeile.zeile.bilder"
                            class="liste__bilder"
                            :title="
                                zeile.zeile.bilder === 1
                                    ? t('editorListe.bild')
                                    : t('editorListe.bilder', { n: zeile.zeile.bilder })
                            "
                            >▣ {{ zeile.zeile.bilder }}</span
                        >
                    </template>
                </div>
            </div>
            <p v-if="darstellung.length === 0" class="liste__leer" :data-testid="`${kennung}-leer`">
                {{ leerText ?? t("editorListe.leer") }}
            </p>
        </div>
        <!-- Legende und Zählung in einer Zeile (WI-0187): je Zustand Name, Kreis und Zahl, dasselbe Bauteil wie im Editorpanel. Eine Liste,
             deren Kreis je Gruppe etwas anderes zählt (das Wetter, WI-0288 Stufe 3), bringt ihre Legenden im Slot `legende` selbst. -->
        <slot name="legende">
            <AvmKreisLegende
                class="liste__legende"
                :namen="legende"
                :zahlen="ergebnis.bilanz"
                :beschriftung="t('editorListe.liste')"
                :testid="`${kennung}-legende`"
            />
        </slot>
    </div>
</template>

<style scoped>
/*
 * Maße aus dem Blatt Fassung 3 („Orte“ im Ortseditor, „N1 Listenzeilen“) und Legacys Liste (`css/features/review-panel.css`),
 * Werte nur aus dem Kanon. Die Liste füllt ihre Spalte; nur der Rumpf rollt (Guide §10: Kopf steht, nur der Rumpf läuft).
 */
.liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-height: 0;
    height: 100%;
}

/* Der Umschalter „Mehrfachauswahl“ (T57) in der Form des Trichters; an steht er dunkel wie ein gedrückter Knopf. */
.liste__mehrfach {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: var(--avm-control-h);
    min-height: var(--avm-control-h);
    margin: 0;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
}

.liste__mehrfach svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
}

.liste__mehrfach:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.liste__mehrfach[aria-pressed="true"] {
    border-color: var(--color-button);
    background-color: var(--color-button);
    background-image: none;
    color: var(--color-button-text);
}

.liste__mehrfach:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.liste__haken-zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    margin: 0;
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.liste__haken-knoepfe {
    display: flex;
    gap: var(--space-4);
    margin-left: auto;
}

.liste__haken-knopf {
    min-height: 24px;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-sm);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
}

.liste__haken-knopf:hover {
    background: var(--color-button-soft-hover);
}

/* Das Häkchen vor dem Namen: ein Kästchen, angehakt dunkel mit ✓. */
.liste__haken {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    border: 1.5px solid var(--color-button-soft-border);
    border-radius: 4px;
    background: var(--color-panel);
    color: var(--color-button-text);
    font-size: 11px;
    line-height: 1;
}

.liste__haken.is-an {
    border-color: var(--color-button);
    background: var(--color-button);
}

.liste__haken.is-an::before {
    content: "✓" / "";
}

/* Eine Kontext-Zeile (Vorfahr eines Treffers) lässt sich nie anhaken: das Kästchen bleibt als Platz, aber unsichtbar. */
.liste__haken.is-kontext {
    visibility: hidden;
}

.liste__bilanz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.liste__rumpf {
    position: relative;
    flex: 1 1 auto;
    min-height: 120px;
    overflow-x: hidden;
    overflow-y: auto;
    border-top: 1px solid var(--color-divider);
    outline: none;
}

.liste__rumpf:focus-visible {
    box-shadow: inset var(--focus-ring);
}

.liste__raum {
    position: relative;
}

/* Eine Zeile: Name mit Kreis links, Art rechts; darunter die Unterzeile, unten rechts die Bilder (Blatt N1). */
.liste__eintrag {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    column-gap: var(--space-6);
    align-content: center;
    box-sizing: border-box;
    height: 46px;
    padding: 0 var(--space-8) 0 calc(var(--space-8) + var(--tiefe) * var(--space-16));
    /*
     * EINE Form für Ruhe, Zeigen und Wahl (Betreiber 2026-10-11: „das hover hat einen andere border-style wie die selektion“; Legacy
     * „entweder karte oder trennlinie“, also kein Radius in der Trennlinienliste). Gezeigt färbt sich die Fläche, gewählt eine kräftigere.
     * 🔴 Kein linker Balken in den Listen der Editoren (WI-0184; Betreiber 2026-10-16: „erstmal nur in den editor listen, z.b. in der
     * systemsteuerung find ichs super“, Ausnahme zu Guide §13.12). Der Rand bleibt durchsichtig stehen, damit beim Wählen nichts springt.
     */
    border: 0 solid transparent;
    border-bottom: 1px solid var(--color-divider);
    border-left: var(--avm-fenster-schiene-kante) solid transparent;
    border-radius: 0;
    color: var(--color-text);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.liste__eintrag:hover {
    background: var(--color-hover-wash);
}

/* Ein Ziel beim Ablegen (`ablegen`): erlaubt mit der Fläche der Wahl, verwehrt mit gestrichelter Kante; der Satz steht in der Zeile. */
.liste__eintrag[data-ablage="ja"] {
    background: var(--color-active-wash);
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
}

.liste__eintrag[data-ablage="nein"] {
    outline: 1px dashed var(--color-border-strong);
    outline-offset: -1px;
}

.liste__ablage {
    position: absolute;
    top: 2px;
    right: var(--space-8);
    z-index: 1;
    max-width: 70%;
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    pointer-events: none;
}

.liste__eintrag[data-ablage="ja"] .liste__ablage {
    color: var(--color-accent-strong);
}

/* Gewählt: nur die Fläche (WI-0184, kein Balken in den Listen der Editoren). */
.liste__eintrag.is-gewaehlt,
.liste__eintrag.is-gewaehlt:hover {
    background: var(--color-panel-active);
}

.liste__eintrag.is-zusammenhang .liste__text {
    color: var(--color-text-muted);
}

.liste__klappe {
    grid-row: 1 / span 2;
    grid-column: 1;
    display: grid;
    place-items: center;
    width: var(--space-12);
    height: var(--space-12);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    transition: transform 120ms ease;
}

/* Der Griff (⠿) einer Zeile, die man auf die Karte ziehen kann: an der Stelle des Wappens, 14 px gedämpft wie im Routenplaner. */
.liste__griff {
    grid-row: 1 / span 2;
    grid-column: 1;
    display: grid;
    place-items: center;
    width: 22px;
    height: 28px;
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1;
    transition: color 120ms ease;
}

/* Das Zeichen als Inhalt der Darstellung, nicht als Text der Zeile: Suche, Vorleser und der Name der Zeile beginnen beim Namen. */
.liste__griff::before {
    content: "⠿" / "";
}

.liste__eintrag[data-ziehbar] {
    cursor: grab;
}

.liste__eintrag[data-ziehbar]:active {
    cursor: grabbing;
}

.liste__eintrag[data-ziehbar]:hover .liste__griff {
    color: var(--color-text-strong);
}

/* Das Wappen links (E19): über beide Zeilen, an der Stelle der Klappe; ohne Wappen ein leerer Platz. */
.liste__bild {
    grid-row: 1 / span 2;
    grid-column: 1;
    display: grid;
    place-items: center;
    width: 22px;
    height: 28px;
}

.liste__bild img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

/* Das Zeichen an der Stelle des Bilds (`vorzeichen`) in der Schriftfarbe der Unterzeile, wie Lupe und Trichter. */
.liste__bild--zeichen {
    color: var(--color-text-muted);
}

.liste__bild--leer::before {
    content: "";
    width: 16px;
    height: 20px;
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-sm) var(--radius-sm) 50% 50%;
}

.liste__klappe[aria-expanded="true"] {
    transform: rotate(90deg);
}

.liste__name {
    grid-row: 1;
    grid-column: 2;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.liste__zeichen {
    flex: none;
    color: var(--color-text-muted);
}

/* Der Farbpunkt (WI-0261 S5d2): rund, in der Farbe der Zeile, mit Haarlinie, damit Hellgelb auf hellem Grund steht. */
.liste__farbe {
    flex: none;
    width: var(--space-8);
    height: var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: 50%;
    background: var(--farbe);
}
.liste__text {
    min-width: 0;
}

.liste__rechts {
    grid-row: 1;
    grid-column: 3;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.liste__unter {
    grid-row: 2;
    grid-column: 2;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die Marke „rot schraffiert“ rechts neben der Zeile der Gefahrenlage (WI-0308). */
.liste__schraffur {
    grid-row: 3;
    grid-column: 3;
    justify-self: end;
    align-self: center;
}

/* Die Gefahrenlage (WI-0308) unter der Unterzeile, in der Gefahrfarbe. */
.liste__gefahr {
    grid-row: 3;
    grid-column: 2;
    min-width: 0;
    color: var(--color-danger);
    font-size: var(--font-size-small);
}

.liste__unter--gut {
    color: var(--color-success-soft-text);
}

.liste__unter--warnung {
    color: var(--color-warning-soft-text);
}

.liste__bilder {
    grid-row: 2;
    grid-column: 3;
    justify-self: end;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.liste__leer {
    margin: 0;
    padding: var(--space-10) var(--space-8);
    color: var(--color-text-muted);
}

/* Unter der Liste, über einer Haarlinie; Zeile und Mittelpunkte bringt das Bauteil mit (`avm-kreis-legende.vue`). */
.liste__legende {
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
}

@media (prefers-reduced-motion: reduce) {
    .liste__eintrag,
    .liste__griff,
    .liste__klappe {
        transition: none;
    }
}
</style>
