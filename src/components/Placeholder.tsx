import { Center, Stack, ThemeIcon, Title, Text } from '@mantine/core'
import { IconTools } from '@tabler/icons-react'

/** Temporary page for screens not yet ported in this stage. */
export function Placeholder({ title }: { title: string }) {
  return (
    <Center py={100}>
      <Stack align="center" gap="sm">
        <ThemeIcon size={56} radius="xl" variant="light" color="steel">
          <IconTools size={28} />
        </ThemeIcon>
        <Title order={3}>{title}</Title>
        <Text c="dimmed" size="sm">
          Екран у розробці — буде портований на наступному етапі.
        </Text>
      </Stack>
    </Center>
  )
}
