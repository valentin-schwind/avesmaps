<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from "vue";
import { t } from "../i18n/i18n";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { HinweisPlatz } from "../controls/kamera-hinweis-platz";
import { hinweiseUnten } from "../feedback/unten-mitte";
import type { AnfrageEintrag } from "./freigabe-anfragen";
import { uhrzeit } from "./fremde-sperren";

/**
 * Die Hinweise zu den Bitten um Freigabe beim Inhaber der Sperre (WI-0262, OPS-000059; Vali 2026-10-30). Nicht modal: Sie liegen über der
 * Karte und nehmen Klicks nur auf sich selbst; die Bearbeitung läuft darunter weiter. Je Anfrage ein Hinweis mit dem Namen des
 * Bittenden und dem Objekt und zwei Knöpfen: „Freigeben“ (speichert die Änderungen, gibt die Sperre ab) und „Später“ (lehnt ab).
 *
 * - **Stil des vorhandenen Hinweises** (der einmalige Kamera-Hinweis, `controls/camera-controls.vue`): Fläche `--color-panel`, Rand,
 *   Panelschatten, kleine Schrift, Knöpfe der Zeile.
 * - **Platz: unten in der Mitte**, wie der Toast (Vali 2026-10-30, „zentriert am unteren bildschirmrand“; oben rechts deckte er bei 1280
 *   die Knöpfe im Kopf des angedockten Fensters). Der Toast steigt darüber (`hinweiseUnten`), die Maßstabsleiste ebenso. Nur `platz`
 *   (am Telefon) stellt sie oben hin: Dort liegen unten die Knöpfe „Verwerfen“ und „Speichern“ des Fensters.
 * - **Speichern scheitert** (Prüfung, Konflikt, 409): Der Hinweis bleibt, nennt den Grund in einer Zeile, und beide Knöpfe gelten weiter.
 *   Beantwortet wird dabei nichts.
 * - Farbe wie jeder Hinweis des Hauses ohne Rot (Rot heißt „ich bearbeite“, EDIT-0003 T1); der Grund steht in der Schrift des Textes.
 */
const props = defineProps<{
    eintraege: readonly AnfrageEintrag[];
    platz?: HinweisPlatz | null | undefined;
}>();

const emit = defineEmits<{ freigeben: [id: string]; spaeter: [id: string] }>();

/** Abstand zwischen den Hinweisen und dem Toast darüber, wie zwischen zwei Hinweisen (`--space-6`). */
const ABSTAND_ZUM_TOAST = 6;

const stapel = shallowRef<HTMLElement | null>(null);
const messung =
    typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
              meldeHoehe();
          })
        : undefined;

function meldeHoehe(): void {
    const element = stapel.value;
    hinweiseUnten.value =
        element && !props.platz ? Math.ceil(element.getBoundingClientRect().height) + ABSTAND_ZUM_TOAST : 0;
}

watch(stapel, (neu, alt) => {
    if (alt) messung?.unobserve(alt);
    if (neu) messung?.observe(neu);
    meldeHoehe();
});
watch(() => props.platz, meldeHoehe);
onBeforeUnmount(() => {
    messung?.disconnect();
    hinweiseUnten.value = 0;
});
</script>

<template>
    <section
        v-if="eintraege.length > 0"
        ref="stapel"
        class="freigabe-hinweise"
        :class="platz ? 'freigabe-hinweise--oben' : 'freigabe-hinweise--unten'"
        :style="
            platz
                ? {
                      top: `${String(platz.top)}px`,
                      right: `${String(platz.right)}px`,
                      maxWidth: `min(${String(platz.maxWidth)}px, var(--freigabe-hinweis-max-w))`,
                  }
                : undefined
        "
        :aria-label="t('sperre.freigabe.region')"
        data-testid="freigabe-hinweise"
    >
        <div
            v-for="eintrag in eintraege"
            :key="eintrag.id"
            class="freigabe-hinweis"
            role="status"
            :data-testid="`freigabe-hinweis-${eintrag.id}`"
        >
            <p class="freigabe-hinweis__text" data-testid="freigabe-hinweis-text">
                {{
                    t("sperre.freigabe.hinweis", {
                        wer: eintrag.wer,
                        name: eintrag.name ?? t("sperre.freigabe.objekt"),
                    })
                }}
            </p>
            <p
                v-if="eintrag.stand === 'speichert'"
                class="freigabe-hinweis__klein"
                data-testid="freigabe-hinweis-speichert"
            >
                {{ t("sperre.freigabe.speichert") }}
            </p>
            <p
                v-else-if="eintrag.stand === 'fehler'"
                class="freigabe-hinweis__grund"
                role="alert"
                data-testid="freigabe-hinweis-fehler"
            >
                {{ t("sperre.freigabe.nichtGespeichert", { grund: eintrag.grund ?? "" }) }}
            </p>
            <p v-else class="freigabe-hinweis__klein">
                {{ t("sperre.freigabe.erklaerung", { bis: uhrzeit(eintrag.bis) }) }}
            </p>
            <div class="freigabe-hinweis__knoepfe">
                <AvmKnopf
                    art="gefuellt"
                    groesse="zeile"
                    :gesperrt="eintrag.stand === 'speichert' ? '' : undefined"
                    testid="freigabe-hinweis-freigeben"
                    @click="emit('freigeben', eintrag.id)"
                >
                    {{ t("sperre.freigabe.knopf.freigeben") }}
                </AvmKnopf>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="eintrag.stand === 'speichert' ? '' : undefined"
                    testid="freigabe-hinweis-spaeter"
                    @click="emit('spaeter', eintrag.id)"
                >
                    {{ t("sperre.freigabe.knopf.spaeter") }}
                </AvmKnopf>
            </div>
        </div>
    </section>
</template>

<style scoped>
.freigabe-hinweise {
    --freigabe-hinweis-max-w: 320px;

    position: fixed;
    z-index: var(--z-dialog);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: min(var(--freigabe-hinweis-max-w), calc(100vw - 2 * var(--space-12)));
    box-sizing: border-box;
    /* Die Fläche zwischen den Hinweisen gehört der Karte: Nur die Hinweise selbst nehmen Klicks. */
    pointer-events: none;
}

/* Am Platz des Toasts (`feedback/toast-host.vue`): unten mittig, gleich breit. */
.freigabe-hinweise--unten {
    bottom: var(--space-16);
    left: 50%;
    transform: translateX(-50%);
}

.freigabe-hinweise--oben {
    top: var(--space-12);
    right: var(--space-12);
}

.freigabe-hinweis {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
    pointer-events: auto;
}

.freigabe-hinweis p {
    margin: 0;
}

.freigabe-hinweis__text {
    color: var(--color-text-strong);
}

.freigabe-hinweis__klein,
.freigabe-hinweis__grund {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.freigabe-hinweis__grund {
    color: var(--color-text);
}

.freigabe-hinweis__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    margin-top: var(--space-2);
}
</style>
