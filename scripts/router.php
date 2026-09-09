<?php

declare(strict_types=1);

$dist = realpath(__DIR__ . "/../dist");
$requestPath = parse_url($_SERVER["REQUEST_URI"] ?? "/", PHP_URL_PATH) ?: "/";
$relativePath = trim(rawurldecode($requestPath), "/");

if ($dist === false || str_contains($relativePath, "..")) {
    http_response_code(404);
    exit;
}

$target = $relativePath === ""
    ? $dist . "/index.html"
    : $dist . "/" . $relativePath;

if (is_dir($target)) {
    $target .= "/index.html";
}

if (is_file($target)) {
    return false;
}

http_response_code(404);
header("Content-Type: text/html; charset=utf-8");
readfile($dist . "/404.html");
