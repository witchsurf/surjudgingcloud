$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$docker = if ($env:SURFJUDGING_DOCKER_BIN) { $env:SURFJUDGING_DOCKER_BIN } else { 'docker' }
$container = if ($env:SURFJUDGING_POSTGRES_CONTAINER) { $env:SURFJUDGING_POSTGRES_CONTAINER } else { 'surfjudging_field_postgres' }
$target = (Get-Content (Join-Path $root 'database/expected-schema.txt') -Raw).Trim()

& $docker container inspect $container *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Output 'FIELD_STAGE database-upgrade-not-required fresh-runtime'
  exit 0
}

$running = (& $docker inspect -f '{{.State.Running}}' $container).Trim()
if ($running -ne 'true') { & $docker start $container | Out-Null }

for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  & $docker exec $container pg_isready -U postgres -d postgres *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
}
& $docker exec $container pg_isready -U postgres -d postgres *> $null
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not become ready for the Field upgrade.' }

$current = (& $docker exec $container psql -U postgres -d postgres -Atc 'select schema_version from public.app_runtime_schema_version where id = true').Trim()
if ($current -eq $target) {
  Write-Output "FIELD_STAGE database-schema-ready $target"
  exit 0
}

$foundCurrent = $false
$applied = 0
$migrations = Get-ChildItem (Join-Path $root 'database/migrations') -Filter '*.sql' | Sort-Object Name
foreach ($migration in $migrations) {
  $schema = $migration.BaseName
  if ($schema -notmatch '^[0-9]{14}_[A-Za-z0-9_]+$') { throw "Invalid Field migration filename: $($migration.Name)" }
  if ($schema -eq $current) { $foundCurrent = $true; continue }
  if (-not $foundCurrent) { continue }
  Write-Output "FIELD_STAGE database-migration $schema"
  $containerMigration = "/tmp/surfjudging-field-$schema.sql"
  & $docker cp $migration.FullName "${container}:$containerMigration"
  if ($LASTEXITCODE -ne 0) { throw "Unable to stage Field migration: $schema" }
  $migrationExit = 1
  try {
    & $docker exec $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f $containerMigration
    $migrationExit = $LASTEXITCODE
  } finally {
    & $docker exec $container rm -f $containerMigration *> $null
  }
  if ($migrationExit -ne 0) { throw "Field migration failed: $schema" }
  $observed = (& $docker exec $container psql -U postgres -d postgres -Atc 'select schema_version from public.app_runtime_schema_version where id = true').Trim()
  if ($observed -ne $schema) { throw "Migration $schema did not publish its schema marker (observed: $observed)." }
  $applied += 1
  if ($schema -eq $target) { break }
}

if (-not $foundCurrent) { throw "Unsupported Field schema upgrade source: $current" }
$final = (& $docker exec $container psql -U postgres -d postgres -Atc 'select schema_version from public.app_runtime_schema_version where id = true').Trim()
if ($final -ne $target) { throw "Incomplete Field schema upgrade: expected $target, observed $final" }
Write-Output "FIELD_STAGE database-upgrade-complete $applied $target"
