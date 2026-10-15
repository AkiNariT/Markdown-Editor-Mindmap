#requires -Version 5.1
<#
Current-user, opt-in Windows shell integration for portable MD.
Install adds Open With candidates and shortcuts; it never changes defaults.
After moving MD, run Install again from the new directory. Uninstall only
removes entries still owned by this script and pointing at this executable.
DryRun prints the guarded plan without changing registrations or shortcuts.
TestId/TestDirectory redirect ALL writes to a private test sandbox.
References:
https://learn.microsoft.com/en-us/windows/win32/shell/fa-file-types
https://learn.microsoft.com/en-us/windows/win32/shell/appids
https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Install','Uninstall')][string]$Action,
    [string]$ExecutablePath = (Join-Path $PSScriptRoot 'MD.exe'),
    [switch]$DryRun,
    [string]$TestId,
    [string]$TestDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$owner = 'MD.WindowsIntegration.v1'
$appId = 'Moye.MD'
if ($ExecutablePath -match '["\r\n]' -or -not [IO.Path]::IsPathRooted($ExecutablePath)) { throw 'ExecutablePath must be an absolute path without quotes or newlines.' }
$exe = [IO.Path]::GetFullPath($ExecutablePath)
if ([IO.Path]::GetFileName($exe) -ine 'MD.exe') { throw 'ExecutablePath must point to MD.exe.' }
if ($Action -eq 'Install' -and -not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "MD.exe does not exist: $exe" }
if ([bool]$TestId -ne [bool]$TestDirectory) { throw 'TestId and TestDirectory must be supplied together.' }
$registryRoot = 'HKCU:\Software\Classes'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$startMenu = [Environment]::GetFolderPath('Programs')
if ($TestId) {
    if ($TestId -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') { throw 'TestId must be a GUID.' }
    if (-not [IO.Path]::IsPathRooted($TestDirectory)) { throw 'TestDirectory must be absolute.' }
    $testBase = [IO.Path]::GetFullPath($TestDirectory)
    $registryRoot = "HKCU:\Software\MD.WindowsIntegrationTests\$TestId\Classes"
    $desktop = Join-Path $testBase 'Desktop'
    $startMenu = Join-Path $testBase 'Start Menu'
}
$command = '"' + $exe + '" "%1"'
$icon = '"' + $exe + '",0'
$registrations = @(
    @{ Name='Moye.MD.Markdown'; Label='Markdown document'; Extensions=@('.md','.markdown') },
    @{ Name='Moye.MD.Mindmap'; Label='MD mind map'; Extensions=@('.mdmap') },
    @{ Name='Applications\MD.exe'; Label='MD'; Extensions=@() }
)
function Read-Value([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-Item -LiteralPath $Path).GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}
function Owns-Registration([string]$Path, [bool]$ExactExecutable) {
    $storedExe = Read-Value $Path 'MDExecutablePath'
    if ((Read-Value $Path 'MDIntegrationOwner') -cne $owner -or -not $storedExe) { return $false }
    if ($ExactExecutable -and $storedExe -ine $exe) { return $false }
    return (Read-Value (Join-Path $Path 'shell\open\command') '') -ceq ('"' + $storedExe + '" "%1"')
}
function Entry([string]$Path, [string]$Name, $Value, [string]$Kind='String') {
    return @{ path=$Path; name=$Name; value=$Value; kind=$Kind }
}
function Values-For($Registration) {
    $key = Join-Path $registryRoot $Registration.Name
    $values = @(
        (Entry $key '' $Registration.Label),
        (Entry $key 'MDIntegrationOwner' $owner),
        (Entry $key 'MDExecutablePath' $exe),
        (Entry $key 'AppUserModelID' $appId),
        (Entry (Join-Path $key 'DefaultIcon') '' $icon),
        (Entry (Join-Path $key 'shell\open\command') '' $command)
    )
    if ($Registration.Name -eq 'Applications\MD.exe') {
        $values += Entry $key 'FriendlyAppName' 'MD'
        foreach ($extension in @('.md','.markdown','.mdmap')) { $values += Entry (Join-Path $key 'SupportedTypes') $extension '' }
    } else {
        foreach ($extension in $Registration.Extensions) { $values += Entry (Join-Path $registryRoot "$extension\OpenWithProgids") $Registration.Name '' }
    }
    return $values
}
$changes = @()
$skipped = @()
foreach ($registration in $registrations) {
    $key = Join-Path $registryRoot $registration.Name
    if ($Action -eq 'Install') {
        if ((Test-Path -LiteralPath $key) -and -not (Owns-Registration $key $false)) { throw "Registration conflict: $key. Existing data was not changed." }
        foreach ($extension in $registration.Extensions) {
            $existing = Read-Value (Join-Path $registryRoot "$extension\OpenWithProgids") $registration.Name
            if ($null -ne $existing -and $existing -cne '') { throw "Registration conflict: $extension OpenWithProgids. Existing data was not changed." }
        }
        $changes += Values-For $registration
    } elseif (Owns-Registration $key $true) {
        # Each value is checked again before deletion; foreign additions survive.
        $changes += Values-For $registration
    } else { $skipped += $key }
}
# Explicit Unicode interfaces avoid WScript.Shell's ANSI path conversion in PS 5.1.
# IPropertyStore sets the same AppUserModelID as Electron. The PROPVARIANT layout
# uses two pointer-sized union members for x86 and x64 Windows PowerShell.
if (-not ('MDWindowsShell' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MDWindowsShell {
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr data, uint flags);
        void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetHotkey(out ushort key); void SetHotkey(ushort key);
        void GetShowCmd(out int command); void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }
    [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Sequential)] public struct PropVariant {
        public ushort vt, reserved1, reserved2, reserved3; public IntPtr value, extra;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
    static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bind, uint flags, ref Guid iid, out IPropertyStore store);
    [DllImport("shell32.dll")] static extern void SHChangeNotify(uint change, uint flags, IntPtr item1, IntPtr item2);
    public sealed class ShortcutInfo { public string TargetPath, Description, Arguments; }
    public static ShortcutInfo ReadShortcut(string path) {
        var link = (IShellLinkW)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
        try {
            ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(path, 0);
            var target = new StringBuilder(32768); var description = new StringBuilder(32768); var arguments = new StringBuilder(32768);
            link.GetPath(target, target.Capacity, IntPtr.Zero, 4); link.GetDescription(description, description.Capacity); link.GetArguments(arguments, arguments.Capacity);
            return new ShortcutInfo { TargetPath=target.ToString(), Description=description.ToString(), Arguments=arguments.ToString() };
        } finally { Marshal.FinalReleaseComObject(link); }
    }
    public static void WriteShortcut(string path, string exe, string owner) {
        var link = (IShellLinkW)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
        try {
            link.SetPath(exe); link.SetArguments(""); link.SetWorkingDirectory(System.IO.Path.GetDirectoryName(exe));
            link.SetDescription(owner); link.SetIconLocation(exe, 0);
            ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(path, true);
        } finally { Marshal.FinalReleaseComObject(link); }
    }
    public static void SetAppId(string path, string id) {
        var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store));
        var key = new PropertyKey { fmtid=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid=5 };
        var value = new PropVariant { vt=31, value=Marshal.StringToCoTaskMemUni(id) };
        try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); Marshal.ThrowExceptionForHR(store.Commit()); }
        finally { Marshal.FreeCoTaskMem(value.value); Marshal.FinalReleaseComObject(store); }
    }
    public static void Notify() { SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); }
}
'@
}

$shortcuts = @()
foreach ($directory in @($desktop, $startMenu)) {
    if (-not $directory) { throw 'Windows did not provide a current-user shortcut directory.' }
    $linkPath = Join-Path $directory 'MD.lnk'
    $exists = Test-Path -LiteralPath $linkPath
    $owned = $false
    $matches = $false
    if ($exists) {
        $link = [MDWindowsShell]::ReadShortcut($linkPath)
        $owned = $link.Description -ceq $owner -and $link.Arguments -ceq ''
        $matches = $owned -and $link.TargetPath -ieq $exe
    }
    if ($Action -eq 'Install' -and $exists -and -not $owned) { throw "Shortcut conflict: $linkPath. Existing data was not changed." }
    if ($Action -eq 'Install' -or $matches) { $shortcuts += $linkPath }
    elseif ($exists) { $skipped += $linkPath }
}
$plan = [ordered]@{
    action=$Action; dryRun=[bool]$DryRun; executable=$exe; appUserModelId=$appId
    registryRoot=$registryRoot; command=$command; extensions=@('.md','.markdown','.mdmap')
    changesDefaults=$false; registryValues=$changes; shortcuts=$shortcuts; skipped=$skipped
}
if (-not $DryRun) {
    foreach ($entry in $changes) {
        if ($Action -eq 'Install') {
            $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($entry.path.Substring(6))
            try { $key.SetValue($entry.name, $entry.value, [Microsoft.Win32.RegistryValueKind]::$($entry.kind)) }
            finally { $key.Dispose() }
        } elseif ((Read-Value $entry.path $entry.name) -ceq $entry.value) {
            $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($entry.path.Substring(6), $true)
            try { $key.DeleteValue($entry.name, $false) } finally { $key.Dispose() }
        }
    }
    foreach ($linkPath in $shortcuts) {
        if ($Action -eq 'Install') {
            $directory = Split-Path -Parent $linkPath
            [void][IO.Directory]::CreateDirectory($directory)
            [MDWindowsShell]::WriteShortcut($linkPath, $exe, $owner)
            [MDWindowsShell]::SetAppId($linkPath, $appId)
        } else { Remove-Item -LiteralPath $linkPath }
    }
    if ($Action -eq 'Uninstall') {
        # Only prune empty keys in known registration branches, never recurse.
        $keys = @()
        foreach ($entry in $changes) {
            $keyPath = $entry.path
            while ($keyPath.Length -gt $registryRoot.Length) { $keys += $keyPath; $keyPath = Split-Path -Parent $keyPath }
        }
        foreach ($keyPath in ($keys | Select-Object -Unique | Sort-Object -Property Length -Descending)) {
            if (Test-Path -LiteralPath $keyPath) {
                $key = Get-Item -LiteralPath $keyPath
                if ($key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0) { Remove-Item -LiteralPath $keyPath }
            }
        }
    }
    if (-not $TestId) { [MDWindowsShell]::Notify() }
}
$plan | ConvertTo-Json -Depth 8

