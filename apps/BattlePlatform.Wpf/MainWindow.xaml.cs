using System.ComponentModel;
using System.Text;
using System.Text.Json;
using System.Windows;
using BattlePlatform.Contracts.Control;
using BattlePlatform.Contracts.Dto;
using BattlePlatform.Contracts.Reducer;
using BattlePlatform.Protocol;
using Forms = System.Windows.Forms;

namespace BattlePlatform.Wpf;

public partial class MainWindow : Window, IDisposable
{
    private readonly CancellationTokenSource _cts = new();
    private readonly StringBuilder _log = new();
    private ControlClient? _client;
    private UiState _state = new();
    private Forms.NotifyIcon? _tray;
    private bool _exiting;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        SetupTray();
        await ConnectAsync();
    }

    private void SetupTray()
    {
        _tray = new Forms.NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Text = "3178 联机平台",
            Visible = true,
        };
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("显示", null, (_, _) => RestoreFromTray());
        menu.Items.Add("退出", null, (_, _) => _ = ExitAsync());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => RestoreFromTray();
    }

    private void RestoreFromTray()
    {
        Dispatcher.Invoke(() =>
        {
            Show();
            WindowState = WindowState.Normal;
            Activate();
        });
    }

    private async Task ConnectAsync()
    {
        _state = _state with { Connection = ConnectionState.Connecting };
        Render();
        try
        {
            _client = await ControlClient.ConnectAsync(SupervisorPipe.Name, TimeSpan.FromSeconds(2), _cts.Token);
            await _client.SendAsync(new ClientHello
            {
                Type = ClientHelloType.Hello,
                Version = 1,
                ClientKind = ClientKind.Ui,
            }, _cts.Token);
            AppendLog($"已连接 Supervisor：{SupervisorPipe.Name}");
            _ = ReceiveLoopAsync(_client, _cts.Token);
        }
        catch (Exception error)
        {
            AppendLog($"连接 Supervisor 失败：{error.Message}");
            _state = UiReducer.Disconnected(_state);
            Render();
        }
    }

    private async Task ReceiveLoopAsync(ControlClient client, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var message = await client.ReceiveAsync(cancellationToken);
                if (message is null) break;
                var value = message.Value;
                await Dispatcher.InvokeAsync(() =>
                {
                    _state = UiReducer.Apply(_state, value);
                    Render();
                    AppendLog(value.GetRawText());
                });
            }
        }
        catch (OperationCanceledException)
        {
            // 正常退出
        }
        catch (Exception error)
        {
            await Dispatcher.InvokeAsync(() => AppendLog($"控制连接断开：{error.Message}"));
        }
        finally
        {
            await Dispatcher.InvokeAsync(() =>
            {
                _state = UiReducer.Disconnected(_state);
                Render();
            });
        }
    }

    private void Render()
    {
        var connected = _state.Connection == ConnectionState.Connected;
        StatusText.Text = _state.Connection switch
        {
            ConnectionState.Connected => $"已连接 · 服务：{_state.ServiceState ?? "未知"}",
            ConnectionState.Connecting => "正在连接 Supervisor…",
            _ => "Supervisor 未连接",
        };
        PortsText.Text = connected
            ? $"管理端口：{_state.UiPort?.ToString() ?? "—"} · 游戏端口：{_state.GamePort?.ToString() ?? "—"}"
            : "请确认 bp-supervisor 已启动";
        StartButton.IsEnabled = connected && _state.ServiceState is null or "stopped" or "failed" or "exited";
        StopButton.IsEnabled = connected && _state.ServiceState is "running" or "starting";
        ReconnectButton.IsEnabled = !connected;
    }

    private void AppendLog(string line)
    {
        _log.Insert(0, $"{DateTime.Now:HH:mm:ss} {line}{Environment.NewLine}");
        if (_log.Length > 20000) _log.Length = 20000;
        LogText.Text = _log.ToString();
    }

    private async void OnStart(object sender, RoutedEventArgs e)
    {
        if (_client is null) return;
        try
        {
            await _client.SendAsync(new ServiceStart { Type = ServiceStartType.ServiceStart }, _cts.Token);
        }
        catch (Exception error)
        {
            AppendLog($"启动服务失败：{error.Message}");
        }
    }

    private async void OnStop(object sender, RoutedEventArgs e)
    {
        if (_client is null) return;
        try
        {
            await _client.SendAsync(new ServiceStop { Type = ServiceStopType.ServiceStop }, _cts.Token);
        }
        catch (Exception error)
        {
            AppendLog($"停止服务失败：{error.Message}");
        }
    }

    private async void OnReconnect(object sender, RoutedEventArgs e)
    {
        _client?.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(1));
        _client = null;
        await ConnectAsync();
    }

    private async void OnExit(object sender, RoutedEventArgs e)
    {
        await ExitAsync();
    }

    private async Task ExitAsync()
    {
        if (_exiting) return;
        _exiting = true;
        try
        {
            if (_client is not null)
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await _client.SendAsync(new Shutdown { Type = ShutdownType.Shutdown }, timeout.Token);
                await Task.Delay(150, timeout.Token);
            }
        }
        catch
        {
            // Supervisor 可能已经退出
        }
        Dispose();
        System.Windows.Application.Current.Shutdown();
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_exiting) return;
        e.Cancel = true;
        Hide();
        _tray?.ShowBalloonTip(2000, "3178 联机平台", "已收进托盘，服务继续运行。", Forms.ToolTipIcon.Info);
    }

    public void Dispose()
    {
        _cts.Cancel();
        _client?.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(1));
        _client = null;
        _tray?.Dispose();
        _tray = null;
        _cts.Dispose();
    }
}
