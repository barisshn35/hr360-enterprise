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
  recipientId: string
  title: string
  body: string | null
  channel: NotificationChannel
  status: NotificationStatus
  createdAt: string
  readAt: string | null
}

export interface NotificationTemplate {
  id: string
  code: string
  channel: NotificationChannel
  subject: string
  body: string
}

export interface CreateNotificationInput {
  recipientId: string
  title: string
  body?: string
  channel: NotificationChannel
}

export interface CreateTemplateInput {
  code: string
  channel: NotificationChannel
  subject: string
  body: string
}

/* ------------------------------------------------------------------ servis */

export const notificationApi = {
  list: (
    filters: { recipientId?: string; status?: NotificationStatus; limit?: number } = {},
    signal?: AbortSignal,
  ) => apiFetch<AppNotification[]>(`${BASE}/notifications${qs(filters)}`, { signal }),

  create: (input: CreateNotificationInput) =>
    apiFetch<AppNotification>(`${BASE}/notifications`, { method: 'POST', body: input }),

  markRead: (id: string) =>
    apiFetch<AppNotification>(`${BASE}/notifications/${id}/mark-read`, { method: 'POST' }),

  unreadCount: (recipientId: string, signal?: AbortSignal) =>
    apiFetch<{ count: number }>(`${BASE}/notifications/unread-count${qs({ recipientId })}`, {
      signal,
    }),

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
