<script setup lang="ts">
/**
 * Das Detail einer Person in der Verwaltung (WI-0120 A10; AUTH-0001 §12.4: die Liste der Sitzungen, Sonderrechte nur durch den
 * Betreiber, „In Legacy bekannt als“). Es steht an der Stelle der Liste, „Alle Personen“ führt zurück.
 *
 * - **Zugang:** Rolle, Sperren mit Grund, Zugang entziehen (die Person bleibt; eine Rolle gibt ihn zurück). Dazu „Verantwortlich für:“
 *   (WI-0133): ändern darf es ein Betreiber (`set_responsibility`) und, am eigenen Konto, jede Person; die übrigen lesen es. Kurz
 *   steht es auch im Kopf unter Name und Rolle.
 * - **Anmeldewege:** Benutzername, Discord, Passkeys; Rücksetzlink nur, wo ein Passwort schon besteht (§7.3), Einrichtungslink und
 *   Widerruf der Passkeys nur mit `manage_passkeys` (§11.4). Ein Link steht nur jetzt im Kopierfeld, danach nirgends mehr.
 * - **Sitzungen** einzeln oder alle beenden.
 * - **Sonderrechte:** zuteilen und entziehen nur mit `grant_special_capabilities`, immer mit Grund, nur an Admins (§7.3).
 * - **Legacy-Namen** zuordnen nur mit Begründung; ein gleicher Name allein beweist nichts (§6.9).
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
    GRANTABLE_CAPABILITIES,
    RESPONSIBILITY_MAX,
    ROLES,
    assignableRoles,
    isRole,
    type AdminLegacyIdentity,
    type AdminPerson,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmAvatar from "../controls/avm-avatar.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmStatus from "../controls/avm-status.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterMauer from "../fenster/fenster-mauer.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import type { Administration } from "./verwaltung";
import { authState } from "./session-state";
import type { PersonActions } from "./verwaltung-handlungen";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";
import { rollenName, sonderrollenZeilen } from "./bezeichnung";
import { label } from "./verwaltung-text";
import { mayEditResponsibility } from "./verantwortung";

const props = defineProps<{
    verwaltung: Administration;
    aktionen: PersonActions;
    person: AdminPerson;
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: [] }>();

/** Die Sonderrollen der Person in einer Zeile (WI-0279 E9b); vergeben wird im Reiter „Sonderrollen“. */
const sonderrollenText = computed(() => {
    const person = detail.value?.person;
    return sonderrollenZeilen(person?.sonderrollen, person?.bezeichnung)
        .map((zeile) => zeile.text)
        .join(" · ");
});

const session = authState.value;
const darf = (capability: string): boolean => session.capabilities.includes(capability);
const eigeneRolle = session.person?.role ?? "";
const vergebbar: readonly string[] = isRole(eigeneRolle) ? assignableRoles(eigeneRolle) : [];
const rollen = ROLES.map((role) => ({
    wert: role,
    text: label("auth.role", role),
    gesperrt: !vergebbar.includes(role),
}));

const jetzt = new Date();
const vor = (iso: string): string => relativeTime(new Date(iso), jetzt, locale.value);
const vorOderNie = (iso: string | null): string => (iso === null ? t("admin.people.never") : vor(iso));

watch(
    () => props.person.id,
    (id) => void props.verwaltung.loadDetail(id),
    { immediate: true },
);
onBeforeUnmount(() => props.verwaltung.closeDetail());

const detail = computed(() =>
    props.verwaltung.detail.value?.person.id === props.person.id ? props.verwaltung.detail.value : null,
);
const p = computed(() => props.person);
const beschaeftigt = computed(() => props.aktionen.busy.has(p.value.id));
const sperrgrund = computed(() => {
    // Am eigenen Konto geht hier nur „Verantwortlich für:“ (WI-0133); alles andere im Kontofenster.
    if (p.value.self) return t("admin.person.ownReason");
    if (!p.value.manageable) return t("admin.people.operatorOnly");
    return null;
});
const handeln = (capability: string): boolean => sperrgrund.value === null && darf(capability);
const status = computed(() => {
    if (p.value.status === "locked") return { ton: "gefahr" as const, text: t("admin.people.status.locked") };
    if (p.value.access !== "active") return { ton: "ruhe" as const, text: t("admin.people.status.revoked") };
    return { ton: "erfolg" as const, text: t("admin.people.status.active") };
});
const ergebnis = computed(() => props.aktionen.outcomes.get(p.value.id));
const frage = computed(() =>
    props.aktionen.question.value?.personId === p.value.id ? props.aktionen.question.value.kind : null,
);

/** In welcher Karte die Antwort der letzten Handlung steht: dort, wo gehandelt wurde, und nur dort. */
type Ort = "zugang" | "wege" | "sitzungen" | "sonder" | "legacy";
const ort = ref<Ort>("zugang");
function bei<T>(wo: Ort, handlung: () => T): T {
    ort.value = wo;
    return handlung();
}

// „Verantwortlich für:“ (WI-0133), an Ort und Stelle in der Karte „Zugang“.
const verantwortung = computed(() => p.value.responsibleFor ?? null);
const verantwortungAenderbar = computed(() => mayEditResponsibility(p.value, session.capabilities));
const verantwortungOffen = ref(false);
const verantwortungText = ref("");
watch(
    () => props.person.id,
    () => (verantwortungOffen.value = false),
);
function verantwortungBearbeiten(): void {
    verantwortungText.value = verantwortung.value ?? "";
    verantwortungOffen.value = true;
}
async function verantwortungSpeichern(): Promise<void> {
    const result = await bei("zugang", () =>
        props.aktionen.run(p.value, () => props.verwaltung.setResponsibility(p.value, verantwortungText.value)),
    );
    if (result.ok) verantwortungOffen.value = false;
}

// Sperren mit Grund.
let grundFeld: { focus(): void } | null = null;
function merkeGrund(element: unknown): void {
    grundFeld = element as { focus(): void } | null;
}
async function fragen(kind: "lock" | "revoke" | "passkeys"): Promise<void> {
    ort.value = kind === "passkeys" ? "wege" : "zugang";
    props.aktionen.ask(kind, p.value);
    await nextTick();
    grundFeld?.focus();
}
const grundFehlt = computed(() =>
    props.aktionen.reason.value.trim() === "" ? t("admin.people.lockReasonMissing") : undefined,
);

// Links: Rücksetzen und erster Passkey; der Link steht in der Karte der Anmeldewege.
async function link(kind: "reset" | "passkey"): Promise<void> {
    ort.value = "wege";
    await props.aktionen.run(p.value, () =>
        kind === "reset" ? props.verwaltung.resetLink(p.value) : props.verwaltung.passkeyLink(p.value),
    );
}

// Sonderrechte: zuteilen und entziehen, immer mit Grund.
const zuteilbar = computed(() =>
    GRANTABLE_CAPABILITIES.filter((capability) => !p.value.grants.includes(capability)).map((capability) => ({
        wert: capability,
        text: label("auth.capability", capability),
    })),
);
const neuesRecht = ref("");
const rechtGrund = ref("");
const entziehen = ref<string | null>(null);
const entziehGrund = ref("");
watch(
    zuteilbar,
    (liste) => {
        if (!liste.some((eintrag) => eintrag.wert === neuesRecht.value)) neuesRecht.value = liste[0]?.wert ?? "";
    },
    { immediate: true },
);
async function zuteilen(): Promise<void> {
    const result = await bei("sonder", () =>
        props.aktionen.run(p.value, () => props.verwaltung.grant(p.value, neuesRecht.value, rechtGrund.value.trim())),
    );
    if (result.ok) rechtGrund.value = "";
}
async function entzogen(): Promise<void> {
    const capability = entziehen.value;
    if (capability === null) return;
    const result = await bei("sonder", () =>
        props.aktionen.run(p.value, () => props.verwaltung.ungrant(p.value, capability, entziehGrund.value.trim())),
    );
    if (result.ok) {
        entziehen.value = null;
        entziehGrund.value = "";
    }
}

// Legacy-Namen: suchen, mit Begründung zuordnen, Zuordnung lösen.
const legacySuche = ref("");
const legacyWahl = ref<AdminLegacyIdentity | null>(null);
const beleg = ref("");
let legacyTakt: ReturnType<typeof setTimeout> | undefined;
watch(legacySuche, (suche) => {
    clearTimeout(legacyTakt);
    legacyTakt = setTimeout(() => void props.verwaltung.loadLegacy(suche), 250);
});
onBeforeUnmount(() => clearTimeout(legacyTakt));
async function zuordnen(): Promise<void> {
    const identity = legacyWahl.value;
    if (identity === null) return;
    const result = await bei("legacy", () =>
        props.aktionen.run(p.value, () => props.verwaltung.mapLegacy(identity, p.value, beleg.value.trim())),
    );
    if (result.ok) {
        legacyWahl.value = null;
        beleg.value = "";
        await props.verwaltung.loadLegacy(legacySuche.value);
    }
}
async function loesen(entry: { id: string; revision: number }): Promise<void> {
    await bei("legacy", () => props.aktionen.run(p.value, () => props.verwaltung.unmapLegacy(p.value, entry)));
}
</script>

<template>
    <div class="detail" data-testid="person-detail">
        <AvmKnopf groesse="zeile" class="detail__zurueck" testid="person-zurueck" @click="emit('zurueck')">{{
            t("admin.person.back")
        }}</AvmKnopf>
        <div class="detail__kopf">
            <AvmAvatar :kennung="p.id" :name="p.displayName" groesse="gross" />
            <div class="detail__wer">
                <span class="detail__name einzeilig" data-testid="person-detail-name">{{ p.displayName }}</span>
                <span class="detail__leise">{{ rollenName(p.role, p.bezeichnung) }}</span>
                <span v-if="sonderrollenText !== ''" class="detail__leise" data-testid="person-sonderrollen">{{
                    sonderrollenText
                }}</span>
                <span
                    v-if="verantwortung !== null"
                    class="detail__leise einzeilig"
                    :title="verantwortung"
                    data-testid="person-detail-verantwortung-kopf"
                    >{{ t("admin.person.responsibleForLine", { text: verantwortung }) }}</span
                >
            </div>
            <AvmStatus v-bind="status" />
        </div>
        <p v-if="sperrgrund !== null" class="detail__sperrgrund">{{ sperrgrund }}</p>
        <p v-if="detail === null && verwaltung.loading.has('detail')" class="detail__leise">
            {{ t("admin.loading") }}
        </p>
        <VerwaltungLadeproblem
            v-else-if="detail === null && verwaltung.loadProblems.has('detail')"
            :problems="verwaltung.loadProblems.get('detail')"
            :fehlt="verwaltung.unconfirmed.get('detail')"
            testid="person-ladeproblem"
            @bestaetigen="verwaltung.confirmAgain()"
        />

        <FensterMauer v-if="detail !== null">
            <FensterKarte :titel="t('admin.person.card.access')">
                <dl class="detail__angaben">
                    <dt>{{ t("admin.people.role") }}</dt>
                    <dd>
                        <AvmAuswahl
                            :key="`${p.id}-${p.accessRevision}-${aktionen.generation.value}`"
                            :model-value="p.role"
                            :optionen="rollen"
                            :gesperrt="!handeln('assign_roles') || beschaeftigt ? '' : undefined"
                            :aria-label="t('admin.people.roleOf', { name: p.displayName })"
                            testid="person-detail-rolle"
                            @update:model-value="(role: string) => bei('zugang', () => aktionen.changeRole(p, role))"
                        />
                    </dd>
                    <template v-if="p.status === 'locked'">
                        <dt>{{ t("admin.people.lockedLabel") }}</dt>
                        <dd>
                            {{
                                p.lockedBy === null || p.lockedAt === null
                                    ? t("admin.people.lockedSinceNoName", { time: p.lockedAt ? vor(p.lockedAt) : "" })
                                    : t("admin.people.lockedSince", {
                                          time: vor(p.lockedAt),
                                          name: p.lockedBy.displayName,
                                      })
                            }}
                        </dd>
                        <template v-if="p.lockReason !== null">
                            <dt>{{ t("admin.person.lockReason") }}</dt>
                            <dd>{{ p.lockReason }}</dd>
                        </template>
                    </template>
                    <dt>{{ t("admin.people.lastSeen") }}</dt>
                    <dd data-testid="person-detail-zuletzt">{{ vorOderNie(p.lastSeenAt ?? p.lastLoginAt) }}</dd>
                    <dt>{{ t("admin.people.lastLogin") }}</dt>
                    <dd data-testid="person-detail-anmeldung">{{ vorOderNie(p.lastLoginAt) }}</dd>
                    <dt>{{ t("admin.people.invitedBy") }}</dt>
                    <dd>{{ p.invitedBy?.displayName ?? t("admin.people.noInvitation") }}</dd>
                    <dt>{{ t("admin.person.responsibleFor") }}</dt>
                    <dd data-testid="person-detail-verantwortung">
                        <form
                            v-if="verantwortungOffen"
                            class="detail__verantwortung"
                            @submit.prevent="verantwortungSpeichern()"
                        >
                            <AvmEingabe
                                v-model="verantwortungText"
                                class="detail__verantwortung-feld"
                                :maxlength="RESPONSIBILITY_MAX"
                                autocomplete="off"
                                :aria-label="t('admin.person.responsibleForOf', { name: p.displayName })"
                                :placeholder="t('admin.person.responsibleForHint', { max: RESPONSIBILITY_MAX })"
                                testid="person-verantwortung-feld"
                            />
                            <AvmKnopf
                                typ="submit"
                                art="gefuellt"
                                groesse="zeile"
                                :gesperrt="beschaeftigt ? '' : undefined"
                                testid="person-verantwortung-speichern"
                                >{{ t("auth.account.save") }}</AvmKnopf
                            >
                            <AvmKnopf groesse="zeile" @click="verantwortungOffen = false">{{
                                t("ui.confirm.cancel")
                            }}</AvmKnopf>
                        </form>
                        <span v-else class="detail__verantwortung">
                            <span
                                class="detail__verantwortung-text"
                                :class="{ detail__leise: verantwortung === null }"
                                data-testid="person-verantwortung-text"
                                >{{ verantwortung ?? t("admin.person.responsibleForNone") }}</span
                            >
                            <AvmKnopf
                                v-if="verantwortungAenderbar"
                                groesse="zeile"
                                :gesperrt="beschaeftigt ? '' : undefined"
                                testid="person-verantwortung-aendern"
                                @click="verantwortungBearbeiten()"
                                >{{ t("admin.person.responsibleForEdit") }}</AvmKnopf
                            >
                        </span>
                    </dd>
                </dl>
                <div v-if="handeln('manage_people') || handeln('assign_roles')" class="detail__knoepfe">
                    <template v-if="handeln('manage_people')">
                        <AvmKnopf
                            v-if="p.status === 'locked'"
                            :gesperrt="beschaeftigt ? '' : undefined"
                            testid="person-detail-entsperren"
                            @click="bei('zugang', () => aktionen.unlock(p))"
                            >{{ t("admin.people.unlock") }}</AvmKnopf
                        >
                        <AvmKnopf
                            v-else
                            :gesperrt="beschaeftigt ? '' : undefined"
                            testid="person-detail-sperren"
                            @click="fragen('lock')"
                            >{{ t("admin.people.lock") }}</AvmKnopf
                        >
                    </template>
                    <AvmKnopf
                        v-if="handeln('assign_roles') && p.access === 'active'"
                        art="gefahr"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        testid="person-detail-entziehen"
                        @click="fragen('revoke')"
                        >{{ t("admin.person.revokeAccess") }}</AvmKnopf
                    >
                </div>
                <AvmBestaetigung
                    v-if="frage === 'lock'"
                    :frage="t('admin.people.lockQuestion', { name: p.displayName })"
                    :folge="
                        p.activeSessions > 0
                            ? t('admin.people.lockFollows', { n: p.activeSessions })
                            : t('admin.people.lockFollowsNone')
                    "
                    :bestaetigen="t('admin.people.lock')"
                    :gesperrt="beschaeftigt ? '' : grundFehlt"
                    :fokus="false"
                    testid="person-sperren-frage"
                    @bestaetigen="aktionen.confirm(p)"
                    @abbrechen="aktionen.cancel()"
                >
                    <AvmEingabe
                        :ref="merkeGrund"
                        :model-value="aktionen.reason.value"
                        :aria-label="t('admin.people.lockReason')"
                        :placeholder="t('admin.people.lockReasonHint')"
                        testid="person-sperren-grund"
                        @update:model-value="aktionen.setReason"
                        @keydown.enter.prevent="grundFehlt === undefined && aktionen.confirm(p)"
                    />
                </AvmBestaetigung>
                <AvmBestaetigung
                    v-if="frage === 'revoke'"
                    :frage="t('admin.person.revokeQuestion', { name: p.displayName })"
                    :folge="t('admin.person.revokeFollows')"
                    :bestaetigen="t('admin.person.revokeAccess')"
                    :gesperrt="beschaeftigt ? '' : undefined"
                    testid="person-entziehen-frage"
                    @bestaetigen="aktionen.confirm(p)"
                    @abbrechen="aktionen.cancel()"
                />
                <VerwaltungMeldung
                    v-if="ort === 'zugang'"
                    :ergebnis="ergebnis"
                    :fuer="p.displayName"
                    testid="person-detail-meldung"
                />
            </FensterKarte>

            <FensterKarte :titel="t('admin.person.card.methods')">
                <dl class="detail__angaben">
                    <dt>{{ t("admin.person.loginName") }}</dt>
                    <dd :class="{ detail__leise: detail.loginName === null }">
                        {{ detail.loginName ?? t("admin.person.noPassword") }}
                    </dd>
                    <dt>{{ t("admin.person.discord") }}</dt>
                    <dd :class="{ detail__leise: detail.discord === null }" data-testid="person-detail-discord">
                        <template v-if="detail.discord === null">{{ t("admin.person.discordNone") }}</template>
                        <template v-else>{{
                            detail.discord.globalName ?? detail.discord.username ?? detail.discord.userId
                        }}</template>
                    </dd>
                    <dt>{{ t("admin.person.passkeys") }}</dt>
                    <dd>
                        <span v-if="detail.passkeys.length === 0" class="detail__leise">{{
                            t("admin.person.passkeysNone")
                        }}</span>
                        <span v-for="key in detail.passkeys" :key="key.id" class="detail__zeile">
                            {{ key.label ?? t("auth.account.passkeys.unnamed") }}
                            <AvmPille v-if="key.backedUp" ton="erfolg">{{
                                t("auth.account.passkeys.synced")
                            }}</AvmPille>
                            <span class="detail__leise">
                                ·
                                {{
                                    key.lastUsedAt === null
                                        ? t("auth.account.passkeys.created", { time: vor(key.createdAt) })
                                        : t("auth.account.passkeys.used", { time: vor(key.lastUsedAt) })
                                }}</span
                            >
                        </span>
                    </dd>
                </dl>
                <AvmHinweis v-if="p.passwordDisabled" ton="warnung">{{
                    t("admin.person.passwordDisabled")
                }}</AvmHinweis>
                <div class="detail__knoepfe">
                    <AvmKnopf
                        v-if="handeln('manage_people') && detail.loginName !== null"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        testid="person-detail-ruecksetzlink"
                        @click="link('reset')"
                        >{{ t("admin.person.resetLink") }}</AvmKnopf
                    >
                    <AvmKnopf
                        v-if="handeln('manage_passkeys')"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        testid="person-detail-passkeylink"
                        @click="link('passkey')"
                        >{{ t("admin.person.passkeyLink") }}</AvmKnopf
                    >
                    <AvmKnopf
                        v-if="handeln('manage_passkeys') && detail.passkeys.length > 0"
                        art="gefahr"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        testid="person-detail-passkeys-widerrufen"
                        @click="fragen('passkeys')"
                        >{{ t("admin.person.revokePasskeys") }}</AvmKnopf
                    >
                </div>
                <p v-if="handeln('manage_people') && detail.loginName !== null" class="detail__leise">
                    {{ t("admin.person.resetHint") }}
                </p>
                <AvmBestaetigung
                    v-if="frage === 'passkeys'"
                    :frage="t('admin.person.revokePasskeysQuestion', { name: p.displayName })"
                    :folge="t('admin.person.revokePasskeysFollows')"
                    :bestaetigen="t('admin.person.revokePasskeys')"
                    :gesperrt="beschaeftigt ? '' : undefined"
                    testid="person-passkeys-frage"
                    @bestaetigen="aktionen.confirm(p)"
                    @abbrechen="aktionen.cancel()"
                />
                <VerwaltungMeldung
                    v-if="ort === 'wege'"
                    :ergebnis="ergebnis"
                    :fuer="p.displayName"
                    testid="person-link"
                />
            </FensterKarte>

            <FensterKarte :titel="t('admin.person.card.sessions')">
                <p v-if="detail.sessions.length === 0" class="detail__leise">{{ t("admin.person.sessionsNone") }}</p>
                <div
                    v-for="entry in detail.sessions"
                    :key="entry.id"
                    class="detail__reihe"
                    data-testid="person-sitzung"
                >
                    <span class="detail__wer">
                        <span>{{ entry.clientLabel ?? t("auth.account.sessions.unknownDevice") }}</span>
                        <span class="detail__leise">{{
                            t("auth.account.sessions.seen", {
                                method: label("auth.menu.signedIn", entry.method),
                                time: vor(entry.lastSeenAt),
                            })
                        }}</span>
                    </span>
                    <AvmKnopf
                        v-if="handeln('manage_people')"
                        groesse="zeile"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        @click="bei('sitzungen', () => aktionen.endSessions(p, entry.id))"
                        >{{ t("admin.person.sessionEnd") }}</AvmKnopf
                    >
                </div>
                <AvmKnopf
                    v-if="handeln('manage_people') && detail.sessions.length > 1"
                    :gesperrt="beschaeftigt ? '' : undefined"
                    testid="person-detail-sitzungen"
                    @click="bei('sitzungen', () => aktionen.endSessions(p))"
                    >{{ t("admin.person.sessionsEndAll") }}</AvmKnopf
                >
                <VerwaltungMeldung v-if="ort === 'sitzungen'" :ergebnis="ergebnis" testid="person-sitzungen-meldung" />
            </FensterKarte>

            <FensterKarte :titel="t('admin.person.card.special')">
                <p v-if="p.role === 'operator'" class="detail__leise">
                    {{ t("admin.person.specialFromRole", { name: p.displayName }) }}
                </p>
                <p v-else-if="p.role !== 'admin' && detail.specialCapabilities.length === 0" class="detail__leise">
                    {{ t("admin.person.specialOnlyAdmins") }}
                </p>
                <template v-else>
                    <p v-if="detail.specialCapabilities.length === 0" class="detail__leise">
                        {{ t("admin.person.specialNone") }}
                    </p>
                    <div
                        v-for="grant in detail.specialCapabilities"
                        :key="grant.capability"
                        class="detail__reihe"
                        :data-testid="`person-sonderrecht-${grant.capability}`"
                    >
                        <span class="detail__wer">
                            <span>{{ label("auth.capability", grant.capability) }}</span>
                            <span class="detail__leise">{{
                                t("admin.person.specialSince", {
                                    time: vor(grant.grantedAt),
                                    name: grant.grantedBy?.displayName ?? "?",
                                    reason: grant.reason,
                                })
                            }}</span>
                        </span>
                        <AvmKnopf
                            v-if="handeln('grant_special_capabilities')"
                            groesse="zeile"
                            art="gefahr"
                            :gesperrt="beschaeftigt ? '' : undefined"
                            @click="((entziehen = grant.capability), (entziehGrund = ''))"
                            >{{ t("admin.person.specialRevoke") }}</AvmKnopf
                        >
                    </div>
                    <AvmBestaetigung
                        v-if="entziehen !== null"
                        :frage="
                            t('admin.person.specialRevokeQuestion', {
                                capability: label('auth.capability', entziehen),
                                name: p.displayName,
                            })
                        "
                        :bestaetigen="t('admin.person.specialRevoke')"
                        :gesperrt="
                            beschaeftigt ? '' : entziehGrund.trim() === '' ? t('admin.person.reasonMissing') : undefined
                        "
                        :fokus="false"
                        @bestaetigen="entzogen()"
                        @abbrechen="entziehen = null"
                    >
                        <AvmEingabe
                            v-model="entziehGrund"
                            :aria-label="t('admin.person.reason')"
                            :placeholder="t('admin.person.reasonHint')"
                        />
                    </AvmBestaetigung>
                    <form
                        v-if="handeln('grant_special_capabilities') && p.role === 'admin' && zuteilbar.length > 0"
                        class="detail__neu"
                        @submit.prevent="zuteilen()"
                    >
                        <AvmAuswahl
                            v-model="neuesRecht"
                            :optionen="zuteilbar"
                            :aria-label="t('admin.person.specialCapability')"
                            testid="person-sonderrecht-wahl"
                        />
                        <AvmEingabe
                            v-model="rechtGrund"
                            :aria-label="t('admin.person.reason')"
                            :placeholder="t('admin.person.reasonHint')"
                            testid="person-sonderrecht-grund"
                        />
                        <AvmKnopf
                            typ="submit"
                            art="gefuellt"
                            :gesperrt="
                                beschaeftigt
                                    ? ''
                                    : rechtGrund.trim() === ''
                                      ? t('admin.person.reasonMissing')
                                      : undefined
                            "
                            testid="person-sonderrecht-zuteilen"
                            >{{ t("admin.person.specialGrant") }}</AvmKnopf
                        >
                    </form>
                    <VerwaltungMeldung
                        v-if="ort === 'sonder'"
                        :ergebnis="ergebnis"
                        testid="person-sonderrecht-meldung"
                    />
                </template>
            </FensterKarte>

            <FensterKarte :titel="t('admin.person.card.legacy')">
                <p v-if="detail.legacy.length === 0" class="detail__leise">{{ t("admin.person.legacyNone") }}</p>
                <div v-for="entry in detail.legacy" :key="entry.id" class="detail__reihe" data-testid="person-legacy">
                    <span class="detail__wer">
                        <span>{{ entry.legacyName }}</span>
                        <span v-if="entry.legacyUserId !== null" class="detail__leise">{{
                            t("admin.person.legacyId", { id: entry.legacyUserId })
                        }}</span>
                    </span>
                    <AvmKnopf
                        v-if="handeln('manage_people')"
                        groesse="zeile"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        @click="loesen(entry)"
                        >{{ t("admin.person.legacyUnmap") }}</AvmKnopf
                    >
                </div>
                <template v-if="handeln('manage_people')">
                    <AvmEingabe
                        v-model="legacySuche"
                        art="suche"
                        :aria-label="t('admin.person.legacySearchLabel')"
                        :placeholder="t('admin.person.legacySearch')"
                        testid="person-legacy-suche"
                    />
                    <template v-if="legacySuche.trim() !== ''">
                        <p
                            v-if="!verwaltung.loading.has('legacy') && verwaltung.legacy.value.length === 0"
                            class="detail__leise"
                        >
                            {{ t("admin.person.legacyNoneFound") }}
                        </p>
                        <div
                            v-for="identity in verwaltung.legacy.value"
                            :key="identity.id"
                            class="detail__reihe"
                            data-testid="person-legacy-treffer"
                        >
                            <span class="detail__wer">
                                <span>{{ identity.legacyName }}</span>
                                <span class="detail__leise">
                                    {{
                                        identity.knownNames.length > 0
                                            ? t("admin.person.legacyKnown", { names: identity.knownNames.join(", ") })
                                            : identity.legacyUserId === null
                                              ? ""
                                              : t("admin.person.legacyId", { id: identity.legacyUserId })
                                    }}
                                </span>
                            </span>
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="identity.kind === 'machine' ? t('admin.error.legacyMachine') : undefined"
                                @click="((legacyWahl = identity), (beleg = ''))"
                                >{{ t("admin.person.legacyMap") }}</AvmKnopf
                            >
                        </div>
                    </template>
                    <AvmBestaetigung
                        v-if="legacyWahl !== null"
                        :frage="
                            t('admin.person.legacyQuestion', { legacy: legacyWahl.legacyName, name: p.displayName })
                        "
                        :folge="t('admin.person.legacyRule')"
                        :bestaetigen="t('admin.person.legacyMap')"
                        :gesperrt="
                            beschaeftigt ? '' : beleg.trim() === '' ? t('admin.person.reasonMissing') : undefined
                        "
                        :fokus="false"
                        testid="person-legacy-frage"
                        @bestaetigen="zuordnen()"
                        @abbrechen="legacyWahl = null"
                    >
                        <AvmEingabe
                            v-model="beleg"
                            :aria-label="t('admin.person.legacyEvidence')"
                            :placeholder="t('admin.person.legacyEvidenceHint')"
                            testid="person-legacy-beleg"
                        />
                    </AvmBestaetigung>
                    <VerwaltungMeldung v-if="ort === 'legacy'" :ergebnis="ergebnis" testid="person-legacy-meldung" />
                </template>
            </FensterKarte>
        </FensterMauer>
    </div>
</template>

<style scoped>
.detail {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
}

.detail__zurueck {
    align-self: flex-start;
}

.detail__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.detail__wer {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.detail__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.detail__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.detail__sperrgrund {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-style: italic;
}

.detail__angaben {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4) var(--space-8);
    margin: 0;
}

.detail__angaben dt {
    color: var(--color-text-muted);
}

.detail__angaben dd {
    min-width: 0;
    margin: 0;
    color: var(--color-text-strong);
}

.detail__zeile {
    display: block;
}

/* „Verantwortlich für:“: Text und „Ändern“ in einer Zeile, beim Bearbeiten Feld, Speichern und Abbrechen. */
.detail__verantwortung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    min-width: 0;
}

.detail__verantwortung-text {
    min-width: 0;
    overflow-wrap: anywhere;
}

.detail__verantwortung-feld {
    flex: 1 1 auto;
    min-width: 0;
}

.detail__reihe {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.detail__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}

/* Die Neuanlage ist eingefärbt, der Bestand nicht (Guide §13.21). */
.detail__neu {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-8);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}
</style>
