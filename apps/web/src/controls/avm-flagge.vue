<script setup lang="ts">
import { computed } from "vue";
import { FLAGGEN, streifenRechtecke, type Flagge, type Streifen } from "./flaggen";
import type { Locale } from "../i18n/plural";

/**
 * Die kleine Flagge neben einer Sprache (Kanal OPS-000014; Betreiber 2026-10-16: Variante b, Flagge **zusätzlich** zu
 * Kürzel und Name). 16 × 11, gezeichnet, mit feiner Kante — ohne sie verschwindet jedes Weiß im hellen Fenster.
 *
 * 🔴 Sie trägt keine Bedeutung für Vorleser (`aria-hidden`): Daneben steht der Name der Sprache, und der ist die
 * Auskunft. Eine Flagge, die vorgelesen wird, sagt ein Land, wo eine Sprache gemeint ist.
 */
const props = defineProps<{ sprache: Locale }>();

const B = 16;
const H = 11;

const flagge = computed<Flagge>(() => FLAGGEN[props.sprache]);

/** Die Felder einer geteilten Flagge; ungeteilt ist es eines über die ganze Breite. */
const felder = computed<{ flagge: Flagge; x: number; breite: number }[]>(() => {
    const f = flagge.value;
    if (f.art !== "geteilt") return [{ flagge: f, x: 0, breite: B }];
    return [
        { flagge: f.links, x: 0, breite: B / 2 },
        { flagge: f.rechts, x: B / 2, breite: B / 2 },
    ];
});

const streifen = (f: Flagge, x: number, breite: number): ReturnType<typeof streifenRechtecke> =>
    f.art === "streifen" ? streifenRechtecke(f as Streifen, { x, y: 0, breite, hoehe: H }) : [];
</script>

<template>
    <svg class="flagge" :viewBox="`0 0 ${B} ${H}`" aria-hidden="true" focusable="false">
        <template v-for="(feld, i) in felder" :key="i">
            <!-- Streifen: Deutschland, Frankreich, Italien, die Niederlande, Spanien, Polen. -->
            <rect
                v-for="(teil, j) in streifen(feld.flagge, feld.x, feld.breite)"
                :key="`s${String(i)}-${String(j)}`"
                :x="teil.x"
                :y="teil.y"
                :width="teil.breite"
                :height="teil.hoehe"
                :fill="teil.farbe"
            />

            <!-- Skandinavisches Kreuz: aus der Mitte nach links versetzt (Dänemark, Schweden). -->
            <template v-if="feld.flagge.art === 'kreuz'">
                <rect :x="feld.x" y="0" :width="feld.breite" :height="H" :fill="feld.flagge.grund" />
                <rect :x="feld.x" y="4.5" :width="feld.breite" height="2" :fill="feld.flagge.kreuz" />
                <rect :x="feld.x + feld.breite * 0.34" y="0" width="2" :height="H" :fill="feld.flagge.kreuz" />
            </template>

            <!-- USA, stark vereinfacht: fünf Streifen und das blaue Feld. Mehr löst sich bei 8 px Breite auf. -->
            <template v-if="feld.flagge.art === 'usa'">
                <rect :x="feld.x" y="0" :width="feld.breite" :height="H" fill="#ffffff" />
                <rect
                    v-for="k in 3"
                    :key="`u${String(k)}`"
                    :x="feld.x"
                    :y="(k - 1) * 4.4"
                    :width="feld.breite"
                    height="2.2"
                    fill="#b22234"
                />
                <rect :x="feld.x" y="0" :width="feld.breite * 0.55" height="5" fill="#3c3b6e" />
            </template>

            <!-- Union Jack, vereinfacht: blauer Grund, weißes Andreaskreuz, rotes Georgskreuz. -->
            <template v-if="feld.flagge.art === 'union'">
                <rect :x="feld.x" y="0" :width="feld.breite" :height="H" fill="#012169" />
                <path
                    :d="`M${feld.x} 0 L${feld.x + feld.breite} ${H} M${feld.x + feld.breite} 0 L${feld.x} ${H}`"
                    stroke="#ffffff"
                    stroke-width="2"
                />
                <path
                    :d="`M${feld.x + feld.breite / 2} 0 V${H} M${feld.x} ${H / 2} H${feld.x + feld.breite}`"
                    stroke="#ffffff"
                    stroke-width="3.2"
                />
                <path
                    :d="`M${feld.x + feld.breite / 2} 0 V${H} M${feld.x} ${H / 2} H${feld.x + feld.breite}`"
                    stroke="#c8102e"
                    stroke-width="1.8"
                />
            </template>
        </template>
        <!-- Die Kante: ohne sie steht Weiß auf Weiß, und Polen wäre ein roter Balken ohne Oberkante. -->
        <rect
            x="0.25"
            y="0.25"
            :width="B - 0.5"
            :height="H - 0.5"
            fill="none"
            stroke="var(--color-border)"
            stroke-width="0.5"
        />
    </svg>
</template>

<style scoped>
.flagge {
    flex: none;
    width: 16px;
    height: 11px;
    border-radius: 1px;
}
</style>
