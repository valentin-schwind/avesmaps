import { buildApp } from "./app.ts";
import { discordState } from "./auth/config.ts";
import { selfTestArgon2 } from "./auth/password-hash.ts";
import { sessionLimits } from "./database.ts";

const app = buildApp();

// Graceful shutdown so systemd and local restarts never leave connections open (chapter 10.21).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        app.log.info({ signal }, "shutting down");
        void app.close().then(() => process.exit(0));
    });
}

try {
    // Ist die Anmeldung eingerichtet, muss Argon2id rechnen, sonst startet der Server nicht (WI-0120, fail closed).
    if (app.authConfig.environment !== undefined) await selfTestArgon2();
    await app.listen({ port: app.config.port, host: app.config.host });
    // Netz und Standardprofil vorab laden, damit die erste Route nicht darauf wartet.
    app.routeRunner?.warm();
    // Der Speicherindex der Subjects (Objektlinks, Wegegruppen, Gebiete), damit der erste Klick nicht darauf wartet.
    app.subjects?.warm();
} catch (error) {
    app.log.error(error, "server failed to start");
    process.exit(1);
}

// Einmal ins Journal, wie die Anmeldung steht, ohne einen Wert: Ein fehlendes Geheimnis schaltet Discord ab, der Dienst läuft weiter.
if (app.authConfig.environment !== undefined) {
    const discord = discordState(process.env);
    if (discord.on) app.log.info({ environment: app.authConfig.environment }, "auth: Discord an");
    else
        app.log.warn(
            { environment: app.authConfig.environment, reason: discord.reason },
            "auth: Discord aus, nur die Passwortanmeldung",
        );
}

// Einmal ins Journal, was in den Verbindungen des Servers wirklich gilt (WI-0037, S-05). Ohne Datenbank
// startet der Server trotzdem: dann steht hier, dass die Werte nicht lesbar waren.
if (app.database) {
    try {
        app.log.info({ pool: "server", ...(await sessionLimits(app.database)) }, "database session limits");
    } catch (error) {
        app.log.warn({ pool: "server", err: error }, "database session limits not readable");
    }
}
