<script setup lang="ts">
/**
 * Ein Verlauf als kleine Linie (WI-0127 SYS-8, SYS-0001 §6.3; Blatt WI-0119 A7): die Werte der letzten 24 h, älteste links. 🔴 Eine Lücke
 * (`null`, nicht gemessen) bleibt eine Lücke, nie eine Null. Farben aus dem Kanon; für Vorleser trägt die Linie einen Satz (`text`), das
 * Bild selbst ist stumm. `art: "flaeche"` füllt unter der Linie (Arbeitsspeicher), sonst nur die Linie (Last).
 *
 * `gross` (Betreiber 2026-10-11: „die prozessor und arbeitsspeicher diagramme größer machen und die auslastung in % danebenschreiben“):
 * Das Bild füllt die Breite, die es bekommt, und ist höher; `prozent` steht groß links daneben.
 */
import { computed } from "vue";

const props = withDefaults(
    defineProps<{
        werte: readonly (number | null)[];
        /** Der Satz für Vorleser („Last über 24 Std., zuletzt 0,18, höchstens 0,9“). */
        text: string;
        /** Die Beschriftung rechts („24 Std.“). */
        spanne: string;
        /** Der obere Rand der Skala; ohne Angabe das Größte der Werte. */
        oben?: number | undefined;
        art?: "linie" | "flaeche";
        /** Breit und hoch statt der kleinen Linie (Systemzustand). */
        gross?: boolean;
        /** Die Auslastung jetzt („37 %“), groß neben dem Bild. */
        prozent?: string | null | undefined;
        testid?: string | undefined;
    }>(),
    { oben: undefined, art: "linie", gross: false, prozent: undefined, testid: undefined },
);

const BREITE = 120;
const HOEHE = 22;

/** Die Linienstücke zwischen den Lücken, als SVG-Pfade. */
const stuecke = computed(() => {
    const zahlen = props.werte.filter((value): value is number => value !== null);
    const oben = props.oben ?? Math.max(0, ...zahlen);
    const n = props.werte.length;
    const x = (i: number): number => (n <= 1 ? BREITE : (i / (n - 1)) * BREITE);
    const y = (value: number): number => HOEHE - 1 - (oben <= 0 ? 0 : Math.min(1, value / oben)) * (HOEHE - 2);
    const linien: { d: string; flaeche: string }[] = [];
    let punkte: [number, number][] = [];
    const schliessen = (): void => {
        if (punkte.length === 0) return;
        const d = punkte.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
        const erste = punkte[0]!;
        const letzte = punkte.at(-1)!;
        linien.push({
            d: punkte.length === 1 ? `${d} l0.1 0` : d,
            flaeche: `${d} L${letzte[0].toFixed(1)} ${HOEHE} L${erste[0].toFixed(1)} ${HOEHE} Z`,
        });
        punkte = [];
    };
    props.werte.forEach((value, i) => {
        if (value === null) schliessen();
        else punkte.push([x(i), y(value)]);
    });
    schliessen();
    return linien;
});
</script>

<template>
    <span
        class="verlauf"
        :class="{ 'verlauf--gross': props.gross }"
        role="img"
        :aria-label="props.text"
        :data-testid="props.testid"
    >
        <span v-if="props.prozent" class="verlauf__prozent" aria-hidden="true">{{ props.prozent }}</span>
        <svg
            class="verlauf__bild"
            :viewBox="`0 0 ${BREITE} ${HOEHE}`"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
        >
            <line class="verlauf__grund" x1="0" :y1="HOEHE - 0.5" :x2="BREITE" :y2="HOEHE - 0.5" />
            <template v-for="(stueck, i) in stuecke" :key="i">
                <path v-if="props.art === 'flaeche'" class="verlauf__flaeche" :d="stueck.flaeche" />
                <path class="verlauf__linie" :d="stueck.d" />
            </template>
        </svg>
        <span class="verlauf__spanne" aria-hidden="true">{{ props.spanne }}</span>
    </span>
</template>

<style scoped>
.verlauf {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
}

.verlauf__bild {
    display: block;
    width: 120px;
    height: 22px;
    overflow: visible;
}

.verlauf__grund {
    stroke: var(--color-divider);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
}

.verlauf__linie {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
}

.verlauf__flaeche {
    fill: color-mix(in srgb, var(--color-accent) 22%, transparent);
    stroke: none;
}

/* Groß: Das Bild nimmt die Breite, die die Zeile ihm lässt; die Prozentzahl steht in der Größe eines Werts davor. */
.verlauf--gross {
    display: flex;
    width: 100%;
    box-sizing: border-box;
    gap: var(--space-10);
    padding: var(--space-8) var(--space-10);
}

.verlauf--gross .verlauf__bild {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    height: 64px;
}

.verlauf__prozent {
    min-width: 3.5em;
    color: var(--color-text-strong);
    font-size: var(--font-size-title);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}

.verlauf__spanne {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}
</style>
