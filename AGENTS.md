# AGENTS.md

Общие правила агентов, протокол доски и роли — в AI Task Tracker: прочитай `../AiTaskTracker/AGENTS.md` (или `$env:AITT_HOME/AGENTS.md`). Ниже — только правила этого проекта.

## Проект

Reference Library — локальная библиотека референсов: FastAPI backend (`backend/`) и React + Vite frontend (`frontend/`). Запуск и ручная сборка — `README.md`. Unity-проекта нет.

- Основная ветка — `master`.
- Задачи — на доске `Tasks/` этого репозитория, префикс `DAM`.
- Проверка проекта (она же `integrateCheck` в `aitt.project.json`): `python -m compileall -q backend`, затем в `frontend/` — `npm ci` и `npm run build` (проверка типов `tsc` и сборка Vite). Автотестов в проекте пока нет.
