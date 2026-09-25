using Confluent.Kafka;
using Microsoft.EntityFrameworkCore;
using ExpenseService.Data;
using ExpenseService.Tenancy;

namespace ExpenseService.Messaging;

/// <summary>
/// Kafka tuketicisi icin ortak iskelet: abone olur, event-id ile idempotency
/// kontrolu yapar, is mantigini calistirir, offset'i ELLE commit eder
/// (islem basarisiz olursa offset ilerlemesin diye).
/// </summary>
public abstract class KafkaConsumerBase : BackgroundService
{
    protected readonly IServiceProvider Services;
    protected readonly ILogger Logger;
    private readonly string _bootstrapServers;
    private readonly string _groupId;
    private readonly string[] _topics;

    protected KafkaConsumerBase(
        IServiceProvider services, ILogger logger, string groupId, params string[] topics)
    {
        Services = services;
        Logger = logger;
        _groupId = groupId;
        _topics = topics;
        _bootstrapServers = Environment.GetEnvironmentVariable("KAFKA_BOOTSTRAP_SERVERS")
            ?? "172.33.55.5:9092";
    }

    /// <summary>Bu tuketicinin adi - idempotency kaydinda kullanilir.</summary>
    protected abstract string ConsumerName { get; }

    /// <summary>Gercek is mantigi. Hata firlatilirsa offset commit EDILMEZ.</summary>
    protected abstract Task HandleAsync(
        string eventType, string payload, ExpenseDbContext db, CancellationToken ct);

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
        => Task.Run(() => ConsumeLoop(stoppingToken), stoppingToken);

    private async Task ConsumeLoop(CancellationToken stoppingToken)
    {
        var config = new ConsumerConfig
        {
            BootstrapServers = _bootstrapServers,
            GroupId = _groupId,
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false,   // basarili islemden sonra elle commit
        };

        using var consumer = new ConsumerBuilder<string, string>(config)
            .SetErrorHandler((_, e) => Logger.LogWarning("Kafka hatasi: {Reason}", e.Reason))
            .Build();

        consumer.Subscribe(_topics);
        Logger.LogInformation(
            "{Consumer} basladi. Konular: {Topics}, grup: {Group}",
            ConsumerName, string.Join(", ", _topics), _groupId);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var result = consumer.Consume(TimeSpan.FromSeconds(1));
                if (result?.Message is null) continue;

                var eventType = GetHeader(result.Message.Headers, "event-type");
                var eventIdRaw = GetHeader(result.Message.Headers, "event-id");

                if (!Guid.TryParse(eventIdRaw, out var eventId))
                {
                    Logger.LogWarning("event-id header'i okunamadi, mesaj atlaniyor");
                    consumer.Commit(result);
                    continue;
                }

                using var scope = Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<ExpenseDbContext>();

                // Bu bir arka plan iscisi - HTTP istegi olmadigi icin
                // TenantContext hicbir zaman doldurulmuyor. Doldurulmadan
                // ApplyTenantFilters TUM sorgulari (ExpenseClaim gibi
                // ITenantOwned entity'ler icin) sessizce bos dondurur -
                // Claims/LeaveRequests sorgulari hicbir zaman eslesmezdi.
                var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();
                tenantContext.IsPlatformAdmin = true;

                // Idempotency: bu event daha once islendi mi?
                var already = await db.ProcessedEvents
                    .AnyAsync(p => p.EventId == eventId && p.Consumer == ConsumerName, stoppingToken);
                if (already)
                {
                    Logger.LogDebug("Event zaten islenmis, atlaniyor: {EventId}", eventId);
                    consumer.Commit(result);
                    continue;
                }

                await HandleAsync(eventType ?? "", result.Message.Value, db, stoppingToken);

                db.ProcessedEvents.Add(new ProcessedEvent
                {
                    EventId = eventId,
                    EventType = eventType ?? "",
                    Consumer = ConsumerName,
                });
                await db.SaveChangesAsync(stoppingToken);

                consumer.Commit(result);
                Logger.LogInformation("Event islendi: {EventType} ({EventId})", eventType, eventId);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                // Offset commit edilmedi: mesaj tekrar denenecek.
                Logger.LogError(ex, "Event islenirken hata, offset ilerletilmedi");
                await Task.Delay(TimeSpan.FromSeconds(2), CancellationToken.None);
            }
        }

        consumer.Close();
    }

    private static string? GetHeader(Headers? headers, string key)
    {
        if (headers is null) return null;
        return headers.TryGetLastBytes(key, out var bytes)
            ? System.Text.Encoding.UTF8.GetString(bytes)
            : null;
    }
}
