<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { MAP_CHECKS, type LandscapeSelection, type MapCheck, type MapView } from "@avesmaps3d/shared";
import {
    cascade,
    LAKES_IN_TILES_HINT,
    lakesAreAreas,
    lockedSwitches,
    PLACE_TIERS,
    type DisplaySwitch,
    type MapDisplay,
    type PlaceTier,
} from "../map/map-display";
import metropole from "./display/metropole.webp";
import grossstadt from "./display/grossstadt.webp";
import stadt from "./display/stadt.webp";
import kleinstadt from "./display/kleinstadt.webp";
import dorf from "./display/dorf.webp";
import bauwerk from "./display/bauwerk.webp";
import wetterSchneedecke from "./display/wetter-schneedecke.webp";
import wetterWolken from "./display/wetter-wolken.webp";
import wetterRegenUndSchnee from "./display/wetter-regen-und-schnee.webp";
import wetterWind from "./display/wetter-wind.webp";
import wetterMeeresstroemungen from "./display/wetter-meeresstroemungen.webp";
import wetterNiederschlag from "./display/wetter-niederschlag.webp";
import {
    klickeWetter,
    starteWetterMesslauf,
    WETTER_ANZEIGEN,
    wetterFehler,
    wetterLaden,
    wetterMesslauf,
    wetterMessung,
    wetterMesszeile,
    wetterSperre,
    wetterStand,
    type WetterAnzeige,
} from "../map/wetter/wetter-schalter";
import { ortsStufenKennung, schalterKennung } from "../map/display-state";
import { melde } from "../besuch/besuch-melden";
import { t, tPlural, type MessageKey } from "../i18n/i18n";
import { HEXRASTER_MEILEN, HEXRASTER_VORGABE, hexrasterMeilen } from "../map/hexraster";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import { authState } from "../auth/session-state";
import { checksAllowedBySession, mapCheckProblems, type MapCheckProblem } from "../map/map-checks";
import { VIEWER_CONTEXT_KEY } from "../viewer/bootstrap-viewer";
import { hoehenlinienZeigen } from "../landschaftseditor/hoehenlinien-schalter";
import { sprachenLegendeZeigen } from "../map/sprachen-legende-schalter";
import { ausgeblendet } from "../system/inhaltsstand";
import { pausiertSatz } from "../system/inhaltsstand-text";

/**
 * Das Anzeige-Menü (WI-0028), 1:1 wie Legacys Auge (`#map-display-button`, `#map-display-menu`,
 * `js/ui/map-display-menu.js`, `css/components/map-display-menu.css`, avesmaps@`770c80e`): was auf der
 * Karte zu sehen ist - die sechs Ortsklassen und die Ebenen.
 *
 * 🔴 ES SCHWEBT (Owner Legacy 12.08.2026: „kannst du das menü über das andere zeugs legen") -
 * anders als der Kartenfächer, der im Fluss steht - und zwar UNMITTELBAR ÜBER DEM AUGE.
 * 💣 Legacy bezieht es auf den ganzen Bund, und dort ist das dasselbe: das Auge ist sein oberster
 * Knopf. Bei uns steht am Finger der 3D-Knopf darüber, und über dem Bund ging das Menü über dem
 * 3D-Knopf auf, vom Auge abgesetzt (Betreiber 2026-09-23: „das menü wird über dem 2d/3d raster
 * toggle. das sieht komisch aus."). Bezug ist deshalb das Auge; solange das Menü offen ist, liegt
 * es über dem 3D-Knopf.
 *
 * Die Gruppe „Prüfen · nur Editoren“ (WI-0131, Blatt 1 abgenommen 2026-10-10): Strömungsrichtungen, die vier Prüfhaken und das
 * Kachelraster, wie Legacy (`index.html:3115-3248`) ohne Zähler und ohne Trefferliste. Was ein Haken zeigt, meldet sein Prüfer
 * am Server (`map/map-checks.ts`); hier wird nur geschaltet.
 *
 * Das Wetter (WI-0288 Stufe 1, Probierseite `review/wetter-editor/` Idee A): oben in „Ebenen“ sechs gemalte Icons wie die Orte,
 * jedes für sich an und aus, den Namen klein darunter; dazu „Schneefallgrenze“ unter „Prüfen“. Nur am Rechner und in der Ansicht
 * „Standard“, sonst gesperrt mit Grund. Hier wird nur geschaltet (`map/wetter/wetter-schalter.ts`); die Engine lädt erst danach.
 *
 * Hat die Systemsteuerung das 3D-Gelände pausiert (WI-0127 SYS-11, `map.terrain3d`), steht unter den Ebenen eine gesperrte Zeile
 * „3D-Gelände“ mit dem Satz als Sperrgrund, wie bei „Grenzen“; sonst gibt es die Zeile nicht (das Gelände schaltet der 3D-Knopf).
 * Nicht dabei, weil es sie bei uns noch nicht gibt (Legacy zeigt sie nur im Bearbeiten-Modus): die
 * Gruppen „Mapstil" und „Freie Labels markieren".
 */
/** Der Sperrgrund der Zeile „3D-Gelände“, solange die Systemsteuerung es pausiert; sonst gibt es die Zeile nicht. */
const terrainPaused = computed(() =>
    ausgeblendet("map.terrain3d") ? (pausiertSatz("map.terrain3d") ?? "") : undefined,
);
const props = defineProps<{
    view: MapView;
    /**
     * Die Ebene der Landschaftsansicht: Nur bei der Topographie steht der Schalter „Höhenlinien“ (Betreiber 2026-10-20: „kannst du die
     * anzeige der höhenlinien in das anzeigemenü tun … - und nur wenn topographie an ist.“; `hoehenlinien-schalter.ts`).
     */
    layer?: LandscapeSelection | undefined;
    /** Liegen abgeleitete Herrschaftsgebiete vor (WI-0062)? Ohne sie bleibt „Grenzen“ gesperrt (Legacys Riegel). */
    territoriesReady?: boolean;
}>();
/**
 * Darf dieser Viewer die Strömungsrichtungen sehen (Capability `view_flow_directions`, WI-0056, Betreiber
 * 2026-09-28: „für editoren sichtbar, nicht für front end nutzer“)? Der ViewerContext kommt per `inject` von
 * `app.vue` (M9), wie bei der Suche.
 */
const viewer = inject(VIEWER_CONTEXT_KEY);
const flowDirections = viewer?.can("view_flow_directions") ?? false;
/**
 * Die Prüfhaken (WI-0131): ab Reviewer (`use_editor_menu`), und bei eingerichteter Anmeldung nur mit angemeldeter Person, die das
 * Recht hat (`checksAllowedBySession`, Fehlerbericht 2026-10-10: ohne Anmeldung meldet die Übergangsansicht das Recht, der Leseweg
 * antwortet aber 401). Folgt der Sitzung, wenn sie sich ändert. Der Server prüft jede Anfrage selbst.
 */
const editorChecks = computed(
    () => (viewer?.can("use_editor_menu") ?? false) && checksAllowedBySession(authState.value),
);
const PROBLEM_TEXT: Record<MapCheckProblem, MessageKey> = {
    rechte: "display.check.problem.rechte",
    stoerung: "display.check.problem.stoerung",
};
const display = defineModel<MapDisplay>("display", { required: true });
/** Das Rechenraster des Höhenmodells (WI-0070), nur für Editoren wie die Strömungsrichtungen. */
const tileGrid = defineModel<boolean>("tileGrid", { default: false });
/** Das Gradnetz (WI-0273), für alle und in jeder Ansicht. */
const gradnetz = defineModel<boolean>("gradnetz", { default: false });
/**
 * Das Hexraster (WI-0273): schließt das Gradnetz aus (Betreiber 2026-10-31: „als zusätzliche option (welche gradnetz
 * deaktiviert)“). Ist es an, steht unter ihm der Regler der Feldgröße.
 */
const hexraster = defineModel<boolean>("hexraster", { default: false });
const hexMeilen = defineModel<number>("hexMeilen", { default: HEXRASTER_VORGABE });
/** Die eingeschalteten Prüfhaken, in der Reihenfolge des Auges (`MAP_CHECKS`). */
const checks = defineModel<readonly MapCheck[]>("checks", { default: () => [] });

const CHECK_NAMES: Record<MapCheck, MessageKey> = {
    "uphill-rivers": "display.check.uphill-rivers",
    "loose-ends": "display.check.loose-ends",
    unconnected: "display.check.unconnected",
    "paths-apart": "display.check.paths-apart",
    "no-wiki": "display.check.no-wiki",
    "invalid-areas": "display.check.invalid-areas",
};

function setCheck(check: MapCheck, event: Event): void {
    const on = new Set(checks.value);
    if ((event.target as HTMLInputElement).checked) on.add(check);
    else on.delete(check);
    checks.value = MAP_CHECKS.filter((entry) => on.has(entry));
}

/** Legacy: das Menü verschwindet 120 ms nach dem Zuklappen - so lange läuft die Blende. */
const BLENDE_MS = 120;

const ICONS: Record<PlaceTier, string> = { metropole, grossstadt, stadt, kleinstadt, dorf, gebaeude: bauwerk };
const TITEL: Record<PlaceTier, MessageKey> = {
    metropole: "display.place.metropole",
    grossstadt: "display.place.grossstadt",
    stadt: "display.place.stadt",
    kleinstadt: "display.place.kleinstadt",
    dorf: "display.place.dorf",
    gebaeude: "display.place.gebaeude",
};

const button = useTemplateRef<HTMLButtonElement>("button");
const panel = useTemplateRef<HTMLDivElement>("panel");
/** Der Zustand (Legacy `zustandOffen`): gilt sofort, auch während die Blende noch läuft. */
const expanded = ref(false);
/** Im Dokument sichtbar - beim Zuklappen erst nach der Blende weg. */
const visible = ref(false);
/** Die Blende: ein Bild NACH dem Aufdecken gesetzt, sonst liefe kein Übergang. */
const rolledOut = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * So hoch wie der Inhalt, höchstens bis knapp unter den oberen Rand des Fensters (Betreiber 2026-11-08: „wär schön wenn das menü noch diese
 * höhe annehmen könnte, sodass man im frontend nicht scrollen muss“); vorher galten höchstens 420 px und die halbe Fensterhöhe. Gemessen beim
 * Öffnen und bei jeder Größenänderung, solange es offen ist: der Platz über dem Auge. Erst wenn der nicht reicht, rollt es.
 */
const RAND_OBEN = 10;
const maxHoehe = ref<string | undefined>();
function messeMaxHoehe(): void {
    const menu = panel.value;
    const huelle = menu?.parentElement?.getBoundingClientRect();
    if (!menu || !huelle) return;
    const abstand = Number.parseFloat(getComputedStyle(menu).marginBottom) || 0;
    maxHoehe.value = `${String(Math.max(160, Math.floor(huelle.top - abstand - RAND_OBEN)))}px`;
}
function beiGroesse(): void {
    if (expanded.value) messeMaxHoehe();
}

async function openMenu(): Promise<void> {
    clearTimeout(hideTimer);
    expanded.value = true;
    visible.value = true;
    await nextTick();
    messeMaxHoehe();
    // Den Anfangszustand erst messen lassen, sonst springt das Menü ohne Übergang auf.
    panel.value?.getBoundingClientRect();
    requestAnimationFrame(() => {
        if (expanded.value) {
            rolledOut.value = true;
        }
    });
}

/** Legacy: der Fokus bleibt beim Öffnen am Knopf; nur Escape gibt ihn nach der Blende zurück. */
function closeMenu(returnFocus = false): void {
    expanded.value = false;
    rolledOut.value = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        visible.value = false;
        if (returnFocus) {
            button.value?.focus();
        }
    }, BLENDE_MS);
}

function toggle(): void {
    if (expanded.value) {
        closeMenu();
    } else {
        void openMenu();
    }
}

/**
 * Jeder Klick außerhalb von Knopf und Menü schließt - auch auf die Karte und auf den Kartenfächer.
 * In der Fangphase, wie Legacy: der Fächer hält seine eigenen Klicks an.
 */
function onDocumentClick(event: MouseEvent): void {
    const ziel = event.target as Node | null;
    if (!expanded.value || !ziel) {
        return;
    }
    if (button.value?.contains(ziel) || panel.value?.contains(ziel)) {
        return;
    }
    closeMenu();
}

/**
 * 🔴 Esc gehört der Kaskade (`keyboard/escape-cascade.ts`, Stufe „menus“, WI-0063 4.10): Das offene Menü schließt, ohne die
 * Auswahl aufzuheben. Es hört nicht selbst auf die Taste - vorher schloss es sich, und derselbe Tastendruck hob die Auswahl auf.
 */
const escapeCascade = inject(ESCAPE_CASCADE_KEY, undefined);
let unregisterEscape: (() => void) | undefined;

onMounted(() => {
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("resize", beiGroesse);
    unregisterEscape = escapeCascade?.register("menus", () => {
        if (!expanded.value) return false;
        closeMenu(true);
        return true;
    });
});
onBeforeUnmount(() => {
    document.removeEventListener("click", onDocumentClick, true);
    window.removeEventListener("resize", beiGroesse);
    unregisterEscape?.();
    clearTimeout(hideTimer);
    clearTimeout(fertigTimer);
});

const locks = computed(() => lockedSwitches(props.view));
const reason = (schalter: DisplaySwitch): string | undefined => {
    const key = locks.value.get(schalter);
    return key ? t(key) : undefined;
};
/** „Grenzen“: gesperrt, wo die Ansicht keine Gebiete kennt, und wo (noch) keine Gebietsdaten vorliegen (WI-0062). */
const bordersLock = computed(
    () => reason("borders") ?? (props.territoriesReady === true ? undefined : t("display.lock.borders")),
);

const WETTER_ICONS: Record<WetterAnzeige, string> = {
    schneedecke: wetterSchneedecke,
    wolken: wetterWolken,
    regenUndSchnee: wetterRegenUndSchnee,
    wind: wetterWind,
    stroemungen: wetterMeeresstroemungen,
    niederschlag: wetterNiederschlag,
};
/** Die Namen der Icons für Titel und Vorlesetext; sie tragen weiche Trennstellen aus der Zeit, als sie unter den Icons standen. */
const WETTER_NAMEN: Record<WetterAnzeige, MessageKey> = {
    schneedecke: "display.weather.schneedecke",
    wolken: "display.weather.wolken",
    regenUndSchnee: "display.weather.regenUndSchnee",
    wind: "display.weather.wind",
    stroemungen: "display.weather.stroemungen",
    niederschlag: "display.weather.niederschlag",
};
const WETTER_TITEL: Record<WetterAnzeige, MessageKey> = {
    schneedecke: "display.weather.schneedecke.title",
    wolken: "display.weather.wolken.title",
    regenUndSchnee: "display.weather.regenUndSchnee.title",
    wind: "display.weather.wind.title",
    stroemungen: "display.weather.stroemungen.title",
    niederschlag: "display.weather.niederschlag.title",
};
/** Vorgelesen ohne die weichen Trennstellen (U+00AD). */
const WEICHE_TRENNSTELLE = String.fromCharCode(0xad);
const wetterAria = (id: WetterAnzeige): string =>
    `${t(WETTER_NAMEN[id]).replaceAll(WEICHE_TRENNSTELLE, "")}: ${t(WETTER_TITEL[id])}`;
/** Warum das Wetter gerade nicht geht: außerhalb der Ansicht „Standard“. Gilt für die Reihe und die Schneefallgrenze. */
const wetterLock = computed(() => {
    const key = wetterSperre(props.view);
    return key ? t(key) : undefined;
});

/**
 * Der Balken in der Kopfzeile: der Fortschritt des ersten Starts (`wetterLaden`). Ist er fertig, steht er kurz voll da und blendet dann
 * aus, statt bei 90 % zu verschwinden; ein Fehler nimmt ihn sofort weg (der Grund steht unter den Icons).
 */
const FERTIG_MS = 400;
const ladenAnzeige = ref<number | null>(null);
let fertigTimer: ReturnType<typeof setTimeout> | undefined;
watch(
    wetterLaden,
    (wert, vorher) => {
        clearTimeout(fertigTimer);
        if (wert !== null) {
            ladenAnzeige.value = wert;
        } else if (vorher != null && wetterFehler.value === null) {
            ladenAnzeige.value = 1;
            fertigTimer = setTimeout(() => (ladenAnzeige.value = null), FERTIG_MS);
        } else {
            ladenAnzeige.value = null;
        }
    },
    { immediate: true },
);

/** Die Messzeile (`?wetterTelefon=1`): ohne Messung, bis das Wetter läuft, nur die Grafikkarte offen. */
const messzeileText = computed(() => {
    const m = wetterMessung.value;
    return t("display.weather.test", {
        fps: m ? String(m.fps) : "-",
        anteil: m ? String(Math.round(m.anteil * 100)) : "-",
        takt: m ? String(m.takt) : "-",
        gpu: m?.gpu || "?",
    });
});

/** Das Ergebnis des Messlaufs in die Zwischenablage, damit es sich vom Telefon weitergeben lässt. */
const kopiert = ref(false);
async function kopiereMesslauf(): Promise<void> {
    const zeilen = wetterMesslauf.value;
    if (!Array.isArray(zeilen)) return;
    try {
        await navigator.clipboard.writeText(zeilen.join("\n"));
        kopiert.value = true;
        setTimeout(() => (kopiert.value = false), 2000);
    } catch {
        // Ohne Zwischenablage (kein sicherer Ursprung, verweigert) bleibt der Text zum Markieren stehen.
    }
}

/** Die Vorschau beim Überfahren: Stufe n zeigt, welche Stufen ein Klick einschalten würde. */
const preview = ref(0);

/**
 * 🔴 Gezählt wird das UMSCHALTEN (WI-0159, `BESUCH-0001 §13 D`: „Umschalten, nie der Startzustand“), und zwar hier an der
 * Hand des Menschen - nicht an der Adresse. Der Hash trägt die Schalter zwar (`displayParams`), wird aber nur mit
 * `replaceState` geschrieben, und das löst kein `hashchange` aus: Ein Sender daran meldete fast nie etwas (WI-0159 §3.3).
 * So laufen ein Ansichtswechsel, ein Kurzlink und ein geöffneter Link mit `?togglePaths=0` durch keine dieser Funktionen.
 */
function choosePlaces(stufe: number): void {
    const level = cascade(display.value.placeLevel, stufe);
    display.value = { ...display.value, placeLevel: level };
    melde("display_toggle", ortsStufenKennung(level));
}

function setSwitch(schalter: "layers" | "paths" | "labels" | "borders" | "rivers" | "flow", event: Event): void {
    const an = (event.target as HTMLInputElement).checked;
    display.value = { ...display.value, [schalter]: an };
    melde("display_toggle", schalterKennung(schalter, an));
}

/** Gradnetz und Hexraster schließen einander aus: Wer eines einschaltet, schaltet das andere ab. */
function setGitter(art: "gradnetz" | "hexraster", event: Event): void {
    const an = (event.target as HTMLInputElement).checked;
    if (art === "gradnetz") {
        gradnetz.value = an;
        if (an) hexraster.value = false;
    } else {
        hexraster.value = an;
        if (an) gradnetz.value = false;
    }
}

/** Der Regler läuft über die Stufen von `HEXRASTER_MEILEN`, nicht über die Meilen: 1 bis 100 linear wäre unten zu grob. */
const hexStufe = computed(() => HEXRASTER_MEILEN.indexOf(hexrasterMeilen(hexMeilen.value)));
const hexWert = computed(() => tPlural("display.hexraster.wert", hexMeilen.value, { n: hexMeilen.value }));
function setHexStufe(event: Event): void {
    hexMeilen.value = HEXRASTER_MEILEN[Number((event.target as HTMLInputElement).value)] ?? HEXRASTER_VORGABE;
}
/** Die Vorgabe als Anteil der Bahn: Der Daumen läuft eine Daumenbreite kürzer als die Bahn. */
const HEX_VORGABE_LAGE = `calc(var(--regler-daumen) / 2 + (100% - var(--regler-daumen)) * ${String(
    HEXRASTER_MEILEN.indexOf(HEXRASTER_VORGABE) / (HEXRASTER_MEILEN.length - 1),
)})`;

/** Die Flusszeile heißt nur dort „Flüsse und Seen", wo ein See eine Fläche ist (Legacy, Fall #129). */
const riverName = computed(() => (lakesAreAreas(props.view) ? t("display.riversAndLakes") : t("display.rivers")));
const riverTitle = computed(() => reason("rivers") ?? (lakesAreAreas(props.view) ? undefined : t(LAKES_IN_TILES_HINT)));
/** Ohne Flüsse keine Strömung: dann gesperrt, mit Grund. */
const flowLock = computed(() => reason("flow") ?? (display.value.rivers ? undefined : t("display.lock.flow")));
</script>

<template>
    <!--
        Das Auge: Farbe, Kontur, Radius und Schatten wie die übrigen Eckknöpfe, 48 × 48 wie die Lupe.
        Aufgeklappt trägt es den Schimmer eines überfahrenen Knopfes - es ist der offene Schalter.
        Die Hülle ist der Bezug des schwebenden Menüs. Wie Lupe und Fächer deckt sie Karte im Eckbund und zählt für das Ziel
        eines Hinflugs als Deckung (`data-ziel-deckung`, `map/camera/visible-area.ts`).
    -->
    <div class="display" data-ziel-deckung>
        <button
            ref="button"
            type="button"
            class="display-button"
            data-testid="display-open"
            aria-haspopup="true"
            :aria-expanded="expanded"
            :title="t('display.button.title')"
            :aria-label="t('display.button.aria')"
            @click="toggle"
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                <circle cx="12" cy="12" r="2.8" />
            </svg>
        </button>
        <div
            ref="panel"
            :hidden="!visible"
            class="display-menu"
            :class="{ 'is-open': rolledOut }"
            :style="maxHoehe ? { '--display-menu-max-h': maxHoehe } : undefined"
            role="group"
            :aria-label="t('display.button.aria')"
            data-testid="display-menu"
        >
            <div
                class="display-menu__group"
                :class="{ 'is-locked': reason('places') }"
                :title="reason('places')"
                data-testid="display-places"
            >
                <p class="display-menu__title">{{ t("display.places") }}</p>
                <div class="location-toggle-group" role="group" :aria-label="t('display.places.aria')">
                    <button
                        v-for="(stufe, index) in PLACE_TIERS"
                        :key="stufe"
                        type="button"
                        class="location-toggle"
                        :class="{
                            'is-active': index < display.placeLevel,
                            'is-hover-preview': index < preview,
                        }"
                        :data-testid="`display-place-${stufe}`"
                        :aria-pressed="index < display.placeLevel"
                        :disabled="reason('places') !== undefined"
                        :title="t(TITEL[stufe])"
                        :aria-label="t(TITEL[stufe])"
                        @click="choosePlaces(index + 1)"
                        @mouseenter="preview = index + 1"
                        @focus="preview = index + 1"
                        @mouseleave="preview = 0"
                        @blur="preview = 0"
                    >
                        <img class="location-toggle__icon" :src="ICONS[stufe]" alt="" />
                    </button>
                </div>
            </div>
            <!--
            💣 Jede Zeile ist EIN <label>: Klickfläche, Tastatur, Fokusreihenfolge und Vorlesbarkeit
            kommen vom Browser. Das Auge ist reine Darstellung, die Checkbox darin der Zustand.
        -->
            <div class="display-menu__group">
                <p class="display-menu__title">{{ t("display.layers") }}</p>
                <label
                    class="display-menu__row"
                    :class="{ 'is-locked': reason('paths') }"
                    :title="reason('paths')"
                    data-testid="display-paths"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                        >
                            <path d="M4 20c3-1 3.5-5 6-8s5.5-3 10-8" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.paths") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="display.paths"
                        :disabled="reason('paths') !== undefined"
                        :aria-disabled="reason('paths') !== undefined"
                        @change="setSwitch('paths', $event)"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <label v-if="view === 'landscapes'" class="display-menu__row" data-testid="display-layers">
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M3 8l9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.layers") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="display.layers"
                        @change="setSwitch('layers', $event)"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <label class="display-menu__row" data-testid="display-labels">
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M4 17.5L9 6l5 11.5" />
                            <path d="M5.7 14h6.6" />
                            <path d="M17 17.5V10" />
                            <circle cx="19.6" cy="17.5" r="2.4" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.labels") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="display.labels"
                        @change="setSwitch('labels', $event)"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <label
                    class="display-menu__row"
                    :class="{ 'is-locked': bordersLock }"
                    :title="bordersLock"
                    data-testid="display-borders"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-dasharray="3.4 3"
                        >
                            <path d="M3 18c3.5 0 4-4.5 7.5-4.5S15 18 21 6" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.borders") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="display.borders"
                        :disabled="bordersLock !== undefined"
                        :aria-disabled="bordersLock !== undefined"
                        @change="setSwitch('borders', $event)"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <label
                    class="display-menu__row"
                    :class="{ 'is-locked': reason('rivers') }"
                    :title="riverTitle"
                    data-testid="display-rivers"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                        >
                            <path d="M2 9c2.5-2.4 4.5 2.4 7 0s4.5 2.4 7 0 4.5 2.4 6 .6" />
                            <path d="M2 16c2.5-2.4 4.5 2.4 7 0s4.5 2.4 7 0 4.5 2.4 6 .6" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ riverName }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="display.rivers"
                        :disabled="reason('rivers') !== undefined"
                        :aria-disabled="reason('rivers') !== undefined"
                        @change="setSwitch('rivers', $event)"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <label
                    v-if="view === 'landscapes' && layer === 'topographie'"
                    class="display-menu__row"
                    data-testid="display-hoehenlinien"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M3 17c3-1 4-5 9-5s6 4 9 5" />
                            <path d="M6 13c2-2 3-5 6-5s4 3 6 5" />
                            <path d="M9.5 9c1-1.3 1.5-3 2.5-3s1.5 1.7 2.5 3" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.hoehenlinien") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="hoehenlinienZeigen"
                        @change="hoehenlinienZeigen = ($event.target as HTMLInputElement).checked"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <!-- Die Legende der Sprachen nur auf Wunsch (Betreiber 2026-10-31, `sprachen-legende-schalter.ts`). -->
                <label
                    v-if="view === 'landscapes' && layer === 'sprachen'"
                    class="display-menu__row"
                    data-testid="display-sprachenlegende"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <rect x="3.5" y="4.5" width="4" height="4" rx="0.8" />
                            <rect x="3.5" y="10" width="4" height="4" rx="0.8" />
                            <rect x="3.5" y="15.5" width="4" height="4" rx="0.8" />
                            <path d="M11 6.5h9.5M11 12h9.5M11 17.5h9.5" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.sprachenlegende") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="sprachenLegendeZeigen"
                        @change="sprachenLegendeZeigen = ($event.target as HTMLInputElement).checked"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <label
                    v-if="terrainPaused !== undefined"
                    class="display-menu__row is-locked"
                    :title="terrainPaused"
                    data-testid="display-terrain-paused"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 19l6.5-10 4 6 2.5-3.5L22 19z" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.terrain3d") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="false"
                        disabled
                        aria-disabled="true"
                        :aria-description="terrainPaused"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <!-- Längen- und Breitengrade nach DereGlobus, mit Rahmen und Gradleiste (WI-0273, OPS-069). -->
                <label class="display-menu__row" :title="t('display.gradnetz.title')" data-testid="display-gradnetz">
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 3c-3.6 3-3.6 15 0 18M12 3c3.6 3 3.6 15 0 18M3.6 9h16.8M3.6 15h16.8" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.gradnetz") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="gradnetz"
                        @change="setGitter('gradnetz', $event)"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <!--
                    Sechseckfelder zum Abschätzen von Reisen, an Stelle des Gradnetzes (WI-0273). Ist es an, steht der Regler der Feldgröße
                    in derselben Zeile (Betreiber 2026-10-31: „tu den slider in eine zeile“). 🪤 Das Kästchen steht VOR dem Regler: Ein
                    <label> gehört dem ersten Bedienelement darin. Ein Klick auf den Regler schaltet nichts um (er ist selbst bedienbar),
                    einer auf den Wert daneben auch nicht (`.prevent`).
                -->
                <label
                    class="display-menu__row"
                    :class="{ 'has-regler': hexraster }"
                    :title="t('display.hexraster.title')"
                    data-testid="display-hexraster"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M12 9L6.8 6 1.6 9v6l5.2 3 5.2-3zM12 9l5.2-3 5.2 3v6l-5.2 3-5.2-3" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.hexraster") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="hexraster"
                        :aria-label="t('display.hexraster')"
                        @change="setGitter('hexraster', $event)"
                    />
                    <!-- Die Feldgröße, von Seite zu Seite (Guide „Regler“: Wert rechts gedämpft, Dreieck an der Vorgabe). -->
                    <span
                        v-if="hexraster"
                        class="display-menu__regler"
                        :title="t('display.hexraster.groesse.title')"
                        data-testid="display-hexraster-groesse"
                        @click.prevent
                    >
                        <span class="display-menu__regler-bahn">
                            <input
                                type="range"
                                min="0"
                                :max="HEXRASTER_MEILEN.length - 1"
                                step="1"
                                :value="hexStufe"
                                :aria-label="t('display.hexraster.groesse')"
                                :aria-valuetext="hexWert"
                                data-testid="display-hexraster-regler"
                                @input="setHexStufe"
                            />
                            <span
                                class="display-menu__regler-vorgabe"
                                :style="{ left: HEX_VORGABE_LAGE }"
                                aria-hidden="true"
                            />
                        </span>
                        <span class="display-menu__regler-wert">{{ hexWert }}</span>
                    </span>
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
            </div>
            <!--
                Das Wetter (WI-0288): eine eigene Gruppe unter „Ebenen“ (Betreiber 2026-11-08: „"Wetter" aus "Ebenen" herausholen … zu einer
                kategorie machen“, dann ganz nach oben, am selben Tag „wetter kann jetzt doch unter „ebenen““). Sechs Icons wie die Orte, aber
                jedes für sich, ohne Kaskade und ohne Namen darunter; der Name steht im Titel und im Vorlesetext. Die Zeile darunter ist immer
                einzeilig (Betreiber: „die wetterzeile text unter den icons sollte nur einzeilig sein“), der ganze Text steht im Titel.
                Der Balken des ersten Starts steht rechts in der Kopfzeile, über ihr schwebend: Kommt und geht er, bleibt das Menü stehen
                (Betreiber 2026-11-08: „wenn der ladebalken fertig ist, verschwindet er und das ganze menü rutscht nach unten“; gewählt die
                Variante „Balken in die Kopfzeile“ aus meiner Vorlage).
            -->
            <div
                class="display-menu__group wetter"
                :class="{ 'is-locked': wetterLock }"
                :title="wetterLock"
                data-testid="display-wetter"
            >
                <p class="display-menu__title wetter__kopf">
                    {{ t("display.weather") }}
                    <Transition name="wetter-laden">
                        <span
                            v-if="ladenAnzeige !== null"
                            class="wetter__laden"
                            role="progressbar"
                            :aria-valuenow="Math.round(ladenAnzeige * 100)"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            :aria-label="t('display.weather.loading')"
                            :title="t('display.weather.loading')"
                            data-testid="display-wetter-laden"
                        >
                            <span class="wetter__balken">
                                <span
                                    class="wetter__balken-fuellung"
                                    :style="{ width: `${Math.round(ladenAnzeige * 100)}%` }"
                                ></span>
                            </span>
                            <span class="wetter__anteil">{{
                                t("display.weather.loading.anteil", { n: String(Math.round(ladenAnzeige * 100)) })
                            }}</span>
                        </span>
                    </Transition>
                </p>
                <div class="location-toggle-group" role="group" :aria-label="t('display.weather.aria')">
                    <button
                        v-for="id in WETTER_ANZEIGEN"
                        :key="id"
                        type="button"
                        class="location-toggle"
                        :class="{ 'is-active': wetterStand[id] }"
                        :data-testid="`display-wetter-${id}`"
                        :aria-pressed="wetterStand[id]"
                        :disabled="wetterLock !== undefined"
                        :title="wetterLock ?? wetterAria(id)"
                        :aria-label="wetterAria(id)"
                        @click="klickeWetter(id, !wetterStand[id])"
                    >
                        <img class="location-toggle__icon" :src="WETTER_ICONS[id]" alt="" />
                    </button>
                </div>
                <p
                    v-if="wetterLock"
                    class="wetter__unter einzeilig"
                    :title="wetterLock"
                    data-testid="display-wetter-sperre"
                >
                    {{ wetterLock }}
                </p>
                <!-- Kann die Engine nicht zeichnen (etwa ein Telefon ohne Gleitkomma-Puffer), steht das hier statt Stille; die Einzelheit im Titel. -->
                <p
                    v-else-if="wetterFehler"
                    class="wetter__unter einzeilig"
                    :title="wetterFehler"
                    data-testid="display-wetter-fehler"
                >
                    {{ t("display.weather.error") }}
                </p>
                <!--
                    Nur mit der Messzeile (`?wetterTelefon=1`): was die Engine auf diesem Gerät schafft, und der Messlauf (Betreiber
                    2026-11-08: „wir sollten versuchen noch fürs handy zu benchmarken“). Sein Ergebnis darf mehrzeilig sein: Es ist zum Kopieren da.
                -->
                <template v-if="wetterMesszeile">
                    <div class="wetter__messung">
                        <p class="wetter__unter einzeilig" :title="messzeileText" data-testid="display-wetter-messung">
                            {{ messzeileText }}
                        </p>
                        <button
                            type="button"
                            class="wetter__messknopf"
                            :disabled="wetterMesslauf === 'laeuft'"
                            :title="t('display.weather.messlauf.title')"
                            data-testid="display-wetter-messlauf"
                            @click="starteWetterMesslauf()"
                        >
                            {{ t("display.weather.messlauf") }}
                        </button>
                    </div>
                    <p v-if="wetterMesslauf === 'laeuft'" class="wetter__unter einzeilig">
                        {{ t("display.weather.messlauf.laeuft") }}
                    </p>
                    <template v-else-if="wetterMesslauf !== null">
                        <pre class="wetter__ergebnis" data-testid="display-wetter-ergebnis">{{
                            wetterMesslauf.join("\n")
                        }}</pre>
                        <button type="button" class="wetter__messknopf" @click="kopiereMesslauf()">
                            {{ kopiert ? t("display.weather.kopiert") : t("display.weather.kopieren") }}
                        </button>
                    </template>
                </template>
            </div>
            <!--
                Prüfen · nur Editoren (WI-0131, wie Legacy `index.html:3115-3248`): Strömungsrichtungen, die Prüfhaken, das Kachelraster.
                Besucher sehen die Gruppe nicht; was jemand sieht, prüft der Server.
            -->
            <div v-if="flowDirections || editorChecks" class="display-menu__group" data-testid="display-checks">
                <p class="display-menu__title">
                    {{ t("display.checks")
                    }}<span class="display-menu__scope">{{ t("display.checks.editorOnly") }}</span>
                </p>
                <!-- Nur für Editoren: die Pfeile auf den Flüssen samt weißer Flusskontur (Betreiber 2026-09-28). -->
                <label
                    v-if="flowDirections"
                    class="display-menu__row"
                    :class="{ 'is-locked': flowLock }"
                    :title="flowLock"
                    data-testid="display-flow"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12.5c2.5-2.4 4.5 2.4 7 0s4.5 2.4 7 0" />
                            <path d="M16.5 8.5l5 3.5-5 3.5z" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.flow") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="display.flow"
                        :disabled="flowLock !== undefined"
                        :aria-disabled="flowLock !== undefined"
                        @change="setSwitch('flow', $event)"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <!-- Die Prüfhaken (WI-0131): je einer, in Legacys Formen und Tönen; Orange ist neu für „Flüsse bergaufwärts“. -->
                <template v-if="editorChecks">
                    <label
                        v-for="check in MAP_CHECKS"
                        :key="check"
                        class="display-menu__row"
                        :data-testid="`display-check-${check}`"
                    >
                        <span class="display-menu__glyph" aria-hidden="true">
                            <svg
                                v-if="check === 'uphill-rivers'"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke-width="2.2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path class="check-glyph--uphill" d="M2 16c2.2-2.2 4 2.2 6.2 0s4-2.2 6.2 0" />
                                <path class="check-glyph--uphill" d="M19 15V4M15.5 7.5L19 4l3.5 3.5" />
                            </svg>
                            <svg
                                v-else-if="check === 'loose-ends'"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke-width="2.4"
                                stroke-linecap="round"
                            >
                                <path class="check-glyph--loose" d="M3 19L12.5 9.5" />
                                <circle class="check-glyph--loose" cx="16.5" cy="6.5" r="4" />
                            </svg>
                            <!-- WI-0132 P2: zwei Wegenden, die sich knapp verfehlen; am Blatt abgenommen 2026-10-11. -->
                            <svg
                                v-else-if="check === 'paths-apart'"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke-width="2.4"
                                stroke-linecap="round"
                            >
                                <path class="check-glyph--apart" d="M2 15L9 12M22 9L15 12" />
                                <circle class="check-glyph--apart" cx="12" cy="12" r="3.6" />
                            </svg>
                            <!-- Flächen kreuzen sich (2026-11-10): ein Umriss, der sich selbst kreuzt, im Rot der Marke von „Ecken bearbeiten“. -->
                            <svg
                                v-else-if="check === 'invalid-areas'"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke-width="2.2"
                                stroke-linejoin="round"
                            >
                                <path class="check-glyph--invalid" d="M3.5 6L20.5 18V6L3.5 18Z" />
                            </svg>
                            <svg v-else viewBox="0 0 24 24">
                                <circle
                                    :class="
                                        check === 'unconnected' ? 'check-glyph--unconnected' : 'check-glyph--no-wiki'
                                    "
                                    cx="12"
                                    cy="12"
                                    r="8"
                                    fill="none"
                                    stroke-width="3.5"
                                />
                                <circle class="check-glyph--marker" cx="12" cy="12" r="3.5" />
                            </svg>
                        </span>
                        <span class="display-menu__name">
                            {{ t(CHECK_NAMES[check]) }}
                            <span
                                v-if="checks.includes(check) && mapCheckProblems[check]"
                                class="display-menu__problem"
                                :data-testid="`display-check-problem-${check}`"
                            >
                                {{ t(PROBLEM_TEXT[mapCheckProblems[check]]) }}
                            </span>
                        </span>
                        <input
                            type="checkbox"
                            class="display-menu__state"
                            :checked="checks.includes(check)"
                            @change="setCheck(check, $event)"
                        />
                        <span class="display-menu__eye" aria-hidden="true">
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.9"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                                <circle cx="12" cy="12" r="2.8" />
                                <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                            </svg>
                        </span>
                    </label>
                </template>
                <!-- Nur für Editoren: wo die Rechenkacheln des Höhenmodells aneinanderstoßen (WI-0070). -->
                <label v-if="flowDirections" class="display-menu__row" data-testid="display-tile-grid">
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M3 3h18v18H3z" />
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.tileGrid") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="tileGrid"
                        @change="tileGrid = ($event.target as HTMLInputElement).checked"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
                <!-- Nur für Editoren: die Schneefallgrenze des Wetters als Linie (WI-0288); sie lädt das Wetter wie jeder Wetterschalter. -->
                <label
                    v-if="editorChecks"
                    class="display-menu__row"
                    :class="{ 'is-locked': wetterLock }"
                    :title="wetterLock ?? t('display.check.snowline.title')"
                    data-testid="display-schneefallgrenze"
                >
                    <span class="display-menu__glyph" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 19l6.5-10 4 6 2.5-3.5L22 19z" />
                            <path d="M2.5 13h19" stroke-dasharray="2.6 2.2" />
                        </svg>
                    </span>
                    <span class="display-menu__name">{{ t("display.check.snowline") }}</span>
                    <input
                        type="checkbox"
                        class="display-menu__state"
                        :checked="wetterStand.schneefallgrenze"
                        :disabled="wetterLock !== undefined"
                        :aria-disabled="wetterLock !== undefined"
                        @change="klickeWetter('schneefallgrenze', ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="display-menu__eye" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.8" />
                            <path class="display-menu__eye-slash" d="M3.5 3.5l17 17" />
                        </svg>
                    </span>
                </label>
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * Legacys Auge, Wert für Wert (`css/components/map-display-menu.css`, `legal-dialog.css`). Farben,
 * Radien, Schatten und Abstände aus dem Kanon; was Legacy als eigene Zahl führt, steht hier benannt:
 * die Menübreite (Legacys `--avesmaps-planner-width`), der Deckel der Höhe, der Kachelknopf.
 */
.display-button {
    --display-button: 48px;

    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--display-button);
    height: var(--display-button);
    padding: 0;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    cursor: pointer;
}

.display-button svg {
    display: block;
    width: var(--icon-lg);
    height: var(--icon-lg);
}

/* 🪤 Die Hoverwäsche liegt ÜBER der Fläche, sonst sähe man die Karte durch. Aufgeklappt derselbe Schimmer. */
.display-button:hover,
.display-button:focus-visible,
.display-button[aria-expanded="true"] {
    outline: none;
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

.display-button:focus-visible {
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-panel);
}

/* Der Bezug des Menüs: so hoch wie das Auge, rechtsbündig im Bund. */
.display {
    position: relative;
    display: flex;
}

/*
 * 🔴 ES SCHWEBT, unmittelbar über dem Auge: `bottom: 100%` der Hülle. Es verdeckt weder das Auge
 * noch die Lupe darunter; über ihm liegende Knöpfe des Bundes (am Finger der 3D-Knopf) deckt es zu,
 * solange es offen ist.
 */
.display-menu {
    --display-menu-width: 350px;
    /* Bis zur ersten Messung; dann der Platz über dem Auge (`messeMaxHoehe`). */
    --display-menu-max-h: 420px;
    --display-menu-drop: 4px;

    position: absolute;
    right: 0;
    bottom: 100%;
    z-index: 1;
    box-sizing: border-box;
    width: var(--display-menu-width);
    max-width: calc(100vw - 2 * var(--space-10));
    max-height: var(--display-menu-max-h);
    margin-bottom: var(--space-4);
    padding: var(--space-10);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    text-align: left;
    /* Kurze Blende beim Aufklappen. Anders als beim Fächer darf sie an der Hülle sitzen: das Auge
       bleibt sichtbar darunter stehen, es wackelt nichts. */
    opacity: 0;
    transform: translateY(var(--display-menu-drop));
    transition:
        opacity 120ms ease,
        transform 120ms ease;
}

.display-menu.is-open {
    opacity: 1;
    transform: none;
}

/* Am Telefon die Breite des Schirms, der Kartenrand bleibt beidseitig stehen (Owner Legacy 12.08.2026). */
@media (max-width: 560px) {
    .display-menu {
        width: calc(100vw - 2 * var(--space-10));
    }
}

@media (prefers-reduced-motion: reduce) {
    .display-menu {
        transition: none;
        transform: none;
    }
}

/* Gruppiert per Trenner und Überschrift, nicht per Rahmen; der Trenner läuft von Kante zu Kante. */
.display-menu__group + .display-menu__group {
    margin: var(--space-10) calc(var(--space-10) * -1) 0;
    padding: var(--space-10) var(--space-10) 0;
    border-top: 1px solid var(--color-divider);
}

.display-menu__title {
    margin: 0 0 var(--space-6);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/*
 * Das Etikett „nur Editoren“ neben der Überschrift (Legacys `.avesmaps-scope-hint`, Guide §18 „Die Editorgruppe trägt ihr
 * Etikett“): Pillenpalette, 11 px, Radius 8, Polster 0/6. 💣 Es nimmt Sperrung und Versalien der Überschrift zurück, sonst läse es
 * sich als zweite Überschrift statt als Anmerkung.
 */
.display-menu__scope {
    margin-left: var(--space-6);
    padding: 0 var(--space-6);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
    letter-spacing: 0;
    text-transform: none;
    white-space: nowrap;
    vertical-align: middle;
}

/* Warum ein Haken nichts zeigt: eine leise Zeile unter dem Namen, ohne Anrede. */
.display-menu__problem {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die Sinnbilder der Prüfhaken tragen den Ton ihrer Markierung auf der Karte (Kanon `mapCheck*`), wie auf Blatt 1. */
.check-glyph--uphill {
    stroke: var(--color-map-check-uphill);
}

.check-glyph--loose {
    stroke: var(--color-map-check-loose-path);
}

.check-glyph--unconnected {
    stroke: var(--color-map-check-unconnected);
}

.check-glyph--apart {
    stroke: var(--color-map-check-apart);
}

.check-glyph--no-wiki {
    stroke: var(--color-map-check-no-wiki);
}

.check-glyph--invalid {
    stroke: var(--color-danger);
}

.check-glyph--marker {
    fill: var(--color-marker-settlement);
}

/* ═══ Eine Ebenen-Zeile: Sinnbild - Name - (Zustand) - Auge ═══ */
.display-menu__row {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    margin: 0 calc(var(--space-6) * -1);
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    cursor: pointer;
}

.display-menu__row:hover {
    background: var(--color-hover-wash);
}

/* Der Fokusring gehört der ZEILE: die Checkbox ist aus dem Bild genommen. */
.display-menu__row:has(.display-menu__state:focus-visible) {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.display-menu__glyph,
.display-menu__eye {
    flex: 0 0 auto;
    width: var(--icon-md);
    height: var(--icon-md);
}

.display-menu__glyph {
    color: var(--color-text-muted);
}

.display-menu__eye {
    color: var(--color-accent-strong);
}

.display-menu__glyph svg,
.display-menu__eye svg {
    display: block;
    width: 100%;
    height: 100%;
}

.display-menu__name {
    flex: 1 1 auto;
    min-width: 0;
}

/* 💣 AUS DEM BILD GENOMMEN, NICHT VERSTECKT: so bleibt die Checkbox fokussierbar. */
.display-menu__state {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

/* Der Schrägstrich gehört dem AUS-Zustand - AUS ist der auffällige: die geschlossenen Augen SIND die Liste. */
.display-menu__eye-slash {
    display: none;
}

.display-menu__row:not(:has(.display-menu__state:checked)) .display-menu__eye-slash {
    display: inline;
}

.display-menu__row:not(:has(.display-menu__state:checked)) .display-menu__name,
.display-menu__row:not(:has(.display-menu__state:checked)) .display-menu__eye {
    color: var(--color-text-muted);
}

.display-menu__row:not(:has(.display-menu__state:checked)) .display-menu__glyph {
    opacity: 0.4;
}

/*
 * ═══ Der Regler in der Zeile (Hexraster): zwischen Name und Auge, der Wert rechts gedämpft, die Vorgabe als Dreieck 8 × 6
 * unter der Bahn (Guide „Regler“ und §13.25). Er trägt das Gold der Augen: Das Auge ist ein Menü für alle, kein Editor.
 * Der Name bleibt ganz stehen; die Bahn nimmt, was übrig ist. ═══
 */
.display-menu__row.has-regler .display-menu__name {
    flex: 0 0 auto;
}

.display-menu__regler {
    --regler-daumen: 16px;

    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    cursor: default;
}

.display-menu__regler-bahn {
    position: relative;
    display: grid;
    flex: 1 1 0;
    min-width: 40px;
}

.display-menu__regler-bahn input {
    width: 100%;
    margin: 0;
    accent-color: var(--color-accent-strong);
    cursor: pointer;
}

.display-menu__regler-bahn input:focus-visible {
    outline: none;
    border-radius: var(--radius-md);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.display-menu__regler-vorgabe {
    position: absolute;
    bottom: -6px;
    width: 0;
    height: 0;
    border-right: 4px solid transparent;
    border-bottom: 6px solid var(--color-text-muted);
    border-left: 4px solid transparent;
    transform: translateX(-50%);
    pointer-events: none;
}

/* Breit genug für „100 Meilen“: Die Bahn springt beim Ziehen nicht. */
.display-menu__regler-wert {
    min-width: 8ch;
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}

/* ═══ Gesperrt: was die Ansicht nicht zeigen kann - der Grund steht im Titel ═══ */
.display-menu__row.is-locked,
.display-menu__group.is-locked,
.wetter.is-locked {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.display-menu__row.is-locked:hover {
    background: none;
}

.display-menu__row.is-locked .display-menu__name,
.display-menu__row.is-locked .display-menu__eye {
    color: var(--color-disabled-text);
}

.display-menu__row.is-locked .display-menu__glyph,
.display-menu__group.is-locked .location-toggle,
.wetter.is-locked .location-toggle {
    opacity: 0.25;
}

.display-menu__group.is-locked .location-toggle,
.wetter.is-locked .location-toggle {
    cursor: not-allowed;
}

.display-menu__group.is-locked .location-toggle:hover,
.wetter.is-locked .location-toggle:hover {
    transform: none;
    opacity: 0.25;
}

/*
 * ═══ Das Wetter als eigene Gruppe unter „Ebenen“ (WI-0288; Betreiber 2026-11-08): Überschrift wie „Orte“, die Reihe der Orte, ohne
 * Namen darunter. Gesperrt steht der Grund als Zeile darunter (sie bricht nie um), beim ersten Start der Balken rechts im Kopf. ═══
 */

/*
 * Der Balken des ersten Starts schwebt rechts in der Kopfzeile (absolut): Er nimmt keinen Platz, also bleibt das Menü stehen, wenn er
 * kommt und geht. Ohne Versalien und Sperrung des Titels, wie das Etikett „nur Editoren“.
 */
.wetter__kopf {
    position: relative;
}

.wetter__laden {
    position: absolute;
    top: 50%;
    right: 0;
    display: flex;
    gap: var(--space-6);
    align-items: center;
    color: var(--color-text-muted);
    letter-spacing: normal;
    text-transform: none;
    transform: translateY(-50%);
}

/* Wie in den Abgleichen der Systemsteuerung: 4 px, die Füllung im Akzent. */
.wetter__balken {
    width: 64px;
    height: 4px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.wetter__anteil {
    min-width: 4ch;
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.wetter-laden-leave-active {
    transition: opacity 180ms ease;
}

.wetter-laden-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .wetter-laden-leave-active {
        transition: none;
    }
}

.wetter__balken-fuellung {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

/* Einzeilig über `.einzeilig` (app.vue; Betreiber 2026-11-08: „die wetterzeile text unter den icons sollte nur einzeilig sein“); was nicht
   passt, endet mit „…“ und steht ganz im Titel. */
.wetter__unter {
    margin-top: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

/* Die Messzeile mit dem Knopf des Messlaufs rechts daneben. */
.wetter__messung {
    display: flex;
    gap: var(--space-6);
    align-items: center;
    margin: var(--space-4) 0 0;
}

.wetter__messung .wetter__unter {
    flex: 1;
    min-width: 0;
    margin-top: 0;
}

.wetter__messknopf {
    flex: none;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    cursor: pointer;
}

.wetter__messknopf:hover:not(:disabled) {
    background: var(--color-panel-active);
}

.wetter__messknopf:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
}

.wetter__messknopf:disabled {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

/* Das Ergebnis des Messlaufs: mehrzeilig und markierbar, es ist zum Kopieren da. */
.wetter__ergebnis {
    margin: var(--space-4) 0;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
}

/* ═══ Die sechs Ortsklassen: AUS ist der auffällige Zustand ═══ */
.location-toggle-group {
    --location-toggle-gap: 3px;

    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--location-toggle-gap);
    width: 100%;
}

.location-toggle {
    --location-toggle-lift: -1px;

    appearance: none;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    box-shadow: none;
    cursor: pointer;
    line-height: 1;
    opacity: 0.3;
    transition:
        opacity 120ms ease,
        transform 120ms ease;
}

.location-toggle__icon {
    display: block;
    width: var(--icon-xl);
    height: var(--icon-xl);
    object-fit: contain;
    pointer-events: none;
    user-select: none;
}

.location-toggle.is-hover-preview,
.location-toggle:hover,
.location-toggle:focus-visible {
    outline: none;
    opacity: 0.7;
}

.location-toggle.is-active,
.location-toggle.is-active.is-hover-preview,
.location-toggle.is-active:hover,
.location-toggle.is-active:focus-visible {
    opacity: 1;
}

/* Abweichung von Legacy: ein Fokusring für die Tastatur (Guide §30.5), dort nur die Deckkraft. */
.location-toggle:focus-visible {
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.location-toggle:hover {
    transform: translateY(var(--location-toggle-lift));
}

@media (prefers-reduced-motion: reduce) {
    .location-toggle {
        transition: none;
    }

    .location-toggle:hover {
        transform: none;
    }
}
</style>
