<?php
declare(strict_types=1);

require_once __DIR__ . '/form-lib.php';

function abs_redirect(string $location): never
{
    header('Cache-Control: no-store');
    header('Location: ' . $location, true, 303);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    abs_redirect('/request/');
}

session_set_cookie_params([
    'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Lax',
]);
session_start();

$now = time();
$attempts = array_values(array_filter(
    $_SESSION['abs_form_attempts'] ?? [],
    static fn (int $timestamp): bool => ($now - $timestamp) < 600
));

if (count($attempts) >= 5) {
    abs_redirect('/request/?status=error');
}

$attempts[] = $now;
$_SESSION['abs_form_attempts'] = $attempts;

$result = abs_validate_submission($_POST);
if ($result['spam']) {
    abs_redirect('/thanks/');
}

if (!$result['valid']) {
    abs_redirect('/request/?status=error');
}

$recipient = getenv('ABS_FORM_RECIPIENT') ?: 'info@abs-engineer.ru';
$subjectText = 'АБС: новая заявка на подбор персонала';
$subject = '=?UTF-8?B?' . base64_encode($subjectText) . '?=';
$message = abs_build_message($result['data']);
$headers = [
    'Content-Type: text/plain; charset=UTF-8',
    'From: ABS Website <no-reply@abs-engineer.ru>',
    'Reply-To: ' . $recipient,
    'X-Mailer: PHP/' . PHP_VERSION,
];

$transport = getenv('ABS_FORM_TRANSPORT') ?: 'mail';
if ($transport === 'file') {
    $storage = dirname(__DIR__) . '/var';
    if (!is_dir($storage)) {
        mkdir($storage, 0770, true);
    }
    $record = json_encode([
        'recipient' => $recipient,
        'subject' => $subjectText,
        'data' => $result['data'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $sent = $record !== false && file_put_contents($storage . '/submissions.log', $record . PHP_EOL, FILE_APPEND | LOCK_EX) !== false;
} else {
    $sent = mail($recipient, $subject, $message, implode("\r\n", $headers));
}

abs_redirect($sent ? '/thanks/' : '/request/?status=error');
