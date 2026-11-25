using System.Security.Principal;

namespace BattlePlatform.Supervisor;

/// <summary>Supervisor 启动参数；默认按安装目录布局推断，开发时可用 --root 指仓库根。</summary>
public sealed record SupervisorOptions
{
    public required string Root { get; init; }

    public required string NodePath { get; init; }

    public required string ServiceEntry { get; init; }

    public required string DataDir { get; init; }

    public string? GamesDir { get; init; }

    public int LanPort { get; init; } = 3000;

    public int GamePort { get; init; } = 3001;

    public required string PipeName { get; init; }

    public static SupervisorOptions Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index += 1)
        {
            var arg = args[index];
            if (!arg.StartsWith("--", StringComparison.Ordinal)) continue;
            var name = arg[2..];
            if (index + 1 < args.Length && !args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                values[name] = args[++index];
            }
            else
            {
                values[name] = "true";
            }
        }

        var root = Path.GetFullPath(values.GetValueOrDefault("root", AppContext.BaseDirectory));
        var node = values.GetValueOrDefault("node", Path.Combine(root, "runtime", "node.exe"));
        if (!File.Exists(node)) node = "node";

        var defaultData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "3178-battle-platform",
            "data");
        var games = values.GetValueOrDefault("games-dir", Path.Combine(root, "games"));

        var defaultService = Path.Combine(root, "packages", "session-service", "dist", "main.js");
        if (!File.Exists(defaultService)) defaultService = Path.Combine(root, "packages", "session-service", "dist", "main.cjs");

        var sid = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        return new SupervisorOptions
        {
            Root = root,
            NodePath = node,
            ServiceEntry = Path.GetFullPath(values.GetValueOrDefault("service-entry", defaultService)),
            DataDir = Path.GetFullPath(values.GetValueOrDefault("data-dir", defaultData)),
            GamesDir = Directory.Exists(games) ? games : null,
            LanPort = ReadPort(values, "lan-port", 3000),
            GamePort = ReadPort(values, "game-port", 3001),
            PipeName = values.GetValueOrDefault("pipe", $"bp-control-{sid}"),
        };
    }

    private static int ReadPort(Dictionary<string, string> values, string name, int fallback) =>
        int.TryParse(values.GetValueOrDefault(name), out var port) && port is >= 0 and <= 65535 ? port : fallback;
}
