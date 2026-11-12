<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
    GEBIRGS_HOEHENSTUFEN,
    GEBIRGS_KAMMHOEHE,
    GEBIRGS_MODELL_GRENZEN,
    GEBIRGS_MODELL_SPALTE,
    GEBIRGS_MODELL_WERTE,
    GEBIRGS_MUSTER,
    GEBIRGS_WERT_GRENZEN,
    GEBIRGS_WERTE,
    GEBIRGSTYPEN,
    type GebirgsMuster,
    type GebirgsPresetGruppe,
    type EditorGebirge,
    type EditorGebirgeProfile,
    type EditorLandscapePeak,
    type GebirgsModellWert,
    type GebirgsWert,
    type Gebirgstyp,
} from "@avesmaps3d/shared";
import AvmFeld from "../controls/avm-feld.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { formatNumber, t } from "../i18n/i18n";
import GebirgeGipfel from "./gebirge-gipfel.vue";
import { kaemmeAnzeigen, kartenvorschau } from "./gebirge-anzeige";
import GebirgeGewaesser from "./gebirge-gewaesser.vue";
import { werteEinfuegen, werteText, type WerteLage } from "./gebirge-werte-text";
import GebirgeKachelZeichen from "./gebirge-kachel-zeichen.vue";
import GebirgeVorschauGross from "./gebirge-vorschau-gross.vue";
import GebirgeWertzeile from "./gebirge-wertzeile.vue";
import {
    abweichungen,
    aehnlichsterTyp,
    begrenzt,
    geltendeKammhoehe,
    geltenderModellwert,
    geltenderWert,
    geltendesMuster,
    hatKaemme,
    mitModellwert,
    mitMuster,
    mitTyp,
    mitWert,
    modellPreset,
    ohneModellwert,
    ohneWert,
    presetMuster,
    presetWert,
    stufeMit,
    weichtAb,
    weichtModellAb,
    type GebirgsEntwurf,
} from "./gebirge-stand";

/**
 * Der Reiter „Gebirge“ der Derographie (WI-0178 P4; Bauvorlage Fassung 16, abgenommen 2026-10-18; Vertrag WI-0226), nur an Gebirgen:
 * Typ → Höhe → Werte · Preset, darunter „Wann es wirkt“. Jede Wahl ist ein Schritt im EINEN Entwurf der Fläche (`aendere`); „Fertig“
 * schreibt sie mit den übrigen Feldern (`landscape.update`, `gebirge`). Gipfelliste (P5) und Vorschau (P6) kommen dazu.
 *
 * - **Typ** als Kacheln (F1); ein Wechsel nimmt die Abweichungen zurück, „Keins passt“ behält die geltenden Werte als eigene.
 * - **Höhe des Kamms** (Betreiber 2026-10-18: der wichtigste Wert): Feld im Goldenen Schnitt, ↺ am Zeilenende zurück auf die Grundhöhe,
 *   die Höhenstufen als Schnellwahl (Form A).
 * - **Werte** als Abweichung vom Preset (F2): die starken offen, die schwachen unter „Feinabstimmung“; ↺ je Zeile, „Preset …“ darunter.
 * - **Noch nicht in der Fassung** (`presetQuelle` „vorgabe“): Der Reiter zeigt die Vorgabe der Presets und sagt, dass der Typ erst mit
 *   der Fassung 19 wirkt (Editor-Orchestrierung 2026-10-18).
 * - **Rückennetz** (WI-0245, Bauplan Gebirge D3; Entwurf V16): Hat das Gebirge gezeichnete Kämme, stehen nach den starken Werten
 *   Gratlinie, Gratbreite und Talboden, Preset ist der Vorschlag des Typs (Tooltip am Talboden: „hebt die Masse, kostet Grat“).
 */
const props = defineProps<{
    stand: GebirgsEntwurf;
    /** Der gelesene Stand: Ihm am nächsten liegt das Preset mit der Marke „ähnlichstes“. */
    gelesen: GebirgsEntwurf;
    presets: GebirgsPresetGruppe;
    presetQuelle: "fassung" | "vorgabe";
    grundhoehe: number | null;
    /** Der Satz, warum gerade nichts geändert werden kann; gesetzt heißt gesperrt. */
    gesperrt?: string | undefined;
    /** Die Gipfel in der Fläche (P5) und ihre Höhen im Entwurf. */
    peaks: readonly EditorLandscapePeak[];
    gipfelHoehen: Readonly<Record<string, number>>;
    /** Der Name des Gebirges (Kopf von „Werte kopieren“). */
    gebirgeName?: string | undefined;
    gipfelGesperrt?: ((id: string) => string | undefined) | undefined;
    /** Der Satz zur Vorschau auf der Karte (P6), solange sie steht. */
    vorschau?: string | undefined;
    /** Der Talboden, den die Vorschau des Rückennetzes abgeleitet hat (WI-0245 D4); er steht da, solange kein eigener gesetzt ist. */
    talbodenAbgeleitet?: number | undefined;
    /** Das Bild der Vorschau für die große Vorschau oben im Reiter (V1, Bauvorlage V16/V17). */
    vorschauBild?: { url: string; ecken: [number, number][]; hoechste?: number } | undefined;
    /** Läuft „Kämme zeichnen“? Dann gilt das Rückennetz, „V12 heute“ ist gesperrt. */
    kaemmeLaufen?: boolean | undefined;
    /** Die Eingabe der Vorschau (Umriss, Flüsse, Seen, Gipfel); ohne sie steht die große Vorschau nicht. */
    eingabe?: EditorGebirge["eingabe"] | undefined;
    /** Die Höhenprofile der Flüsse und Pässe (WI-0245); ohne sie stehen die Abschnitte ohne Kurve. */
    profile?: EditorGebirgeProfile | undefined;
    kennung: string;
}>();
const emit = defineEmits<{
    aendere: [stand: GebirgsEntwurf, verschmelze?: string];
    gipfelHoehe: [id: string, hoehe: number];
    gipfelOeffnen: [id: string];
    gipfelZeigen: [id: string | undefined];
    /** ⌖ am Gipfel: die Kamera fliegt hin. */
    gipfelZiel: [id: string];
    /** „Kämme zeichnen“ (WI-0245 D2): der Modus auf der Karte. */
    kaemme: [];
    /** „Werte einfügen“: Stand und Gipfelhöhen als EIN Schritt im Entwurf. */
    einfuegen: [stand: GebirgsEntwurf, gipfelHoehen: Record<string, number>];
    /** ⌖ an Fluss, See oder Pass: die Kamera fliegt zu diesem Rahmen. */
    fliege: [bounds: [number, number, number, number]];
    /** Name als Link an Fluss, See oder Pass: das Objekt öffnen. */
    objekt: [art: "weg" | "landschaft", id: string];
}>();
const aufloesung = defineModel<1 | 2 | 4>("aufloesung", { default: 1 });

const typName = (typ: Gebirgstyp | null): string =>
    typ === null ? t("landschaftseditor.gebirge.typ.keins") : t(`landschaftseditor.gebirge.typ.${typ}`);
const typSatz = (typ: Gebirgstyp | null): string =>
    typ === null ? t("landschaftseditor.gebirge.typ.keinsSatz") : t(`landschaftseditor.gebirge.satz.${typ}`);

const TYPEN: readonly (Gebirgstyp | null)[] = [...GEBIRGSTYPEN, null];
const FORM = GEBIRGS_WERTE.filter((wert) => GEBIRGS_WERT_GRENZEN[wert].gruppe === "form");
const FEIN = GEBIRGS_WERTE.filter((wert) => GEBIRGS_WERT_GRENZEN[wert].gruppe === "fein");

const aehnlichstes = computed(() => aehnlichsterTyp(props.gelesen, props.presets));
const kamm = computed(() => geltendeKammhoehe(props.stand, props.grundhoehe));
const eigeneHoehe = computed(() => props.stand.kammhoehe !== null);
const abgeleitet = computed(() => geltendeKammhoehe({ ...props.stand, kammhoehe: null }, props.grundhoehe));
const muster = computed(() => geltendesMuster(props.stand, props.presets));
const musterWeicht = computed(() => props.stand.typ !== null && props.stand.muster !== null);
const wertTitel = computed(() => {
    if (props.stand.typ === null) return t("landschaftseditor.gebirge.werte.eigene");
    const n = abweichungen(props.stand, props.presets);
    return n === 0
        ? t("landschaftseditor.gebirge.werte.titel", { typ: typName(props.stand.typ) })
        : t("landschaftseditor.gebirge.werte.abweichend", {
              typ: typName(props.stand.typ),
              n: formatNumber(n, 0),
          });
});

function waehleTyp(typ: Gebirgstyp | null): void {
    if (typ !== props.stand.typ) emit("aendere", mitTyp(props.stand, props.presets, typ));
}
function setzeKamm(roh: string): void {
    const wert = Math.round(Number(roh));
    if (roh.trim() === "" || !Number.isFinite(wert)) return;
    const neu = Math.min(GEBIRGS_KAMMHOEHE.max, Math.max(GEBIRGS_KAMMHOEHE.min, wert));
    if (neu !== kamm.value) emit("aendere", { ...props.stand, kammhoehe: neu }, "gebirge.kamm");
}
/** Ein Wert der V12: in seine Grenzen gelegt, ein Zug in Folge verschmilzt zu EINEM Schritt. */
function setzeWert(wert: GebirgsWert, roh: number): void {
    const neu = begrenzt(wert, roh);
    if (neu !== undefined && neu !== geltenderWert(props.stand, props.presets, wert))
        emit("aendere", mitWert(props.stand, props.presets, wert, neu), `gebirge.${wert}`);
}
/** Die Werte des Rückennetzes (WI-0245): nur, wenn das Gebirge Kämme hat; Namen und Sätze unter dem Spaltennamen. */
/** Unten links in der Vorschau (Betreiber 2026-10-21: „im preview unten links kannst du dann z.B. Kämme 3 · Nebengipfel 36 stehen haben“). */
const netzZahl = computed(
    () =>
        t("landschaftseditor.verlauf.netz", {
            kaemme: formatNumber(props.stand.netz?.kaemme.filter((k) => k.rang !== "tal").length ?? 0, 0),
            gipfel: formatNumber(props.stand.netz?.nebengipfel.length ?? 0, 0),
        }) +
        (props.stand.netz?.kaemme.some((k) => k.rang === "tal")
            ? ` · ${t("landschaftseditor.kaemme.rang.tal")} ${formatNumber(props.stand.netz.kaemme.filter((k) => k.rang === "tal").length, 0)}`
            : "") +
        ((props.stand.netz?.mulden?.length ?? 0) > 0
            ? ` · ${t("landschaftseditor.kaemme.werkzeug.mulde")} ${formatNumber(props.stand.netz!.mulden!.length, 0)}`
            : ""),
);
// Die Erosionsfestigkeit hat ihren eigenen Kasten zwischen „Höhe“ und „Werte“ (WI-0249), nicht eine Zeile der Werte des Rückennetzes.
const modellZeilen = computed(() =>
    hatKaemme(props.stand) ? GEBIRGS_MODELL_WERTE.filter((wert) => wert !== "erosionsfestigkeit") : [],
);
const modellName = (wert: GebirgsModellWert): string =>
    t(`landschaftseditor.gebirge.wert.${GEBIRGS_MODELL_SPALTE[wert]}`);
const modellSatz = (wert: GebirgsModellWert): string =>
    t(`landschaftseditor.gebirge.wertSatz.${GEBIRGS_MODELL_SPALTE[wert]}`);
/** Was eine Zeile des Rückennetzes zeigt: der eigene Wert, beim Talboden ohne eigenen der abgeleitete (zwei Stellen), sonst das Preset. */
function modellGilt(wert: GebirgsModellWert): number {
    if (wert === "talboden" && props.stand.modell?.talboden === undefined && props.talbodenAbgeleitet !== undefined)
        return Math.round(props.talbodenAbgeleitet * 100) / 100;
    return geltenderModellwert(props.stand, props.presets, wert);
}
function setzeModell(wert: GebirgsModellWert, roh: number): void {
    const neu = mitModellwert(props.stand, props.presets, wert, roh);
    if (neu !== props.stand) emit("aendere", neu, `gebirge.${wert}`);
}
// --- „Werte kopieren“ und „Werte einfügen“ (Bauvorlage V16): ein lesbarer Text, auch an einem anderen Gebirge einfügbar ---
const werteLage = (): WerteLage => ({
    name: props.gebirgeName ?? "",
    saat: saat.value,
    stand: props.stand,
    presets: props.presets,
    kammhoehe: kamm.value,
    talbodenAbgeleitet: props.talbodenAbgeleitet,
    peaks: props.peaks.map((p) => ({ id: p.id, name: p.name, height: p.height })),
    gipfelHoehen: props.gipfelHoehen,
});
const textMeldung = ref<string | undefined>(undefined);
const textFeld = ref<{ art: "kopieren" | "einfuegen"; inhalt: string } | undefined>(undefined);
const textElement = ref<HTMLTextAreaElement>();
let meldungZeit: ReturnType<typeof setTimeout> | undefined;
function melde(text: string): void {
    clearTimeout(meldungZeit);
    textMeldung.value = text;
    meldungZeit = setTimeout(() => (textMeldung.value = undefined), 5000);
}
async function kopiere(): Promise<void> {
    const text = werteText(werteLage());
    try {
        await navigator.clipboard.writeText(text);
        textFeld.value = undefined;
        melde(t("landschaftseditor.gebirge.text.kopiert"));
    } catch {
        // Verweigert die Ansicht die Zwischenablage, steht der Text markiert da (Strg+C).
        textFeld.value = { art: "kopieren", inhalt: text };
        melde(t("landschaftseditor.gebirge.text.gesperrt"));
        await nextTick();
        textElement.value?.select();
    }
}
async function fuegeEin(): Promise<void> {
    try {
        const text = await navigator.clipboard.readText();
        if (text.trim() !== "") {
            uebernimm(text);
            return;
        }
    } catch {
        // weiter mit dem Feld
    }
    textFeld.value = { art: "einfuegen", inhalt: "" };
    melde(t("landschaftseditor.gebirge.text.feld"));
    await nextTick();
    textElement.value?.focus();
}
function uebernimm(text: string): void {
    const r = werteEinfuegen(text, werteLage());
    if (r.gesetzt === 0) {
        melde(t("landschaftseditor.gebirge.text.nichts"));
        return;
    }
    textFeld.value = undefined;
    emit("einfuegen", r.stand, r.gipfelHoehen);
    melde(
        t("landschaftseditor.gebirge.text.eingefuegt", { n: formatNumber(r.gesetzt, 0) }) +
            (r.uebersprungen.length > 0
                ? ` · ${t("landschaftseditor.gebirge.text.uebersprungen", { n: formatNumber(r.uebersprungen.length, 0) })}`
                : ""),
    );
}
/** Die Saat, die gilt: die gewürfelte im Entwurf, sonst die abgeleitete der Eingabe (Kennung und Revision der Fläche). */
const saat = computed(() => props.stand.saat ?? props.eingabe?.saat);
/** „⟳ neu würfeln“ (Entwurf V16/V17, Migration 0214): eine neue Saat im Entwurf; die Vorschau rechnet sie sofort. */
function wuerfle(): void {
    const zahl = new Int32Array(1);
    crypto.getRandomValues(zahl);
    emit("aendere", { ...props.stand, saat: zahl[0]! });
}
function waehleMuster(neu: GebirgsMuster): void {
    if (neu !== muster.value) emit("aendere", mitMuster(props.stand, props.presets, neu));
}
const ereignisWert = (ereignis: Event): string => (ereignis.target as HTMLInputElement).value;
const splitPane = ref<HTMLElement>();
const vorschauAnteil = ref(55);
const trennStyle = computed(() => ({
    gridTemplateRows: `minmax(0, ${vorschauAnteil.value}fr) var(--space-12) minmax(0, ${100 - vorschauAnteil.value}fr)`,
}));
let trennt = false;
function trenne(ereignis: PointerEvent): void {
    if (!trennt || !splitPane.value) return;
    const box = splitPane.value.getBoundingClientRect();
    if (box.height > 0)
        vorschauAnteil.value = Math.max(20, Math.min(80, ((ereignis.clientY - box.top) / box.height) * 100));
}
function trennenStart(ereignis: PointerEvent): void {
    if (ereignis.button !== 0) return;
    ereignis.preventDefault();
    trennt = true;
    (ereignis.currentTarget as HTMLElement).setPointerCapture(ereignis.pointerId);
}
function trennenTaste(ereignis: KeyboardEvent): void {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(ereignis.key)) return;
    ereignis.preventDefault();
    vorschauAnteil.value =
        ereignis.key === "Home"
            ? 20
            : ereignis.key === "End"
              ? 80
              : Math.max(20, Math.min(80, vorschauAnteil.value + (ereignis.key === "ArrowUp" ? -5 : 5)));
}
</script>

<template>
    <div ref="splitPane" class="gebirge" :style="trennStyle" :data-testid="`${kennung}-gebirge`">
        <!--
            Drei Umschalter über der Vorschau (Betreiber 2026-10-21): Kämme zeichnen · Kämme anzeigen · Kartenvorschau, in EINER Zeile; die
            Hinweise stehen als Tooltip am Knopf („mach die zeile lieber weg (der hinweis kann auch als tooltip über den button kommen)“).
        -->
        <!-- Zwei feste Bereiche; die Trennlinie skaliert das Preview, nur die Eigenschaften scrollen. -->
        <div class="gebirge__oben">
            <div class="gebirge__schalter" role="group" :aria-label="t('landschaftseditor.gebirge.anzeige.titel')">
                <AvmKnopf
                    class="gebirge__umschalter"
                    breit
                    :art="kaemmeLaufen ? 'gefuellt' : 'weich'"
                    :aria-pressed="kaemmeLaufen === true"
                    :gesperrt="kaemmeLaufen ? undefined : gesperrt"
                    :title="gesperrt ?? t('landschaftseditor.kaemme.satz')"
                    :testid="`${kennung}-gebirge-kaemme-zeichnen`"
                    @click="emit('kaemme')"
                >
                    <span class="einzeilig">{{ t("landschaftseditor.kaemme.titel") }}</span>
                </AvmKnopf>
                <AvmKnopf
                    class="gebirge__umschalter"
                    breit
                    :art="kaemmeAnzeigen ? 'gefuellt' : 'weich'"
                    :aria-pressed="kaemmeAnzeigen"
                    :testid="`${kennung}-gebirge-kaemme-anzeigen`"
                    @click="kaemmeAnzeigen = !kaemmeAnzeigen"
                >
                    <span class="einzeilig">{{ t("landschaftseditor.gebirge.anzeige.kaemme") }}</span>
                </AvmKnopf>
                <AvmKnopf
                    class="gebirge__umschalter"
                    breit
                    :art="kartenvorschau ? 'gefuellt' : 'weich'"
                    :aria-pressed="kartenvorschau"
                    :title="t('landschaftseditor.gebirge.anzeige.karteSatz')"
                    :testid="`${kennung}-gebirge-kartenvorschau`"
                    @click="kartenvorschau = !kartenvorschau"
                >
                    <span class="einzeilig">{{ t("landschaftseditor.gebirge.anzeige.karte") }}</span>
                </AvmKnopf>
            </div>
            <GebirgeVorschauGross
                v-model:aufloesung="aufloesung"
                v-if="eingabe"
                :bild="vorschauBild"
                :eingabe="eingabe"
                :netz="kaemmeAnzeigen ? stand.netz : undefined"
                :zahl="netzZahl"
                :peaks="peaks"
                :gipfel-hoehen="gipfelHoehen"
                :satz="vorschau"
                :kennung="kennung"
            />
        </div>
        <div
            class="gebirge__trenner"
            role="separator"
            tabindex="0"
            aria-orientation="horizontal"
            :aria-label="t('landschaftseditor.gebirge.anzeige.titel')"
            :aria-valuenow="Math.round(vorschauAnteil)"
            :aria-valuemin="20"
            :aria-valuemax="80"
            :aria-controls="`${kennung}-gebirge-werte`"
            @pointerdown="trennenStart"
            @pointermove="trenne"
            @pointerup="trennt = false"
            @pointercancel="trennt = false"
            @lostpointercapture="trennt = false"
            @keydown="trennenTaste"
        >
            <span aria-hidden="true" />
        </div>
        <div :id="`${kennung}-gebirge-werte`" class="gebirge__werte">
            <section class="gebirge__kasten">
                <h4 class="gebirge__titel">{{ t("landschaftseditor.gebirge.typ.titel") }}</h4>
                <div class="gebirge__kacheln" role="radiogroup" :aria-label="t('landschaftseditor.gebirge.typ.titel')">
                    <button
                        v-for="typ in TYPEN"
                        :key="typ ?? 'keins'"
                        type="button"
                        role="radio"
                        class="gebirge__kachel"
                        :class="{ 'is-an': stand.typ === typ }"
                        :aria-checked="stand.typ === typ"
                        :title="`${typName(typ)}: ${typSatz(typ)}`"
                        :disabled="gesperrt !== undefined"
                        :data-testid="`${kennung}-gebirge-typ-${typ ?? 'keins'}`"
                        @click="waehleTyp(typ)"
                    >
                        <span class="gebirge__kachelbild" aria-hidden="true"><GebirgeKachelZeichen :typ="typ" /></span>
                        <span class="gebirge__kachelname">{{ typName(typ) }}</span>
                        <small v-if="typ !== null && typ === aehnlichstes" class="gebirge__marke">{{
                            t("landschaftseditor.gebirge.typ.aehnlichstes")
                        }}</small>
                    </button>
                </div>
                <p class="gebirge__hinweis">
                    {{
                        t("landschaftseditor.gebirge.typ.hinweis", {
                            typ: typName(stand.typ),
                            satz: typSatz(stand.typ),
                        })
                    }}
                </p>
                <p v-if="aehnlichstes !== undefined" class="gebirge__hinweis">
                    {{ t("landschaftseditor.gebirge.typ.aehnlichstesSatz") }}
                </p>
                <p
                    v-if="presetQuelle === 'vorgabe'"
                    class="gebirge__hinweis"
                    :data-testid="`${kennung}-gebirge-vorgabe`"
                >
                    {{ t("landschaftseditor.gebirge.typ.ohneFassung") }}
                </p>
            </section>

            <section class="gebirge__kasten" :data-testid="`${kennung}-gebirge-hoehe`">
                <h4 class="gebirge__titel">
                    {{
                        t(
                            hatKaemme(stand)
                                ? "landschaftseditor.gebirge.hoeheErosion.titel"
                                : "landschaftseditor.gebirge.hoehe.titel",
                        )
                    }}
                </h4>
                <FensterFeldzeile
                    class="gebirge__zeile"
                    :class="{ 'is-abw': eigeneHoehe }"
                    :fuer="`${kennung}-gebirge-kamm`"
                    :titel="
                        eigeneHoehe
                            ? undefined
                            : grundhoehe === null
                              ? t('landschaftseditor.gebirge.hoehe.ohneGrund')
                              : t('landschaftseditor.gebirge.hoehe.grund')
                    "
                >
                    <template #beschriftung>
                        <span class="gebirge__name">{{ t("landschaftseditor.gebirge.hoehe.kamm") }}</span>
                    </template>
                    <span class="gebirge__feld">
                        <AvmFeld
                            :id="`${kennung}-gebirge-kamm`"
                            type="number"
                            :min="GEBIRGS_KAMMHOEHE.min"
                            :max="GEBIRGS_KAMMHOEHE.max"
                            :step="GEBIRGS_KAMMHOEHE.schritt"
                            :value="kamm"
                            :disabled="gesperrt !== undefined"
                            :data-testid="`${kennung}-gebirge-kamm`"
                            @change="(ereignis: Event) => setzeKamm(ereignisWert(ereignis))"
                        />
                        <span class="gebirge__einheit">{{ t("landschaftseditor.gebirge.hoehe.einheit") }}</span>
                        <small
                            v-if="eigeneHoehe"
                            class="gebirge__ableitung"
                            :data-testid="`${kennung}-gebirge-kamm-waere`"
                            >{{ t("landschaftseditor.gebirge.hoehe.waere", { n: formatNumber(abgeleitet, 0) }) }}</small
                        >
                    </span>
                    <template #zurueck>
                        <button
                            v-if="eigeneHoehe"
                            type="button"
                            class="gebirge__zurueck"
                            :title="t('landschaftseditor.gebirge.hoehe.zurueck', { n: formatNumber(abgeleitet, 0) })"
                            :aria-label="
                                t('landschaftseditor.gebirge.hoehe.zurueck', { n: formatNumber(abgeleitet, 0) })
                            "
                            :disabled="gesperrt !== undefined"
                            :data-testid="`${kennung}-gebirge-kamm-zurueck`"
                            @click="emit('aendere', { ...stand, kammhoehe: null })"
                        >
                            ↺
                        </button>
                    </template>
                </FensterFeldzeile>
                <div class="gebirge__band" role="group" :aria-label="t('landschaftseditor.gebirge.hoehe.schnellwahl')">
                    <button
                        v-for="stufe in GEBIRGS_HOEHENSTUFEN"
                        :key="stufe"
                        type="button"
                        class="gebirge__stufe"
                        :aria-pressed="stufeMit(presets, kamm) === stufe"
                        :disabled="gesperrt !== undefined"
                        :data-testid="`${kennung}-gebirge-stufe-${stufe}`"
                        @click="setzeKamm(String(presets.hoehenstufen[stufe]))"
                    >
                        <small>{{ t(`landschaftseditor.gebirge.stufe.${stufe}`) }}</small>
                        <span>{{ formatNumber(presets.hoehenstufen[stufe], 0) }}</span>
                    </button>
                </div>
                <template v-if="hatKaemme(stand)">
                    <GebirgeWertzeile
                        schluessel="modell-erosionsfestigkeit"
                        :name="modellName('erosionsfestigkeit')"
                        :satz="modellSatz('erosionsfestigkeit')"
                        :grenze="GEBIRGS_MODELL_GRENZEN.erosionsfestigkeit"
                        :gilt="geltenderModellwert(stand, presets, 'erosionsfestigkeit')"
                        :preset="modellPreset(stand, presets, 'erosionsfestigkeit')"
                        :weicht="weichtModellAb(stand, presets, 'erosionsfestigkeit')"
                        :typ-name="typName(stand.typ)"
                        :gesperrt="gesperrt"
                        :kennung="kennung"
                        einheit="%"
                        :zurueck-text="t('landschaftseditor.gebirge.erosion.zurueck')"
                        @setze="(roh: number) => setzeModell('erosionsfestigkeit', roh)"
                        @zurueck="emit('aendere', ohneModellwert(stand, 'erosionsfestigkeit'))"
                    />
                    <p class="gebirge__hinweis" :data-testid="`${kennung}-gebirge-erosion`">
                        {{ modellSatz("erosionsfestigkeit") }}
                    </p>
                </template>
            </section>

            <section class="gebirge__kasten">
                <h4 class="gebirge__titel">{{ wertTitel }}</h4>
                <FensterFeldzeile
                    class="gebirge__zeile"
                    :class="{ 'is-abw': stand.saat !== undefined && stand.saat !== null }"
                    :titel="t('landschaftseditor.gebirge.saat.satz')"
                >
                    <template #beschriftung>
                        <span class="gebirge__name">{{ t("landschaftseditor.gebirge.saat.titel") }}</span>
                        <small v-if="stand.saat === undefined || stand.saat === null">{{
                            t("landschaftseditor.gebirge.saat.abgeleitet")
                        }}</small>
                    </template>
                    <span class="gebirge__saat">
                        <span class="gebirge__saatzahl" :data-testid="`${kennung}-gebirge-saat`">{{
                            saat === undefined ? "–" : String(saat)
                        }}</span>
                        <button
                            type="button"
                            class="gebirge__stufe"
                            :disabled="gesperrt !== undefined"
                            :data-testid="`${kennung}-gebirge-saat-wuerfeln`"
                            @click="wuerfle"
                        >
                            {{ t("landschaftseditor.gebirge.saat.wuerfeln") }}
                        </button>
                    </span>
                    <template #zurueck>
                        <button
                            v-if="stand.saat !== undefined && stand.saat !== null"
                            type="button"
                            class="gebirge__zurueck"
                            :title="t('landschaftseditor.gebirge.saat.zurueck')"
                            :aria-label="t('landschaftseditor.gebirge.saat.zurueck')"
                            :disabled="gesperrt !== undefined"
                            :data-testid="`${kennung}-gebirge-saat-zurueck`"
                            @click="emit('aendere', { ...stand, saat: null })"
                        >
                            ↺
                        </button>
                    </template>
                </FensterFeldzeile>
                <FensterFeldzeile
                    class="gebirge__zeile"
                    :class="{ 'is-abw': musterWeicht }"
                    :titel="t('landschaftseditor.gebirge.muster.satz')"
                >
                    <template #beschriftung>
                        <span class="gebirge__name">{{ t("landschaftseditor.gebirge.muster.titel") }}</span>
                        <small v-if="musterWeicht">{{
                            t("landschaftseditor.gebirge.wert.preset", {
                                n: t(`landschaftseditor.gebirge.muster.${presetMuster(stand, presets)}`),
                            })
                        }}</small>
                    </template>
                    <span
                        class="gebirge__segmente"
                        role="radiogroup"
                        :aria-label="t('landschaftseditor.gebirge.muster.titel')"
                    >
                        <button
                            v-for="art in GEBIRGS_MUSTER"
                            :key="art"
                            type="button"
                            role="radio"
                            class="gebirge__stufe"
                            :aria-checked="muster === art"
                            :disabled="gesperrt !== undefined"
                            :data-testid="`${kennung}-gebirge-muster-${art}`"
                            @click="waehleMuster(art)"
                        >
                            {{ t(`landschaftseditor.gebirge.muster.${art}`) }}
                        </button>
                    </span>
                    <template #zurueck>
                        <button
                            v-if="musterWeicht"
                            type="button"
                            class="gebirge__zurueck"
                            :title="t('landschaftseditor.gebirge.wert.zurueckPreset')"
                            :aria-label="t('landschaftseditor.gebirge.wert.zurueckPreset')"
                            :disabled="gesperrt !== undefined"
                            :data-testid="`${kennung}-gebirge-muster-zurueck`"
                            @click="emit('aendere', { ...stand, muster: null })"
                        >
                            ↺
                        </button>
                    </template>
                </FensterFeldzeile>
                <GebirgeWertzeile
                    v-for="wert in FORM"
                    :key="wert"
                    :schluessel="wert"
                    :name="t(`landschaftseditor.gebirge.wert.${wert}`)"
                    :satz="t(`landschaftseditor.gebirge.wertSatz.${wert}`)"
                    :grenze="GEBIRGS_WERT_GRENZEN[wert]"
                    :gilt="geltenderWert(stand, presets, wert)"
                    :preset="presetWert(stand, presets, wert)"
                    :weicht="weichtAb(stand, presets, wert)"
                    :typ-name="typName(stand.typ)"
                    :gesperrt="gesperrt"
                    :kennung="kennung"
                    @setze="(roh: number) => setzeWert(wert, roh)"
                    @zurueck="emit('aendere', ohneWert(stand, wert))"
                />
                <GebirgeWertzeile
                    v-for="wert in modellZeilen"
                    :key="wert"
                    :schluessel="`modell-${wert}`"
                    :name="modellName(wert)"
                    :satz="modellSatz(wert)"
                    :grenze="GEBIRGS_MODELL_GRENZEN[wert]"
                    :gilt="modellGilt(wert)"
                    :preset="modellPreset(stand, presets, wert)"
                    :weicht="weichtModellAb(stand, presets, wert)"
                    :typ-name="typName(stand.typ)"
                    :gesperrt="gesperrt"
                    :kennung="kennung"
                    @setze="(roh: number) => setzeModell(wert, roh)"
                    @zurueck="emit('aendere', ohneModellwert(stand, wert))"
                />
                <details class="gebirge__fein" :data-testid="`${kennung}-gebirge-fein`">
                    <summary>{{ t("landschaftseditor.gebirge.fein") }}</summary>
                    <GebirgeWertzeile
                        v-for="wert in FEIN"
                        :key="wert"
                        :schluessel="wert"
                        :name="t(`landschaftseditor.gebirge.wert.${wert}`)"
                        :satz="t(`landschaftseditor.gebirge.wertSatz.${wert}`)"
                        :grenze="GEBIRGS_WERT_GRENZEN[wert]"
                        :gilt="geltenderWert(stand, presets, wert)"
                        :preset="presetWert(stand, presets, wert)"
                        :weicht="weichtAb(stand, presets, wert)"
                        :typ-name="typName(stand.typ)"
                        :gesperrt="gesperrt"
                        :kennung="kennung"
                        @setze="(roh: number) => setzeWert(wert, roh)"
                        @zurueck="emit('aendere', ohneWert(stand, wert))"
                    />
                </details>
                <div class="gebirge__text">
                    <AvmKnopf groesse="zeile" :testid="`${kennung}-gebirge-werte-kopieren`" @click="kopiere">
                        {{ t("landschaftseditor.gebirge.text.kopieren") }}
                    </AvmKnopf>
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="gesperrt"
                        :testid="`${kennung}-gebirge-werte-einfuegen`"
                        @click="fuegeEin"
                    >
                        {{ t("landschaftseditor.gebirge.text.einfuegen") }}
                    </AvmKnopf>
                    <small v-if="textMeldung" role="status" class="gebirge__hinweis">{{ textMeldung }}</small>
                </div>
                <textarea
                    v-if="textFeld"
                    ref="textElement"
                    class="gebirge__textfeld"
                    rows="6"
                    :readonly="textFeld.art === 'kopieren'"
                    :value="textFeld.inhalt"
                    :aria-label="t('landschaftseditor.gebirge.text.einfuegen')"
                    :data-testid="`${kennung}-gebirge-werte-text`"
                    @input="
                        (e: Event) =>
                            textFeld?.art === 'einfuegen' && uebernimm((e.target as HTMLTextAreaElement).value)
                    "
                />
            </section>

            <section class="gebirge__kasten">
                <h4 class="gebirge__titel">{{ t("landschaftseditor.gebirge.wirkt.titel") }}</h4>
                <p class="gebirge__hinweis">{{ t("landschaftseditor.gebirge.wirkt.satz") }}</p>
                <p v-if="vorschau" class="gebirge__hinweis" role="status" :data-testid="`${kennung}-gebirge-vorschau`">
                    {{ vorschau }}
                </p>
            </section>

            <GebirgeGipfel
                :peaks="peaks"
                :hoehen="gipfelHoehen"
                :kamm="kamm"
                :gesperrt="gesperrt"
                :gesperrt-fuer="gipfelGesperrt"
                :kennung="kennung"
                @hoehe="(id: string, hoehe: number) => emit('gipfelHoehe', id, hoehe)"
                @oeffne="(id: string) => emit('gipfelOeffnen', id)"
                @zeige="(id: string | undefined) => emit('gipfelZeigen', id)"
                @ziel="(id: string) => emit('gipfelZiel', id)"
            />
            <GebirgeGewaesser
                v-if="eingabe"
                :eingabe="eingabe"
                :profile="profile"
                :kamm="kamm"
                :name="gebirgeName"
                :kennung="kennung"
                :netz="stand.netz"
                :kaemme-laufen="kaemmeLaufen === true"
                @fliege="(bounds: [number, number, number, number]) => emit('fliege', bounds)"
                @oeffne="(art: 'weg' | 'landschaft', id: string) => emit('objekt', art, id)"
            />
        </div>
    </div>
</template>

<style scoped>
.gebirge {
    display: grid;
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
    overflow: hidden;
}

.gebirge__werte {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
}

.gebirge__trenner {
    display: grid;
    place-items: center;
    cursor: ns-resize;
    touch-action: none;
    border-block: 1px solid var(--color-border);
    background: var(--color-panel);
}

.gebirge__trenner > span {
    width: var(--space-24);
    height: 3px;
    border-radius: var(--radius-sm);
    background: var(--color-text-muted);
}

.gebirge__trenner:hover,
.gebirge__trenner:active {
    background: var(--color-panel-active);
}

.gebirge__trenner:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--color-accent-brown);
}

/* Die Kästen wie die Abschnitte des Fensters (`.landschaftseditor__abschnitt`). */
.gebirge__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.gebirge__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.gebirge__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gebirge__kacheln {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
    gap: var(--space-4);
}

.gebirge__kachel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-height: var(--avm-control-h);
    padding: var(--space-4) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

/* Das feste Zeichen über dem Namen (Bauvorlage V16), so breit wie die Kachel. */
.gebirge__kachelbild {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    height: 3.4rem;
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
    color: var(--color-text);
}

.gebirge__kachelbild svg {
    width: 80%;
    height: 80%;
}

.gebirge__kachel:hover:not(:disabled) {
    border-color: var(--color-border-strong);
}

.gebirge__kachel.is-an {
    border-color: var(--color-accent-brown);
    box-shadow: inset 0 0 0 1px var(--color-accent-brown);
}

.gebirge__kachel:disabled {
    cursor: default;
}

.gebirge__marke {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Das Raster der Zeilen steht in `fenster-feldzeile-raster.css` (EINE Feldkante); hier nur Name, Zusatz und Feld. */
.gebirge__zeile small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gebirge__zeile.is-abw .gebirge__name {
    color: var(--color-text);
}

.gebirge__feld {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    row-gap: var(--space-2);
    min-width: 0;
}

.gebirge__feld :deep(.feld) {
    flex: none;
}

.gebirge__einheit {
    color: var(--color-text-muted);
    white-space: nowrap;
}

/* Der leise Hinweis „abgeleitet wäre …“ rechts am Feld (Entwurf Variante 2, Vali 2026-10-25); am schmalen Fenster bricht er unter das Feld. */
.gebirge__ableitung {
    margin-left: auto;
    text-align: right;
    white-space: nowrap;
}

.gebirge__segmente {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.gebirge__stufe {
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
}

/* Die Stufen der Höhe als Band: fünf gleich breite Knöpfe in einer Zeile, der Name über der Zahl (Entwurf Variante 2, Vali 2026-10-25: „das ist perfekt“). */
.gebirge__band {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--space-4);
}

.gebirge__band .gebirge__stufe {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    min-width: 0;
    padding: var(--space-2);
    line-height: 1.25;
}

.gebirge__band .gebirge__stufe small {
    max-width: 100%;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    hyphens: auto;
    overflow-wrap: anywhere;
}

.gebirge__band .gebirge__stufe span {
    font-variant-numeric: tabular-nums;
}

.gebirge__band .gebirge__stufe:hover:not(:disabled) {
    border-color: var(--color-border-strong);
}

.gebirge__band .gebirge__stufe:disabled {
    cursor: default;
}

.gebirge__oben {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding-bottom: var(--space-6);
    background: var(--color-panel);
    isolation: isolate;
}

.gebirge__schalter {
    flex: none;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
}

/* Eine Zeile (Betreiber: „das darf nicht mehrzeilig werden“): Die Knöpfe teilen sich die Breite, ihr Wort bleibt einzeilig. */
.gebirge__umschalter {
    min-width: 0;
}

.gebirge__umschalter :deep(.knopf) {
    width: 100%;
    min-width: 0;
    padding-inline: var(--space-4);
}

.gebirge__umschalter .einzeilig {
    min-width: 0;
}

.gebirge__stufe[aria-pressed="true"],
.gebirge__stufe[aria-checked="true"] {
    border-color: var(--color-accent-brown);
    box-shadow: inset 0 0 0 1px var(--color-accent-brown);
}

.gebirge__saat {
    display: inline-flex;
    gap: var(--space-4);
    align-items: center;
}

.gebirge__saatzahl {
    font-variant-numeric: tabular-nums;
}

.gebirge__zurueck {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.gebirge__zurueck:hover {
    color: var(--color-link-hover);
}

.gebirge__text {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: center;
    margin-top: var(--space-4);
}

.gebirge__textfeld {
    width: 100%;
    margin-top: var(--space-2);
    font: inherit;
    font-size: var(--font-size-small);
}

.gebirge__fein {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.gebirge__fein > summary {
    color: var(--color-text-muted);
    cursor: pointer;
}
</style>
