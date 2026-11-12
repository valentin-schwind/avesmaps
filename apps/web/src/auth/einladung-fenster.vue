<script setup lang="ts">
/**
 * Eine Einladung annehmen (WI-0120 A9, AUTH-0001 §6.5, §12.2 `einladung-fenster`): Rolle, Umgebung, Ablauf und wer eingeladen
 * hat; „Mit Discord annehmen“ oder Benutzername und Avesmaps-Passwort festlegen. Eine an Discord gebundene Einladung (Admins,
 * D3) geht nur mit Discord. Die Umgebung steht im Text (T19), damit niemand Stage mit Production verwechselt.
 */
import { computed, useId, watch } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { isMessageKey, locale, t } from "../i18n/i18n";
import { createInvitationFlow } from "./einladung";
import type { ReturnOutcome } from "./entry";
import AnmeldeFeldzeilen from "./anmelde-feldzeilen.vue";
import DiscordZeichen from "./discord-zeichen.vue";
import { untilText } from "./formular";
import OderTrenner from "./oder-trenner.vue";

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{ token: string | null; outcome?: ReturnOutcome | undefined }>();

const nameId = useId();
const anzeigeId = useId();
const passwortId = useId();
const passwortHinweisId = useId();

const flow = createInvitationFlow(props.token);
const { state, info, loginName, displayName, password, busy, problems } = flow;

watch(
    offen,
    (jetzt) => {
        if (jetzt && props.token !== null) void flow.inspect();
    },
    { immediate: true },
);

const rueckkehr = computed(() => (props.outcome === undefined ? null : t(`auth.return.${props.outcome}`)));
const rolle = computed(() => {
    const key = `auth.role.${info.value?.role ?? ""}`;
    return isMessageKey(key) ? t(key) : (info.value?.role ?? "");
});
const umgebung = computed(() => {
    const key = `auth.environment.name.${info.value?.environment ?? ""}`;
    return isMessageKey(key) ? t(key) : (info.value?.environment ?? "");
});
const bis = computed(() => (info.value === null ? "" : untilText(info.value.expiresAt, locale.value)));
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="anmelden"
        :titel="t('auth.invitation.title')"
        testid="einladung-fenster"
    >
        <div class="einladung">
            <AvmHinweis v-if="rueckkehr !== null" ton="warnung" rolle="status" testid="einladung-rueckkehr">{{
                rueckkehr
            }}</AvmHinweis>
            <p v-if="state === 'laden'" class="einladung__still">{{ t("auth.invitation.loading") }}</p>
            <AvmHinweis v-else-if="state === 'ungueltig'" ton="gefahr" rolle="alert" testid="einladung-ungueltig">{{
                t("auth.invitation.invalid")
            }}</AvmHinweis>
            <AvmHinweis
                v-else-if="state === 'unvollstaendig' && rueckkehr === null"
                ton="gefahr"
                rolle="alert"
                testid="einladung-unvollstaendig"
                >{{ t("auth.link.incomplete") }}</AvmHinweis
            >
            <template v-else-if="state === 'bereit' && info !== null">
                <dl class="einladung__angaben" data-testid="einladung-angaben">
                    <dt>{{ t("auth.invitation.role") }}</dt>
                    <dd>{{ rolle }}</dd>
                    <dt>{{ t("auth.invitation.environment") }}</dt>
                    <dd>{{ umgebung }}</dd>
                    <template v-if="info.invitedBy !== null">
                        <dt>{{ t("auth.invitation.invitedBy") }}</dt>
                        <dd>{{ info.invitedBy }}</dd>
                    </template>
                    <dt>{{ t("auth.invitation.until") }}</dt>
                    <dd>{{ bis }}</dd>
                </dl>
                <AvmKnopf
                    art="gefuellt"
                    breit
                    :gesperrt="busy ? '' : undefined"
                    testid="einladung-discord"
                    @click="flow.discord()"
                    ><template #zeichen><DiscordZeichen /></template>{{ t("auth.invitation.discord") }}</AvmKnopf
                >
                <AvmHinweis v-if="info.requiresDiscord" testid="einladung-nur-discord">{{
                    t("auth.invitation.requiresDiscord")
                }}</AvmHinweis>
                <template v-else>
                    <OderTrenner />
                    <AnmeldeFeldzeilen @submit="flow.accept()">
                        <label :for="nameId">{{ t("auth.login.username") }}</label>
                        <AvmEingabe :id="nameId" v-model="loginName" autocomplete="username" testid="einladung-name" />
                        <label :for="anzeigeId">{{ t("auth.invitation.displayName") }}</label>
                        <AvmEingabe
                            :id="anzeigeId"
                            v-model="displayName"
                            autocomplete="nickname"
                            testid="einladung-anzeigename"
                        />
                        <label class="oben" :for="passwortId">{{ t("auth.login.password") }}</label>
                        <span class="feldwert">
                            <AvmEingabe
                                :id="passwortId"
                                v-model="password"
                                art="passwort"
                                autocomplete="new-password"
                                :aria-describedby="passwortHinweisId"
                                testid="einladung-passwort"
                            />
                            <span :id="passwortHinweisId" class="feldhinweis">{{ t("auth.password.rule") }}</span>
                        </span>
                        <AvmHinweis
                            v-if="problems.length > 0"
                            class="breit"
                            ton="gefahr"
                            rolle="alert"
                            testid="einladung-meldung"
                        >
                            <span v-for="problem in problems" :key="problem.key" class="einladung__problem">{{
                                t(problem.key, problem.params)
                            }}</span>
                        </AvmHinweis>
                        <AvmKnopf
                            class="breit"
                            typ="submit"
                            breit
                            :gesperrt="busy ? '' : undefined"
                            testid="einladung-annehmen"
                            >{{ t("auth.invitation.accept") }}</AvmKnopf
                        >
                    </AnmeldeFeldzeilen>
                </template>
            </template>
        </div>
    </AvmFenster>
</template>

<style scoped>
.einladung {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    padding: var(--space-6) 0;
}

.einladung__still {
    margin: 0;
    color: var(--color-text-muted);
}

/* Die Angaben als Feldzeilen: Beschriftung links, Wert rechts (Guide §8). */
.einladung__angaben {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    gap: var(--space-4) var(--space-8);
    margin: 0;
}

.einladung__angaben dt {
    color: var(--color-text-muted);
}

.einladung__angaben dd {
    margin: 0;
    color: var(--color-text-strong);
}

.einladung__problem {
    display: block;
}
</style>
