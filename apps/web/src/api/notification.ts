import { apiFetch, qs } from './client'

const BASE = '/api/notification'

/* ------------------------------------------------------------------ tipler */

export type NotificationChannel = 'InApp' | 'Email' | 'Push' | 'Sms'
export type NotificationStatus = 'Pending' | 'Sent' | 'Failed' | 'Read'

export const notificationChannelLabels: Record<NotificationChannel, string> = {
  InApp: 'Uygulama içi',
  Email: 'E-posta',
  Push: 'Anlık bildirim',
  Sms: 'SMS',
}

export const notificationStatusLabels: Record<NotificationStatus, string> = {
  Pending: 'Kuyrukta',
  Sent: 'Gönderildi',
  Failed: 'Başarısız',
  Read: 'Okundu',
}

export interface AppNotification {
  id: string
  recipientEmployeeId: string
  /** Backend alan adı `subject` - `title` DEĞİL (bkz. NotificationsController.Create). */
  subject: string | null
  body: string | null
  channel: NotificationChannel
  status: NotificationStatus
  createdAt: string
  readAt: string | null
}

/** NOT: Önceden `subject`/`body` bekleniyordu; backend (NotificationTemplate)
 * `subjectTemplate`/`bodyTemplate` döner - şablon listesinde konu/gövde boştu. */
export interface NotificationTemplate {
  id: string
  code: string
  channel: NotificationChannel
  locale: string
  subjectTemplate: string | null
  bodyTemplate: string
  isActive: boolean
}

export interface CreateNotificationInput {
  recipientEmployeeId: string
  subject: string
  body?: string
  channel: NotificationChannel
}

/** Backend `CreateTemplateRequest`: önceden `subject`/`body` gönderiliyordu,
 * zorunlu `bodyTemplate` eksik kaldığı için her şablon oluşturma 400 alıyordu. */
export interface CreateTemplateInput {
  code: string
  channel: NotificationChannel
  locale?: string
  subjectTemplate: string
  bodyTemplate: string
}

/* ------------------------------------------------------------------ servis */

export const notificationApi = {
  // NOT: backend GetAll/GetUnreadCount sorgu parametresini "recipientId" olarak
  // okur (NotificationsController - [FromQuery] Guid? recipientId) - bu,
  // gövdedeki "recipientEmployeeId" alanından FARKLI bir isim, ama İKİSİ DE
  // aynı Employee.Id değerini taşır. Sorgu parametresi adı bilerek backend'le
  // birebir aynı bırakıldı.
  list: (
    filters: { recipientId?: string; status?: NotificationStatus; limit?: number } = {},
    signal?: AbortSignal,
  ) => apiFetch<AppNotification[]>(`${BASE}/notifications${qs(filters)}`, { signal }),

  create: (input: CreateNotificationInput) =>
    apiFetch<AppNotification>(`${BASE}/notifications`, {
      method: 'POST',
      body: {
        recipientEmployeeId: input.recipientEmployeeId,
        channel: input.channel,
        subject: input.subject,
        body: input.body,
      },
    }),

  markRead: (id: string) =>
    apiFetch<AppNotification>(`${BASE}/notifications/${id}/mark-read`, { method: 'POST' }),

  // NOT: backend {recipientId, unreadCount} döner - {count} DEĞİL. Önceki
  // hali `unread.data?.count` her zaman undefined okuyordu, yani bildirim
  // çanındaki rozet gerçek sayıdan bağımsız olarak HER ZAMAN gizliydi
  // (hardcore test, 3. tur).
  unreadCount: (recipientId: string, signal?: AbortSignal) =>
    apiFetch<{ recipientId: string; unreadCount: number }>(
      `${BASE}/notifications/unread-count${qs({ recipientId })}`,
      { signal },
    ),

  listTemplates: (signal?: AbortSignal) =>
    apiFetch<NotificationTemplate[]>(`${BASE}/notification-templates`, { signal }),

  createTemplate: (input: CreateTemplateInput) =>
    apiFetch<NotificationTemplate>(`${BASE}/notification-templates`, {
      method: 'POST',
      body: input,
    }),

  deleteTemplate: (id: string) =>
    apiFetch<void>(`${BASE}/notification-templates/${id}`, { method: 'DELETE' }),
}
