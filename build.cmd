@echo off
rem Builds the release APK into app\build\outputs\apk\release. Log: build.log
set "JAVA_HOME=C:\Users\Analyst Profile\Android\jdk-25.0.4.1+1"
set "ANDROID_HOME=C:\Users\Analyst Profile\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
set "PROJECT=%~dp0"
cd /d "%PROJECT%"
echo === GRADLE assembleRelease === > "%PROJECT%build.log"
call "%PROJECT%gradlew.bat" --no-daemon --console=plain --warning-mode=summary :app:assembleRelease >> "%PROJECT%build.log" 2>&1
echo BUILD_EXIT %ERRORLEVEL% >> "%PROJECT%build.log"
echo BUILD_EXIT %ERRORLEVEL%
