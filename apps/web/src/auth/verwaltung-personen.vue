<script setup lang="ts">
/**
 * Der Reiter „Personen“ (WI-0120 A10; Mockup `02-personen`, am Telefon `07-handy`): wer in dieser Umgebung Zugang hat, mit Rolle,
 * Status, wann sie zuletzt da war und wer eingeladen hat. Rolle, Sperren und Sitzungen wirken sofort, ohne „Speichern“; die Rolle mit
 * Bestätigung, wo der Server sie verlangt, und mit Konfliktmeldung (AUTH-0001 §12.4). Sperren fragt an Ort und Stelle nach dem
 * Grund. Am eigenen Konto und an Personen, die nur der Betreiber verwaltet, steht statt der Knöpfe der Grund (§7.3).
 *
 * Ein Klick auf den Namen öffnet das Detail (`verwaltung-person.vue`) an derselben Stelle; die Suche steht in der Leiste des
 * Fensters und filtert nur die Liste.
 */
import { computed, nextTick } from "vue";
import { ROLES, assignableRoles, isRole, type AdminPerson } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmStatus from "../controls/avm-status.vue";
import FensterRaster from "../fenster/fenster-raster.vue";
import { locale, t, tPlural } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { authState } from "./session-state";
import type { Administration } from "./verwaltung";
import type { PersonActions } from "./verwaltung-handlungen";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";
import VerwaltungPerson from "./verwaltung-person.vue";
import VerwaltungPersonName from "./verwaltung-person-name.vue";
import { label } from "./verwaltung-text";

const props = defineProps<{
    verwaltung: Administration;
    aktionen: PersonActions;
    suche: string;
    telefon: boolean;
}>();
/** Die Person, deren Detail offen ist; das Fenster blendet dann die Suche aus. */
const offen = defineModel<string | null>("offen", { required: true });

const session = authState.value;
const darf = (capability: string): boolean => session.capabilities.includes(capability);
const eigeneRolle = session.person?.role ?? "";
const vergebbar: readonly string[] = isRole(eigeneRolle) ? assignableRoles(eigeneRolle) : [];

const jetzt = new Date();
const vor = (iso: string): string => relativeTime(new Date(iso), jetzt, locale.value);

const alle = computed(() =>
    [...props.verwaltung.people.value].sort((a, b) => a.displayName.localeCompare(b.displayName, locale.value)),
);
const sichtbar = computed(() => {
    const suche = props.suche.trim().toLocaleLowerCase(locale.value);
    return suche === ""
        ? alle.value
        : alle.value.filter((person) => person.displayName.toLocaleLowerCase(locale.value).includes(suche));
});
const zusammenfassung = computed(() => {
    const people = alle.value;
    const gesperrt = people.filter((person) => person.status === "locked").length;
    const ohne = people.filter((person) => person.status !== "locked" && person.access !== "active").length;
    const teile = [
        tPlural("admin.people.count", people.length, { n: people.length }),
        t("admin.people.countActive", { n: people.length - gesperrt - ohne }),
        t("admin.people.countLocked", { n: gesperrt }),
    ];
    if (ohne > 0) teile.push(t("admin.people.countRevoked", { n: ohne }));
    return teile.join(" · ");
});
const offenePerson = computed(() => alle.value.find((person) => person.id === offen.value) ?? null);

const rollen = ROLES.map((role) => ({
    wert: role,
    text: label("auth.role", role),
    gesperrt: !vergebbar.includes(role),
}));

/** Warum an dieser Person hier nichts geht, oder nichts. */
function sperrgrund(person: AdminPerson): string | null {
    if (person.self) return t("admin.people.ownReason");
    if (!person.manageable) return t("admin.people.operatorOnly");
    return null;
}
const rolleGesperrt = (person: AdminPerson): string | undefined =>
    !darf("assign_roles") || sperrgrund(person) !== null || props.aktionen.busy.has(person.id) ? "" : undefined;

function status(person: AdminPerson): { ton: "erfolg" | "ruhe" | "gefahr"; text: string } {
    if (person.status === "locked") return { ton: "gefahr", text: t("admin.people.status.locked") };
    if (person.access !== "active") return { ton: "ruhe", text: t("admin.people.status.revoked") };
    return { ton: "erfolg", text: t("admin.people.status.active") };
}
function gesperrtSeit(person: AdminPerson): string {
    if (person.lockedAt === null) return "";
    const zeit = vor(person.lockedAt);
    return person.lockedBy === null
        ? t("admin.people.lockedSinceNoName", { time: zeit })
        : t("admin.people.lockedSince", { time: zeit, name: person.lockedBy.displayName });
}
/**
 * Wann die Person zuletzt da war: ihre letzte Anfrage, ohne Sitzung die Anmeldung. Die Anmeldung allein sagt das nicht, weil eine gewöhnliche Sitzung nie von selbst endet
 * (Betreiber 2026-11-05: „alles bloß nicht die letzte anmeldung“).
 */
const zuletzt = (person: AdminPerson): string => {
    const wann = person.lastSeenAt ?? person.lastLoginAt;
    return wann === null ? t("admin.people.never") : vor(wann);
};

// Sperren: Rückfrage mit Grund an Ort und Stelle; es gibt höchstens eine, also genügt ein Verweis auf ihr Feld.
let grundFeld: { focus(): void } | null = null;
function merkeGrund(element: unknown): void {
    grundFeld = element as { focus(): void } | null;
}
async function sperren(person: AdminPerson): Promise<void> {
    props.aktionen.ask("lock", person);
    await nextTick();
    grundFeld?.focus();
}
const fragtSperren = (person: AdminPerson): boolean =>
    props.aktionen.question.value?.kind === "lock" && props.aktionen.question.value.personId === person.id;
const grundFehlt = computed(() =>
    props.aktionen.reason.value.trim() === "" ? t("admin.people.lockReasonMissing") : undefined,
);
const sperrFolge = (person: AdminPerson): string =>
    person.activeSessions > 0
        ? t("admin.people.lockFollows", { n: person.activeSessions })
        : t("admin.people.lockFollowsNone");

function oeffnen(person: AdminPerson): void {
    props.aktionen.reset();
    offen.value = person.id;
}
function zurueck(): void {
    props.aktionen.reset();
    offen.value = null;
}
</script>

<template>
    <VerwaltungPerson
        v-if="offenePerson !== null"
        :verwaltung="verwaltung"
        :aktionen="aktionen"
        :person="offenePerson"
        :telefon="telefon"
        @zurueck="zurueck"
    />
    <template v-else>
        <p v-if="verwaltung.loading.has('people') && alle.length === 0" class="personen__still">
            {{ t("admin.loading") }}
        </p>
        <VerwaltungLadeproblem
            v-else-if="verwaltung.loadProblems.has('people')"
            :problems="verwaltung.loadProblems.get('people')"
            :fehlt="verwaltung.unconfirmed.get('people')"
            testid="personen-ladeproblem"
            @bestaetigen="verwaltung.confirmAgain()"
        />
        <template v-else>
            <p v-if="telefon" class="personen__summe" data-testid="personen-summe">{{ zusammenfassung }}</p>
            <p v-if="sichtbar.length === 0" class="personen__still">
                {{ suche.trim() === "" ? t("admin.people.empty") : t("admin.people.noMatch", { query: suche.trim() }) }}
            </p>
            <FensterRaster v-else :beschriftung="t('admin.tab.personen')">
                <ul v-if="telefon" class="fenster-raster__karten">
                    <li
                        v-for="person in sichtbar"
                        :key="person.id"
                        class="fenster-raster__karte"
                        :data-testid="`person-${person.id}`"
                    >
                        <div class="fenster-raster__kopf">
                            <VerwaltungPersonName class="personen__name" :person="person" @oeffnen="oeffnen(person)" />
                            <AvmStatus v-bind="status(person)" />
                        </div>
                        <dl class="fenster-raster__felder">
                            <dt>{{ t("admin.people.role") }}</dt>
                            <dd>
                                <AvmAuswahl
                                    :key="`${person.id}-${person.accessRevision}-${aktionen.generation.value}`"
                                    :model-value="person.role"
                                    :optionen="rollen"
                                    :gesperrt="rolleGesperrt(person)"
                                    :aria-label="t('admin.people.roleOf', { name: person.displayName })"
                                    :testid="`person-rolle-${person.id}`"
                                    @update:model-value="(role: string) => aktionen.changeRole(person, role)"
                                />
                            </dd>
                            <template v-if="person.status === 'locked'">
                                <dt>{{ t("admin.people.lockedLabel") }}</dt>
                                <dd>{{ gesperrtSeit(person) }}</dd>
                            </template>
                            <dt>{{ t("admin.people.lastSeen") }}</dt>
                            <dd>{{ zuletzt(person) }}</dd>
                            <dt>{{ t("admin.people.invitedBy") }}</dt>
                            <dd :class="{ personen__leise: person.invitedBy === null }">
                                {{ person.invitedBy?.displayName ?? t("admin.people.noInvitation") }}
                            </dd>
                        </dl>
                        <span v-if="sperrgrund(person) !== null" class="personen__sperrgrund">{{
                            sperrgrund(person)
                        }}</span>
                        <div v-else-if="darf('manage_people')" class="fenster-raster__handlungen">
                            <AvmKnopf
                                v-if="person.status === 'locked'"
                                :gesperrt="aktionen.busy.has(person.id) ? '' : undefined"
                                :testid="`person-entsperren-${person.id}`"
                                @click="aktionen.unlock(person)"
                                >{{ t("admin.people.unlock") }}</AvmKnopf
                            >
                            <AvmKnopf
                                v-else
                                :gesperrt="aktionen.busy.has(person.id) ? '' : undefined"
                                :testid="`person-sperren-${person.id}`"
                                @click="sperren(person)"
                                >{{ t("admin.people.lock") }}</AvmKnopf
                            >
                            <AvmKnopf
                                :gesperrt="person.activeSessions === 0 || aktionen.busy.has(person.id) ? '' : undefined"
                                :testid="`person-sitzungen-${person.id}`"
                                @click="aktionen.endSessions(person)"
                                >{{ t("admin.people.endSessions", { n: person.activeSessions }) }}</AvmKnopf
                            >
                        </div>
                        <AvmBestaetigung
                            v-if="fragtSperren(person)"
                            :frage="t('admin.people.lockQuestion', { name: person.displayName })"
                            :folge="sperrFolge(person)"
                            :bestaetigen="t('admin.people.lock')"
                            :gesperrt="aktionen.busy.has(person.id) ? '' : grundFehlt"
                            :fokus="false"
                            testid="person-sperren-frage"
                            @bestaetigen="aktionen.confirm(person)"
                            @abbrechen="aktionen.cancel()"
                        >
                            <AvmEingabe
                                :ref="merkeGrund"
                                :model-value="aktionen.reason.value"
                                :aria-label="t('admin.people.lockReason')"
                                :placeholder="t('admin.people.lockReasonHint')"
                                testid="person-sperren-grund"
                                @update:model-value="aktionen.setReason"
                                @keydown.enter.prevent="grundFehlt === undefined && aktionen.confirm(person)"
                            />
                        </AvmBestaetigung>
                        <VerwaltungMeldung
                            :ergebnis="aktionen.outcomes.get(person.id)"
                            :fuer="person.displayName"
                            :testid="`person-meldung-${person.id}`"
                        />
                    </li>
                </ul>
                <table v-else data-testid="personen-tabelle">
                    <thead>
                        <tr>
                            <th scope="col">{{ t("admin.people.col.name") }}</th>
                            <th scope="col">{{ t("admin.people.col.role") }}</th>
                            <th scope="col">{{ t("admin.people.col.status") }}</th>
                            <th scope="col">{{ t("admin.people.col.lastSeen") }}</th>
                            <th scope="col">{{ t("admin.people.col.invitedBy") }}</th>
                            <th scope="col">
                                <span class="personen__vorleser">{{ t("admin.people.col.actions") }}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="person in sichtbar" :key="person.id">
                            <tr :data-testid="`person-${person.id}`">
                                <td>
                                    <VerwaltungPersonName :person="person" @oeffnen="oeffnen(person)" />
                                </td>
                                <td>
                                    <AvmAuswahl
                                        :key="`${person.id}-${person.accessRevision}-${aktionen.generation.value}`"
                                        :model-value="person.role"
                                        :optionen="rollen"
                                        class="personen__rolle"
                                        groesse="zeile"
                                        :gesperrt="rolleGesperrt(person)"
                                        :aria-label="t('admin.people.roleOf', { name: person.displayName })"
                                        :testid="`person-rolle-${person.id}`"
                                        @update:model-value="(role: string) => aktionen.changeRole(person, role)"
                                    />
                                </td>
                                <td>
                                    <span class="personen__status">
                                        <AvmStatus v-bind="status(person)" />
                                        <span v-if="person.status === 'locked'" class="personen__leise">{{
                                            gesperrtSeit(person)
                                        }}</span>
                                    </span>
                                </td>
                                <td>{{ zuletzt(person) }}</td>
                                <td :class="{ personen__leise: person.invitedBy === null }">
                                    {{ person.invitedBy?.displayName ?? t("admin.people.noInvitation") }}
                                </td>
                                <td>
                                    <span v-if="sperrgrund(person) !== null" class="personen__sperrgrund">{{
                                        sperrgrund(person)
                                    }}</span>
                                    <span v-else-if="darf('manage_people')" class="personen__handlungen">
                                        <AvmKnopf
                                            v-if="person.status === 'locked'"
                                            groesse="zeile"
                                            :gesperrt="aktionen.busy.has(person.id) ? '' : undefined"
                                            :testid="`person-entsperren-${person.id}`"
                                            @click="aktionen.unlock(person)"
                                            >{{ t("admin.people.unlock") }}</AvmKnopf
                                        >
                                        <AvmKnopf
                                            v-else
                                            groesse="zeile"
                                            :gesperrt="aktionen.busy.has(person.id) ? '' : undefined"
                                            :testid="`person-sperren-${person.id}`"
                                            @click="sperren(person)"
                                            >{{ t("admin.people.lock") }}</AvmKnopf
                                        >
                                        <AvmKnopf
                                            groesse="zeile"
                                            :gesperrt="
                                                person.activeSessions === 0 || aktionen.busy.has(person.id)
                                                    ? ''
                                                    : undefined
                                            "
                                            :testid="`person-sitzungen-${person.id}`"
                                            @click="aktionen.endSessions(person)"
                                            >{{ t("admin.people.endSessions", { n: person.activeSessions }) }}</AvmKnopf
                                        >
                                    </span>
                                </td>
                            </tr>
                            <tr class="fenster-raster__nach">
                                <td colspan="6">
                                    <AvmBestaetigung
                                        v-if="fragtSperren(person)"
                                        :frage="t('admin.people.lockQuestion', { name: person.displayName })"
                                        :folge="sperrFolge(person)"
                                        :bestaetigen="t('admin.people.lock')"
                                        :gesperrt="aktionen.busy.has(person.id) ? '' : grundFehlt"
                                        :fokus="false"
                                        testid="person-sperren-frage"
                                        @bestaetigen="aktionen.confirm(person)"
                                        @abbrechen="aktionen.cancel()"
                                    >
                                        <AvmEingabe
                                            :ref="merkeGrund"
                                            :model-value="aktionen.reason.value"
                                            :aria-label="t('admin.people.lockReason')"
                                            :placeholder="t('admin.people.lockReasonHint')"
                                            testid="person-sperren-grund"
                                            @update:model-value="aktionen.setReason"
                                            @keydown.enter.prevent="
                                                grundFehlt === undefined && aktionen.confirm(person)
                                            "
                                        /> </AvmBestaetigung
                                    ><VerwaltungMeldung
                                        :ergebnis="aktionen.outcomes.get(person.id)"
                                        :fuer="person.displayName"
                                        :testid="`person-meldung-${person.id}`"
                                    />
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </FensterRaster>
            <p v-if="!telefon" class="personen__summe" data-testid="personen-summe">
                {{ zusammenfassung }} · {{ t("admin.people.sorted") }}
            </p>
            <AvmHinweis
                ><strong class="personen__erst">{{ t("admin.people.noDeleteFirst") }}</strong>
                {{ t("admin.people.noDelete") }}</AvmHinweis
            >
        </template>
    </template>
</template>

<style scoped>
.personen__still,
.personen__summe {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.personen__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.personen__status {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* Die Rolle in der Tabellenzeile: so breit wie eine Feldbeschriftung, damit der längste Rollenname hineinpasst. */
.personen__rolle {
    width: var(--avm-field-label-w);
}

.personen__name {
    flex: 1 1 auto;
}

/* Der Sperrgrund nennt die Herkunft, nicht das Verbot (Mockup, Guide §13.20). */
.personen__sperrgrund {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-style: italic;
}

.personen__handlungen {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

/* Nur für Vorleser: die Spalte der Knöpfe braucht einen Namen, aber keine sichtbare Überschrift. */
.personen__vorleser {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.personen__erst {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-regular);
}
</style>
