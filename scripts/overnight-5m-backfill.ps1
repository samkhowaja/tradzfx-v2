<##
.SYNOPSIS
  Sequential 5m causal backfill for remaining tradable pairs.
#>
param(
    [string[]]$Pairs = @('XAUUSD','USDJPY','AUDUSD','USDCAD','NZDUSD','USDCHF','USDSEK'),
    [int]$Days = 90,
    [string]$Tf = '5m'
)

$ErrorActionPreference = 'Stop'
$startTime = Get-Date
$results = @()
New-Item -ItemType Directory -Force temp | Out-Null
$mutex = [Threading.Mutex]::new($false, 'Global\tradzfx-overnight-5m-backfill')
$mutexAcquired = $false
$childProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

try {
    $mutexAcquired = $mutex.WaitOne(0)
    if (-not $mutexAcquired) { throw 'Another overnight-5m-backfill instance is already running.' }

function Invoke-NodeJson {
    param([string]$Code)
    $output = & node -e $Code 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Node check failed: $($output -join ' ')" }
    return ($output -join "`n")
}

function Test-NoStaleWriters {
    param([string[]]$Symbols, [string]$Timeframe)
    $symbolsJson = "[" + (($Symbols | ForEach-Object { "'$_'" }) -join ',') + "]"
    $code = @'
require('dotenv').config({path:'.env.local'});
const {Pool}=require('pg');
const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:+(process.env.TM_DB_PORT||5432),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
 (async()=>{const c=await p.connect();const syms=__SYMS__;const old=[['features_pivot','1.2.0'],['features_structure','2.1.0'],['features_sweep','1.4.0'],['features_order_block','1.4.1']];let bad=0;for(const s of syms)for(const [t,v] of old){const r=await c.query('SELECT COUNT(*)::int n FROM '+t+' WHERE symbol=$1 AND tf=$2 AND engine_ver=$3 AND ts>NOW()-INTERVAL \'5 minutes\'',[s,'__TF__',v]);if(r.rows[0].n){console.log(s,t,r.rows[0].n);bad+=r.rows[0].n}}c.release();await p.end();process.exit(bad?1:0)})().catch(e=>{console.error(e);process.exit(1)});
'@
    $code = $code.Replace('__SYMS__', $symbolsJson).Replace('__TF__', $Timeframe)
    & node -e $code
    return $LASTEXITCODE -eq 0
}

function Test-Repair {
    param([string]$Symbol, [string]$Timeframe, [int]$LookbackDays)
    $code = @'
require('dotenv').config({path:'.env.local'});const {Pool}=require('pg');const p=new Pool({host:process.env.TM_DB_HOST||'localhost',port:+(process.env.TM_DB_PORT||5432),database:process.env.TM_DB_NAME||'tradzfx_v2',user:process.env.TM_DB_USER||'postgres',password:process.env.TM_DB_PASSWORD});
(async()=>{const c=await p.connect();const symbol='__SYMBOL__',tf='__TF__',days=__DAYS__;const q=async(t,ver,field)=>{const allowed={features_pivot:'confirmation_ts',features_structure:'available_at_ts',features_sweep:'available_at_ts',features_order_block:'logical_id'};if(allowed[t]!==field)throw new Error('invalid verification field');const r=await c.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE engine_ver=$3)::int clean,COUNT(*) FILTER(WHERE ${field} IS NULL)::int missing FROM ${t} WHERE symbol=$1 AND tf=$2 AND ts>=NOW()-($4::int * INTERVAL '1 day')`,[symbol,tf,ver,days]);return r.rows[0]};const checks=[await q('features_pivot','1.3.0','confirmation_ts'),await q('features_structure','2.2.0','available_at_ts'),await q('features_sweep','1.5.0','available_at_ts'),await q('features_order_block','1.5.0','logical_id')];let ok=checks.every(x=>x.total===x.clean&&x.missing===0);const r=await c.query(`SELECT (SELECT COUNT(*) FROM features_structure WHERE symbol=$1 AND tf=$2 AND ts>=NOW()-($3::int * INTERVAL '1 day') AND available_at_ts<ts)+(SELECT COUNT(*) FROM features_sweep WHERE symbol=$1 AND tf=$2 AND ts>=NOW()-($3::int * INTERVAL '1 day') AND available_at_ts<ts) bad`,[symbol,tf,days]);ok=ok&&Number(r.rows[0].bad)===0;console.log(ok?'PASS':'FAIL');c.release();await p.end();process.exit(ok?0:1)})().catch(e=>{console.error(e);process.exit(1)});
'@
    $code = $code.Replace('__SYMBOL__', $Symbol).Replace('__TF__', $Timeframe).Replace('__DAYS__', [string]$LookbackDays)
    $output = & node -e $code 2>&1
    if ($output) { Write-Host ($output -join "`n") }
    return $LASTEXITCODE -eq 0
}

Write-Host 'Pre-flight: stale-writer check...' -ForegroundColor Green
if (-not (Test-NoStaleWriters -Symbols $Pairs -Timeframe $Tf)) { throw 'Stale writer detected. Aborting.' }

Write-Host 'Rebuilding engine...' -ForegroundColor Green
pnpm --filter @tm/engine build | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Engine build failed.' }
$distVer = (& node -e "const {structureFeature}=require('./apps/engine/dist/index.js');console.log(structureFeature.version)").Trim()
if ($distVer -ne '2.2.0') { throw "Unexpected dist version: $distVer" }

foreach ($pair in $Pairs) {
    $pairStart = Get-Date
    $log = "temp/$pair-$Tf-$Days`day-backfill.log"
    $err = "$log.err"
    try {
        Write-Host "=== $pair $Tf $Days days ===" -ForegroundColor Cyan
        if (Test-Repair -Symbol $pair -Timeframe $Tf -LookbackDays $Days) {
            Write-Host "$pair already PASS; skipping rerun" -ForegroundColor DarkYellow
            $results += [pscustomobject]@{Pair=$pair;Status='PASS';Start=$pairStart;End=Get-Date}
            continue
        }
        $proc = Start-Process node -ArgumentList @('scripts/backfill-causal-runner.cjs',$pair,$Tf,$Days,'--apply','--delete-first') -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
        $childProcesses.Add($proc)
        $proc.WaitForExit()
        if ($proc.ExitCode -ne 0) {
            $detail = if (Test-Path $err) { (Get-Content $err -Raw).Trim() } else { '' }
            throw "Backfill exit code $($proc.ExitCode): $detail"
        }
        if (-not (Test-Repair -Symbol $pair -Timeframe $Tf -LookbackDays $Days)) { throw 'Independent verification failed.' }
        $results += [pscustomobject]@{Pair=$pair;Status='PASS';Start=$pairStart;End=Get-Date}
        Write-Host "$pair PASS" -ForegroundColor Green
    } catch {
        $results += [pscustomobject]@{Pair=$pair;Status='FAIL';Error=$_.Exception.Message;Start=$pairStart;End=Get-Date}
        Write-Host "$pair FAIL: $($_.Exception.Message)" -ForegroundColor Red
    }
}

$elapsed=(Get-Date)-$startTime
Write-Host "=== BATCH COMPLETE: $($elapsed.ToString('dd\.hh\:mm\:ss')) ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize
if (($results | Where-Object Status -ne 'PASS').Count -gt 0) { exit 1 }
} finally {
    foreach ($proc in $childProcesses) {
        if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
    if ($mutexAcquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
