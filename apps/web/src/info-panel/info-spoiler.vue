<script setup lang="ts">
/**
 * Der Spoiler-Deckel über einem Bild (Design Guide §16.4 „Der Spoiler-Deckel“, Legacy `avesmapsSpoilerVeilMarkup`,
 * `css/features/place-extras.css`): EIN Mechanismus für den Literaturstreifen und die Kartensammlung.
 *
 * 🔴 **Er liegt ÜBER dem Bild, nicht dahinter, und übernimmt dessen Radius** (Guide §16.4): Er verdeckt genau die Fläche, die er
 * verdecken soll, und verrät durch seine Form, was darunter liegt. Er ist kein eigenes Bauteil neben der Kachel, sondern ein Deckel
 * in ihr - der Elternteil setzt `--spoiler-veil-height` auf die Höhe seines Bildes, damit der Deckel nicht über den Text darunter
 * läuft.
 *
 * ⭐ **Und er nennt den Grund, nicht die Warnung**: „Spoiler (spielt hier)“ beziehungsweise „Spoiler (Spielinhalte)“ - der Leser
 * entscheidet selbst, ob ihn das betrifft.
 *
 * Er ist ein KNOPF: Der Klick deckt genau diesen Eintrag auf und darf nicht an den Anker darunter durchfallen (Legacy fängt ihn
 * ausdrücklich ab, sonst öffnete derselbe Klick schon den Link). Beim nächsten Öffnen des Panels ist wieder alles zu; einen
 * Sammelschalter gibt es nicht (Legacy, Owner 2026-07-19).
 */
defineProps<{ label: string }>();
const emit = defineEmits<{ reveal: [] }>();
</script>

<template>
    <button type="button" class="info-spoiler" data-testid="info-spoiler" @click.stop.prevent="emit('reveal')">
        {{ label }}
    </button>
</template>

<style scoped>
.info-spoiler {
    position: absolute;
    inset: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    height: var(--spoiler-veil-height, 100%);
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--color-scrim-spoiler);
    color: var(--color-scrim-spoiler-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    line-height: var(--leading-snug);
    text-align: center;
    transition: background-color 120ms ease;
}

.info-spoiler:hover {
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-scrim-spoiler);
}

.info-spoiler:active {
    background: linear-gradient(var(--color-active-wash), var(--color-active-wash)), var(--color-scrim-spoiler);
}

.info-spoiler:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .info-spoiler {
        transition: none;
    }
}
</style>
