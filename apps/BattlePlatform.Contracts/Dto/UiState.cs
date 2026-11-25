namespace BattlePlatform.Contracts.Dto;

public enum ConnectionState
{
    Disconnected,
    Connecting,
    Connected,
}

public sealed record AuthorityView(string SessionId, string State, long Epoch, long? Pid, string? Error);

/// <summary>UI 只依赖这份状态；Web 与 WPF 用同一套 reducer 语义。</summary>
public sealed record UiState
{
    public ConnectionState Connection { get; init; } = ConnectionState.Disconnected;

    public string? ServerVersion { get; init; }

    public string? ServiceState { get; init; }

    public long? ServicePid { get; init; }

    public int? UiPort { get; init; }

    public int? LanPort { get; init; }

    public int? GamePort { get; init; }

    public IReadOnlyDictionary<string, AuthorityView> Authorities { get; init; } =
        new Dictionary<string, AuthorityView>();

    public string? LastError { get; init; }
}
