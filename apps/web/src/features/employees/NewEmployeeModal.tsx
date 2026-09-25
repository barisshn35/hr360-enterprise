import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { employeeApi } from '@/api/employees'
import { tenantApi } from '@/api/tenant'
import { qk } from '@/api/queries'
import { Modal, ErrorSummary, type SummaryItem } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { TextField, SelectField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

interface DepartmentOption {
  id: string
  label: string
}

interface Form {
  firstName: string
  lastName: string
  email: string
  phone: string
  hireDate: string
  departmentId: string
}

type Errors = Partial<Record<keyof Form, string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^[0-9+()\s-]{7,20}$/

function validate(form: Form): Errors {
  const errors: Errors = {}
  if (form.firstName.trim().length < 2) errors.firstName = 'Ad en az 2 karakter olmalı.'
  if (form.lastName.trim().length < 2) errors.lastName = 'Soyad en az 2 karakter olmalı.'
  if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Geçerli bir e-posta adresi girin.'
  if (form.phone && !PHONE_RE.test(form.phone.trim()))
    errors.phone = 'Telefon numarası geçerli görünmüyor.'
  if (!form.hireDate) errors.hireDate = 'İşe giriş tarihi zorunlu.'
  return errors
}

const EMPTY: Form = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  hireDate: '',
  departmentId: '',
}

export function NewEmployeeModal({
  open,
  onClose,
  departments,
}: {
  open: boolean
  onClose: () => void
  departments: DepartmentOption[]
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!open) {
      setForm(EMPTY)
      setErrors({})
      setSubmitted(false)
    }
  }, [open])

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const setDepartment = (value: string) => setForm((f) => ({ ...f, departmentId: value }))

  const revalidate = () => submitted && setErrors(validate(form))

  const mutation = useMutation({
    mutationFn: async () => {
      const employee = await employeeApi.create({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        hireDate: form.hireDate,
      })

      if (form.departmentId) {
        try {
          await employeeApi.addAssignment(employee.id, {
            departmentId: form.departmentId,
            positionTitle: undefined,
            effectiveFrom: form.hireDate,
          })
        } catch {
          // Çalışan zaten oluşturuldu; departman ataması Şema/Liste'den
          // elle tamamlanabilir - burada sessiz kalmak akışı kesmez.
        }
      }

      let inviteSent = false
      try {
        await tenantApi.inviteMember(employee.id)
        inviteSent = true
      } catch {
        // Davet e-postası gönderilemedi (SMTP yapılandırılmamış olabilir) -
        // çalışan kaydı yine de geçerli, davet daha sonra elle gönderilebilir.
      }

      return { employee, inviteSent }
    },
    onSuccess: ({ employee, inviteSent }) => {
      void queryClient.invalidateQueries({ queryKey: qk.employees })
      void queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.ok(
        inviteSent
          ? `${employee.firstName} ${employee.lastName} kaydedildi. Parola belirleme e-postası gönderildi.`
          : `${employee.firstName} ${employee.lastName} kaydedildi. Davet e-postası gönderilemedi, sonra tekrar deneyin.`,
      )
      onClose()
      navigate(`/panel/calisanlar/${employee.id}`)
    },
    onError: (e: unknown) => {
      toast.stop(e instanceof Error ? e.message : 'Çalışan oluşturulamadı.')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    const next = validate(form)
    setErrors(next)
    if (Object.keys(next).length === 0) mutation.mutate()
  }

  const summary: SummaryItem[] = submitted
    ? (Object.entries(errors)
        .filter(([, message]) => Boolean(message))
        .map(([key, message]) => ({
          fieldId: `employee-${key}`,
          message: message!,
        })) as SummaryItem[])
    : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni çalışan"
      note="Temel bilgileri girin. Kayıt tamamlanınca giriş için parola belirleme e-postası gönderilir."
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="new-employee-form"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Çalışanı kaydet
          </Button>
        </>
      }
    >
      <form id="new-employee-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <ErrorSummary items={summary} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="employee-firstName"
            label="Ad"
            required
            autoComplete="given-name"
            value={form.firstName}
            onChange={set('firstName')}
            onBlur={revalidate}
            error={errors.firstName}
          />
          <TextField
            id="employee-lastName"
            label="Soyad"
            required
            autoComplete="family-name"
            value={form.lastName}
            onChange={set('lastName')}
            onBlur={revalidate}
            error={errors.lastName}
          />
        </div>

        <TextField
          id="employee-email"
          label="E-posta"
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          onBlur={revalidate}
          error={errors.email}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="employee-phone"
            label="Telefon"
            type="tel"
            autoComplete="tel"
            hint="İsteğe bağlı"
            value={form.phone}
            onChange={set('phone')}
            onBlur={revalidate}
            error={errors.phone}
          />
          <TextField
            id="employee-hireDate"
            label="İşe giriş tarihi"
            type="date"
            required
            value={form.hireDate}
            onChange={set('hireDate')}
            onBlur={revalidate}
            error={errors.hireDate}
          />
        </div>

        <SelectField
          id="employee-department"
          label="Departman"
          value={form.departmentId}
          onChange={setDepartment}
          placeholder="Departman seçin (isteğe bağlı)"
          options={departments.map((d) => ({ value: d.id, label: d.label }))}
          hint={
            departments.length === 0
              ? 'Henüz departman yok; daha sonra Organizasyon sayfasından atayabilirsiniz.'
              : undefined
          }
        />
      </form>
    </Modal>
  )
}
