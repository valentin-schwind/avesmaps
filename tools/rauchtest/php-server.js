// Einen eigenen `php -S` hochfahren, abfragen, wieder abraeumen.
//
// ⭐ Die Bauform gab es schon: tools/svg-export/__tests__/endpunkt-ablauf.js faehrt seit dem
// 23.08.2026 genau so einen Server. Sie stand nur nicht dort, wo ein zweiter Aufrufer sie
// findet -- deshalb liegt der Portloeser jetzt in tools/lib/ und dieses Modul daneben.
"use strict";

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const { freierPort } = require("../lib/freier-port.js");

const WURZEL = path.join(__dirname, "..", "..");

/** Wartet, bis der Server antwortet -- oder gibt auf. */
function warteAufBereitschaft(port, endeMs) {
	return new Promise((fertig, fehler) => {
		const versuch = () => {
			const anfrage = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (antwort) => {
				antwort.resume();
				fertig();
			});
			anfrage.on("error", () => {
				if (Date.now() > endeMs) {
					fehler(new Error(`php -S auf Port ${port} ist nicht hochgekommen.`));
					return;
				}
				setTimeout(versuch, 100);
			});
			anfrage.on("timeout", () => anfrage.destroy());
		};
		versuch();
	});
}

/**
 * Startet `php -S` auf einem freien Port im Repo-Wurzelverzeichnis.
 *
 * 💣 Der Startfehler wird MITGEGEBEN, nicht geschluckt. Ein Server, der nicht bindet, laesst
 * jede folgende Anfrage scheitern -- und dann liest sich ein Portproblem wie ein kaputter
 * Endpunkt. Genau diese Verwechslung beschreibt tools/lib/freier-port.js.
 *
 * @returns {Promise<{port:number, stop:function}>}
 */
async function starteServer() {
	const [port] = await freierPort(1);

	const kind = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", WURZEL], {
		cwd: WURZEL,
		stdio: ["ignore", "pipe", "pipe"],
	});

	let protokoll = "";
	kind.stdout.on("data", (d) => { protokoll += d.toString(); });
	kind.stderr.on("data", (d) => { protokoll += d.toString(); });

	let gestorben = null;
	kind.on("exit", (code, signal) => { gestorben = `php -S endete (code ${code}, signal ${signal})`; });
	kind.on("error", (e) => { gestorben = `php -S liess sich nicht starten: ${e.message}`; });

	const stop = () => {
		try { kind.kill("SIGTERM"); } catch { /* schon weg */ }
	};

	try {
		await warteAufBereitschaft(port, Date.now() + 15000);
	} catch (fehler) {
		stop();
		const grund = gestorben ? `\n${gestorben}` : "";
		throw new Error(`${fehler.message}${grund}\n--- Ausgabe von php -S ---\n${protokoll.slice(-1500)}`);
	}

	return { port, stop, protokoll: () => protokoll };
}

/**
 * Eine Anfrage. Liefert immer Status UND Rumpf -- auch bei 500, denn genau der Rumpf ist hier
 * der Befund.
 *
 * ⚠️ Mit Zeitschranke: ein haengender Endpunkt darf das Deploy-Tor nicht blockieren, sondern
 * muss es reissen.
 */
function frage(port, pfad, { methode = "GET", zeitschrankeMs = 20000 } = {}) {
	return new Promise((fertig, fehler) => {
		const anfrage = http.request(
			{ host: "127.0.0.1", port, path: pfad, method: methode, timeout: zeitschrankeMs },
			(antwort) => {
				const stuecke = [];
				antwort.on("data", (d) => stuecke.push(d));
				antwort.on("end", () => fertig({
					status: antwort.statusCode,
					kopf: antwort.headers,
					rumpf: Buffer.concat(stuecke).toString("utf8"),
				}));
			}
		);
		anfrage.on("timeout", () => {
			anfrage.destroy();
			fehler(new Error(`${pfad}: keine Antwort binnen ${zeitschrankeMs} ms`));
		});
		anfrage.on("error", fehler);
		anfrage.end();
	});
}

module.exports = { starteServer, frage, WURZEL };
