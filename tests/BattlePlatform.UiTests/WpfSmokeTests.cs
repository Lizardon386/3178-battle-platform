using System.Diagnostics;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.UIA3;
using Xunit;

namespace BattlePlatform.UiTests;

/// <summary>
/// 三条关键路径：窗口能开、关窗进托盘、经 Supervisor 启停服务后退出。
/// 需要交互式 Windows 桌面；只在本地/自托管 runner 跑，不作 CI 合并门禁。
/// </summary>
public sealed class WpfSmokeTests
{
    private static string RepoRoot
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "BattlePlatform.sln")))
            {
                dir = dir.Parent;
            }
            return dir?.FullName ?? throw new InvalidOperationException("找不到仓库根目录");
        }
    }

    private static string WpfExe => Path.Combine(RepoRoot, "apps", "BattlePlatform.Wpf", "bin", "Debug", "net10.0-windows", "3178.exe");

    private static string SupervisorExe => Path.Combine(RepoRoot, "apps", "BattlePlatform.Supervisor", "bin", "Debug", "net10.0-windows", "bp-supervisor.exe");

    [Fact]
    public void Window_Shows_And_Exit_Closes_Process()
    {
        using var automation = new UIA3Automation();
        using var app = Application.Launch(WpfExe);
        var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10))!;
        Assert.Equal("3178 联机平台", window.Title);
        Assert.False(string.IsNullOrWhiteSpace(window.FindFirstDescendant(cf => cf.ByAutomationId("StatusText"))?.Name));

        window.FindFirstDescendant(cf => cf.ByAutomationId("ExitButton"))!.AsButton().Invoke();
        Assert.True(WaitUntil(() => app.HasExited, TimeSpan.FromSeconds(10)), "点击退出后进程没有结束");
    }

    [Fact]
    public void Closing_Window_Keeps_Process_Alive_In_Tray()
    {
        using var automation = new UIA3Automation();
        using var app = Application.Launch(WpfExe);
        var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10))!;
        window.Close();

        Thread.Sleep(700);
        Assert.False(app.HasExited, "关窗后进程应继续驻留托盘");
        app.Kill();
    }

    [Fact]
    public void Start_And_Stop_Service_Through_Supervisor()
    {
        var dataDir = Path.Combine(Path.GetTempPath(), $"bp-ui-{Guid.NewGuid():N}");
        var gamesDir = Path.Combine(dataDir, "games");
        Directory.CreateDirectory(gamesDir);
        using var automation = new UIA3Automation();
        var supervisorStart = new ProcessStartInfo(SupervisorExe) { UseShellExecute = false };
        foreach (var argument in new[]
                 {
                     "--root", RepoRoot,
                     "--node", Environment.GetEnvironmentVariable("BP_NODE") ?? "node",
                     "--service-entry", Path.Combine(RepoRoot, "packages", "session-service", "dist", "main.js"),
                     "--data-dir", dataDir,
                     "--games-dir", gamesDir,
                     "--game-port", "0",
                 })
        {
            supervisorStart.ArgumentList.Add(argument);
        }
        using var supervisor = Application.Launch(supervisorStart);
        Thread.Sleep(800);

        using var app = Application.Launch(WpfExe);
        try
        {
            var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10))!;
            var status = window.FindFirstDescendant(cf => cf.ByAutomationId("StatusText"))!;
            Assert.True(WaitUntil(() => status.Name.Contains("已连接", StringComparison.Ordinal), TimeSpan.FromSeconds(10)), $"未连接 Supervisor：{status.Name}");

            window.FindFirstDescendant(cf => cf.ByAutomationId("StartServiceButton"))!.AsButton().Invoke();
            Assert.True(
                WaitUntil(() => status.Name.Contains("running", StringComparison.OrdinalIgnoreCase), TimeSpan.FromSeconds(20)),
                $"服务未进入 running：{status.Name}");

            window.FindFirstDescendant(cf => cf.ByAutomationId("ExitButton"))!.AsButton().Invoke();
            Assert.True(WaitUntil(() => app.HasExited, TimeSpan.FromSeconds(10)), "退出后 3178.exe 未结束");
            Assert.True(WaitUntil(() => supervisor.HasExited, TimeSpan.FromSeconds(10)), "shutdown 后 Supervisor 未结束");
        }
        finally
        {
            if (!app.HasExited) app.Kill();
            if (!supervisor.HasExited) supervisor.Kill();
            try
            {
                Directory.Delete(dataDir, recursive: true);
            }
            catch
            {
                // 测试清理失败不影响断言
            }
        }
    }

    private static bool WaitUntil(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < timeout)
        {
            if (condition()) return true;
            Thread.Sleep(100);
        }
        return condition();
    }
}
