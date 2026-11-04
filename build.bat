@echo off
setlocal
call npm run dev-build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
echo Build completed. See the dist folder.
endlocal
