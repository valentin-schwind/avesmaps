<script setup lang="ts">
import { computed } from "vue";
import type { InhalteQuellenZeile } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t, type MessageKey } from "../i18n/i18n";
import { createQuellePerLink, type QuelleZumAnhaengen } from "./quelle-per-link-steuerung";
import QuellePerLinkBox from "./quelle-per-link.vue";

/**
 * Eine Quelle des Katalogs zum Anhängen suchen und wählen (WI-0254): das Feld mit der Suche, daneben „＋ Quelle“, darunter die Treffer. Herausgelöst aus dem Reiter „Vorkommen“
 * (`inhalte-vorkommen-stamm.vue`), damit die Quellen der Karteneditoren (`traeger-quellen.vue`) dasselbe Anhängen haben: gleiches Verhalten, gleiche Kennungen (`<kennung>-quelle-suche`, …).
 *
 * - **Die Suche gehört dem Aufrufer** (`createTextSuche`): Das Bauteil zeigt Text und Treffer und meldet die Wahl (`waehle`). Enter und der Knopf wählen den ersten Treffer, den es noch nicht gibt.
 * - 🔴 **Steht ein Link im Feld, ist es keine Suche mehr** (WI-0277, `quelle-per-link-steuerung.ts`): Die Teiltreffer der Suche zeigten sonst die Unterseiten der Adresse, und Enter hängte die erste an. Stattdessen sagt die Auskunft, ob es die
 *   Seite schon gibt, und Enter oder der Knopf hängen die vorhandene an oder legen eine neue an. Der Aufrufer bekommt in beiden Fällen dasselbe `waehle`.
 * - **Schon angehängt** (`schonDa`): Der Treffer steht grau und trägt die Pille „angehängt“; er lässt sich nicht noch einmal wählen.
 * - **Gesperrt** (`gesperrt`, ein Satz oder `""`, wenn der Grund anderswo steht): Feld und Knopf sind aus. Ohne wählbaren Treffer ist der Knopf aus, ohne dass ein Grund nötig ist.
 */
const props = withDefaults(
    defineProps<{
        treffer: readonly InhalteQuellenZeile[];
        laedt: boolean;
        schonDa: (sourceId: string) => boolean;
        gesperrt?: string | undefined;
        platzhalter: string;
        beschriftung: string;
        /** Die Aufschrift des Knopfes hinter „＋“. */
        knopf: string;
        /** Die Kennung für die Testkennungen (`<kennung>-quelle-neu`, …). */
        kennung: string;
        /** WI-0287 (Publikationen einer Karte): je Treffer das Umschlagbild (`InhalteQuellenZeile.umschlag`), ohne Bild ein leerer Platz und „Kein Umschlagbild“. */
        umschlag?: boolean | undefined;
        /**
         * Ein Link im Feld legt eine neue Quelle an (WI-0277); Vorgabe: ja. Nur wer Quellen verwalten darf (`manage_sources`), darf anlegen; ohne das Recht bleibt ein Link eine Suche
         * und die Auskunft wird nicht gefragt (sie verlangt dasselbe Recht). 🔴 Die Vorgabe steht in `withDefaults`: Ohne sie macht Vue eine fehlende Boolean-Prop zu `false`, und der Link war
         * in den Karteneditoren aus (Vali 2026-11-09, `boolean-props-vorgabe.test.ts`).
         */
        perLink?: boolean | undefined;
        /** Der Satz, wenn die Suche nichts findet (Vorgabe „Kein Treffer.“). */
        keinTreffer?: string | undefined;
    }>(),
    { perLink: true },
);
const emit = defineEmits<{ waehle: [quelle: QuelleZumAnhaengen] }>();
const text = defineModel<string>("text", { required: true });
const link = createQuellePerLink(() => (props.perLink ? text.value : ""));
const istLink = computed(() => link.link.value !== undefined);
const knopfFrei = computed(() =>
    istLink.value ? link.bereit(props.schonDa) : props.treffer.some((q) => !props.schonDa(q.id)),
);

const kennungVon = (rest: string): string => `${props.kennung}-${rest}`;
async function waehleErste(): Promise<void> {
    if (istLink.value) {
        if (!link.bereit(props.schonDa)) return;
        const quelle = await link.bestaetige();
        if (quelle !== undefined) emit("waehle", quelle);
        return;
    }
    const erste = props.treffer.find((q) => !props.schonDa(q.id));
    if (erste !== undefined) emit("waehle", erste);
}
</script>

<template>
    <div class="quellen__neu" :data-testid="kennungVon('quelle-neu')">
        <div class="quellen__zeile">
            <AvmEingabe
                v-model="text"
                art="suche"
                :placeholder="platzhalter"
                :aria-label="beschriftung"
                :gesperrt="gesperrt"
                :testid="kennungVon('quelle-suche')"
                @keydown.enter.prevent="waehleErste"
            />
            <AvmKnopf
                groesse="zeile"
                :gesperrt="gesperrt === undefined && knopfFrei ? undefined : ''"
                :testid="kennungVon('quelle-anhaengen')"
                @click="waehleErste"
            >
                ＋ {{ knopf }}
            </AvmKnopf>
        </div>
        <QuellePerLinkBox
            v-if="istLink"
            :link="link"
            :schon-da="schonDa"
            :gesperrt="gesperrt"
            :kennung="kennung"
            @bestaetige="waehleErste"
        />
        <ul v-else-if="treffer.length > 0" class="quellen__treffer" :data-testid="kennungVon('quelle-treffer')">
            <li v-for="q in treffer" :key="q.id">
                <button
                    type="button"
                    class="quellen__treffer-knopf"
                    :disabled="schonDa(q.id)"
                    :data-testid="kennungVon('quelle-treffer-eins')"
                    @click="emit('waehle', q)"
                >
                    <span v-if="umschlag" class="quellen__bild" :data-testid="kennungVon('quelle-treffer-bild')"
                        ><img v-if="q.umschlag" :src="q.umschlag.url" alt="" loading="lazy"
                    /></span>
                    <span class="quellen__name" :class="{ 'quellen__name--umschlag': umschlag }">
                        {{ q.title }}
                        <span
                            v-if="umschlag && !q.umschlag && !schonDa(q.id)"
                            class="quellen__klein"
                            :data-testid="kennungVon('quelle-treffer-ohne-bild')"
                            >{{ t("quellen.anhaengen.keinUmschlag") }}</span
                        >
                    </span>
                    <AvmPille v-if="schonDa(q.id)">{{ t("inhalte.vorkommen.quellen.schonDa") }}</AvmPille>
                    <AvmPille v-else>{{ t(`infoPanel.sourceType.${q.sourceType}` as MessageKey) }}</AvmPille>
                </button>
            </li>
        </ul>
        <p v-else-if="laedt" class="quellen__leise">{{ t("inhalte.laedt") }}</p>
        <p v-else-if="text.trim().length >= 2" class="quellen__leise" :data-testid="kennungVon('quelle-keiner')">
            {{ keinTreffer ?? t("inhalte.verwendungen.keinTreffer") }}
        </p>
    </div>
</template>

<style scoped>
.quellen__neu {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.quellen__zeile {
    display: flex;
    gap: var(--space-6);
}

.quellen__zeile > :first-child {
    flex: 1 1 auto;
    min-width: 0;
}

.quellen__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.quellen__treffer {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    list-style: none;
}

.quellen__treffer li + li {
    border-top: 1px solid var(--color-divider);
}

.quellen__treffer-knopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    width: 100%;
    min-height: var(--avm-control-h);
    padding: var(--space-4) var(--space-8);
    border: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.quellen__treffer-knopf:hover:not(:disabled) {
    background: var(--color-hover-wash);
}

.quellen__treffer-knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.quellen__treffer-knopf:disabled {
    color: var(--color-text-muted);
    cursor: default;
}

.quellen__name {
    min-width: 0;
    overflow-wrap: anywhere;
}

/* Mit Umschlagbild: Titel und darunter „Kein Umschlagbild“, das Bild davor. */
.quellen__name--umschlag {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
}

.quellen__klein {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Das Umschlagbild eines Treffers (WI-0287): klein vor dem Titel, ohne Bild ein leerer Platz in derselben Größe. */
.quellen__bild {
    flex: none;
    width: var(--avm-fenster-umschlag-w);
    height: var(--avm-fenster-umschlag-h);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.quellen__bild img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
    .quellen__treffer-knopf {
        transition: none;
    }
}
</style>
