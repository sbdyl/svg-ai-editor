@echo off
setlocal
cd /d "%~dp0"
title Figura SVG Studio
where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)"
if errorlevel 1 goto missing_node
if not exist "node_modules\dompurify\package.json" goto install
if not exist "node_modules\pdfjs-dist\package.json" goto install
goto launch
:install
echo Installing project dependencies...
call npm install
if errorlevel 1 goto failed
:launch
if not defined PORT set "PORT=4317"
echo.
echo Figura SVG Studio
 echo Open in your browser: http://127.0.0.1:%PORT%
echo Keep this window open while using the editor.
echo Press Ctrl+C or close this window to stop the service.
echo.
call npm start
if errorlevel 1 goto failed
exit /b 0
:missing_node
echo Please install Node.js 22.13 or newer, including npm, then run this launcher again.
pause
exit /b 1
:failed
echo.
echo Startup failed. Check the error above. The port may already be in use.
pause
exit /b 1
