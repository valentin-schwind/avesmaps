const SPREADSHEET_ID = "1BCAH1WFP49YqcMYAYK2GEBf_IGmy3KM9hrWqTqMGebo";
const SHEET_NAME = "Ortsmeldungen";
const MESSAGE_TYPE = "avesmaps-location-report-result";
const HEADER_ROW = [
    "created_at",
    "status",
    "name",
    "size",
    "lat",
    "lng",
    "source",
    "wiki_url",
    "comment",
    "page_url",
    "client_version",
    "review_note",
];
const ALLOWED_LOCATION_SIZES = new Set(["dorf", "kleinstadt", "stadt", "grossstadt", "metropole"]);
const MAX_NAME_LENGTH = 80;
const MAX_SOURCE_LENGTH = 200;
const MAX_WIKI_URL_LENGTH = 300;
const MAX_COMMENT_LENGTH = 800;
const MAX_RESPONSE_BRIDGE_URL_LENGTH = 500;
const MAX_MAP_COORDINATE = 1024;
const MAX_LOG_PREVIEW_LENGTH = 800;

function doGet() {
    return ContentService
        .createTextOutput("Avesmaps Ortsmeldungen Web App ist erreichbar.")
        .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
    logDebug("location_report_request_received", buildRequestDebugSummary(e));

    try {
        const report = parseLocationReportPayload(e);
        logDebug("location_report_payload_parsed", buildParsedReportDebugSummary(report));

        if (report.isSpam) {
            logDebug("location_report_marked_as_spam", {
                responseBridgeUrl: report.responseBridgeUrl,
            });
            return buildIframeResponse({
                ok: true,
                message: "Ort wurde gemeldet.",
            }, report.responseBridgeUrl);
        }

        const lock = LockService.getScriptLock();
        lock.waitLock(5000);

        try {
            const sheet = getOrCreateSubmissionSheet();
            sheet.appendRow([
                new Date().toISOString(),
                "neu",
                report.name,
                report.size,
                report.lat,
                report.lng,
                report.source,
                report.wikiUrl,
                report.comment,
                report.pageUrl,
                report.clientVersion,
                "",
            ]);
            logDebug("location_report_row_written", {
                sheetName: SHEET_NAME,
                lastRow: sheet.getLastRow(),
                name: report.name,
                size: report.size,
                lat: report.lat,
                lng: report.lng,
            });
        } finally {
            lock.releaseLock();
        }

        return buildIframeResponse({
            ok: true,
            message: "Ort wurde gemeldet.",
        }, report.responseBridgeUrl);
    } catch (error) {
        logError("location_report_request_failed", error, buildRequestDebugSummary(e));
        return buildIframeResponse({
            ok: false,
            error: error && error.message ? error.message : "Die Ortsmeldung konnte nicht verarbeitet werden.",
        });
    }
}

function parseLocationReportPayload(e) {
    const params = e && e.parameter ? e.parameter : {};
    const responseBridgeUrl = normalizeOptionalUrl(
        params.response_bridge_url,
        MAX_RESPONSE_BRIDGE_URL_LENGTH,
        "Die Ruecksprung-URL ist ungueltig."
    );

    if (normalizeSingleLine(params.website, 100)) {
        return {
            isSpam: true,
            responseBridgeUrl,
        };
    }

    const name = requireNonEmptyField(params.name, "Bitte einen Ortsnamen angeben.", MAX_NAME_LENGTH);
    const size = normalizeSingleLine(params.size, 40).toLowerCase();
    const source = requireNonEmptyField(params.source, "Bitte eine Quelle angeben.", MAX_SOURCE_LENGTH);
    const wikiUrl = normalizeOptionalUrl(params.wiki_url, MAX_WIKI_URL_LENGTH, "Der Wiki-Link muss mit http:// oder https:// beginnen.");
    const comment = normalizeMultiline(params.comment, MAX_COMMENT_LENGTH);
    const pageUrl = normalizeOptionalUrl(params.page_url, 500, "Die Seiten-URL ist ungueltig.");
    const clientVersion = normalizeSingleLine(params.client_version, 80);
    const lat = parseMapCoordinate(params.lat, "lat");
    const lng = parseMapCoordinate(params.lng, "lng");

    if (!ALLOWED_LOCATION_SIZES.has(size)) {
        throw new Error("Die Ortsgroesse ist ungueltig.");
    }

    return {
        isSpam: false,
        name,
        size,
        source,
        wikiUrl,
        comment,
        pageUrl,
        clientVersion,
        responseBridgeUrl,
        lat,
        lng,
    };
}

function getOrCreateSubmissionSheet() {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);

    if (!sheet) {
        sheet = spreadsheet.insertSheet(SHEET_NAME);
    }

    ensureHeaderRow(sheet);
    return sheet;
}

function ensureHeaderRow(sheet) {
    const headerRange = sheet.getRange(1, 1, 1, HEADER_ROW.length);
    const existingHeader = headerRange.getValues()[0];
    const isHeaderMissing = existingHeader.every((value) => String(value || "").trim() === "");

    if (isHeaderMissing) {
        headerRange.setValues([HEADER_ROW]);
        sheet.setFrozenRows(1);
    }
}

function requireNonEmptyField(value, errorMessage, maxLength) {
    const normalizedValue = normalizeSingleLine(value, maxLength);
    if (!normalizedValue) {
        throw new Error(errorMessage);
    }

    return normalizedValue;
}

function normalizeSingleLine(value, maxLength) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function normalizeMultiline(value, maxLength) {
    return String(value || "")
        .replace(/\r\n/g, "\n")
        .trim()
        .slice(0, maxLength);
}

function normalizeOptionalUrl(value, maxLength, errorMessage) {
    const normalizedValue = normalizeSingleLine(value, maxLength);
    if (!normalizedValue) {
        return "";
    }

    if (!/^https?:\/\//i.test(normalizedValue)) {
        throw new Error(errorMessage);
    }

    return normalizedValue;
}

function parseMapCoordinate(value, fieldName) {
    const parsedValue = Number.parseFloat(String(value || ""));
    if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > MAX_MAP_COORDINATE) {
        throw new Error(`Die Koordinate ${fieldName} ist ungueltig.`);
    }

    return Number(parsedValue.toFixed(3));
}

function buildRequestDebugSummary(e) {
    const params = e && e.parameter ? e.parameter : {};
    const postData = e && e.postData ? e.postData : null;

    return {
        parameterKeys: Object.keys(params).sort(),
        parameterPreview: buildParameterPreview(params),
        contentLength: e && typeof e.contentLength === "number" ? e.contentLength : null,
        postDataType: postData && postData.type ? postData.type : "",
        postDataLength: postData && typeof postData.contents === "string" ? postData.contents.length : 0,
        postDataPreview: truncateForLog(postData && typeof postData.contents === "string" ? postData.contents : ""),
        queryString: truncateForLog(e && e.queryString ? e.queryString : ""),
    };
}

function buildParameterPreview(params) {
    return {
        name: truncateForLog(params.name),
        size: truncateForLog(params.size),
        lat: truncateForLog(params.lat),
        lng: truncateForLog(params.lng),
        source: truncateForLog(params.source),
        wiki_url: truncateForLog(params.wiki_url),
        comment: truncateForLog(params.comment),
        page_url: truncateForLog(params.page_url),
        client_version: truncateForLog(params.client_version),
        response_bridge_url: truncateForLog(params.response_bridge_url),
        website: truncateForLog(params.website),
    };
}

function buildParsedReportDebugSummary(report) {
    return {
        isSpam: Boolean(report.isSpam),
        name: truncateForLog(report.name),
        size: truncateForLog(report.size),
        lat: report.lat,
        lng: report.lng,
        hasSource: Boolean(report.source),
        hasWikiUrl: Boolean(report.wikiUrl),
        hasComment: Boolean(report.comment),
        pageUrl: truncateForLog(report.pageUrl),
        clientVersion: truncateForLog(report.clientVersion),
        responseBridgeUrl: truncateForLog(report.responseBridgeUrl),
    };
}

function logDebug(label, details) {
    console.log(JSON.stringify({
        label,
        timestamp: new Date().toISOString(),
        details,
    }));
}

function logError(label, error, details) {
    console.error(JSON.stringify({
        label,
        timestamp: new Date().toISOString(),
        details,
        error: {
            message: error && error.message ? String(error.message) : String(error || ""),
            stack: error && error.stack ? truncateForLog(error.stack, 2000) : "",
        },
    }));
}

function truncateForLog(value, maxLength) {
    const normalizedValue = String(value || "").replace(/\s+/g, " ").trim();
    const finalMaxLength = typeof maxLength === "number" && maxLength > 0 ? maxLength : MAX_LOG_PREVIEW_LENGTH;

    if (normalizedValue.length <= finalMaxLength) {
        return normalizedValue;
    }

    return `${normalizedValue.slice(0, finalMaxLength)}…`;
}

function buildIframeResponse(payload, responseBridgeUrl) {
    const safePayload = JSON.stringify({
        type: MESSAGE_TYPE,
        ok: Boolean(payload.ok),
        message: payload.message || "",
        error: payload.error || "",
    }).replace(/</g, "\\u003c");
    const safeResponseBridgeUrl = JSON.stringify(String(responseBridgeUrl || "")).replace(/</g, "\\u003c");

    return HtmlService
        .createHtmlOutput(`<!DOCTYPE html>
<html lang="de">
	<head>
		<meta charset="UTF-8" />
		<title>Avesmaps Ortsmeldung</title>
	</head>
	<body>
		<script>
			(function () {
				const payload = ${safePayload};
				const responseBridgeUrl = ${safeResponseBridgeUrl};

				if (responseBridgeUrl) {
					const bridgeUrl = new URL(responseBridgeUrl);
					bridgeUrl.hash = "payload=" + encodeURIComponent(JSON.stringify(payload));
					window.location.replace(bridgeUrl.toString());
					return;
				}

				window.parent.postMessage(payload, "*");
			})();
		</script>
	</body>
</html>`)
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
