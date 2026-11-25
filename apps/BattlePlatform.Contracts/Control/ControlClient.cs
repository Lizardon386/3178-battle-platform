using System.IO.Pipes;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BattlePlatform.Contracts.Control;

/// <summary>本机命名管道上的 NDJSON 控制客户端；只连接当前用户可访问的管道。</summary>
public sealed class ControlClient : IAsyncDisposable
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly NamedPipeClientStream _pipe;
    private readonly StreamReader _reader;
    private readonly StreamWriter _writer;

    private ControlClient(NamedPipeClientStream pipe)
    {
        _pipe = pipe;
        _reader = new StreamReader(pipe, System.Text.Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        _writer = new StreamWriter(pipe, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false), leaveOpen: true)
        {
            AutoFlush = false,
            NewLine = "\n",
        };
    }

    public static async Task<ControlClient> ConnectAsync(string pipeName, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync((int)timeout.TotalMilliseconds, cancellationToken).ConfigureAwait(false);
        return new ControlClient(pipe);
    }

    public async Task SendAsync<T>(T message, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions);
        await _writer.WriteLineAsync(json.AsMemory(), cancellationToken).ConfigureAwait(false);
        await _writer.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>读一行 NDJSON；连接关闭返回 null。调用方负责解释消息类型。</summary>
    public async Task<JsonElement?> ReceiveAsync(CancellationToken cancellationToken = default)
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
        await _pipe.DisposeAsync().ConfigureAwait(false);
    }
}
