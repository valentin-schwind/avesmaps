<script setup lang="ts">
/**
 * Den ersten Passkey über einen Einrichtungslink anlegen (WI-0120 A9, AUTH-0001 §11.4). Einlösen kann ihn nur die Person
 * selbst, angemeldet; ohne Anmeldung merkt sich die Seite den Link für den Umweg (höchstens 15 Minuten, nur dieser Tab) und
 * öffnet danach dieses Fenster wieder. Nach dem ersten Passkey empfiehlt das Fenster einen zweiten auf einem anderen Gerät.
 */
import { ref, useId } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { openAuthWindow } from "./auth-windows";
import { rememberLink } from "./entry";
import AnmeldeFeldzeilen from "./anmelde-feldzeilen.vue";
import type { Phrase } from "./formular";
import { passkeyPhrases, registerPasskey } from "./passkeys";
import { authState } from "./session-state";
import { passkeysAvailable } from "./webauthn";

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{ token: string | null }>();

const bezeichnungId = useId();
const bezeichnungHinweisId = useId();
const person = authState.value.person;
const moeglich = passkeysAvailable();
const bezeichnung = ref("");
const busy = ref(false);
const fertig = ref(false);
const problems = ref<Phrase[]>([]);

function erstAnmelden(): void {
    if (props.token !== null) rememberLink({ kind: "passkey_enrollment", token: props.token });
    openAuthWindow({ name: "anmelden" });
}

async function einrichten(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    problems.value = [];
    try {
        await registerPasskey({ enrollmentToken: props.token, label: bezeichnung.value });
        fertig.value = true;
    } catch (error) {
        problems.value = passkeyPhrases(error);
    } finally {
        busy.value = false;
    }
}

function abschliessen(): void {
    globalThis.location.reload();
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="anmelden"
        :titel="t('auth.passkey.title')"
        testid="passkey-fenster"
    >
        <div class="passkey">
            <AvmHinweis v-if="token === null" ton="gefahr" rolle="alert">{{ t("auth.link.incomplete") }}</AvmHinweis>
            <template v-else-if="person === null">
                <p class="passkey__text">{{ t("auth.passkey.loginFirst") }}</p>
                <AvmKnopf art="gefuellt" breit testid="passkey-anmelden" @click="erstAnmelden()">{{
                    t("auth.signIn")
                }}</AvmKnopf>
            </template>
            <template v-else-if="fertig">
                <AvmHinweis rolle="status" testid="passkey-fertig">{{ t("auth.passkey.done") }}</AvmHinweis>
                <p class="passkey__text">{{ t("auth.passkey.second") }}</p>
                <AvmKnopf art="gefuellt" breit testid="passkey-abschliessen" @click="abschliessen()">{{
                    t("auth.passkey.finish")
                }}</AvmKnopf>
            </template>
            <template v-else>
                <p class="passkey__text">{{ t("auth.passkey.for", { name: person.displayName }) }}</p>
                <AvmHinweis v-if="!moeglich" ton="warnung">{{ t("auth.passkey.unavailable") }}</AvmHinweis>
                <AnmeldeFeldzeilen @submit="einrichten()">
                    <label class="oben" :for="bezeichnungId">{{ t("auth.passkey.label") }}</label>
                    <span class="feldwert">
                        <AvmEingabe
                            :id="bezeichnungId"
                            v-model="bezeichnung"
                            autocomplete="off"
                            :aria-describedby="bezeichnungHinweisId"
                            testid="passkey-bezeichnung"
                        />
                        <span :id="bezeichnungHinweisId" class="feldhinweis">{{ t("auth.passkey.labelHint") }}</span>
                    </span>
                    <AvmHinweis
                        v-if="problems.length > 0"
                        class="breit"
                        ton="gefahr"
                        rolle="alert"
                        testid="passkey-meldung"
                    >
                        <span v-for="problem in problems" :key="problem.key" class="passkey__problem">{{
                            t(problem.key, problem.params)
                        }}</span>
                    </AvmHinweis>
                    <AvmKnopf
                        class="breit"
                        typ="submit"
                        art="gefuellt"
                        breit
                        :gesperrt="!moeglich ? t('auth.passkey.unavailable') : busy ? '' : undefined"
                        testid="passkey-einrichten"
                        >{{ t("auth.passkey.submit") }}</AvmKnopf
                    >
                </AnmeldeFeldzeilen>
            </template>
        </div>
    </AvmFenster>
</template>

<style scoped>
.passkey {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    padding: var(--space-6) 0;
}

.passkey__text {
    margin: 0;
    color: var(--color-text);
}

.passkey__problem {
    display: block;
}
</style>
