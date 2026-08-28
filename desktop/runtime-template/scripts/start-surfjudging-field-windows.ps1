$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$docker = if ($env:SURFJUDGING_DOCKER_BIN) { $env:SURFJUDGING_DOCKER_BIN } else { 'docker' }
$stateDir = if ($env:SURFJUDGING_STATE_DIR) { $env:SURFJUDGING_STATE_DIR } else { Join-Path $env:APPDATA 'SurfJudging/runtime' }
$composeDir = Join-Path $stateDir 'compose'
Write-Output "FIELD_STAGE staging-config $composeDir"
New-Item -ItemType Directory -Force -Path $composeDir | Out-Null
$persistentEnv = Join-Path $composeDir '.env'
if (-not (Test-Path $persistentEnv)) { Copy-Item (Join-Path $root 'compose/.env') $persistentEnv }
Copy-Item (Join-Path $root 'compose/compose.yaml') (Join-Path $composeDir 'compose.yaml') -Force
Copy-Item (Join-Path $root 'compose/kong.yml') (Join-Path $composeDir 'kong.yml') -Force

$plan = Get-Content (Join-Path $root 'images/load-plan.tsv')
$current = 0
foreach ($line in $plan) {
  $parts = $line -split "`t", 2
  if ($parts.Count -ne 2) { throw "Invalid image load plan" }
  $current += 1
  & $docker image inspect $parts[1] *> $null
  if ($LASTEXITCODE -eq 0) { Write-Output "FIELD_STAGE image-ready $current/$($plan.Count) $($parts[1])" }
  else { Write-Output "FIELD_STAGE image-load $current/$($plan.Count) $($parts[1])"; & $docker load -i (Join-Path $root "images/$($parts[0])") | Out-Null }
}
Write-Output 'FIELD_STAGE database-upgrade-check'
& (Join-Path $root 'scripts/upgrade-field-database-windows.ps1')
Write-Output 'FIELD_STAGE kong-config'
$kongConfigVolume = 'surfjudging_field_kong_config'
$kongConfigSeed = 'surfjudging_field_kong_config_seed'
& $docker rm -f $kongConfigSeed *> $null
& $docker volume create $kongConfigVolume | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to create the internal Kong configuration volume' }
& $docker create --name $kongConfigSeed -v "${kongConfigVolume}:/var/lib/kong" kong:2.8.1 true | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to create the Kong configuration seed container' }
& $docker cp (Join-Path $root 'compose/kong.yml') "${kongConfigSeed}:/var/lib/kong/kong.yml"
if ($LASTEXITCODE -ne 0) { throw 'Unable to stage Kong configuration' }
& $docker rm $kongConfigSeed | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to finalize Kong configuration' }
Write-Output 'FIELD_STAGE compose-start'
& $docker compose --project-name surfjudging-field --env-file $persistentEnv -f (Join-Path $composeDir 'compose.yaml') up -d
Write-Output 'FIELD_STAGE compose-finished'
