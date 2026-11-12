<script setup lang="ts">
import type { NewsEintragVoll } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import { t } from "../i18n/i18n";
import { rubrikName } from "./news";
import { herkunftSchluessel, kreisVon, tagText } from "./pflege";

/**
 * Eine Neuigkeit in der Pflege (WI-0139 N6, WI-0217): Kopf mit Datum, Rubrik, Herkunft und Marken, Titel, Text und die Knöpfe.
 *
 * - **Versteckt fällt auf** (Betreiber 2026-10-17: „kann man versteckte schraffieren oder so`das versteckt is etwas unscheinbar“): Die
 *   Zeile liegt schraffiert und gestrichelt umrandet da, Titel und Text gedämpft, im Kopf die lila Marke „versteckt“, dieselbe Farbe wie
 *   „Verborgen“ im Infopanel (`--color-pill-hidden`).
 * - **„nur Stage“** in den Farben der Warnung: Der nächste Production-Zug ersetzt diesen Eintrag (WI-0217).
 * - **Löschen** steht rechts abgesetzt: Es legt den Eintrag in den Papierkorb, gelöscht wird nie (WI-0139).
 */
const props = defineProps<{
    eintrag: NewsEintragVoll;
    gesperrt: boolean;
}>();
const emit = defineEmits<{
    zustand: [zustand: "sichtbar" | "versteckt"];
    bearbeiten: [];
    loeschen: [];
}>();
</script>

<template>
    <li
        class="zeile"
        :class="{ 'is-versteckt': props.eintrag.zustand === 'versteckt' }"
        :data-testid="`news-pflege-${String(props.eintrag.id)}`"
    >
        <AvmKreis :fuellung="kreisVon(props.eintrag)" :name="t(`admin.news.state.${props.eintrag.zustand}`)" />
        <div class="zeile__rumpf">
            <div class="zeile__kopf">
                <span class="zeile__datum">{{ tagText(props.eintrag.datum) }}</span>
                <span v-if="rubrikName(props.eintrag.rubrik) !== null" class="marke">{{
                    rubrikName(props.eintrag.rubrik)
                }}</span>
                <span>{{
                    t(`admin.news.from.${herkunftSchluessel(props.eintrag)}`, { name: props.eintrag.herkunft })
                }}</span>
                <span v-if="props.eintrag.beitrag" class="marke" data-testid="news-aus-beitrag">{{
                    t("community.social.news.aus", { nummer: props.eintrag.beitrag })
                }}</span>
                <span v-if="props.eintrag.zustand === 'versteckt'" class="marke marke--versteckt">{{
                    t("admin.news.state.versteckt")
                }}</span>
                <span v-if="props.eintrag.nurStage" class="marke marke--stage" data-testid="news-nur-stage">{{
                    t("admin.news.mark.stageOnly")
                }}</span>
            </div>
            <span class="zeile__titel">{{ props.eintrag.titel }}</span>
            <p class="zeile__text">{{ props.eintrag.text }}</p>
            <span class="zeile__knoepfe">
                <AvmKnopf
                    v-if="props.eintrag.zustand === 'entwurf'"
                    groesse="zeile"
                    art="gefuellt"
                    :gesperrt="props.gesperrt ? '' : undefined"
                    testid="news-freigeben"
                    @click="emit('zustand', 'sichtbar')"
                    >{{ t("admin.news.publish") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="props.eintrag.zustand === 'versteckt'"
                    groesse="zeile"
                    :gesperrt="props.gesperrt ? '' : undefined"
                    testid="news-zeigen"
                    @click="emit('zustand', 'sichtbar')"
                    >{{ t("admin.news.show") }}</AvmKnopf
                >
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="props.gesperrt ? '' : undefined"
                    testid="news-bearbeiten"
                    @click="emit('bearbeiten')"
                    >{{ t("admin.news.edit") }}</AvmKnopf
                >
                <AvmKnopf
                    v-if="props.eintrag.zustand === 'sichtbar'"
                    groesse="zeile"
                    art="gefahr"
                    :gesperrt="props.gesperrt ? '' : undefined"
                    testid="news-verstecken"
                    @click="emit('zustand', 'versteckt')"
                    >{{ t("admin.news.hide") }}</AvmKnopf
                >
                <AvmKnopf
                    class="zeile__loeschen"
                    groesse="zeile"
                    art="gefahr"
                    :gesperrt="props.gesperrt ? '' : undefined"
                    testid="news-loeschen"
                    @click="emit('loeschen')"
                    >{{ t("admin.news.delete") }}</AvmKnopf
                >
            </span>
        </div>
    </li>
</template>

<style scoped>
.zeile {
    display: flex;
    gap: var(--space-6);
    align-items: flex-start;
    list-style: none;
}

.zeile.is-versteckt {
    margin-inline: calc(-1 * var(--space-8));
    padding: var(--space-6) var(--space-8);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: repeating-linear-gradient(
        135deg,
        var(--color-muted-halo) 0 var(--space-2),
        transparent var(--space-2) var(--space-10)
    );
}

.zeile__rumpf {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.zeile__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.zeile__datum {
    font-variant-numeric: tabular-nums;
}

.marke {
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    background: var(--color-pill);
    color: var(--color-pill-text);
}

.marke--versteckt {
    border-color: var(--color-pill-hidden);
    background: var(--color-pill-hidden);
    color: var(--color-pill-hidden-text);
}

.marke--stage {
    border-color: var(--color-warning-soft-border);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

.zeile__titel {
    color: var(--color-text-strong);
}

.zeile.is-versteckt .zeile__titel,
.zeile.is-versteckt .zeile__text {
    color: var(--color-text-muted);
}

.zeile__text {
    margin: 0;
    color: var(--color-text);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
    /* Wie im Fenster: Legacys Umbrüche bleiben, sonst läse sich die Vorschau anders als das Ergebnis. */
    white-space: pre-line;
}

.zeile__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-top: var(--space-2);
}

.zeile__loeschen {
    margin-left: auto;
}
</style>
