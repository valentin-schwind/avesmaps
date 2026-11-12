<script setup lang="ts">
import AenderungZeilenkopf from "./aenderung-zeilenkopf.vue";
import type { ZeilenAngaben, ZeilenOrt } from "./aenderung-zeile-modell";

/**
 * Eine Zeile der Liste von „Änderungen“ (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`): ein Knopf, der die Zeile auf- und zuklappt (`aria-expanded`), mit höchstens zwei Zeilen Inhalt
 * (`aenderung-zeilenkopf.vue`). Eine Operation, eine Arbeitsserie und ein Bündel von Läufen sind dieselbe Zeile.
 *
 * - **⊕** (B9) liegt am Ende von Zeile 2, links vom ▸, wo die Änderung einen Ort hat; es ist ein eigener Knopf neben dem der Zeile (ein Knopf im Knopf gibt es nicht) und klappt die Zeile nicht auf.
 * - **↺** (Vorlage Variante B, vom Betreiber am 2026-11-01 gewählt: „↺ in der Zeile -> B“) erscheint zusätzlich beim Überfahren und mit dem Fokus am Zeilenende, am Telefon nie. Es schreibt nie: Es öffnet die Zeile und die
 *   Rückfrage darin (`ruecknehmen`).
 * - Die Fläche: beim Überfahren die Lasche der Hausfarbe, aufgeklappt die kräftigere.
 */
defineProps<{
    angaben: ZeilenAngaben;
    offen: boolean;
    ort?: ZeilenOrt | undefined;
    /** Das ↺ am Zeilenende (nur wo es etwas zurückzunehmen gibt und nicht am Telefon). */
    ruck?: boolean | undefined;
    /** Der Name des ↺ für Tooltip und Vorleser. */
    ruckTitel?: string | undefined;
    /** Die gedämpfte Zeile eines Bündels. */
    buendel?: boolean | undefined;
    testid?: string | undefined;
}>();
defineEmits<{ waehle: []; ort: []; ruecknehmen: [] }>();
</script>

<template>
    <div
        class="z"
        :class="{
            'z--offen': offen,
            'z--buendel': buendel,
            'z--hatort': ort !== undefined,
        }"
    >
        <button type="button" class="z__kopf" :aria-expanded="offen" :data-testid="testid" @click="$emit('waehle')">
            <AenderungZeilenkopf
                :angaben="angaben"
                :offen="offen"
                :platz-ort="ort !== undefined"
                :platz-rueck="ruck === true"
                :status="ort?.status"
                :einzeilig="buendel"
            />
        </button>
        <button
            v-if="ort"
            type="button"
            class="z__ort"
            :title="ort.titel"
            :aria-label="ort.titel"
            :aria-pressed="ort.gedrueckt"
            :data-testid="ort.testid"
            @click="$emit('ort')"
        >
            <span aria-hidden="true">⊕</span>
        </button>
        <button
            v-if="ruck"
            type="button"
            class="z__ruck"
            :title="ruckTitel"
            :aria-label="ruckTitel && `${ruckTitel}: ${angaben.titel}`"
            :data-testid="testid && `${testid}-ruck`"
            @click="$emit('ruecknehmen')"
        >
            <span aria-hidden="true">↺</span>
        </button>
    </div>
</template>

<style scoped>
.z {
    position: relative;
}

.z__kopf {
    display: block;
    width: 100%;
    padding: var(--space-4) var(--space-10);
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.z__kopf:hover {
    background: var(--color-hover-wash);
}

.z--offen > .z__kopf {
    background: var(--color-active-wash);
}

.z__kopf:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
}

/* Die gedämpfte Zeile eines Bündels: eine Zeile, auf der gedämpften Fläche. */
.z--buendel > .z__kopf {
    padding-block: 5px;
    background: var(--color-panel-muted);
}

.z--buendel > .z__kopf:hover {
    background: var(--color-hover-wash);
}

.z--buendel.z--offen > .z__kopf {
    background: var(--color-active-wash);
}

/* ⊕ liegt links vom ▸ am Ende von Zeile 2 (ein Bündel hat nur eine Zeile: mittig). */
.z__ort {
    position: absolute;
    right: 22px;
    bottom: 4px;
    width: 22px;
    height: 20px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    line-height: 1;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.z--buendel > .z__ort {
    top: 50%;
    bottom: auto;
    margin-top: -10px;
}

.z__ort:hover {
    border-color: var(--color-link);
    background: var(--color-hover-wash);
    color: var(--color-link-hover);
}

.z__ort[aria-pressed="true"] {
    border-color: var(--color-link);
    background: var(--color-active-wash);
    color: var(--color-link-hover);
}

.z__ort:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* ↺ erscheint beim Überfahren und mit dem Fokus; am Telefon (kein Überfahren) nie. */
.z__ruck {
    position: absolute;
    right: 22px;
    bottom: 5px;
    width: 24px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    line-height: 1;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
}

.z:hover > .z__ruck,
.z:focus-within > .z__ruck {
    opacity: 1;
    pointer-events: auto;
}

.z--hatort > .z__ruck {
    right: 48px;
}

.z__ruck:hover {
    border-color: var(--color-link);
}

.z__ruck:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (hover: none) {
    .z__ruck {
        display: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .z__ort,
    .z__ruck {
        transition: none;
    }
}
</style>
