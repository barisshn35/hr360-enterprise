import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn/21st.dev bileşenlerinin beklediği className birleştirici.
 * tailwind-merge sayesinde `p-2` + `p-4` gibi çakışmalarda sonuncusu kazanır —
 * bileşenlere dışarıdan className geçirip üzerine yazabilmek için gerekli.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
