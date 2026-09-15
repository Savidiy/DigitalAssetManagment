@echo off
setlocal

set "APP_ROOT=%~dp0"
set "PYTHON_EXE=%APP_ROOT%.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
  echo Creating Python environment...
  python -m venv "%APP_ROOT%.venv"
  if errorlevel 1 goto :error
  "%PYTHON_EXE%" -m pip install -r "%APP_ROOT%backend\requirements.txt"
  if errorlevel 1 goto :error
)

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

start "Reference Library API" /d "%APP_ROOT%" cmd /c ""%PYTHON_EXE%" -m uvicorn backend.main:app --port 8000"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000"

echo Reference Library is starting in your browser.
exit /b 0

:error
echo.
echo Could not start Reference Library. Check the error above.
pause
exit /b 1
