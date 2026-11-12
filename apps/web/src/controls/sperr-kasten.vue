<script setup lang="ts">
import { nextTick, ref, useTemplateRef } from "vue";
import { t } from "../i18n/i18n";
import AvmKnopf from "./avm-knopf.vue";

/**
 * Der Kasten zur Sperre (EDIT-0003 §4, T27 (3); Probierblatt Landschaften, `sperrKasten` der Engine): wer, woran, seit wann, zuletzt
 * aktiv und wann frei. Kein Benachrichtigen, wenn frei (Rückmeldung 2026-10-16: „das tooltip reich völlig“).
 *
 * Für Admins (`frage` gesetzt) dazu „Sperre aufheben …“: Die Nachfrage steht im Kasten selbst, ohne Dialog, mit „Aufheben“ und
 * „Abbrechen“. Der Betreiber antwortete „ja“ auf „Soll ein Admin die Sperre eines anderen aufheben können?“ (2026-10-16).
 *
 * **Freigabe erbitten** (WI-0262, OPS-000059; Vali 2026-10-30): Für jeden Editor steht der Knopf „Freigabe erbitten“ da; danach sagt eine
 * Zeile, wie es um die Anfrage steht („Anfrage gesendet, läuft ab um 07:41.“, „Später.“, „Abgelaufen.“). Der Knopf ist ein Knopf der
 * Zeile wie „Sperre aufheben …“ (kleine Größe, weich), die Zeile eine leise Auskunft in der Schrift des Details. Während die Anfrage
 * unterwegs ist, steht der Knopf grau, ohne eigenen Grund: Der Satz darüber sagt, was läuft (§7: kein ausgegrauter Knopf ohne Auskunft).
 */
defineProps<{
    kopf: string;
    detail: string;
    /** Nur für Admins: der Satz der Nachfrage. Ohne ihn gibt es keinen Knopf. */
    frage?: string | undefined;
    /** Die Anfrage um Freigabe: der Satz zu ihrem Stand und der Knopf. Ohne diese Angabe gibt es beides nicht. */
    freigabe?: { status?: string | undefined; knopf: boolean; sendet: boolean } | undefined;
    testid?: string | undefined;
}>();

const emit = defineEmits<{ aufheben: []; bitten: [] }>();
const fragt = ref(false);
const kasten = useTemplateRef<HTMLDivElement>("kasten");

async function fragen(): Promise<void> {
    fragt.value = true;
    await nextTick();
    kasten.value?.querySelector<HTMLButtonElement>("[data-sperre-ja]")?.focus();
}
</script>

<template>
    <div ref="kasten" class="sperr-kasten" role="status" :data-testid="testid">
        <div class="sperr-kasten__kopf">{{ kopf }}</div>
        <div class="sperr-kasten__detail">{{ detail }}</div>
        <div
            v-if="freigabe?.status !== undefined"
            class="sperr-kasten__status"
            :data-testid="testid && `${testid}-status`"
        >
            {{ freigabe.status }}
        </div>
        <div v-if="!fragt && (freigabe?.knopf || frage)" class="sperr-kasten__knoepfe">
            <AvmKnopf
                v-if="freigabe?.knopf"
                groesse="zeile"
                :gesperrt="freigabe.sendet ? '' : undefined"
                :testid="testid && `${testid}-bitten`"
                @click="emit('bitten')"
            >
                {{ t("sperre.freigabe.bitten") }}
            </AvmKnopf>
            <AvmKnopf v-if="frage" groesse="zeile" :testid="testid && `${testid}-aufheben`" @click="fragen()">
                {{ t("sperre.aufheben") }}
            </AvmKnopf>
        </div>
        <div v-else-if="frage && fragt" class="sperr-kasten__knoepfe" role="group">
            <span class="sperr-kasten__frage" :data-testid="testid && `${testid}-frage`">{{ frage }}</span>
            <AvmKnopf
                groesse="zeile"
                art="gefahr"
                data-sperre-ja
                :testid="testid && `${testid}-ja`"
                @click="emit('aufheben')"
            >
                {{ t("sperre.aufheben.ja") }}
            </AvmKnopf>
            <AvmKnopf groesse="zeile" :testid="testid && `${testid}-nein`" @click="fragt = false">
                {{ t("sperre.aufheben.nein") }}
            </AvmKnopf>
        </div>
    </div>
</template>

<style scoped>
/* Grau-Braun aus dem Kanon, nie Rot: Rot heißt „ich bearbeite“ (EDIT-0003 T1). */
.sperr-kasten {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-6) var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1.5px solid var(--color-button-border);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-size: var(--font-size-small);
}

.sperr-kasten__kopf {
    color: var(--color-text-strong);
}

.sperr-kasten__detail,
.sperr-kasten__status,
.sperr-kasten__frage {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.sperr-kasten__frage {
    flex: 1 1 100%;
    color: var(--color-text-strong);
}

.sperr-kasten__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    margin-top: var(--space-2);
}
</style>
