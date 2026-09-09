<?php
declare(strict_types=1);

function abs_truncate(string $value, int $maxLength): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maxLength);
    }

    preg_match_all('/./us', $value, $characters);
    return implode('', array_slice($characters[0] ?? [], 0, $maxLength));
}

function abs_clean_line(array $source, string $key, int $maxLength): string
{
    $value = (string)($source[$key] ?? '');
    $value = trim(str_replace(["\r", "\n", "\0"], ' ', $value));
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';
    return abs_truncate($value, $maxLength);
}

function abs_clean_text(array $source, string $key, int $maxLength): string
{
    $value = trim(str_replace("\0", '', (string)($source[$key] ?? '')));
    return abs_truncate($value, $maxLength);
}

function abs_validate_submission(array $source, ?int $nowMilliseconds = null): array
{
    $nowMilliseconds ??= (int)round(microtime(true) * 1000);
    $data = [
        'name' => abs_clean_line($source, 'name', 120),
        'phone' => abs_clean_line($source, 'phone', 40),
        'region' => abs_clean_line($source, 'region', 200),
        'comment' => abs_clean_text($source, 'comment', 2000),
        'consent' => abs_clean_line($source, 'consent', 10),
        'source' => abs_clean_line($source, 'source', 200),
        'source_url' => abs_clean_line($source, 'source_url', 500),
        'page_type' => abs_clean_line($source, 'page_type', 80),
        'city' => abs_clean_line($source, 'city', 120),
        'region_slug' => abs_clean_line($source, 'region_slug', 120),
    ];

    $errors = [];
    foreach (['name', 'phone'] as $required) {
        if ($data[$required] === '') {
            $errors[] = $required;
        }
    }

    $phoneDigits = preg_replace('/\D+/', '', $data['phone']) ?? '';
    if ($data['phone'] !== '' && (strlen($phoneDigits) < 10 || strlen($phoneDigits) > 15)) {
        $errors[] = 'phone';
    }

    if ($data['consent'] !== 'yes') {
        $errors[] = 'consent';
    }

    $honeypot = abs_clean_line($source, 'company_site', 200);
    $submittedAt = filter_var($source['submitted_at'] ?? null, FILTER_VALIDATE_INT);
    $tooFast = $submittedAt !== false && $submittedAt > 0 && ($nowMilliseconds - $submittedAt) < 1000;
    $spam = $honeypot !== '' || $tooFast;

    return [
        'valid' => count($errors) === 0 && !$spam,
        'spam' => $spam,
        'errors' => array_values(array_unique($errors)),
        'data' => $data,
    ];
}

function abs_build_message(array $data): string
{
    return "Новая заявка с сайта АБС\n\n"
        . "Источник: {$data['source']}\n"
        . "URL: {$data['source_url']}\n"
        . "Тип страницы: {$data['page_type']}\n"
        . "Город: {$data['city']}\n"
        . "Региональный slug: {$data['region_slug']}\n"
        . "Имя: {$data['name']}\n"
        . "Телефон: {$data['phone']}\n"
        . "Регион: {$data['region']}\n"
        . "Комментарий: {$data['comment']}\n";
}
