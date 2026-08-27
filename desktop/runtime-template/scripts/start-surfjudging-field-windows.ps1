$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Get-ChildItem (Join-Path $root 'images/*.tar') | ForEach-Object { docker load -i $_.FullName | Out-Null }
docker compose --project-name surfjudging-field --env-file (Join-Path $root 'compose/.env') -f (Join-Path $root 'compose/compose.yaml') up -d
