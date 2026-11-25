using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Text.Json;
using BattlePlatform.Contracts.Control;
using BattlePlatform.Protocol;
using BattlePlatform.Supervisor.Supervision;

namespace BattlePlatform.Supervisor.Pipe;

/// <summary>
/// 当前用户独占的命名管道控制面。协议为 NDJSON：一行一条 local-control 消息。
/// 第一条消息必须是 hello；之后按 catalog 分发。
/// </summary>
public sealed class ControlServer : IAsyncDisposable
{
    private readonly SupervisorService _service;
    private readonly string _pipeName;
    private readonly ConcurrentDictionary<Guid, ClientConnection> _clients = new();
    private readonly CancellationTokenSource _cts = new();

    public ControlServer(SupervisorService service, string pipeName)
    {
        _service = service;
        _pipeName = pipeName;
        _service.Broadcast = BroadcastAsync;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _cts.Token);
        while (!linked.IsCancellationRequested)
        {
            var pipe = new NamedPipeServerStream(
                _pipeName,
                PipeDirection.InOut,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            try
            {
                await pipe.WaitForConnectionAsync(linked.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                await pipe.DisposeAsync().ConfigureAwait(false);
                break;
            }
            _ = HandleClientAsync(pipe, linked.Token);
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream pipe, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        var connection = new ClientConnection(new ControlClientAdapter(pipe));
        _clients[id] = connection;
        try
        {
            var hello = await connection.ReceiveAsync(cancellationToken).ConfigureAwait(false);
            if (hello is null) return;
            if (!IsValidHello(hello.Value, out var problem))
            {
                await connection.SendAsync(Error("BADMSG", problem), cancellationToken).ConfigureAwait(false);
                return;
            }
            await connection.SendAsync(new SupervisorWelcome
            {
                Type = SupervisorWelcomeType.Welcome,
                Version = 1,
                ServerVersion = "0.1.0",
            }, cancellationToken).ConfigureAwait(false);

            while (!cancellationToken.IsCancellationRequested)
            {
                var message = await connection.ReceiveAsync(cancellationToken).ConfigureAwait(false);
                if (message is null) break;
                await DispatchAsync(connection, message.Value, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // 正常关闭
        }
        catch (IOException)
        {
            // 客户端断开
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"[supervisor] 控制连接异常：{error.Message}");
        }
        finally
        {
            _clients.TryRemove(id, out _);
            await connection.DisposeAsync().ConfigureAwait(false);
        }
    }

    private async Task DispatchAsync(ClientConnection connection, JsonElement message, CancellationToken cancellationToken)
    {
        var type = message.TryGetProperty("type", out var typeElement) && typeElement.ValueKind == JsonValueKind.String
            ? typeElement.GetString()
            : null;
        switch (type)
        {
            case "hello":
                await connection.SendAsync(new SupervisorWelcome
                {
                    Type = SupervisorWelcomeType.Welcome,
                    Version = 1,
                    ServerVersion = "0.1.0",
                }, cancellationToken).ConfigureAwait(false);
                return;
            case "serviceStart":
                await connection.SendAsync(await _service.StartServiceAsync(cancellationToken).ConfigureAwait(false), cancellationToken)
                    .ConfigureAwait(false);
                return;
            case "serviceStop":
                await connection.SendAsync(await _service.StopServiceAsync(cancellationToken).ConfigureAwait(false), cancellationToken)
                    .ConfigureAwait(false);
                return;
            case "startAuthority":
                await WithDeserialized<StartAuthority>(connection, message, cancellationToken, async request =>
                {
                    await connection.SendAsync(await _service.StartAuthorityAsync(request, cancellationToken).ConfigureAwait(false), cancellationToken)
                        .ConfigureAwait(false);
                }).ConfigureAwait(false);
                return;
            case "stopAuthority":
                await WithDeserialized<StopAuthority>(connection, message, cancellationToken, async request =>
                {
                    var status = await _service.StopAuthorityAsync(request.SessionId, request.Reason ?? "requested", cancellationToken)
                        .ConfigureAwait(false);
                    if (status is null) await connection.SendAsync(Error("NOSESSION", "没有该会话的 Authority"), cancellationToken).ConfigureAwait(false);
                }).ConfigureAwait(false);
                return;
            case "recoverAuthority":
                await WithDeserialized<RecoverAuthority>(connection, message, cancellationToken, async request =>
                {
                    var status = await _service.RecoverAuthorityAsync(request, cancellationToken).ConfigureAwait(false);
                    if (status is null) await connection.SendAsync(Error("NOSESSION", "没有该会话的 Authority"), cancellationToken).ConfigureAwait(false);
                }).ConfigureAwait(false);
                return;
            case "diagnose":
                await connection.SendAsync(_service.Snapshot(), cancellationToken).ConfigureAwait(false);
                return;
            case "ping":
            {
                var nonce = message.TryGetProperty("nonce", out var nonceElement) && nonceElement.ValueKind == JsonValueKind.String
                    ? nonceElement.GetString() ?? string.Empty
                    : string.Empty;
                await connection.SendAsync(new Pong { Type = PongType.Pong, Nonce = nonce }, cancellationToken).ConfigureAwait(false);
                return;
            }
            case "shutdown":
                await _service.ShutdownAsync(cancellationToken).ConfigureAwait(false);
                Environment.Exit(0);
                return;
            default:
                await connection.SendAsync(Error("BADMSG", $"未知控制消息：{type ?? "(missing type)"}"), cancellationToken)
                    .ConfigureAwait(false);
                return;
        }
    }

    private static async Task WithDeserialized<T>(
        ClientConnection connection,
        JsonElement message,
        CancellationToken cancellationToken,
        Func<T, Task> handler)
        where T : class
    {
        T? request;
        try
        {
            request = JsonSerializer.Deserialize<T>(message.GetRawText(), ControlClient.JsonOptions);
        }
        catch (JsonException error)
        {
            await connection.SendAsync(Error("BADMSG", $"消息字段不合法：{error.Message}"), cancellationToken).ConfigureAwait(false);
            return;
        }
        if (request is null)
        {
            await connection.SendAsync(Error("BADMSG", "消息为空"), cancellationToken).ConfigureAwait(false);
            return;
        }
        await handler(request).ConfigureAwait(false);
    }

    private static bool IsValidHello(JsonElement message, out string problem)
    {
        problem = string.Empty;
        if (!message.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "hello")
        {
            problem = "第一条消息必须是 hello";
            return false;
        }
        if (!message.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number
            || !version.TryGetInt32(out var number) || number != 1)
        {
            problem = "不支持的协议版本";
            return false;
        }
        return true;
    }

    private static ControlError Error(string code, string text) => new()
    {
        Type = ControlErrorType.Error,
        Code = code,
        Text = text,
    };

    private async Task BroadcastAsync(object message)
    {
        foreach (var client in _clients.Values)
        {
            try
            {
                await client.SendAsync(message, _cts.Token).ConfigureAwait(false);
            }
            catch
            {
                // 单个客户端断开不影响其它客户端。
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        foreach (var client in _clients.Values)
        {
            await client.DisposeAsync().ConfigureAwait(false);
        }
        _clients.Clear();
        _cts.Dispose();
    }

    private sealed class ClientConnection : IAsyncDisposable
    {
        private readonly ControlClientAdapter _client;
        private readonly SemaphoreSlim _writeLock = new(1, 1);

        public ClientConnection(ControlClientAdapter client)
        {
            _client = client;
        }

        public async Task SendAsync(object message, CancellationToken cancellationToken)
        {
            await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await _client.SendAsync(message, cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                _writeLock.Release();
            }
        }

        public Task<JsonElement?> ReceiveAsync(CancellationToken cancellationToken) => _client.ReceiveAsync(cancellationToken);

        public ValueTask DisposeAsync()
        {
            _writeLock.Dispose();
            return _client.DisposeAsync();
        }
    }

    /// <summary>服务端管道包装成与 ControlClient 相同的读写接口。</summary>
    private sealed class ControlClientAdapter : IAsyncDisposable
    {
        private readonly StreamReader _reader;
        private readonly StreamWriter _writer;

        public ControlClientAdapter(Stream stream)
        {
            _reader = new StreamReader(stream, System.Text.Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
            _writer = new StreamWriter(stream, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false), leaveOpen: true)
            {
                AutoFlush = false,
                NewLine = "\n",
            };
            Stream = stream;
        }

        public Stream Stream { get; }

        public async Task SendAsync(object message, CancellationToken cancellationToken)
        {
            var json = JsonSerializer.Serialize(message, ControlClient.JsonOptions);
            await _writer.WriteLineAsync(json.AsMemory(), cancellationToken).ConfigureAwait(false);
            await _writer.FlushAsync(cancellationToken).ConfigureAwait(false);
        }

        public async Task<JsonElement?> ReceiveAsync(CancellationToken cancellationToken)
        {
            var line = await _reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (line is null) return null;
            using var document = JsonDocument.Parse(line);
            return document.RootElement.Clone();
        }

        public async ValueTask DisposeAsync()
        {
            await _writer.DisposeAsync().ConfigureAwait(false);
            _reader.Dispose();
            await Stream.DisposeAsync().ConfigureAwait(false);
        }
    }
}
