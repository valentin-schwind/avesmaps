<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import {
    ANSICHT_FUER_BILDNAMEN,
    DEFAULT_TOPOGRAPHY_VARIANT,
    FAN_VIEWS,
    isAvailableView,
    KARTENSERIE_THUMB_STUFE,
    KARTENSERIE_THUMB_VORGABE,
    LANDSCAPE_SELECTIONS,
    rasterTileTemplate,
    seriesSwitchKey,
    TOPOGRAPHY_VARIANTS,
    type FanView,
    type LandscapeSelection,
    type MapView,
    type TopographyVariant,
} from "@avesmaps3d/shared";
import { loadRasterPointer } from "../map/basemap";
import { melde } from "../besuch/besuch-melden";
import FanOhr from "./fan-ohr.vue";
import FanThumb from "./fan-thumb.vue";
import { t, type MessageKey } from "../i18n/i18n";
import { ausgeblendet } from "../system/inhaltsstand";
import { pausiertSatz } from "../system/inhaltsstand-text";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import standardVektor from "./fan/standard.svg?url";
import politischVektor from "./fan/politisch.svg?url";
import kraftlinienVektor from "./fan/kraftlinien.svg?url";
import alleVektor from "./fan/landschaften-alle.svg?url";
import derographischVektor from "./fan/landschaften-derographisch.svg?url";
import vegetationVektor from "./fan/landschaften-vegetation.svg?url";
import topographieVektor from "./fan/landschaften-topographie.svg?url";
import klimaVektor from "./fan/landschaften-klima.svg?url";
import sprachenVektor from "./fan/landschaften-sprachen.svg?url";
import hoehenlinienVektor from "./fan/landschaften-hoehenlinien.svg?url";
import hoehenstufenVektor from "./fan/landschaften-hoehenstufen.svg?url";

/**
 * Der Kartenfächer (WI-0024 nach Legacys „Ansichts-Kachel“; seit WI-0036 mit fester Reihe und
 * Eselsohr).
 *
 * Betreiber 2026-09-25, nach zwei Beobachtungen an Nutzern: sie trafen daneben, weil sich Legacys
 * Reihe nach jeder Wahl umsortierte (die aktive Ansicht stand immer zuletzt, auf dem Fleck der
 * Kachel), und sie wählten in der Unterreihe, weil die beim Überfahren von selbst aufging und wie ein
 * Pflichtschritt aussah. Gebaut nach dem abgenommenen Prototyp (`review/faecher-mockup`, „A“ mit
 * Eselsohr):
 * - Die KACHEL BLEIBT STEHEN und zeigt die eingestellte Ansicht. Die Reihe klappt links daneben auf,
 *   immer in derselben Reihenfolge; die aktive Ansicht ist nur golden markiert. Eine Wahl fliegt als
 *   ganze Kachel in die Kachel.
 * - Ein Klick auf eine Ansicht wählt sie sofort. Untergrund bzw. Ebene wählt man über das ESELSOHR:
 *   am Zeiger erscheint es beim Überfahren der Zelle und klappt um; auf dem Ohr geht nach 140 ms die
 *   Unterreihe auf, ein Klick hält sie fest, der zweite schließt. Am Finger steht es immer da.
 * - Das Ohr sitzt auch an der Kachel: dort wechselt man Untergrund oder Ebene, ohne die Ansicht
 *   anzufassen.
 * - Braucht die Unterreihe den Platz von Auge und Lupe, rutschen die mit ihr hoch.
 * - „Politisch“ (WI-0062): wählbar, sobald abgeleitete Gebiete vorliegen (`territoriesReady`, der Zeiger der Gebiete);
 *   davor bleibt die Zelle ausgegraut und nennt den Grund (MCS-019).
 * - Die TOPOGRAPHIE hat eine dritte Reihe (WI-0055, Betreiber 2026-09-28, Blatt 3 „A“): Ihr Eselsohr in der
 *   Landschafts-Unterreihe öffnet darüber „Höhenlinien | Höhenstufen“, nach denselben Regeln wie die
 *   Unterreihe (140 ms auf dem Ohr, Klick hält fest, Pfeil hoch führt hinein). Ein Klick auf „Topographie“
 *   selbst wählt sie mit der gemerkten Unterwahl.
 */
const props = defineProps<{
    view: MapView;
    landscapeSelection: LandscapeSelection;
    seriesId: string;
    /**
     * In der Reihenfolge des Fächers (Katalog der Systemsteuerung, WI-0220); `thumb` ist die Kachel des Bildes. `nurKarte`: nur in der
     * Unterreihe von „Nur Karte“ (Beschriftung im Bild für Besucher, `nurUnterNurKarte`, Betreiber 2026-11-10).
     */
    series: readonly { id: string; label: string; thumb?: { x: number; y: number }; nurKarte?: boolean }[];
    /** Die Unterwahl der Topographie (WI-0055). */
    topography?: TopographyVariant;
    /** Liegen abgeleitete Herrschaftsgebiete vor (WI-0062)? Ohne sie bleibt „Politisch“ ausgegraut. */
    territoriesReady?: boolean;
}>();
const emit = defineEmits<{
    "update:view": [MapView];
    "update:landscapeSelection": [LandscapeSelection];
    "update:seriesId": [string];
    "update:topography": [TopographyVariant];
}>();

/** Legacy `SCHWEBE_AUF_MS` / `SCHWEBE_ZU_MS`: erst warten, dann aufklappen; großzügig zuklappen. */
const SCHWEBE_AUF_MS = 140;
const SCHWEBE_ZU_MS = 260;
/** Legacy `BLENDE_ZU_MS`: das Raster verschwindet erst, wenn sein Zuklappen (110 ms) vorbei ist. */
const BLENDE_ZU_MS = 130;
/** Der Flug in die Kachel dauert 320 ms; danach steht die echte Kachel wieder da. */
const FLUG_MS = 340;

/**
 * Die Vorschau zeigt je Serie ihre gewählte Kachel der Stufe 5 (WI-0220, Reiter „Kartenserien“), sonst den Sternknoten Gareth -
 * dieselbe Stelle wie Legacys Vorlagekachel (`z3 / map_17_-17`). Legacys Straßenvektor ist aus genau dieser Kachel nachgezeichnet
 * und deckt sich deshalb mit unserer Kachel 5/17/15.
 */
const VORSCHAU_STUFE = String(KARTENSERIE_THUMB_STUFE);

const VIEW_VEKTOR: Partial<Record<FanView, string>> = {
    standard: standardVektor,
    political: politischVektor,
    powerlines: kraftlinienVektor,
};
const EBENEN_VEKTOR: Record<LandscapeSelection, string> = {
    alle: alleVektor,
    derographisch: derographischVektor,
    vegetation: vegetationVektor,
    topographie: topographieVektor,
    klima: klimaVektor,
    sprachen: sprachenVektor,
};

const TOPO_VEKTOR: Record<TopographyVariant, string> = {
    hoehenlinien: hoehenlinienVektor,
    hoehenstufen: hoehenstufenVektor,
};
const topographie = computed<TopographyVariant>(() => props.topography ?? DEFAULT_TOPOGRAPHY_VARIANT);
/** Das Bild einer Ebene; die Topographie zeigt ihre Unterwahl. */
function ebenenVektor(selection: LandscapeSelection): string {
    return selection === "topographie" ? TOPO_VEKTOR[topographie.value] : EBENEN_VEKTOR[selection];
}
function istTopographieAktiv(variante: TopographyVariant): boolean {
    return props.view === "landscapes" && props.landscapeSelection === "topographie" && topographie.value === variante;
}

/** Warum eine Ansicht noch ausgegraut ist - als Hinweis an der Zelle. */
const FEHLT_SCHLUESSEL: Partial<Record<FanView, MessageKey>> = {
    political: "fan.missing.political",
};
function fehlt(view: FanView): string | undefined {
    if (view === "political" && props.territoriesReady === true) {
        return undefined;
    }
    const key = FEHLT_SCHLUESSEL[view];
    return key ? t(key) : undefined;
}

/**
 * Die Untergründe, die der Fächer anbietet. Eine Serie, die ein Inhaltsschalter der Systemsteuerung ausblendet (WI-0127 SYS-10,
 * `map.series.<id>`), fehlt; zeigt die Karte gerade sie (ein Link), wechselt der Fächer auf die erste angebotene und sagt es einmal.
 * 🪤 Weich: Ihre Kacheln laden weiter, wer die Adresse kennt (SYS-0001 §3.4).
 */
const untergruende = computed(() => props.series.filter((s) => !ausgeblendet(seriesSwitchKey(s.id))));
/** Die Untergründe der Unterreihe einer Ansicht: eine Serie mit `nurKarte` nur unter „Nur Karte“. */
function untergruendeFuer(view: FanView | null) {
    return untergruende.value.filter((s) => s.nurKarte !== true || view === ANSICHT_FUER_BILDNAMEN);
}
const serieAusgeblendet = ref(false);
let serieHinweisUhr: ReturnType<typeof setTimeout> | undefined;
watch(
    () => [props.seriesId, ausgeblendet(seriesSwitchKey(props.seriesId))] as const,
    ([id, aus]) => {
        const ersatz = untergruendeFuer(props.view)[0];
        if (!aus || ersatz === undefined || ersatz.id === id) return;
        emit("update:seriesId", ersatz.id);
        serieAusgeblendet.value = true;
        clearTimeout(serieHinweisUhr);
        serieHinweisUhr = setTimeout(() => (serieAusgeblendet.value = false), 8000);
    },
    { immediate: true },
);
onBeforeUnmount(() => clearTimeout(serieHinweisUhr));
const aktiverUntergrund = computed(() => untergruende.value.find((s) => s.id === props.seriesId));

/** Die Vorschaukachel je Untergrund, aus seinem Rasterzeiger (ADR-0008). */
const vorschau = ref<Record<string, string>>({});
async function ladeVorschauen(): Promise<void> {
    const eintraege = await Promise.all(
        props.series.map(async (s) => {
            try {
                const vorlage = rasterTileTemplate(await loadRasterPointer(s.id));
                const { x, y } = s.thumb ?? KARTENSERIE_THUMB_VORGABE;
                const url = vorlage.replace("{z}", VORSCHAU_STUFE).replace("{x}", String(x)).replace("{y}", String(y));
                return [s.id, url] as const;
            } catch {
                // Ohne Zeiger bleibt die Zelle papierfarben; die Karte meldet den Fehler selbst.
                return undefined;
            }
        }),
    );
    vorschau.value = Object.fromEntries(eintraege.filter((e) => e !== undefined));
}

interface Zelle {
    view: FanView;
    name: string;
    verfuegbar: boolean;
    base: string | undefined;
    overlay: string | undefined;
    desaturate: boolean;
}

function zelleVon(view: FanView): Zelle {
    const landschaften = view === "landscapes";
    return {
        view,
        name: t(`view.${view}`),
        verfuegbar: isAvailableView(view) && fehlt(view) === undefined,
        // 🔴 In den Landschaften ist der Untergrund aus; die Zelle zeigt die gewählte Ebene.
        base: landschaften ? undefined : vorschau.value[props.seriesId],
        overlay: landschaften ? ebenenVektor(props.landscapeSelection) : VIEW_VEKTOR[view],
        desaturate: view === "powerlines",
    };
}

/** Leer bleibt die Zeile ein geschütztes Leerzeichen - eine leere Zeile fiele zusammen. */
const LEER = "\u00a0";

/** Die zweite Zeile der Kachel: der Untergrund, bei den Landschaften die Ebene. */
const zweiteZeile = computed(() =>
    props.view === "landscapes"
        ? props.landscapeSelection === "topographie"
            ? t(`topography.${topographie.value}`)
            : t(`layer.${props.landscapeSelection}`)
        : (aktiverUntergrund.value?.label ?? ""),
);

const kachel = computed(() => zelleVon(props.view));
/** 🔴 DIE REIHE STEHT FEST (Betreiber 2026-09-25) - eine Ansicht findet man immer an derselben Stelle. */
const reihe = computed(() => FAN_VIEWS.map(zelleVon));

const kachelAnsage = computed(() =>
    props.view === "landscapes"
        ? t("fan.tile.aria.layer", { view: t(`view.${props.view}`), layer: zweiteZeile.value })
        : t("fan.tile.aria", { view: t(`view.${props.view}`) }),
);

function ohrTitel(view: FanView): string {
    return view === "landscapes" ? t("fan.griff.layers") : t("fan.griff.base");
}

// ---------------------------------------------------------------------------------------------
// Zustand. 💣 Wie bei Legacy steht er in Variablen, nicht in Klassen: `is-open` kommt erst im
// nächsten Bild, `hidden` erst nach der Blende - wer eines davon als Zustand liest, liest falsch.

const huelle = useTemplateRef<HTMLElement>("huelle");
const menue = useTemplateRef<HTMLElement>("menue");
const stufe = useTemplateRef<HTMLElement>("stufe");
const knopf = useTemplateRef<HTMLButtonElement>("knopf");

const zustandOffen = ref(false);
const menueSichtbar = ref(false);
const menueKlasseOffen = ref(false);
/**
 * Ein Klick hält fest, bis woanders hingeklickt wird (Legacy, Owner 15.08.2026) - die Reihe über die
 * Kachel, die Unterreihe über ihr Ohr. 🪤 ZWEI Merker: mit einem hielt der Klick auf die Kachel auch
 * jede bloß überfahren geöffnete Unterreihe fest, und sie ging nicht mehr zu.
 */
let reiheFest = false;
let stufeFest = false;
/** Nach einer Auswahl steht der Zeiger noch über dem Bund; bis zum Verlassen klappt nichts auf. */
let schwebeGesperrt = false;
/** Steht der Zeiger auf dem Ohr der Kachel? Wer dorthin zielt, will den Untergrund - nicht die Reihe. */
let amKachelOhr = false;

type StufenArt = "grund" | "ebenen";
/** Zu welcher Ansicht die offene Unterreihe gehört, und ob sie über der Kachel steht statt über einer Zelle. */
const stufeZwei = ref<FanView | null>(null);
/** Zu welcher Ansicht die Untergründe der Reihe gehören. 🪤 Bleibt beim Zuklappen stehen wie `stufeInhalt`, sonst zuckt die Reihe. */
const stufeAnsicht = ref<FanView | null>(null);
const stufenGruende = computed(() => untergruendeFuer(stufeAnsicht.value));
const stufeAmKachel = ref(false);
let stufeZweiArt: StufenArt | "" = "";
/** Was die Reihe zeigt. 🪤 Getrennt von `stufeZweiArt`: beim Zuklappen bleibt der Inhalt stehen. */
const stufeInhalt = ref<StufenArt>("grund");
const stufeSichtbar = ref(false);
const stufeKlasseOffen = ref(false);
const stufeLinks = ref(0);
const stufeSpalt = ref(0);
/** Wie weit Auge und Lupe hochrutschen, damit Unter- und dritte Reihe sie nicht verdecken (px). */
const platzStufe = ref(0);
const platzDrei = ref(0);
const platz = computed(() => Math.max(platzStufe.value, platzDrei.value));

/** Die dritte Reihe der Topographie (WI-0055): über der Unterreihe, aus der Zelle „Topographie“ heraus. */
const drei = useTemplateRef<HTMLElement>("drei");
const dreiSichtbar = ref(false);
const dreiKlasseOffen = ref(false);
const dreiLinks = ref(0);
const dreiSpalt = ref(0);
/** Wie weit die dritte Reihe über dem Boden der Unterreihe steht (px): deren Höhe plus Fuge. */
const dreiBoden = ref(0);
let dreiFest = false;

/** Die Kachel, die gerade in die Kachel fliegt (Lage in Bildschirmkoordinaten). */
const flieger = ref<{ x: number; y: number; breite: number; hoehe: number; dx: number; dy: number } | null>(null);
const fliegerUnterwegs = ref(false);

let schwebeTimer = 0;
let blendeTimer = 0;
let stufeTimer = 0;
let stufeWegTimer = 0;
let ohrTimer = 0;
let flugTimer = 0;
let dreiWegTimer = 0;
let dreiOhrTimer = 0;

/** Überfahren gibt es nur am echten Zeiger: `hover: hover` UND `pointer: fine` (Legacy). */
const amZeiger =
    typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia("(hover: hover) and (pointer: fine)")
        : undefined;
/** Am Finger steht das Eselsohr immer da - es gibt kein Überfahren, das es zeigen könnte. */
const amFinger = ref(!amZeiger?.matches);
function zeigerGewechselt(): void {
    amFinger.value = !amZeiger?.matches;
}
function wenigBewegung(): boolean {
    return (
        typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

function hatStufeZwei(view: FanView | null): boolean {
    if (!view || !isAvailableView(view)) {
        return false;
    }
    // Untergründe sind erst ab ZWEI eine Wahl; eine Ebene ist schon allein das, was der Klick wählt.
    return view === "landscapes" ? LANDSCAPE_SELECTIONS.length > 0 : untergruendeFuer(view).length > 1;
}

// --- Reihe ------------------------------------------------------------------------------------

async function oeffne(mitFokus: boolean): Promise<void> {
    window.clearTimeout(blendeTimer);
    zustandOffen.value = true;
    menueSichtbar.value = true;
    await nextTick();
    // ⚠️ Den geschlossenen Zustand einmal rechnen lassen und erst im nächsten Bild aufrollen: sonst
    // sähe der Browser Sichtbarwerden und Aufklappen im selben Bild - und keinen Übergang.
    void menue.value?.offsetWidth;
    requestAnimationFrame(() => {
        if (zustandOffen.value) {
            menueKlasseOffen.value = true;
        }
    });
    // 💣 Beim Überfahren wird NICHT fokussiert - das nähme der Tastatur ihre Stelle.
    if (mitFokus) {
        menue.value?.querySelector<HTMLElement>(".fan__cell.is-active")?.focus();
    }
}

/** Nur die Reihe zu - eine Unterreihe über der Kachel darf stehen bleiben. */
function zeileZu(): void {
    if (!zustandOffen.value) {
        return;
    }
    zustandOffen.value = false;
    menueKlasseOffen.value = false;
    window.clearTimeout(blendeTimer);
    blendeTimer = window.setTimeout(() => {
        menueSichtbar.value = false;
    }, BLENDE_ZU_MS);
}

function schliesse(fokusZurueck = false): void {
    reiheFest = false;
    // 🪤 Ein noch laufendes Überfahren klappte sonst gleich wieder auf (Escape über der Kachel);
    // steht der Zeiger noch auf dem Fächer, klappt erst nach dem Verlassen wieder etwas auf.
    window.clearTimeout(schwebeTimer);
    schwebeGesperrt = Boolean(huelle.value?.matches(":hover"));
    schliesseStufeZwei();
    zeileZu();
    if (fokusZurueck) {
        knopf.value?.focus();
    }
}

// --- Unterreihe -------------------------------------------------------------------------------

/**
 * Die Unterreihe teilt sich über ihrer Quelle (Zelle oder Kachel) und bleibt in dem, was zu sehen
 * ist: Reihe und Kachel zusammen. 💣 Die RECHTE Grenze gewinnt - dahinter liegt der Bildschirmrand.
 */
function positioniereStufeZwei(): void {
    const quelle = stufeAmKachel.value
        ? knopf.value?.querySelector<HTMLElement>(".fan__cell")
        : menue.value?.querySelector<HTMLElement>(`.fan__cell[data-view="${stufeZwei.value ?? ""}"]`);
    if (!quelle || !huelle.value || !stufe.value) {
        return;
    }
    const rH = huelle.value.getBoundingClientRect();
    const rZ = zustandOffen.value && menue.value ? menue.value.getBoundingClientRect() : rH;
    const rQ = quelle.getBoundingClientRect();
    const minLinks = Math.min(rZ.left, rH.left) - rH.left;
    const maxRechts = Math.max(rZ.right, rH.right) - rH.left;
    const mitte = rQ.left + rQ.width / 2 - rH.left;
    const breite = stufe.value.offsetWidth;
    const links = Math.min(Math.max(minLinks, mitte - breite / 2), maxRechts - breite);
    stufeLinks.value = Math.round(links);
    // 💣 Die Teilung beginnt an der QUELLE: die Reihe fährt sichtbar aus DIESER Zelle heraus.
    stufeSpalt.value = Math.round(mitte - links);
    platzMachen(rH.left + links, breite);
}

/**
 * Auge und Lupe rutschen hoch, wenn die Unterreihe über ihnen stünde (Betreiber 2026-09-25: „ein
 * cooles feature wär wenn die lupe und das auge nach oben rutschen, wenn das menü platz braucht“).
 * Der Fächer wächst dafür um die Höhe der Unterreihe nach oben - im Fluss des Eckbunds, wie Legacy.
 */
function platzMachen(links: number, breite: number): void {
    const oben = huelle.value?.previousElementSibling;
    if (!oben || !huelle.value || !stufe.value) {
        platzStufe.value = 0;
        return;
    }
    const rO = oben.getBoundingClientRect();
    const ueberdeckt = links + breite > rO.left && links < rO.right;
    platzStufe.value = ueberdeckt
        ? Math.round(huelle.value.getBoundingClientRect().top - stufe.value.getBoundingClientRect().top)
        : 0;
}

// --- Die dritte Reihe (Topographie, WI-0055) ---------------------------------------------------

/** Über der Zelle „Topographie“ der Unterreihe, im selben Rahmen wie diese (die rechte Grenze gewinnt). */
function positioniereStufeDrei(): void {
    const quelle = stufe.value?.querySelector<HTMLElement>('.fan__cell[data-ebene="topographie"]');
    if (!quelle || !huelle.value || !stufe.value || !drei.value) {
        return;
    }
    const rH = huelle.value.getBoundingClientRect();
    const rS = stufe.value.getBoundingClientRect();
    const rZ = zustandOffen.value && menue.value ? menue.value.getBoundingClientRect() : rH;
    const rQ = quelle.getBoundingClientRect();
    const minLinks = Math.min(rZ.left, rH.left, rS.left) - rH.left;
    const maxRechts = Math.max(rZ.right, rH.right, rS.right) - rH.left;
    const mitte = rQ.left + rQ.width / 2 - rH.left;
    const breite = drei.value.offsetWidth;
    const links = Math.min(Math.max(minLinks, mitte - breite / 2), maxRechts - breite);
    dreiLinks.value = Math.round(links);
    dreiSpalt.value = Math.round(mitte - links);
    const fuge = rH.top - rS.bottom;
    dreiBoden.value = Math.round(stufe.value.offsetHeight + fuge);
    // Platz: Überdeckt sie Auge, Lupe oder die Legende, wächst der Fächer bis über ihre Oberkante.
    const rO = huelle.value.previousElementSibling?.getBoundingClientRect();
    const ueberdeckt = rO !== undefined && rH.left + links + breite > rO.left && rH.left + links < rO.right;
    platzDrei.value = ueberdeckt ? Math.round(fuge + dreiBoden.value + drei.value.offsetHeight) : 0;
}

async function oeffneStufeDrei(): Promise<void> {
    if (stufeInhalt.value !== "ebenen" || stufeZwei.value === null) {
        return;
    }
    window.clearTimeout(dreiWegTimer);
    window.clearTimeout(stufeTimer);
    if (dreiSichtbar.value && dreiKlasseOffen.value) {
        positioniereStufeDrei();
        return;
    }
    dreiKlasseOffen.value = false;
    dreiSichtbar.value = true;
    await nextTick();
    positioniereStufeDrei();
    requestAnimationFrame(() => {
        if (dreiSichtbar.value && stufeZwei.value !== null) {
            dreiKlasseOffen.value = true;
        }
    });
}

function schliesseStufeDrei(): void {
    window.clearTimeout(dreiOhrTimer);
    dreiFest = false;
    dreiKlasseOffen.value = false;
    platzDrei.value = 0;
    window.clearTimeout(dreiWegTimer);
    dreiWegTimer = window.setTimeout(() => {
        if (!dreiKlasseOffen.value) {
            dreiSichtbar.value = false;
        }
    }, BLENDE_ZU_MS);
}

/** Auf dem Ohr der Topographie geht nach 140 ms die dritte Reihe auf (am Zeiger); am Finger per Tipp. */
function ohrZeigerDrei(ereignis: PointerEvent, hinein: boolean): void {
    const ohr = ereignis.target instanceof Element ? ereignis.target.closest(".fan-ohr") : null;
    const anderes = ereignis.relatedTarget instanceof Element ? ereignis.relatedTarget.closest(".fan-ohr") : null;
    if (!ohr || ohr === anderes) {
        return;
    }
    window.clearTimeout(dreiOhrTimer);
    if (!hinein || !amZeiger?.matches) {
        return;
    }
    dreiOhrTimer = window.setTimeout(() => void oeffneStufeDrei(), dreiSichtbar.value ? 0 : SCHWEBE_AUF_MS);
}

/** Erster Klick aufs Ohr hält die dritte Reihe fest, der zweite schließt sie. */
function ohrKlickDrei(): void {
    window.clearTimeout(dreiOhrTimer);
    stufeFest = true;
    if (dreiSichtbar.value && dreiKlasseOffen.value) {
        if (dreiFest) {
            schliesseStufeDrei();
        } else {
            dreiFest = true;
        }
        return;
    }
    dreiFest = true;
    void oeffneStufeDrei();
}

/** Eine andere Ebene überfahren lässt die dritte Reihe los, wie eine Zelle ihre Unterreihe. */
function ebeneBetreten(selection: LandscapeSelection): void {
    if (amZeiger?.matches && dreiSichtbar.value && !dreiFest && selection !== "topographie") {
        schliesseStufeDrei();
    }
}

function dreiBetreten(): void {
    window.clearTimeout(stufeTimer);
    window.clearTimeout(schwebeTimer);
    window.clearTimeout(dreiWegTimer);
}

function dreiVerlassen(ereignis: MouseEvent): void {
    const nach = ereignis.relatedTarget as Node | null;
    if (stufe.value?.contains(nach) || menue.value?.contains(nach) || knopf.value?.contains(nach)) {
        return;
    }
    stufeZweiSpaeterSchliessen();
}

/** Höhenlinien oder Höhenstufen: wählt Landschaften, Topographie und die Unterwahl zugleich. */
function waehleTopographie(variante: TopographyVariant, ereignis: MouseEvent): void {
    schwebeGesperrt = true;
    if (!istTopographieAktiv(variante)) {
        fliege(ereignis.currentTarget);
    }
    waehleDerographie("topographie", variante);
    schliesse();
}

async function oeffneStufeZwei(view: FanView, amKachel = false): Promise<void> {
    if (!hatStufeZwei(view)) {
        schliesseStufeZwei();
        return;
    }
    window.clearTimeout(stufeTimer);
    window.clearTimeout(stufeWegTimer);
    const art: StufenArt = view === "landscapes" ? "ebenen" : "grund";
    const warOffen = stufeZwei.value !== null;
    stufeZwei.value = view;
    stufeAnsicht.value = view;
    stufeAmKachel.value = amKachel;
    // 💣 Dieselbe Art WANDERT, statt zu- und wieder aufzuklappen. Erst nach dem Zeichnen messen: Unter „Nur Karte“ kann die Reihe
    // eine Serie mehr haben.
    if (warOffen && art === stufeZweiArt) {
        await nextTick();
        positioniereStufeZwei();
        return;
    }
    // Wechselt die Art, wird HART geschlossen und neu aufgefächert (aus display:none heraus).
    if (warOffen) {
        stufeSichtbar.value = false;
        await nextTick();
        void stufe.value?.offsetWidth;
    }
    stufeZweiArt = art;
    stufeInhalt.value = art;
    stufeKlasseOffen.value = false;
    stufeSichtbar.value = true;
    await nextTick();
    positioniereStufeZwei();
    requestAnimationFrame(() => {
        // Wer die Reihe inzwischen geschlossen hat, bekommt sie nicht nachträglich aufgeklappt.
        if (stufeZwei.value !== null) {
            stufeKlasseOffen.value = true;
        }
    });
}

function schliesseStufeZwei(): void {
    window.clearTimeout(stufeTimer);
    window.clearTimeout(ohrTimer);
    stufeZwei.value = null;
    stufeAmKachel.value = false;
    stufeFest = false;
    stufeZweiArt = "";
    stufeKlasseOffen.value = false;
    platzStufe.value = 0;
    schliesseStufeDrei();
    window.clearTimeout(stufeWegTimer);
    stufeWegTimer = window.setTimeout(() => {
        if (stufeZwei.value === null) {
            stufeSichtbar.value = false;
        }
    }, BLENDE_ZU_MS);
}

/** 💣 Nicht sofort schließen: auf dem Weg zur Unterreihe ist der Zeiger kurz über nichts. */
function stufeZweiSpaeterSchliessen(): void {
    window.clearTimeout(stufeTimer);
    if (stufeFest) {
        return;
    }
    stufeTimer = window.setTimeout(() => {
        schliesseStufeZwei();
        // Steht der Zeiger danach auf der Kachel, gilt wieder: Kachel überfahren öffnet die Reihe.
        if (knopf.value?.matches(":hover")) {
            schwebeAuf();
        }
    }, SCHWEBE_ZU_MS);
}

// --- Wahl und Flug ----------------------------------------------------------------------------

/**
 * Die Wahl fliegt als GANZE Kachel aus ihrer Zelle in die Kachel (Betreiber 2026-09-25). Was fliegt,
 * ist immer die künftige Kachel - auch bei einer Wahl in der Unterreihe; sie landet deckungsgleich,
 * erst dann steht die echte Kachel wieder da. Die Quelle wird VOR der Wahl vermessen.
 */
function fliege(quelle: EventTarget | null): void {
    const kachelBox = knopf.value?.getBoundingClientRect();
    const zelleBox = knopf.value?.querySelector(".fan__cell")?.getBoundingClientRect();
    const q = quelle instanceof HTMLElement ? quelle.getBoundingClientRect() : undefined;
    if (!kachelBox || !zelleBox || !q || wenigBewegung()) {
        return;
    }
    const x = q.left + q.width / 2 - zelleBox.width / 2 - (zelleBox.left - kachelBox.left);
    const y = q.top - (zelleBox.top - kachelBox.top);
    window.clearTimeout(flugTimer);
    fliegerUnterwegs.value = false;
    flieger.value = {
        x,
        y,
        breite: kachelBox.width,
        hoehe: kachelBox.height,
        dx: kachelBox.left - x,
        dy: kachelBox.top - y,
    };
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            fliegerUnterwegs.value = true;
        }),
    );
    flugTimer = window.setTimeout(() => {
        flieger.value = null;
        fliegerUnterwegs.value = false;
    }, FLUG_MS);
}

/**
 * Die Kartenwahl eines Menschen — und nur sie zählt (WI-0161, `BESUCH-0001 §13 D`: „Umschalten (nie der Startzustand)").
 *
 * 🔴 **Ein `watch` auf die Ansicht wäre eine Zeile und falsch.** Die Ansicht wechselt an neun Stellen; fünf davon sind keine
 * Wahl: ein geöffneter Link, ein Kurzlink, der Rückfall ohne Gebietsdaten, ein Sprung aus dem Infopanel und der automatische
 * Serienersatz oben in dieser Datei. Ein Wächter träfe alle neun, und die Liste „Kartenansicht" zählte Entscheidungen, die
 * niemand getroffen hat. Legacy hielt es genauso und verlor am 26.08.2026 ein halbes Jahr Statistik, weil der Haken an der
 * falschen Stelle saß.
 *
 * 🪤 Jede Funktion prüft selbst, ob sich überhaupt etwas ändert. Vorher stand dieselbe Prüfung vier Mal verstreut, und die
 * nächste Wahlstelle hätte die Meldung vergessen können.
 */
function waehleAnsicht(view: MapView): void {
    if (view === props.view) return;
    emit("update:view", view);
    melde("map_mode", view);
    if (view === "landscapes") meldeEbene(props.landscapeSelection, topographie.value);
}

/**
 * Welche Ebene der Derographie jemand zu sehen bekommt (`eco_kind`), bei der Topographie samt Unterwahl (WI-0286; Betreiber 2026-11-07:
 * „bei Kartenansicht Derographie fehlen die einzelnen unterscheidungen der views“).
 *
 * 🔴 Auch wer nur die Kachel „Derographie“ klickt, sieht eine Ebene. Bis WI-0286 zählte allein der Wechsel der Ebene: Wer auf der
 * Vorgabe „Alle“ blieb, tauchte nie auf, und „Alle“ stand mit 309 Zeilen unter 2.756 Besuchen der Ansicht.
 */
function meldeEbene(ebene: LandscapeSelection, variante: TopographyVariant): void {
    melde("eco_kind", ebene);
    if (ebene === "topographie") melde("eco_kind", variante);
}

function waehleSerie(id: string): void {
    if (id === props.seriesId) return;
    emit("update:seriesId", id);
    melde("map_style", id);
}

/** Ansicht, Ebene und Unterwahl in einem Zug: Jeder Teil wechselt nur, wenn er sich ändert, und die Ebene zählt dabei nur einmal. */
function waehleDerographie(ebene: LandscapeSelection, variante: TopographyVariant = topographie.value): void {
    const neueAnsicht = props.view !== "landscapes";
    const neueEbene = ebene !== props.landscapeSelection;
    const neueVariante = variante !== topographie.value;
    if (neueAnsicht) {
        emit("update:view", "landscapes");
        melde("map_mode", "landscapes");
    }
    if (neueEbene) emit("update:landscapeSelection", ebene);
    if (neueVariante) emit("update:topography", variante);
    if (neueAnsicht || neueEbene) meldeEbene(ebene, variante);
    else if (ebene === "topographie" && neueVariante) melde("eco_kind", variante);
}

/**
 * Lag der Klick auf dem Eselsohr? 💣 Das Ohr hat bewusst KEINEN eigenen Klick-Handler: Chrome lässt
 * einen Tipp am Finger auf das nächste Element mit Klick-Handler einrasten, und das Ohr gewann so gegen
 * die Kachel, obwohl der Tipp 9 px daneben lag. Zelle und Kachel entscheiden deshalb selbst.
 */
function aufOhr(ereignis: Event): boolean {
    return ereignis.target instanceof Element && ereignis.target.closest(".fan-ohr") !== null;
}

/** 🔴 Ein Klick auf eine Ansicht WÄHLT sie (Betreiber 2026-09-25) - die Unterreihe ist nur ein Zusatz. */
function waehle(view: FanView, ereignis: MouseEvent): void {
    if (aufOhr(ereignis)) {
        ohrKlick(view, false);
        return;
    }
    schwebeGesperrt = true;
    if (!isAvailableView(view) || fehlt(view) !== undefined) {
        return;
    }
    if (view !== props.view) {
        fliege(ereignis.currentTarget);
        waehleAnsicht(view);
    }
    schliesse();
}

/** Ein Untergrund wählt beides zugleich: die Ansicht, zu der die Reihe gehört, und sich selbst. */
function waehleGrund(id: string, ereignis: MouseEvent): void {
    schwebeGesperrt = true;
    const ansichtDazu = stufeZwei.value;
    const neueAnsicht = ansichtDazu !== null && ansichtDazu !== props.view && isAvailableView(ansichtDazu);
    if (id !== props.seriesId || neueAnsicht) {
        fliege(ereignis.currentTarget);
    }
    waehleSerie(id);
    if (neueAnsicht) {
        waehleAnsicht(ansichtDazu);
    }
    schliesse();
}

/**
 * Eine Ebene wählt die Landschaften und die Ebene zugleich — beides zählt (`map_mode` und `eco_kind`, siehe die
 * Wahlfunktionen oben). Die Ausprägung ist die Ebene selbst (`LANDSCAPE_SELECTIONS`), genau Legacys fünf Werte `alle`,
 * `derographisch`, `vegetation`, `topographie`, `klima`, damit importierte und eigene Zeilen auf demselben Schlüssel summieren;
 * dazu `sprachen` (WI-0261 S5a), die es in Legacy nicht gab.
 */
function waehleEbene(selection: LandscapeSelection, ereignis: MouseEvent): void {
    if (selection === "topographie" && aufOhr(ereignis)) {
        ohrKlickDrei();
        return;
    }
    schwebeGesperrt = true;
    if (props.view !== "landscapes" || selection !== props.landscapeSelection) {
        fliege(ereignis.currentTarget);
    }
    waehleDerographie(selection);
    schliesse();
}

/** Der erste Klick hält die Reihe fest (auch wenn das Überfahren sie schon geöffnet hat), der zweite schließt. */
function kachelKlick(ereignis: MouseEvent): void {
    if (aufOhr(ereignis)) {
        ohrKlick(props.view, true);
        return;
    }
    window.clearTimeout(schwebeTimer);
    if (zustandOffen.value) {
        if (reiheFest) {
            schliesse();
        } else {
            reiheFest = true;
        }
        return;
    }
    schliesseStufeZwei();
    void oeffne(true);
    reiheFest = true;
}

// --- Das Eselsohr -----------------------------------------------------------------------------

/**
 * Betritt oder verlässt der Zeiger das Ohr? Gehört an Zelle und Kachel, nicht ans Ohr - siehe `aufOhr`:
 * auch Zeiger-Handler machen das Ohr für Chromes Tipp-Einrasten zum Ziel.
 */
function ohrZeiger(ereignis: PointerEvent, view: FanView, amKachel: boolean, hinein: boolean): void {
    const ohr = ereignis.target instanceof Element ? ereignis.target.closest(".fan-ohr") : null;
    const anderes = ereignis.relatedTarget instanceof Element ? ereignis.relatedTarget.closest(".fan-ohr") : null;
    if (!ohr || ohr === anderes) {
        return;
    }
    if (hinein) {
        ohrBetreten(view, amKachel);
    } else {
        ohrVerlassen(amKachel);
    }
}

/** Auf dem Ohr geht nach 140 ms die Unterreihe auf; ist schon eine offen, wandert sie ohne Warten. */
function ohrBetreten(view: FanView, amKachel: boolean): void {
    if (amKachel) {
        amKachelOhr = true;
        window.clearTimeout(schwebeTimer);
    }
    window.clearTimeout(stufeTimer);
    if (!amZeiger?.matches || (stufeZwei.value === view && stufeAmKachel.value === amKachel)) {
        return;
    }
    window.clearTimeout(ohrTimer);
    const warte = stufeZwei.value !== null && !amKachel ? 0 : SCHWEBE_AUF_MS;
    ohrTimer = window.setTimeout(() => {
        if (amKachel) {
            zeileZu();
        }
        void oeffneStufeZwei(view, amKachel);
    }, warte);
}

/** Vom Ohr der Kachel weg auf ihre Fläche: die Unterreihe geht, die Reihe kommt - außer man steuert sie an. */
function ohrVerlassen(amKachel: boolean): void {
    window.clearTimeout(ohrTimer);
    if (!amKachel) {
        return;
    }
    amKachelOhr = false;
    if (stufeAmKachel.value) {
        stufeZweiSpaeterSchliessen();
    } else if (knopf.value?.matches(":hover")) {
        schwebeAuf();
    }
}

/** Erster Klick aufs Ohr hält die Unterreihe fest, der zweite schließt sie. */
function ohrKlick(view: FanView, amKachel: boolean): void {
    window.clearTimeout(ohrTimer);
    if (stufeZwei.value === view && stufeAmKachel.value === amKachel) {
        if (stufeFest) {
            schliesseStufeZwei();
        } else {
            stufeFest = true;
            window.clearTimeout(stufeTimer);
        }
        return;
    }
    stufeFest = true;
    if (amKachel) {
        zeileZu();
    }
    void oeffneStufeZwei(view, amKachel);
}

// --- Überfahren -------------------------------------------------------------------------------

function darfAufklappen(): boolean {
    return (
        Boolean(amZeiger?.matches) && !schwebeGesperrt && !zustandOffen.value && !amKachelOhr && !stufeAmKachel.value
    );
}

function schwebeAuf(): void {
    window.clearTimeout(schwebeTimer);
    if (!darfAufklappen()) {
        return;
    }
    schwebeTimer = window.setTimeout(() => {
        if (darfAufklappen()) {
            void oeffne(false);
        }
    }, SCHWEBE_AUF_MS);
}

function huelleVerlassen(): void {
    window.clearTimeout(schwebeTimer);
    window.clearTimeout(ohrTimer);
    schwebeGesperrt = false;
    amKachelOhr = false;
    if (reiheFest || stufeFest || dreiFest || !amZeiger?.matches || (!zustandOffen.value && stufeZwei.value === null)) {
        return;
    }
    schwebeTimer = window.setTimeout(() => schliesse(), SCHWEBE_ZU_MS);
}

/** Eine Unterreihe gehört zu ihrer Zelle: wer auf eine andere fährt, lässt sie los. */
function zelleBetreten(view: FanView): void {
    if (!amZeiger?.matches) {
        return;
    }
    if (stufeZwei.value !== null && (stufeAmKachel.value || stufeZwei.value !== view)) {
        stufeZweiSpaeterSchliessen();
    }
}

function stufeBetreten(): void {
    window.clearTimeout(stufeTimer);
    window.clearTimeout(schwebeTimer);
}

function menueVerlassen(ereignis: MouseEvent): void {
    if (stufe.value?.contains(ereignis.relatedTarget as Node | null) || stufeAmKachel.value) {
        return;
    }
    stufeZweiSpaeterSchliessen();
}

function stufeVerlassen(ereignis: MouseEvent): void {
    const nach = ereignis.relatedTarget as Node | null;
    if (menue.value?.contains(nach) || knopf.value?.contains(nach) || drei.value?.contains(nach)) {
        return;
    }
    stufeZweiSpaeterSchliessen();
}

// --- Tastatur ---------------------------------------------------------------------------------

const PFEILE = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];

function zellenIn(element: HTMLElement | null): HTMLElement[] {
    return element ? [...element.querySelectorAll<HTMLElement>(".fan__cell:not([disabled])")] : [];
}

/**
 * Links/rechts wandern durch die Reihe; Pfeil hoch öffnet die Unterreihe der Ansicht und führt
 * hinein - der Weg der Tastatur zum Eselsohr.
 * 💣 Die bedienten Pfeile gehen NICHT weiter ans Dokument: dort verschieben sie die Karte.
 */
function menueTaste(ereignis: KeyboardEvent): void {
    if (!PFEILE.includes(ereignis.key)) {
        return;
    }
    const zellen = zellenIn(menue.value);
    const jetzt = zellen.indexOf(document.activeElement as HTMLElement);
    if (jetzt < 0) {
        return;
    }
    ereignis.preventDefault();
    ereignis.stopPropagation();
    if (ereignis.key === "ArrowUp") {
        const view = zellen[jetzt]?.dataset["view"] as FanView | undefined;
        if (view && hatStufeZwei(view)) {
            stufeFest = true;
            void oeffneStufeZwei(view).then(() => {
                const ziel =
                    stufe.value?.querySelector<HTMLElement>(".fan__cell.is-active") ?? zellenIn(stufe.value)[0];
                ziel?.focus();
            });
        }
        return;
    }
    if (ereignis.key === "ArrowDown") {
        return;
    }
    const schritt = ereignis.key === "ArrowRight" ? 1 : -1;
    zellen[(jetzt + schritt + zellen.length) % zellen.length]?.focus();
}

/** In der Unterreihe: links/rechts in ihrer Reihe, runter zurück zur Quelle. */
function stufeTaste(ereignis: KeyboardEvent): void {
    if (!PFEILE.includes(ereignis.key)) {
        return;
    }
    const zellen = zellenIn(stufe.value);
    const jetzt = zellen.indexOf(document.activeElement as HTMLElement);
    if (jetzt < 0) {
        return;
    }
    ereignis.preventDefault();
    ereignis.stopPropagation();
    if (ereignis.key === "ArrowDown") {
        const quelle = stufeAmKachel.value
            ? knopf.value
            : menue.value?.querySelector<HTMLElement>(`.fan__cell[data-view="${stufeZwei.value ?? ""}"]`);
        quelle?.focus();
        return;
    }
    if (ereignis.key === "ArrowUp") {
        // Von der Topographie hinauf in ihre dritte Reihe (WI-0055).
        if (zellen[jetzt]?.dataset["ebene"] === "topographie") {
            dreiFest = true;
            void oeffneStufeDrei().then(() => {
                (drei.value?.querySelector<HTMLElement>(".fan__cell.is-active") ?? zellenIn(drei.value)[0])?.focus();
            });
        }
        return;
    }
    const schritt = ereignis.key === "ArrowRight" ? 1 : -1;
    zellen[(jetzt + schritt + zellen.length) % zellen.length]?.focus();
}

/** In der dritten Reihe: links/rechts in ihr, runter zurück zur Topographie. */
function dreiTaste(ereignis: KeyboardEvent): void {
    if (!PFEILE.includes(ereignis.key)) {
        return;
    }
    const zellen = zellenIn(drei.value);
    const jetzt = zellen.indexOf(document.activeElement as HTMLElement);
    if (jetzt < 0) {
        return;
    }
    ereignis.preventDefault();
    ereignis.stopPropagation();
    if (ereignis.key === "ArrowDown") {
        stufe.value?.querySelector<HTMLElement>('.fan__cell[data-ebene="topographie"]')?.focus();
        return;
    }
    if (ereignis.key === "ArrowUp") {
        return;
    }
    const schritt = ereignis.key === "ArrowRight" ? 1 : -1;
    zellen[(jetzt + schritt + zellen.length) % zellen.length]?.focus();
}

/**
 * 🔴 Esc gehört der Kaskade (`keyboard/escape-cascade.ts`, Stufe „menus“, WI-0063 4.10): Der offene Fächer schließt, ohne die
 * Auswahl aufzuheben. Er hört nicht selbst auf die Taste.
 */
const escapeKaskade = inject(ESCAPE_CASCADE_KEY, undefined);
let escapeAbmelden: (() => void) | undefined;
function escapeSchliesst(): boolean {
    if (!zustandOffen.value && stufeZwei.value === null) return false;
    schliesse(true);
    return true;
}

function dokumentKlick(): void {
    if (zustandOffen.value || stufeZwei.value !== null) {
        schliesse();
    }
}

onMounted(() => {
    void ladeVorschauen();
    escapeAbmelden = escapeKaskade?.register("menus", escapeSchliesst);
    document.addEventListener("click", dokumentKlick);
    amZeiger?.addEventListener("change", zeigerGewechselt);
});

onBeforeUnmount(() => {
    escapeAbmelden?.();
    document.removeEventListener("click", dokumentKlick);
    amZeiger?.removeEventListener("change", zeigerGewechselt);
    for (const timer of [
        schwebeTimer,
        blendeTimer,
        stufeTimer,
        stufeWegTimer,
        ohrTimer,
        flugTimer,
        dreiWegTimer,
        dreiOhrTimer,
    ]) {
        window.clearTimeout(timer);
    }
});
</script>

<template>
    <div
        ref="huelle"
        class="fan"
        :class="{ 'fan--finger': amFinger, 'fan--platz': platz > 0 }"
        :style="{ '--fan-platz': `${platz}px` }"
        data-testid="fan"
        data-ziel-deckung
        @mouseenter="schwebeAuf"
        @mouseleave="huelleVerlassen"
    >
        <p v-if="serieAusgeblendet" class="fan__pausiert" role="status" data-testid="fan-series-paused">
            {{ pausiertSatz("series") }}
        </p>
        <!-- Die Unterreihe: sie schwebt über Reihe oder Kachel und fährt aus ihrer Quelle heraus. -->
        <div
            v-show="stufeSichtbar"
            ref="stufe"
            class="fan__menu fan__stufe"
            :class="{ 'is-open': stufeKlasseOffen }"
            :style="{
                '--fan-spalten': stufeInhalt === 'ebenen' ? LANDSCAPE_SELECTIONS.length : stufenGruende.length,
                '--fan-spalt': `${stufeSpalt}px`,
                left: `${stufeLinks}px`,
            }"
            role="radiogroup"
            :aria-label="stufeInhalt === 'ebenen' ? t('fan.level.layers') : t('fan.level.base')"
            data-testid="fan-stufe"
            @click.stop
            @keydown="stufeTaste"
            @mouseenter="stufeBetreten"
            @mouseleave="stufeVerlassen"
        >
            <template v-if="stufeInhalt === 'ebenen'">
                <button
                    v-for="selection in LANDSCAPE_SELECTIONS"
                    :key="selection"
                    type="button"
                    class="fan__cell"
                    :class="{
                        'is-active': view === 'landscapes' && landscapeSelection === selection,
                        'is-quelle': selection === 'topographie' && dreiSichtbar,
                    }"
                    role="radio"
                    :aria-checked="view === 'landscapes' && landscapeSelection === selection"
                    :data-ebene="selection"
                    :data-testid="`fan-layer-${selection}`"
                    @click="waehleEbene(selection, $event)"
                    @mouseenter="ebeneBetreten(selection)"
                    @pointerover="selection === 'topographie' && ohrZeigerDrei($event, true)"
                    @pointerout="selection === 'topographie' && ohrZeigerDrei($event, false)"
                >
                    <FanOhr
                        v-if="selection === 'topographie'"
                        :overlay="ebenenVektor(selection)"
                        :title="t('fan.griff.topography')"
                        data-testid="fan-ohr-topographie"
                    />
                    <FanThumb :overlay="ebenenVektor(selection)" />
                    <span class="fan__label einzeilig">{{ t(`layer.${selection}`) }}</span>
                </button>
            </template>
            <template v-else>
                <button
                    v-for="grund in stufenGruende"
                    :key="grund.id"
                    type="button"
                    class="fan__cell"
                    :class="{ 'is-active': grund.id === seriesId }"
                    role="radio"
                    :aria-checked="grund.id === seriesId"
                    :data-testid="`fan-series-${grund.id}`"
                    @click="waehleGrund(grund.id, $event)"
                >
                    <FanThumb :base="vorschau[grund.id]" />
                    <span class="fan__label einzeilig">{{ grund.label }}</span>
                </button>
            </template>
        </div>

        <!-- Die dritte Reihe der Topographie (WI-0055): über der Unterreihe, aus „Topographie“ heraus. -->
        <div
            v-show="dreiSichtbar"
            ref="drei"
            class="fan__menu fan__stufe fan__drei"
            :class="{ 'is-open': dreiKlasseOffen }"
            :style="{
                '--fan-spalten': TOPOGRAPHY_VARIANTS.length,
                '--fan-spalt': `${dreiSpalt}px`,
                left: `${dreiLinks}px`,
                bottom: `calc(100% + var(--fan-gap) + ${dreiBoden}px)`,
            }"
            role="radiogroup"
            :aria-label="t('fan.level.topography')"
            data-testid="fan-drei"
            @click.stop
            @keydown="dreiTaste"
            @mouseenter="dreiBetreten"
            @mouseleave="dreiVerlassen"
        >
            <button
                v-for="variante in TOPOGRAPHY_VARIANTS"
                :key="variante"
                type="button"
                class="fan__cell"
                :class="{ 'is-active': istTopographieAktiv(variante) }"
                role="radio"
                :aria-checked="istTopographieAktiv(variante)"
                :data-testid="`fan-topography-${variante}`"
                @click="waehleTopographie(variante, $event)"
            >
                <FanThumb :overlay="TOPO_VEKTOR[variante]" />
                <span class="fan__label einzeilig">{{ t(`topography.${variante}`) }}</span>
            </button>
        </div>

        <!-- Die Ansichtsreihe: links neben der Kachel, immer in derselben Reihenfolge. -->
        <div
            v-show="menueSichtbar"
            ref="menue"
            class="fan__menu fan__reihe"
            :class="{ 'is-open': menueKlasseOffen }"
            :style="{ '--fan-spalten': FAN_VIEWS.length }"
            role="radiogroup"
            :aria-label="t('fan.menu')"
            data-testid="fan-menu"
            @click.stop
            @keydown="menueTaste"
            @mouseenter="stufeBetreten"
            @mouseleave="menueVerlassen"
        >
            <button
                v-for="zelle in reihe"
                :key="zelle.view"
                type="button"
                class="fan__cell"
                :class="{ 'is-active': zelle.view === view, 'is-quelle': zelle.view === stufeZwei && !stufeAmKachel }"
                role="radio"
                :aria-checked="zelle.view === view"
                :disabled="!zelle.verfuegbar"
                :title="fehlt(zelle.view)"
                :aria-label="fehlt(zelle.view) ? `${zelle.name}. ${fehlt(zelle.view)}` : undefined"
                :data-view="zelle.view"
                :data-testid="`fan-view-${zelle.view}`"
                @click="waehle(zelle.view, $event)"
                @mouseenter="zelleBetreten(zelle.view)"
                @pointerover="ohrZeiger($event, zelle.view, false, true)"
                @pointerout="ohrZeiger($event, zelle.view, false, false)"
            >
                <FanOhr
                    v-if="hatStufeZwei(zelle.view)"
                    :base="zelle.base"
                    :overlay="zelle.overlay"
                    :desaturate="zelle.desaturate"
                    :title="ohrTitel(zelle.view)"
                    :data-testid="`fan-ohr-${zelle.view}`"
                />
                <FanThumb :base="zelle.base" :overlay="zelle.overlay" :desaturate="zelle.desaturate" />
                <span class="fan__label einzeilig">{{ zelle.name }}</span>
                <!-- Die zweite Zeile trägt die Kachel; hier hält sie nur die Höhe gleich. -->
                <span class="fan__label fan__label--grund einzeilig">{{ LEER }}</span>
            </button>
        </div>

        <!-- Die Kachel bleibt stehen und zeigt die eingestellte Ansicht. -->
        <button
            ref="knopf"
            type="button"
            class="fan__tile"
            :class="{ 'fan__tile--ersetzt': flieger !== null, 'is-quelle': stufeAmKachel }"
            :aria-expanded="zustandOffen"
            :aria-label="kachelAnsage"
            :title="t('fan.tile', { view: t(`view.${view}`) })"
            data-testid="fan-toggle"
            @click.stop="kachelKlick($event)"
            @pointerover="ohrZeiger($event, view, true, true)"
            @pointerout="ohrZeiger($event, view, true, false)"
        >
            <span class="fan__cell fan__cell--kachel" aria-hidden="true">
                <FanOhr
                    v-if="hatStufeZwei(view)"
                    :base="kachel.base"
                    :overlay="kachel.overlay"
                    :desaturate="kachel.desaturate"
                    :title="ohrTitel(view)"
                    data-testid="fan-ohr-kachel"
                />
                <FanThumb :base="kachel.base" :overlay="kachel.overlay" :desaturate="kachel.desaturate" />
                <span class="fan__label einzeilig">{{ kachel.name }}</span>
                <span class="fan__label fan__label--grund einzeilig">{{ zweiteZeile || LEER }}</span>
            </span>
        </button>

        <!-- Die Wahl im Flug: die künftige Kachel, von der gewählten Zelle bis auf die Kachel. -->
        <div
            v-if="flieger"
            class="fan__flieger"
            :class="{ 'is-unterwegs': fliegerUnterwegs }"
            :style="{
                left: `${flieger.x}px`,
                top: `${flieger.y}px`,
                width: `${flieger.breite}px`,
                height: `${flieger.hoehe}px`,
                transform: fliegerUnterwegs ? `translate(${flieger.dx}px, ${flieger.dy}px)` : undefined,
            }"
            aria-hidden="true"
        >
            <span class="fan__cell fan__cell--kachel">
                <FanThumb :base="kachel.base" :overlay="kachel.overlay" :desaturate="kachel.desaturate" />
                <span class="fan__label einzeilig">{{ kachel.name }}</span>
                <span class="fan__label fan__label--grund einzeilig">{{ zweiteZeile || LEER }}</span>
            </span>
        </div>
    </div>
</template>

<style scoped>
/* Der Satz zu einer ausgeblendeten Serie (WI-0127 SYS-10): eine ruhige Auskunft links neben dem Fächer, die von selbst geht; sie
   deckt weder Auge noch Suche darüber zu. */
.fan__pausiert {
    position: absolute;
    right: calc(100% + 8px);
    bottom: 0;
    width: max-content;
    max-width: 240px;
    margin: 0;
    padding: 6px 10px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-small);
}

/*
 * Farben, Linien, Radien und Schatten aus dem Kanon; die Maße sind BAUTEILMASSE dieses Fächers und
 * stehen deshalb hier, benannt.
 *
 * - `--fan-cell`: die Zelle in Reihe und Unterreihe, gebunden an das längste Wort „Landschaften“
 *   (62,6 px in der Fächerschrift, 10 px); am Telefon schmaler (Betreiber 2026-09-25: „wie am
 *   Rechner, schmaler“).
 * - `--fan-kachel`: die Zelle der Kachel - sie bleibt auch am Telefon so breit.
 * - `--fan-bild`: das Vorschaubild samt innerer Kontur (fan-thumb.vue).
 * - Polsterung (Betreiber 2026-09-25: „kleiner, links/rechts/oben gleich groß“): das Bild sitzt in der
 *   Zelle schon zentriert eingerückt - seitlich trägt diese Fluchtluft den Rand allein
 *   (`--fan-pad-x: 0`), oben und unten holt `--fan-pad-y` denselben Abstand nach.
 */
.fan {
    --fan-cell: 69px;
    --fan-kachel: 69px;
    --fan-bild: 52px;
    --fan-pad-x: 0px;
    --fan-pad-y: 8.5px;
    --fan-gap: 6px;
    /* Der Abstand des Eckbunds zum Kartenrand (`.corner`), fürs Rechnen am Telefon. */
    --fan-rand: 12px;
    --fan-ueberhang: 40px;
    --fan-bruecke: 10px;

    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    /* Platz für die Unterreihe: der Fächer wächst nach oben, Auge und Lupe rücken im Fluss mit. */
    margin-top: var(--fan-platz, 0px);
    transition: margin-top 110ms cubic-bezier(0.4, 0, 1, 1);
}

.fan--platz {
    transition: margin-top 190ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* Die Kachel trägt die gemeinsame Regel der Eckknöpfe (Legacy `legal-dialog.css`). */
.fan__tile {
    display: block;
    padding: var(--fan-pad-y) var(--fan-pad-x);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
}

/* Die Wäsche liegt ÜBER der Fläche (Guide §30.1) - aufgeklappt derselbe Schimmer wie beim Überfahren. */
.fan__tile:hover,
.fan__tile:focus-visible,
.fan__tile[aria-expanded="true"] {
    outline: none;
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

.fan__tile:focus-visible {
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-panel);
}

/* Während des Flugs zeigt nur der Flieger die neue Kachel; er landet deckungsgleich. */
.fan__tile--ersetzt .fan__cell--kachel {
    visibility: hidden;
}

/* Reihe und Unterreihe teilen sich den Kasten. */
.fan__menu {
    margin: 0;
    padding: var(--fan-pad-y) var(--fan-pad-x);
    display: grid;
    grid-template-columns: repeat(var(--fan-spalten, 5), auto);
    gap: var(--fan-gap);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
}

/*
 * 🔴 Die Reihe steht LINKS neben der Kachel, die stehen bleibt, und rollt von ihr weg nach links
 * auf - mit `clip-path`: es verschiebt nichts und blendet nichts, es gibt frei. Die drei negativen
 * Seiten lassen den Schatten heraus. Zuklappen ist kürzer als Aufklappen (110 gegen 150 ms).
 */
.fan__reihe {
    position: absolute;
    right: calc(100% + var(--fan-gap));
    bottom: 0;
    clip-path: inset(
        calc(-1 * var(--fan-ueberhang)) calc(-1 * var(--fan-ueberhang)) calc(-1 * var(--fan-ueberhang)) 100% round
            var(--radius-sm)
    );
    transition: clip-path 110ms cubic-bezier(0.4, 0, 1, 1);
}

.fan__reihe.is-open {
    clip-path: inset(
        calc(-1 * var(--fan-ueberhang)) calc(-1 * var(--fan-ueberhang)) calc(-1 * var(--fan-ueberhang)) 0 round
            var(--radius-sm)
    );
    transition: clip-path 150ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* Die Zellen blenden auf und schieben sich herein - gestaffelt von der Kachel nach außen. */
.fan__menu .fan__cell {
    opacity: 0;
    transform: translateY(4px);
    transition:
        opacity 110ms ease,
        transform 110ms ease;
}

.fan__menu.is-open .fan__cell {
    opacity: 1;
    transform: none;
}

/* ⚠️ Die Verzögerung steht nur am `.is-open`-Zweig: beim Zuklappen gehen alle gemeinsam. */
.fan__menu.is-open .fan__cell:nth-last-child(2) {
    transition-delay: 20ms;
}
.fan__menu.is-open .fan__cell:nth-last-child(3) {
    transition-delay: 40ms;
}
.fan__menu.is-open .fan__cell:nth-last-child(4) {
    transition-delay: 60ms;
}
.fan__menu.is-open .fan__cell:nth-last-child(5) {
    transition-delay: 80ms;
}
.fan__menu.is-open .fan__cell:nth-last-child(6) {
    transition-delay: 100ms;
}

/*
 * Die gesperrten Ansichten (heute nur noch „Politisch“): ausgegraut, wie Legacy „gesperrt“ zeigt -
 * über die Deckkraft (Guide §30.2), nie beim Überfahren. Weil die Zelle selbst aufblendet, liegt die
 * Deckkraft auf ihrem Inhalt.
 */
.fan__cell:disabled {
    cursor: default;
}

.fan__cell:disabled > * {
    opacity: 0.5;
}

/* Eine Zelle sieht in Reihe, Kachel und Flug gleich aus. */
.fan__cell {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: var(--fan-cell);
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-family: inherit;
    /* 🔴 Ausnahme von der 11-px-Untergrenze (Betreiber 2026-09-25, Design Guide §3.1): Legacys 10 px. */
    font-size: var(--font-size-fan);
    line-height: 1.15;
}

.fan__cell--kachel {
    width: var(--fan-kachel);
}

/* Gekürzt wird über `.einzeilig` (app.vue) - dort bleibt auch Platz für die Unterlängen. */
.fan__label {
    display: block;
    width: 100%;
}

/*
 * Die Kontur des Bildes (fan-thumb.vue) über geerbte Variablen. 🔴 Beim Überfahren NEUTRAL, nie
 * golden: sonst wäre „überfahren“ nicht von „gewählt“ zu unterscheiden. Dazu ein heller Innenstrich,
 * der die Kontur vom Bild absetzt (Owner 26.08.2026).
 */
.fan__menu .fan__cell:not(:disabled):hover,
.fan__menu .fan__cell:focus-visible {
    --fan-thumb-rand: var(--color-text);
    --fan-thumb-strich: var(--color-panel);
}

.fan__cell.is-active {
    --fan-thumb-rand: var(--color-link);
    --fan-thumb-strich: var(--color-panel);
}

.fan__cell:focus-visible {
    outline: none;
}

.fan__cell.is-active .fan__label {
    color: var(--color-link);
}

/*
 * Wann das Eselsohr da (und umgeklappt) ist: solange seine Unterreihe offen ist, bei Fokus über die
 * Tastatur, am Finger immer - und am Zeiger beim Überfahren (Block darunter).
 */
.fan__menu .fan__cell:focus-visible > .fan-ohr,
.fan__cell.is-quelle > .fan-ohr,
.fan__tile.is-quelle .fan-ohr,
.fan--finger .fan-ohr {
    --ohr-da: 1;
    --ohr-dauer: 280ms;
    --ohr-kurve: cubic-bezier(0.22, 0.61, 0.36, 1);
    visibility: visible;
    transition-delay: 0s;
}

/* Das Loch im Ohr zeigt, was hinter dem Bild liegt - an der offenen Kachel den Schimmer. */
.fan__tile[aria-expanded="true"] .fan-ohr {
    --ohr-loch-schimmer: var(--color-hover-wash);
}

/*
 * 💣 ALLES, WAS DAS OHR BEIM ÜBERFAHREN ÄNDERT, NUR AM ECHTEN ZEIGER. Ein Element, dessen Aussehen von
 * `:hover` abhängt, lässt Chrome einen Tipp am Finger auf sich einrasten - das Ohr fing so Tipps auf die
 * Kachelmitte ab, 9 px daneben.
 */
@media (hover: hover) {
    .fan__menu .fan__cell:hover > .fan-ohr,
    .fan__tile:hover .fan-ohr {
        --ohr-da: 1;
        --ohr-dauer: 280ms;
        --ohr-kurve: cubic-bezier(0.22, 0.61, 0.36, 1);
        visibility: visible;
        transition-delay: 0s;
    }

    .fan__tile:hover .fan-ohr {
        --ohr-loch-schimmer: var(--color-hover-wash);
    }

    /* Steht der Zeiger auf dem Ohr, ist das Ohr gemeint - das Bild bekommt keinen Überfahren-Rahmen dazu. */
    .fan__menu .fan__cell:not(.is-active):has(> .fan-ohr:hover) {
        --fan-thumb-rand: transparent;
        --fan-thumb-strich: transparent;
    }
}

.fan__label--grund {
    margin-top: -3px;
    color: var(--color-link);
}

/*
 * Die Unterreihe: EINE Reihe, die aus ihrer Quelle herausfährt und sich auffächert. Sie schwebt über
 * Reihe oder Kachel; `--fan-spalt` setzt das Skript aus der Lage der Quelle, `left` wandert, wenn eine
 * offene Unterreihe zur nächsten Ansicht hinüberzieht.
 */
.fan__stufe {
    position: absolute;
    bottom: calc(100% + var(--fan-gap));
    z-index: 1;
    clip-path: inset(
        calc(-1 * var(--fan-ueberhang)) calc(100% - var(--fan-spalt, 50%) - (var(--fan-cell) + 2px) / 2)
            calc(-1 * var(--fan-ueberhang)) calc(var(--fan-spalt, 50%) - (var(--fan-cell) + 2px) / 2) round
            var(--radius-sm)
    );
    transition: clip-path 110ms cubic-bezier(0.4, 0, 1, 1);
}

.fan__stufe.is-open {
    clip-path: inset(calc(-1 * var(--fan-ueberhang)) 0 calc(-1 * var(--fan-ueberhang)) 0 round var(--radius-sm));
    transition:
        clip-path 190ms cubic-bezier(0.22, 0.61, 0.36, 1),
        left 160ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* 💣 Die Lücke zur Reihe ist der Fehler, nicht die Zeit: eine unsichtbare Brücke deckt sie. */
.fan__stufe::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: calc(-1 * var(--fan-bruecke));
    left: 0;
    height: var(--fan-bruecke);
}

/*
 * Die Zellen der Unterreihe blenden von VORN auf. ⚠️ Gleich spezifisch wie die Staffelung der Reihe
 * und später im Blatt, sonst gewänne deren `nth-last-child` (Legacy hatte genau diesen Fehler).
 */
.fan__menu.fan__stufe.is-open .fan__cell:nth-child(1) {
    transition-delay: 0ms;
}
.fan__menu.fan__stufe.is-open .fan__cell:nth-child(2) {
    transition-delay: 25ms;
}
.fan__menu.fan__stufe.is-open .fan__cell:nth-child(3) {
    transition-delay: 50ms;
}
.fan__menu.fan__stufe.is-open .fan__cell:nth-child(4) {
    transition-delay: 75ms;
}
.fan__menu.fan__stufe.is-open .fan__cell:nth-child(5) {
    transition-delay: 100ms;
}
.fan__menu.fan__stufe.is-open .fan__cell:nth-child(6) {
    transition-delay: 125ms;
}

/* Der Flieger: startet ohne Rahmen über der Zelle und landet als Kachel. */
.fan__flieger {
    position: fixed;
    z-index: 2;
    box-sizing: border-box;
    margin: 0;
    padding: var(--fan-pad-y) var(--fan-pad-x);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background-color: transparent;
    box-shadow: none;
    pointer-events: none;
    transition:
        transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1),
        background-color 180ms ease,
        border-color 180ms ease,
        box-shadow 320ms ease;
}

.fan__flieger.is-unterwegs {
    border-color: var(--color-border-strong);
    background-color: var(--color-panel);
    box-shadow: var(--shadow-panel);
}

@media (prefers-reduced-motion: reduce) {
    .fan,
    .fan--platz,
    .fan__menu .fan__cell {
        transition: none;
        transform: none;
    }
    .fan__menu.is-open .fan__cell {
        transition-delay: 0s;
    }
    /* ⚠️ Der Beschnitt fällt GANZ weg: bliebe der Startwert stehen, zeigte die Reihe nichts. */
    .fan__reihe,
    .fan__reihe.is-open,
    .fan__stufe,
    .fan__stufe.is-open {
        clip-path: none;
        transition: none;
    }
}

/*
 * 🔴 AM TELEFON wie am Rechner, nur schmaler (Betreiber 2026-09-25): die Kachel bleibt stehen, die
 * Reihe daneben nimmt, was neben Kartenrändern (2 × 12 px), Kachel, Spalt, Rahmen und vier Spalten
 * übrig bleibt. „Landschaften“ kürzt darin mit Auslassungspunkt; die Kachel behält ihre Breite.
 */
@media (max-width: 419px) {
    .fan {
        --fan-gap: 2px;
        --fan-cell: min(
            69px,
            calc((100vw - 2 * var(--fan-rand) - var(--fan-kachel) - 2px - 5 * var(--fan-gap) - 2px) / 5)
        );
    }
    .fan__menu {
        --fan-bild: min(52px, var(--fan-cell));
    }
}
</style>
