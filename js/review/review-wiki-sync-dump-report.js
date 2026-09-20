// Der Dump-Bericht: die Bausteine der Overlay-Karte (Stile, Tastatur, Abruf, Selbsttest-
// Abschnitt, Laufstatistik). Am 2026-09-20 aus review-wiki-sync.js herausgeloest -- reine
// Verschiebung, kein Verhalten geaendert; geladen in index.html im selben <template data-nur-editor>.
// 💣 Hier steht NUR Funktionsrumpf. Der Merker `avesmapsDumpReportStylesInjected` und der
// Oeffner `avesmapsOpenDumpReport` (er traegt den window-Export, den review-conflicts.js
// ruft) bleiben drueben: ein Ladezeit-Ausdruck faende hier einen unbekannten Namen, und
// genau daran ist der Versuch vom 01.09.2026 gescheitert. Der Merker wird von hier aus
// gelesen und geschrieben -- klassische Skripte teilen sich den globalen lexikalischen
// Geltungsbereich, und gerufen wird erst, wenn beide Dateien geladen sind.

function avesmapsDumpReportInjectStyles() {
	if (avesmapsDumpReportStylesInjected) {
		return;
	}
	avesmapsDumpReportStylesInjected = true;
	const css = `
.avm-dr-overlay{position:fixed;inset:0;z-index:var(--z-modal,5000);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto;background:rgba(40,28,14,.45);}
.avm-dr-card{width:100%;max-width:720px;}
/* Nur die Groesse bleibt hier: Aussehen, Radius und Grund kommen vom Bauteil. */
.avm-dr-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:var(--space-16) var(--space-20);}

.avm-dr-h1{font-size:var(--font-size-title,20px);font-weight:700;margin:0 0 3px;color:var(--color-text-strong);}
.avm-dr-meta{font-size:var(--font-size-small,12px);color:var(--color-text-muted);margin:0;}
.avm-dr-h2{font-size:var(--font-size-caption,11px);font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-accent-strong);margin:18px 0 0;}
.avm-dr-rule{height:1px;background:var(--color-divider);margin:6px 0 12px;border:0;}
.avm-dr-summary{font-size:var(--font-size-small,12px);color:var(--color-text-muted);margin:0 0 8px;}
.avm-dr-summary b{color:var(--color-text-strong);}
.avm-dr-run{list-style:none;margin:0 0 4px 0;padding:0;}
.avm-dr-run li{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--color-divider);}
.avm-dr-run li b{font-variant-numeric:tabular-nums;}
.avm-dr-run i{font-style:normal;opacity:.85;}
.avm-dr-down{color:var(--color-danger-soft-text);}
.avm-dr-up{color:var(--color-success-soft-text);}
.avm-dr-tests{list-style:none;margin:0;padding:0;}
.avm-dr-tests li{padding:6px 0;border-bottom:1px solid var(--color-divider);}
.avm-dr-tests li:last-child{border-bottom:0;}
.avm-dr-row{display:flex;align-items:center;gap:10px;font-size:var(--font-size-small,12px);}
.avm-dr-name{flex:1;min-width:0;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.avm-dr-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:var(--radius-md,8px);white-space:nowrap;}
.avm-dr-pill.ok{color:var(--color-success-soft-text,#3c5a1c);background:var(--color-success-soft,#eef6e2);border:1px solid var(--color-success-soft-border,#a9c07f);}
.avm-dr-pill.bad{color:var(--color-danger-soft-text,#8a2d22);background:var(--color-danger-soft,#fbeae6);border:1px solid var(--color-danger-soft-border,#d3a79c);}
.avm-dr-pill.pending{color:var(--color-text-muted);background:var(--color-panel-soft);border:1px solid var(--color-border);}
.avm-dr-fail{margin:6px 0 0;padding:9px 11px;background:var(--color-danger-soft,#fbeae6);border-left:3px solid var(--color-danger,#9d3a2e);border-radius:0 var(--radius-md,8px) var(--radius-md,8px) 0;font-size:11px;color:var(--color-danger-soft-text,#8a2d22);white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;max-height:180px;overflow:auto;}
.avm-dr-note{font-size:var(--font-size-small,12px);color:var(--color-text-muted);margin:16px 0 0;padding-top:12px;border-top:1px solid var(--color-divider);}
.avm-dr-foot{display:flex;gap:9px;flex-wrap:wrap;margin-top:11px;}
.avm-dr-btn{font:inherit;font-size:var(--font-size-body,13px);font-weight:700;border-radius:var(--radius-md,8px);padding:8px 15px;cursor:pointer;border:1px solid var(--color-button-soft-border);background:var(--color-button-soft);color:var(--color-button-soft-text);}
.avm-dr-btn.primary{background:var(--color-button);color:var(--color-button-text);border-color:var(--color-button-border);}
`;
	const style = document.createElement("style");
	style.id = "avm-dump-report-styles";
	style.textContent = css;
	document.head.appendChild(style);
}

function avesmapsDumpReportOnKey(event) {
	if (event.key === "Escape") {
		avesmapsDumpReportClose();
	}
}

function avesmapsDumpReportClose() {
	const overlay = document.getElementById("avm-dump-report-overlay");
	if (overlay && overlay.parentNode) {
		overlay.parentNode.removeChild(overlay);
	}
	document.removeEventListener("keydown", avesmapsDumpReportOnKey);
}

async function avesmapsDumpReportFetchJson(url) {
	const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
	let data = null;
	try {
		data = await response.json();
	} catch (parseError) {
		data = null;
	}
	return { status: response.status, data };
}

// Set the summary line from a bold lead + plain rest, via safe DOM (no innerHTML).
function avesmapsDumpReportSetSummary(el, boldText, restText) {
	el.textContent = "";
	if (boldText) {
		const strong = document.createElement("b");
		strong.textContent = boldText;
		el.appendChild(strong);
	}
	if (restText) {
		el.appendChild(document.createTextNode(restText));
	}
}

async function avesmapsDumpReportRunTests() {
	const listEl = document.getElementById("avm-dr-tests");
	const summaryEl = document.getElementById("avm-dr-summary");
	if (!listEl || !summaryEl) {
		return;
	}
	listEl.innerHTML = "";
	summaryEl.textContent = "Tests werden geprüft …";

	let manifest;
	try {
		manifest = await avesmapsDumpReportFetchJson("/api/edit/wiki/selftest.php?action=manifest");
	} catch (networkError) {
		avesmapsDumpReportSetSummary(summaryEl, "Test-Runner nicht erreichbar.");
		return;
	}
	if (manifest.status === 401 || manifest.status === 403) {
		avesmapsDumpReportSetSummary(summaryEl, "Editor-Login nötig", " — im Editor anmelden und erneut prüfen.");
		return;
	}
	if (!manifest.data || manifest.data.ok !== true || !Array.isArray(manifest.data.tests)) {
		const code = manifest.data && manifest.data.error ? manifest.data.error.code : "unbekannt";
		avesmapsDumpReportSetSummary(summaryEl, "Test-Liste nicht verfügbar", ` (${code}). Ist ein vollständiger Deploy gelaufen?`);
		return;
	}

	const tests = manifest.data.tests;
	let green = 0;
	let red = 0;
	summaryEl.textContent = `Läuft … 0/${tests.length}`;

	// One request per test, SEQUENTIAL -- gentle on STRATO (never fan out).
	for (let i = 0; i < tests.length; i++) {
		const test = tests[i];
		const li = document.createElement("li");
		const row = document.createElement("div");
		row.className = "avm-dr-row";
		const name = document.createElement("span");
		name.className = "avm-dr-name";
		name.textContent = test.label || test.key;
		const pill = document.createElement("span");
		pill.className = "avm-dr-pill pending";
		pill.textContent = "…";
		row.appendChild(name);
		row.appendChild(pill);
		li.appendChild(row);
		listEl.appendChild(li);

		let run;
		try {
			run = await avesmapsDumpReportFetchJson("/api/edit/wiki/selftest.php?action=run&test=" + encodeURIComponent(test.key));
		} catch (networkError) {
			run = { status: 0, data: null };
		}

		const d = run.data;
		if (d && d.ok === true && d.fatal === null && typeof d.passed === "number" && d.failed === 0) {
			pill.className = "avm-dr-pill ok";
			pill.textContent = `✓ ${d.passed}/${d.passed}`;
			green++;
		} else {
			red++;
			pill.className = "avm-dr-pill bad";
			if (d && typeof d.passed === "number" && typeof d.failed === "number") {
				pill.textContent = `✗ ${d.passed}/${d.passed + d.failed}`;
			} else if (run.status === 500 && d && d.error && d.error.code === "test_missing") {
				pill.textContent = "fehlt am Server";
			} else if (run.status === 401 || run.status === 403) {
				pill.textContent = "Login?";
			} else {
				pill.textContent = "Fehler";
			}

			const detail = document.createElement("div");
			detail.className = "avm-dr-fail";
			if (d && d.fatal) {
				detail.textContent = "FATAL: " + d.fatal;
			} else if (d && typeof d.output === "string" && d.output !== "") {
				const failLines = d.output.split("\n").filter((line) => /FAIL|RESULT|expected|actual/i.test(line));
				detail.textContent = (failLines.length ? failLines.join("\n") : d.output).slice(0, 4000);
			} else if (run.status === 500 && d && d.error && d.error.code === "test_missing") {
				// Wording matters here: the automatic deploy on every push IS a deploy, so
				// "einen Deploy auslösen" reads as already done and the message looks broken.
				// It has to name the ONE thing that is different -- push = only changed files,
				// and the manual run defaults to dry_run=true, which uploads nothing at all.
				detail.textContent = "Die Testdateien liegen noch nicht auf dem Server. Der automatische Deploy beim Push überträgt nur GEÄNDERTE Dateien — Testdateien, die sich nie ändern, kommen so nie an. Einmalig nötig: GitHub Actions → „Deploy Avesmaps to STRATO“ → Run workflow, dabei „dry_run“ auf false stellen (Standard ist true und lädt nichts hoch).";
			} else {
				detail.textContent = d && d.error && d.error.message ? d.error.message : "Unbekannter Fehler beim Ausführen des Tests.";
			}
			li.appendChild(detail);
		}
		summaryEl.textContent = `Läuft … ${i + 1}/${tests.length}`;
	}

	summaryEl.textContent = "";
	const totalB = document.createElement("b");
	totalB.textContent = String(tests.length);
	summaryEl.appendChild(totalB);
	summaryEl.appendChild(document.createTextNode(" Test-Dateien · "));
	const greenB = document.createElement("b");
	greenB.textContent = `${green} grün`;
	greenB.style.color = "var(--color-success)";
	summaryEl.appendChild(greenB);
	if (red) {
		summaryEl.appendChild(document.createTextNode(" · "));
		const redB = document.createElement("b");
		redB.textContent = `${red} rot`;
		redB.style.color = "var(--color-danger)";
		summaryEl.appendChild(redB);
	}
}

// Renders the "Lauf" section: what this run actually did. Returns HTML (safe -- every value is
// coerced to a number or picked from a fixed label map, no user text reaches innerHTML).
// `report` is either the draft the dump flow just built, or a stored one loaded from
// conflicts.php (same shape, plus an optional `delta` map from the server).
// ⏱️ Eine Dauer, wie ein Mensch sie liest. Unter einer Minute mit einer Nachkommastelle,
// darueber ohne -- "2.847,3 Sekunden" beantwortet die Frage nicht, die jemand hat.
function avesmapsDumpReportDauer(ms) {
	const zahl = Number(ms);
	if (!Number.isFinite(zahl) || zahl < 0) {
		return "";
	}
	const sekunden = zahl / 1000;
	if (sekunden < 60) {
		return sekunden.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " s";
	}
	const minuten = Math.floor(sekunden / 60);
	if (minuten < 60) {
		return minuten + " min " + String(Math.round(sekunden % 60)).padStart(2, "0") + " s";
	}
	return Math.floor(minuten / 60) + " h " + String(minuten % 60).padStart(2, "0") + " min";
}

function avesmapsDumpReportRunSectionHtml(report, delta) {
	if (!report || typeof report !== "object") {
		return "";
	}
	const steps = report.steps || {};
	const pub = steps.sync_publications || {};
	const rows = [];

	const entries = Number((steps.read && steps.read.entries) || 0);
	if (entries > 0) {
		rows.push(`<li><span>Einträge im Dump</span><b>${entries.toLocaleString("de-DE")}</b></li>`);
	}
	// Seit 2026-08-06 nennt diese Zeile UNTERSCHIEDE, nicht Schreibvorgänge: "Dump holen" endet in
	// einer Vorschau. Ein Bericht, der "+12 / ~3 / −1" sagt, obwohl niemand etwas übernommen hat,
	// wäre genau die Zahl, an der man später falsch abliest, was geschehen ist.
	// ⚠️ Ein ARCHIVIERTER Bericht trägt noch added/updated/removed -- der wird weiter so gezeigt und
	// nicht als 0 dargestellt: damals wurde wirklich geschrieben.
	if (pub.differences !== undefined || pub.planned !== undefined) {
		rows.push(`<li><span>Quellen-Unterschiede</span><b>${Number(pub.differences || 0).toLocaleString("de-DE")}</b></li>`);
	} else {
		rows.push(`<li><span>Publikationsquellen (übernommen)</span><b>+${Number(pub.added || 0)} / ~${Number(pub.updated || 0)} / −${Number(pub.removed || 0)}</b></li>`);
	}

	// Per-kind counts with the comparison to the previous run. A drop is what matters here --
	// the Art-gate incident swallowed ~430 adventures while the run reported success.
	const byKind = (steps.read && steps.read.by_kind) || {};
	Object.keys(byKind).sort().forEach((kind) => {
		const now = Number(byKind[kind] || 0);
		const d = delta && delta[kind] ? delta[kind] : null;
		let diffText = "";
		if (d && d.diff !== null && d.diff !== undefined && Number(d.diff) !== 0) {
			const diff = Number(d.diff);
			diffText = ` <i class="${diff < 0 ? "avm-dr-down" : "avm-dr-up"}">${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("de-DE")}</i>`;
		}
		rows.push(`<li><span>${kind}</span><b>${now.toLocaleString("de-DE")}${diffText}</b></li>`);
	});

	// ⏱️ Die Zeiten, wenn der Lauf welche mitgebracht hat. ⚠️ Ein ARCHIVIERTER Bericht von
	// vor dem 25.08.2026 hat keine -- dann faellt der Abschnitt ganz weg, statt Nullen zu
	// zeigen, die nach "ging sofort" aussaehen.
	const zeiten = report.zeiten || null;
	if (zeiten && Number(zeiten.gesamt_ms) > 0) {
		rows.push("<li><span>⏱️ Gesamtdauer</span><b>" + avesmapsDumpReportDauer(zeiten.gesamt_ms) + "</b></li>");

		const phasen = zeiten.phasen || {};
		Object.keys(phasen)
			.map((schluessel) => ({ schluessel, ...(phasen[schluessel] || {}) }))
			.filter((p) => Number(p.ms) > 0)
			.sort((a, b) => Number(b.ms) - Number(a.ms))
			.forEach((p) => {
				const name = WIKI_SYNC_DUMP_PHASE_LABELS[p.schluessel] || p.schluessel;
				const schritte = Number(p.schritte) > 0 ? " <i>" + Number(p.schritte) + " Schritte</i>" : "";
				rows.push("<li><span>↳ " + name + "</span><b>" + avesmapsDumpReportDauer(p.ms) + schritte + "</b></li>");
			});
	}

	const saveNote = report.save_failed
		? `<p class="avm-dr-summary">⚠️ Der Bericht konnte nicht gespeichert werden — der Lauf selbst ist davon unberührt.</p>`
		: "";

	return `
		<div class="avm-dr-h2">Lauf</div>
		<hr class="avm-dr-rule">
		<ul class="avm-dr-run">${rows.join("")}</ul>
		${saveNote}`;
}
