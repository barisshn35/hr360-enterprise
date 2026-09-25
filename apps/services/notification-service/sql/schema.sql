-- notification-service (Hafta 23) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE notification_templates (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Code" text NOT NULL,
    "Channel" text NOT NULL,
    "Locale" text NOT NULL,
    "SubjectTemplate" text,
    "BodyTemplate" text NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_notification_templates_Code_Channel_Locale"
    ON notification_templates ("Code", "Channel", "Locale");

CREATE TABLE notification_messages (
    "Id" uuid NOT NULL PRIMARY KEY,
    "RecipientEmployeeId" uuid NOT NULL,
    "Channel" text NOT NULL,
    "TemplateCode" text,
    "Subject" text,
    "Body" text NOT NULL,
    "Status" text NOT NULL,
    "FailureReason" text,
    "AttemptCount" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "SentAt" timestamptz,
    "ReadAt" timestamptz
);
CREATE INDEX "IX_notification_messages_Recipient_Status"
    ON notification_messages ("RecipientEmployeeId", "Status");
