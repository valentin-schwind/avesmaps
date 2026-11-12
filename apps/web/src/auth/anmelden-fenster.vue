<script setup lang="ts">
/**
 * Anmelden (WI-0120 A9, AUTH-0001 §12.2 `anmelden-fenster`; Gestalt: Blatt A8, Legacys Anmeldeseite 360 px): oben Discord
 * als Hauptaktion, darunter „oder“, Benutzername und Avesmaps-Passwort als Feldzeilen, „Anmelden“, und „Passwort vergessen?“
 * erklärt die drei Wege ohne E-Mail. Meldungen stehen IM Fenster (ein Toast läge unter dem modalen Dialog).
 *
 * 🔴 Zweiter Schritt (Betreiber 2026-10-10: „2 faktoren oder keiner“): Fehlt nach der Anmeldung den Verwaltungsrechten der zweite
 * Faktor, sagt das Fenster es und bietet gleich „Mit Passkey bestätigen“ an; nach dem Passwort im selben Fenster
 * (`login.secondFactor`), nach der Rückkehr von Discord öffnet es sich damit (`zweiterFaktor`). „Ohne Verwaltung weiter“ und
 * Schließen lassen die Person ohne Verwaltungsrechte angemeldet.
 *
 * 🔴 Seit dem Betreiberentscheid vom 2026-10-10 („4. B“: „Für die Verwaltung immer den Passkey verlangen; Discord-Nutzer mit
 * Verwaltungsrechten bestätigen einmal je Sitzung“) kommt der Schritt nach JEDER Discord-Anmeldung mit Verwaltungsrechten, auch mit
 * Discord-2FA, und der zweite Faktor ist allein der Passkey: Ein Knopf „Mit Discord bestätigen“ gehört nicht hierher. Fehlt der
 * Passkey, sagt das Fenster, wie man zum ersten kommt.
 *
 * Hat der Server beim Start nicht geantwortet, steht oben „Die Anmeldung ist gerade nicht erreichbar.“ mit „Neu laden“ (WI-0203; der
 * Betreiber wählte am 2026-10-16 „Ja, wie rechts“ in der Simulation, Hinweis und Nachfrage im Hintergrund eingeschlossen). Der
 * Hinweis folgt der Sitzung: Antwortet der Server später (`followLateSession`), verschwindet er.
 */
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import FensterText from "../fenster/fenster-text.vue";
import { t } from "../i18n/i18n";
import { createLogin, problemPhrase, waitPhrase } from "./anmelden";
import type { ReturnOutcome } from "./entry";
import type { Phrase } from "./formular";
import AnmeldeFeldzeilen from "./anmelde-feldzeilen.vue";
import DiscordZeichen from "./discord-zeichen.vue";
import OderTrenner from "./oder-trenner.vue";
import { authState } from "./session-state";

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{ outcome?: ReturnOutcome | undefined; zweiterFaktor?: boolean | undefined }>();

const nameId = useId();
const passwortId = useId();
const passwortHinweisId = useId();
const login = createLogin();
const { name, password, busy, problem, secondFactor, secondFactorProblems } = login;
const vergessen = ref(false);

/** Der zweite Schritt: nach dem Passwort in diesem Fenster, oder geöffnet nach der Rückkehr von Discord. */
const zweiterSchritt = computed(() => secondFactor.value || props.zweiterFaktor === true);
const person = computed(() => authState.value.person);
const hatPasskey = computed(() => (person.value?.passkeyCount ?? 0) > 0);
const unerreichbar = computed(() => !authState.value.known);

function neuLaden(): void {
    globalThis.location.reload();
}

/** Ohne zweiten Faktor weiter. Nach dem Passwort lädt die Seite neu (sie kennt die Anmeldung noch nicht), sonst schließt es nur. */
function ohneVerwaltung(): void {
    if (secondFactor.value) login.finish();
    else offen.value = false;
}

// Jedes Öffnen beginnt sauber; der Name bleibt, das Passwort nie. Wer den zweiten Schritt schließt, ist angemeldet: neu laden.
watch(offen, (jetzt) => {
    if (!jetzt) {
        if (secondFactor.value) login.finish();
        return;
    }
    password.value = "";
    vergessen.value = false;
    if (problem.value?.kind !== "throttled") problem.value = null;
});

// Eine Drossel zählt sichtbar herunter; die Uhr läuft nur, solange sie gilt.
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
watch(problem, (current) => {
    clearInterval(tick);
    if (current?.kind !== "throttled") return;
    now.value = Date.now();
    tick = setInterval(() => {
        now.value = Date.now();
        if (now.value >= current.until) {
            clearInterval(tick);
            problem.value = null;
        }
    }, 1000);
});
onBeforeUnmount(() => clearInterval(tick));

const meldung = computed(() => (problem.value === null ? null : problemPhrase(problem.value, now.value)));
const gedrosselt = computed(() => problem.value?.kind === "throttled");
const warte = computed(() =>
    problem.value?.kind === "throttled" ? t(...phraseArgs(waitPhrase(problem.value.until, now.value))) : undefined,
);
const abgewiesen = computed(() => problem.value?.kind === "credentials");
const rueckkehr = computed(() => (props.outcome === undefined ? null : t(`auth.return.${props.outcome}`)));

function phraseArgs(phrase: Phrase) {
    return [phrase.key, phrase.params] as const;
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="anmelden"
        :titel="t('auth.login.title')"
        testid="anmelden-fenster"
    >
        <div v-if="zweiterSchritt" class="anmelden" data-testid="anmelden-zweiter-faktor">
            <p class="anmelden__satz">
                {{ t("auth.secondFactor.signedIn", { name: person?.displayName ?? "" }) }}
            </p>
            <AvmHinweis ton="warnung" rolle="status">{{ t("auth.secondFactor.missingLong") }}</AvmHinweis>
            <AvmKnopf
                v-if="hatPasskey"
                art="gefuellt"
                breit
                :gesperrt="busy ? '' : undefined"
                testid="anmelden-passkey"
                @click="login.confirmPasskey()"
                >{{ t("auth.confirm.passkey") }}</AvmKnopf
            >
            <AvmHinweis v-else ton="warnung" testid="anmelden-ohne-weg">{{ t("auth.confirm.noWay") }}</AvmHinweis>
            <AvmHinweis
                v-if="secondFactorProblems.length > 0"
                ton="gefahr"
                rolle="alert"
                testid="anmelden-passkey-meldung"
            >
                <span v-for="p in secondFactorProblems" :key="p.key" class="anmelden__zeile">{{
                    t(p.key, p.params)
                }}</span>
            </AvmHinweis>
            <AvmKnopf breit testid="anmelden-ohne-verwaltung" @click="ohneVerwaltung()">{{
                t("auth.secondFactor.skip")
            }}</AvmKnopf>
        </div>
        <div v-else class="anmelden">
            <AvmHinweis v-if="unerreichbar" ton="warnung" rolle="status" testid="anmelden-unerreichbar">
                <span class="anmelden__unerreichbar">
                    <span>{{ t("auth.login.unreachable") }}</span>
                    <AvmKnopf testid="anmelden-neu-laden" @click="neuLaden()">{{ t("auth.login.reload") }}</AvmKnopf>
                </span>
            </AvmHinweis>
            <AvmHinweis v-if="rueckkehr !== null" ton="warnung" rolle="status" testid="anmelden-rueckkehr">{{
                rueckkehr
            }}</AvmHinweis>
            <AvmKnopf
                art="gefuellt"
                breit
                :gesperrt="busy ? '' : undefined"
                testid="anmelden-discord"
                @click="login.discord()"
                ><template #zeichen><DiscordZeichen /></template>{{ t("auth.login.discord") }}</AvmKnopf
            >
            <OderTrenner />
            <AnmeldeFeldzeilen @submit="login.submit()">
                <label :for="nameId">{{ t("auth.login.username") }}</label>
                <AvmEingabe
                    :id="nameId"
                    v-model="name"
                    autocomplete="username"
                    :ungueltig="abgewiesen"
                    testid="anmelden-name"
                />
                <label class="oben" :for="passwortId">{{ t("auth.login.password") }}</label>
                <span class="feldwert">
                    <AvmEingabe
                        :id="passwortId"
                        v-model="password"
                        art="passwort"
                        :ungueltig="abgewiesen"
                        :aria-describedby="passwortHinweisId"
                        testid="anmelden-passwort"
                    />
                    <span :id="passwortHinweisId" class="feldhinweis">{{ t("auth.login.passwordHint") }}</span>
                </span>
                <AvmHinweis
                    v-if="meldung !== null"
                    class="breit"
                    :ton="gedrosselt ? 'warnung' : 'gefahr'"
                    :rolle="gedrosselt ? 'status' : 'alert'"
                    testid="anmelden-meldung"
                    >{{ t(meldung.key, meldung.params) }}</AvmHinweis
                >
                <AvmKnopf
                    class="breit"
                    typ="submit"
                    breit
                    :gesperrt="warte ?? (busy ? '' : undefined)"
                    testid="anmelden-absenden"
                    >{{ t("auth.login.submit") }}</AvmKnopf
                >
            </AnmeldeFeldzeilen>
            <button
                type="button"
                class="anmelden__vergessen"
                :aria-expanded="vergessen"
                data-testid="anmelden-vergessen"
                @click="vergessen = !vergessen"
            >
                {{ t("auth.login.forgot") }}
            </button>
            <AvmHinweis v-if="vergessen"><FensterText :text="t('auth.login.forgotText')" /></AvmHinweis>
        </div>
    </AvmFenster>
</template>

<style scoped>
.anmelden {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    padding: var(--space-6) 0;
}

.anmelden__satz {
    margin: 0;
    color: var(--color-text);
}

.anmelden__zeile {
    display: block;
}

/* Der Satz links, „Neu laden“ rechts daneben; wird es eng, rutscht der Knopf unter den Satz. */
.anmelden__unerreichbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

/* „Passwort vergessen?“ öffnet nur die Erklärung, es führt nirgendwohin: ein Knopf in Linkfarbe (Guide §2). */
.anmelden__vergessen {
    align-self: flex-start;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

.anmelden__vergessen:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}
</style>
