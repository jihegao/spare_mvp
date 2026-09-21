Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

packageRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fileSystem.BuildPath(packageRoot, "scripts\start-portable.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """ -AutoSelectPorts"
exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
    pythonPath = fileSystem.BuildPath(packageRoot, "runtime\python.exe")
    pathResolver = fileSystem.BuildPath(packageRoot, "scripts\portable-paths.py")
    resolverOutput = fileSystem.BuildPath(fileSystem.GetSpecialFolder(2), fileSystem.GetTempName)
    resolverCommand = """" & pythonPath & """ -X utf8 -I -B """ & pathResolver & """ --package-root """ & packageRoot & """ --field logs_dir --field-output """ & resolverOutput & """"
    On Error Resume Next
    Set resolverProcess = shell.Exec(resolverCommand)
    resolverDetails = Err.Description
    Err.Clear
    On Error GoTo 0
    logRoot = ""
    resolverExitCode = -1
    If IsObject(resolverProcess) Then
        Do While resolverProcess.Status = 0
            WScript.Sleep 50
        Loop
        resolverStdout = resolverProcess.StdOut.ReadAll
        resolverDetails = Trim(resolverProcess.StdErr.ReadAll)
        resolverExitCode = resolverProcess.ExitCode
        If resolverExitCode = 0 And fileSystem.FileExists(resolverOutput) Then
            Set resolverStream = fileSystem.OpenTextFile(resolverOutput, 1, False, -1)
            logRoot = Trim(resolverStream.ReadAll)
            resolverStream.Close
        End If
    End If
    If fileSystem.FileExists(resolverOutput) Then fileSystem.DeleteFile resolverOutput, True
    details = ""
    errorLog = "无法解析"
    If resolverExitCode = 0 And logRoot <> "" Then
        errorLog = fileSystem.BuildPath(logRoot, "startup-error.log")
        If fileSystem.FileExists(errorLog) Then
            Set stream = fileSystem.OpenTextFile(errorLog, 1, False, -1)
            details = stream.ReadAll
            stream.Close
        End If
    ElseIf resolverDetails <> "" Then
        details = "运行路径解析失败：" & resolverDetails
    End If
    MsgBox "保障效能仿真平台启动失败。" & vbCrLf & vbCrLf & details & vbCrLf & "诊断日志：" & errorLog, 16, "平台启动失败"
End If
