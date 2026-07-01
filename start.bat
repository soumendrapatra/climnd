@echo off
echo Starting CLIMIND 2.0 Local Server...
echo Please leave this window open during your demo.
start http://localhost:8000
python -m http.server 8000
pause
