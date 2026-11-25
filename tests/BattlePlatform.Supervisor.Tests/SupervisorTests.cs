using System.Diagnostics;
using System.Text.Json;
using BattlePlatform.Contracts.Control;
using BattlePlatform.Protocol;
using BattlePlatform.Supervisor.Pipe;
using BattlePlatform.Supervisor.Processes;
using BattlePlatform.Supervisor.Supervision;
using Xunit;

namespace BattlePlatform.Supervisor.Tests;

public sealed class SupervisorTests
{
    [Fact]
    public void Options_Parse_Overrides()
    {
        var root = Path.Combine(Path.GetTempPath(), $"bp-opt-{Guid.NewGuid():N}");
        var options = SupervisorOptions.Parse(new[]
        {
            "--root", root,
            "--data-dir", Path.Combine(root, "data"),
            "--game-port", "4567",
            "--pipe", "bp-test-pipe",
        });
        Assert.Equal(Path.GetFullPath(root), options.Root);
        Assert.Equal(4567, options.GamePort);
        Assert.Equal("bp-test-pipe", options.PipeName);
        Assert.Matches(@"packages[\\/]session-service[\\/]dist[\\/]main\.(js|cjs)$", options.ServiceEntry);
    }

    [Fact]
    public void JobObject_KillsAssignedChildOnDispose()
    {
        using var job = new JobObject();
        var startInfo = new ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true };
        startInfo.ArgumentList.Add("/c");
        startInfo.ArgumentList.Add("ping -n 30 127.0.0.1");
        using var child = Process.Start(startInfo)!;
        job.Assign(child);
        job.Dispose();
        Assert.True(child.WaitForExit(5000), "Job 关闭后子进程仍未退出");
    }

    [Fact]
    public async Task Service_Starts_Reads_Ports_And_Stops()
    {
        var root = TempRoot();
        try
        {
            var entry = WriteScript(root, "service.cjs", "console.log('BP_SERVICE_PORT=41234'); console.log('BP_GAME_PORT=41235'); setInterval(() => {}, 1000);");
            await using var service = new SupervisorService(Options(root, entry));
            var started = await service.StartServiceAsync(CancellationToken.None);
            Assert.Contains(started.State, new[] { ServiceStatusState.Starting, ServiceStatusState.Running });
            Assert.True(await WaitUntil(() => service.Snapshot() is { State: ServiceStatusState.Running, UiPort: 41234 }, TimeSpan.FromSeconds(10)));

            var stopped = await service.StopServiceAsync(CancellationToken.None);
            Assert.Equal(ServiceStatusState.Stopped, stopped.State);
            Assert.Null(stopped.Pid);
        }
        finally
        {
            Cleanup(root);
        }
    }

    [Fact]
    public async Task ControlServer_Roundtrip_Over_NamedPipe()
    {
        var root = TempRoot();
        var entry = WriteScript(root, "service.cjs", "console.log('BP_SERVICE_PORT=41244'); setInterval(() => {}, 1000);");
        var service = new SupervisorService(Options(root, entry));
        var pipeName = $"bp-test-{Guid.NewGuid():N}";
        var server = new ControlServer(service, pipeName);
        using var cts = new CancellationTokenSource();
        var run = server.RunAsync(cts.Token);
        ControlClient? client = null;
        try
        {
            client = await ControlClient.ConnectAsync(pipeName, TimeSpan.FromSeconds(5));
            await client.SendAsync(new ClientHello { Type = ClientHelloType.Hello, Version = 1, ClientKind = ClientKind.Ui });
            Assert.Equal("welcome", (await Receive(client)).GetProperty("type").GetString());
            await client.SendAsync(new Ping { Type = PingType.Ping, Nonce = "n-1" });
            var pong = await Receive(client);
            Assert.Equal("pong", pong.GetProperty("type").GetString());
            Assert.Equal("n-1", pong.GetProperty("nonce").GetString());
            await client.SendAsync(new ServiceStart { Type = ServiceStartType.ServiceStart });
            Assert.Equal("serviceStatus", (await Receive(client)).GetProperty("type").GetString());
            var running = await ReceiveUntil(
                client,
                message => message.GetProperty("type").GetString() == "serviceStatus"
                    && message.GetProperty("state").GetString() == "running",
                TimeSpan.FromSeconds(10));
            Assert.Equal(41244, running.GetProperty("uiPort").GetInt32());
            await client.SendAsync(new { type = "nope" });
            var error = await ReceiveUntil(
                client,
                message => message.GetProperty("type").GetString() == "error",
                TimeSpan.FromSeconds(10));
            Assert.Equal("BADMSG", error.GetProperty("code").GetString());
        }
        finally
        {
            // 先关客户端让服务端 ReadLine 返回 null，再取消 accept 循环，避免管道异步读卡住。
            if (client is not null) await client.DisposeAsync();
            cts.Cancel();
            try
            {
                await run.WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch (OperationCanceledException)
            {
                // 正常停止
            }
            await server.DisposeAsync();
            await service.DisposeAsync();
            Cleanup(root);
        }
    }

    [Fact]
    public async Task Authority_Connects_Over_NamedPipe_And_Stops()
    {
        var root = TempRoot();
        try
        {
            var entry = WriteScript(root, "authority.cjs", """
                const net = require('node:net');
                let buffer = '';
                process.stdin.on('data', (chunk) => {
                  buffer += chunk.toString();
                  const index = buffer.indexOf('\n');
                  if (index < 0) return;
                  const boot = JSON.parse(buffer.slice(0, index));
                  const socket = net.connect(boot.ipcPath);
                  socket.on('data', () => {});
                  socket.on('close', () => process.exit(0));
                });
                """);
            var options = Options(root, entry);
            await using var service = new SupervisorService(options);
            var started = await service.StartAuthorityAsync(new StartAuthority
            {
                Type = StartAuthorityType.StartAuthority,
                SessionId = "sess-1",
                Epoch = 1,
                Entry = entry,
                Runtime = "node",
            }, CancellationToken.None);
            Assert.Equal(AuthorityStatusState.Starting, started.State);
            Assert.True(
                await WaitUntil(() => service.AuthoritySnapshot("sess-1")?.State == AuthorityStatusState.Running, TimeSpan.FromSeconds(10)),
                $"Authority 未连接：{service.AuthoritySnapshot("sess-1")?.Error}");

            var stopped = await service.StopAuthorityAsync("sess-1", "test", CancellationToken.None);
            Assert.NotNull(stopped);
            Assert.Equal(AuthorityStatusState.Stopped, stopped!.State);
            Assert.Null(service.AuthoritySnapshot("sess-1"));
        }
        finally
        {
            Cleanup(root);
        }
    }

    private static string TempRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), $"bp-sup-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        return root;
    }

    private static SupervisorOptions Options(string root, string entry) => new()
    {
        Root = root,
        NodePath = "node",
        ServiceEntry = entry,
        DataDir = Path.Combine(root, "data"),
        GamePort = 0,
        LanPort = 0,
        PipeName = $"bp-test-{Guid.NewGuid():N}",
    };

    private static string WriteScript(string root, string name, string content)
    {
        var path = Path.Combine(root, name);
        File.WriteAllText(path, content);
        return path;
    }

    private static void Cleanup(string root)
    {
        try
        {
            Directory.Delete(root, recursive: true);
        }
        catch
        {
            // 清理失败不影响断言
        }
    }

    private static async Task<bool> WaitUntil(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < timeout)
        {
            if (condition()) return true;
            await Task.Delay(100);
        }
        return condition();
    }

    private static async Task<JsonElement> Receive(ControlClient client, int seconds = 5)
    {
        var message = await ReceiveWithin(client, TimeSpan.FromSeconds(seconds));
        if (message is null) throw new IOException("控制连接提前关闭");
        return message.Value;
    }

    private static async Task<JsonElement> ReceiveUntil(
        ControlClient client,
        Func<JsonElement, bool> predicate,
        TimeSpan timeout)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < timeout)
        {
            var message = await ReceiveWithin(client, timeout - deadline.Elapsed);
            if (message is null) throw new IOException("控制连接提前关闭");
            if (predicate(message.Value)) return message.Value;
        }
        throw new TimeoutException("等待控制消息超时");
    }

    /// <summary>管道读取消 Token 在 Windows 上不一定生效，用 Task.WhenAny 兜底超时。</summary>
    private static async Task<JsonElement?> ReceiveWithin(ControlClient client, TimeSpan timeout)
    {
        var read = client.ReceiveAsync(CancellationToken.None);
        var completed = await Task.WhenAny(read, Task.Delay(timeout));
        return completed == read ? await read : throw new TimeoutException("等待控制消息超时");
    }
}
