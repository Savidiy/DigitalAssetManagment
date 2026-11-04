---
id: DAM-2
title: "Добавить в .gitattributes правило /aitt.ps1 text eol=lf"
executor: Claude
executor_model: claude-sonnet-5-5
executor_effort: medium
reviewer: null
reviewer_model: null
reviewer_effort: null
milestone: ""
branch: task/DAM-2-dobavit-v-gitattributes-pravilo-aitt-ps1
unity_editor_lock: false
unity_instance: null
machine: null
dependencies: []
related: ['AITT-744']
continues: []
moved_from: []
epics: []
not_before: null
created: 2026-11-02
submission_commit: 1c80fa3256c4a6d4c471b770eb3141c62ca5f0c5
submitted_at: 2026-11-04T22:56:50+03:00
---
## Цель

Tool developer: в репозитории DAM (DigitalAssetManagment) нет `.gitattributes` (на `master` файла нет), поэтому правила `/aitt.ps1 text eol=lf` (`Docs/Projects.md` AITT, «Подключить проект», п. 3) тоже нет, и при коммите `aitt.ps1` git предупреждает `LF will be replaced by CRLF`. Создать `.gitattributes` в корне репозитория с одной строкой `/aitt.ps1 text eol=lf` (если файл к началу работы уже появился — дописать строку в конец, существующие строки не менять).

## Критерии готовности

- [ ] В корне репозитория есть `.gitattributes`, содержащий строку `/aitt.ps1 text eol=lf`; других правил в нём нет.
- [ ] `git add --renormalize aitt.ps1` не выводит предупреждения `LF will be replaced by CRLF`; если `aitt.ps1` в индексе имел CRLF, перенормализация (только окончания строк) закоммичена вместе с правилом.
- [ ] `git diff --check` чисто; `aitt_validate` без ошибок.

## Роль исполнителя

Tool developer.

## Входные артефакты

- Пакет AITT-744 (`Outputs/CopyUpdate.md`, `Outputs/CoordinatorRequests.md`).
- Пакет AITT-744 лежит на доске проекта AITT (не DAM); если недоступен — задача исполнима и без него.

## Выходные артефакты

Правка `.gitattributes`.

## Разрешённые области изменений

`.gitattributes`, `aitt.ps1` (только окончания строк), пакет задачи.

## Не входит в задачу

Другие правки `.gitattributes`.

## Зависимости и контекст

Найдено в AITT-744.

## Проверка

`git diff --check`, `aitt_validate`.

## Отчёт исполнителя

- Commit: 1c80fa3256c4a6d4c471b770eb3141c62ca5f0c5
- Что изменено: Commit: 6bafabc. Изменено: добавлен .gitattributes с единственной строкой `/aitt.ps1 text eol=lf`. aitt.ps1 в индексе уже был LF (i/lf), перенормализация не потребовала изменений.
- Как проверено: `git add --renormalize aitt.ps1` — без предупреждений про aitt.ps1 (`git ls-files --eol`: i/lf w/lf attr/text eol=lf). `git diff --cached --check` — чисто. `aitt_validate DAM` — «Task board is valid». Предупреждение autocrlf касалось только самого .gitattributes в рабочей копии; в индексе он LF.
- Проблемы или решения, требующие человека: нет
