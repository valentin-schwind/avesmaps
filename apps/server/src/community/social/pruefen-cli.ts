import { runSocialPruefen } from "./pruefen.ts";

/**
 * Die Zählregel eines fremden Kanals gegen ein TESTKONTO prüfen und den Kanal erst danach freischalten (WI-0268 C12a; Recherche `project-control/discovery/social-zeichengrenzen-2026-10-31.md` §4 und §5).
 *
 * Ohne `--anwenden` rechnet das Werkzeug nur mit der Zählung des Hubs (kein Netz, kein Schreibzugriff). 🔴 Mit `--anwenden` ist `--operator-said "<Zitat>"` Pflicht: Das konfigurierte Konto
 * (`COMMUNITY_SOCIAL_MASTODON_URL`, `COMMUNITY_SOCIAL_MASTODON_TOKEN`) bekommt Testbeiträge. Nur Discord bekommt keine: Dort liest der Lauf den Webhook (`pruefen-discord.ts`).
 *
 * Beispiele:
 *   npm run social:pruefen -- --kanal mastodon
 *   npm run social:pruefen -- --kanal mastodon --anwenden --operator-said "<Zitat des Betreibers>"
 */
process.exit(
    await runSocialPruefen(process.argv.slice(2), process.env, {
        out: (line) => void process.stdout.write(`${line}\n`),
        err: (line) => void process.stderr.write(`${line}\n`),
    }),
);
