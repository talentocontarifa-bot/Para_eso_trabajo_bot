# Configura el Programador de Tareas de Windows
# para ejecutar el scheduler cada dia a mediodia y a las 7pm
# Ejecutar este script UNA SOLA VEZ como Administrador

$taskName1 = "ParaEsoTrabajo_Mediodia"
$taskName2 = "ParaEsoTrabajo_Noche"
$scriptPath = "C:\Users\rufin\.gemini\antigravity\playground\para_eso_trabajo\scheduler.js"
$nodePath = (Get-Command node).Source

# Trigger 1: Todos los dias a las 12:00pm
$trigger1 = New-ScheduledTaskTrigger -Daily -At "12:00PM"
$action1 = New-ScheduledTaskAction -Execute $nodePath -Argument $scriptPath -WorkingDirectory "C:\Users\rufin\.gemini\antigravity\playground\para_eso_trabajo"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName1 -Trigger $trigger1 -Action $action1 -Settings $settings -RunLevel Highest -Force
Write-Host "✅ Tarea '$taskName1' creada - Se ejecuta todos los dias a las 12:00pm"

# Trigger 2: Todos los dias a las 7:00pm
$trigger2 = New-ScheduledTaskTrigger -Daily -At "7:00PM"
$action2 = New-ScheduledTaskAction -Execute $nodePath -Argument $scriptPath -WorkingDirectory "C:\Users\rufin\.gemini\antigravity\playground\para_eso_trabajo"

Register-ScheduledTask -TaskName $taskName2 -Trigger $trigger2 -Action $action2 -Settings $settings -RunLevel Highest -Force
Write-Host "✅ Tarea '$taskName2' creada - Se ejecuta todos los dias a las 7:00pm"

Write-Host ""
Write-Host "🤖 El scheduler se ejecutara automaticamente:"
Write-Host "   - Todos los dias a las 12:00pm"
Write-Host "   - Todos los dias a las 7:00pm"
Write-Host ""
Write-Host "Para verlas: Busca 'Programador de tareas' en Windows"
