using System.Text;
using BattlePlatform.Supervisor;
using BattlePlatform.Supervisor.Pipe;
using BattlePlatform.Supervisor.Supervision;

Console.OutputEncoding = Encoding.UTF8;

var options = SupervisorOptions.Parse(args);
using var mutex = new Mutex(initiallyOwned: true, $"Local\\bp-supervisor-{options.PipeName}", out var created);
if (!created)
{
    Console.Error.WriteLine("已有 Supervisor 实例在运行");
    return 2;
}

Console.WriteLine($"BP_PIPE={options.PipeName}");
Console.WriteLine($"BP_SUPERVISOR_PID={Environment.ProcessId}");

await using var service = new SupervisorService(options);
await using var server = new ControlServer(service, options.PipeName);
using var stopping = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    stopping.Cancel();
};
AppDomain.CurrentDomain.ProcessExit += (_, _) =>
{
    try
    {
        service.ShutdownAsync(CancellationToken.None).GetAwaiter().GetResult();
    }
    catch
    {
        // 退出路径不再抛错
    }
};

try
{
    await server.RunAsync(stopping.Token);
}
catch (OperationCanceledException)
{
    // 正常停止
}

return 0;
