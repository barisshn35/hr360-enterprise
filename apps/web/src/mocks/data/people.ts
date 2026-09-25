/**
 * Örnek şirket: Acme Holding. 22 çalışan, 4 departman.
 *
 * Platform ekibi 12 kişi ve bilerek karışık: terfi adayı, acil aksiyon,
 * düşüşte olan, geçici puanlı, hiç puanı olmayan yeni gelenler ve bir eski
 * üye. Satış ekibi 5 kişi ve puanları birbirine çok yakın — "ekip içi farklar
 * küçük" notunu ve ML katmanının "ekip küçük" gerekçesiyle atlanmasını
 * göstermek için.
 */

import type { Company, Employee } from '@/api/types'
import { uid } from '../util'

export const COMPANY_ID = uid('company', 'acme')

export const DEPT = {
  yazilim: uid('dept', 'yazilim'),
  satis: uid('dept', 'satis'),
  urun: uid('dept', 'urun'),
  ik: uid('dept', 'ik'),
  /** Alt departman örneği: Yazılım › Mobil Geliştirme. */
  mobil: uid('dept', 'mobil'),
} as const

export const DEPARTMENTS = [
  { id: DEPT.yazilim, name: 'Yazılım', companyId: COMPANY_ID, parentDepartmentId: null, headEmployeeId: null },
  { id: DEPT.satis, name: 'Satış', companyId: COMPANY_ID, parentDepartmentId: null, headEmployeeId: null },
  { id: DEPT.urun, name: 'Ürün', companyId: COMPANY_ID, parentDepartmentId: null, headEmployeeId: null },
  { id: DEPT.ik, name: 'İnsan Kaynakları', companyId: COMPANY_ID, parentDepartmentId: null, headEmployeeId: null },
  { id: DEPT.mobil, name: 'Mobil Geliştirme', companyId: COMPANY_ID, parentDepartmentId: DEPT.yazilim, headEmployeeId: null },
]

export const COMPANIES: Company[] = [
  {
    id: COMPANY_ID,
    name: 'Acme Holding A.Ş.',
    taxNumber: '1234567890',
    createdAt: '2024-03-12T09:00:00Z',
    departments: DEPARTMENTS,
  },
]

export type PersonKey =
  | 'mert' | 'ayse' | 'elif' | 'burak' | 'zeynep' | 'kaan' | 'seda' | 'baris' | 'gizem' | 'hakan'
  | 'tolga' | 'sena' | 'oguz' | 'emre'
  | 'can' | 'selin' | 'kerem' | 'ece' | 'pinar'
  | 'deniz' | 'irem'
  | 'onur' | 'derya'

interface Person {
  key: PersonKey
  first: string
  last: string
  dept: keyof typeof DEPT
  title: string
  hired: string
  /** Ayrıldıysa tarih. */
  left?: string
}

const PEOPLE: Person[] = [
  // Yazılım — Platform ekibi (12 aktif + 1 eski)
  { key: 'mert', first: 'Mert', last: 'Şahin', dept: 'yazilim', title: 'Takım Lideri', hired: '2019-09-16' },
  { key: 'ayse', first: 'Ayşe', last: 'Demir', dept: 'yazilim', title: 'Kıdemli Yazılım Mühendisi', hired: '2021-02-01' },
  { key: 'elif', first: 'Elif', last: 'Kaya', dept: 'yazilim', title: 'Yazılım Mühendisi', hired: '2023-01-09' },
  { key: 'burak', first: 'Burak', last: 'Tan', dept: 'yazilim', title: 'Yazılım Mühendisi', hired: '2022-06-13' },
  { key: 'zeynep', first: 'Zeynep', last: 'Ak', dept: 'yazilim', title: 'Test Mühendisi', hired: '2024-02-19' },
  { key: 'kaan', first: 'Kaan', last: 'Aydın', dept: 'yazilim', title: 'Kıdemli Yazılım Mühendisi', hired: '2020-10-05' },
  { key: 'seda', first: 'Seda', last: 'Koç', dept: 'yazilim', title: 'Yazılım Mühendisi', hired: '2022-11-21' },
  { key: 'baris', first: 'Barış', last: 'Yılmaz', dept: 'yazilim', title: 'DevOps Mühendisi', hired: '2021-08-30' },
  { key: 'gizem', first: 'Gizem', last: 'Tuna', dept: 'yazilim', title: 'Yazılım Mühendisi', hired: '2025-11-03' },
  { key: 'hakan', first: 'Hakan', last: 'Özer', dept: 'yazilim', title: 'Yazılım Mühendisi', hired: '2023-05-15' },
  { key: 'tolga', first: 'Tolga', last: 'Er', dept: 'yazilim', title: 'Yazılım Mühendisi', hired: '2026-07-01' },
  { key: 'sena', first: 'Sena', last: 'Bulut', dept: 'yazilim', title: 'Stajyer Mühendis', hired: '2026-08-10' },
  { key: 'oguz', first: 'Oğuz', last: 'Kara', dept: 'yazilim', title: 'Yazılım Mühendisi', hired: '2022-03-07', left: '2026-05-31' },
  { key: 'emre', first: 'Emre', last: 'Polat', dept: 'yazilim', title: 'Mühendislik Direktörü', hired: '2016-08-29' },
  // Satış — Kurumsal satış ekibi (5)
  { key: 'can', first: 'Can', last: 'Yıldız', dept: 'satis', title: 'Satış Müdürü', hired: '2018-04-23' },
  { key: 'selin', first: 'Selin', last: 'Öz', dept: 'satis', title: 'Kurumsal Satış Uzmanı', hired: '2022-09-05' },
  { key: 'kerem', first: 'Kerem', last: 'Yıldırım', dept: 'satis', title: 'Kurumsal Satış Uzmanı', hired: '2021-07-12' },
  { key: 'ece', first: 'Ece', last: 'Korkmaz', dept: 'satis', title: 'Satış Destek Uzmanı', hired: '2023-10-02' },
  { key: 'pinar', first: 'Pınar', last: 'Uslu', dept: 'satis', title: 'Satış Uzmanı', hired: '2026-08-04' },
  // Ürün
  { key: 'deniz', first: 'Deniz', last: 'Arslan', dept: 'urun', title: 'Ürün Yöneticisi', hired: '2020-11-02' },
  { key: 'irem', first: 'İrem', last: 'Güneş', dept: 'urun', title: 'Ürün Tasarımcısı', hired: '2023-04-24' },
  // İK
  { key: 'onur', first: 'Onur', last: 'Çelik', dept: 'ik', title: 'İK Uzmanı', hired: '2022-01-17' },
  { key: 'derya', first: 'Derya', last: 'Aksoy', dept: 'ik', title: 'İK Direktörü', hired: '2017-05-08' },
]

const ascii = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')

export const EMP: Record<PersonKey, string> = Object.fromEntries(
  PEOPLE.map((p) => [p.key, uid('emp', p.key)]),
) as Record<PersonKey, string>

export const EMPLOYEES: Employee[] = PEOPLE.map((p) => ({
  id: EMP[p.key],
  firstName: p.first,
  lastName: p.last,
  email: `${ascii(p.first)}.${ascii(p.last)}@acme.com.tr`,
  phone: null,
  hireDate: p.hired,
  status: p.left ? 2 : 0,
  assignments: [
    {
      id: uid('asg', p.key),
      departmentId: DEPT[p.dept],
      positionTitle: p.title,
      effectiveFrom: p.hired,
      effectiveTo: p.left ?? null,
    },
  ],
}))

const byId = new Map(EMPLOYEES.map((e) => [e.id, e]))

export function nameOf(id: string | null | undefined): string {
  const e = id ? byId.get(id) : undefined
  return e ? `${e.firstName} ${e.lastName}` : 'Bilinmeyen çalışan'
}

export function departmentOf(employeeId: string): string | null {
  return byId.get(employeeId)?.assignments[0]?.departmentId ?? null
}

export function hireDateOf(employeeId: string): string | null {
  return byId.get(employeeId)?.hireDate ?? null
}

export function isFormer(employeeId: string): boolean {
  return byId.get(employeeId)?.status === 2
}

export function employeeByEmail(email: string | null): Employee | undefined {
  if (!email) return undefined
  return EMPLOYEES.find((e) => e.email.toLocaleLowerCase('tr-TR') === email.toLocaleLowerCase('tr-TR'))
}

export const person = (id: string) => ({ employeeId: id, name: nameOf(id) })
