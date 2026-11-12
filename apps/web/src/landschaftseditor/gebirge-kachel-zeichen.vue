<script setup lang="ts">
import type { Gebirgstyp } from "@avesmaps3d/shared";

/**
 * Das feste Zeichen einer Typ-Kachel im Reiter „Gebirge“ (Bauvorlage Gebirge-Entwurf V16, Betreiber 2026-10-20: Typ-Kacheln „festes
 * Zeichen“): eine Strichzeichnung je Gebirgstyp nach seinem Satz in den Sprachtafeln (`landschaftseditor.gebirge.satz.*`, dort auch die
 * irdischen Beispiele) und ein eigenes Zeichen für „Keins passt“, in der Textfarbe. Aus dem Entwurf übernommen.
 */
defineProps<{ typ: Gebirgstyp | null }>();
const ZEICHEN: Readonly<Record<Gebirgstyp, string>> = {
    // eine durchgehende Hauptkammlinie
    kammgebirge: "M2 17 L8 12 L12 14 L17 7 L21 10 L25 5 L29 9 L33 8 L38 17",
    // viele schmale, verästelte Kämme
    gratgebirge: "M2 17 L9 6 L12 11 L16 3 L19 10 L23 4 L27 12 L31 5 L38 17 M12 11 L10 17 M19 10 L20 17 M27 12 L28 17",
    // mehrere parallele Kämme
    kettengebirge:
        "M2 9 L7 5 L12 8 L17 4 L22 8 L27 5 L32 8 L38 6 M2 17 L7 12 L12 15 L17 11 L22 15 L27 12 L32 15 L38 13",
    // Kuppen auf gemeinsamem Fuß
    kuppengebirge: "M2 17 Q6 9 10 14 Q14 6 19 13 Q24 5 29 13 Q33 8 38 17",
    // geschlossene Erhebung, Zellspitzen auf hohem Sockel
    massengebirge: "M2 17 L6 9 L10 8 L12 5 L15 8 L19 4 L23 8 L26 6 L30 9 L34 9 L38 17",
    // Tafel mit Abbruchkante
    plateaugebirge: "M2 17 L8 16 L11 6 L29 6 L30 9 L33 10 L38 17",
    // abgetragen, weiche Rücken
    rumpfgebirge: "M2 17 Q8 11 14 14 Q20 10 26 14 Q32 11 38 17",
    // altes, flaches Tafelland
    schild: "M2 17 Q20 8 38 17 M8 14.5 L32 14.5",
    // einzelne Berge aus der Ebene
    inselberg: "M2 17 L11 17 L15 7 L19 17 L25 17 L28 11 L31 17 L38 17",
    // zerklüftet, tief eingeschnitten
    karst: "M2 17 L4 6 L7 6 L8 16 L11 16 L12 5 L15 5 L16 15 L19 15 L20 7 L23 7 L24 16 L27 16 L28 4 L31 4 L32 17 L38 17",
    // Zellen: Berge als Zellspitzen, Täler an den Grenzen
    bergland: "M2 17 L6 11 L9 15 L13 9 L17 15 L21 10 L25 15 L29 8 L33 15 L38 17",
};
</script>

<template>
    <svg class="kachel-zeichen" viewBox="0 0 40 20" aria-hidden="true">
        <path v-if="typ !== null" :d="ZEICHEN[typ]" />
        <g v-else class="kachel-zeichen__keins">
            <path d="M2 17 L12 7 L17 11 L24 4 L38 17 Z" />
            <path d="M20 14 h6 M23 11 v6" class="kachel-zeichen__plus" />
        </g>
    </svg>
</template>

<style scoped>
.kachel-zeichen {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.kachel-zeichen__keins path:first-child {
    stroke-dasharray: 2 2;
}
</style>
