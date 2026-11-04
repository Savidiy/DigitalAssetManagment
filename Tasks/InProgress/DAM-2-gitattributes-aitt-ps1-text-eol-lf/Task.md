---
id: DAM-2
title: "Добавить в .gitattributes правило /aitt.ps1 text eol=lf"
executor: Claude
executor_model: unknown
executor_effort: unknown
reviewer: null
reviewer_model: null
reviewer_effort: null
milestone: ""
branch: task/DAM-2-dobavit-v-gitattributes-pravilo-aitt-ps1
unity_editor_lock: false
unity_instance: DigitalAssetManagment-agent-1
machine: SAVIDIY-NOTE
dependencies: []
related: ['AITT-744']
continues: []
moved_from: []
epics: []
not_before: null
created: 2026-11-02
submission_commit: null
submitted_at: null
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

- Commit:
- Что изменено:
- Как проверено:
- Проблемы или решения, требующие человека:
