/**
 * Document designation each displayed quantity is computed by. These are
 * standard references, identical in both UI languages, so they are not
 * localised. The numbering follows CalcDSTU8586/GOST30319, which this module
 * ports 1:1 — the formula numbers match the ones those assemblies cite.
 */
export const STD = {
  zGerg: 'ГОСТ 30319.2, ф. 37',
  zNx: 'ГОСТ 30319.2, ф. 6',
  zc: 'ГОСТ 30319.1, ф. 36',
  k: 'ГОСТ 30319.1',
  rhoW: 'ГОСТ 30319.1, ф. 6',
  mu: 'ГОСТ 30319.1, ф. 44/45',
  tpk: 'ГОСТ 30319.2, ф. 18',
  ppk: 'ГОСТ 30319.2, ф. 17',
  DT: 'ДСТУ ГОСТ 8.586.1, ф. 5.5',
  dT: 'ДСТУ ГОСТ 8.586.1, ф. 5.4',
  beta: 'ДСТУ ГОСТ 8.586.1, ф. 3.1',
  C: 'ДСТУ ГОСТ 8.586.2, ф. 5.6',
  ksh: 'ДСТУ ГОСТ 8.586.2, ф. 5.11',
  kbl: 'ДСТУ ГОСТ 8.586.2, ф. 5.13/5.16',
  eps: 'ДСТУ ГОСТ 8.586.2, ф. 5.7',
  re: 'ДСТУ ГОСТ 8.586.5, ф. 5.11',
  q: 'ДСТУ ГОСТ 8.586.5, ф. 5.8',
} as const

/** Kst method names — standard notation, untranslated. */
export const KST_METHOD_NAMES = ['', 'GERG-91 мод.', 'NX-19 мод.'] as const
