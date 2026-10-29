# Происхождение кода и адаптация

[English](UPSTREAM.md) | **Русский**

Проект адаптирует [Anthropic Code Modernization](https://github.com/anthropics/claude-plugins-official/tree/c8874f5ad883e26428f483ffa4d537cc81489e64/plugins/code-modernization)
по Apache-2.0. Исходники изучены 15 октября 2026 года с manifest 1.0.0;
закреплённый исходный commit — `c8874f5ad883e26428f483ffa4d537cc81489e64`.
Это неофициальный изменённый порт, а не дистрибутив Anthropic или OpenAI.

## Адаптированные исходники

- Исходные `commands/` и `agents/` задают процесс и инструкции ролей в локальных
  `skills/` и `agents/`. Три помощника панели происходят из `hooks/README.md`.
- Исходные `workflows/` задают порядок действий, заново реализованный через официальный
  Codex SDK в `runtime/workflows.mjs` и `runtime/engine.mjs`.
- `scripts/proof_pack.py`, `baseline_diff.py`, `trace_rules.py`, `uplift_checks.py`
  и семантика сравнения адаптированы на Node в `runtime/proof-*.mjs` и `runtime/compare.mjs`.
  Замороженный эталон тестов и его ограничения описаны в [tests/fixtures/README.md](../tests/fixtures/README.md).
- 21 чистый модуль исходных hooks адаптирован в `runtime/ui/upstream/`.
  Шаблон отчёта и включённый Mermaid также происходят из исходного проекта. JSX Claude
  и регистрация его hooks заменены локальным браузерным UI и lifecycle hooks Codex.

## Границы интеграции

Порт сохраняет имена команд, роли, направления модернизации, бизнес-артефакты и human
gates. SDK threads выполняют ограниченные задания; родительский чат координирует общие
файлы и решения человека. Node proof pack оценивает сохранённые свидетельства.

Python-утилиты runtime и телеметрия не распространяются. Hooks Codex не воспроизводят
нативный terminal dock Claude, редактирование prompt или мгновенное прерывание модели.
Поддержка regex при сравнении ограничена и не охватывает весь диалект Python `re`.
Контракты и ограничения: [SDK](../references/SDK.md), [UI](../references/UI.md),
[проверка](../references/VERIFICATION.md), [безопасность](../references/SECURITY.md).

SDK закреплён в `package.json`; его публичный API сверялся с
[исходниками OpenAI rust-v0.162.1](https://github.com/openai/codex/tree/rust-v0.162.1/sdk/typescript).
Изучение исходников и замороженные тесты не подтверждают полное соответствие оригиналу
или совместимость с любым хостом. Охват проверок описан в [TESTING.md](TESTING.ru.md).

## Атрибуция

[LICENSE](../LICENSE) содержит Apache-2.0. [NOTICE](../NOTICE) фиксирует авторство,
изменения, сторонние библиотеки и происхождение данных Unicode. Включённые лицензии
сохранены в `assets/vendor/`. Адаптированные Markdown-файлы указывают исходные пути.
Сохраняйте эти уведомления при распространении и изменении пакета.
