using System.Net;
using System.Net.Sockets;

namespace GovernanceService.Infrastructure;

/// <summary>
/// İK webhook hedefleri için SSRF koruması. Oluşturma/güncellemede yalnızca https ve iç ağ
/// dışı (TransferGuard.IsInternalHost) adres kabul edilir; gönderimde bağlantı anındaki gerçek
/// IP de denetlenir (DNS rebinding). İzinli iç adlar WEBHOOK_ALLOWED_HOSTS (virgülle) ile verilir.
/// Servisin kendi test alıcısı (/api/webhooks/inbox/{token}) her zaman serbesttir.
/// REST hook (açık API, kiracının kendi n8n'i) aboneliklerine uygulanmaz.
/// </summary>
public static class WebhookTargetGuard
{
    private static readonly HashSet<string> AllowedHosts = (Environment.GetEnvironmentVariable("WEBHOOK_ALLOWED_HOSTS") ?? "")
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(h => h.ToLowerInvariant()).ToHashSet();

    public const string SelfInboxPrefix = "http://governance-service:8080/api/webhooks/inbox/";

    public static bool IsSelfInbox(string? url) =>
        url is not null && url.StartsWith(SelfInboxPrefix, StringComparison.Ordinal) && !url[SelfInboxPrefix.Length..].Contains('/');

    private static bool IsAllowedHost(string host) => AllowedHosts.Contains(host.TrimEnd('.').ToLowerInvariant());

    /// <summary>Geçerliyse null, değilse kullanıcıya gösterilecek hata.</summary>
    public static string? Validate(string? url)
    {
        if (IsSelfInbox(url)) return null;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps)
            return "Geçerli bir https adresi girin.";
        if (!IsAllowedHost(u.Host) && TransferGuard.IsInternalHost(url))
            return "İç ağ, yerel ya da özel IP adreslerine webhook gönderilemez.";
        return null;
    }

    /// <summary>Loopback, RFC 1918, CGNAT, link-local, ULA, 0.0.0.0/8 ve çok noktaya yayın adresleri.</summary>
    public static bool IsPrivate(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.IPv6None)) return true;
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast || (ip.GetAddressBytes()[0] & 0xFE) == 0xFC;
        var b = ip.GetAddressBytes();
        return b[0] is 0 or 10 or 127 || b[0] >= 224 || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168)
            || (b[0] == 169 && b[1] == 254) || (b[0] == 100 && b[1] is >= 64 and <= 127);
    }

    /// <summary>
    /// Bağlantı anında çözülen IP'yi denetleyen istemci: ad dışarıda bir adrese çözülse bile
    /// gönderim anında iç ağa çözülürse bağlanılmaz. Yönlendirme izlenmez.
    /// </summary>
    public static readonly HttpClient Client = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        ConnectCallback = async (ctx, ct) =>
        {
            var host = ctx.DnsEndPoint.Host;
            var addrs = IPAddress.TryParse(host.Trim('[', ']'), out var lit) ? new[] { lit } : await Dns.GetHostAddressesAsync(host, ct);
            if (!IsAllowedHost(host)) addrs = addrs.Where(a => !IsPrivate(a)).ToArray();
            if (addrs.Length == 0) throw new HttpRequestException("Hedef iç ağ adresine çözülüyor; webhook gönderilmedi.");
            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(addrs, ctx.DnsEndPoint.Port, ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    }) { Timeout = TimeSpan.FromSeconds(5) };
}
