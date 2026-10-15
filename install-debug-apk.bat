@echo off
set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
"%ADB%" devices
"%ADB%" install -r "%~dp0android\app\build\outputs\apk\debug\app-debug.apk"
"%ADB%" shell monkey -p com.mps.allinone -c android.intent.category.LAUNCHER 1
pause
