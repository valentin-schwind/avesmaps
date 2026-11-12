<script setup lang="ts">
/**
 * Die Bestätigung im Moment des Umschaltens (WI-0127 SYS-5; SYS-0001 §6.2, §4.5; Blatt WI-0119 Z6 und A4): Frage, Folge, der Grund
 * und die zwei Knöpfe, an der Stelle, an der gefragt wurde (`AvmBestaetigung`, kein zweites Fenster). Den Passkey fragt danach der
 * Browser (Stufe S, `withConfirmation`), einmal; danach nicht wieder, solange der Nachweis frisch ist.
 *
 * - Einschränken und Sperren verlangen einen Grund (1 bis 300 Zeichen, er steht im Protokoll); zurückschalten und lösen nehmen
 *   einen, wenn einer dasteht. Ist der Grund Pflicht, steht der Fokus im Feld (Blatt Z6), sonst auf „Abbrechen“.
 * - Was gegen die Handlung spricht (Grund fehlt, Schutzregel, sie läuft gerade), sperrt die Handlung mit sichtbarem Satz.
 * - Enter im Feld bestätigt, Escape bricht ab (die Bestätigung hält Escape selbst, das Fenster bleibt offen).
 */
import { computed, nextTick, onMounted, useId, useTemplateRef } from "vue";
import { SYSTEM_REASON_MAX } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import { t } from "../i18n/i18n";
import { grundProblem } from "./betriebszustand";

const props = defineProps<{
    frage: string;
    folge: string;
    bestaetigen: string;
    /** Ein Grund ist Pflicht (Einschränken, Sperren). */
    pflicht: boolean;
    /** Was vor dem Server schon dagegen spricht (Schutzregel), als Satz; sperrt die Handlung. */
    problem?: string | undefined;
    busy: boolean;
    testid: string;
}>();
const grund = defineModel<string>("grund", { required: true });
const emit = defineEmits<{ bestaetigen: []; abbrechen: [] }>();

const feld = useTemplateRef<InstanceType<typeof AvmEingabe>>("feld");
const feldId = useId();

const grundSatz = computed(() => {
    const key = grundProblem(grund.value, props.pflicht);
    return key === undefined ? undefined : t(key);
});
/** Was die Handlung sperrt: sie läuft, eine Schutzregel, der Grund. */
const gesperrt = computed(() => (props.busy ? "" : (props.problem ?? grundSatz.value)));

onMounted(async () => {
    if (!props.pflicht) return;
    await nextTick();
    feld.value?.focus();
});

function enter(): void {
    if (gesperrt.value === undefined) emit("bestaetigen");
}
</script>

<template>
    <AvmBestaetigung
        :frage="props.frage"
        :folge="props.folge"
        :bestaetigen="props.bestaetigen"
        :gesperrt="gesperrt"
        :fokus="!props.pflicht"
        :testid="props.testid"
        @bestaetigen="emit('bestaetigen')"
        @abbrechen="emit('abbrechen')"
    >
        <label class="frage__grund" :for="feldId">
            <span class="frage__beschriftung">{{
                props.pflicht ? t("admin.system.ask.reason") : t("admin.system.ask.reasonOptional")
            }}</span>
            <AvmEingabe
                :id="feldId"
                ref="feld"
                v-model="grund"
                :maxlength="SYSTEM_REASON_MAX"
                :placeholder="t('admin.system.ask.reasonHint')"
                autocomplete="off"
                :testid="`${props.testid}-grund`"
                @keydown.enter.prevent="enter"
            />
        </label>
    </AvmBestaetigung>
</template>

<style scoped>
.frage__grund {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.frage__beschriftung {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
