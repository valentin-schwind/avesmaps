<?php
// wiki-proxy.php

header("Access-Control-Allow-Origin: *");

$page = $_GET["page"] ?? "";

if ($page === "") {
	http_response_code(400);
	header("Content-Type: application/json; charset=utf-8");
	echo json_encode([
		"error" => "missing_page",
		"message" => "Parameter 'page' fehlt."
	], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	exit;
}

$page = str_replace(" ", "_", $page);
$page = ltrim($page, "/");

$url = "https://de.wiki-aventurica.de/wiki/" . implode("/", array_map("rawurlencode", explode("/", $page)));

$ch = curl_init();

curl_setopt_array($ch, [
	CURLOPT_URL => $url,
	CURLOPT_RETURNTRANSFER => true,
	CURLOPT_FOLLOWLOCATION => true,
	CURLOPT_MAXREDIRS => 5,
	CURLOPT_CONNECTTIMEOUT => 15,
	CURLOPT_TIMEOUT => 45,
	CURLOPT_ENCODING => "",
	CURLOPT_HTTPHEADER => [
		"Accept: text/html,application/xhtml+xml",
		"User-Agent: Avesmaps/1.0 (https://avesmaps.de; political data import tool)"
	],
]);

$response = curl_exec($ch);

$curlError = curl_error($ch);
$curlErrno = curl_errno($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$effectiveUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);

curl_close($ch);

if ($response === false) {
	http_response_code(502);
	header("Content-Type: application/json; charset=utf-8");
	echo json_encode([
		"error" => "curl_failed",
		"message" => $curlError,
		"errno" => $curlErrno,
		"url" => $url
	], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	exit;
}

if ($httpCode < 200 || $httpCode >= 300) {
	http_response_code(502);
	header("Content-Type: application/json; charset=utf-8");
	echo json_encode([
		"error" => "wiki_http_error",
		"message" => "Wiki-Aventurica antwortete nicht erfolgreich.",
		"httpCode" => $httpCode,
		"contentType" => $contentType,
		"effectiveUrl" => $effectiveUrl,
		"url" => $url,
		"bodyPreview" => mb_substr($response, 0, 1000)
	], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	exit;
}

header("Content-Type: text/html; charset=utf-8");
echo $response;