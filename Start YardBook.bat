@echo off
title Graybeard's YardBook
cd /d "%~dp0"

echo.
echo  ^| Graybeard's YardBook
echo  ^| Starting server at http://localhost:8766 ...
echo  ^| Close this window to stop the server.
echo.

:: Open browser 1 second after server starts (minimized cmd disappears on its own)
start /min cmd /c "timeout /t 1 /nobreak > nul && start http://localhost:8766"

:: Start static file server in foreground — close window to stop
C:\Python314\python.exe -m http.server 8766
pause
