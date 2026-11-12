<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import ReisebildZeichen from "./reisebild-zeichen.vue";
import { REISEBILD_SYMBOLE } from "./reisebild-zeichen";
import { knopfZahl } from "./reisebilder-leiste-modell";
import { reisebilder } from "./reisebilder-zustand";

/**
 * Der Knopf „Reisebilder“ im Eckbund unten rechts (WI-0272 S4, Aufgabe 28), vor „Neuigkeiten“. Er nennt die Zahl der Bilder im Ausschnitt (bei einer gekappten Antwort „500+“, bei 0 keine Zahl) und fährt
 * die Leiste hoch oder zu. Er steht nur, wo die Karte Reisebilder zeigt (`an`): Ist der Schalter `media.role.photobox` aus, gibt es ihn nicht. Das Aussehen ist das der anderen Eckknöpfe
 * (`corner-links.vue` gibt die Klasse `corner-link` an den Inhalt des Slots weiter); hier steht nur, was der Knopf dazu trägt: die Zahl und den Pfeil.
 */
const { an, imBild, gekappt, leisteOffen, ohneKi, nurMeine, ausgeblendet } = reisebilder;
const zahl = computed(() => knopfZahl(imBild.value.length, gekappt.value));
const filterHinweis = computed(() => {
    if (ausgeblendet.value) return t("photobox.karte.ausblendenHinweis");
    return ohneKi.value ? t("photobox.karte.ohneKiHinweis") : t("photobox.karte.meineHinweis");
});
</script>

<template>
    <button
        v-if="an"
        type="button"
        class="corner-link reisebilder-knopf"
        :class="{ 'is-offen': leisteOffen }"
        data-testid="reisebilder-knopf"
        :aria-expanded="leisteOffen"
        aria-controls="reisebilder-leiste"
        @click="reisebilder.setzeLeiste(!leisteOffen)"
    >
        <span>{{ t("photobox.karte.knopf") }}</span>
        <!-- Ein Schalter bleibt auch bei zugeklappter Leiste und nach dem Wiederbesuch zu erkennen. -->
        <span
            v-if="ohneKi || nurMeine || ausgeblendet"
            class="reisebilder-knopf__filter"
            :title="filterHinweis"
            data-testid="reisebilder-knopf-filter"
        >
            <ReisebildZeichen v-if="ausgeblendet" name="augeAus" />
            <ReisebildZeichen v-if="ohneKi" name="roboterAus" />
            <img v-if="nurMeine" :src="REISEBILD_SYMBOLE.kartensammlung" alt="" aria-hidden="true" decoding="async" />
        </span>
        <span v-if="zahl !== ''" class="reisebilder-knopf__zahl" data-testid="reisebilder-knopf-zahl">{{ zahl }}</span>
        <span class="reisebilder-knopf__pfeil" aria-hidden="true">▴</span>
    </button>
</template>

<style scoped>
.reisebilder-knopf {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
}

.reisebilder-knopf__filter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-accent-strong);
}

.reisebilder-knopf__filter svg,
.reisebilder-knopf__filter img {
    width: var(--icon-sm);
    height: var(--icon-sm);
    object-fit: contain;
}

.reisebilder-knopf__zahl {
    color: var(--color-accent-strong);
    font-variant-numeric: tabular-nums;
}

/* Der Pfeil zeigt zur Leiste und dreht sich, wenn sie offen ist (Zustände nach Guide §30.5: 120 ms). */
.reisebilder-knopf__pfeil {
    display: inline-block;
    transition: transform 120ms ease;
}

.reisebilder-knopf.is-offen .reisebilder-knopf__pfeil {
    transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
    .reisebilder-knopf__pfeil {
        transition: none;
    }
}
</style>
