@echo off
setlocal

set "APP_ROOT=%~dp0"
set "PYTHON_EXE=%APP_ROOT%.venv\Scripts\python.exe"
set "PYTHON_COMMAND="

set "NEED_PYTHON="
set "NEED_NODE="

where python >nul 2>&1
if not errorlevel 1 (
  python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
  if not errorlevel 1 set "PYTHON_COMMAND=python"
)

if not defined PYTHON_COMMAND (
  py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
  if not errorlevel 1 set "PYTHON_COMMAND=py -3"
)

if not defined PYTHON_COMMAND set "NEED_PYTHON=1"

where npm >nul 2>&1
if errorlevel 1 set "NEED_NODE=1"

if defined NEED_PYTHON goto :missing_dependencies
if defined NEED_NODE goto :missing_dependencies

goto :start_application

:missing_dependencies
echo.
echo Reference Library needs the following software before it can start:
if defined NEED_PYTHON echo   - Python 3.11 or later ^(the installed version is missing or too old^)
if defined NEED_NODE echo   - Node.js LTS ^(includes npm^)
echo.
set "INSTALL_DEPENDENCIES="
set /p "INSTALL_DEPENDENCIES=Install the missing software automatically? [Y/N]: "
if /i "%INSTALL_DEPENDENCIES%"=="Y" goto :install_dependencies

echo.
if defined NEED_PYTHON echo Install Python from https://www.python.org/downloads/ and select "Add Python to PATH".
if defined NEED_NODE echo Install Node.js LTS from https://nodejs.org/
echo Close this window after installation, then run start.bat again.
goto :error

:install_dependencies
where winget >nul 2>&1
if errorlevel 1 (
  echo.
  echo Automatic installation requires Windows Package Manager ^(winget^), which is not available.
  if defined NEED_PYTHON echo Install Python from https://www.python.org/downloads/ and select "Add Python to PATH".
  if defined NEED_NODE echo Install Node.js LTS from https://nodejs.org/
  goto :error
)

:install_with_winget
if defined NEED_PYTHON (
  echo Installing Python...
  winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
  if errorlevel 1 goto :installation_failed
)

if defined NEED_NODE (
  echo Installing Node.js LTS...
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  if errorlevel 1 goto :installation_failed
)

echo.
echo Installation completed. Close this window and run start.bat again.
echo This lets Windows apply the updated PATH settings.
pause
exit /b 0

:start_application
if exist "%PYTHON_EXE%" (
  "%PYTHON_EXE%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
  if errorlevel 1 goto :python_environment_outdated
)

if not exist "%PYTHON_EXE%" (
  echo Creating Python environment...
  call %PYTHON_COMMAND% -m venv "%APP_ROOT%.venv"
  if errorlevel 1 goto :python_environment_failed
)

echo Checking Python dependencies...
"%PYTHON_EXE%" -m pip install -r "%APP_ROOT%backend\requirements.txt"
if errorlevel 1 goto :python_dependencies_failed

if not exist "%APP_ROOT%frontend\node_modules" (
  echo Installing frontend dependencies...
  pushd "%APP_ROOT%frontend"
  call npm install
  if errorlevel 1 goto :error
  popd
)

echo Building the interface...
pushd "%APP_ROOT%frontend"
call npm run build
if errorlevel 1 goto :error
popd

start "Reference Library API" /d "%APP_ROOT%" cmd /d /c call "%APP_ROOT%run_api.bat" "%PYTHON_EXE%" "%APP_ROOT%"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000"

echo Reference Library is starting in your browser.
exit /b 0

:installation_failed
echo.
echo The automatic installation did not complete. Review the message above,
echo then install the required software manually and run start.bat again.
pause
exit /b 1

:python_environment_failed
echo.
echo Python was found, but it could not create the virtual environment.
echo Install or repair Python 3.11 or later from https://www.python.org/downloads/
echo Make sure the optional "pip" component is selected during installation.
echo After that, run start.bat again.
pause
exit /b 1

:python_environment_outdated
echo.
echo The existing Python environment uses a version older than Python 3.11.
echo This causes errors such as "Unable to evaluate type annotation list[str]".
set "RECREATE_ENVIRONMENT="
set /p "RECREATE_ENVIRONMENT=Recreate this project's Python environment automatically? [Y/N]: "
if /i "%RECREATE_ENVIRONMENT%"=="Y" (
  echo Removing the old project environment...
  rmdir /s /q "%APP_ROOT%.venv"
  if exist "%APP_ROOT%.venv" goto :python_environment_remove_failed
  goto :start_application
)

echo Install Python 3.11 or later, then delete the .venv folder in this project
echo and run start.bat again.
pause
exit /b 1

:python_environment_remove_failed
echo.
echo The old .venv folder could not be removed. Close programs using this project
echo and run start.bat again.
pause
exit /b 1

:python_dependencies_failed
echo.
echo Python is installed, but the required Python packages could not be installed.
echo Check your Internet connection and proxy or antivirus settings, then run start.bat again.
echo If the problem continues, reinstall Python with the "pip" component selected.
pause
exit /b 1

:error
echo.
echo Could not start Reference Library. Check the error above.
pause
exit /b 1
