using System.Security.Principal;

namespace BattlePlatform.Contracts.Control;

/// <summary>控制管道命名规则：当前用户 SID，避免多用户会话互相连接。</summary>
public static class SupervisorPipe
{
    public static string Name
    {
        get
        {
            var sid = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
            return $"bp-control-{sid}";
        }
    }
}
