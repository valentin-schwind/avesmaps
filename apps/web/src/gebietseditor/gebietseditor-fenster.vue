<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    EDITORPANEL,
    GEBIETSEDITOR,
    type EditorTerritoryDetail,
    type EditorTerritoryFindings,
    type EditorTerritoryHierarchy,
    type EditorTerritoryList,
    type TerritoryRetireBody,
} from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { phoneViewport } from "../controls/phone-viewport";
import EditorListe from "../editor-liste/editor-liste.vue";
import type { ListenEinstellung } from "../editor-liste/listen-einstellung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import AvmFenster from "../fenster/avm-fenster.vue";
import EntwurfFuss from "../fenster/entwurf-fuss.vue";
import EntwurfVerlauf from "../fenster/entwurf-verlauf.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import type { FensterBox } from "../fenster/fenster-lage";
import FensterReiter from "../fenster/fenster-reiter.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import TraegerKarten from "../fenster/traeger-karten.vue";
import { useTraegerKarten } from "../fenster/traeger-karten";
import TraegerQuellen from "../fenster/traeger-quellen.vue";
import { GRUND_GEBIET } from "../editor-menu/sonderrolle-grund";
import { formatNumber, t } from "../i18n/i18n";
import { listenBreite } from "../fenster/listen-schalter";
import { befundeDes, befundZahlen } from "./befunde";
import { DETAIL_NAMEN, istDetailfeld } from "./gebiet-detailfelder";
import GebietBilder from "./gebiet-bilder.vue";
import GebietEigenschaften from "./gebiet-eigenschaften.vue";
import GebietFarbfeld from "./gebiet-farbfeld.vue";
import GebietHierarchie from "./gebiet-hierarchie.vue";
import GebietMehrfach from "./gebiet-mehrfach.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import {
    GEBIETE_LEGENDE,
    GEBIETE_OPTIONEN,
    GEBIETE_SORTIERUNGEN,
    artName,
    facettenName,
    sortierungsName,
    wertName,
    zeilenVon,
} from "./gebiete-liste";
import type { GebietBearbeitung, GebietMehrfachauswahl, GebietReiter } from "./gebietseditor-steuerung";
import type { Spanne, Zoombaender } from "./zoombaender";

/**
 * Der Gebietseditor, lesend (WI-0209 Paket A3; EDIT-0005 §3; Blatt „Herrschaftsgebiete“): ein Werkzeugfenster wie der
 * Landschaftseditor (rechts angedockt, « » klappt die Liste ein), links der Baum der Herrschaftsgebiete (A2), rechts das gewählte mit
 * den Reitern Eigenschaften, Untergebiete, Hierarchie und Form.
 *
 * - **Lesend:** Felder als Text, kein Fuß mit Speichern. Geschrieben wird mit dem gemeinsamen Fensterrumpf (O3) ab B2, nach T27 (4):
 *   „Fertig“ in der Leiste schreibt Form und Felder, der Fuß zeigt nur „n ungespeichert“.
 * - Ein Klick in der Liste wählt und stellt die Karte auf „Politisch“, ohne Flug (F17); Doppelklick und Enter fliegen dazu zum Rahmen
 *   dessen, was die Karte unter dem Gebiet zeigt (T32). Beides macht `app.vue` über die gemeinsame Zuordnung (`ansichtFuerHinflug`).
 * - **Untergebiete** und die Zeilen der **Hierarchie** wählen mit einem Klick, wie die Liste; die Hierarchie rechnet ab dem gewählten.
 *   Dort ändert „Zoombänder bearbeiten“ (D2) die Spannen; den Modus hält `app.vue` (`baender`), das Fenster reicht ihn durch.
 * - **Telefon:** Liste und Eigenschaften als Drill-down mit „‹ Liste“, wie Orts- und Landschaftseditor.
 * - **Mehrfachauswahl** (EDIT-0003 T57, Fassung 5): Mit dem Umschalter der Liste hakt ein Klick an, statt zu wählen; ab zwei angehakten
 *   stehen rechts ihre gemeinsamen Eigenschaften (`gebiet-mehrfach.vue`), die übrigen Reiter grau. Den Zustand hält die Steuerung.
 */
const props = defineProps<{
    fenster: WerkzeugFenster;
    liste: EditorTerritoryList | undefined;
    ladeFehler: string | undefined;
    einstellung: ListenEinstellung;
    /** Die Bearbeitung des Gebiets dieses Fensters (`gebietseditor-steuerung.ts`, B2); ohne Gebiet keine. */
    bearbeitung: GebietBearbeitung | undefined;
    /** Darf diese Sitzung Gebiete schreiben (Recht und `MAP_EDITING`)? */
    darf?: boolean | undefined;
    /** Hat diese Sitzung `edit_territory_form`? Sonst stehen Hierarchie und Form grau mit der zuständigen Sonderrolle, Obergebiet und Zoomspanne still da (WI-0279, E1, E2a). */
    darfForm?: boolean | undefined;
    /** Hat diese Sitzung das Recht `manage_sources`? Mit `darf` bearbeitet der Reiter „Quellen“ dann sofort (WI-0254 §12). */
    quellenRecht?: boolean | undefined;
    /** „Neue Fläche“ (C3): Darf diese Sitzung Gebiete zeichnen (beide Rechte und `MAP_EDITING`)? Ohne gibt es die Knöpfe nicht. */
    zeichnen?: boolean | undefined;
    /** Das eben angelegte Gebiet (C3): sein Name steht markiert, bis jemand tippt (Frage 3). */
    nameMarkieren?: string | undefined;
    hierarchie: EditorTerritoryHierarchy | undefined;
    hierarchieFehler: string | undefined;
    ablageZiel: () => DOMRect | undefined;
    /** Darf die Medienverwaltung öffnen (`view_media_private`)? */
    medien?: boolean | undefined;
    /** Ist die Liste eingezogen? Der Schalter liegt in `app.vue` (`listenSchalter`). */
    listeZu?: boolean | undefined;
    /** „Zoombänder bearbeiten“ im Reiter „Hierarchie“ (D2) und warum es gerade nicht geht. */
    baender?: Zoombaender | undefined;
    baenderGrund?: string | undefined;
    /** „Prüfen“ (D6): die Befunde aller Gebiete. */
    befunde?: EditorTerritoryFindings | undefined;
    /** Mit welchem Reiter das Gebiet verlangt wurde (D19: ein neues Fenster an der Stelle des alten steht am selben Reiter). */
    reiterWunsch?: { gegenstand: string; reiter: GebietReiter } | undefined;
    /** „Entfernen“ (D3), geschrieben über die Steuerung; ohne Angabe gibt es den Knopf nicht. */
    entferne?:
        | ((
              id: string,
              stage: TerritoryRetireBody["stage"],
              children: TerritoryRetireBody["children"],
          ) => Promise<{ ok: true } | { ok: false; satz: string }>)
        | undefined;
    /** Die Mehrfachauswahl der Liste (T57); ohne Angabe gibt es den Umschalter nicht. */
    mehrfachauswahl?: GebietMehrfachauswahl | undefined;
}>();
const emit = defineEmits<{
    "update:auswahl": [id: string | undefined, reiter: GebietReiter];
    /** Doppelklick und Enter: zum Rahmen fliegen. */
    fliege: [bounds: [number, number, number, number]];
    /** Der Reiter „Hierarchie“ ist zu sehen und braucht die Daten dieses Gebiets. */
    hierarchie: [id: string];
    /** Klick auf eine Bandspalte der Hierarchie: dieses Band auf der Karte zeigen. */
    band: [band: number];
    /** „In der Medienverwaltung“ am Wappen. */
    medien: [id: string, name: string];
    /** Das Wappen dieses Gebiets hat sich im Wappen-Kasten geändert. */
    wappen: [id: string];
    lage: [lage: "angedockt" | "geloest" | "versenkt", box?: FensterBox];
    box: [box: FensterBox];
    vorn: [];
    schliesse: [];
    erneut: [];
    listeZu: [zu: boolean];
    /** „Untergebiete ziehen mit“ aus den Eigenschaften oder der Hierarchie; umgestellt wird beim Besitzer der Bänder. */
    mitziehen: [an: boolean];
    /** „Untergebiet anlegen“ (C3): „Neue Fläche“ mit diesem Gebiet als Obergebiet. */
    untergebiet: [obergebiet: { id: string; name: string }];
    /** „Grenze zeichnen“ (C3) an einem Gebiet ohne eigene Fläche im Anzeigejahr. */
    grenze: [gebiet: { id: string; name: string; revision: number }];
    /** Der Name des neuen Gebiets ist markiert. */
    nameMarkiert: [];
    /** „Quelle öffnen“ in den Quellen des Gebiets: im Fenster „Inhalte bearbeiten“, Reiter Quellen, diese Quelle wählen (WI-0254 §12). */
    oeffneQuelle: [sourceId: string];
}>();

const kennung = computed(() => `gebietseditor-${props.fenster.id}`);
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

// --- Der Baum (A2): Facetten aus dem Register ---
const facetten = (EDITORPANEL.eintraege.find((x) => x.id === "territorien") as { facetten: readonly string[] })
    .facetten;
const optionen = { ...GEBIETE_OPTIONEN, facetten };
const sortierungen = GEBIETE_SORTIERUNGEN.map((wert) => ({ wert, text: sortierungsName(wert) }));
const legende = GEBIETE_LEGENDE();
const jahr = computed(() => props.liste?.yearBf ?? 0);
const zeilen = computed(() =>
    props.liste ? zeilenVon(props.liste, props.befunde ? befundZahlen(props.befunde) : undefined) : [],
);
/** Das Gebiet dieses Fensters (je Gebiet ein Fenster, T44). */
const auswahl = computed(() => props.fenster.gegenstand);
const detail = computed((): EditorTerritoryDetail | undefined => props.bearbeitung?.detail.value);
const detailFehler = computed(() => {
    const art = props.bearbeitung?.zustand.value.art;
    if (art === "fehlt") return t("entwurf.fehlt");
    if (art === "lesefehler") return t("entwurf.lesefehler");
    return undefined;
});
/** Ganz gelöscht (EDIT-0003 T54): Das Fenster zeigt es nur lesend; zurück holt es ↺ im Verlauf. */
const geloescht = computed(() => detail.value?.deleted === true);
/** „nur lesen“ im Kopf hängt am Recht und am Gelöscht-Stand, nicht an der Einzelbearbeitung: Ein leeres Fenster und die Mehrfachauswahl
 * haben keine (Stage-Probe 2026-10-19: ohne gewähltes Gebiet stand „nur lesen“ beim Betreiber). */
const nurLesen = computed(() => props.darf !== true || geloescht.value);
const schreibt = computed(
    () => props.darf === true && props.bearbeitung !== undefined && detail.value !== undefined && !geloescht.value,
);
const konflikt = computed(() => {
    const zustand = props.bearbeitung?.zustand.value;
    return zustand?.art === "konflikt" ? zustand : undefined;
});
/** Die Namen der Teile im Konfliktkasten (`gebiet-art.ts`, `GEBIET_FELDER`). */
function teilName(teil: string): string {
    const namen: Record<string, string> = {
        name: t("gebietseditor.feld.name"),
        kurzname: t("gebietseditor.feld.kurzname"),
        art: t("infoPanel.field.art"),
        status: t("infoPanel.field.status"),
        hauptstadt: t("infoPanel.field.capital"),
        obergebiet: t("gebietseditor.feld.obergebiet"),
    };
    return namen[teil] ?? (istDetailfeld(teil) ? t(DETAIL_NAMEN[teil]) : t("entwurf.form"));
}
const befundeAuswahl = computed(() => (auswahl.value === undefined ? [] : befundeDes(props.befunde, auswahl.value)));
const wertNameImJahr = (facette: string, wert: string): string => wertName(facette, wert, jahr.value);
const nachId = computed(() => new Map((props.liste?.rows ?? []).map((row) => [row.id, row])));
// --- Mehrfachauswahl (T57): Ein Klick hakt an und merkt sich nur den Anker, statt das Fenster umzustellen ---
const mehrfachAn = computed(() => props.mehrfachauswahl?.an.value === true);
const angehakt = computed(() => props.mehrfachauswahl?.angehakt.value ?? []);
const sammel = computed(() => (mehrfachAn.value ? props.mehrfachauswahl?.entwurf.value : undefined));
const gewaehlt = computed({
    get: () => (mehrfachAn.value ? (props.mehrfachauswahl?.anker.value ?? auswahl.value) : auswahl.value),
    set: (id: string | undefined) => {
        if (mehrfachAn.value) props.mehrfachauswahl?.setzeAnker(id);
        else waehle(id);
    },
});
function waehle(id: string | undefined): void {
    emit("update:auswahl", id, reiter.value);
    if (id !== undefined && phoneViewport.value) telefonSeite.value = "eigenschaften";
}
const zeile = computed(() => (auswahl.value === undefined ? undefined : nachId.value.get(auswahl.value)));
function fliege(id: string): void {
    const bounds = nachId.value.get(id)?.bounds;
    if (bounds !== undefined) emit("fliege", bounds);
}

// --- „Umhängen“ per Ziehen im Baum (D1, R13): Abgelegt heißt das Blatt der Folgen am Feld „Obergebiet“, nicht schreiben ---
/** Das gezogene Gebiet und sein neues Obergebiet, bis das Feld das Blatt zeigt. */
const umhaengWunsch = ref<{ id: string; ziel: { id: string; name: string } } | undefined>(undefined);
function istNachfahre(id: string, von: string): boolean {
    const gesehen = new Set<string>();
    let oben = nachId.value.get(id)?.parent;
    while (oben !== undefined && !gesehen.has(oben)) {
        if (oben === von) return true;
        gesehen.add(oben);
        oben = nachId.value.get(oben)?.parent;
    }
    return false;
}
const ablegen = computed(() =>
    props.darf === true
        ? {
              typ: "application/x-avesmaps-gebiet",
              hierher: t("gebietseditor.umhaengen.hierher"),
              darf: (ziel: string, quelle: string): true | string => {
                  if (nachId.value.get(ziel)?.deleted || nachId.value.get(quelle)?.deleted)
                      return t("editorListe.stand.geloescht");
                  if (ziel === quelle) return t("gebietseditor.umhaengen.selbst");
                  if (istNachfahre(ziel, quelle)) return t("gebietseditor.umhaengen.kreis");
                  if (nachId.value.get(quelle)?.parent === ziel) return t("gebietseditor.umhaengen.schon");
                  return true;
              },
              ab: (ziel: string, quelle: string): void => {
                  umhaengWunsch.value = { id: quelle, ziel: { id: ziel, name: nachId.value.get(ziel)?.name ?? "" } };
                  emit("update:auswahl", quelle, "eigenschaften");
                  if (phoneViewport.value) telefonSeite.value = "eigenschaften";
              },
          }
        : undefined,
);

// --- « » (wie der Landschaftseditor): Die Liste zieht sich auf die stehende Trennlinie zu ---
// Der Schalter liegt in `app.vue` (`listenSchalter`), wie bei den anderen Editoren: Nur so rücken die Laschen „Info“/„Editor“ mit.
const zu = computed(() => props.listeZu === true && !phoneViewport.value);
const einzug = computed(() => (phoneViewport.value ? undefined : zu.value ? listenBreite() : 0));
const schalterText = computed(() => t(zu.value ? "ortseditor.liste.ausklappen" : "ortseditor.liste.einklappen"));
const telefonSeite = ref<"liste" | "eigenschaften">("liste");

// --- Die Reiter aus dem Register (`GEBIETSEDITOR`), wie der Landschaftseditor aus `LANDSCHAFTSEDITOR` ---
const reiter = ref<GebietReiter>(
    props.reiterWunsch !== undefined && props.reiterWunsch.gegenstand === props.fenster.gegenstand
        ? props.reiterWunsch.reiter
        : "eigenschaften",
);
/** Die Karten der Kartensammlung, die dieses Gebiet abbilden: Der Reiter steht nur, wenn es welche gibt. */
const karten = useTraegerKarten(
    () => (detail.value === undefined ? undefined : { kind: "territory", id: detail.value.id }),
    () => {
        if (reiter.value === "karten") reiter.value = "eigenschaften";
    },
);
// Ein eben angelegtes Gebiet (C3) zeigt seine Eigenschaften, damit sein Name markiert steht (Frage 3).
watch(
    () => props.nameMarkieren !== undefined && props.nameMarkieren === detail.value?.id,
    (neu) => {
        if (!neu) return;
        reiter.value = "eigenschaften";
        telefonSeite.value = "eigenschaften";
    },
    { immediate: true },
);
/** Die Zahl der aktiven Quellen, sobald der Reiter sie gelesen hat (`fenster/traeger-quellen.vue`); ein anderes Gebiet beginnt ohne. */
const quellenZahl = ref<number | undefined>(undefined);
watch(auswahl, () => (quellenZahl.value = undefined));
const REITER_NAMEN = {
    eigenschaften: () => t("gebietseditor.reiter.eigenschaften"),
    untergebiete: () =>
        t("gebietseditor.reiter.untergebiete", { n: formatNumber(detail.value?.children.length ?? 0, 0) }),
    hierarchie: () => t("gebietseditor.reiter.hierarchie"),
    form: () => t("gebietseditor.reiter.form"),
    quellen: () =>
        quellenZahl.value === undefined
            ? t("gebietseditor.reiter.quellen")
            : t("fenster.traegerQuellen.reiter", { n: formatNumber(quellenZahl.value, 0) }),
    bilder: () => t("gebietseditor.reiter.bilder"),
    karten: () => t("fenster.traegerKarten.reiter", { n: formatNumber(karten.value.length, 0) }),
    verlauf: () => t("gebietseditor.reiter.verlauf"),
} as const satisfies Record<GebietReiter, () => string>;

/** Die Wiki-Box hat zugewiesen, entfernt oder gesynct (WI-0253): Das Gebiet und die Liste lesen neu. */
function wikiGeaendert(): void {
    void props.bearbeitung?.neuLesen();
    emit("erneut");
}
/** Die Namen der Felder im Verlauf (und in seinem Konflikt), wie das Protokoll sie führt. */
function verlaufFeldName(feld: string): string {
    const namen: Record<string, string> = {
        name: t("gebietseditor.feld.name"),
        shortName: t("gebietseditor.feld.kurzname"),
        type: t("infoPanel.field.art"),
        status: t("infoPanel.field.status"),
        capital: t("infoPanel.field.capital"),
        parent: t("gebietseditor.feld.obergebiet"),
        color: t("gebietseditor.feld.farbe"),
        minZoom: t("gebietseditor.verlauf.zoomVon"),
        maxZoom: t("gebietseditor.verlauf.zoomBis"),
        geometry: t("entwurf.form"),
    };
    // Die Detailfelder (G6) heißen wie in den Eigenschaften; ihre Herkunft blendet der Verlauf aus (`herkunftsfelder`).
    if (istDetailfeld(feld)) return t(DETAIL_NAMEN[feld]);
    return namen[feld] ?? feld;
}
/** Ein Wert im Verlauf: Gebiete beim Namen (Obergebiet), sonst wie der Verlauf ihn zeigt. */
function verlaufWert(feld: string, wert: unknown): string | undefined {
    if (feld === "parent")
        return typeof wert === "string"
            ? (nachId.value.get(wert)?.name ?? undefined)
            : t("gebietseditor.obergebiet.keins");
    if (feld === "geometry") return t("gebietseditor.verlauf.form");
    return undefined;
}
const reiterGesperrt = (id: GebietReiter): boolean => props.darfForm !== true && (id === "hierarchie" || id === "form");
const reiterListe = computed(() =>
    GEBIETSEDITOR.eintraege
        .filter((eintrag) => eintrag.id !== "karten" || karten.value.length > 0)
        .map((eintrag) => ({
            id: eintrag.id,
            name: REITER_NAMEN[eintrag.id](),
            ...(reiterGesperrt(eintrag.id) ? { spaeter: t(GRUND_GEBIET) } : {}),
        })),
);
// Auch ein Wunsch von außen (Kartenmenü, Sprung aus „Änderungen“) öffnet keinen grauen Reiter.
watch(
    [reiter, () => props.darfForm],
    ([jetzt]) => {
        if (reiterGesperrt(jetzt)) reiter.value = "eigenschaften";
    },
    { immediate: true, flush: "sync" },
);
watch(
    [reiter, auswahl],
    ([jetzt, id]) => {
        if (jetzt === "hierarchie" && id !== undefined && nachId.value.get(id)?.deleted !== true)
            emit("hierarchie", id);
    },
    { immediate: true },
);
const titel = computed(() =>
    sammel.value
        ? `${t("gebietseditor.titel")} · ${t("gebietseditor.sammel.gewaehlt", { n: formatNumber(sammel.value.ids.length, 0) })}`
        : zeile.value
          ? `${t("gebietseditor.titel")} · ${zeile.value.name}`
          : t("gebietseditor.titel"),
);
/** In der Mehrfachauswahl gehen nur die Eigenschaften; die übrigen Reiter stehen grau mit „Nur einzeln“. */
const reiterMehrfach = computed(() =>
    reiterListe.value.map((eintrag) =>
        eintrag.id === "eigenschaften"
            ? eintrag
            : {
                  ...eintrag,
                  // Ohne die Zahl des einzelnen Gebiets: Sie gälte für keines der gewählten.
                  ...(eintrag.id === "untergebiete" ? { name: t("gebietseditor.feld.untergebiete") } : {}),
                  spaeter: t("fenster.sammel.nurEinzeln"),
              },
    ),
);
/** „… angelegt“ nach „Unter neues Obergebiet …“ am neuen Gebiet, mit „↺ Zurückholen“ (Blatt „Mehrfachauswahl“, Bild 8). */
const obergebietMeldung = computed(() => {
    const m = props.mehrfachauswahl?.meldung.value;
    return m !== undefined && m.id === detail.value?.id ? m : undefined;
});
const zurueckSendet = ref(false);
const zurueckSatz = ref<string | undefined>(undefined);
async function obergebietZurueck(): Promise<void> {
    if (zurueckSendet.value || props.mehrfachauswahl === undefined) return;
    zurueckSendet.value = true;
    zurueckSatz.value = undefined;
    const antwort = await props.mehrfachauswahl.zurueckholen();
    zurueckSendet.value = false;
    if (!antwort.ok) zurueckSatz.value = antwort.satz;
}
/** Der Fuß zeigt den Entwurf, der rechts steht: den der Mehrfachauswahl oder die Bearbeitung des Gebiets. */
const fussEntwurf = computed(() => sammel.value ?? props.bearbeitung);

// --- Untergebiete und Form ---
const kinder = computed(() =>
    (detail.value?.children ?? []).map((kind) => ({ ...kind, zeile: nachId.value.get(kind.id) })),
);
/** Hat das Gebiet keine eigene Fläche, folgt seine Grenze den Untergebieten (Legacys Kreis ◐ oder ●). */
const abgeleitet = computed(() => zeile.value !== undefined && !zeile.value.area && zeile.value.circle !== "leer");
/** „Neue Fläche“ (C3) an diesem Gebiet: zeichnen dürfen, nicht gelöscht. */
const zeichnet = computed(() => props.zeichnen === true && detail.value !== undefined && !geloescht.value);
/** „Grenze zeichnen“ (Frage 4): ohne eigene Fläche im Anzeigejahr, auch mit abgeleiteter Grenze (◐, ●). */
const grenzeMoeglich = computed(
    () =>
        zeichnet.value &&
        detail.value?.revision !== undefined &&
        detail.value.areas.every((flaeche) => flaeche.notInYear === true),
);
function grenzeZeichnen(): void {
    const d = detail.value;
    if (d?.revision !== undefined) emit("grenze", { id: d.id, name: d.name, revision: d.revision });
}
const spanne = (von: number | undefined, bis: number | undefined): string =>
    t("gebietseditor.unter.spanne", { von: von ?? 0, bis: bis ?? 8 });
const jahrText = (wert: number | undefined): string =>
    wert === undefined || wert === 9999 ? t("gebietseditor.gueltig.offen") : t("gebietseditor.jahr.bf", { jahr: wert });
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
        :zusatz="nurLesen ? t('editorPanel.verb.lesen') : undefined"
        :testid="kennung"
        @update:lage="(neu, box) => emit('lage', neu, box)"
        @update:box="(box) => emit('box', box)"
        @vorn="emit('vorn')"
    >
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'liste'"
            :id="`${kennung}-listenspalte`"
            :titel="t('gebietseditor.liste')"
            breite="inspektor"
            :telefon="phoneViewport"
            :einziehbar="!phoneViewport"
            :inert="zu || undefined"
            :schliessen="t('fenster.liste.schliessen')"
            :testid="`${kennung}-liste`"
            @schliesse="phoneViewport ? (telefonSeite = 'eigenschaften') : emit('listeZu', true)"
        >
            <p v-if="ladeFehler" class="gebietseditor__leer">
                {{ ladeFehler }}
                <button type="button" class="gebietseditor__verweis" @click="emit('erneut')">
                    {{ t("editorListe.erneut") }}
                </button>
            </p>
            <p v-else-if="!liste" class="gebietseditor__leer">{{ t("gebietseditor.laedt") }}</p>
            <EditorListe
                v-else
                v-model:gewaehlt="gewaehlt"
                :zeilen="zeilen"
                :optionen="optionen"
                :facetten-name="facettenName"
                :wert-name="wertNameImJahr"
                :sortierungen="sortierungen"
                :legende="legende"
                :leer-text="t('gebietseditor.leer')"
                :kennung="`${kennung}-gebiete`"
                :beschriftung="t('gebietseditor.liste')"
                :einstellung="einstellung"
                :ablegen="ablegen"
                :mehrfach="mehrfachauswahl ? mehrfachAn : undefined"
                :angehakt="angehakt"
                @update:mehrfach="(an: boolean | undefined) => mehrfachauswahl?.setzeAn(an === true)"
                @update:angehakt="(ids: readonly string[]) => mehrfachauswahl?.setzeAngehakt(ids)"
                @oeffne="fliege"
            />
            <p v-if="phoneViewport && sammel" class="gebietseditor__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :testid="`${kennung}-mehrfach-zeigen`"
                    @click="telefonSeite = 'eigenschaften'"
                >
                    {{ t("gebietseditor.sammel.zeigen", { n: formatNumber(sammel.ids.length, 0) }) }}
                </AvmKnopf>
            </p>
        </FensterSpalte>
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'eigenschaften'"
            :titel="t('gebietseditor.eigenschaften')"
            breite="fuellen"
            :telefon="phoneViewport"
            :testid="`${kennung}-eigenschaften-spalte`"
        >
            <template #zurueck>
                <button
                    v-if="phoneViewport"
                    type="button"
                    class="gebietseditor__verweis"
                    @click="telefonSeite = 'liste'"
                >
                    {{ t("ortseditor.zurListe") }}
                </button>
                <button
                    v-else
                    type="button"
                    class="gebietseditor__listenschalter"
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
            <template v-if="sammel">
                <FensterReiter
                    model-value="eigenschaften"
                    :reiter="reiterMehrfach"
                    :beschriftung="t('gebietseditor.reiter')"
                    :kennung="kennung"
                />
                <div
                    :id="`${kennung}-inhalt-eigenschaften`"
                    class="gebietseditor__rumpf"
                    role="tabpanel"
                    :data-testid="`${kennung}-eigenschaften`"
                >
                    <GebietMehrfach
                        :sammel="sammel"
                        :zeilen="liste?.rows ?? []"
                        :kennung="kennung"
                        :entfernen="darf === true && darfForm === true && entferne !== undefined"
                        :form-frei="darfForm === true"
                    />
                </div>
            </template>
            <p v-else-if="mehrfachAn && angehakt.length === 0" class="gebietseditor__leer">
                {{ t("gebietseditor.sammel.anhaken") }}
            </p>
            <p v-else-if="!zeile" class="gebietseditor__leer">{{ t("gebietseditor.keineWahl") }}</p>
            <template v-else>
                <div class="gebietseditor__name">
                    <GebietFarbfeld :farbe="zeile.color" />
                    <strong>{{ zeile.name }}</strong>
                    <small>{{ artName(zeile.type) }}</small>
                </div>
                <div v-if="geloescht" class="gebietseditor__stand" :data-testid="`${kennung}-stand`">
                    <span>{{ t("gebietseditor.stand.band") }}</span>
                    <AvmKnopf
                        v-if="reiter !== 'verlauf'"
                        groesse="zeile"
                        :testid="`${kennung}-zum-verlauf`"
                        @click="reiter = 'verlauf'"
                    >
                        {{ t("gebietseditor.reiter.verlauf") }}
                    </AvmKnopf>
                </div>
                <div
                    v-if="obergebietMeldung"
                    class="gebietseditor__meldung"
                    role="status"
                    :data-testid="`${kennung}-obergebiet-meldung`"
                >
                    <span>{{
                        t("gebietseditor.sammel.oberAngelegt", {
                            name: obergebietMeldung.name,
                            n: formatNumber(obergebietMeldung.anzahl, 0),
                        })
                    }}</span>
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="zurueckSendet ? t('gebietseditor.entfernen.sendet') : undefined"
                        :testid="`${kennung}-obergebiet-zurueck`"
                        @click="obergebietZurueck"
                    >
                        {{ t("gebietseditor.sammel.oberZurueck") }}
                    </AvmKnopf>
                    <span v-if="zurueckSatz" role="alert">{{ zurueckSatz }}</span>
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
                    :beschriftung="t('gebietseditor.reiter')"
                    :kennung="kennung"
                />
                <div
                    :id="`${kennung}-inhalt-${reiter}`"
                    class="gebietseditor__rumpf"
                    role="tabpanel"
                    :data-testid="`${kennung}-${reiter}`"
                >
                    <p v-if="detailFehler" class="gebietseditor__leer">{{ detailFehler }}</p>
                    <p v-else-if="!detail || detail.id !== zeile.id" class="gebietseditor__leer">
                        {{ t("gebietseditor.detailLaedt") }}
                    </p>
                    <GebietEigenschaften
                        v-else-if="reiter === 'eigenschaften'"
                        :detail="detail"
                        :jahr="jahr"
                        :kennung="kennung"
                        :befunde="befundeAuswahl"
                        :bearbeitung="schreibt ? bearbeitung : undefined"
                        :form-frei="darfForm === true"
                        :farbe="
                            baender && baenderGrund === undefined && !geloescht
                                ? {
                                      jetzt: baender.stand.value.get(detail.id)?.farbe ?? detail.color,
                                      mitziehen: baender.mitziehen.value,
                                  }
                                : undefined
                        "
                        :gebiete="liste?.rows"
                        :umhaengen-nach="umhaengWunsch?.id === detail.id ? umhaengWunsch.ziel : undefined"
                        :entferne="
                            schreibt && darfForm === true && entferne
                                ? (stage: TerritoryRetireBody['stage'], children: TerritoryRetireBody['children']) =>
                                      entferne!(detail!.id, stage, children)
                                : undefined
                        "
                        :entfernen-gesperrt="
                            bearbeitung?.lage.value.aktiv ? t('gebietseditor.entfernen.erstFertig') : undefined
                        "
                        :name-markieren="nameMarkieren === detail.id"
                        :spanne="
                            baender && baenderGrund === undefined && !geloescht && darfForm === true
                                ? {
                                      jetzt: baender.stand.value.get(detail.id)?.spanne ?? {
                                          min: detail.minZoom,
                                          max: detail.maxZoom,
                                      },
                                      folgen: baender.spannenFolgen(detail.id),
                                      mitziehen: baender.mitziehen.value,
                                  }
                                : undefined
                        "
                        @name-markiert="emit('nameMarkiert')"
                        @umhaengen-erledigt="umhaengWunsch = undefined"
                        @farbe="(neu: string) => void baender?.faerbeGebiet(detail!.id, neu)"
                        @spanne="(neu: Spanne) => void baender?.spanneGebiet(detail!.id, neu)"
                        @mitziehen="(an: boolean) => emit('mitziehen', an)"
                        @waehle="waehle"
                        @reiter="(neu) => (reiter = neu)"
                        @wiki="wikiGeaendert"
                    />
                    <TraegerKarten v-else-if="reiter === 'karten'" :karten="karten" :kennung="kennung" />
                    <TraegerQuellen
                        v-else-if="reiter === 'quellen'"
                        :id="detail.id"
                        kind="territory"
                        :recht="quellenRecht === true"
                        :schreibt="schreibt"
                        :kennung="kennung"
                        @zahl="(n: number) => (quellenZahl = n)"
                        @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
                    />
                    <GebietBilder
                        v-else-if="reiter === 'bilder'"
                        :detail="detail"
                        :kennung="kennung"
                        :medien="medien"
                        :darf-aendern="schreibt"
                        @medien="emit('medien', detail.id, detail.name)"
                        @wappen="emit('wappen', detail.id)"
                    />
                    <section
                        v-else-if="reiter === 'untergebiete'"
                        class="gebietseditor__abschnitt"
                        :data-testid="`${kennung}-kinder`"
                    >
                        <h4 class="gebietseditor__titel">{{ t("gebietseditor.feld.untergebiete") }}</h4>
                        <p v-if="abgeleitet" class="gebietseditor__leer">
                            {{ t("gebietseditor.untergebiete.abgeleitet", { name: detail.name }) }}
                        </p>
                        <p v-if="kinder.length === 0" class="gebietseditor__leer">
                            {{ t("gebietseditor.untergebiete.leer") }}
                        </p>
                        <p v-if="zeichnet" class="gebietseditor__knoepfe">
                            <AvmKnopf
                                groesse="zeile"
                                :testid="`${kennung}-untergebiet-anlegen`"
                                @click="emit('untergebiet', { id: detail.id, name: detail.name })"
                            >
                                {{ t("gebietseditor.neu.untergebiet") }}
                            </AvmKnopf>
                        </p>
                        <ul v-if="kinder.length > 0" class="gebietseditor__kinder">
                            <li v-for="kind in kinder" :key="kind.id">
                                <button
                                    type="button"
                                    class="gebietseditor__kind"
                                    :data-testid="`${kennung}-kind`"
                                    @click="waehle(kind.id)"
                                    @dblclick="fliege(kind.id)"
                                >
                                    <GebietFarbfeld :farbe="kind.zeile?.color ?? 'transparent'" />
                                    <span class="gebietseditor__kindname einzeilig">{{ kind.name }}</span>
                                    <small>{{
                                        kind.zeile
                                            ? `${artName(kind.zeile.type)} · ${spanne(kind.zeile.minZoom, kind.zeile.maxZoom)}`
                                            : ""
                                    }}</small>
                                </button>
                            </li>
                        </ul>
                    </section>
                    <GebietHierarchie
                        v-else-if="reiter === 'hierarchie'"
                        :hierarchie="geloescht ? undefined : hierarchie"
                        :fehler="geloescht ? t('gebietseditor.stand.hierarchie') : hierarchieFehler"
                        :wurzel="detail.id"
                        :jahr="jahr"
                        :kennung="kennung"
                        :baender="baender"
                        :grund="baenderGrund"
                        @waehle="waehle"
                        @band="(band: number) => emit('band', band)"
                        @mitziehen="(an: boolean) => emit('mitziehen', an)"
                    />
                    <EntwurfVerlauf
                        v-else-if="reiter === 'verlauf' && bearbeitung"
                        :verlauf="bearbeitung.verlauf"
                        :kennung="kennung"
                        :feld-name="verlaufFeldName"
                        :wert="verlaufWert"
                        :quellen="{
                            ziel: { kind: 'territory', id: detail.id },
                            recht: quellenRecht === true,
                            schreibt,
                        }"
                    />
                    <template v-else>
                        <section class="gebietseditor__abschnitt" :data-testid="`${kennung}-flaechen`">
                            <h4 class="gebietseditor__titel">{{ t("gebietseditor.reiter.form") }}</h4>
                            <p v-if="detail.areas.length === 0" class="gebietseditor__leer">
                                {{
                                    abgeleitet
                                        ? t("gebietseditor.form.abgeleitet")
                                        : t("gebietseditor.form.nichtAufKarte")
                                }}
                            </p>
                            <FensterFeldzeilen v-else>
                                <dt>{{ t("gebietseditor.form.flaechen") }}</dt>
                                <dd>{{ formatNumber(detail.areas.length, 0) }}</dd>
                            </FensterFeldzeilen>
                            <p v-if="zeile.bounds" class="gebietseditor__knoepfe">
                                <button
                                    type="button"
                                    class="gebietseditor__verweis"
                                    :data-testid="`${kennung}-hinfliegen`"
                                    @click="fliege(zeile.id)"
                                >
                                    {{ t("gebietseditor.form.hinfliegen") }}
                                </button>
                            </p>
                            <p v-if="grenzeMoeglich" class="gebietseditor__knoepfe">
                                <AvmKnopf
                                    groesse="zeile"
                                    :testid="`${kennung}-grenze-zeichnen`"
                                    @click="grenzeZeichnen"
                                >
                                    {{ t("gebietseditor.neu.grenzeZeichnen") }}
                                </AvmKnopf>
                            </p>
                        </section>
                        <section
                            v-for="(flaeche, i) in detail.areas"
                            :key="flaeche.id"
                            class="gebietseditor__abschnitt"
                            :data-testid="`${kennung}-flaeche`"
                        >
                            <h4 class="gebietseditor__titel">{{ t("gebietseditor.form.flaeche", { n: i + 1 }) }}</h4>
                            <FensterFeldzeilen>
                                <dt>{{ t("gebietseditor.feld.zoomspanne") }}</dt>
                                <dd>
                                    {{
                                        flaeche.minZoom === undefined && flaeche.maxZoom === undefined
                                            ? t("gebietseditor.form.wieGebiet")
                                            : spanne(flaeche.minZoom, flaeche.maxZoom)
                                    }}
                                </dd>
                                <dt>{{ t("gebietseditor.feld.gueltigAb") }}</dt>
                                <dd>{{ jahrText(flaeche.validFromBf) }}</dd>
                                <dt>{{ t("gebietseditor.feld.gueltigBis") }}</dt>
                                <dd>{{ jahrText(flaeche.validToBf) }}</dd>
                            </FensterFeldzeilen>
                            <p v-if="flaeche.notInYear" class="gebietseditor__leer">
                                {{ t("gebietseditor.jahr.giltNicht", { jahr }) }}
                            </p>
                            <p v-if="flaeche.invalid" class="gebietseditor__leer">
                                {{ t("gebietseditor.form.ungueltig") }}
                            </p>
                        </section>
                    </template>
                </div>
            </template>
        </FensterSpalte>
        <template v-if="fussEntwurf" #fuss-hinweis>
            <EntwurfFuss :bearbeitung="fussEntwurf" teil="hinweis" :testid="kennung" />
        </template>
        <template v-if="fussEntwurf" #fuss-haupt>
            <EntwurfFuss :bearbeitung="fussEntwurf" teil="haupt" :testid="kennung" />
        </template>
    </AvmFenster>
</template>

<style scoped>
.gebietseditor__name {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-4);
    align-items: center;
}

.gebietseditor__name strong {
    min-width: 0;
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.gebietseditor__name small {
    grid-column: 2;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Wie das Band der Kraftlinien (`kraftlinieneditor__stand`). */
.gebietseditor__stand {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

/* Wie das Band „gelöscht“, in den ruhigen Tönen einer Meldung. */
.gebietseditor__meldung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
    color: var(--color-text);
}

.gebietseditor__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

/* Wie die Abschnitte des Landschaftseditors, bis O3 sie in einen Baustein zieht. */
.gebietseditor__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.gebietseditor__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.gebietseditor__leer {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gebietseditor__knoepfe {
    margin: 0;
}

.gebietseditor__kinder {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
}

.gebietseditor__kind {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-4);
    align-items: center;
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.gebietseditor__kind:hover {
    background: var(--color-hover-wash);
}

.gebietseditor__kind:active {
    background: var(--color-active-wash);
}

.gebietseditor__kind:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.gebietseditor__kindname {
    min-width: 0;
}

.gebietseditor__kind small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.gebietseditor__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.gebietseditor__verweis:hover {
    color: var(--color-link-hover);
}

.gebietseditor__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* « » wie im Landschaftseditor, bis O3 ihn in einen Baustein zieht. */
.gebietseditor__listenschalter {
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

.gebietseditor__listenschalter:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.gebietseditor__listenschalter:active {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.gebietseditor__listenschalter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
