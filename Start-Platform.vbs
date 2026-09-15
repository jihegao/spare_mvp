Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

packageRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fileSystem.BuildPath(packageRoot, "scripts\start-portable.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """ -AutoSelectPorts"
exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
    errorLog = fileSystem.BuildPath(packageRoot, "data\logs\startup-error.log")
    details = ""
    If fileSystem.FileExists(errorLog) Then
        Set stream = fileSystem.OpenTextFile(errorLog, 1, False, -1)
        details = stream.ReadAll
        stream.Close
    End If
    MsgBox "保障效能仿真平台启动失败。" & vbCrLf & vbCrLf & details & vbCrLf & "诊断日志：" & errorLog, 16, "平台启动失败"
End If
