@echo off
setlocal

set "PYTHON_EXE=%~1"
set "APP_ROOT=%~2"

cd /d "%APP_ROOT%"
"%PYTHON_EXE%" -m backend.run_api
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" exit /b 0

echo.
echo The Reference Library API stopped because of an error (exit code %EXIT_CODE%).
echo Review the message above and logs\errors.log for technical details.
echo This window will stay open until you close it.
pause
exit /b %EXIT_CODE%
