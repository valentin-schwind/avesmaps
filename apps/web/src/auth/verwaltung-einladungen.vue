<script setup lang="ts">
/**
 * Der Reiter „Einladungen“ (WI-0120 A10; Mockup `03-einladungen`, AUTH-0001 §6.5 und §12.4). Oben die eingefärbte Neuanlage
 * (Guide §13.21: „Die Neuanlage ist eingefärbt, der Bestand nicht“): Rolle, Gültigkeit, für wen; Admin- und Betreiber-Einladungen
 * brauchen die Discord-ID der Person (D3). Darunter die offenen Einladungen, eingeklappt die benutzten und abgelaufenen.
 *
 * 🔴 Der Link steht nur in der Antwort, die ihn erzeugt (Kap. 10.70): danach zeigt die Liste nur sein Ende („…C3sd“), dazu
 * „Neu ausstellen“ (ein neuer Link, der alte gilt nicht mehr) und „Zurückziehen“. Verschickt wird nichts.
 *
 * Sonderrollen (WI-0279; Betreiber 2026-11-03: „sonderrollen schon bei der einladung zu vergeben (zusätzlich zur eigentlichen rolle +
 * keine)“): Das Feld steht nur für wen auch vergeben darf; mit Auswahl brauchen Discord-ID und Grund. Wirksam beim Einlösen.
 */
import { computed, ref, watch } from "vue";
import {
    ROLES,
    SONDERROLLEN_NAMEN,
    assignableRoles,
    invitationRequiresDiscordBinding,
    isRole,
    sonderrolleSpec,
    type AdminInvitation,
    type SonderrolleName,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { authState } from "./session-state";
import SonderrollenRegionen from "./sonderrollen-regionen.vue";
import type { ActionResult, Administration } from "./verwaltung";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";
import { label, remainingText } from "./verwaltung-text";

const props = defineProps<{ verwaltung: Administration }>();

const session = authState.value;
const eigeneRolle = session.person?.role ?? "";
const vergebbar: readonly string[] = isRole(eigeneRolle) ? assignableRoles(eigeneRolle) : [];
const rollen = ROLES.filter((role) => vergebbar.includes(role)).map((role) => ({
    wert: role,
    text: label("auth.role", role),
}));
const GUELTIG = [1, 3, 7, 14] as const;
const gueltig = GUELTIG.map((tage) => ({
    wert: String(tage),
    text: tage === 1 ? t("admin.invite.day") : t("admin.invite.days", { n: tage }),
}));

const jetzt = new Date();
const vor = (iso: string): string => relativeTime(new Date(iso), jetzt, locale.value);

// Die Neuanlage.
const rolle = ref(vergebbar.includes("editor") ? "editor" : (rollen[0]?.wert ?? ""));
const tage = ref("7");
const fuer = ref("");
const discordId = ref("");
// Sonderrollen der Einladung: Vorgabe „keine“; bei regionalen Rollen je eine Wahl der Regionen.
const darfSonderrollen = session.capabilities.includes("grant_special_capabilities");
const sonderrollen = ref<SonderrolleName[]>([]);
const sonderRegionen = ref<Partial<Record<SonderrolleName, string[]>>>({});
const sonderGrund = ref("");
const mitSonderrollen = computed(() => sonderrollen.value.length > 0);
const regionale = computed(() => sonderrollen.value.filter((name) => sonderrolleSpec(name).regional === true));
function schalteSonderrolle(name: SonderrolleName, an: boolean): void {
    sonderrollen.value = an ? [...sonderrollen.value, name] : sonderrollen.value.filter((wert) => wert !== name);
}
/** „keine“ lässt sich nicht abwählen: Der neue Schlüssel setzt den Haken wieder, den der Klick dem Kästchen genommen hat. */
const keineStand = ref(0);
function waehleKeine(): void {
    sonderrollen.value = [];
    keineStand.value += 1;
}
const regionenVon = (name: SonderrolleName): string[] => sonderRegionen.value[name] ?? [];
/** Wer eine Region schon hat, bei „höchstens eine Person je Region“. */
function belegteRegionen(name: SonderrolleName): Map<string, string> {
    const belegt = new Map<string, string>();
    for (const zeile of props.verwaltung.sonderrollen.value?.zuteilungen ?? []) {
        if (zeile.sonderrolle === name && zeile.entzogenAm === null && zeile.region !== null)
            belegt.set(zeile.region.id, t("admin.sonderrollen.regionVergeben", { name: zeile.person.displayName }));
    }
    return belegt;
}
const regionenAlle = computed(() => props.verwaltung.sonderrollen.value?.regionen ?? []);
if (darfSonderrollen) void props.verwaltung.loadSonderrollen();
/** Wo der Abgleich von Production eingerichtet ist, kommen Sonderrollen allein von dort (WI-0279 E9). */
const sonderrollenHier = computed(
    () => darfSonderrollen && props.verwaltung.sonderrollen.value?.abgleich === undefined,
);

const gebunden = computed(
    () => mitSonderrollen.value || (isRole(rolle.value) && invitationRequiresDiscordBinding(rolle.value)),
);
const idFalsch = computed(() => gebunden.value && !/^[0-9]{15,21}$/u.test(discordId.value.trim()));
/** Was der Einladung mit Sonderrollen noch fehlt, oder `undefined`. */
const sonderFehlt = computed(() => {
    for (const name of regionale.value) {
        const gewaehlt = regionenVon(name);
        const rolleText = label("auth.sonderrolle", name);
        if (gewaehlt.length === 0) return t("admin.sonderrollen.fehlt.regionFuer", { rolle: rolleText });
        if (sonderrolleSpec(name).einePersonJeRegion === true) {
            const belegt = belegteRegionen(name);
            if (gewaehlt.some((id) => belegt.has(id))) return t("admin.sonderrollen.fehlt.konflikt");
        }
    }
    if (mitSonderrollen.value && sonderGrund.value.trim() === "") return t("admin.sonderrollen.fehlt.grund");
    return undefined;
});
const laeuft = ref(false);
/** Der zuletzt erzeugte oder neu ausgestellte Link, mit dem Namen, für den er gilt. */
const neu = ref<{ ergebnis: ActionResult; fuer: string } | null>(null);
watch(rolle, () => (discordId.value = ""));

async function erzeugen(): Promise<void> {
    if (laeuft.value || idFalsch.value || sonderFehlt.value !== undefined) return;
    laeuft.value = true;
    try {
        const ergebnis = await props.verwaltung.createInvitation({
            role: rolle.value,
            validDays: Number(tage.value),
            note: fuer.value.trim(),
            ...(gebunden.value ? { discordUserId: discordId.value.trim() } : {}),
            ...(mitSonderrollen.value
                ? {
                      sonderrollen: sonderrollen.value.map((sonderrolle) => ({
                          sonderrolle,
                          ...(sonderrolleSpec(sonderrolle).regional === true
                              ? { regionen: regionenVon(sonderrolle) }
                              : {}),
                      })),
                      sonderrollenGrund: sonderGrund.value.trim(),
                  }
                : {}),
        });
        neu.value = { ergebnis, fuer: fuer.value.trim() };
        if (ergebnis.ok) {
            fuer.value = "";
            discordId.value = "";
            sonderrollen.value = [];
            sonderRegionen.value = {};
            sonderGrund.value = "";
        }
    } finally {
        laeuft.value = false;
    }
}

// Der Bestand.
const offene = computed(() => props.verwaltung.invitations.value.filter((invitation) => invitation.status === "open"));
const erledigte = computed(() =>
    props.verwaltung.invitations.value.filter((invitation) => invitation.status !== "open"),
);
const erledigtSumme = computed(() => {
    const zahl = (status: AdminInvitation["status"]): number =>
        erledigte.value.filter((invitation) => invitation.status === status).length;
    const teile = [
        ["accepted", "admin.invite.sumAccepted"],
        ["expired", "admin.invite.sumExpired"],
        ["revoked", "admin.invite.sumRevoked"],
        ["replaced", "admin.invite.sumReplaced"],
    ] as const;
    return teile
        .filter(([status]) => zahl(status) > 0)
        .map(([status, key]) => t(key, { n: zahl(status) }))
        .join(" · ");
});
const name = (invitation: AdminInvitation): string => invitation.note ?? t("admin.invite.noNote");
const sonderText = (eintrag: NonNullable<AdminInvitation["sonderrollen"]>[number]): string => {
    const name = label("auth.sonderrolle", eintrag.sonderrolle);
    return eintrag.region === null ? name : `${name} (${eintrag.region.name})`;
};
function meta(invitation: AdminInvitation): string {
    const teile = [label("auth.role", invitation.role), remainingText(invitation.expiresAt, jetzt)];
    if (invitation.createdBy !== null) teile.push(t("admin.invite.by", { name: invitation.createdBy.displayName }));
    return teile.join(" · ");
}
function verlauf(invitation: AdminInvitation): string {
    if (invitation.status === "accepted") {
        const zeit = invitation.acceptedAt === null ? "" : vor(invitation.acceptedAt);
        return invitation.acceptedPerson === null
            ? t("admin.invite.acceptedNoName", { time: zeit })
            : t("admin.invite.accepted", { name: invitation.acceptedPerson.displayName, time: zeit });
    }
    if (invitation.status === "revoked")
        return t("admin.invite.revoked", { time: invitation.revokedAt === null ? "" : vor(invitation.revokedAt) });
    if (invitation.status === "replaced") return t("admin.invite.replaced");
    return t("admin.invite.expired", { time: vor(invitation.expiresAt) });
}

const beschaeftigt = ref<string | null>(null);
const zurueckziehen = ref<string | null>(null);
const fehler = ref(new Map<string, ActionResult>());
async function handeln(invitation: AdminInvitation, was: "reissue" | "revoke"): Promise<void> {
    if (beschaeftigt.value !== null) return;
    beschaeftigt.value = invitation.id;
    fehler.value.delete(invitation.id);
    try {
        const ergebnis =
            was === "reissue"
                ? await props.verwaltung.reissueInvitation(invitation)
                : await props.verwaltung.revokeInvitation(invitation);
        if (!ergebnis.ok) fehler.value.set(invitation.id, ergebnis);
        else if (was === "reissue") neu.value = { ergebnis, fuer: name(invitation) };
        else zurueckziehen.value = null;
    } finally {
        beschaeftigt.value = null;
    }
}
</script>

<template>
    <form class="einladungen__neu" data-testid="einladung-neu" @submit.prevent="erzeugen()">
        <div class="einladungen__reihe">
            <label class="einladungen__feld">
                <span class="einladungen__beschriftung">{{ t("admin.invite.role") }}</span>
                <AvmAuswahl v-model="rolle" :optionen="rollen" testid="einladung-rolle" />
            </label>
            <label class="einladungen__feld">
                <span class="einladungen__beschriftung">{{ t("admin.invite.valid") }}</span>
                <AvmAuswahl v-model="tage" :optionen="gueltig" testid="einladung-gueltig" />
            </label>
            <label class="einladungen__feld einladungen__feld--weit">
                <span class="einladungen__beschriftung">{{ t("admin.invite.forWhom") }}</span>
                <AvmEingabe
                    v-model="fuer"
                    maxlength="120"
                    autocomplete="off"
                    :placeholder="t('admin.invite.forWhomPlaceholder')"
                    testid="einladung-fuer"
                />
            </label>
            <label v-if="gebunden" class="einladungen__feld">
                <span class="einladungen__beschriftung">{{ t("admin.invite.discordId") }}</span>
                <AvmEingabe
                    v-model="discordId"
                    inputmode="numeric"
                    autocomplete="off"
                    :ungueltig="discordId.trim() !== '' && idFalsch"
                    testid="einladung-discord-id"
                />
            </label>
        </div>
        <div v-if="sonderrollenHier" class="einladungen__feld">
            <span class="einladungen__beschriftung">{{ t("admin.invite.sonderrollen") }}</span>
            <div class="einladungen__sonderwahl" role="group" :aria-label="t('admin.invite.sonderrollen')">
                <AvmKaestchen
                    :key="keineStand"
                    art="checkbox"
                    :checked="!mitSonderrollen"
                    testid="einladung-sonderrolle-keine"
                    @change="waehleKeine()"
                    >{{ t("admin.invite.sonderrollenKeine") }}</AvmKaestchen
                >
                <AvmKaestchen
                    v-for="name in SONDERROLLEN_NAMEN"
                    :key="name"
                    art="checkbox"
                    :checked="sonderrollen.includes(name)"
                    :testid="`einladung-sonderrolle-${name}`"
                    @change="schalteSonderrolle(name, $event)"
                    >{{ label("auth.sonderrolle", name) }}</AvmKaestchen
                >
            </div>
        </div>
        <div v-for="name in regionale" :key="name" class="einladungen__feld">
            <span class="einladungen__beschriftung">{{
                sonderrolleSpec(name).einePersonJeRegion
                    ? t("admin.invite.regionenEine", { rolle: label("auth.sonderrolle", name) })
                    : t("admin.invite.regionen", { rolle: label("auth.sonderrolle", name) })
            }}</span>
            <SonderrollenRegionen
                :model-value="regionenVon(name)"
                :regionen="regionenAlle"
                :zusatz="sonderrolleSpec(name).einePersonJeRegion ? belegteRegionen(name) : undefined"
                :testid="`einladung-regionen-${name}`"
                @update:model-value="sonderRegionen = { ...sonderRegionen, [name]: $event }"
            />
        </div>
        <label v-if="mitSonderrollen" class="einladungen__feld">
            <span class="einladungen__beschriftung">{{ t("admin.sonderrollen.grundPflicht") }}</span>
            <AvmEingabe
                v-model="sonderGrund"
                maxlength="300"
                autocomplete="off"
                :placeholder="t('admin.sonderrollen.grundPlatzhalter')"
                testid="einladung-sonderrolle-grund"
            />
        </label>
        <AvmHinweis v-if="mitSonderrollen">
            <strong>{{ t("admin.sonderrollen.passkeyErst") }}</strong>
            {{ t("admin.invite.sonderrollenPasskey") }}
        </AvmHinweis>
        <div class="einladungen__ausloeser">
            <AvmKnopf
                typ="submit"
                art="gefuellt"
                :gesperrt="laeuft ? '' : idFalsch ? t('admin.invite.discordIdMissing') : sonderFehlt"
                testid="einladung-erzeugen"
                >{{ t("admin.invite.create") }}</AvmKnopf
            >
        </div>
        <p class="einladungen__leise">
            {{
                mitSonderrollen
                    ? t("admin.invite.explainSonderrolle")
                    : gebunden
                      ? t("admin.invite.explainBound")
                      : t("admin.invite.explain")
            }}
        </p>
    </form>
    <VerwaltungMeldung v-if="neu !== null" :ergebnis="neu.ergebnis" :fuer="neu.fuer" testid="einladung-link" />

    <p class="einladungen__ueberschrift">{{ t("admin.invite.open", { n: offene.length }) }}</p>
    <p
        v-if="verwaltung.loading.has('invitations') && verwaltung.invitations.value.length === 0"
        class="einladungen__leise"
    >
        {{ t("admin.loading") }}
    </p>
    <VerwaltungLadeproblem
        v-else-if="verwaltung.loadProblems.has('invitations')"
        :problems="verwaltung.loadProblems.get('invitations')"
        :fehlt="verwaltung.unconfirmed.get('invitations')"
        testid="einladungen-ladeproblem"
        @bestaetigen="verwaltung.confirmAgain()"
    />
    <p v-else-if="offene.length === 0" class="einladungen__leise">{{ t("admin.invite.openNone") }}</p>
    <ul v-else class="einladungen__liste">
        <li
            v-for="invitation in offene"
            :key="invitation.id"
            class="einladungen__eintrag"
            :data-testid="`einladung-${invitation.id}`"
        >
            <div class="einladungen__zeile">
                <span class="einladungen__wer">
                    <span class="einladungen__name">
                        {{ name(invitation) }}
                        <AvmPille v-if="invitation.boundDiscordUserId !== null" ton="warnung">{{
                            t("admin.invite.bound")
                        }}</AvmPille>
                    </span>
                    <span class="einladungen__meta">{{ meta(invitation) }}</span>
                    <span v-if="invitation.sonderrollen?.length" class="einladungen__pillen">
                        <AvmPille v-for="eintrag in invitation.sonderrollen" :key="sonderText(eintrag)">{{
                            sonderText(eintrag)
                        }}</AvmPille>
                    </span>
                </span>
                <span class="einladungen__ende" :title="t('admin.invite.hintTitle')">{{
                    t("admin.detail.hint", { hint: invitation.tokenHint })
                }}</span>
                <span v-if="invitation.manageable" class="einladungen__knoepfe">
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="beschaeftigt !== null ? '' : undefined"
                        :testid="`einladung-neu-ausstellen-${invitation.id}`"
                        @click="handeln(invitation, 'reissue')"
                        >{{ t("admin.invite.reissue") }}</AvmKnopf
                    >
                    <AvmKnopf
                        groesse="zeile"
                        art="gefahr"
                        :gesperrt="beschaeftigt !== null ? '' : undefined"
                        :testid="`einladung-zurueckziehen-${invitation.id}`"
                        @click="zurueckziehen = invitation.id"
                        >{{ t("admin.invite.revoke") }}</AvmKnopf
                    >
                </span>
                <span v-else class="einladungen__sperrgrund">{{ t("admin.invite.operatorOnly") }}</span>
            </div>
            <AvmBestaetigung
                v-if="zurueckziehen === invitation.id"
                :frage="t('admin.invite.revokeQuestion', { name: name(invitation) })"
                :folge="t('admin.invite.revokeFollows')"
                :bestaetigen="t('admin.invite.revoke')"
                :gesperrt="beschaeftigt !== null ? '' : undefined"
                testid="einladung-zurueckziehen-frage"
                @bestaetigen="handeln(invitation, 'revoke')"
                @abbrechen="zurueckziehen = null"
            />
            <VerwaltungMeldung :ergebnis="fehler.get(invitation.id)" />
        </li>
    </ul>

    <AvmDisclosure
        v-if="erledigte.length > 0"
        :label="t('admin.invite.done', { n: erledigte.length })"
        :secondary="erledigtSumme"
        summary-closed-only
        summary-one-line
        toggle-testid="einladungen-erledigt"
    >
        <ul class="einladungen__liste">
            <li v-for="invitation in erledigte" :key="invitation.id" class="einladungen__eintrag">
                <span class="einladungen__wer">
                    <span class="einladungen__name">{{ name(invitation) }}</span>
                    <span class="einladungen__meta"
                        >{{ label("auth.role", invitation.role) }} · {{ verlauf(invitation) }}</span
                    >
                </span>
            </li>
        </ul>
    </AvmDisclosure>
</template>

<style scoped>
/* Die Neuanlage ist eingefärbt, der Bestand nicht (Guide §13.21). */
.einladungen__neu {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-10);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.einladungen__reihe {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-8);
}

.einladungen__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.einladungen__feld--weit {
    flex: 1 1 calc(var(--avm-field-label-w) * 2);
}

.einladungen__beschriftung {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die Mehrfachauswahl der Sonderrollen: so viele Spalten, wie passen. */
.einladungen__sonderwahl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11em, 1fr));
    gap: var(--space-2) var(--space-8);
}

.einladungen__ausloeser {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.einladungen__pillen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
}

.einladungen__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die nackte Überschrift: eine Gliederung im Fluss, ohne Rahmen (Mockup). */
.einladungen__ueberschrift {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Die Zeilenliste mit Trennlinie (Guide §13.13). */
.einladungen__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--color-divider);
    list-style: none;
}

.einladungen__eintrag {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) 0;
    border-bottom: 1px solid var(--color-divider);
}

.einladungen__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-10);
}

.einladungen__wer {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
}

.einladungen__name {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.einladungen__meta,
.einladungen__ende {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.einladungen__ende {
    font-variant-numeric: tabular-nums;
}

.einladungen__knoepfe {
    display: flex;
    gap: var(--space-4);
}

.einladungen__sperrgrund {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-style: italic;
}
</style>
