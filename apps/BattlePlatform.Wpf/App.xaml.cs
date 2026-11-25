using System.Windows;

namespace BattlePlatform.Wpf;

public partial class App : System.Windows.Application
{
    private MainWindow? _window;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _window = new MainWindow();
        MainWindow = _window;
        _window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _window?.Dispose();
        base.OnExit(e);
    }
}
