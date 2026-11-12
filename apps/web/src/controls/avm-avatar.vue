<script setup lang="ts">
import { computed } from "vue";
import { avatarInitiale, avatarTon } from "./avm-avatar";

/**
 * Der Avatar einer Person (WI-0120 A8): der Anfangsbuchstabe auf einem Kreis, dessen Ton aus der KENNUNG folgt, nie aus
 * dem Namen (`avm-avatar.ts`). Kein Bild: Ein Discord-Avatar wäre eine Anfrage an einen fremden Dienst.
 *
 * - **Zwei Größen:** `klein` in Zeilen und im Kontoknopf (`--icon-lg`, 24 px), `gross` im Kontoblock des Menüs
 *   (`--icon-xl`, 46 px). Der Buchstabe sitzt mit seiner Versalhöhe mittig (`.avm-versalmitte`, §3.2).
 * - **Sieben Töne, je ein Paar aus Fläche und Schrift des Kanons**, das in beiden Themen mindestens 4,5 : 1 liest; eine
 *   feine Haarlinie in der Trennerfarbe hält auch die hellen Töne gegen das Panel.
 * - Steht der Name daneben, ist der Avatar für Vorleser stumm; steht er allein (etwa im Kontoknopf), trägt er mit
 *   `beschriftung` einen Namen.
 */
const props = defineProps<{
    /** Die Kennung der Person (UUID): Sie wählt den Ton. */
    kennung: string;
    /** Der Anzeigename: Er liefert nur den Buchstaben. */
    name: string;
    groesse?: "klein" | "gross" | undefined;
    /** Ein Name für Vorleser, wenn der Avatar allein steht. */
    beschriftung?: string | undefined;
    testid?: string | undefined;
}>();

const ton = computed(() => avatarTon(props.kennung));
const initiale = computed(() => avatarInitiale(props.name));
</script>

<template>
    <span
        class="avatar"
        :class="`avatar--${props.groesse ?? 'klein'}`"
        :data-ton="ton"
        :role="props.beschriftung ? 'img' : undefined"
        :aria-label="props.beschriftung"
        :aria-hidden="props.beschriftung ? undefined : 'true'"
        :data-testid="props.testid"
    >
        <span class="avm-versalmitte">{{ initiale }}</span>
    </span>
</template>

<style scoped>
.avatar {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--color-divider);
    line-height: 1;
    user-select: none;
}

.avatar--klein {
    width: var(--icon-lg);
    height: var(--icon-lg);
    font-size: var(--font-size-caption);
}

.avatar--gross {
    width: var(--icon-xl);
    height: var(--icon-xl);
    font-size: var(--font-size-title);
}

/* Die Töne: je ein Paar aus dem Kanon, gemessen in beiden Themen (avm-avatar.ts). Die Zahl der Regeln ist AVATAR_TOENE. */
.avatar[data-ton="0"] {
    background: var(--color-button);
    color: var(--color-button-text);
}

.avatar[data-ton="1"] {
    background: var(--color-accent-brown);
    color: var(--color-panel);
}

.avatar[data-ton="2"] {
    background: var(--color-accent-strong);
    color: var(--color-panel);
}

.avatar[data-ton="3"] {
    background: var(--color-accent);
    color: var(--color-page-bg-deep);
}

.avatar[data-ton="4"] {
    background: var(--color-pill);
    color: var(--color-pill-text);
}

.avatar[data-ton="5"] {
    background: var(--color-panel-active);
    color: var(--color-text-strong);
}

.avatar[data-ton="6"] {
    background: var(--color-page-bg-deep);
    color: var(--color-accent);
}
</style>
