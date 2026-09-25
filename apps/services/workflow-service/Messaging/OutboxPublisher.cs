using System.Text.Json;
using Confluent.Kafka;
using Microsoft.EntityFrameworkCore;
using WorkflowService.Data;
using WorkflowService.Messaging;

namespace WorkflowService.Messaging;

/// <summary>
/// Outbox tablosunu periyodik tarar, yayinlanmamis event'leri Kafka'ya gonderir.
/// At-least-once teslim: Kafka'ya gidip DB isaretlenmeden once cokerse event
/// tekrar gonderilir - bu yuzden tuketiciler idempotent olmak zorunda.
/// </summary>
public class OutboxPublisher : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<OutboxPublisher> _logger;
    private readonly string _bootstrapServers;
    private readonly TimeSpan _interval = TimeSpan.FromSeconds(5);
    private const int BatchSize = 50;
    private const int MaxAttempts = 10;

    public OutboxPublisher(IServiceProvider services, ILogger<OutboxPublisher> logger)
    {
        _services = services;
        _logger = logger;
        _bootstrapServers = Environment.GetEnvironmentVariable("KAFKA_BOOTSTRAP_SERVERS")
            ?? "172.33.55.5:9092";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var config = new ProducerConfig
        {
            BootstrapServers = _bootstrapServers,
            // Kayipsizlik icin: tum replikalar onaylasin, gerekirse tekrar dene.
            Acks = Acks.All,
            EnableIdempotence = true,
            MessageSendMaxRetries = 3,
        };

        using var producer = new ProducerBuilder<string, string>(config).Build();
        _logger.LogInformation("OutboxPublisher basladi. Kafka: {Servers}", _bootstrapServers);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PublishBatchAsync(producer, stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Outbox yayin dongusunde beklenmeyen hata");
            }

            try { await Task.Delay(_interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        producer.Flush(TimeSpan.FromSeconds(5));
    }

    private async Task PublishBatchAsync(IProducer<string, string> producer, CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WorkflowDbContext>();

        var pending = await db.OutboxMessages
            .Where(m => m.PublishedAt == null && m.AttemptCount < MaxAttempts)
            .OrderBy(m => m.CreatedAt)
            .Take(BatchSize)
            .ToListAsync(ct);

        if (pending.Count == 0) return;

        foreach (var message in pending)
        {
            try
            {
                var kafkaMessage = new Message<string, string>
                {
                    Key = message.PartitionKey,
                    Value = message.Payload,
                    Headers = new Headers
                    {
                        { "event-type", System.Text.Encoding.UTF8.GetBytes(message.EventType) },
                        { "event-id", System.Text.Encoding.UTF8.GetBytes(message.Id.ToString()) },
                    }
                };

                await producer.ProduceAsync(message.Topic, kafkaMessage, ct);

                message.PublishedAt = DateTimeOffset.UtcNow;
                message.LastError = null;
                _logger.LogInformation(
                    "Event yayinlandi: {EventType} -> {Topic} (id={Id})",
                    message.EventType, message.Topic, message.Id);
            }
            catch (Exception ex)
            {
                message.AttemptCount++;
                message.LastError = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
                _logger.LogWarning(ex,
                    "Event yayinlanamadi: {EventType} (deneme {Attempt}/{Max})",
                    message.EventType, message.AttemptCount, MaxAttempts);
            }
        }

        await db.SaveChangesAsync(ct);
    }
}
