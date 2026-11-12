<script setup lang="ts">
/**
 * Die gemeinsame Reihe unter dem Schalter der Warteschlange (WI-0163 §1.7; Betreiber 2026-10-15: „ich seh ob ein job von stage oder
 * production is, die ordnen sich da der reihe nach ein“). Was sie rechnet, steht in `warteschlange-reihe.ts`.
 *
 * - **Legacys Listenform** (AGENTS.md „Editor: abstrakte Zeichen, der Kreis und Legacys Listen“): je Auftrag eine Zeile, Name mit
 *   Kreis (○ wartet, ◐ läuft), darunter die Unterzeile mit Platz und Grund oder mit Schritt und Fortschritt, rechts die Umgebung als
 *   Pille im Ton der Kopfleiste. Unten die Legende der Kreise, kein Tooltip.
 * - Die Karte nennt keinen Auslöser; wer, wann und wo steht auf der Seite Warteschlange (`job-row.vue`, `fremd-row.vue`, WI-0293).
 * - Nur Anzeige: Die Liste hat keine Leiste, weil sie nur wenige Einträge trägt und nichts zu suchen, zu filtern oder zu ordnen ist;
 *   ihre Reihenfolge IST die Aussage.
 */
import { computed } from "vue";
import type { GemeinsamerAuftrag } from "@avesmaps3d/shared";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import { REIHE_LEGENDE, reiheKreisName, reiheZeilen } from "./warteschlange-reihe";

const props = defineProps<{ reihe: readonly GemeinsamerAuftrag[] }>();

const zeilen = computed(() => reiheZeilen(props.reihe));
</script>

<template>
    <div class="reihe" data-testid="betrieb-reihe">
        <p class="reihe__titel">{{ t("admin.system.queue.order") }}</p>
        <ul v-if="zeilen.length > 0" class="reihe__liste" :aria-label="t('admin.system.queue.order')">
            <li
                v-for="zeile in zeilen"
                :key="zeile.key"
                class="reihe__eintrag"
                :data-eigen="zeile.eigen"
                data-testid="betrieb-reihe-eintrag"
            >
                <span class="reihe__name">
                    <span class="reihe__text">{{ zeile.name }}</span>
                    <AvmKreis :fuellung="zeile.kreis" :name="zeile.kreisName" />
                </span>
                <AvmPille class="reihe__umgebung" :ton="zeile.ton" testid="betrieb-reihe-umgebung">{{
                    zeile.umgebung
                }}</AvmPille>
                <span
                    class="reihe__unter"
                    :class="{ 'reihe__unter--haengt': zeile.haengt }"
                    data-testid="betrieb-reihe-unter"
                    >{{ zeile.unter }}</span
                >
                <div
                    v-if="zeile.prozent !== null"
                    class="reihe__balken"
                    role="progressbar"
                    :aria-valuenow="zeile.prozent"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="t('admin.sync.progress', { name: zeile.name })"
                >
                    <span class="reihe__balken-fuellung" :style="{ width: `${String(zeile.prozent)}%` }"></span>
                </div>
            </li>
        </ul>
        <p v-else class="reihe__leer" data-testid="betrieb-reihe-leer">{{ t("admin.system.queue.empty") }}</p>
        <p v-if="zeilen.length > 0" class="reihe__legende" data-testid="betrieb-reihe-legende">
            <span v-for="eintrag in REIHE_LEGENDE" :key="eintrag.state" class="reihe__legende-teil">
                <AvmKreis :fuellung="eintrag.kreis" :name="reiheKreisName(eintrag.state)" />{{
                    reiheKreisName(eintrag.state)
                }}
            </span>
        </p>
    </div>
</template>

<style scoped>
.reihe {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

/* Die Überschrift im Ton der Feldbeschriftungen (Guide §8), nicht als zweite Kartenaufschrift. */
.reihe__titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.reihe__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    list-style: none;
}

/* Legacys Zeile: Name mit Kreis oben, Unterzeile darunter, rechts die Umgebung über beide Zeilen. */
.reihe__eintrag {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-8);
    row-gap: var(--space-2);
    align-items: center;
    padding: var(--space-6) var(--space-8);
}

.reihe__eintrag + .reihe__eintrag {
    border-top: 1px solid var(--color-divider);
}

.reihe__name {
    grid-row: 1;
    grid-column: 1;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.reihe__text {
    min-width: 0;
    overflow-wrap: anywhere;
}

.reihe__umgebung {
    grid-row: 1 / span 2;
    grid-column: 2;
    justify-self: end;
}

.reihe__unter {
    grid-row: 2;
    grid-column: 1;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

/* Ein hängender Auftrag (WI-0179) steht rot: Er kommt nicht von selbst weiter. */
.reihe__unter--haengt {
    color: var(--color-danger-soft-text);
}

/* Der Balken wie unter den Abgleichen und auf der Statusseite: grob, aus dem Schritt. */
.reihe__balken {
    grid-row: 3;
    grid-column: 1 / span 2;
    height: var(--space-4);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.reihe__balken-fuellung {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
    .reihe__balken-fuellung {
        transition: none;
    }
}

.reihe__leer {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die Legende wie unter Legacys Listen: leise, jedes Zeichen neben seinem Wort (Guide §13.17). */
.reihe__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.reihe__legende-teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}
</style>
