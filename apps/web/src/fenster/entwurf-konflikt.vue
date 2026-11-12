<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import type { Bearbeitung, BearbeitungsZustand } from "./bearbeitung";

/**
 * Der Konflikt eines Entwurfs (O3; EDIT-0001 §4.3 Zustand Konflikt, EDIT-0003 §4 „Sperre abgelaufen“), für jeden Editor gleich;
 * verallgemeinert aus `ortseditor/ortseditor-konflikt.vue`, das mit der Umstellung des Ortseditors entfällt. Zwei Gründe, dieselben drei
 * Wege:
 * - **Jemand war schneller** (409): wer, wann, welche Felder er geändert hat, dazu die eigenen.
 * - **Sperre abgelaufen** (oder von einem Admin aufgehoben): Der Entwurf ist noch da; jeder Weg nimmt die Sperre erst neu.
 *
 * „Eigene Änderung anwenden“ geht nur ohne Überschneidung, „Fremden Stand übernehmen“ verwirft den eigenen Entwurf, „Trotzdem
 * überschreiben“ steht als Gefahr. Ein Kasten im Fenster, kein zweites Fenster: Der Entwurf bleibt sichtbar, während man entscheidet.
 */
const props = defineProps<{
    bearbeitung: Pick<Bearbeitung<unknown, unknown, unknown>, "eigeneAnwenden" | "fremdenUebernehmen">;
    konflikt: Extract<BearbeitungsZustand<unknown>, { art: "konflikt" }>;
    /** Der Name eines Felds der Art (`form` für die Form). */
    feldName: (feld: string) => string;
    kennung: string;
}>();

const liste = (felder: readonly string[]): string => felder.map(props.feldName).join(", ");
const wann = computed(() =>
    props.konflikt.wann === undefined
        ? t("entwurf.konflikt.gerade")
        : relativeTime(new Date(props.konflikt.wann), new Date(), locale.value),
);
const titel = computed(() =>
    props.konflikt.grund === "sperre" ? t("entwurf.konflikt.sperreTitel") : t("entwurf.konflikt.titel"),
);
const wer = computed(() => {
    if (props.konflikt.grund === "sperre") return t("entwurf.konflikt.sperre");
    const felder = liste(props.konflikt.fremde);
    return props.konflikt.wer === undefined
        ? t("entwurf.konflikt.jemand", { wann: wann.value, felder })
        : t("entwurf.konflikt.wer", { wer: props.konflikt.wer, wann: wann.value, felder });
});
</script>

<template>
    <section class="konflikt" role="alert" :data-testid="`${kennung}-konflikt`">
        <h4 class="konflikt__titel">{{ titel }}</h4>
        <p class="konflikt__satz">{{ wer }}</p>
        <p class="konflikt__satz konflikt__satz--leise">
            {{ t("entwurf.konflikt.eigene", { felder: liste(konflikt.eigene) }) }}
            {{
                konflikt.beide.length > 0
                    ? t("entwurf.konflikt.beide", { felder: liste(konflikt.beide) })
                    : t("entwurf.konflikt.frei")
            }}
        </p>
        <div class="konflikt__wege">
            <AvmKnopf
                art="gefuellt"
                :gesperrt="konflikt.beide.length > 0 ? t('entwurf.konflikt.anwendenGesperrt') : undefined"
                :testid="`${kennung}-konflikt-anwenden`"
                @click="void bearbeitung.eigeneAnwenden()"
            >
                {{ t("entwurf.konflikt.anwenden") }}
            </AvmKnopf>
            <AvmKnopf :testid="`${kennung}-konflikt-uebernehmen`" @click="void bearbeitung.fremdenUebernehmen()">
                {{ t("entwurf.konflikt.uebernehmen") }}
            </AvmKnopf>
            <AvmKnopf
                art="gefahr"
                :testid="`${kennung}-konflikt-ueberschreiben`"
                @click="void bearbeitung.eigeneAnwenden(true)"
            >
                {{ t("entwurf.konflikt.ueberschreiben") }}
            </AvmKnopf>
        </div>
    </section>
</template>

<style scoped>
.konflikt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
}

.konflikt__titel {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-body);
}

.konflikt__satz {
    margin: 0;
    color: var(--color-text-strong);
}

.konflikt__satz--leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.konflikt__wege {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
}
</style>
