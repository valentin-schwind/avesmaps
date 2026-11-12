<script setup lang="ts">
import { computed } from "vue";
import { SOURCE_TYPES, type SourceType } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import type { QuellePerLink } from "./quelle-per-link-steuerung";

/**
 * Was unter dem Feld „＋ Quelle“ steht, wenn darin ein Link steht (WI-0277): der Befund und, bei einer neuen Seite, Titel und die Angaben des Korpus. Das Bauteil rechnet nichts (`quelle-per-link-steuerung.ts`);
 * der Knopf ist der des Felds, Enter wirkt auch im Titel.
 *
 * - **Was vom Korpus kommt, steht nur da**, nicht als Feld: Es gilt für alle Quellen der Domain und ändert sich im Reiter „Korpora“. Wo er nichts vorgibt (kein Korpus oder ein Korpus aus Werken), sind Art und „offiziell“ wählbar.
 * - **Fremder Text** (Titel der Seite, Name einer vorhandenen Quelle) steht als Wert eines Felds oder als Text, nie als Markup.
 */
const props = defineProps<{
    link: QuellePerLink;
    schonDa: (sourceId: string) => boolean;
    gesperrt?: string | undefined;
    /** Die Kennung für die Testkennungen (`<kennung>-quelle-link`, …). */
    kennung: string;
}>();
const emit = defineEmits<{ bestaetige: [] }>();

const kennungVon = (rest: string): string => `${props.kennung}-${rest}`;
const artText = (art: SourceType): string => t(`infoPanel.sourceType.${art}` as MessageKey);

const a = computed(() => props.link.auskunft.value);
const vorhanden = computed(() => a.value?.vorhanden ?? undefined);
const korpus = computed(() => a.value?.korpus ?? undefined);
/** Die Felder einer neuen Quelle stehen, sobald die Prüfung durch ist, auch wenn sie scheiterte. */
const neu = computed(() => !props.link.prueft.value && vorhanden.value === undefined);
const artFrei = computed(() => korpus.value?.sourceType === undefined || korpus.value.sourceType === null);
const offiziellFrei = computed(() => korpus.value?.isOfficial === undefined || korpus.value.isOfficial === null);
const artOptionen = computed(() => SOURCE_TYPES.map((art) => ({ wert: art, text: artText(art) })));
const lizenz = computed(() => {
    const k = korpus.value;
    if (k === undefined) return "";
    if (k.lizenzName !== null) return k.lizenzName;
    return k.lizenzAussage === "public_domain"
        ? t("quellen.link.lizenz.frei")
        : k.lizenzAussage === "unfree"
          ? t("quellen.link.lizenz.unfrei")
          : t("inhalte.lizenz.nichtErfasst");
});

/** Der Satz zum Stand der Prüfung und sein Ton: Nur ein Link, der nicht antwortet, ist eine Warnung; am Anlegen hindert keiner. */
const befund = computed<{ satz: string; ton: "neutral" | "warnung" } | undefined>(() => {
    if (props.link.prueft.value) return undefined;
    if (props.link.pruefFehler.value) return { satz: t("quellen.link.pruefFehler"), ton: "warnung" };
    const auskunft = a.value;
    if (auskunft === undefined) return undefined;
    switch (auskunft.zustand) {
        case "bekannt": {
            const v = auskunft.vorhanden;
            if (v === null) return undefined;
            const titel = v.title;
            if (v.stillgelegt) return { satz: t("quellen.link.bekannt.still", { titel }), ton: "warnung" };
            if (props.schonDa(v.id)) return { satz: t("quellen.link.bekannt.schonDa", { titel }), ton: "neutral" };
            return { satz: t("quellen.link.bekannt", { titel }), ton: "neutral" };
        }
        case "gelesen":
            return { satz: t("quellen.link.gelesen"), ton: "neutral" };
        case "erreichbar":
            return { satz: t("quellen.link.erreichbar"), ton: "neutral" };
        case "unerreichbar":
            return {
                satz:
                    auskunft.httpStatus === undefined
                        ? t("quellen.link.unerreichbar")
                        : t("quellen.link.unerreichbar.status", { status: String(auskunft.httpStatus) }),
                ton: "warnung",
            };
        case "nicht_geprueft":
            return { satz: t("quellen.link.nichtGeprueft"), ton: "warnung" };
    }
    return undefined;
});
const kannErneut = computed(
    () =>
        !props.link.prueft.value &&
        (props.link.pruefFehler.value || a.value?.zustand === "unerreichbar" || a.value?.zustand === "erreichbar"),
);
</script>

<template>
    <div class="qpl" :data-testid="kennungVon('quelle-link')">
        <p v-if="link.prueft.value" class="qpl__leise" role="status" :data-testid="kennungVon('quelle-link-prueft')">
            {{ t("quellen.link.prueft") }}
        </p>
        <div v-if="befund" class="qpl__befund">
            <AvmHinweis :ton="befund.ton" rolle="status" :testid="kennungVon('quelle-link-befund')">
                {{ befund.satz }}
            </AvmHinweis>
            <AvmKnopf
                v-if="kannErneut"
                groesse="zeile"
                :aria-label="t('quellen.link.erneut')"
                :title="t('quellen.link.erneut')"
                :testid="kennungVon('quelle-link-erneut')"
                @click="link.pruefeErneut()"
            >
                ↻
            </AvmKnopf>
        </div>
        <p
            v-if="vorhanden && !vorhanden.gleicheAdresse"
            class="qpl__leise qpl__adresse"
            :data-testid="kennungVon('quelle-link-andere')"
        >
            {{ t("quellen.link.bekannt.andereAdresse", { url: vorhanden.url }) }}
        </p>
        <p v-if="vorhanden" class="qpl__leise" :data-testid="kennungVon('quelle-link-vorhanden')">
            {{ artText(vorhanden.sourceType) }} ·
            {{ t("quellen.link.bekannt.verwendet", { n: formatNumber(vorhanden.uses, 0) }) }}
        </p>
        <template v-if="neu">
            <label class="qpl__feld">
                <span class="qpl__name">{{ t("inhalte.neu.titel") }}</span>
                <AvmEingabe
                    :model-value="link.titel.value"
                    :placeholder="t('inhalte.neu.titel.platzhalter')"
                    :gesperrt="gesperrt"
                    :testid="kennungVon('quelle-link-titel')"
                    @update:model-value="(wert: string) => link.setzeTitel(wert)"
                    @keydown.enter.prevent="emit('bestaetige')"
                />
            </label>
            <dl v-if="korpus" class="qpl__korpus" :data-testid="kennungVon('quelle-link-korpus')">
                <div class="qpl__zeile">
                    <dt class="qpl__name">{{ t("quellen.link.korpus") }}</dt>
                    <dd>
                        {{ korpus.name === korpus.key ? korpus.key : `${korpus.name} (${korpus.key})` }} ·
                        {{
                            t("quellen.link.korpus.zahlen", {
                                quellen: formatNumber(korpus.quellen, 0),
                                objekte: formatNumber(korpus.objekte, 0),
                            })
                        }}
                    </dd>
                </div>
                <div v-if="korpus.sourceType" class="qpl__zeile">
                    <dt class="qpl__name">{{ t("quellen.link.art") }}</dt>
                    <dd :data-testid="kennungVon('quelle-link-korpus-art')">{{ artText(korpus.sourceType) }}</dd>
                </div>
                <div class="qpl__zeile">
                    <dt class="qpl__name">{{ t("quellen.link.lizenz") }}</dt>
                    <dd :data-testid="kennungVon('quelle-link-korpus-lizenz')">{{ lizenz }}</dd>
                </div>
                <div v-if="korpus.attribution" class="qpl__zeile">
                    <dt class="qpl__name">{{ t("quellen.link.nennung") }}</dt>
                    <dd>{{ korpus.attribution }}</dd>
                </div>
                <div v-if="korpus.isOfficial !== null" class="qpl__zeile">
                    <dt class="qpl__name">{{ t("quellen.link.offiziell") }}</dt>
                    <dd>{{ korpus.isOfficial ? t("quellen.link.ja") : t("quellen.link.nein") }}</dd>
                </div>
            </dl>
            <p v-if="korpus?.rechteAusBestand" class="qpl__leise" :data-testid="kennungVon('quelle-link-bestand')">
                {{ t("quellen.link.korpus.bestand") }}
            </p>
            <p v-if="a && !korpus" class="qpl__leise" :data-testid="kennungVon('quelle-link-ohne-korpus')">
                {{ t("quellen.link.korpus.keiner") }}
            </p>
            <label v-if="artFrei" class="qpl__feld">
                <span class="qpl__name">{{ t("quellen.link.art") }}</span>
                <AvmAuswahl
                    :model-value="link.art.value"
                    groesse="zeile"
                    :optionen="artOptionen"
                    :gesperrt="gesperrt"
                    :testid="kennungVon('quelle-link-art')"
                    @update:model-value="(wert: string) => link.setzeArt(wert as SourceType)"
                />
            </label>
            <AvmKaestchen
                v-if="offiziellFrei"
                art="checkbox"
                :checked="link.offiziell.value"
                :gesperrt="gesperrt"
                :testid="kennungVon('quelle-link-offiziell')"
                @change="(an: boolean) => link.setzeOffiziell(an)"
            >
                {{ t("quellen.link.offiziell") }}
            </AvmKaestchen>
        </template>
        <AvmHinweis v-if="link.fehler.value" ton="gefahr" rolle="alert" :testid="kennungVon('quelle-link-fehler')">
            {{ link.fehler.value }}
        </AvmHinweis>
    </div>
</template>

<style scoped>
.qpl {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.qpl__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.qpl__adresse {
    overflow-wrap: anywhere;
}

.qpl__befund {
    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
}

.qpl__befund > :first-child {
    flex: 1 1 auto;
    min-width: 0;
}

.qpl__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.qpl__name {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.qpl__korpus {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
}

.qpl__zeile {
    display: grid;
    grid-template-columns: minmax(6.5em, max-content) minmax(0, 1fr);
    gap: var(--space-8);
    align-items: baseline;
}

.qpl__zeile dd {
    margin: 0;
    overflow-wrap: anywhere;
    hyphens: none;
}
</style>
