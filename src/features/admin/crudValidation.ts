/**
 * Whether a required field in a CrudTable form has been answered.
 *
 * Split out of the component because the rule has three exceptions and each
 * one is a bug someone hit:
 *
 *   - a checkbox is never missing — `false` IS an answer, and treating it as
 *     empty made "не показувати" impossible to save;
 *   - an empty list is missing, which `value == null || value === ''` does not
 *     catch — a member list or a branch-access picker left untouched would
 *     otherwise sail past the check and fail at the API, naming a column the
 *     person never saw;
 *   - a field hidden from the form cannot be filled in, so it is never
 *     required of the person looking at it.
 */
export interface RequiredCheckField {
  key: string
  label: string
  type?: 'text' | 'number' | 'checkbox' | 'select'
  required?: boolean
  hideInForm?: boolean
}

export function isFieldMissing(
  field: RequiredCheckField,
  form: Record<string, unknown>,
): boolean {
  if (!field.required) return false
  if (field.type === 'checkbox') return false
  const value = form[field.key]
  if (Array.isArray(value)) return value.length === 0
  return value == null || value === ''
}

/** Labels of the fields the person still has to fill in. */
export function missingFieldLabels(
  fields: RequiredCheckField[],
  form: Record<string, unknown>,
): string[] {
  return fields.filter((f) => !f.hideInForm && isFieldMissing(f, form)).map((f) => f.label)
}
