<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
    EDITORPANEL,
    editorPlacePublicId,
    type EditorPlaceList,
    type EditorStatus,
    type OperationReceipt,
    type PlaceWikiField,
    type PlaceCreateBody,
} from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { phoneViewport } from "../controls/phone-viewport";
import EditorListe from "../editor-liste/editor-liste.vue";
import { ORTE_LEGENDE, ORTE_MASKEN, ORTE_OPTIONEN, wertName, zeileVon } from "../editor-liste/orte-liste";
import type { ListenEinstellung } from "../editor-liste/listen-einstellung";
import { ORT_ZIEHEN_TYP } from "../map/place-set";
import { setzbar, type Setzen, type SetzMeldung } from "./ort-setzen";
import { bitteEntfernen, entfernenMeldung, melde } from "./ort-entfernen";
import { createOrtSammel, type OrtSammel } from "./ort-sammel";
import OrtseditorSammel from "./ortseditor-sammel.vue";
import type { PruefStand } from "./befunde";
import OrtseditorNeu from "./ortseditor-neu.vue";
import type { NeuAnfrage } from "./ortseditor-steuerung";
import type { FensterStand, WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import { navName, type EditorpanelId } from "../editor-panel/editor-panel-texte";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox } from "../fenster/fenster-lage";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { formatNumber, t, tPlural, type MessageKey } from "../i18n/i18n";
import type { OrtseditorDaten } from "./ortseditor-daten";
import OrtseditorEigenschaften from "./ortseditor-eigenschaften.vue";
import type { MedienZiel } from "../medien/medien-oeffnen";
import { allesAufWiki, eigeneWerte } from "./entwurf";
import { listenBreite } from "../fenster/listen-schalter";
import { createOrtBearbeitung, type BearbeitungsSperre, type OrtBearbeitung } from "./ort-bearbeitung";
import type { LageSteuerung, VerschiebeMeldung, Verschiebung } from "./ort-verschieben";
import { feldNamen, quittungsText } from "./ortseditor-texte";
import { umschalteAufKarte } from "../editor-liste/mehrfachauswahl";
import type { MehrfachZiel } from "../map/mehrfach-markierung";

/**
 * Der Ortseditor (WI-0128 E6; EDIT-0001 §4.1 bis §4.3, D14, D15, D18, D19; Blatt Fassung 3): ein Werkzeugfenster in drei Lagen, links
 * die Liste „Orte“ (E5), rechts die Eigenschaften des Orts dieses Fensters. Mehrere können offen sein; die Fensterverwaltung des
 * Editorpanels (`fenster-verwaltung.ts`) führt sie.
 *
 * - 🔴 **Auswahl und Bearbeitung sind getrennt** (WI-0126 §11h): Die Auswahl ist eine für die Seite und synchron mit der Karte, in
 *   jeder Liste dieselbe (`auswahl`); die Bearbeitung ist der Ort DIESES Fensters. Ein Klick in der Liste öffnet den Ort an der Stelle
 *   dieses Fensters, das bisherige wird mit Entwurf abgelegt (D19); Pfeile wählen nur. Doppelklick und Enter fliegen zusätzlich hin
 *   (E7, `fliege`); die Kamera steht beim Klick.
 * - **Kein Menüband** (WI-0183, EDIT-0003 §2a; Blatt `review/ortseditor-menueband/blatt-ortseditor-ohne-band.png`): Jeder Knopf steht,
 *   wo er wirkt. ✚ (Neuer Ort) und der Papierkorb (Ort entfernen) sind Zeichen in der Leiste der Liste, „↺ Alles auf Wiki-Werte“
 *   steht im Kopf der Eigenschaften. Beim Einklappen der Liste ändert sich darum nur die Breite; nichts bricht mehr um.
 * - **Speichern** (E11): Mit Schreibrecht und `MAP_EDITING=testwelt` hält das Fenster eine Bearbeitung des Orts (`ort-bearbeitung.ts`):
 *   Entwurf, Speicherleiste im Fuß („Ungespeichert: …“, „Gespeichert als Revision N.“), Konflikt im Fenster. Ohne Recht oder
 *   ausgeschaltet zeigt es die Eigenschaften lesend, und Speichern sagt, warum es nicht geht.
 * - **Verschieben** (E12): „✥ Ort verschieben“ im Abschnitt „Lage“ startet den Modus auf der Karte (`ort-verschieben.ts`); solange er
 *   läuft, zieht nur die Liste ein, und die Leiste des Modus steht über der Karte (`ort-verschieben-leiste.vue`; EDIT-0003 G4: erst „Fertig“
 *   schreibt `place.move`, das Fenster darf zu sein, solange etwas ungespeichert ist). Die Quittung steht danach in der Statuszeile, und die
 *   Bearbeitung rückt ihre Basis auf die neue Revision vor, ohne den Entwurf zu verlieren (T12.8).
 * - **Telefon:** nur angedockt oder abgelegt (EDIT-0001 §4.1); Liste und Eigenschaften als Drill-down mit „‹ Liste“.
 */
const props = defineProps<{
    fenster: WerkzeugFenster;
    /** Meldet das Ziel des Umschalt-Klicks auf einen Ort der Karte (`map/mehrfach-markierung.ts`, `ziel`); gibt den Abbau zurück. */
    mehrfachZiel?: ((ziel: MehrfachZiel) => () => void) | undefined;
    stand: FensterStand;
    liste: EditorPlaceList | undefined;
    ladeFehler: string | undefined;
    auswahl: string | undefined;
    daten: OrtseditorDaten;
    /** Die Sperre der Orte (EDIT-0003 §4, WI-0208): die erste Änderung eines Entwurfs nimmt sie. */
    sperre?: BearbeitungsSperre | undefined;
    rechte: readonly string[];
    ablageZiel: () => DOMRect | undefined;
    medienErlaubt: boolean;
    /** Ein Hinweis für die Statuszeile (Ort ohne Lage, E7). */
    hinweis?: string | undefined;
    /** Der Stand des Bearbeitens (E9): Testwelt oder ausgeschaltet; unbekannt ohne Hinweis. */
    bearbeiten?: EditorStatus | undefined;
    /** Der Verschiebemodus dieses Fensters, solange er läuft (E12). */
    verschiebung?: Verschiebung | undefined;
    /** Die letzte Meldung des Verschiebens, für welches Fenster auch immer (E12). */
    verschiebeMeldung?: VerschiebeMeldung | undefined;
    /** Suche, Filter, Sortierung und Maske der Ortsliste, geteilt von allen Ortseditoren (sonst je Fenster neu). */
    einstellung?: ListenEinstellung | undefined;
    /** Ein Ort, der gerade auf die Karte gesetzt wird (E16), und die letzte Meldung dazu. */
    setzen?: Setzen | undefined;
    setzMeldung?: SetzMeldung | undefined;
    /** „✚ Neuer Ort“ (E16 Teil b): das Formular, wenn es diesem Fenster gilt. */
    neu?: NeuAnfrage | undefined;
    /** Die Seite hört auf `zeige` („Zum nächsten“ bei liegengebliebenen Wegenden, E20); ohne das gibt es den Knopf nicht. */
    kannZeigen?: boolean | undefined;
    /** Ist die Ortsliste dieses Fensters eingezogen (P1, `listen-schalter.ts`)? */
    listeZu?: boolean | undefined;
}>();
const emit = defineEmits<{
    "update:auswahl": [key: string | undefined];
    oeffne: [key: string];
    /** Doppelklick und Enter: öffnen und hinfliegen (E7). */
    fliege: [key: string];
    /** Der Entwurf dieses Fensters ist ungespeichert oder nicht mehr (für „Offene Bearbeitungen“). */
    ungespeichert: [ja: boolean];
    /** Die angehakten Orte der Mehrfachauswahl (ihre `public_id`), die auf der Karte gelb leuchten; aus `[]` (WI-0243). */
    mehrfachMarkierung: [ids: readonly string[]];
    /** Gespeichert: Die Ortsliste lädt neu (Name, Merkmale), die Karte mit der Kachelrevision der Quittung (E13). */
    gespeichert: [mapRevision: number | undefined];
    lage: [lage: "angedockt" | "geloest" | "versenkt", box?: FensterBox];
    box: [box: FensterBox];
    vorn: [];
    schliesse: [];
    erneut: [];
    /** „Medienverwaltung › Wappen“ bzw. „› Titelbilder“: gefiltert auf den Ort und die Rolle (E6, Bedingung c der Koordination). */
    medien: [ziel: MedienZiel];
    /** „Quelle öffnen“ in den Quellen des Orts: im Fenster „Inhalte bearbeiten“, Reiter Quellen, diese Quelle wählen (WI-0254 §12). */
    oeffneQuelle: [sourceId: string];
    /** „✥ Ort verschieben“ (E12). */
    verschiebe: [publicId: string];
    /** „● Auf der Karte setzen“ (E16): Schlüssel der Zeile. */
    setze: [key: string];
    /** ✚ in der Leiste der Liste: das Formular „Neuer Ort“ in diesem Fenster. */
    neu: [];
    /** Das Formular ist zu (abgebrochen). */
    neuFertig: [];
    /** Eine Stelle der Karte zeigen („Zum nächsten“ bei liegengebliebenen Wegenden, E20). */
    zeige: [punkt: { x: number; y: number }];
    /** Ein Ort wurde angelegt: Kennung, Name, mit Lage oder ohne, Kachelrevision. */
    angelegt: [publicId: string, name: string, mitLage: boolean, mapRevision: number | undefined];
    /** « bzw. »: Die Ortsliste dieses Fensters einziehen oder wieder ausfahren (P1). */
    listeZu: [zu: boolean];
}>();

const kennung = computed(() => `ortseditor-${props.fenster.id}`);
const zeilen = computed(() => (props.liste?.rows ?? []).map(zeileVon));
const zeile = computed(() => props.liste?.rows.find((row) => row.key === props.fenster.gegenstand));

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

// --- Die Liste ---
const facetten = (EDITORPANEL.eintraege.find((x) => x.id === "orte") as { facetten: readonly string[] }).facetten;
const optionen = { ...ORTE_OPTIONEN, facetten };
const sortierungen = [
    { wert: "name", text: t("editorListe.sortierung.name") },
    { wert: "groesse", text: t("editorListe.sortierung.groesse") },
    { wert: "kreis", text: t("editorListe.sortierung.kreis") },
];
const masken = (Object.keys(ORTE_MASKEN) as (keyof typeof ORTE_MASKEN)[]).map((wert) => ({
    wert,
    text: t(`editorListe.maske.${wert}` as MessageKey),
    passt: ORTE_MASKEN[wert],
}));
/** Die vier Zustände der Ortsliste (WI-0187, `kreisVon` in `orte-liste.ts`). */
const legende = ORTE_LEGENDE();

/**
 * « und » (P1, Betreiber 2026-10-13): Die Ortsliste zieht sich von links auf die stehende Trennlinie zu, das ganze Fenster wird
 * links schmaler, die Karte gewinnt genau die Listenbreite. 🔴 Der Knopf hängt am Kopf der Spalte „Ortseigenschaften“ - also am
 * unbeweglichen Anker der Trennlinie - und nicht in der Liste, die ja wegschrumpft und abgeschnitten wird.
 * Am Telefon stehen Liste und Eigenschaften nie nebeneinander (Drill-down): Dort gibt es weder Knopf noch Einzug.
 */
const listeZu = computed(() => props.listeZu === true && !phoneViewport.value);
const einzug = computed(() => (phoneViewport.value ? undefined : listeZu.value ? listenBreite() : 0));
const schalterText = computed(() => t(listeZu.value ? "ortseditor.liste.ausklappen" : "ortseditor.liste.einklappen"));

/** Die Medienverwaltung beim Ort dieses Fensters, auf eine Rolle gefiltert. */
function medienOeffnen(rolle: "coat" | "header"): void {
    const ort = zeile.value;
    const id = ort ? editorPlacePublicId(ort) : undefined;
    if (!ort || id === undefined) return;
    emit("medien", { von: { kind: "place", id, name: ort.name }, rolle });
}

// --- Telefon: Drill-down ---
const telefonSeite = ref<"liste" | "eigenschaften">(props.fenster.gegenstand ? "eigenschaften" : "liste");
function oeffne(key: string): void {
    nachNeu(() => {
        emit("oeffne", key);
        telefonSeite.value = "eigenschaften";
    });
}
function fliege(key: string): void {
    nachNeu(() => {
        emit("fliege", key);
        telefonSeite.value = "eigenschaften";
    });
}

// --- Leiste der Liste und Kopf der Eigenschaften (WI-0183): was früher im Menüband stand, steht, wo es wirkt ---
/** Wappen und Titelbilder binden (E19): eine Operation der Medienverwaltung, unabhängig vom Schalter `MAP_EDITING`. */
const bilderAendern = computed(() => !props.fenster.nurLesen && props.rechte.includes("upload_media"));
/** ✚ Neuer Ort (ohne Lage, E16 Teil b) geht mit Schreibrecht und eingeschaltetem Bearbeiten. */
const darfAnlegen = computed(() => bearbeitbar.value && props.rechte.includes("edit_map_objects"));
/**
 * Der Papierkorb öffnet für den Ort DIESES Fensters dasselbe Blatt wie „Ort entfernen“ auf der Karte (E22): von der Karte nehmen
 * oder ganz löschen. Er geht unter denselben Bedingungen wie der Knopf im Abschnitt „Lage“; ohne angelegten Ort gibt es nichts zu
 * entfernen (eine Zeile nur aus dem Wiki hat keinen).
 */
const entfernenGrund = computed(() => {
    if (!darfEntfernen.value) return t("ortseditor.leiste.gesperrt");
    if (publicId.value === undefined || bearbeitung.value === undefined) return t("ortseditor.leiste.keinOrt");
    return undefined;
});
function neuKlick(): void {
    if (darfAnlegen.value) emit("neu");
}
function entfernenKlick(): void {
    if (entfernenGrund.value === undefined && publicId.value !== undefined) bitteEntfernen(publicId.value);
}

/**
 * „↺ Alles auf Wiki-Werte (n)“ im Kopf der Eigenschaften (E11): setzt im Entwurf jedes Feld mit eigenem Wert zurück. Es gibt ihn nur
 * mit einer Bearbeitung und einem Wiki-Artikel; ohne eigenen Wert ist er gesperrt, und den Grund sagt der Kasten „Identität“ sichtbar.
 */
const wikiZahl = computed(() => {
    const laufend = bearbeitung.value;
    const ort = laufend?.detail.value;
    const entwurf = laufend?.entwurf.value;
    return ort && entwurf ? eigeneWerte(ort, entwurf) : 0;
});
const wikiKnopf = computed(() => neuHier.value === undefined && Boolean(bearbeitung.value?.detail.value?.wiki));
function allesZurueck(): void {
    const laufend = bearbeitung.value;
    const ort = laufend?.detail.value;
    if (laufend && ort) laufend.aendere((entwurf) => allesAufWiki(ort, entwurf));
}

// --- Prüfen (E20): die Namen der anderen Orte, die Region, liegengebliebene Wegenden nach dem letzten Verschieben ---
const pruefen = computed<PruefStand>(() => {
    const eigener = zeile.value?.key;
    const meldung = props.verschiebeMeldung;
    const quittung = meldung?.art === "quittung" && meldung.publicId === publicId.value ? meldung.quittung : undefined;
    return {
        namen: new Set(
            (props.liste?.rows ?? []).filter((row) => row.key !== eigener).map((row) => row.name.trim().toLowerCase()),
        ),
        region: zeile.value?.region,
        ...(quittung && quittung.liegen > 0 ? { liegen: { anzahl: quittung.liegen, bei: quittung.liegenBei } } : {}),
    };
});

// --- Verlauf (E17, WI-0265 B6d): Nach ↺ liest der Verlauf den Ort selbst neu (`ort-verlauf.ts`, `neuLesen`); hier folgen Liste und Kacheln wie nach dem Speichern. ---
function nachRuecknahme(mapRevision: number | undefined): void {
    emit("gespeichert", mapRevision);
}
// Die Wiki-Box (WI-0253) liest den Ort nicht selbst neu.
function nachWikiBox(mapRevision: number | undefined): void {
    void bearbeitung.value?.nachVerschieben();
    emit("gespeichert", mapRevision);
}

// --- Neuer Ort (E16 Teil b) ---
const neuHier = computed(() => (props.neu?.fenster === props.fenster.id ? props.neu : undefined));

// --- „Neuer Ort“ und die Wahl eines Orts (Betreiber 2026-10-12: „komisch ist außerdem dass es kein namen hat obwohl es einen namen hat“):
// Wer einen Ort wählt, sieht ihn. Ein offenes Formular geht zu, leer sofort, mit Eintrag erst nach Rückfrage („Weiter anlegen“ behält es).
const neuEingetragen = ref(false);
const neuVerwerfen = shallowRef<(() => void) | undefined>(undefined);
watch(neuHier, (jetzt) => {
    if (jetzt !== undefined) return;
    neuEingetragen.value = false;
    neuVerwerfen.value = undefined;
});
function nachNeu(weiter: () => void): void {
    if (neuHier.value === undefined) {
        weiter();
        return;
    }
    if (!neuEingetragen.value) {
        emit("neuFertig");
        weiter();
        return;
    }
    neuVerwerfen.value = () => {
        neuVerwerfen.value = undefined;
        emit("neuFertig");
        weiter();
    };
}
// Ein Ort von außen (Karte, „Bearbeiten“) in diesem Fenster: dasselbe.
watch(
    () => props.fenster.gegenstand,
    (jetzt, vorher) => {
        if (jetzt !== vorher && neuHier.value !== undefined) nachNeu(() => undefined);
    },
);
const neuSendet = ref(false);
const neuFehler = ref<string | undefined>(undefined);
watch(neuHier, () => {
    neuFehler.value = undefined;
});
async function anlegen(body: Omit<PlaceCreateBody, "operationId">): Promise<void> {
    neuSendet.value = true;
    neuFehler.value = undefined;
    const antwort = await props.daten.lege({ operationId: crypto.randomUUID(), ...body });
    neuSendet.value = false;
    if (!antwort.ok) {
        neuFehler.value = antwort.fehler.message;
        return;
    }
    const id = antwort.quittung.affected.find((x) => x.kind === "place")?.id;
    if (id !== undefined) emit("angelegt", id, body.name, body.position !== undefined, antwort.quittung.mapRevision);
}

const titel = computed(() =>
    zeile.value ? t("ortseditor.titelOrt", { name: zeile.value.name }) : t(navName("ortseditor" as EditorpanelId)),
);
/**
 * Der Hinweis zum Bearbeiten (E9, EDIT-0001 §4.3 Zustände): In Production, dass Änderungen live sind; in der Testwelt, dass das
 * Auffrischen sie verwerfen kann; ausgeschaltet, warum Speichern nicht geht (Production bis zum Umstieg).
 */
const modus = computed(() => {
    const stand = props.bearbeiten;
    if (stand === undefined) return undefined;
    if (stand.mapEditing === "testwelt") {
        const satz = stand.environment === "production" ? t("ortseditor.modus.live") : t("ortseditor.modus.testwelt");
        return { hinweis: satz, gesperrt: undefined };
    }
    const satz = stand.environment === "production" ? t("ortseditor.modus.umstieg") : t("ortseditor.modus.aus");
    return { hinweis: satz, gesperrt: satz };
});

// --- Bearbeitung (E11): nur mit Schreibrecht und eingeschaltetem Bearbeiten, nur für einen Ort mit Kartenpunkt ---
const bearbeitbar = computed(() => !props.fenster.nurLesen && props.bearbeiten?.mapEditing === "testwelt");
const publicId = computed(() => (zeile.value ? editorPlacePublicId(zeile.value) : undefined));
const bearbeitung = shallowRef<OrtBearbeitung | undefined>(undefined);
/** Für welchen Ort die Bearbeitung steht: Übernimmt das Fenster in der Mehrfachauswahl einen anderen (ohne Entwurf), kommt eine neue. */
let bearbeitungFuer: string | undefined;
watch(
    [publicId, bearbeitbar],
    ([id, darf]) => {
        if (bearbeitung.value !== undefined && (!darf || id === undefined || id !== bearbeitungFuer)) {
            bearbeitung.value.destroy();
            bearbeitung.value = undefined;
        }
        if (darf && id !== undefined && bearbeitung.value === undefined) {
            bearbeitung.value = createOrtBearbeitung(id, props.daten, undefined, props.sperre);
            bearbeitungFuer = id;
        }
    },
    { immediate: true },
);
onBeforeUnmount(() => bearbeitung.value?.destroy());
watch(
    () => bearbeitung.value?.zustand.value,
    (zustand) => {
        if (zustand?.art === "gespeichert") emit("gespeichert", zustand.mapRevision);
    },
);

// --- „Ort entfernen“ (E22): Das Blatt hängt im Editorpanel; ein Fenster, das den Ort hält, liest ihn danach neu (abgenommen, wieder da).
// Ein gelöschter Ort: Sein Fenster schließt die Steuerung.
watch(entfernenMeldung, (meldung) => {
    if (meldung === undefined || meldung.publicId !== publicId.value || meldung.art === "geloescht") return;
    void bearbeitung.value?.nachVerschieben();
    emit("gespeichert", meldung.mapRevision);
});

// --- Setzen (E16): nur, was noch nicht auf der Karte steht, mit Recht an der Geometrie und eingeschaltetem Bearbeiten ---
const darfSetzen = computed(
    () =>
        !props.fenster.nurLesen &&
        props.rechte.includes("edit_map_geometry") &&
        props.bearbeiten?.mapEditing === "testwelt",
);
/** „Ort entfernen“: mit Schreibrecht und eingeschaltetem Bearbeiten; was im Blatt geht, sagt das Blatt. */
const darfEntfernen = computed(
    () =>
        !props.fenster.nurLesen &&
        props.rechte.includes("edit_map_objects") &&
        props.bearbeiten?.mapEditing === "testwelt",
);
// --- Mehrfachauswahl (WI-0237, EDIT-0003 T57): Umschalter und Häkchen in der Liste, ab zwei angehakten Orten die Sammelansicht ---
const mehrfach = ref(false);
/**
 * In der Mehrfachauswahl hakt ein Klick nur an (Schnittstelle `editor-liste.vue`): Er wählt den Ort nicht zusätzlich, sonst leuchtete eine
 * abgehakte Zeile als gewählter Ort weiter (WI-0243). Den Anker für Umschalt-Klick hält die Liste dann hier.
 */
const mehrfachAnker = ref<string | undefined>(undefined);
watch(mehrfach, () => (mehrfachAnker.value = undefined));
const gewaehlt = computed({
    get: () => (mehrfach.value ? (mehrfachAnker.value ?? props.auswahl) : props.auswahl),
    set: (key: string | undefined) => {
        if (mehrfach.value) mehrfachAnker.value = key;
        else emit("update:auswahl", key);
    },
});
const angehakt = ref<readonly string[]>([]);
const angehakteZeilen = computed(() => {
    const keys = new Set(angehakt.value);
    return (props.liste?.rows ?? []).filter((row) => keys.has(row.key));
});
/** Die angelegten Orte unter den angehakten Zeilen; eine Zeile nur aus dem Wiki hat keinen und bleibt außen vor. */
const sammelIds = computed(() =>
    angehakteZeilen.value.flatMap((row) => {
        const id = editorPlacePublicId(row);
        return id === undefined ? [] : [id];
    }),
);
const sammel = shallowRef<OrtSammel | undefined>(undefined);
/** Was zuletzt für alle geschah (gelöscht); die Statuszeile sagt es, bis sich die Auswahl ändert. */
const sammelMeldung = ref<string | undefined>(undefined);
watch(
    [() => mehrfach.value && angehakt.value.length > 1, () => sammelIds.value.join(",")],
    ([an]) => {
        sammel.value?.destroy();
        sammel.value =
            an && sammelIds.value.length > 1
                ? createOrtSammel(props.daten, sammelIds.value, {
                      geschrieben: (quittung) => emit("gespeichert", quittung.mapRevision),
                  })
                : undefined;
    },
    { immediate: true },
);
// Erst ein neues Häkchen räumt die Meldung; das Lösen der Haken nach dem Löschen gehört noch zu ihr.
watch(angehakt, (neu) => {
    if (neu.length > 0) sammelMeldung.value = undefined;
});
watch(
    () => props.fenster.gegenstand,
    () => (sammelMeldung.value = undefined),
);
onBeforeUnmount(() => sammel.value?.destroy());
// Was angehakt ist, leuchtet auf der Karte wie der gewählte Ort (`map/mehrfach-markierung.ts`, WI-0243); ausgeschaltet nichts.
watch(
    () => (mehrfach.value ? sammelIds.value : []),
    (ids) => emit("mehrfachMarkierung", ids),
    { immediate: true },
);
onBeforeUnmount(() => emit("mehrfachMarkierung", []));
/**
 * Umschalt-Klick auf einen Ort der Karte (Betreiber 2026-10-20: „umschalten soll eigentlich ermöglichen die einzelnen objekte auf der
 * karte zusätzlich auszuwählen“): aufnehmen oder herausnehmen; aus schaltet er die Mehrfachauswahl ein, und der gewählte zählt mit. Die
 * Karte nennt die `public_id`, die Liste ihre Zeile.
 */
const umschaltAbbau = props.mehrfachZiel?.({
    bereit: () => props.fenster.lage !== "versenkt",
    umschalten: (id) => {
        const zeile = props.liste?.rows.find((row) => editorPlacePublicId(row) === id);
        if (zeile === undefined) return;
        angehakt.value = umschalteAufKarte({ an: mehrfach.value, angehakt: angehakt.value }, props.auswahl, zeile.key);
        mehrfach.value = true;
    },
    // Esc und ein Klick in die Karte heben die Mehrfachauswahl auf (zentral, `map/mehrfach-markierung.ts`, WI-0252).
    aufheben: () => {
        const war = mehrfach.value || angehakt.value.length > 0;
        angehakt.value = [];
        mehrfach.value = false;
        return war;
    },
});
onBeforeUnmount(() => umschaltAbbau?.());
/** Schreiben für alle: dieselben Rechte wie „Ort entfernen“ und eingeschaltetes Bearbeiten. */
const sammelGesperrt = computed(() => (darfEntfernen.value ? undefined : t("ortseditor.leiste.gesperrt")));
/** Gelöscht: Fenster der Orte schließen und die Liste lesen (`entfernenMeldung`), die Karte nachziehen, die Haken lösen. */
function sammelGeloescht(quittung: OperationReceipt, ids: readonly string[]): void {
    for (const id of ids) melde(id, "geloescht", quittung.mapRevision);
    angehakt.value = [];
    sammelMeldung.value = tPlural("ortseditor.sammel.geloescht", ids.length, { n: formatNumber(ids.length, 0) });
    emit("gespeichert", quittung.mapRevision);
}
const sammelLage = computed(() => sammel.value?.entwurf.lage.value);
const sammelSpeichernGesperrt = computed(() => {
    const laufend = sammel.value;
    if (laufend === undefined) return t("ortseditor.nichtsZuSpeichern");
    if (sammelGesperrt.value !== undefined) return sammelGesperrt.value;
    if (laufend.entwurf.zustand.value.art === "speichert") return t("ortseditor.speichernLaeuft");
    if (laufend.laedt.value) return t("editorListe.laedt");
    if (laufend.entwurf.stand.value.wiki.length === 0) return t("ortseditor.nichtsZuSpeichern");
    return undefined;
});
const sammelStatus = computed(() => {
    const laufend = sammel.value;
    if (laufend === undefined) return sammelMeldung.value;
    const n = formatNumber(laufend.ids.length, 0);
    const stand = laufend.entwurf.zustand.value;
    if (stand.art === "speichert") return t("ortseditor.zustand.speichert");
    if (stand.art === "abgelehnt") return stand.satz;
    if (stand.art === "gespeichert") return [t("ortseditor.sammel.gespeichert", { n }), ...stand.befunde].join(" ");
    const wiki = laufend.entwurf.stand.value.wiki;
    return wiki.length > 0
        ? t("ortseditor.sammel.ungespeichert", { n, felder: feldNamen(wiki as readonly PlaceWikiField[]).join(", ") })
        : tPlural("ortseditor.sammel.status", laufend.ids.length, { n });
});
watch(
    () => (bearbeitung.value?.ungespeichert.value ?? false) || (sammelLage.value?.aktiv ?? false),
    (ja) => emit("ungespeichert", ja),
);

const zeileZu = (key: string) => props.liste?.rows.find((row) => row.key === key);
// Am Telefon steht die Liste ohne Karte daneben (Drill-down): Ziehen geht dort nicht, also gibt es weder Griff noch Ziehen.
const ziehen = computed(() =>
    darfSetzen.value && !phoneViewport.value
        ? { typ: ORT_ZIEHEN_TYP, darf: (key: string) => setzbar(zeileZu(key)) }
        : undefined,
);
// Nach dem Setzen dieses Orts liest die Bearbeitung ihn mit Lage neu (wie nach dem Verschieben, T12.8).
watch(
    () => props.setzMeldung,
    (meldung) => {
        if (meldung?.art === "gesetzt" && meldung.publicId === publicId.value)
            void bearbeitung.value?.nachVerschieben();
    },
);

// --- Verschieben (E12) ---
/** Setzt dieses Fenster gerade einen Ort (Modus wartet auf den Klick, E16)? Dann klappt es ein: Die Karte ist frei. */
const setztHier = computed(() => props.setzen?.art === "wartet" && props.setzen.fenster === props.fenster.id);
/**
 * Beim Verschieben klappt das Fenster NICHT mehr ein (Festlegung der Editor-Orchestrierung 2026-10-17, A; EDIT-0003 „Liste beim
 * Modus“): Wie bei allen Modi der Form zieht nur die Liste ein (zentral über das Geometrie-Modul), die Eigenschaften bleiben, und die
 * Lage erklärt, wie der Modus geht.
 */
const eingeklappt = computed(() => setztHier.value);
const lageSteuerung = computed<LageSteuerung>(() => ({
    setzbar: darfSetzen.value && setzbar(zeile.value),
    setztGerade: props.setzen !== undefined && props.setzen.key === zeile.value?.key,
    setzSatz:
        props.setzMeldung?.art === "abgelehnt" && props.setzMeldung.key === zeile.value?.key
            ? props.setzMeldung.satz
            : undefined,
    setze: () => {
        if (zeile.value) emit("setze", zeile.value.key);
    },
    ohneRecht: !props.rechte.includes("edit_map_geometry"),
    laeuft: props.verschiebung !== undefined,
    hinweis: modusLeiste.value,
    meldung: props.verschiebeMeldung,
    verschiebe: () => {
        if (publicId.value !== undefined) emit("verschiebe", publicId.value);
    },
    fliege: () => {
        if (zeile.value) emit("fliege", zeile.value.key);
    },
    zeige: props.kannZeigen ? (punkt: { x: number; y: number }) => emit("zeige", punkt) : undefined,
    entfernen:
        darfEntfernen.value && bearbeitung.value !== undefined
            ? () => {
                  if (publicId.value !== undefined) bitteEntfernen(publicId.value);
              }
            : undefined,
}));
// Nach einem Verschieben dieses Orts rückt die Bearbeitung ihre Basis vor (T12.8), in jedem Fenster, das ihn hält.
watch(
    () => props.verschiebeMeldung,
    (meldung) => {
        if (meldung?.art === "quittung" && meldung.publicId === publicId.value)
            void bearbeitung.value?.nachVerschieben();
    },
);
/** Was die Lage sagt, solange das Verschieben lädt oder speichert. */
const modusLeiste = computed(() => {
    const art = props.verschiebung?.art;
    if (art === "laedt") return t("ortseditor.verschieben.laedt");
    if (art === "speichert") return t("ortseditor.zustand.speichert");
    return undefined;
});
/** Die Meldung des Verschiebens für dieses Fenster und seinen Ort; sie steht in der Statuszeile. */
const verschiebeText = computed(() => {
    const meldung = props.verschiebeMeldung;
    if (meldung === undefined || meldung.fenster !== props.fenster.id || meldung.publicId !== publicId.value)
        return undefined;
    if (meldung.art === "quittung") return quittungsText(meldung.quittung);
    if (meldung.art === "konflikt") return t("ortseditor.konflikt.titel");
    return meldung.satz;
});

const zustandsText = computed(() => {
    const laufend = bearbeitung.value;
    if (laufend === undefined) return undefined;
    const stand = laufend.zustand.value;
    switch (stand.art) {
        case "laedt":
            return t("editorListe.laedt");
        case "fehlt":
            return t("ortseditor.zustand.fehlt");
        case "lesefehler":
            return t("ortseditor.fehler");
        case "speichert":
            return t("ortseditor.zustand.speichert");
        case "gespeichert":
            return [t("ortseditor.zustand.gespeichert", { revision: String(stand.revision) }), ...stand.befunde].join(
                " ",
            );
        case "abgelehnt":
            return stand.satz;
        case "konflikt":
            return t("ortseditor.konflikt.titel");
        case "bereit":
            break;
    }
    return laufend.ungespeichert.value
        ? t("ortseditor.zustand.ungespeichert", { felder: feldNamen(laufend.geaenderteFelder.value).join(", ") })
        : t("ortseditor.zustand.keine", { revision: String(laufend.detail.value?.revision ?? "") });
});

/** Warum „Speichern“ gerade nicht geht; ohne Satz geht es. */
const speichernGesperrt = computed(() => {
    if (modus.value?.gesperrt !== undefined) return modus.value.gesperrt;
    if (props.fenster.nurLesen) return t("ortseditor.speichernNurLesen");
    const laufend = bearbeitung.value;
    if (laufend === undefined) return t("ortseditor.nichtsZuSpeichern");
    if (laufend.zustand.value.art === "speichert") return t("ortseditor.speichernLaeuft");
    if (laufend.zustand.value.art === "konflikt") return t("ortseditor.speichernKonflikt");
    if (!laufend.ungespeichert.value) return t("ortseditor.nichtsZuSpeichern");
    return undefined;
});

const status = computed(() => {
    if (props.ladeFehler) return props.ladeFehler;
    if (!props.liste) return t("editorListe.laedt");
    if (sammelStatus.value !== undefined) return sammelStatus.value;
    if (props.hinweis) return props.hinweis;
    // Wie das Verschieben ausging, sagt die Statuszeile, solange die Felder ruhen: Ein Entwurf, ein Speichern oder sein Ausgang gehen vor.
    const art = bearbeitung.value?.zustand.value.art ?? "bereit";
    if (verschiebeText.value !== undefined && art === "bereit" && !bearbeitung.value?.ungespeichert.value)
        return verschiebeText.value;
    if (zustandsText.value !== undefined) return zustandsText.value;
    return zeile.value ? t("ortseditor.status.gewaehlt", { name: zeile.value.name }) : t("ortseditor.status.bereit");
});
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
        :eingeklappt="eingeklappt"
        :einzug="einzug"
        :titel="titel"
        :zusatz="fenster.nurLesen ? t('editorPanel.verb.lesen') : undefined"
        :testid="kennung"
        @update:lage="(neu, box) => emit('lage', neu, box)"
        @update:box="(box) => emit('box', box)"
        @vorn="emit('vorn')"
    >
        <template #eingeklappt>
            <div v-if="setztHier" class="ortseditor__modusleiste" :data-testid="`${kennung}-modusleiste`">
                <span class="ortseditor__modustitel">{{ t("ortseditor.setzen") }}</span>
                <span>{{ t("ortseditor.setzen.laeuft") }}</span>
            </div>
        </template>
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'liste'"
            :id="`${kennung}-listenspalte`"
            :titel="t('editorListe.liste')"
            breite="inspektor"
            :telefon="phoneViewport"
            :einziehbar="!phoneViewport"
            :inert="listeZu || undefined"
            :schliessen="t('fenster.liste.schliessen')"
            :testid="`${kennung}-liste`"
            @schliesse="phoneViewport ? (telefonSeite = 'eigenschaften') : emit('listeZu', true)"
        >
            <p v-if="ladeFehler" class="ortseditor__fehler">
                {{ ladeFehler }}
                <button type="button" class="ortseditor__erneut" @click="emit('erneut')">
                    {{ t("editorListe.erneut") }}
                </button>
            </p>
            <EditorListe
                v-else
                v-model:gewaehlt="gewaehlt"
                v-model:mehrfach="mehrfach"
                v-model:angehakt="angehakt"
                :zeilen="zeilen"
                :optionen="optionen"
                :facetten-name="(id: string) => t(`nav.editorpanel.facette.${id}` as MessageKey)"
                :wert-name="wertName"
                :sortierungen="sortierungen"
                :masken="masken"
                :legende="legende"
                :kennung="`${kennung}-orte`"
                :beschriftung="t('editorListe.liste')"
                :einstellung="einstellung"
                :ziehen="ziehen"
                @klick="oeffne"
                @oeffne="fliege"
            >
                <!--
                    ✚ und Papierkorb in der Leiste (WI-0183, Blatt C): nach Trichter und Sortierung, in derselben Fassung. Gesperrt
                    sagt der title, warum; die Aufschrift trägt das aria-label.
                -->
                <template #zeichen>
                    <button
                        type="button"
                        class="ortseditor__zeichenknopf ortseditor__zeichenknopf--erstes"
                        :disabled="!darfAnlegen"
                        :aria-label="t('ortseditor.leiste.neu')"
                        :title="darfAnlegen ? t('ortseditor.leiste.neuSatz') : t('ortseditor.leiste.gesperrt')"
                        :data-testid="`${kennung}-leiste-neu`"
                        @click="neuKlick"
                    >
                        <EditorZeichen name="hinzufuegen" />
                    </button>
                    <button
                        type="button"
                        class="ortseditor__zeichenknopf"
                        :disabled="entfernenGrund !== undefined"
                        :aria-label="t('ortseditor.entfernen')"
                        :title="entfernenGrund ?? t('ortseditor.entfernen')"
                        :data-testid="`${kennung}-leiste-entfernen`"
                        @click="entfernenKlick"
                    >
                        <EditorZeichen name="loeschen" />
                    </button>
                </template>
                <!-- Ohne Wiki-Liste (vor dem ersten Zug mit X3) zählt „Nicht auf der Karte“ nur die Stätten als Übergang. -->
                <template #hinweis>
                    <p v-if="liste && !liste.wikiListe" class="ortseditor__hinweis">
                        {{ t("editorListe.wikiFehlt") }}
                    </p>
                </template>
            </EditorListe>
        </FensterSpalte>
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'eigenschaften'"
            :titel="t('ortseditor.eigenschaften')"
            breite="fuellen"
            :telefon="phoneViewport"
            :testid="`${kennung}-eigenschaften-spalte`"
        >
            <template #zurueck>
                <button v-if="phoneViewport" type="button" class="ortseditor__zurueck" @click="telefonSeite = 'liste'">
                    {{ t("ortseditor.zurListe") }}
                </button>
                <!--
                    « / » an der Trennlinie (P1): ein flacher Schalter am Kopf der Eigenschaften, also am ortsfesten Anker. Er
                    bewegt sich keinen Pixel, während die Liste links einfährt.
                -->
                <button
                    v-else
                    type="button"
                    class="ortseditor__listenschalter"
                    :aria-expanded="!listeZu"
                    :aria-controls="`${kennung}-listenspalte`"
                    :aria-label="schalterText"
                    :title="schalterText"
                    :data-testid="`${kennung}-listenschalter`"
                    @click="emit('listeZu', !listeZu)"
                >
                    <span class="ortseditor__schalterzeichen avm-versalmitte" aria-hidden="true">{{
                        listeZu ? "»" : "«"
                    }}</span>
                </button>
            </template>
            <!-- „↺ Alles auf Wiki-Werte (n)“ rechts im Kopf (WI-0183, Blatt D); gesperrt nennt der Kasten „Identität“ den Grund. -->
            <template v-if="wikiKnopf && !sammel" #kopf>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="wikiZahl === 0 ? '' : undefined"
                    :title="wikiZahl === 0 ? t('wikiFeld.keineEigenen') : undefined"
                    :testid="`${kennung}-alle-wiki`"
                    @click="allesZurueck"
                >
                    {{ t("wikiFeld.alle", { n: formatNumber(wikiZahl, 0) }) }}
                </AvmKnopf>
            </template>
            <AvmBestaetigung
                v-if="neuHier && neuVerwerfen"
                :frage="t('ortseditor.neu.verwerfen.frage')"
                :folge="t('ortseditor.neu.verwerfen.folge')"
                :bestaetigen="t('ortseditor.neu.verwerfen')"
                :abbrechen="t('ortseditor.neu.weiter')"
                :testid="`${kennung}-neu-verwerfen`"
                @bestaetigen="neuVerwerfen()"
                @abbrechen="neuVerwerfen = undefined"
            />
            <OrtseditorNeu
                v-if="neuHier"
                :key="neuHier.nr"
                :kennung="kennung"
                :position="neuHier.position"
                :fehler="neuFehler"
                :sendet="neuSendet"
                @anlegen="anlegen"
                @abbrechen="emit('neuFertig')"
                @eingetragen="(ja: boolean) => (neuEingetragen = ja)"
            />
            <OrtseditorSammel
                v-else-if="sammel"
                :kennung="kennung"
                :sammel="sammel"
                :namen="angehakteZeilen.map((row) => row.name)"
                :ohne-ort="angehakteZeilen.length - sammelIds.length"
                :gesperrt="sammelGesperrt"
                :api="daten"
                :rechte="rechte"
                @geloescht="sammelGeloescht"
            />
            <OrtseditorEigenschaften
                v-else
                :zeile="zeile"
                :daten="daten"
                :rechte="rechte"
                :kennung="kennung"
                :medien-erlaubt="medienErlaubt"
                :bearbeitung="bearbeitung"
                :lage="lageSteuerung"
                :pruefen="pruefen"
                :bilder-aendern="bilderAendern"
                :staetten-aendern="darfEntfernen"
                :schreibt="bearbeitbar"
                @medien="medienOeffnen"
                @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
                @bilder-geaendert="emit('gespeichert', undefined)"
                @zurueckgenommen="nachRuecknahme"
                @wiki-geaendert="nachWikiBox"
            />
        </FensterSpalte>
        <template #fuss-hinweis>
            <span :data-testid="`${kennung}-status`">{{ status }}</span>
            <span v-if="modus" class="ortseditor__modus" :data-testid="`${kennung}-modus`">{{ modus.hinweis }}</span>
        </template>
        <template v-if="sammel" #fuss-haupt>
            <AvmKnopf v-if="sammelLage?.aktiv" :testid="`${kennung}-verwerfen`" @click="sammel.entwurf.verwerfen()">
                {{ t("ortseditor.verwerfen") }}
            </AvmKnopf>
            <AvmKnopf
                art="gefuellt"
                :gesperrt="sammelSpeichernGesperrt"
                :testid="`${kennung}-speichern`"
                @click="sammel.entwurf.fertig()"
            >
                {{ t("ortseditor.speichern") }}
            </AvmKnopf>
        </template>
        <template v-else #fuss-haupt>
            <AvmKnopf
                v-if="bearbeitung?.ungespeichert.value"
                :testid="`${kennung}-verwerfen`"
                @click="bearbeitung.verwerfen()"
            >
                {{ t("ortseditor.verwerfen") }}
            </AvmKnopf>
            <AvmKnopf
                art="gefuellt"
                :gesperrt="speichernGesperrt"
                :testid="`${kennung}-speichern`"
                @click="bearbeitung?.speichern()"
            >
                {{ t("ortseditor.speichern") }}
            </AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
/*
 * ✚ und Papierkorb in der Leiste der Liste (WI-0183): dieselbe Fassung wie Trichter und Sortierung daneben (`avm-menueknopf.vue`):
 * Kante `border`, Fläche `panel`, quadratisch in Bedienhöhe, das Zeichen in der Schriftfarbe. Zustände nach Guide §30.5: Hover und
 * Druck legen eine Lasur ÜBER die Fassung (§30.1), Fokus nur über die Tastatur, gesperrt die eigene Farbfassung der Sperre, nie Deckkraft
 * (§30.2). Vor dem ersten steht ein Schritt mehr Abstand: Trichter und Sortierung ändern die Ansicht, ✚ und Papierkorb die Daten.
 */
.ortseditor__zeichenknopf {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    margin: 0;
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

.ortseditor__zeichenknopf--erstes {
    margin-left: var(--space-4);
}

.ortseditor__zeichenknopf:not(:disabled):hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.ortseditor__zeichenknopf:not(:disabled):active {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
    color: var(--color-text-strong);
}

.ortseditor__zeichenknopf:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.ortseditor__zeichenknopf:disabled {
    border-color: var(--color-disabled-border);
    background-color: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: default;
}

@media (prefers-reduced-motion: reduce) {
    .ortseditor__zeichenknopf {
        transition: none;
    }
}

/* Die Leiste des eingeklappten Fensters (Gesamtmockup `.movebar`): der Modus und wie er geht. */
.ortseditor__modusleiste {
    display: grid;
    gap: var(--space-2);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    color: var(--color-text);
}

.ortseditor__modustitel {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.ortseditor__modus {
    margin-left: var(--space-8);
    color: var(--color-text-muted);
}

.ortseditor__hinweis,
.ortseditor__fehler {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.ortseditor__erneut,
.ortseditor__zurueck {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.ortseditor__erneut:hover,
.ortseditor__zurueck:hover {
    color: var(--color-link-hover);
}

/*
 * Der Schalter der Ortsliste (P1, Betreiber 2026-10-13): flach, ohne Zierrahmen, nur das Doppelzeichen - und mit der
 * Mindestliste aus Guide §30.5 (Ruhe, Hover, Aktiv, Fokus, Übergang; gesperrt ist er nie, er schaltet nur die Sicht).
 * Er steht als erstes Teil im Kopf der Eigenschaften und hält die Bedienhöhe, damit der Spaltentitel nicht springt.
 */
.ortseditor__listenschalter {
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

.ortseditor__listenschalter:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.ortseditor__listenschalter:active {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.ortseditor__listenschalter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .ortseditor__listenschalter {
        transition: none;
    }
}

/*
 * «/» auf der Versalmitte des Titels (WI-0183; Guide §3.2; Betreiber 2026-10-15: „„Ortseigenschaften“ und der button zum ein- und
 * ausklappen [sind] nicht vertikal aligned“). Die Tinte der Guillemets liegt um die x-Höhe, nicht um die Versalhöhe: Mittig im Kasten
 * stand sie zu tief. Das Zeichen trägt das Hausrezept `.avm-versalmitte` wie der Titel (`fenster-spalte.vue`) und rückt dann um die
 * halbe Differenz von Versal- und x-Höhe nach oben: So liegt die Mitte seiner Tinte, nicht die seines Kastens, auf der Versalmitte.
 * Beide Maße kommen aus der Schrift (`cap`, `ex`), nicht aus einem ausgemessenen Pixel. Gemessen an der Tinte: `ortseditor-ohne-band.spec.ts`.
 */
.ortseditor__schalterzeichen {
    translate: 0 calc((1ex - 1cap) / 2);
}
</style>
