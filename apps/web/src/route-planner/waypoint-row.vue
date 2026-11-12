<script setup lang="ts">
import { onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { foldName, type WaypointHit } from "@avesmaps3d/shared";
import WaypointMark from "./waypoint-mark.vue";
import { MARK_SIZE } from "./waypoint-mark-shape";
import { useAnchoredPopup } from "./anchored-popup";
import { waypointLabel } from "./planner-model";
import { fetchWaypointHits } from "./route-client";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";

/**
 * Eine Wegpunktzeile (Design Guide §17.4, §17.5): Griff ⠿ · Rollenmarke · Ortsfeld · ✕.
 *
 * - **Die Marke kodiert die Rolle, nicht die Position:** rot heißt Wegpunkt; die letzte Zeile trägt
 *   den Tropfen. Eine gepunktete Senkrechte liest die Zeilen als Folge.
 * - **Die Vorschlagsliste überlagert, sie verschiebt nicht,** ist breiter als das Feld und hat KEINE
 *   Vorauswahl. Enter nimmt den markierten Vorschlag, sonst den Ort, der genau so heißt (Legacy);
 *   gibt es keinen, sagt es der Toast, und das Feld trägt 3 s einen roten Rahmen.
 * - **Der Griff zieht,** mit Maus und Finger; mit ↑/↓ verschiebt er die Zeile auch per Tastatur -
 *   Legacy konnte das nicht (Systemtest B14).
 */
const props = defineProps<{
    place: WaypointHit | null;
    last: boolean;
    index: number;
    dragging: boolean;
}>();
const emit = defineEmits<{
    select: [place: WaypointHit | null];
    remove: [];
    grab: [event: PointerEvent];
    nudge: [step: 1 | -1];
}>();

const text = ref(props.place ? waypointLabel(props.place) : "");
const hits = ref<WaypointHit[]>([]);
const open = ref(false);
const active = ref(-1);
const invalid = ref(false);
const input = useTemplateRef<HTMLInputElement>("input");
const hitsPosition = useAnchoredPopup(input, open);
const grip = useTemplateRef<HTMLButtonElement>("grip");
const listId = `waypoint-hits-${String(Math.random()).slice(2, 8)}`;

let pending: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let invalidTimer: ReturnType<typeof setTimeout> | undefined;
/** Legacys Takt: 120 ms Ruhe, dann fragen (jQuery-UI-Autocomplete `delay`). */
const DEBOUNCE_MS = 120;

watch(
    () => props.place,
    (place) => {
        text.value = place ? waypointLabel(place) : "";
    },
);

function onInput(): void {
    invalid.value = false;
    clearTimeout(timer);
    timer = setTimeout(() => void lookup(text.value), DEBOUNCE_MS);
}

async function lookup(query: string): Promise<void> {
    pending?.abort();
    const current = new AbortController();
    pending = current;
    try {
        const response = await fetchWaypointHits(query, current.signal);
        if (current.signal.aborted) return;
        hits.value = response.hits;
        active.value = -1;
        open.value = response.hits.length > 0 && document.activeElement === input.value;
    } catch {
        if (!current.signal.aborted) close();
    }
}

function close(): void {
    open.value = false;
    active.value = -1;
}

function choose(place: WaypointHit): void {
    close();
    text.value = waypointLabel(place);
    emit("select", place);
}

function reject(): void {
    invalid.value = true;
    clearTimeout(invalidTimer);
    invalidTimer = setTimeout(() => (invalid.value = false), 3000);
    showToast(t("route.placesNotFound", { names: text.value.trim() }), "warning");
}

function confirm(): void {
    const chosen = hits.value[active.value];
    if (chosen) return choose(chosen);
    const typed = text.value.trim();
    if (typed === "") {
        close();
        if (props.place) emit("select", null);
        return;
    }
    const exact = hits.value.filter((hit) => foldName(hit.name) === foldName(typed.replace(/ \(verborgen\)$/, "")));
    if (exact.length === 1 && exact[0]) return choose(exact[0]);
    if (props.place && typed === waypointLabel(props.place)) return close();
    reject();
}

function onKey(event: KeyboardEvent): void {
    const count = hits.value.length;
    if (event.key === "ArrowDown" && open.value && count > 0) {
        active.value = (active.value + 1) % count;
    } else if (event.key === "ArrowUp" && open.value && count > 0) {
        active.value = active.value <= 0 ? count - 1 : active.value - 1;
    } else if (event.key === "Enter") {
        confirm();
    } else if (event.key === "Escape" && open.value) {
        close();
    } else {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
}

/** Beim Verlassen: Unbestätigtes fällt auf den gewählten Ort zurück, ein geleertes Feld gibt ihn frei. */
function onBlur(): void {
    // Ein Klick in die Liste kommt nach dem Blur an - kurz warten, sonst wäre sie schon weg.
    setTimeout(() => {
        close();
        if (text.value.trim() === "" && props.place) emit("select", null);
        else if (props.place) text.value = waypointLabel(props.place);
    }, 120);
}

function onGripKey(event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    // Die Pfeile gehören hier der Zeile, nicht der Karte.
    event.stopPropagation();
    emit("nudge", event.key === "ArrowUp" ? -1 : 1);
}

function focus(): void {
    input.value?.focus();
}

/** Nach dem Verschieben per Tastatur bleibt der Fokus am Griff der Zeile, die gewandert ist. */
function focusGrip(): void {
    grip.value?.focus();
}

defineExpose({ focus, focusGrip });

onBeforeUnmount(() => {
    pending?.abort();
    clearTimeout(timer);
    clearTimeout(invalidTimer);
});
</script>

<template>
    <li class="waypoint" :class="{ 'waypoint--last': last, 'waypoint--dragging': dragging }" data-testid="waypoint-row">
        <button
            ref="grip"
            type="button"
            class="waypoint__grip"
            :aria-label="t('planner.waypoint.grip', { n: index + 1 })"
            :title="t('planner.waypoint.grip.title')"
            @pointerdown="emit('grab', $event)"
            @keydown="onGripKey"
        >
            ⠿
        </button>
        <!--
            🪤 Die gepunktete Senkrechte setzt an der UNTERKANTE des Rings an, also an seiner halben Höhe unter der
            Zeilenmitte. Hier standen dafür zwei feste Zahlen (9 px und 18 px), die still an der Vorgabe 18 der Marke
            hingen - dieselbe stumme Kopplung, die in der Etappenliste zu zwei Größen geführt hat (WI-0097). Jetzt
            nennt die Zeile die Höhe EINMAL, und das Stylesheet rechnet damit.
        -->
        <span class="waypoint__marker" :style="{ '--waypoint-mark-h': `${String(MARK_SIZE)}px` }" aria-hidden="true">
            <WaypointMark :rolle="last ? 'ziel' : 'wegpunkt'" />
        </span>
        <div class="waypoint__field">
            <input
                ref="input"
                v-model="text"
                class="waypoint__input"
                :class="{ 'is-invalid': invalid }"
                type="search"
                :placeholder="t('planner.waypoint.placeholder')"
                autocomplete="off"
                spellcheck="false"
                role="combobox"
                :aria-expanded="open"
                :aria-controls="listId"
                aria-autocomplete="list"
                :aria-activedescendant="active >= 0 ? `${listId}-${String(active)}` : undefined"
                :aria-label="t('planner.waypoint.field', { n: index + 1 })"
                data-testid="waypoint-input"
                @input="onInput"
                @keydown="onKey"
                @blur="onBlur"
            />
            <!-- Die Liste lebt am body, nicht im rollenden Panel: Sie ragt über den Planer hinaus (Betreiber 2026-09-24). -->
            <Teleport to="body">
                <ul
                    v-if="open"
                    :id="listId"
                    class="waypoint__hits"
                    role="listbox"
                    :style="hitsPosition"
                    data-testid="waypoint-hits"
                >
                    <li
                        v-for="(hit, hitIndex) in hits"
                        :id="`${listId}-${String(hitIndex)}`"
                        :key="hit.id"
                        class="waypoint__hit"
                        :class="{ 'is-active': hitIndex === active }"
                        role="option"
                        :aria-selected="hitIndex === active"
                        @pointerenter="active = hitIndex"
                        @mousedown.prevent="choose(hit)"
                    >
                        {{ waypointLabel(hit) }}
                    </li>
                </ul>
            </Teleport>
        </div>
        <button
            type="button"
            class="waypoint__remove"
            :aria-label="t('planner.waypoint.remove', { n: index + 1 })"
            :title="t('planner.waypoint.remove.title')"
            @click="emit('remove')"
        >
            ✕
        </button>
    </li>
</template>

<style scoped>
.waypoint {
    position: relative;
    display: grid;
    grid-template-columns: var(--icon-lg) var(--icon-lg) minmax(0, 1fr) var(--icon-lg);
    align-items: center;
    gap: var(--space-2);
    transition:
        box-shadow 140ms ease,
        transform 140ms ease;
}

/* Gezogen hebt sich die Zeile ab (Legacy `.is-dragging`) - Deckkraft hieße „gesperrt“ (§30.2). */
.waypoint--dragging {
    z-index: 1;
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-drag-lift);
    transform: scale(1.005);
}

.waypoint__grip,
.waypoint__remove {
    display: grid;
    place-items: center;
    width: var(--icon-lg);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    font: inherit;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.waypoint__grip {
    height: var(--avm-control-h);
    cursor: grab;
    font-size: 17px;
    font-weight: var(--font-weight-bold);
    touch-action: none;
}

.waypoint__remove {
    height: var(--icon-lg);
    cursor: pointer;
    font-size: var(--font-size-body);
}

.waypoint__grip:hover,
.waypoint__remove:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.waypoint__grip:active {
    cursor: grabbing;
    background: var(--color-active-wash);
}

.waypoint__grip:focus-visible,
.waypoint__remove:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.waypoint__marker {
    position: relative;
    display: grid;
    place-items: center;
    height: var(--avm-control-h);
}

/* Die gepunktete Senkrechte: vom Marker bis zum nächsten, nur zwischen Zeilen (§17.4). */
.waypoint:not(.waypoint--last) .waypoint__marker::after {
    position: absolute;
    top: calc(50% + var(--waypoint-mark-h) / 2);
    left: 50%;
    /* Bis zur nächsten Marke: über den Zeilenabstand der Liste hinweg. */
    height: calc(100% - var(--waypoint-mark-h) + var(--waypoint-gap, var(--space-2)));
    border-left: 2px dotted var(--color-text-muted);
    content: "";
    transform: translateX(-1px);
}

.waypoint__field {
    position: relative;
    min-width: 0;
}

.waypoint__input {
    width: 100%;
    height: var(--avm-control-h);
    box-sizing: border-box;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-field-float);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-body);
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.waypoint__input::placeholder {
    color: var(--color-placeholder);
}

.waypoint__input:hover {
    border-color: var(--color-border-strong);
}

/* Fokus: goldbrauner, kräftigerer Rahmen und der Ring - kein blauer Systemring (§17.5). */
.waypoint__input:focus {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-field-float);
}

.waypoint__input.is-invalid {
    border-color: var(--color-danger);
}

/* Die Liste überlagert und ist breiter als das Feld (§17.5). Lage und Grenzen setzt `useAnchoredPopup`. */
.waypoint__hits {
    position: fixed;
    z-index: var(--z-autocomplete);
    width: max-content;
    box-sizing: border-box;
    overflow-y: auto;
    margin: 0;
    padding: var(--space-2) 0;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    scrollbar-width: thin;
}

.waypoint__hit {
    padding: var(--space-2) var(--space-8);
    cursor: pointer;
    font-size: var(--font-size-reading);
    line-height: var(--leading-snug);
    transition: background-color 120ms ease;
}

.waypoint__hit.is-active {
    background: var(--color-hover-wash);
}

@media (pointer: coarse) {
    /* iOS vergrößert Felder unter 16 px beim Antippen - Legacys Schwelle. */
    .waypoint__input {
        font-size: 16px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .waypoint,
    .waypoint__grip,
    .waypoint__remove,
    .waypoint__input,
    .waypoint__hit {
        transition: none;
    }
}
</style>
