# Точка входа AI Task Tracker в этом репозитории: ./aitt.ps1 <команда доски> [параметры], например ./aitt.ps1 List.
# AITT ищется в переменной окружения AITT_HOME, иначе рядом с репозиторием: <папка репозитория>/../AiTaskTracker.
# Файл одинаков во всех проектах; его копирует в новый проект инструкция подключения (Docs/Projects.md в AITT).
$aittHome = if ($env:AITT_HOME) { $env:AITT_HOME } else { Join-Path (Split-Path -Parent $PSScriptRoot) 'AiTaskTracker' }
$taskBoard = Join-Path $aittHome 'Tools/TaskBoard.ps1'
if (-not (Test-Path -LiteralPath $taskBoard)) {
    Write-Error "AI Task Tracker not found at '$aittHome'. Clone https://github.com/Savidiy/AiTaskTracker next to this repository or set AITT_HOME."
    exit 1
}
# Ошибка привязки параметров при вызове через & не завершает скрипт сама: без catch код выхода был бы 0.
try {
    & $taskBoard @args -ProjectRoot $PSScriptRoot
} catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit 1
}
