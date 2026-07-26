import { Fragment } from 'react'

/**
 * Renders the `<sub>…</sub>` markup the flow-calc locale strings carry
 * (ρ<sub>р</sub>, K<sub>ш</sub>, …) without going through innerHTML.
 * Anything other than that one tag is shown as plain text.
 */
export function RichLabel({ text }: { text: string }) {
  const parts = text.split(/(<sub>.*?<\/sub>)/g)
  return (
    <>
      {parts.map((part, i) => {
        const m = /^<sub>(.*?)<\/sub>$/.exec(part)
        return m ? <sub key={i}>{m[1]}</sub> : <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}
