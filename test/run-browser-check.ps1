param(
  [string]$AppUrl = 'http://127.0.0.1:8787/?q=DeepSeek%20V4',
  [string]$KeyflowUrl = '',
  [string]$ErrorUrl = '',
  [string]$EdgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  [int]$Port = 9223
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw '未找到 node，请先安装 Node.js 并加入 PATH。' }
if (-not (Test-Path $EdgePath)) {
  $candidate = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $candidate) { $EdgePath = $candidate } else { throw "未找到 Edge：$EdgePath" }
}

$profile = Join-Path ([System.IO.Path]::GetTempPath()) ("ds-search-cdp-" + [guid]::NewGuid().ToString('N'))
$env:APP_URL = $AppUrl
$env:CDP_PORT = "$Port"
$env:OUT_DIR = Join-Path $root 'docs'
if ($KeyflowUrl) { $env:KEYFLOW_URL = $KeyflowUrl } else { Remove-Item Env:KEYFLOW_URL -ErrorAction SilentlyContinue }
if ($ErrorUrl) { $env:ERROR_URL = $ErrorUrl } else { Remove-Item Env:ERROR_URL -ErrorAction SilentlyContinue }

$edgeArgs = @(
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-crash-reporter',
  '--hide-scrollbars',
  "--remote-debugging-port=$Port",
  '--remote-allow-origins=*',
  "--user-data-dir=$profile",
  'about:blank'
)

Write-Host "启动无头 Edge（CDP 端口 $Port）…"
$proc = Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden

$code = 1
try {
  Push-Location $root
  & $node 'test\cdp-check.mjs'
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  if ($proc -and -not $proc.HasExited) {
    taskkill /F /T /PID $proc.Id 2>&1 | Out-Null
  }
  Start-Sleep -Milliseconds 300
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}

exit $code
