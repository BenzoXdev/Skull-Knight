@echo off
echo === Building Skull Knight Desktop ===
python "%~dp0open_github.py"
cd /d "%~dp0skull-knight-Desktop"
call npm install
call npm run build:win
echo === Done ===
pause
