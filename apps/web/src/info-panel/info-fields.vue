<script setup lang="ts">
import { loreSwitchKey, type SubjectRef } from "@avesmaps3d/shared";
import { ref, watch } from "vue";
import AvmText from "../controls/avm-text.vue";
import { t } from "../i18n/i18n";
import InlineListToggle from "../route-planner/inline-list-toggle.vue";
import { ausgeblendet } from "../system/inhaltsstand";
import { pausiertSatz } from "../system/inhaltsstand-text";
import { editorSektionen } from "./panel-section-load";
import InfoLid from "./info-lid.vue";
import InfoLink from "./info-link.vue";
import InfoLoreRow from "./info-lore-row.vue";
import { withTrailingPunctuation } from "./panel-text";
import type { RowModel } from "./panel-types";

/**
 * Die Feldliste (Design Guide §16, Legacy `.region-info-box__row`): Beschriftung 96 px links, der Wert füllt, EINE Abstandszahl für alle
 * Zeilen (`--space-10`) - bei Legacy waren es einmal vier verschiedene, weil der Deckel sein eigenes Polster aufaddierte.
 *
 * 🔴 Die Tabellenform gilt in jeder Breite (Legacy, Betreiber 2026-08-12): Wird es eng, wird die Beschriftungsspalte schmaler, die Zeile
 * wird nie flach gelegt. Ein langer Wert bricht innerhalb seiner Spalte um - seit WI-0088 P3 mit Silbentrennung, auch in einem Namen
 * (Betreiber 2026-10-06: „und kannst du auf deutsche silbentrennung achten - auch bei links“, am Beispiel „Westliches Vorgebirge des
 * Raschtulswalls“). Das ersetzt Legacys `hyphens: manual` und die Begründung „ein falscher Strich macht aus einem Namen ein anderes
 * Wort“: Die Alternative war nicht der ungebrochene Name, sondern `overflow-wrap: anywhere` - ein Bruch mitten im Wort OHNE Strich,
 * an dem niemand sieht, dass es weitergeht. Die Regel steht in der erzeugten `styles/canon.css`, nicht hier.
 *
 * Eine Zeile entsteht nur mit Inhalt - die Liste, die der Aufrufer baut, enthält keine leere (WI-0063 5.3). Werte mit Verweisen
 * (Verkehrswege mit Linkzielen, Hauptstadt und jedes Teilstück, dessen Linkziel über den Wiki-Key genau ein Objekt der Karte trägt: WI-0063 27.12) sind Links; ein langer Verlauf steht im Deckel, seine
 * Stationen mit Verweis sind Links. Die Beschreibung über den ersten Satz hinaus steht hinter
 * derselben runden „…“-Pille wie die Landschaften einer Etappe (Guide §16 Planer; Betreiber 2026-10-04: „mit der (...) Pille nach dem
 * ersten satz den text verbergen“); „«“ kürzt sie wieder. Ein anderes Subject beginnt zugeklappt.
 *
 * Blendet ein Inhaltsschalter eine Vorkommensart aus (WI-0127 SYS-10, `panel.lore.<art>`), steht in ihrer Zeile der Satz („Fauna ist
 * gerade ausgeblendet.“) statt des Deckels; die Zeile bleibt, damit das Panel nicht springt.
 */
const props = defineProps<{
    rows: RowModel[];
    /** In einem Abschnitt (`info-section.vue`): Der Abschnitt bringt das seitliche Polster schon mit. */
    embedded?: boolean;
}>();
const emit = defineEmits<{ open: [ref: SubjectRef] }>();

/** Ein Editor sieht eine ausgeblendete Vorkommensart echt, mit dem Vermerk „öffentlich ausgeblendet“ (WI-0127 SYS-11). */
const editorSicht = editorSektionen();

const opened = ref(new Set<string>());
watch(
    () => props.rows,
    () => {
        opened.value = new Set();
    },
);

function toggle(key: string): void {
    const next = new Set(opened.value);
    if (!next.delete(key)) next.add(key);
    opened.value = next;
}
</script>

<template>
    <dl
        v-if="rows.length > 0"
        class="info-fields"
        :class="{ 'is-embedded': embedded === true }"
        data-testid="info-facts"
    >
        <div v-for="row in rows" :key="row.key" class="info-fields__row" :data-field="row.key" data-testid="info-fact">
            <dt data-testid="info-fact-label">{{ row.label }}</dt>
            <dd data-testid="info-fact-value">
                <template v-if="row.value.kind === 'text'">{{ row.value.text }}</template>
                <!-- Eine Messangabe nach der Klappbox-Regel (Guide §16.3): die Zahl hell, die Einheit gedämpft; sonst bleibt die Zeile, wie sie ist. -->
                <AvmText v-else-if="row.value.kind === 'measure'" :text="row.value.text" rolle="titel" />
                <template v-else-if="row.value.kind === 'parts'">
                    <template v-for="(part, at) in withTrailingPunctuation(row.value.parts)" :key="at">
                        <!-- Eine Liste mit langen Einträgen steht Zeile für Zeile: Ein Link, der selbst umbricht, füllt die Breite, ein Komma danach stünde allein in der nächsten. -->
                        <br v-if="part.breakBefore === true" />
                        <!-- „Umstritten mit“: das Kästchen in der Farbe, in der das Gebiet auf der Karte steht, steht VOR dem Namen. -->
                        <span
                            v-if="part.swatch !== undefined"
                            class="info-fields__swatch"
                            :style="{ background: part.swatch }"
                            aria-hidden="true"
                            data-testid="info-swatch"
                        ></span>
                        <InfoLink v-if="part.ref !== undefined" :tail="part.tail" @open="emit('open', part.ref)">{{
                            part.text
                        }}</InfoLink>
                        <template v-else>{{ part.text }}</template>
                        <!-- „In der Nähe“: Die Nadel zeigt die echte Peilung (0 = Norden), das Wort steht für den Bildschirmleser und als Hinweis. -->
                        <span
                            v-if="part.bearing !== undefined"
                            class="info-fields__dir"
                            :style="{ '--info-dir': `${String(part.bearing.degrees)}deg` }"
                            role="img"
                            :aria-label="part.bearing.label"
                            :title="part.bearing.label"
                            data-testid="info-bearing"
                            ><svg viewBox="-7 -7 14 14" aria-hidden="true" focusable="false">
                                <path d="M0,-6 L3.8,5.2 L0,2.8 L-3.8,5.2 Z" /></svg
                        ></span>
                    </template>
                </template>
                <!--
                    Eine Vorkommenszeile (WI-0091): derselbe Deckel wie der Verlauf, aber sein Inhalt kommt erst beim Aufklappen -
                    bei im Median 47 und bis zu 256 Einträgen je Ort gehört die Liste nicht in die Detailantwort.
                -->
                <span
                    v-else-if="
                        row.value.kind === 'lore' && !editorSicht && ausgeblendet(loreSwitchKey(row.value.loreKind))
                    "
                    class="info-fields__paused"
                    data-testid="info-lore-paused"
                    >{{ pausiertSatz(loreSwitchKey(row.value.loreKind)) }}</span
                >
                <template v-else-if="row.value.kind === 'lore'">
                    <InfoLoreRow :value="row.value" @open="emit('open', $event)" />
                    <span
                        v-if="editorSicht && ausgeblendet(loreSwitchKey(row.value.loreKind))"
                        class="info-fields__paused"
                        data-testid="info-lore-public-hidden"
                        >{{ t("inhalt.oeffentlichAusgeblendet") }}</span
                    >
                </template>
                <!--
                    Die Zeile „Stätten" (WI-0109): DASSELBE Bauteil - Deckel, Gruppenköpfe und Register sind die der Vorkommen
                    (Legacys eigene Ansage: eine dritte Rezeptur für „Liste von Namen in einer Klappzeile" wäre die Divergenz).
                -->
                <InfoLoreRow
                    v-else-if="row.value.kind === 'staetten' || row.value.kind === 'sprachTreffer'"
                    :value="row.value"
                    @open="emit('open', $event)"
                />
                <template v-else-if="row.value.kind === 'more'"
                    ><span data-testid="info-fact-text">{{
                        opened.has(row.key) ? row.value.full : row.value.text
                    }}</span
                    >{{ " "
                    }}<InlineListToggle
                        data-testid="info-fact-more"
                        :expanded="opened.has(row.key)"
                        :label="t(opened.has(row.key) ? 'infoPanel.more.hide' : 'infoPanel.more.show')"
                        @toggle="toggle(row.key)"
                /></template>
                <InfoLid v-else :count="row.value.count" :unit="row.value.unit" :preview="row.value.preview">
                    <!-- Stationen, die Objekte der Karte sind, sind Links (WI-0063 27.12); die Vorschau auf dem Knopf bleibt Text. -->
                    <template v-if="row.value.fullParts !== undefined">
                        <template v-for="(part, at) in withTrailingPunctuation(row.value.fullParts)" :key="at">
                            <br v-if="part.breakBefore === true" />
                            <InfoLink v-if="part.ref !== undefined" :tail="part.tail" @open="emit('open', part.ref)">{{
                                part.text
                            }}</InfoLink>
                            <template v-else>{{ part.text }}</template>
                        </template>
                    </template>
                    <template v-else>{{ row.value.full }}</template>
                </InfoLid>
            </dd>
        </div>
    </dl>
</template>

<style scoped>
.info-fields {
    display: grid;
    gap: var(--space-10);
    margin: 0;
    padding: var(--space-10) var(--info-pad-x);
}

/* Im Abschnitt trägt der Abschnitt das Polster (oben wie seitlich); die Liste steht bündig darin. */
.info-fields.is-embedded {
    padding: 0;
}

.info-fields__row {
    display: grid;
    grid-template-columns: var(--avesmaps-infopanel-label-w) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-6);
    min-width: 0;
}

.info-fields__row dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.info-fields__row dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

/*
 * Legacy `createRegionContestedSwatchMarkup`: ein kleines Kästchen (Legacy 9 px mit Radius 2 als Literal; hier die Sprosse `space-6`,
 * 8 px, mit dem halben `radius-sm`) in der Farbe des Gebiets - die kommt aus den Daten, kein Literal. Ein Zeichen, kein Rahmenkasten.
 */
/* Der Satz einer ausgeblendeten Vorkommensart (WI-0127 SYS-10): gedämpft wie eine Auskunft, nicht wie ein Wert. */
.info-fields__paused {
    color: var(--color-text-muted);
}

.info-fields__swatch {
    display: inline-block;
    width: var(--space-6);
    height: var(--space-6);
    margin-right: var(--space-2);
    border-radius: calc(var(--radius-sm) / 2);
    vertical-align: baseline;
}

/* Legacy `.avesmaps-near__dir`: eine Nadel in der Größe der Zeile, gedämpft, gedreht um die Peilung. Ohne Eigenschaft eine Nadel nach Norden. */
.info-fields__dir {
    display: inline-block;
    width: 1em;
    height: 1em;
    margin-left: var(--space-2);
    color: var(--color-text-muted);
    vertical-align: -0.1em;
    transform: rotate(var(--info-dir, 0deg));
}

.info-fields__dir svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: currentColor;
}
</style>
