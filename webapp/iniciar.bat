@echo off
echo Iniciando RTCC 2026 Companion App...
echo.
echo Abri http://localhost:8080 en tu navegador
echo Presiona Ctrl+C para detener el servidor
echo.
start http://localhost:8080
python -m http.server 8080
