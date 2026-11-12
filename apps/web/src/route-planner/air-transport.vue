<script setup lang="ts">
import { computed } from "vue";
import AvmFeld from "../controls/avm-feld.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import {
    AIR_ALTITUDE_LIMITS,
    AIR_GROUPS,
    AIR_NAME_MAX,
    AIR_SPEED_LIMITS,
    airGroupLabel,
    airProfileLabel,
    airProfilesOf,
    airValues,
    clampAirValue,
    CUSTOM_AIR,
    type AirChoice,
    type AirChoiceId,
    type AirCustom,
} from "./air-profiles";
import { t } from "../i18n/i18n";

/**
 * Die Flugmittel im Rahmenkasten „Transportmittel“, Reiseart „Flug“ (WI-0050, Zielbild des Betreibers
 * vom 2026-09-27): genau eines aus vier Gruppen, je mit Bild, Name, Reisegeschwindigkeit und
 * Standardflughöhe; zuletzt „Eigenes Flugmittel“ mit Name, Meilen/h und Schritt direkt darunter - ohne
 * Fenster.
 *
 * - Eine Auswahlgruppe aus goldenen Auswahlknöpfen (`AvmKaestchen`, §17.7): Tab führt zum gewählten
 *   Flugmittel, ↑/↓ wählen der Reihe nach, über die Gruppen hinweg bis zum eigenen.
 * - Die Zeile ist eine Liste nach Guide §11: Polster 4/6, Hover-Lasur, gewählt `panel-active`.
 * - Wird es eng, rücken die Werte unter den Namen, statt die Zeile zu sprengen.
 * - Vorbereitet: Der Planer rechnet im Flug nicht (`use-planner.ts`); die Übersicht sagt es in einem Satz.
 *   Einen Vermerk über der Liste gibt es nicht (Betreiber 2026-09-27: „weg“).
 */
const props = defineProps<{ choice: AirChoice }>();
const emit = defineEmits<{
    select: [profile: AirChoiceId];
    custom: [custom: AirCustom];
}>();

const customChosen = computed(() => props.choice.profile === CUSTOM_AIR);

/** Der Name gilt beim Tippen; leer heißt das Flugmittel „Eigenes Flugmittel“. */
function setName(event: Event): void {
    const name = (event.target as HTMLInputElement).value.slice(0, AIR_NAME_MAX);
    emit("custom", { ...props.choice.custom, name });
}

/** Zahlen in ihren Grenzen und Stellen, beim Verlassen des Feldes; Unlesbares behält den bisherigen Wert. */
function setNumber(field: "speedMph" | "altitudePaces", event: Event): void {
    const input = event.target as HTMLInputElement;
    const limits = field === "speedMph" ? AIR_SPEED_LIMITS : AIR_ALTITUDE_LIMITS;
    const value = clampAirValue(Number(input.value.replace(",", ".")), limits, props.choice.custom[field]);
    input.value = String(value);
    if (value !== props.choice.custom[field]) emit("custom", { ...props.choice.custom, [field]: value });
}
</script>

<template>
    <div class="air" data-testid="air-transport">
        <div class="air__list" role="radiogroup" :aria-label="t('planner.air.list')">
            <div
                v-for="group in AIR_GROUPS"
                :key="group"
                class="air__group"
                role="group"
                :aria-labelledby="`route-planner-air-${group}`"
            >
                <p :id="`route-planner-air-${group}`" class="air__group-title">{{ airGroupLabel(group) }}</p>
                <AvmKaestchen
                    v-for="profile in airProfilesOf(group)"
                    :key="profile.id"
                    art="radio"
                    name="route-planner-air"
                    class="air__option"
                    :class="{ 'is-selected': choice.profile === profile.id }"
                    :checked="choice.profile === profile.id"
                    :testid="`air-${profile.id}`"
                    @change="emit('select', profile.id)"
                >
                    <img class="air__icon" :src="profile.icon" alt="" />
                    <span class="air__text">
                        <span class="air__name">{{ airProfileLabel(profile.id) }}</span>
                        <span class="air__values" :title="t('planner.air.values.title')">
                            {{ airValues(profile.speedMph, profile.altitudePaces) }}
                        </span>
                    </span>
                </AvmKaestchen>
            </div>
            <hr class="air__divider" />
            <AvmKaestchen
                art="radio"
                name="route-planner-air"
                class="air__option"
                :class="{ 'is-selected': customChosen }"
                :checked="customChosen"
                testid="air-custom"
                @change="emit('select', CUSTOM_AIR)"
            >
                <!-- Kein Bild für das eigene: ein gezeichnetes Plus wie in „Ziel hinzufügen“. -->
                <span class="air__icon air__icon--custom" aria-hidden="true"></span>
                <span class="air__text">
                    <span class="air__name">{{ t("planner.air.custom") }}</span>
                    <span class="air__values" :title="t('planner.air.values.title')">
                        {{ airValues(choice.custom.speedMph, choice.custom.altitudePaces) }}
                    </span>
                </span>
            </AvmKaestchen>
        </div>

        <!-- Inline, kein Fenster (Betreiber 2026-09-27). Feldzeilen als Tabelle, Guide §8. -->
        <div v-if="customChosen" class="air__custom" data-testid="air-custom-fields">
            <label for="route-planner-air-name">{{ t("planner.air.custom.name") }}</label>
            <AvmFeld
                id="route-planner-air-name"
                class="air__name-field"
                type="text"
                autocomplete="off"
                :maxlength="AIR_NAME_MAX"
                :placeholder="t('planner.air.custom.namePlaceholder')"
                :value="choice.custom.name"
                data-testid="air-custom-name"
                @input="setName"
            />
            <label for="route-planner-air-speed">{{ t("planner.air.custom.speed") }}</label>
            <span class="air__unit">
                <AvmFeld
                    id="route-planner-air-speed"
                    class="air__number"
                    type="number"
                    inputmode="decimal"
                    step="0.1"
                    :min="AIR_SPEED_LIMITS.min"
                    :max="AIR_SPEED_LIMITS.max"
                    :value="choice.custom.speedMph"
                    data-testid="air-custom-speed"
                    @change="setNumber('speedMph', $event)"
                />
                <span>{{ t("planner.air.custom.speedUnit") }}</span>
            </span>
            <label for="route-planner-air-altitude">{{ t("planner.air.custom.altitude") }}</label>
            <span class="air__unit">
                <AvmFeld
                    id="route-planner-air-altitude"
                    class="air__number"
                    type="number"
                    inputmode="numeric"
                    step="1"
                    :min="AIR_ALTITUDE_LIMITS.min"
                    :max="AIR_ALTITUDE_LIMITS.max"
                    :value="choice.custom.altitudePaces"
                    data-testid="air-custom-altitude"
                    @change="setNumber('altitudePaces', $event)"
                />
                <span>{{ t("planner.air.custom.altitudeUnit") }}</span>
            </span>
        </div>
    </div>
</template>

<style scoped>
.air {
    display: grid;
    gap: var(--space-4);
}

.air__list {
    display: grid;
    gap: var(--space-4);
}

.air__group {
    display: grid;
}

/* Abschnittsüberschrift einer Liste (Guide §10): gedämpft, klein, in Versalien - nicht gold, sie ist kein Knopf. */
.air__group-title {
    margin: 0 0 var(--space-2) var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: 0.03em;
    text-transform: uppercase;
}

/* 🪤 Zwei Klassen: Das Kästchen setzt `inline-flex` mit gleicher Spezifität, die Reihenfolge der Stile ist offen. */
.air .air__option {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.air .air__option:hover {
    background: var(--color-hover-wash);
}

.air .air__option.is-selected {
    border-color: var(--color-border-strong);
    background: var(--color-panel-active);
}

/* Der Fokus sitzt am Auswahlknopf; die Zeile zieht ihre Kante nach, damit man ihn in der Liste findet. */
.air .air__option:has(:focus-visible) {
    border-color: var(--color-accent-strong);
}

/* Inhaltsbilder werden nie umgefärbt und nie gedimmt (§30.2). */
.air__icon {
    flex: 0 0 auto;
    width: var(--icon-lg);
    height: var(--icon-lg);
    object-fit: contain;
}

/* Das Plus des eigenen Flugmittels: zwei Balken wie in „Ziel hinzufügen“, gedämpft. */
.air__icon--custom {
    position: relative;
    color: var(--color-text-muted);
}

.air__icon--custom::before,
.air__icon--custom::after {
    position: absolute;
    top: 50%;
    left: 50%;
    border-radius: 2px;
    background: currentcolor;
    content: "";
    transform: translate(-50%, -50%);
}

.air__icon--custom::before {
    width: 12px;
    height: 2.5px;
}

.air__icon--custom::after {
    width: 2.5px;
    height: 12px;
}

.air__text {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    /* Gemessen bei 350 px Panelbreite: Mit 6 px Abstand und Werten in 11 px steht auch „Fliegender Teppich“
       noch in einer Zeile; erst auf schmaleren Telefonen rücken die Werte unter den Namen. */
    gap: 0 var(--space-4);
    min-width: 0;
}

.air__name {
    min-width: 0;
}

.air__values {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

.air__divider {
    width: 100%;
    margin: 0;
    border: 0;
    border-top: 1px solid var(--color-divider);
}

/* Die eigenen Werte: Feldzeilen als Tabelle (Guide §8), in einer eingesenkten Fläche unter ihrer Zeile. */
.air__custom {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4) var(--space-6);
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.air__name-field {
    width: 100%;
    min-width: 0;
}

.air__unit {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-muted);
}

.air__number {
    width: 64px;
}

@media (prefers-reduced-motion: reduce) {
    .air .air__option {
        transition: none;
    }
}
</style>
