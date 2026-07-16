<?php
declare(strict_types=1);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: request.html');
    exit;
}

function cleanField(string $name): string
{
    return trim(str_replace(["\r", "\n"], ' ', $_POST[$name] ?? ''));
}

$name = cleanField('name');
$phone = cleanField('phone');
$email = filter_var(cleanField('email'), FILTER_VALIDATE_EMAIL) ?: '';
$specialist = cleanField('specialist');
$region = cleanField('region');
$comment = trim($_POST['comment'] ?? '');
$source = cleanField('source');

if ($name === '' || $phone === '' || $specialist === '' || $region === '') {
    header('Location: request.html?status=error');
    exit;
}

$recipient = 'info@abs-engineer.ru';
$subject = 'ABS: new personnel selection request';
$message = "New request from the ABS website\n\n"
    . "Source: {$source}\n"
    . "Name: {$name}\n"
    . "Phone: {$phone}\n"
    . "Email: {$email}\n"
    . "Specialists needed: {$specialist}\n"
    . "Region or object: {$region}\n"
    . "Comment: {$comment}\n";
$headers = [
    'Content-Type: text/plain; charset=UTF-8',
    'From: ABS Website <no-reply@abs-engineer.ru>',
];

if ($email !== '') {
    $headers[] = "Reply-To: {$email}";
}

$sent = mail($recipient, $subject, $message, implode("\r\n", $headers));
header('Location: request.html?status=' . ($sent ? 'success' : 'error'));
exit;
