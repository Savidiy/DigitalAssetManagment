# Точка входа AI Task Tracker в этом репозитории: ./aitt.ps1 <команда доски> [параметры], например ./aitt.ps1 List.
# AITT ищется по порядку: переменная окружения AITT_HOME; рядом с репозиторием (<папка репозитория>/../AiTaskTracker);
# в раскладке «папка проекта» (репозиторий лежит в контейнере <корень>/<Проект>/<Проект>-main, у коннектора в .../board/) —
# <корень>/AiTaskTracker/AiTaskTracker-main; те же места для основной копии, если это git worktree (временная папка ревью или проверки);
# запись AITT в реестре машины (~/.aitt/projects.json, AITT_PROJECTS); сам репозиторий, если это AITT.
# Файл одинаков во всех проектах; его копирует в новый проект инструкция подключения (Docs/Projects.md в AITT).
function Get-AittCandidates([string]$Repository) {
    $parent = Split-Path -Parent $Repository
    if (-not $parent) { return }
    Join-Path $parent 'AiTaskTracker'
    # Контейнер: репозиторий в <контейнер>, корень проектов — его родитель; у коннектора репозиторий C лежит ещё на уровень глубже, в board/.
    $container = Split-Path -Parent $parent
    if ($container) { Join-Path $container 'AiTaskTracker/AiTaskTracker-main' }
    $root = if ($container) { Split-Path -Parent $container }
    if ($root) { Join-Path $root 'AiTaskTracker/AiTaskTracker-main' }
}
function Get-RegisteredAitt {
    $registry = if ($env:AITT_PROJECTS) { $env:AITT_PROJECTS } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.aitt/projects.json' }
    try {
        if (Test-Path -LiteralPath $registry) {
            $entry = (Get-Content -LiteralPath $registry -Raw | ConvertFrom-Json).projects.AITT
            if ($entry) { [string]$entry }
        }
    } catch { }
}
$candidates = if ($env:AITT_HOME) { @($env:AITT_HOME) } else {
    Get-AittCandidates $PSScriptRoot
    # Общая папка .git у worktree — в основной копии; у обычного репозитория совпадает с его собственной.
    $commonDir = & git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir 2>$null
    if ($LASTEXITCODE -eq 0 -and $commonDir) { Get-AittCandidates (Split-Path -Parent $commonDir) }
    Get-RegisteredAitt
    $PSScriptRoot
}
$taskBoard = $candidates | ForEach-Object { Join-Path $_ 'Tools/TaskBoard.ps1' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $taskBoard) {
    Write-Error "AI Task Tracker not found at '$(@($candidates | Select-Object -Unique) -join "', '")'. Clone https://github.com/Savidiy/AiTaskTracker next to this repository or set AITT_HOME."
    exit 1
}
# pwsh -File (и pwsh ./aitt.ps1) сам режет аргумент, который начинается с дефиса и содержит двоеточие, как -Имя:значение:
# текст «- BoardE2E (full): passed» доходил до скрипта двумя аргументами без двоеточия (AITT-129). Поэтому при запуске
# этого файла отдельным процессом аргументы берутся из командной строки процесса и связываются с параметрами TaskBoard
# по именам: значение параметра — следующий аргумент целиком. В процессе PowerShell (& ./aitt.ps1) $args уже верен.
function Split-LikePwshFile([string[]]$Tokens) {
    foreach ($token in $Tokens) {
        $colon = $token.IndexOf(':')
        if ($token.Length -gt 1 -and $token[0] -in '-', '–', '—', '―' -and $colon -gt 1) {
            '-' + $token.Substring(1, $colon - 1)
            if ($colon -lt $token.Length - 1) { $token.Substring($colon + 1) -replace '^\$(true|false)$', '$1' }
        } else { $token }
    }
}
function Get-ProcessArguments([object[]]$Bound) {
    $commandLine = [Environment]::GetCommandLineArgs()
    for ($i = 1; $i -lt $commandLine.Count; $i++) {
        if ([IO.Path]::GetFileName($commandLine[$i]) -ne [IO.Path]::GetFileName($PSCommandPath)) { continue }
        $tail = @($commandLine | Select-Object -Skip ($i + 1))
        # Хвост командной строки, разобранный как pwsh -File, должен дать ровно $args: иначе это не наш запуск.
        $split = @(Split-LikePwshFile $tail)
        if ($split.Count -ne $Bound.Count) { continue }
        $same = $true
        for ($j = 0; $j -lt $split.Count; $j++) { if ("$($split[$j])" -ine "$($Bound[$j])") { $same = $false; break } }
        if ($same) { return , $tail }
    }
    return $null
}
function Resolve-TaskBoardParameter([System.Collections.IDictionary]$Parameters, [string]$Name) {
    $exact = @($Parameters.Values | Where-Object { $_.Name -eq $Name -or $_.Aliases -contains $Name })
    if ($exact.Count -gt 0) { return $exact[0] }
    $prefixed = @($Parameters.Values | Where-Object { $_.Name -like "$Name*" })
    if ($prefixed.Count -gt 1) { throw "Parameter name '$Name' is ambiguous. Possible matches include: -$($prefixed.Name -join ' -')." }
    return $prefixed | Select-Object -First 1
}
function ConvertTo-TaskBoardArguments([string[]]$Tokens) {
    $parameters = (Get-Command -Name $taskBoard).Parameters
    $named = @{}
    $positional = [System.Collections.Generic.List[object]]::new()
    for ($i = 0; $i -lt $Tokens.Count; $i++) {
        $token = $Tokens[$i]
        $parameter = if ($token -match '(?s)^[-–—―]([A-Za-z_]\w*)(?:(:)(.*))?$') { Resolve-TaskBoardParameter $parameters $Matches[1] }
        if (-not $parameter) { $positional.Add($token); continue }
        if ($named.ContainsKey($parameter.Name)) { throw "Parameter '$($parameter.Name)' is specified more than once." }
        if ($Matches[2]) { $value = $Matches[3] }
        elseif ($parameter.SwitchParameter) { $value = 'true' }
        elseif ($i + 1 -lt $Tokens.Count) { $i++; $value = $Tokens[$i] }
        else { throw "Missing an argument for parameter '$($parameter.Name)'." }
        $named[$parameter.Name] = if ($parameter.SwitchParameter) { $value -notmatch '^\$?(false|0)$' } else { $value }
    }
    return @{ Named = $named; Positional = $positional.ToArray() }
}
# -ProjectRoot точка входа задаёт сама (папка этого файла): переданное снаружи значение молча подменялось бы, и команда
# уходила бы на доску этой копии (AITT-432: New -ProjectRoot <другой проект> завёл карточки на доске AITT). Поэтому отказ.
function Assert-NoProjectRootArgument([object[]]$Tokens) {
    $parameters = (Get-Command -Name $taskBoard).Parameters
    foreach ($token in $Tokens) {
        if ("$token" -match '(?s)^[-–—―]([A-Za-z_]\w*)(?::|$)' -and (Resolve-TaskBoardParameter $parameters $Matches[1]).Name -eq 'ProjectRoot') {
            throw "aitt.ps1 does not accept -ProjectRoot: the project is the repository this aitt.ps1 lies in ($PSScriptRoot). Run ./aitt.ps1 from the main copy of the needed project, or use the board command server (aitt_* with 'project')."
        }
    }
}
# Ошибка привязки параметров при вызове через & не завершает скрипт сама: без catch код выхода был бы 0.
try {
    Assert-NoProjectRootArgument $args
    $processArguments = Get-ProcessArguments $args
    if ($null -eq $processArguments) {
        & $taskBoard @args -ProjectRoot $PSScriptRoot
    } else {
        $converted = ConvertTo-TaskBoardArguments $processArguments
        $named = $converted.Named
        $named['ProjectRoot'] = $PSScriptRoot
        $positional = $converted.Positional
        & $taskBoard @positional @named
    }
} catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit 1
}
