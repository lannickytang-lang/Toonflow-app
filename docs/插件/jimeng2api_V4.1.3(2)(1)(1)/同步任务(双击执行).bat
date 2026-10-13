@echo off
cd /d %~dp0
set PYTHON=%~dp0..\..\..\python-3.12\python.exe

if exist update.py (
    "%PYTHON%" update.py
    goto end
)

for %%f in (update*.pyd) do (
    set PYD_FILE=%%f
)

if defined PYD_FILE (
    "%PYTHON%" -c "import sys, os; sys.path.insert(0, os.getcwd()); import update; update.main()"
    goto end
)

echo ERROR: No update.py or update*.pyd found!
:end
pause