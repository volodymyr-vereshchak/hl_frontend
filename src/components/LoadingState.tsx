import { Box, Center, Loader, Stack, Text } from '@mantine/core'

/**
 * The single "working on it" state for the whole app: a ring plus a pulsing
 * caption, so a long fetch reads as alive rather than frozen. Every screen uses
 * it so waiting never looks different from one page to the next.
 */
export function LoadingState({
  label,
  py = 60,
  size = 'md',
}: {
  label?: string
  py?: number
  size?: 'xs' | 'sm' | 'md' | 'lg'
}) {
  return (
    <Center py={py}>
      <Stack align="center" gap="xs">
        <Box className="hlv-pulse">
          <Loader color="petrol" size={size} type="oval" />
        </Box>
        {label && (
          <Text size="xs" c="dimmed" className="hlv-pulse-text">
            {label}
          </Text>
        )}
      </Stack>
    </Center>
  )
}
