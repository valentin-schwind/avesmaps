<script lang="ts">
import { WAYPOINT_MARK } from "./waypoint-mark-shape";

/** Wo die Kette der Etappenliste an einer Marke endet - die Maße stehen bei der Gestalt (`waypoint-mark-shape.ts`). */
export const MARK_CHAIN_ANCHOR = WAYPOINT_MARK.chainAnchor;
</script>

<script setup lang="ts">
import { dropBox, MARK_SIZE, WAYPOINT_MARK as MARK } from "./waypoint-mark-shape";

/**
 * Die Marke eines Wegpunkts (Design Guide §17.4: „die Markerfarbe kodiert die Rolle“): der **Ring** für Start und
 * Zwischenziel, die **Nadel** (Tropfen) für das Ziel.
 *
 * 🔴 EIN Bauteil für beide Stellen, an denen die Rollen sichtbar werden: die Wegpunkteingabe und die Etappenliste
 * (Betreiber 2026-10-05: „das ziel braucht die traube [= den Tropfen] und beide sollten eigentlich so aussehen wie
 * die symbole aus den wegpunkten“). Zeichnete die Liste dieselbe Rolle nach, stünde dieselbe Aussage in zwei
 * Rezepturen - und genau das war die Unstimmigkeit, die er gemeldet hat.
 *
 * 🔴 Und EINE Gestalt für Oberfläche und Karte (WI-0087 P6): Die Formen stehen in `waypoint-mark-shape.ts`, die
 * Karte rastert dieselben (`map/route-layers.ts`). Hier wird nichts mehr von Hand nachgezeichnet.
 *
 * 🔴 Und EINE Größe für beide Stellen (WI-0097, Betreiber 2026-10-07: „die icons der wegpunktmarkierung und der
 * tropfen sollten im routenplaner und bei den etappen gleich groß sein"). Sie steht als `MARK_SIZE` bei der Gestalt,
 * mit der Begründung, warum 18 und nicht 13 gewinnt.
 *
 * 🪤 **Hier gab es dafür einen Parameter `size`** mit der Vorgabe 18, und die Etappenliste setzte ihn auf 13 - so
 * entstanden aus EINEM Bauteil zwei Größen. Der Parameter ist weg: Wer die Marke zeichnet, sagt nur noch, welche
 * Rolle sie trägt. Braucht eine künftige Stelle wirklich eine andere Größe, ist das eine Gestaltungsfrage für den
 * Betreiber, keine Zahl am Aufruf.
 *
 * `MARK_SIZE` ist die Höhe in Pixeln; die Breite folgt der Form. Der Ring ist rund, die Nadel schmaler und höher.
 */
defineProps<{ rolle: "wegpunkt" | "ziel" }>();
const box = dropBox(MARK_SIZE);
</script>

<template>
    <svg
        v-if="rolle === 'ziel'"
        :viewBox="MARK.drop.viewBox"
        class="mark mark--drop"
        :style="{ height: `${String(box.height)}px`, width: `${String(box.width)}px` }"
        aria-hidden="true"
    >
        <path :d="MARK.drop.outer" class="mark-core" />
        <path :d="MARK.drop.inner" class="mark-fill" />
        <circle :cx="MARK.drop.eye.cx" :cy="MARK.drop.eye.cy" :r="MARK.drop.eye.r" class="mark-core" />
    </svg>
    <svg
        v-else
        :viewBox="MARK.disc.viewBox"
        class="mark mark--disc"
        :style="{ height: `${String(MARK_SIZE)}px`, width: `${String(MARK_SIZE)}px` }"
        aria-hidden="true"
    >
        <circle :r="MARK.disc.core" class="mark-core" />
        <circle :r="MARK.disc.fill" class="mark-fill" />
        <circle :r="MARK.disc.eye" class="mark-core" />
    </svg>
</template>

<style scoped>
.mark {
    display: block;
}

.mark-core {
    fill: var(--color-marker-waypoint-core);
}

.mark-fill {
    fill: var(--color-marker-waypoint);
}
</style>
