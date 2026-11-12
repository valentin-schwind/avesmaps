<script setup lang="ts">
import { computed } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { vorgegebeneFelder } from "./inhalte-korpora-modell";
import type { KorporaSteuerung } from "./inhalte-korpora-steuerung";
import { vorgabeNamen } from "./inhalte-korpora-texte";

/**
 * Spalte 3 des Reiters „Korpora“ (WI-0254, Runde 4; Mockup): die Quellen der Domain, höchstens 300 nach Titel. Es gibt keine eigene Zuordnungstabelle: Jede
 * Adresse hat ihre eigene Quellenidentität, die registrierbare Domain bestimmt den Korpus. Eine Quelle zieht um oder fällt heraus nur durch eine Änderung
 * ihrer Adresse, nie durch ein Häkchen.
 *
 * - **Je Quelle:** Titel und Adresse, die Art, die Zahl der Verwendungen und, wo der Korpus etwas vorgibt (Belegstelle), ob die Quelle der Vorgabe folgt oder in
 *   welchen Feldern sie abweicht. „Eigene Felder“ je Quelle gibt es nicht (Vali: „überall heißt überall“).
 * - **Öffnen** springt in den Reiter Quellen und wählt die Quelle (mit der Frage, wenn dort Änderungen stehen).
 * - Die Spalte zeigt den gespeicherten Stand der Quellen; die Wirkung eines Entwurfs steht in der Mitte unter „Wirkung prüfen“.
 */
const props = defineProps<{
    steuerung: KorporaSteuerung;
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: []; oeffneQuelle: [sourceId: string] }>();

const s = props.steuerung;
const korpus = computed(() => s.korpus.value);
const gibtVor = computed(() => (korpus.value === undefined ? [] : vorgegebeneFelder(korpus.value)));
const abgeschnitten = computed(() =>
    Math.max(0, (korpus.value?.quellenGesamt ?? 0) - (korpus.value?.quellen.length ?? 0)),
);
const zahl = (n: number): string => formatNumber(n, 0);
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="t('inhalte.korpora.quellen.titel') + (korpus ? ` (${zahl(korpus.quellenGesamt)})` : '')"
        :unterzeile="korpus ? t('inhalte.korpora.quellen.unterzeile') : undefined"
        testid="inhalte-spalte-korpusquellen"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-zurueck-stamm" @click="emit('zurueck')">{{
                t("inhalte.zurueck.stamm")
            }}</AvmKnopf>
        </template>

        <p v-if="!korpus" class="quellen__leise" data-testid="inhalte-korpusquellen-leer">
            {{ t("inhalte.korpora.stamm.leer") }}
        </p>

        <template v-else>
            <AvmHinweis testid="inhalte-korpusquellen-hinweis">{{ t("inhalte.korpora.quellen.hinweis") }}</AvmHinweis>

            <ul v-if="korpus.quellen.length > 0" class="quellen__karten" data-testid="inhalte-korpusquellen-liste">
                <li v-for="quelle in korpus.quellen" :key="quelle.id" class="karte" data-testid="inhalte-korpusquelle">
                    <div class="karte__kopf">
                        <div class="karte__haupt">
                            <span class="karte__titel">{{
                                quelle.title === "" ? t("inhalte.ohneTitel") : quelle.title
                            }}</span>
                            <span v-if="quelle.url" class="karte__adresse">{{ quelle.url }}</span>
                        </div>
                        <AvmKnopf
                            groesse="zeile"
                            testid="inhalte-korpusquelle-oeffnen"
                            @click="emit('oeffneQuelle', quelle.id)"
                        >
                            {{ t("inhalte.korpora.quellen.oeffnen") }} ↗
                        </AvmKnopf>
                    </div>
                    <div class="karte__chips">
                        <AvmPille>{{ t(`infoPanel.sourceType.${quelle.sourceType}` as MessageKey) }}</AvmPille>
                        <AvmPille>{{ t("inhalte.korpora.quellen.verwendungen", { n: zahl(quelle.uses) }) }}</AvmPille>
                        <template v-if="gibtVor.length > 0">
                            <AvmPille
                                v-if="quelle.abweichend.length === 0"
                                ton="erfolg"
                                testid="inhalte-korpusquelle-folgt"
                                >{{ t("inhalte.korpora.quellen.folgt") }}</AvmPille
                            >
                            <AvmPille v-else ton="warnung" testid="inhalte-korpusquelle-weicht">{{
                                t("inhalte.korpora.quellen.weicht", { felder: vorgabeNamen(quelle.abweichend) })
                            }}</AvmPille>
                        </template>
                    </div>
                </li>
            </ul>
            <p v-else class="quellen__leise" data-testid="inhalte-korpusquellen-keine">
                {{ t("inhalte.korpora.quellen.keine") }}
            </p>
            <p v-if="abgeschnitten > 0" class="quellen__leise" data-testid="inhalte-korpusquellen-mehr">
                {{ t("inhalte.korpora.quellen.abgeschnitten", { n: zahl(abgeschnitten) }) }}
            </p>

            <AvmHinweis>{{ t("inhalte.korpora.quellen.wirkung") }}</AvmHinweis>
        </template>
    </FensterSpalte>
</template>

<style scoped>
.quellen__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.quellen__karten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.karte {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.karte__kopf {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-8);
}

.karte__haupt {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.karte__titel {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.karte__adresse {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    overflow-wrap: anywhere;
}

.karte__chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}
</style>
