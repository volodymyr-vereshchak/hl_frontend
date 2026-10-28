import type { ReactNode } from 'react'
import { Box, Tooltip } from '@mantine/core'
import type { FixMark } from '@/domain/volumeFix'

/**
 * A volume the backend had to stand in for (see domain/volumeFix): yellow when
 * it was rebuilt from the hours, red when it is simply unknown and shown as 0.
 * The number itself stays as it is — only the reason is added.
 */
export function VolumeFixMark({ mark, children }: { mark: FixMark; children: ReactNode }) {
  return (
    <Tooltip label={mark.hint} multiline w={320} withArrow openDelay={150}>
      <Box
        component="span"
        style={{
          background:
            mark.tone === 'zeroed'
              ? 'var(--mantine-color-red-light)'
              : 'var(--mantine-color-yellow-light)',
          borderRadius: 4,
          padding: '0 4px',
          cursor: 'help',
        }}
      >
        {children}
      </Box>
    </Tooltip>
  )
}
