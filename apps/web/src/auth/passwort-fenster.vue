<script setup lang="ts">
/**
 * Rücksetzlink und Notzugang (WI-0120 A9, AUTH-0001 §6.7, §11.2, §12.2 `passwort-fenster`). Der Rücksetzlink setzt ein neues
 * Passwort und beendet alle anderen Anmeldungen der Person; beim ersten Konto von der Kommandozeile entsteht dabei auch der
 * Benutzername. Der Notzugang verlangt das eigene Passwort und öffnet eine Sitzung für 60 Minuten, nicht verlängerbar.
 */
import { computed, useId, watch } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { locale, t } from "../i18n/i18n";
import AnmeldeFeldzeilen from "./anmelde-feldzeilen.vue";
import { untilText } from "./formular";
import { createAccessLinkFlow, type AccessKind } from "./zugangslink";

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{ kind: AccessKind; token: string | null }>();

const nameId = useId();
const passwortId = useId();
const passwortHinweisId = useId();

const flow = createAccessLinkFlow(props.kind, props.token);
const { state, info, loginName, password, busy, problems } = flow;
const notzugang = props.kind === "recovery";

watch(
    offen,
    (jetzt) => {
        if (jetzt && props.token !== null) void flow.inspect();
    },
    { immediate: true },
);

const bis = computed(() => (info.value === null ? "" : untilText(info.value.expiresAt, locale.value)));
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="anmelden"
        :titel="notzugang ? t('auth.recovery.title') : t('auth.reset.title')"
        testid="passwort-fenster"
    >
        <div class="zugang">
            <p v-if="state === 'laden'" class="zugang__still">{{ t("auth.link.loading") }}</p>
            <AvmHinweis v-else-if="state === 'ungueltig'" ton="gefahr" rolle="alert" testid="passwort-ungueltig">{{
                notzugang ? t("auth.recovery.invalid") : t("auth.link.invalid")
            }}</AvmHinweis>
            <AvmHinweis v-else-if="state === 'unvollstaendig'" ton="gefahr" rolle="alert">{{
                t("auth.link.incomplete")
            }}</AvmHinweis>
            <template v-else-if="info !== null">
                <p class="zugang__fuer" data-testid="passwort-fuer">
                    {{ t("auth.link.for", { name: info.displayName }) }}
                    <span class="zugang__bis">{{ t("auth.link.until", { time: bis }) }}</span>
                </p>
                <AvmHinweis v-if="notzugang" ton="warnung">{{ t("auth.recovery.explain") }}</AvmHinweis>
                <AnmeldeFeldzeilen @submit="flow.submit()">
                    <template v-if="info.loginName === null">
                        <label :for="nameId">{{ t("auth.login.username") }}</label>
                        <AvmEingabe :id="nameId" v-model="loginName" autocomplete="username" testid="passwort-name" />
                    </template>
                    <template v-else>
                        <span>{{ t("auth.login.username") }}</span>
                        <span class="zugang__name" data-testid="passwort-benutzer">{{ info.loginName }}</span>
                    </template>
                    <label class="oben" :for="passwortId">{{
                        notzugang ? t("auth.login.password") : t("auth.reset.newPassword")
                    }}</label>
                    <span class="feldwert">
                        <AvmEingabe
                            :id="passwortId"
                            v-model="password"
                            art="passwort"
                            :autocomplete="notzugang ? 'current-password' : 'new-password'"
                            :aria-describedby="passwortHinweisId"
                            testid="passwort-feld"
                        />
                        <span :id="passwortHinweisId" class="feldhinweis">{{
                            notzugang ? t("auth.login.passwordHint") : t("auth.password.rule")
                        }}</span>
                    </span>
                    <AvmHinweis
                        v-if="problems.length > 0"
                        class="breit"
                        ton="gefahr"
                        rolle="alert"
                        testid="passwort-meldung"
                    >
                        <span v-for="problem in problems" :key="problem.key" class="zugang__problem">{{
                            t(problem.key, problem.params)
                        }}</span>
                    </AvmHinweis>
                    <AvmKnopf
                        class="breit"
                        typ="submit"
                        art="gefuellt"
                        breit
                        :gesperrt="busy ? '' : undefined"
                        testid="passwort-absenden"
                        >{{ notzugang ? t("auth.recovery.submit") : t("auth.reset.submit") }}</AvmKnopf
                    >
                </AnmeldeFeldzeilen>
                <p v-if="!notzugang" class="zugang__still">{{ t("auth.reset.sessionsEnd") }}</p>
            </template>
        </div>
    </AvmFenster>
</template>

<style scoped>
.zugang {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    padding: var(--space-6) 0;
}

.zugang__still {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zugang__fuer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    color: var(--color-text-strong);
}

.zugang__bis {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zugang__name {
    color: var(--color-text-strong);
}

.zugang__problem {
    display: block;
}
</style>
