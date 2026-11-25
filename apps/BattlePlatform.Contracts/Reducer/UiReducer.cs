using System.Text.Json;
using BattlePlatform.Contracts.Dto;

namespace BattlePlatform.Contracts.Reducer;

/// <summary>把 Supervisor 控制消息折叠成 UI 状态；不碰管道、不碰 WPF。</summary>
public static class UiReducer
{
    public static UiState Connected(UiState state, string? serverVersion = null) =>
        state with { Connection = ConnectionState.Connected, ServerVersion = serverVersion ?? state.ServerVersion, LastError = null };

    public static UiState Disconnected(UiState state) =>
        state with { Connection = ConnectionState.Disconnected, ServiceState = "stopped", ServicePid = null };

    public static UiState Apply(UiState state, JsonElement message)
    {
        if (!message.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String)
        {
            return state;
        }

        return type.GetString() switch
        {
            "welcome" => Connected(state, Text(message, "serverVersion")),
            "serviceStatus" => state with
            {
                ServiceState = Text(message, "state") ?? state.ServiceState,
                ServicePid = Number(message, "pid") ?? state.ServicePid,
                UiPort = Port(message, "uiPort") ?? state.UiPort,
                LanPort = Port(message, "lanPort") ?? state.LanPort,
                GamePort = Port(message, "gamePort") ?? state.GamePort,
            },
            "authorityStatus" => ApplyAuthority(state, message),
            "error" => state with { LastError = $"{Text(message, "code") ?? "ERROR"}: {Text(message, "text") ?? ""}".TrimEnd() },
            "pong" => state,
            _ => state,
        };
    }

    private static UiState ApplyAuthority(UiState state, JsonElement message)
    {
        var sessionId = Text(message, "sessionId");
        if (string.IsNullOrEmpty(sessionId)) return state;
        var view = new AuthorityView(
            sessionId,
            Text(message, "state") ?? "stopped",
            Number(message, "epoch") ?? 0,
            Number(message, "pid"),
            Text(message, "error"));
        var authorities = new Dictionary<string, AuthorityView>(state.Authorities) { [sessionId] = view };
        return state with { Authorities = authorities };
    }

    private static string? Text(JsonElement message, string name) =>
        message.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static long? Number(JsonElement message, string name) =>
        message.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number)
            ? number
            : null;

    private static int? Port(JsonElement message, string name)
    {
        var number = Number(message, name);
        return number is >= 0 and <= 65535 ? (int)number.Value : null;
    }
}
