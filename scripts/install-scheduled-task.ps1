param(
  [string]$Time = '08:30',
  [string]$TaskName = 'CloudMusicPorterDaily',
  [string]$NodePath = '',
  [string]$CliPath = '',
  [switch]$Uninstall,
  [switch]$Status,
  [switch]$RunNow,
  [switch]$NoLogonTrigger
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Get-NodePath {
  if ($NodePath -and (Test-Path -LiteralPath $NodePath)) { return $NodePath }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  foreach ($item in $candidates) {
    if ($item -and (Test-Path -LiteralPath $item)) { return $item }
  }
  throw '找不到 node.exe，请先安装 Node.js，或把 node.exe 加进 PATH。'
}

if (-not $CliPath) {
  $root = Split-Path -Parent $PSScriptRoot
  $CliPath = Join-Path $root 'src\cli.js'
}
if (-not (Test-Path -LiteralPath $CliPath)) { throw '找不到 CLI 入口：' + $CliPath }
$workDir = Split-Path -Parent (Split-Path -Parent $CliPath)

if ($Status) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { Write-Host ('任务计划还没有安装：' + $TaskName); return }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host ('任务：' + $task.TaskName + '（' + $task.State + '）')
  Write-Host ('上次运行：' + $info.LastRunTime + '，结果 0x' + ('{0:X}' -f $info.LastTaskResult))
  Write-Host ('下次运行：' + $info.NextRunTime)
  $task.Triggers | ForEach-Object { Write-Host ('触发器：' + $_.CimClass.CimClassName) }
  return
}

if ($Uninstall) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { Write-Host ('任务计划本来就不存在：' + $TaskName); return }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host ('已卸载任务计划：' + $TaskName)
  return
}

$node = Get-NodePath
# node.exe 的第一个参数必须是 cli.js 的路径，直接写 "service run" 会被 node 当成脚本文件名。
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $CliPath + '" service run') -WorkingDirectory $workDir
$triggers = @(New-ScheduledTaskTrigger -Daily -At $Time)
if (-not $NoLogonTrigger) {
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $triggers += New-ScheduledTaskTrigger -AtLogOn -User $currentUser
}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'cloud-music-porter 每天把喜欢的 VIP 歌同步到网易云音乐云盘' -Force | Out-Null
Write-Host ('已安装任务计划：' + $TaskName)
Write-Host ('  每天运行时间：' + $Time)
Write-Host ('  登录时也会检查补跑：' + (-not $NoLogonTrigger))
Write-Host ('  运行命令："' + $node + '" "' + $CliPath + '" service run')

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2
  Write-Host '已立即触发一次运行；可运行 cmporter service status 查看结果。'
}
