<script setup lang="ts">
import { computed, useId } from "vue";
import { KARTE_TEXT_MAX, type KarteTyp } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import { t } from "../i18n/i18n";
import {
    artOptionen,
    dreiwertOptionen,
    farbOptionen,
    typOptionen,
    type KartenStand,
} from "./medien-karte-bearbeiten-modell";

/**
 * Die Spalte „Angaben“ im Fenster „Neuer Eintrag“ (WI-0287, Entwurf Fassung 5): Art, Typ, Farbe, Zeichner, Verlag, Zeitraum, in der Falte die dreiwertigen Merkmale und die Notiz. Dieselben Felder und
 * Wörter wie der Kasten „Angaben“ (`medien-kasten-karte.vue`); 🔴 „unbekannt“ ist eine eigene Wahl, nie „nein“.
 */
const stand = defineModel<KartenStand>("stand", { required: true });
defineProps<{ befunde: ReadonlyMap<string, string>; gesperrt: boolean }>();

const id = useId();
const typen = computed(() => typOptionen());
const MERKMALE = [
    ["offiziell", "catalog.citymaps.fact.official"],
    ["beschriftet", "catalog.citymaps.fact.labeled"],
    ["mehrstoeckig", "catalog.citymaps.fact.multilevel"],
    ["massstab", "catalog.citymaps.fact.scale"],
    ["spoiler", "catalog.citymaps.filter.spoiler"],
] as const;

function schalteTyp(typ: KarteTyp, an: boolean): void {
    const ohne = stand.value.typen.filter((eintrag) => eintrag !== typ);
    stand.value.typen = an ? [...ohne, typ] : ohne;
}
</script>

<template>
    <fieldset class="eintrag-angaben" :disabled="gesperrt" data-testid="medien-eintrag-angaben">
        <legend>{{ t("medien.karten.abschnitt.angaben") }}</legend>
        <div class="eintrag-angaben__zeilen">
            <label :for="`${id}-art`">{{ t("catalog.citymaps.fact.art") }}</label>
            <AvmAuswahl :id="`${id}-art`" v-model="stand.art" :optionen="artOptionen()" testid="medien-eintrag-art" />

            <span class="eintrag-angaben__beschriftung">{{ t("catalog.citymaps.fact.types") }}</span>
            <span class="eintrag-angaben__typen" data-testid="medien-eintrag-typen">
                <AvmKaestchen
                    v-for="typ in typen"
                    :key="typ.wert"
                    art="checkbox"
                    :checked="stand.typen.includes(typ.wert)"
                    :testid="`medien-eintrag-typ-${typ.wert}`"
                    @change="schalteTyp(typ.wert, $event)"
                    >{{ typ.text }}</AvmKaestchen
                >
            </span>

            <label :for="`${id}-farbe`">{{ t("catalog.citymaps.fact.colour") }}</label>
            <AvmAuswahl
                :id="`${id}-farbe`"
                v-model="stand.farbe"
                :optionen="farbOptionen()"
                testid="medien-eintrag-farbe"
            />

            <label :for="`${id}-zeichner`">{{ t("catalog.citymaps.fact.author") }}</label>
            <span class="eintrag-angaben__wert">
                <AvmEingabe
                    :id="`${id}-zeichner`"
                    v-model="stand.zeichner"
                    :maxlength="KARTE_TEXT_MAX.author"
                    :ungueltig="befunde.has('zeichner')"
                    testid="medien-eintrag-zeichner"
                />
                <span v-if="befunde.get('zeichner')" class="eintrag-angaben__befund">{{
                    befunde.get("zeichner")
                }}</span>
            </span>

            <label :for="`${id}-verlag`">{{ t("catalog.citymaps.fact.publisher") }}</label>
            <span class="eintrag-angaben__wert">
                <AvmEingabe
                    :id="`${id}-verlag`"
                    v-model="stand.verlag"
                    :maxlength="KARTE_TEXT_MAX.publisher"
                    :ungueltig="befunde.has('verlag')"
                    testid="medien-eintrag-verlag"
                />
                <span v-if="befunde.get('verlag')" class="eintrag-angaben__befund">{{ befunde.get("verlag") }}</span>
            </span>

            <span class="eintrag-angaben__beschriftung">{{ t("medien.karten.eintrag.gueltig") }}</span>
            <span class="eintrag-angaben__wert">
                <span class="eintrag-angaben__jahre">
                    <AvmEingabe
                        v-model="stand.ab"
                        :aria-label="t('medien.karten.eintrag.abBf')"
                        :placeholder="t('medien.karten.eintrag.abBf')"
                        :ungueltig="befunde.has('ab')"
                        testid="medien-eintrag-ab"
                    />
                    <span>{{ t("medien.karten.eintrag.bis") }}</span>
                    <AvmEingabe
                        v-model="stand.bis"
                        :aria-label="t('medien.karten.eintrag.bisBf')"
                        :placeholder="t('medien.karten.eintrag.bisBf')"
                        :ungueltig="befunde.has('bis')"
                        testid="medien-eintrag-bis"
                    />
                </span>
                <span v-if="befunde.get('ab') ?? befunde.get('bis')" class="eintrag-angaben__befund">{{
                    befunde.get("ab") ?? befunde.get("bis")
                }}</span>
            </span>
        </div>

        <details class="eintrag-angaben__falte">
            <summary>{{ t("medien.karten.eintrag.weitere") }}</summary>
            <div class="eintrag-angaben__zeilen">
                <template v-for="[feld, wort] in MERKMALE" :key="feld">
                    <label :for="`${id}-${feld}`">{{ t(wort) }}</label>
                    <AvmAuswahl
                        :id="`${id}-${feld}`"
                        v-model="stand[feld]"
                        :optionen="dreiwertOptionen()"
                        :testid="`medien-eintrag-${feld}`"
                    />
                </template>
                <label :for="`${id}-notiz`">{{ t("medien.karten.eintrag.notiz") }}</label>
                <span class="eintrag-angaben__wert">
                    <AvmEingabe
                        :id="`${id}-notiz`"
                        v-model="stand.notiz"
                        :maxlength="KARTE_TEXT_MAX.note"
                        :ungueltig="befunde.has('notiz')"
                        testid="medien-eintrag-notiz"
                    />
                    <span v-if="befunde.get('notiz')" class="eintrag-angaben__befund">{{ befunde.get("notiz") }}</span>
                </span>
            </div>
        </details>
    </fieldset>
</template>

<style scoped>
/* Wie die Gruppen des Hochladefensters (`medien-hochladen.vue`). */
.eintrag-angaben {
    min-width: 0;
    margin: 0;
    padding: var(--space-6) var(--space-10) var(--space-10);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
}

.eintrag-angaben > legend {
    padding: 0 var(--space-4);
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

.eintrag-angaben__zeilen {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6) var(--space-8);
}

.eintrag-angaben__zeilen > label,
.eintrag-angaben__beschriftung {
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.eintrag-angaben__wert {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.eintrag-angaben__befund {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.eintrag-angaben__typen {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: var(--space-2) var(--space-6);
    font-size: var(--font-size-small);
}

.eintrag-angaben__jahre {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
}

.eintrag-angaben__falte {
    margin-top: var(--space-6);
}

.eintrag-angaben__falte > summary {
    margin-bottom: var(--space-4);
    color: var(--color-accent-strong);
    cursor: pointer;
    font-size: var(--font-size-small);
}

.eintrag-angaben__falte > summary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
