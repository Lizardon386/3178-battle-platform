using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;
using BattlePlatform.Contracts.Control;
using BattlePlatform.Protocol;
using BattlePlatform.Supervisor.Processes;

namespace BattlePlatform.Supervisor.Supervision;

/// <summary>服务与 Authority 的进程监督；不解释游戏 payload，也不碰 Session 存储。</summary>
public sealed class SupervisorService : IAsyncDisposable
{
    private readonly SupervisorOptions _options;
    private readonly JobObject _job = new();
    private readonly SemaphoreSlim _serviceLock = new(1, 1);
    private readonly object _gate = new();
    private readonly Dictionary<string, AuthorityProcess> _authorities = new(StringComparer.Ordinal);

    private Process? _service;
    private ServiceStatusState _serviceState = ServiceStatusState.Stopped;
    private int? _uiPort;
    private int? _gamePort;

    public SupervisorService(SupervisorOptions options)
    {
        _options = options;
    }

    /// <summary>由 ControlServer 注入：把状态推给所有已连接客户端。</summary>
    public Func<object, Task>? Broadcast { get; set; }

    public ServiceStatus Snapshot() => new()
    {
        Type = ServiceStatusType.ServiceStatus,
        State = _serviceState,
        Pid = _service is { HasExited: false } process ? process.Id : null,
        UiPort = _uiPort,
        LanPort = _uiPort,
        GamePort = _gamePort,
    };

    public AuthorityStatus? AuthoritySnapshot(string sessionId)
    {
        lock (_gate)
        {
            return _authorities.TryGetValue(sessionId, out var authority) ? Snapshot(authority) : null;
        }
    }

    public async Task<ServiceStatus> StartServiceAsync(CancellationToken cancellationToken)
    {
        await _serviceLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_service is { HasExited: false }) return Snapshot();

            var startInfo = new ProcessStartInfo
            {
                FileName = _options.NodePath,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = _options.Root,
            };
            startInfo.ArgumentList.Add(_options.ServiceEntry);
            startInfo.ArgumentList.Add("--data-dir");
            startInfo.ArgumentList.Add(_options.DataDir);
            startInfo.ArgumentList.Add("--port");
            startInfo.ArgumentList.Add("0");
            startInfo.ArgumentList.Add("--game-port");
            startInfo.ArgumentList.Add(_options.GamePort.ToString());
            if (_options.GamesDir is not null)
            {
                startInfo.ArgumentList.Add("--games-dir");
                startInfo.ArgumentList.Add(_options.GamesDir);
            }

            var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, args) => OnServiceOutput(args.Data);
            process.ErrorDataReceived += (_, args) =>
            {
                if (args.Data is not null) Console.Error.WriteLine($"[service] {args.Data}");
            };
            process.Exited += (_, _) => OnServiceExited(process);

            process.Start();
            _service = process;
            _serviceState = ServiceStatusState.Starting;
            _uiPort = null;
            _gamePort = null;
            try
            {
                _job.Assign(process);
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"[supervisor] 无法把 Service 加入 Job：{error.Message}");
            }
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            await BroadcastAsync(Snapshot()).ConfigureAwait(false);
            return Snapshot();
        }
        finally
        {
            _serviceLock.Release();
        }
    }

    public async Task<ServiceStatus> StopServiceAsync(CancellationToken cancellationToken)
    {
        await _serviceLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var process = _service;
            if (process is null) return Snapshot();
            try
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(cancellationToken).WaitAsync(TimeSpan.FromSeconds(5), cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"[supervisor] 停止 Service 失败：{error.Message}");
            }
            _service = null;
            _serviceState = ServiceStatusState.Stopped;
            _uiPort = null;
            _gamePort = null;
            await BroadcastAsync(Snapshot()).ConfigureAwait(false);
            return Snapshot();
        }
        finally
        {
            _serviceLock.Release();
        }
    }

    public async Task<AuthorityStatus> StartAuthorityAsync(StartAuthority message, CancellationToken cancellationToken)
    {
        await StopAuthorityAsync(message.SessionId, "restart", cancellationToken).ConfigureAwait(false);

        var pipeName = $"bp-authority-{Environment.ProcessId}-{Guid.NewGuid():N}";
        var pipePath = $@"\\.\pipe\{pipeName}";
        var pipe = new NamedPipeServerStream(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        var stateDir = Path.Combine(_options.DataDir, "authority", message.SessionId, message.Epoch.ToString());
        Directory.CreateDirectory(stateDir);

        var python = message.Runtime is "python" or "python3";
        var command = python
            ? Environment.GetEnvironmentVariable("BP_PYTHON") ?? (OperatingSystem.IsWindows() ? "python" : "python3")
            : _options.NodePath;
        var startInfo = new ProcessStartInfo
        {
            FileName = command,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = message.Cwd ?? _options.Root,
        };
        startInfo.ArgumentList.Add(message.Entry);
        foreach (var arg in message.Args ?? Array.Empty<string>()) startInfo.ArgumentList.Add(arg);
        if (message.Env is not null)
        {
            foreach (var pair in message.Env) startInfo.Environment[pair.Key] = pair.Value;
        }

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var authority = new AuthorityProcess(message.SessionId, message.Epoch, message.Entry, message.Runtime, pipe, process);
        process.OutputDataReceived += (_, args) =>
        {
            if (args.Data is not null) Console.WriteLine($"[authority:{message.SessionId}] {args.Data}");
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (args.Data is not null) Console.Error.WriteLine($"[authority:{message.SessionId}] {args.Data}");
        };
        process.Exited += (_, _) => OnAuthorityExited(authority);

        process.Start();
        try
        {
            _job.Assign(process);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"[supervisor] 无法把 Authority 加入 Job：{error.Message}");
        }
        authority.Pid = process.Id;
        lock (_gate) _authorities[message.SessionId] = authority;

        var boot = new
        {
            sessionId = message.SessionId,
            epoch = message.Epoch,
            roundId = $"round-{message.Epoch}",
            ipcPath = pipePath,
            stateDir,
            members = Array.Empty<object>(),
            bootNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant(),
        };
        await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(boot, ControlClient.JsonOptions))
            .ConfigureAwait(false);
        await process.StandardInput.FlushAsync(cancellationToken).ConfigureAwait(false);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        authority.AcceptTask = AcceptAuthorityAsync(authority);
        var status = Snapshot(authority);
        await BroadcastAsync(status).ConfigureAwait(false);
        return status;
    }

    public async Task<AuthorityStatus?> StopAuthorityAsync(string sessionId, string reason, CancellationToken cancellationToken)
    {
        AuthorityProcess? authority;
        lock (_gate)
        {
            _authorities.Remove(sessionId, out authority);
        }
        if (authority is null) return null;
        authority.State = AuthorityStatusState.Stopping;
        await BroadcastAsync(Snapshot(authority)).ConfigureAwait(false);
        authority.Cancel();
        try
        {
            authority.Pipe.Dispose();
            if (!authority.Process.HasExited) authority.Process.Kill(entireProcessTree: true);
            await authority.Process.WaitForExitAsync(cancellationToken).WaitAsync(TimeSpan.FromSeconds(5), cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"[supervisor] 停止 Authority {sessionId} 失败（{reason}）：{error.Message}");
        }
        authority.Dispose();
        var stopped = new AuthorityStatus
        {
            Type = AuthorityStatusType.AuthorityStatus,
            SessionId = sessionId,
            State = AuthorityStatusState.Stopped,
            Epoch = authority.Epoch,
        };
        await BroadcastAsync(stopped).ConfigureAwait(false);
        return stopped;
    }

    public async Task<AuthorityStatus?> RecoverAuthorityAsync(RecoverAuthority message, CancellationToken cancellationToken)
    {
        AuthorityProcess? existing;
        lock (_gate)
        {
            _authorities.TryGetValue(message.SessionId, out existing);
        }
        if (existing is null) return null;
        var entry = existing.Entry;
        var runtime = existing.Runtime;
        await StopAuthorityAsync(message.SessionId, "recover", cancellationToken).ConfigureAwait(false);
        return await StartAuthorityAsync(new StartAuthority
        {
            Type = StartAuthorityType.StartAuthority,
            SessionId = message.SessionId,
            Epoch = message.Epoch,
            Entry = entry,
            Runtime = runtime,
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task ShutdownAsync(CancellationToken cancellationToken)
    {
        await StopServiceAsync(cancellationToken).ConfigureAwait(false);
        List<string> sessions;
        lock (_gate) sessions = _authorities.Keys.ToList();
        foreach (var sessionId in sessions)
        {
            await StopAuthorityAsync(sessionId, "shutdown", cancellationToken).ConfigureAwait(false);
        }
        _job.Terminate();
    }

    public async ValueTask DisposeAsync()
    {
        await StopServiceAsync(CancellationToken.None).ConfigureAwait(false);
        List<string> sessions;
        lock (_gate) sessions = _authorities.Keys.ToList();
        foreach (var sessionId in sessions)
        {
            await StopAuthorityAsync(sessionId, "dispose", CancellationToken.None).ConfigureAwait(false);
        }
        _job.Dispose();
        _serviceLock.Dispose();
    }

    private void OnServiceOutput(string? line)
    {
        if (line is null) return;
        Console.WriteLine($"[service] {line}");
        if (line.StartsWith("BP_SERVICE_PORT=", StringComparison.Ordinal)
            && int.TryParse(line["BP_SERVICE_PORT=".Length..], out var uiPort))
        {
            _uiPort = uiPort;
            _serviceState = ServiceStatusState.Running;
            _ = BroadcastAsync(Snapshot());
        }
        else if (line.StartsWith("BP_GAME_PORT=", StringComparison.Ordinal)
            && int.TryParse(line["BP_GAME_PORT=".Length..], out var gamePort))
        {
            _gamePort = gamePort;
            _ = BroadcastAsync(Snapshot());
        }
    }

    private void OnServiceExited(Process process)
    {
        if (!ReferenceEquals(_service, process)) return;
        _serviceState = process.ExitCode == 0 ? ServiceStatusState.Stopped : ServiceStatusState.Failed;
        _service = null;
        _uiPort = null;
        _gamePort = null;
        _ = BroadcastAsync(Snapshot());
    }

    private void OnAuthorityExited(AuthorityProcess authority)
    {
        lock (_gate)
        {
            if (!_authorities.TryGetValue(authority.SessionId, out var current) || !ReferenceEquals(current, authority))
            {
                return;
            }
            _authorities.Remove(authority.SessionId);
        }
        authority.State = authority.Process.ExitCode == 0 ? AuthorityStatusState.Exited : AuthorityStatusState.Failed;
        authority.Dispose();
        _ = BroadcastAsync(Snapshot(authority));
    }

    private async Task AcceptAuthorityAsync(AuthorityProcess authority)
    {
        try
        {
            await authority.Pipe.WaitForConnectionAsync(authority.Token).ConfigureAwait(false);
            authority.State = AuthorityStatusState.Running;
            await BroadcastAsync(Snapshot(authority)).ConfigureAwait(false);
            _ = Task.Run(() => DrainAsync(authority.Pipe));
        }
        catch (OperationCanceledException)
        {
            // 正常停止
        }
        catch (Exception error)
        {
            if (authority.State is not AuthorityStatusState.Stopping)
            {
                authority.State = AuthorityStatusState.Failed;
                authority.Error = error.Message;
                await BroadcastAsync(Snapshot(authority)).ConfigureAwait(false);
            }
        }
    }

    private static async Task DrainAsync(NamedPipeServerStream pipe)
    {
        try
        {
            var buffer = new byte[8192];
            while (await pipe.ReadAsync(buffer).ConfigureAwait(false) > 0)
            {
                // Supervisor 不解释 Authority IPC，只保持连接存活。
            }
        }
        catch
        {
            // 连接断开即结束。
        }
    }

    private static AuthorityStatus Snapshot(AuthorityProcess authority) => new()
    {
        Type = AuthorityStatusType.AuthorityStatus,
        SessionId = authority.SessionId,
        State = authority.State,
        Epoch = authority.Epoch,
        Pid = authority.Pid,
        Error = authority.Error,
    };

    private async Task BroadcastAsync(object message)
    {
        var broadcast = Broadcast;
        if (broadcast is null) return;
        try
        {
            await broadcast(message).ConfigureAwait(false);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"[supervisor] 广播状态失败：{error.Message}");
        }
    }

    private sealed class AuthorityProcess
    {
        private readonly CancellationTokenSource _cts = new();

        public AuthorityProcess(
            string sessionId,
            long epoch,
            string entry,
            string runtime,
            NamedPipeServerStream pipe,
            Process process)
        {
            SessionId = sessionId;
            Epoch = epoch;
            Entry = entry;
            Runtime = runtime;
            Pipe = pipe;
            Process = process;
            State = AuthorityStatusState.Starting;
        }

        public string SessionId { get; }
        public long Epoch { get; }
        public string Entry { get; }
        public string Runtime { get; }
        public NamedPipeServerStream Pipe { get; }
        public Process Process { get; }
        public AuthorityStatusState State { get; set; }
        public long? Pid { get; set; }
        public string? Error { get; set; }
        public Task? AcceptTask { get; set; }
        public CancellationToken Token => _cts.Token;

        public void Cancel()
        {
            try
            {
                _cts.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // 已停止
            }
        }

        public void Dispose()
        {
            Cancel();
            _cts.Dispose();
            Pipe.Dispose();
            Process.Dispose();
        }
    }
}
