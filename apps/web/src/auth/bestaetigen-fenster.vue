<script setup lang="ts">
/**
 * „Kurz bestätigen“ (WI-0120 A9, AUTH-0001 §6.8, §11.2, §12.2 `bestaetigen-fenster`): mit Passkey, wo vorhanden. Den zweiten
 * Faktor (`second_factor`) und Stufe S (`passkey`) gibt NUR der Passkey (Betreiber 2026-10-10: „4. B“); Discord (`prompt=consent`,
 * dieselbe Discord-ID) macht die Anmeldung nur frisch, für Schritte, die eine Bestätigung im Moment verlangen (`confirmation`).
 * Ein Passwort zählt hier nicht: Es fügt keinen Faktor hinzu (§11.1). Es gibt das Fenster EINMAL: Fragen mehrere Anfragen
 * zugleich, warten alle auf dieselbe Antwort (`bestaetigen.ts`, Hotfix 2026-10-10).
 */
import { computed, ref, watch } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { startDiscord } from "./anmelden";
import { pendingConfirmation } from "./bestaetigen";
import DiscordZeichen from "./discord-zeichen.vue";
import type { Phrase } from "./formular";
import { formProblems } from "./formular";
import { confirmWithPasskey, passkeyPhrases } from "./passkeys";
import { authState, refreshSession } from "./session-state";

// Das Fenster steht von Anfang an im Host; was die Person hat, kann sich seitdem geändert haben (ein Passkey dazu).
const hatPasskey = computed(() => (authState.value.person?.passkeyCount ?? 0) > 0);
const hatDiscord = computed(() => authState.value.person?.methods.includes("discord") === true);

const busy = ref(false);
const problems = ref<Phrase[]>([]);

const offen = computed({
    get: () => pendingConfirmation.value !== null,
    set: (jetzt: boolean) => {
        if (!jetzt) pendingConfirmation.value?.resolve(false);
    },
});
const need = computed(() => pendingConfirmation.value?.need ?? "confirmation");
/** Zweiter Faktor und Stufe S: nur der Passkey; Discord ist kein Faktor (Betreiber 2026-10-10: „4. B“). */
const nurPasskey = computed(() => need.value === "passkey" || need.value === "second_factor");

watch(offen, (jetzt) => {
    if (jetzt) problems.value = [];
});

const erklaerung = computed(() => {
    if (need.value === "passkey") return t("auth.confirm.needPasskey");
    if (need.value === "second_factor") return t("auth.confirm.needSecondFactor");
    return t("auth.confirm.needRecent");
});

async function mitPasskey(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    problems.value = [];
    try {
        await confirmWithPasskey();
        pendingConfirmation.value?.resolve(true);
        // Die Sitzung hat jetzt den zweiten Faktor: Menü und Konto sagen es ohne Neuladen der Seite.
        void refreshSession();
    } catch (error) {
        problems.value = passkeyPhrases(error);
    } finally {
        busy.value = false;
    }
}

async function mitDiscord(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    problems.value = [];
    try {
        await startDiscord({ purpose: "confirm" });
    } catch (error) {
        problems.value = formProblems(error);
        busy.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="anmelden"
        :titel="t('auth.confirm.title')"
        testid="bestaetigen-fenster"
    >
        <div class="bestaetigen">
            <p class="bestaetigen__text">{{ erklaerung }}</p>
            <AvmKnopf
                v-if="hatPasskey"
                art="gefuellt"
                breit
                :gesperrt="busy ? '' : undefined"
                testid="bestaetigen-passkey"
                @click="mitPasskey()"
                >{{ t("auth.confirm.passkey") }}</AvmKnopf
            >
            <AvmKnopf
                v-if="hatDiscord && !nurPasskey"
                :art="hatPasskey ? 'weich' : 'gefuellt'"
                breit
                :gesperrt="busy ? '' : undefined"
                testid="bestaetigen-discord"
                @click="mitDiscord()"
                ><template #zeichen><DiscordZeichen /></template>{{ t("auth.confirm.discord") }}</AvmKnopf
            >
            <AvmHinweis v-if="!hatPasskey && (nurPasskey || !hatDiscord)" ton="warnung" testid="bestaetigen-ohne-weg">{{
                t("auth.confirm.noWay")
            }}</AvmHinweis>
            <AvmHinweis v-if="problems.length > 0" ton="gefahr" rolle="alert" testid="bestaetigen-meldung">
                <span v-for="problem in problems" :key="problem.key" class="bestaetigen__problem">{{
                    t(problem.key, problem.params)
                }}</span>
            </AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="bestaetigen-abbrechen" @click="offen = false">{{ t("ui.confirm.cancel") }}</AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.bestaetigen {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    padding: var(--space-6) 0;
}

.bestaetigen__text {
    margin: 0;
    color: var(--color-text);
}

.bestaetigen__problem {
    display: block;
}
</style>
