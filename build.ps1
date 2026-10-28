# Полная сборка AveSTT: exe + два установщика (полный и обновление) в папке dist\
# Запуск: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$py = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Создаю виртуальное окружение (нужен Python 3.12)..."
    py -V:3.12 -m venv .venv
    & $py -m pip install --upgrade pip
}
& $py -m pip install -q -r requirements.txt pyinstaller pillow

$version = (& $py -c "from app.version import __version__; print(__version__)").Trim()
Write-Host "Версия: $version"
$parts = ($version.Split(".") + @("0", "0", "0"))[0..3] -join ", "

@"
VSVersionInfo(
  ffi=FixedFileInfo(filevers=($parts), prodvers=($parts)),
  kids=[StringFileInfo([StringTable('041904B0', [
    StringStruct('CompanyName', 'AveSTT'),
    StringStruct('FileDescription', 'AveSTT — расшифровка аудио и видео'),
    StringStruct('FileVersion', '$version'),
    StringStruct('ProductName', 'AveSTT'),
    StringStruct('ProductVersion', '$version')])]),
    VarFileInfo([VarStruct('Translation', [1049, 1200])])]
)
"@ | ForEach-Object { [IO.File]::WriteAllText("$PSScriptRoot\packaging\version_info.txt", $_, (New-Object Text.UTF8Encoding $false)) }

if (-not (Test-Path assets\icon.ico)) { & $py packaging\make_icon.py }

# Встроенная модель (кладётся в полный установщик, чтобы всё работало без интернета)
if (-not (Test-Path bundle\models\small\model.bin)) {
    Write-Host "Скачиваю встроенную модель small..."
    & $py -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-small', local_dir=r'bundle\models\small', allow_patterns=['*.json','*.bin','*.txt'])"
    Remove-Item -Recurse -Force bundle\models\small\.cache -ErrorAction SilentlyContinue
}

# Загрузчик WebView2 — ставится только на компьютеры, где его нет (редкие Windows 10)
if (-not (Test-Path packaging\MicrosoftEdgeWebview2Setup.exe)) {
    Invoke-WebRequest "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile packaging\MicrosoftEdgeWebview2Setup.exe
}

Write-Host "Собираю программу..."
& $py -m PyInstaller packaging\AveSTT.spec --noconfirm --clean --distpath dist --workpath build
if ($LASTEXITCODE) { throw "PyInstaller завершился с ошибкой" }

$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Не найден Inno Setup 6. Установите: winget install JRSoftware.InnoSetup" }

Write-Host "Собираю установщики..."
& $iscc /Q "/DAppVersion=$version" /DWithModel packaging\AveSTT.iss
if ($LASTEXITCODE) { throw "Ошибка сборки полного установщика" }
& $iscc /Q "/DAppVersion=$version" packaging\AveSTT.iss
if ($LASTEXITCODE) { throw "Ошибка сборки установщика-обновления" }

Get-ChildItem dist\*.exe | ForEach-Object { "{0}  {1:N0} МБ" -f $_.Name, ($_.Length / 1MB) }
