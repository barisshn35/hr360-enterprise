import { useMemo } from 'react'
import { useEmployees } from '@/api/queries'
import { fullName } from './format'

/**
 * Kimlikten çalışan adı çözer.
 *
 * Modül uçları çoğu yerde yalnızca `employeeId` döndürüyor; ekranda ham
 * kimlik göstermek İK ekranlarında okunmaz olurdu. Çalışan listesi zaten
 * önbellekte olduğu için ek istek doğurmaz. Ad henüz yüklenmediyse ya da
 * kayıt silinmişse kimliğin kendisi görünür — bilgi kaybolmaz.
 */
export function useEmployeeName(): (employeeId: string | null | undefined) => string {
  const employees = useEmployees()

  return useMemo(() => {
    const byId = new Map<string, string>()
    for (const e of employees.data ?? []) byId.set(e.id, fullName(e))
    return (id) => (id ? (byId.get(id) ?? id) : '—')
  }, [employees.data])
}
