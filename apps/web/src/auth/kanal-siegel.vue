<script setup lang="ts">
/**
 * Das Siegel von Claudia und Claudio (WI-0124, Betreiber 2026-10-10: „unterscheidung siegel“, Variante A): Raute mit Goldsaum, Zirkel für
 * Claudia, Laterne für Claudio, je eine eigene Kanonfarbe (`--color-agent-claudia`, `--color-agent-claudio`). Dieselbe Zeichnung wie auf
 * dem abgenommenen Blatt und im Mockup der Benachrichtigungen. Es steht für einen der zwei Agenten, nie für eine Person.
 */
const props = defineProps<{
    agent: "claudia" | "claudio";
    groesse?: "klein" | undefined;
}>();
</script>

<template>
    <span
        class="siegel"
        :class="[`siegel--${props.agent}`, { 'siegel--klein': props.groesse === 'klein' }]"
        role="img"
        :aria-label="props.agent === 'claudia' ? 'Claudia' : 'Claudio'"
    >
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path class="siegel__raute" d="M12 1.4 22.6 12 12 22.6 1.4 12Z" />
            <template v-if="props.agent === 'claudia'">
                <circle class="siegel__fuellung" cx="12" cy="6.9" r="1.5" />
                <path class="siegel__zeichen" d="M11.4 8.2 8.3 16.6M12.6 8.2l3.1 8.4" />
                <path class="siegel__zeichen siegel__zeichen--fein" d="M15.7 16.6q-1.6 1.5-3.7 1.6" />
            </template>
            <template v-else>
                <circle class="siegel__zeichen siegel__zeichen--ring" cx="12" cy="5.7" r=".95" />
                <path class="siegel__fuellung" d="M8.6 9.3 12 6.9l3.4 2.4Z" />
                <rect class="siegel__fuellung" x="9.5" y="9.7" width="5" height="5.2" rx=".5" />
                <path class="siegel__flamme" d="M12 10.5q1.35 1.4 0 2.95q-1.35-1.55 0-2.95Z" />
                <rect class="siegel__fuellung" x="8.9" y="15.3" width="6.2" height="1.3" rx=".4" />
            </template>
        </svg>
    </span>
</template>

<style scoped>
.siegel {
    display: inline-block;
    flex: none;
    width: var(--icon-lg);
    height: var(--icon-lg);
}

.siegel--klein {
    width: var(--icon-md);
    height: var(--icon-md);
}

.siegel svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
}

.siegel--claudia {
    --siegel-farbe: var(--color-agent-claudia);
    --siegel-text: var(--color-agent-claudia-text);
}

.siegel--claudio {
    --siegel-farbe: var(--color-agent-claudio);
    --siegel-text: var(--color-agent-claudio-text);
}

.siegel__raute {
    fill: var(--siegel-farbe);
    stroke: var(--color-accent);
    stroke-width: 1.6;
    stroke-linejoin: round;
}

.siegel__zeichen {
    fill: none;
    stroke: var(--siegel-text);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.siegel__zeichen--fein {
    stroke-width: 1.2;
}

.siegel__zeichen--ring {
    stroke-width: 1.1;
}

.siegel__fuellung {
    fill: var(--siegel-text);
    stroke: none;
}

.siegel__flamme {
    fill: var(--siegel-farbe);
    stroke: none;
}
</style>
