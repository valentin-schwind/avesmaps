<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { isDepartureMonth, departureDays, type SubjectRef } from "@avesmaps3d/shared";
import ClosureNote from "./closure-note.vue";
import { closureLead, closureReason, closureRefusal, closureWayName } from "./closure-notes";
import RouteOverview from "./route-overview.vue";
import { einmalOffen } from "../einmal-offen";
import { RouteOptionsInfoFenster, TransportInfoFenster } from "../nachladen";
import RoutePlayer from "./route-player.vue";
import TransportSelect from "./transport-select.vue";
import InfoKnopf from "../fenster/info-knopf.vue";
import AvmFeld from "../controls/avm-feld.vue";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import ThemeToggle from "../controls/theme-toggle.vue";
import LangToggle from "../controls/lang-toggle.vue";
import WaypointRow from "./waypoint-row.vue";
import AirTransport from "./air-transport.vue";
import { airSummary, selectedAir, type AirChoiceId, type AirCustom } from "./air-profiles";
import {
    clampHoursPerDay,
    clampStartDay,
    DEPARTURE_MONTHS,
    LODGING_OPTIONS,
    lodgingLabel,
    monthOption,
    DOMAIN_ICONS,
    domainLabel,
    domainTitle,
    DOMAINS,
    mapPointNames,
    optionsSummary,
    TRANSPORT_ICONS,
    transportLabel,
    TRANSPORTS,
    transportSummary,
    WORDMARK,
    type Domain,
    type PlannerOptions,
} from "./planner-model";
import type { Planner } from "./use-planner";
import type { Playmode } from "./use-playmode";
import type { ShareLink } from "./use-share-link";
import type { LandscapeEntry, LandscapeLines, TerritoryEntry } from "./route-landscapes";
import { costView, type BorderStep } from "./travel-cost-view";
import { t } from "../i18n/i18n";
import { showToast } from "../feedback/toast";
import { ausgeblendet } from "../system/inhaltsstand";
import { pausiertSatz } from "../system/inhaltsstand-text";
import { wegfindungImBrowserWerte } from "../map/start-view";

/**
 * Der Routenplaner (WI-0017, Schritt 2; Design Guide §17, MCS-020 A–E): Panel am linken Rand mit
 * Lasche, Kopf, Wegpunkten, zwei Rahmenkästen und der Reiseübersicht.
 *
 * - **Die Lasche steht NEBEN dem Panel, nicht darin** (Legacy 11.08.2026): Das Panel rollt, und iOS
 *   bände ein Kind eines rollenden Kastens an diesen statt an den Bildschirm - die Lasche verschwände.
 * - **Die Kästen klappen mit der Route** (Legacy C4): Steht eine Route, klappen beide zu und zeigen
 *   ihre Zusammenfassung; ist 700 ms keine mehr da, gehen sie wieder auf. Eine Neuberechnung zählt
 *   als „Route steht" - die alte bleibt gedimmt stehen, und nichts klappt auf und zu.
 * - **Am Telefon** läuft das Panel von Kante zu Kante und die Lasche wird ein Pfeilgriff (Legacy A2).
 * - **Unter dem Panel die Leiste des Playmodes** (WI-0031), sobald eine Route steht: ohne Abstand,
 *   nur ein durchgehender Trenner dazwischen. Beide zusammen halten oben und unten denselben Abstand
 *   zum Rand (Betreiber 2026-09-24); das Panel rollt, die Leiste nie.
 */
const props = defineProps<{
    planner: Planner;
    phone: boolean;
    playmode?: Playmode | undefined;
    /** Der Kurzlink hinter 🔗 (WI-0034). */
    shareLink?: ShareLink | undefined;
    /** Die Landschaften und Gebiete der gezeigten Route (WI-0035): `app.vue` fragt sie EINMAL, Planer und Infopanel lesen sie; `null`, bis sie da sind. */
    landscapes: LandscapeLines | null;
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{
    showSubject: [ref: SubjectRef];
    showLandscape: [entry: LandscapeEntry];
    showBorder: [step: BorderStep];
    showTerritory: [entry: TerritoryEntry];
}>();

const planner = props.planner;
/** Die Reiseberechnung ist pausiert (WI-0127 SYS-11, Schalter `route.compute`): der Satz oben im Planer; die Karte funktioniert weiter. */
const reisePausiert = computed(() => ausgeblendet("route.compute"));
const filledCount = computed(() => planner.filled.value.length);
/** Die Grenze der Wegpunkte, wie die Systemsteuerung sie einstellt (WI-0214); ohne Antwort die Vorgabe. */
const waypointLimit = wegfindungImBrowserWerte().routeWaypointLimit;
const atLimit = computed(() => planner.waypoints.length >= waypointLimit);
/** Die Leiste hängt unter dem Panel, sobald eine Route steht - dann ist sie sein Fuß. */
const showPlayer = computed(() => props.playmode !== undefined && planner.route.value?.found === true);

// --- Die Rahmenkästen klappen mit der Route (Legacy map-features-planner-groups.js) ---

/** So lange muss die Route fehlen, bevor die Kästen wieder aufgehen (Legacy `ROUTE_SETTLE_MS`). */
const ROUTE_SETTLE_MS = 700;
const transportOpen = ref(true);
const optionsOpen = ref(true);
const routeShown = computed(() => planner.route.value !== null);
const pointNames = computed(() => mapPointNames(planner.waypoints));
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/*
 * 🔴 Ein Wechsel der Reiseart klappt nichts auf und nichts zu (Betreiber 2026-09-27, WI-0050). Er ist eine
 * Einstellung IM Kasten wie jede Option - nur nimmt der Flug die Route weg, und zurück kommt sie neu. Ohne
 * Halt las die Regel oben das als „Reise weg“ (nach 700 ms ging „Reiseoptionen“ auf) und als „neue Reise“
 * (beide klappten zu, unter dem Zeiger). Gehalten wird, bis die Rechnung nach dem Wechsel steht.
 */
let modeHold = false;
function releaseModeHold(): void {
    if (planner.status.value !== "loading") modeHold = false;
}

watch(
    routeShown,
    (shown) => {
        clearTimeout(settleTimer);
        if (modeHold) return;
        if (shown) {
            transportOpen.value = false;
            optionsOpen.value = false;
            return;
        }
        settleTimer = setTimeout(() => {
            if (routeShown.value) return;
            transportOpen.value = true;
            optionsOpen.value = true;
        }, ROUTE_SETTLE_MS);
    },
    { immediate: true },
);
// Nach dem Beobachter oben: Steht die Route, sieht er sie noch unter dem Halt, erst dann wird er frei.
watch(() => planner.status.value, releaseModeHold);

// --- Transportmittel und Reiseoptionen ---

/** Die Erklärfenster hinter ⓘ „Transportmittel“ und ⓘ „Reiseoptionen“ (WI-0045). */
const transportInfoOpen = ref(false);
const transportInfoEingehaengt = einmalOffen(() => transportInfoOpen.value);
/** Mit welchem Reiter das ⓘ Transportmittel aufgeht: vom ⓘ die Tempotafel, aus der Steigungszeile „Gebirge“. */
const transportInfoStart = ref<"land" | "gebirge" | "flug">("land");
const optionsInfoOpen = ref(false);
const optionsInfoEingehaengt = einmalOffen(() => optionsInfoOpen.value);

// Berechnet, damit die Namen die Sprache wechseln.
const transportOptions = computed(
    () =>
        Object.fromEntries(
            DOMAINS.map((domain) => [
                domain,
                TRANSPORTS[domain].map((value) => ({
                    value,
                    label: transportLabel(value),
                    icon: TRANSPORT_ICONS[value],
                })),
            ]),
        ) as Record<Domain, { value: string; label: string; icon?: string }[]>,
);

function change(apply: (options: PlannerOptions) => void): void {
    planner.setOptions(apply);
}

/** Die Reiseart oben im Kasten (WI-0050): „Land & Wasser“ wie bisher, „Flug“ vorbereitet. */
const modeOptions = computed(() => [
    { value: "surface", label: t("planner.mode.surface"), hinweis: t("planner.mode.surface.title") },
    { value: "air", label: t("planner.mode.air"), hinweis: t("planner.mode.air.title") },
]);

function setMode(value: string): void {
    if ((value !== "surface" && value !== "air") || value === planner.mode.value) return;
    modeHold = true;
    planner.setMode(value);
    // Kommt keine Rechnung in Gang (weniger als zwei Orte), gibt der nächste Takt den Halt frei.
    void nextTick(releaseModeHold);
}

function selectAir(profile: AirChoiceId): void {
    planner.setAir((air) => {
        air.profile = profile;
    });
}

function setAirCustom(custom: AirCustom): void {
    planner.setAir((air) => {
        air.custom = custom;
    });
}

/** Die zugeklappte Leiste sagt, was gilt: die Medien samt Routenwahl, oder das Flugmittel mit seinen Werten. */
const transportSummaryParts = computed(() =>
    planner.mode.value === "air" ? airSummary(planner.air) : transportSummary(planner.options),
);

function setEnabled(domain: Domain, checked: boolean): void {
    change((options) => {
        options.enabled[domain] = checked;
    });
}

function setTransport(domain: Domain, value: string): void {
    if (planner.options.transports[domain] === value) return;
    change((options) => {
        options.transports[domain] = value;
    });
}

/** Schnellste oder kürzeste Route - auch für Pos1/Ende (Legacy A4). Gleiches wählt nicht neu. */
function setOptimize(optimize: PlannerOptions["optimize"]): void {
    if (planner.options.optimize === optimize) return;
    change((options) => {
        options.optimize = optimize;
    });
}

function setMinimizeTransfers(checked: boolean): void {
    change((options) => {
        options.minimizeTransfers = checked;
    });
}

/**
 * Eiltempo (WI-0078): keine dritte Routenwahl, sondern ein eigener Haken - die Route bleibt dieselbe, nur ihre
 * Zeit sinkt, wo Mittel und Abschnitt es zulassen. Er steht hinten (Betreiber 2026-10-05, F7 = B), und der ganze
 * Block hängt an `mode === "surface"`: 🪤 Im Flug verschwindet er ohne eigene Bedingung und ohne Erklärung.
 */
function setHurry(checked: boolean): void {
    change((options) => {
        options.hurry = checked;
    });
}

/** Unlesbares wird zur Vorgabe, alles andere auf halbe Stunden zwischen 0,5 und 24 (Legacy). */
function setHours(event: Event): void {
    const field = event.target as HTMLInputElement;
    const hours = clampHoursPerDay(Number(field.value.replace(",", ".")));
    field.value = hours.toFixed(1);
    if (hours === planner.options.hoursPerDay) return;
    change((options) => {
        options.hoursPerDay = hours;
    });
}

/** Die Unterbringung (WI-0042): vom Zelt bis zum Einzelzimmer; sie ändert nur die Kosten. */
const lodgingOptions = computed(() => LODGING_OPTIONS.map((level) => ({ value: level, label: lodgingLabel(level) })));

function setLodging(value: string): void {
    const level = LODGING_OPTIONS.find((option) => option === value);
    if (level) planner.setLodging(level);
}

/**
 * Die Reisekosten je Person, wie der Server sie mit der Route liefert (WI-0042, WI-0065): Der Browser wählt nur die
 * Unterbringung. Im Flug (WI-0051) trägt die Antwort keine (Plan 6.37: nichts erfinden), und eine Antwort ohne sie -
 * ein älterer Server - ergibt keinen Kasten statt falscher Zahlen. Während die Route neu gerechnet wird, steht der
 * Kasten bei der Route, die noch steht: Es sind ihre eigenen Zahlen, nicht die der neuen Optionen.
 */
const costs = computed(() => {
    const route = planner.route.value;
    return route ? costView(route, planner.options) : null;
});

/** Der Reisebeginn (WI-0038): „Unbekannt“, einer der zwölf Monate oder die Namenlosen Tage; der Tag bleibt, wenn der Monat wechselt (geklemmt auf dessen Länge). */
const monthOptions = computed(() => [
    // Im Feld nur „Unbekannt“: Die Zeile ist schmal (Betreiber 2026-09-26: „in eine zeile“), die Liste sagt den Rest.
    { value: "", label: t("planner.travelStart.none"), short: t("planner.travelStart.noneShort") },
    ...DEPARTURE_MONTHS.map((month) => ({ value: month, label: monthOption(month) })),
]);

function setStartMonth(value: string): void {
    const month = isDepartureMonth(value) ? value : null;
    if (month === (planner.options.departure?.month ?? null)) return;
    change((options) => {
        options.departure = month ? { month, day: clampStartDay(options.departure?.day ?? 1, month) } : null;
    });
}

/** Ganze Tage von 1 bis 30 (an den Namenlosen Tagen 1 bis 5); ohne Monat ist das Feld tot (Legacy: „ohne Monat ausgegraut“). */
function setStartDay(event: Event): void {
    const field = event.target as HTMLInputElement;
    const day = clampStartDay(Number(field.value), planner.options.departure?.month);
    field.value = String(day);
    if (!planner.options.departure || planner.options.departure.day === day) return;
    change((options) => {
        if (options.departure) options.departure.day = day;
    });
}

// --- Wegpunkte ---

const rows = new Map<number, InstanceType<typeof WaypointRow>>();
function rememberRow(key: number, row: unknown): void {
    if (row) rows.set(key, row as InstanceType<typeof WaypointRow>);
    else rows.delete(key);
}

/** „Ziel hinzufügen" und die Taste R: eine leere Zeile, fokussiert, auch aus dem zugeklappten Planer. */
async function addDestination(): Promise<void> {
    if (atLimit.value) {
        showToast(`${t("planner.waypointLimit", { n: waypointLimit })}.`, "warning");
        return;
    }
    const key = planner.addWaypoint();
    open.value = true;
    await nextTick();
    rows.get(key)?.focus();
}

async function nudge(index: number, step: 1 | -1): Promise<void> {
    const target = index + step;
    const row = planner.waypoints[index];
    if (!row || target < 0 || target >= planner.waypoints.length) return;
    planner.move(index, target);
    await nextTick();
    rows.get(row.key)?.focusGrip();
}

// --- Ziehen am Griff (Legacy B6: ab 4 px, Maus und Finger) ---

/*
 * 🔴 Echtes Ziehen (Betreiber 2026-09-24: „nicht wirklich drag n drop, sodass man es anfassen und
 * verschieben könnte“): Die Zeile hängt am Zeiger, die anderen rücken ihr animiert aus dem Weg, und
 * erst beim Loslassen ändert sich die Reihenfolge - und damit die Route. Gemessen wird einmal beim
 * Anfassen; während des Ziehens steht die Liste still, nur Verschiebungen laufen.
 */
const DRAG_THRESHOLD_PX = 4;
interface DragState {
    key: number;
    from: number;
    to: number;
    startY: number;
    dy: number;
    pointerId: number;
    active: boolean;
    /** Die Mitten der Zeilen beim Anfassen, in Fensterkoordinaten. */
    centers: number[];
    /** So weit rückt eine Zeile, an der die gezogene vorbeigeht: deren Höhe plus der Zeilenabstand. */
    step: number;
}
const drag = ref<DragState | null>(null);
const dropping = ref(false);
const list = ref<HTMLOListElement | null>(null);

/** Während des Ziehens bleibt die Reihenfolge, wie sie ist; die Zeilen verschieben sich nur. */
const shownRows = computed(() => planner.waypoints);

/** Wo eine Zeile gerade steht: die gezogene folgt dem Zeiger, die anderen machen Platz. */
function rowShift(index: number): Record<string, string> | undefined {
    const current = drag.value;
    if (!current?.active) return undefined;
    if (index === current.from) {
        return { transform: `translateY(${String(current.dy)}px)`, transition: "box-shadow 140ms ease" };
    }
    if (current.from < current.to && index > current.from && index <= current.to) {
        return { transform: `translateY(${String(-current.step)}px)` };
    }
    if (current.from > current.to && index >= current.to && index < current.from) {
        return { transform: `translateY(${String(current.step)}px)` };
    }
    return undefined;
}

function startDrag(key: number, event: PointerEvent): void {
    if (event.button !== 0) return;
    const from = planner.waypoints.findIndex((row) => row.key === key);
    const rows = [...(list.value?.children ?? [])] as HTMLElement[];
    const own = rows[from]?.getBoundingClientRect();
    if (from < 0 || planner.waypoints.length < 2 || !own) return;
    event.preventDefault();
    const next = rows[from + 1]?.getBoundingClientRect();
    const previous = rows[from - 1]?.getBoundingClientRect();
    const gap = next ? next.top - own.bottom : previous ? own.top - previous.bottom : 0;
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
    drag.value = {
        key,
        from,
        to: from,
        startY: event.clientY,
        dy: 0,
        pointerId: event.pointerId,
        active: false,
        centers: rows.map((row) => {
            const box = row.getBoundingClientRect();
            return box.top + box.height / 2;
        }),
        step: own.height + gap,
    };
    globalThis.addEventListener("pointermove", onDragMove);
    globalThis.addEventListener("pointerup", onDragEnd);
    globalThis.addEventListener("pointercancel", onDragCancel);
}

function onDragMove(event: PointerEvent): void {
    const current = drag.value;
    if (!current || event.pointerId !== current.pointerId) return;
    const raw = event.clientY - current.startY;
    if (!current.active && Math.abs(raw) < DRAG_THRESHOLD_PX) return;
    current.active = true;
    event.preventDefault();
    const first = current.centers[0] ?? 0;
    const last = current.centers[current.centers.length - 1] ?? 0;
    const home = current.centers[current.from] ?? 0;
    // Die Zeile bleibt in der Liste: höchstens bis zur ersten oder letzten Zeile.
    current.dy = Math.min(last - home, Math.max(first - home, raw));
    const center = home + current.dy;
    let to = current.from;
    current.centers.forEach((other, index) => {
        // Genau auf der Mitte zählt als vorbei - sonst erreichte man ganz oben und unten nie den Rand.
        if (index < current.from && center <= other) to = Math.min(to, index);
        if (index > current.from && center >= other) to = Math.max(to, index);
    });
    current.to = to;
}

function stopListening(): void {
    globalThis.removeEventListener("pointermove", onDragMove);
    globalThis.removeEventListener("pointerup", onDragEnd);
    globalThis.removeEventListener("pointercancel", onDragCancel);
}

/** Loslassen: erst jetzt ändert sich die Reihenfolge, ohne dass die Zeilen noch einmal gleiten. */
async function settle(move: () => void): Promise<void> {
    dropping.value = true;
    move();
    drag.value = null;
    await nextTick();
    requestAnimationFrame(() => {
        dropping.value = false;
    });
}

function onDragEnd(event: PointerEvent): void {
    const current = drag.value;
    if (!current || event.pointerId !== current.pointerId) return;
    stopListening();
    if (current.active && current.from !== current.to) {
        void settle(() => planner.move(current.from, current.to));
    } else {
        drag.value = null;
    }
}

function onDragCancel(): void {
    stopListening();
    drag.value = null;
}

// --- Ergebnis ---

/** Nur über gesperrte Wege: die Absage mit Gründen im Panel (WI-0038, Owner 14.09.2026). */
const refusal = computed(() => {
    const closed = planner.closed.value;
    return closed
        ? closureRefusal(
              closed,
              planner.filled.value.map((place) => place.name),
          )
        : null;
});

type ResultState = "hidden" | "loading" | "none" | "route";
const resultState = computed((): ResultState => {
    if (planner.route.value) return "route";
    if (planner.status.value === "loading" && planner.showLoading.value) return "loading";
    if (planner.status.value === "none") return "none";
    return "hidden";
});

onBeforeUnmount(() => {
    clearTimeout(settleTimer);
    stopListening();
});

defineExpose({ addDestination, setOptimize });
</script>

<template>
    <div class="route-planner" :class="{ 'is-open': open, 'is-phone': phone }" data-testid="route-planner">
        <!-- Deckt links die Karte: Die Kamera zielt in die freie Fläche daneben (WI-0039, map/camera/visible-area.ts). -->
        <div class="planner-stack" :inert="!open" data-map-overlay="left">
            <section
                id="route-planner-panel"
                class="planner"
                :class="{ 'planner--docked': showPlayer }"
                :aria-label="t('planner.toggle')"
            >
                <header class="planner__head">
                    <!-- Oben rechts im Kopf, wie Legacy: DE | EN und Hell/Dunkel (WI-0032). -->
                    <div class="planner__switches">
                        <LangToggle />
                        <ThemeToggle />
                    </div>
                    <h1 class="planner__brand">
                        <img
                            class="planner__wordmark"
                            :src="WORDMARK"
                            :alt="t('planner.wordmark.alt')"
                            width="700"
                            height="183"
                        />
                    </h1>
                    <p class="planner__tagline">{{ t("planner.tagline") }}</p>
                </header>
                <p v-if="reisePausiert" class="planner__pausiert" role="status" data-testid="planner-paused">
                    {{ pausiertSatz("route.compute") }}
                </p>

                <ol
                    ref="list"
                    class="planner__waypoints"
                    :class="{ 'is-dragging': drag?.active, 'is-dropping': dropping }"
                    :aria-label="t('planner.waypoints')"
                    data-testid="waypoints"
                >
                    <WaypointRow
                        v-for="(row, index) in shownRows"
                        :key="row.key"
                        :ref="(element) => rememberRow(row.key, element)"
                        :data-key="row.key"
                        :style="rowShift(index)"
                        :place="row.place"
                        :last="index === shownRows.length - 1"
                        :index="index"
                        :dragging="drag?.active === true && drag.key === row.key"
                        @select="planner.setPlace(row.key, $event)"
                        @remove="planner.removeWaypoint(row.key)"
                        @grab="startDrag(row.key, $event)"
                        @nudge="nudge(index, $event)"
                    />
                </ol>

                <!-- Im Raster der Wegpunktzeile: ⇅ unter der Marke, „Ziel hinzufügen" unter dem Feld, 🗑 unter dem ✕. -->
                <div class="planner__actions">
                    <button
                        type="button"
                        class="planner__tool planner__tool--reverse"
                        :title="t('planner.reverseRoute.title')"
                        :aria-label="t('planner.reverseRoute.title')"
                        :disabled="filledCount < 2"
                        data-testid="route-reverse"
                        @click="planner.reverse()"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        class="planner__add"
                        :title="
                            atLimit
                                ? t('planner.waypointLimit', { n: waypointLimit })
                                : t('planner.addDestination.title')
                        "
                        :aria-disabled="atLimit"
                        data-testid="route-add"
                        @click="addDestination()"
                    >
                        {{ t("planner.addDestination") }}
                    </button>
                    <button
                        type="button"
                        class="planner__tool"
                        :title="t('planner.clearRoute.title')"
                        :aria-label="t('planner.clearRoute.title')"
                        :disabled="filledCount < 1"
                        data-testid="route-clear"
                        @click="planner.clear()"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                        </svg>
                    </button>
                </div>

                <AvmDisclosure
                    v-model:open="transportOpen"
                    :label="t('planner.transport.heading')"
                    :secondary="transportSummaryParts"
                    summary-closed-only
                    summary-one-line
                    data-testid="planner-transport"
                    toggle-testid="transport-toggle"
                >
                    <template #info>
                        <InfoKnopf
                            :beschriftung="t('transportInfo.button')"
                            :hinweis="t('transportInfo.button.title')"
                            testid="transport-info-open"
                            @oeffnen="
                                transportInfoStart = planner.mode.value === 'air' ? 'flug' : 'land';
                                transportInfoOpen = true;
                            "
                        />
                    </template>
                    <!-- Oben die Reiseart (WI-0050): Land & Wasser wie bisher, oder genau ein Flugmittel. -->
                    <AvmSegmente
                        class="transport__mode"
                        :model-value="planner.mode.value"
                        :options="modeOptions"
                        :label="t('planner.mode.label')"
                        testid="travel-mode"
                        @update:model-value="setMode"
                    />
                    <div v-if="planner.mode.value === 'surface'" data-testid="transport-surface">
                        <div class="transport">
                            <template v-for="domain in DOMAINS" :key="domain">
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="planner.options.enabled[domain]"
                                    :hinweis="domainTitle(domain)"
                                    :testid="`allow-${domain}`"
                                    @change="setEnabled(domain, $event)"
                                >
                                    <img class="check__icon" :src="DOMAIN_ICONS[domain]" alt="" />
                                    <span>{{ domainLabel(domain) }}</span>
                                </AvmKaestchen>
                                <!-- Die Wahl bleibt bedienbar, auch wenn das Medium aus ist (Guide §17.11). -->
                                <TransportSelect
                                    :model-value="planner.options.transports[domain]"
                                    :options="transportOptions[domain]"
                                    :label="t('planner.transport.aria', { domain: domainLabel(domain) })"
                                    :testid="`transport-${domain}`"
                                    @update:model-value="setTransport(domain, $event)"
                                />
                            </template>
                        </div>
                        <!-- Was die Route WÄHLT, steht seit WI-0050 bei den Medien, unter einem Trenner (Betreiber 2026-09-27). -->
                        <hr class="options__divider" />
                        <div class="options__row">
                            <AvmKaestchen
                                art="radio"
                                name="route-planner-optimize"
                                :checked="planner.options.optimize === 'fastest'"
                                :hinweis="t('planner.route.fastest.title')"
                                testid="optimize-fastest"
                                @change="setOptimize('fastest')"
                            >
                                <span>{{ t("planner.route.fastest") }}</span>
                            </AvmKaestchen>
                            <AvmKaestchen
                                art="radio"
                                name="route-planner-optimize"
                                :checked="planner.options.optimize === 'shortest'"
                                :hinweis="t('planner.route.shortest.title')"
                                testid="optimize-shortest"
                                @change="setOptimize('shortest')"
                            >
                                <span>{{ t("planner.route.shortest") }}</span>
                            </AvmKaestchen>
                            <AvmKaestchen
                                art="checkbox"
                                :checked="planner.options.minimizeTransfers"
                                :hinweis="t('planner.minimizeTransfers.title')"
                                testid="minimize-transfers"
                                @change="setMinimizeTransfers"
                            >
                                <span>{{ t("planner.minimizeTransfers") }}</span>
                            </AvmKaestchen>
                            <AvmKaestchen
                                art="checkbox"
                                :checked="planner.options.hurry"
                                :hinweis="t('planner.hurry.title')"
                                testid="hurry"
                                @change="setHurry"
                            >
                                <span>{{ t("planner.hurry") }}</span>
                            </AvmKaestchen>
                        </div>
                    </div>
                    <AirTransport v-else :choice="planner.air" @select="selectAir" @custom="setAirCustom" />
                </AvmDisclosure>

                <AvmDisclosure
                    v-model:open="optionsOpen"
                    :label="t('planner.options.heading')"
                    :secondary="optionsSummary(planner.options)"
                    summary-closed-only
                    summary-one-line
                    data-testid="planner-options"
                    toggle-testid="options-toggle"
                >
                    <template #info>
                        <InfoKnopf
                            :beschriftung="t('planner.optionsInfo.buttonAria')"
                            :hinweis="t('planner.optionsInfo.buttonTitle')"
                            testid="options-info-open"
                            @oeffnen="optionsInfoOpen = true"
                        />
                    </template>
                    <!-- Nur noch, was die Route BEWERTET (Guide §17.6); was sie wählt, steht seit WI-0050 unter
                         „Transportmittel“. Feldzeilen untereinander: eine Beschriftungsspalte, jedes Feld an derselben Kante (Guide §8,
                         Betreiber 2026-09-26: „diese items untereinander machen“). -->
                    <div class="options__fields">
                        <label class="options__field" :title="t('planner.travelHours.title')">
                            <span>{{ t("planner.travelHoursLabel") }}</span>
                            <AvmFeld
                                class="options__number"
                                type="number"
                                min="0.5"
                                max="24"
                                step="0.5"
                                :value="planner.options.hoursPerDay.toFixed(1)"
                                data-testid="hours-per-day"
                                @change="setHours"
                            />
                        </label>
                        <!-- Reisebeginn: Tag und Monat; ohne Monat ist der Tag tot, der Satz im Monatsfeld sagt warum. -->
                        <div class="options__field options__field--line" :title="t('planner.travelStart.title')">
                            <label for="route-planner-start-day">{{ t("planner.travelStartLabel") }}</label>
                            <!-- Eine Zeile (Betreiber 2026-09-26): Wird es eng, gibt der Monat nach und kürzt seinen Text. -->
                            <span class="options__date">
                                <AvmFeld
                                    id="route-planner-start-day"
                                    class="options__number"
                                    type="number"
                                    min="1"
                                    :max="
                                        planner.options.departure ? departureDays(planner.options.departure.month) : 30
                                    "
                                    step="1"
                                    :value="planner.options.departure?.day ?? 1"
                                    :disabled="planner.options.departure === null"
                                    :aria-label="t('planner.travelStart.day')"
                                    data-testid="travel-start-day"
                                    @change="setStartDay"
                                />
                                <TransportSelect
                                    :model-value="planner.options.departure?.month ?? ''"
                                    :options="monthOptions"
                                    :label="t('planner.travelStart.month')"
                                    class="options__select"
                                    testid="travel-start-month"
                                    @update:model-value="setStartMonth"
                                />
                            </span>
                        </div>
                        <!-- Die Unterbringung setzt Bett, Verpflegung, Zollveranlagung und Kabine gemeinsam (Legacy-Owner 2026-08-03). -->
                        <div class="options__field options__field--line" :title="t('planner.lodging.title')">
                            <span>{{ t("planner.lodgingLabel") }}</span>
                            <TransportSelect
                                :model-value="planner.options.lodging"
                                :options="lodgingOptions"
                                :label="t('planner.lodging.label')"
                                class="options__select"
                                testid="travel-lodging"
                                @update:model-value="setLodging"
                            />
                        </div>
                    </div>
                </AvmDisclosure>

                <div
                    v-if="resultState !== 'hidden'"
                    class="result"
                    :class="{ 'result--route': resultState === 'route' }"
                    data-testid="route-result"
                >
                    <p v-if="resultState === 'loading'" class="result__note" role="status">
                        {{ t("planner.overview.calculating") }}
                    </p>
                    <!-- Gesperrt ist kein Leerzustand: Die Absage nennt, was zu ist und wann (Owner 14.09.2026). -->
                    <div v-else-if="resultState === 'none' && refusal" class="refusal" data-testid="route-refusal">
                        <p class="refusal__title" role="status">{{ refusal.title }}</p>
                        <ClosureNote>
                            <template v-for="(avoided, index) in refusal.avoided" :key="index"
                                >{{ index > 0 ? " " : "" }}{{ closureLead(avoided) }} {{ closureWayName(avoided) }} —
                                {{ closureReason(avoided) }}.</template
                            >
                        </ClosureNote>
                    </div>
                    <!-- Ein Leerzustand ist ein Satz, kein Warnschild (Guide §17.11). -->
                    <p v-else-if="resultState === 'none'" class="result__note" role="status">
                        {{ t("planner.overview.noRoute") }}
                    </p>
                    <template v-else-if="planner.route.value">
                        <p v-if="planner.showLoading.value" class="result__loading" role="status">
                            {{ t("planner.overview.calculating") }}
                        </p>
                        <RouteOverview
                            :route="planner.route.value"
                            :custom-air-name="selectedAir(planner.air).name"
                            :selected-stage="planner.selectedStage.value"
                            :stale="planner.stale.value"
                            :point-names="pointNames"
                            :options="planner.options"
                            :sharing="shareLink?.sharing.value ?? false"
                            :landscapes="landscapes"
                            :costs="costs"
                            :show-borders="planner.showBorders.value"
                            @show-borders="planner.setShowBorders($event)"
                            @show-border="emit('showBorder', $event)"
                            @show-territory="emit('showTerritory', $event)"
                            @select-stage="(index, zoom) => planner.selectStage(index, zoom)"
                            @fit-route="planner.fitWholeRoute()"
                            @show-subject="emit('showSubject', $event)"
                            @share="void shareLink?.share()"
                            @show-landscape="emit('showLandscape', $event)"
                            @slope-details="
                                transportInfoStart = 'gebirge';
                                transportInfoOpen = true;
                            "
                        />
                    </template>
                </div>
            </section>

            <RoutePlayer
                v-if="showPlayer && playmode"
                :playmode="playmode"
                :selected-stage="planner.selectedStage.value"
            />
        </div>

        <button
            type="button"
            class="route-planner__tab"
            :aria-expanded="open"
            aria-controls="route-planner-panel"
            :title="open ? t('planner.toggle.close') : t('planner.toggle.open')"
            data-testid="route-planner-tab"
            @click="open = !open"
        >
            {{ t("planner.toggle") }}
        </button>

        <!-- Die Fenster hängen sich selbst an `body` (Hülle, Guide §12.6) - hier stehen sie nur neben ihren Auslösern. -->
        <TransportInfoFenster
            v-if="transportInfoEingehaengt"
            v-model:offen="transportInfoOpen"
            :start-reiter="transportInfoStart"
        />
        <RouteOptionsInfoFenster v-if="optionsInfoEingehaengt" v-model:offen="optionsInfoOpen" />
    </div>
</template>

<style scoped>
/*
 * Der Planer und seine Lasche wandern GEMEINSAM: zugeklappt um genau die Panelbreite nach links.
 * `transform`, damit das Einfahren nach dem Laden dieselbe Bewegung ist wie das Auf- und Zuklappen.
 */
.route-planner {
    position: absolute;
    top: 0;
    left: 0;
    z-index: var(--z-map-panel);
    width: 0;
    height: 100%;
    transform: translateX(calc(-1 * var(--planner-w)));
    transition: transform 220ms ease;
    /* Am Rechner die Panelbreite; am Telefon bleibt rechts Platz für den Griff. */
    --planner-w: min(var(--avesmaps-planner-width), 100vw - var(--avesmaps-tab-w));
}

.route-planner.is-open {
    transform: none;
}

/* Zugeklappt verschwindet das Panel nach der Fahrt ganz - sonst ragte sein Schatten an den Rand. */
.route-planner:not(.is-open) .planner-stack {
    visibility: hidden;
    transition: visibility 0s linear 220ms;
}

.route-planner.is-phone {
    --planner-w: min(var(--avesmaps-planner-width), 100vw - var(--avesmaps-handle-w));
}

/*
 * Panel und Leiste stehen übereinander, oben und unten gleich weit vom Rand (Betreiber 2026-09-24:
 * „der abstand vom routenplaner oben zum bildschirmrand soll auch der abstand vom routenplaner
 * unten zum rand sein“). Wird es eng, rollt das Panel - die Leiste bleibt ganz.
 *
 * Beide sind EIN Panel: Die Leiste hängt ohne Abstand darunter, und Schatten und Rundung trägt der
 * Stapel, damit zwischen ihnen keine Schattennaht entsteht (Betreiber 2026-09-24: „kein abstand
 * zwischen routenplaner und playbar“).
 */
.planner-stack {
    position: absolute;
    top: var(--space-8);
    left: 0;
    display: flex;
    flex-direction: column;
    width: var(--planner-w);
    /* Endet über der Leiste der Reisebilder, wenn sie offen ist (WI-0272 S4). */
    max-height: calc(100% - 2 * var(--space-8) - var(--avm-reisebilder-leiste, 0px));
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    box-shadow: var(--shadow-panel);
}

.is-phone .planner-stack {
    top: 0;
    bottom: 0;
    max-height: none;
    border-radius: 0;
}

/* §17.1: Die Hülle - Fläche, nur die freie Kante gerundet; den Schatten trägt der Stapel. */
.planner {
    position: relative;
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    /*
     * Der Takt des Panels steht HIER und nur hier: zwischen Kopf, Wegpunkten, Knopf und Kästen.
     *
     * 🔴 **Ein Wert für die ganze Spalte** (Betreiber 2026-10-06, mit drei roten Pfeilen: „kannst du hier überall
     * dieselben abstände machen"). Gemessen am 2026-10-06 trug die Spalte zwei Werte: viermal die 8 px dieses `gap`
     * und einmal 12 px, weil die Reiseübersicht sich zusätzlich `margin-top: var(--space-2)` nahm. Genau die 12 hatte
     * er vorher als Maß genannt („soviel wie zwischen ‚Reiseoptionen' und ‚Reiseübersicht'"), also gilt sie jetzt
     * überall - als `--space-10`, eine vorhandene Sprosse, und der aufgesetzte Rand am Ergebnis fällt weg. Die Spalte
     * führt damit EINEN Abstand statt zweier.
     */
    gap: var(--space-10);
    min-height: 0;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
    padding: var(--space-8);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--color-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

/* Hängt die Leiste darunter, ist die untere freie Kante ihre. */
.planner--docked {
    border-bottom-right-radius: 0;
}

.is-phone .planner {
    flex: 1 1 auto;
    border-radius: 0;
}

/*
 * Die Leiste ist der Fuß des Panels: ohne eigenen Schatten, oben ein durchgehender Trenner bis an die
 * Kanten wie zwischen Kopf und Wegpunkten, unten rechts die Rundung des Panels.
 */
.planner-stack :deep(.player) {
    border-top: 1px solid var(--color-divider);
    border-radius: 0 0 var(--radius-sm) 0;
    box-shadow: none;
}

.is-phone .planner-stack :deep(.player) {
    border-radius: 0;
}

.planner__head {
    margin: 0;
    padding-top: var(--space-2);
}

/* Die Schalter der ganzen Seite, oben rechts im Kopf (Legacy: Themenknopf, links daneben DE|EN). */
.planner__switches {
    position: absolute;
    top: var(--space-8);
    right: var(--space-8);
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

/*
 * EIN durchgehender Trenner zwischen Kopf und erstem Wegpunkt, randlos bis an die Panelkanten (Legacy
 * `.project-summary::after`, Owner 12.08.2026). Als eigenes Element am Kopf, nicht als Rahmen: der
 * Kopf hat kein seitliches Polster, der Trenner zieht es selbst nach außen.
 */
.planner__head::after {
    display: block;
    margin: var(--space-10) calc(-1 * var(--space-8)) 0;
    border-bottom: 1px solid var(--color-divider);
    content: "";
}

.planner__brand {
    margin: 0;
    line-height: 0;
}

/*
 * 💣 **95 % der Panelbreite, nicht der Innenbreite** (Betreiber 2026-10-10: der Routenplaner „zeig zappelnd den scrollbalken“).
 * Mit `width: 95%` hing die Höhe der Wortmarke am Rollbalken: Ohne Balken war der Kopf 3,8 px höher, der Inhalt lief über und
 * holte den Balken; mit Balken (15 px schmaler) schrumpfte die Marke, der Inhalt passte und der Balken ging - eine Rückkopplung,
 * deren Zustand die letzte Neuberechnung bestimmte (Zuklappen, Hover). Gerechnet aus `--planner-w` ist die Marke mit und ohne
 * Balken gleich groß; 95 % der Innenbreite ohne Balken passen auch in die Innenbreite mit Balken (Wächter A10 in
 * `planer-feinschliff.spec.ts`).
 */
.planner__wordmark {
    display: block;
    width: calc(0.95 * (var(--planner-w) - 2 * var(--space-8)));
    max-width: 100%;
    height: auto;
    margin: 0 auto;
}

/*
 * Die Tagline unter dem Logo: eine Zeile, über die volle Panelbreite, gedämpft (Legacy). Wo die Breite nicht reicht (320 px:
 * Panel 294 px, der Satz braucht 333), bricht sie aus - statt über den Rand zu laufen und abgeschnitten zu werden; das Panel
 * hatte dort einen Überlauf nach rechts (Betreiber 2026-10-04, Wächter `route-planner-scroll*.spec.ts`).
 */
/* Ein Satz, kein Warnschild (Guide §17.11): die Reiseberechnung ist pausiert, der Planer sagt es, bevor man rechnet. */
.planner__pausiert {
    margin: var(--space-8) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    text-align: center;
    text-wrap: balance;
}

.planner__tagline {
    margin: var(--space-4) calc(-1 * var(--space-8)) 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    text-align: center;
    text-wrap: balance;
}

.planner__waypoints {
    --waypoint-gap: var(--space-6);
    display: grid;
    gap: var(--waypoint-gap);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Beim Ziehen wird nichts markiert, und der Zeiger bleibt die geschlossene Hand. */
.planner__waypoints.is-dragging {
    cursor: grabbing;
    user-select: none;
}

/* Beim Absetzen springt die Liste in ihre neue Ordnung, ohne dass die Zeilen ein zweites Mal gleiten. */
.planner__waypoints.is-dropping :deep(.waypoint) {
    transition: none;
}

.planner__actions {
    display: grid;
    grid-template-columns: var(--icon-lg) var(--icon-lg) minmax(0, 1fr) var(--icon-lg);
    align-items: center;
    gap: var(--space-2);
}

/* ⇅ und 🗑: Zeilenwerkzeuge wie Griff und ✕ - randlos, gedämpft, Hellung beim Überfahren (Legacy). */
.planner__tool {
    display: inline-grid;
    place-items: center;
    width: var(--icon-lg);
    height: var(--icon-lg);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.planner__tool--reverse {
    grid-column: 2;
}

.planner__tool svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.planner__tool:not(:disabled):hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.planner__tool:not(:disabled):active {
    background: var(--color-active-wash);
}

.planner__tool:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Gesperrt heißt: die Farbe tritt zurück - der Knopf verspricht keine Wirkung, die er nicht hat. */
.planner__tool:disabled {
    color: var(--color-disabled-text);
    cursor: default;
}

/* Der eine gefüllte Knopf der Fläche (§17.4), das Plus davor gezeichnet statt geschrieben. */
.planner__add {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: var(--avm-control-h);
    padding: var(--space-2) var(--space-10) var(--space-2) 30px;
    border: 1px solid var(--color-button-border);
    border-radius: var(--radius-md);
    background: var(--color-button);
    color: var(--color-button-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease,
        transform 120ms ease;
}

.planner__add::before,
.planner__add::after {
    position: absolute;
    top: 50%;
    left: 17px;
    border-radius: 2px;
    background: currentcolor;
    content: "";
    transform: translate(-50%, -50%);
}

.planner__add::before {
    width: 12px;
    height: 2.5px;
}

.planner__add::after {
    width: 2.5px;
    height: 12px;
}

.planner__add:hover,
.planner__add:focus-visible {
    outline: none;
    background: var(--color-button-hover);
    box-shadow: var(--shadow-button-hover-strong);
    transform: translateY(-1px);
}

.planner__add:focus-visible {
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-button-hover-strong);
}

.planner__add:active {
    background: var(--color-button-active);
    box-shadow: none;
    transform: none;
}

.planner__add[aria-disabled="true"] {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    box-shadow: none;
    color: var(--color-disabled-text);
    cursor: default;
    transform: none;
}

/* Die Reiseart steht über allem, was sie umschaltet. */
.transport__mode {
    margin-bottom: var(--space-6);
}

/* Transportmittel: Kästchen mit Bild und Wort, daneben das Auswahlfeld (§17.6). */
.transport {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4) var(--space-6);
}

/* Kästchen und Auswahlknopf sind DASSELBE Bauteil in zwei Radien: `controls/avm-kaestchen.vue` (§17.7). */
.check__icon {
    width: var(--icon-lg);
    height: var(--icon-lg);
    object-fit: contain;
}

.options__row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-10);
}

.options__divider {
    margin: var(--space-4) 0;
    border: 0;
    border-top: 1px solid var(--color-divider);
}

.options__field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

/* Das Feld selbst ist `AvmFeld` (Kante, Zustände, iOS-Schwelle); hier steht nur seine Breite. */
.options__number {
    width: 56px;
}

/* Am Finger trägt das Feld 16 px Schrift (AvmFeld) und braucht dafür mehr Breite. */
@media (pointer: coarse) {
    .options__number {
        width: 64px;
    }
}

.options__date {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

/* Die freie Breite der Zeile. Reicht sie nicht, kürzt das Feld seinen Text mit „…“; die Liste und die
   Beschriftung für Vorleser nennen ihn ganz. */
.options__select {
    flex: 1 1 0;
    min-width: 0;
}

/* Beschriftung und Auswahl in EINER Zeile (Betreiber 2026-09-26): Reisebeginn und Unterbringung. */
.options__field--line {
    display: flex;
    margin-top: var(--space-4);
}

/*
 * Die Feldzeilen als Tabelle (Guide §8: „Beschriftung steht nie über dem Wert“): Die Beschriftungsspalte
 * ist so breit wie die längste Beschriftung, damit keine umbricht; jedes Feld beginnt an derselben Kante.
 * Die Zeilen selbst lösen sich auf (`contents`), ihre Beschriftung und ihr Feld werden Zellen - das
 * `<label>` der Reisestunden bleibt dabei ein Label, ein Klick auf den Text setzt den Fokus ins Feld.
 */
.options__fields {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
}

.options__fields > .options__field {
    display: contents;
}

.options__fields .options__number {
    justify-self: start;
}

.options__field--line > :first-child {
    flex: 0 0 auto;
    white-space: nowrap;
}

/*
 * §17.8/§17.11: Das Ergebnis und die Leermeldung stehen im selben Kasten.
 *
 * 🪤 Kein eigener oberer Rand mehr: Er war der einzige Ausreißer in einer Spalte, die sonst durchgehend ihren `gap`
 * trägt (gemessen 2026-10-06: viermal 8 px, hier 12). Seit der Takt der Spalte 12 px ist, steht die Übersicht ohne
 * Zutun an derselben Stelle wie vorher - und alle fünf Abstände sind gleich.
 */
.result {
    flex: 0 0 auto;
    padding: var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    box-sizing: border-box;
}

/*
 * Am Zeiger rollt nur die Übersicht, die Eingaben oben stehen fest (Legacy 12.08.2026).
 *
 * 💣 **Der Platz für den Rollbalken steht IMMER bereit** (`scrollbar-gutter: stable`, wie im Infopanel): Der Kopf der
 * Reiseübersicht - Titel und 🔗 - liegt IN diesem Rollbereich. Ohne reservierte Rinne nahm der Balken beim Aufklappen
 * der Etappen 15 px Breite weg, der rechtsbündige 🔗 rutschte mit und der Titel brach um (Betreiber 2026-10-06: „was
 * stört ist dass beim aufklappen der etappen ein scrollbalken erscheint, der den rechtsbündigen link-button und dann
 * den text mit dem titel der reiseroute verschiebt. kann man den stabil halten / etwas nach links verschieben?“).
 * Gemessen am 2026-10-06 (Chromium ohne `--hide-scrollbars`, Fenster 1280 × 1100, Gareth → Greifenfurt): Etappen zu
 * Rinne 0 px und 🔗 bei x = 327, Etappen auf Rinne 15 px und 🔗 bei x = 312; mit stabiler Rinne beide Zustände 15 px
 * und x = 312. Der Preis ist seine zweite Hälfte („etwas nach links“): Der Inhalt ist auch ohne Balken 15 px schmaler.
 *
 * 🪤 Wo der Balken überlagert (Mac, Telefon, und in Playwright durch `--hide-scrollbars`), reserviert die Regel nichts
 * und ändert nichts. Ein Abnahmefall MUSS den Schalter darum ablegen, sonst ist er vor und nach der Behebung grün.
 */
.route-planner:not(.is-phone) .result--route {
    flex: 1 1 auto;
    min-height: 120px;
    overflow-y: auto;
    scrollbar-gutter: stable;
}

.result__note {
    margin: 0;
    font-size: var(--font-size-reading);
}

.refusal {
    font-size: 12px;
    line-height: 1.4;
}

.refusal__title {
    margin: 0 0 var(--space-4);
    font-weight: var(--font-weight-bold);
}

.result__loading {
    margin: 0 0 var(--space-4);
    color: var(--color-text-muted);
}

/* §17.2: Die Lasche - der einzige dauerhaft dunkle Fleck, damit man sie auf heller Karte findet. */
.route-planner__tab {
    position: absolute;
    top: var(--avesmaps-tab-top);
    left: var(--planner-w);
    width: var(--avesmaps-tab-w);
    height: var(--avesmaps-tab-h);
    padding: 0;
    border: 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--color-button);
    box-shadow: var(--shadow-panel);
    color: var(--color-button-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    text-align: center;
    text-orientation: mixed;
    writing-mode: vertical-rl;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.route-planner__tab:hover {
    background: var(--color-button-hover);
}

.route-planner__tab:active {
    background: var(--color-button-active);
}

.route-planner__tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-panel);
}

/*
 * Am Telefon ein Pfeilgriff mittig an der Kante (Legacy 12.08.2026). Das Wort bleibt im Knopf und
 * wird nur unsichtbar: es ist sein Name für Vorleser.
 */
.is-phone .route-planner__tab {
    top: 50%;
    width: var(--avesmaps-handle-w);
    height: var(--avesmaps-handle-h);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    font-size: 0;
    transform: translateY(-50%);
    writing-mode: horizontal-tb;
}

.is-phone .route-planner__tab::before {
    display: block;
    font-size: 30px;
    line-height: 1;
    content: "\203A";
    /* Die Tinte des Zeichens sitzt in ihrer Box zu tief (Legacy, gemessen). */
    transform: translateY(-0.1em);
}

.is-phone.is-open .route-planner__tab::before {
    content: "\2039";
}

@media (prefers-reduced-motion: reduce) {
    .route-planner,
    .planner__tool,
    .planner__add,
    .route-planner__tab {
        transition: none;
    }
}
</style>
