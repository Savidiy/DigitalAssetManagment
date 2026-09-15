# Reference Library

Локальная библиотека референсов: FastAPI backend и React frontend. Медиа и
sidecar-метаданные остаются в выбранной папке Library.

## Запуск

Самый простой вариант в Windows — дважды нажать [start.bat](start.bat).
При первом запуске файл создаст `.venv`, установит Python и frontend
зависимости, затем откроет приложение в браузере.

Ручной запуск:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
Push-Location frontend
npm install
npm run dev
Pop-Location
```

Затем запустите backend, который также раздаёт собранный интерфейс:

```powershell
uvicorn backend.main:app --reload --port 8000
```

Откройте `http://127.0.0.1:8000`.
