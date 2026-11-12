<script setup lang="ts">
/**
 * Das Vorschaubild einer Zelle im Kartenfächer (WI-0024), wie Legacys `.map-layer-picker__thumb`.
 *
 * 🔴 Zwei Schichten: unten der gewählte Untergrund als ECHTE Kachel, darüber das Vektorbild der
 * Ansicht. Legacy (26.08.2026): „Eine Aufnahme trägt ihren Untergrund eingebrannt mit“, ein Vektor
 * liegt über jedem. Wechselt der Untergrund, wechselt das Bild aller Ansichten mit.
 *
 * ⚠️ Beides sind INHALTSBILDER in echten Kartenfarben. Sie werden nie umgefärbt und beim Überfahren
 * nie gedimmt; nur die Kraftlinien entsättigen den Untergrund, weil ihre Ansicht genau das mit der
 * Karte tut.
 */
import { AVENTURIA_POWERLINE_CARTOGRAPHY } from "@avesmaps3d/shared";

defineProps<{
    /** Die Untergrundkachel; fehlt sie, trägt die Hülle den Papierton der Karte. */
    base?: string | undefined;
    /** Das Vektorbild der Ansicht bzw. Ebene. */
    overlay?: string | undefined;
    /** Die Kraftlinien entsättigen den Untergrund (Legacy `GRUND_FILTER`). */
    desaturate?: boolean;
}>();

/**
 * Dieselben zwei Zahlen, mit denen die Karte selbst in der Kraftlinien-Ansicht tönt (WI-0025) - aus
 * der Kraftlinien-Kartografie, nicht ein zweites Mal hier.
 */
const sicht = AVENTURIA_POWERLINE_CARTOGRAPHY.magiersicht;
const MAGIERSICHT = `saturate(${String(sicht.saturation)}) brightness(${String(sicht.brightness)})`;
</script>

<template>
    <span class="fan-thumb" :class="{ 'fan-thumb--paper': !base }" :style="{ '--fan-magiersicht': MAGIERSICHT }">
        <img
            v-if="base"
            class="fan-thumb__grund"
            :class="{ 'fan-thumb__grund--entsaettigt': desaturate }"
            :src="base"
            alt=""
            loading="lazy"
        />
        <img v-if="overlay" class="fan-thumb__vektor" :src="overlay" alt="" />
    </span>
</template>

<style scoped>
/*
 * Legacy: ein 48-px-Bild mit 2 px Rand AUSSEN herum. 🔴 Seit WI-0036 liegt die Kontur INNEN auf dem
 * Bild (Betreiber 2026-09-25): das Bild füllt die ganzen 52 px, der Rand wird darübergezeichnet -
 * Außenmaß wie vorher, aber das Eselsohr schließt bündig mit der Bildkante ab.
 * Die Farben setzt der Fächer über geerbte Variablen: `--fan-thumb-rand` (Kontur, überfahren dunkel,
 * gewählt golden) und `--fan-thumb-strich` (heller Trennstrich innen). Geerbt, damit auch die Kopie
 * der Bildecke im Eselsohr sie trägt. Die Größe kommt aus `--fan-bild` (am Telefon schmaler).
 */
.fan-thumb {
    position: relative;
    display: block;
    width: var(--fan-bild, 52px);
    height: var(--fan-bild, 52px);
    overflow: hidden;
    border-radius: var(--radius-sm);
}

.fan-thumb::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 2;
    border: 2px solid var(--fan-thumb-rand, transparent);
    border-radius: inherit;
    pointer-events: none;
}

/* 💣 Als Pseudo-Element über dem Vektor, nicht als Innenschatten: das Bild deckte ihn zu. */
.fan-thumb::before {
    content: "";
    position: absolute;
    inset: 2px;
    z-index: 2;
    border: 1px solid var(--fan-thumb-strich, transparent);
    border-radius: calc(var(--radius-sm) - 2px);
    pointer-events: none;
}

/* In den Landschaften ist der Untergrund aus; die Hülle trägt den Papierton der Karte. */
.fan-thumb--paper {
    background: var(--color-map-paper);
}

.fan-thumb__grund {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

/* Legacy `GRUND_FILTER.powerlines` - der echte Wert, mit dem die Kraftlinien-Ansicht die Karte tönt.
   Er kommt aus der Kraftlinien-Kartografie (siehe oben), damit Karte und Vorschau nie auseinanderlaufen. */
.fan-thumb__grund--entsaettigt {
    filter: var(--fan-magiersicht);
}

/* ⚠️ Keine Zeiger-Ereignisse: sonst fängt das Bild den Klick, den die Zelle bekommen soll. */
.fan-thumb__vektor {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
}
</style>
