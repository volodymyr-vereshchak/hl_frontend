import {
  Alert,
  Button,
  Divider,
  Image,
  List,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconAlertTriangle, IconHelpCircle } from '@tabler/icons-react'
import grsReport from '@/assets/help/1c-grs-balance.png'
import enterpriseReport from '@/assets/help/1c-enterprise-consumption.png'

/**
 * How to feed and train the GRS consumption model, for the people who do it:
 * which 1С reports to export and how, then the steps in this program. Kept in
 * the app with the screenshots bundled — the production server has no
 * internet, a link out would be a broken one.
 */
export function GrsModelHelpButton() {
  const [opened, { open, close }] = useDisclosure(false)
  return (
    <>
      <Button size="xs" variant="light" leftSection={<IconHelpCircle size={15} />} onClick={open}>
        Довідка
      </Button>
      <Modal
        opened={opened}
        onClose={close}
        size={960}
        title={<Text fw={700}>Як підготувати дані й навчити модель споживання ГРС</Text>}
      >
        <HelpBody />
      </Modal>
    </>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Stack gap={6}>
      <Title order={5}>
        {n}. {title}
      </Title>
      {children}
    </Stack>
  )
}

function Path({ children }: { children: React.ReactNode }) {
  return (
    <Text size="sm">
      <b>{children}</b>
    </Text>
  )
}

function Screenshot({ src, alt }: { src: string; alt: string }) {
  return (
    <Paper withBorder radius="sm" p={4}>
      <Image src={src} alt={alt} radius="xs" />
    </Paper>
  )
}

function HelpBody() {
  return (
    <Stack gap="md">
      <Alert
        color="yellow"
        variant="light"
        icon={<IconAlertTriangle size={16} />}
        title="Перш ніж почати"
      >
        <List size="sm" spacing={4}>
          <List.Item>
            Модель вчиться на даних 1С. Щоб вона навчилася правильно, у 1С мають бути актуальні
            добові дані за якомога довший період, актуальна прив'язка підприємств до ГРС, актуальні
            категорії споживачів тощо. Помилки й неточності в 1С модель сприйме як норму.
          </List.Item>
          <List.Item>
            Це перші версії моделей. До їхніх оцінок і прогнозів варто ставитися з часткою
            скептицизму, а висновки перевіряти за первинними даними.
          </List.Item>
        </List>
      </Alert>

      <Step n={1} title="Вивантажте з 1С два звіти">
        <Text size="sm">Надходження по ГРС:</Text>
        <Path>
          Звіти → Фактичне споживання природного газу → Баланс надходження і використання газу →
          Фактичний баланс газу по ГРС (подобовий)
        </Path>
        <Screenshot src={grsReport} alt="Меню 1С: Фактичний баланс газу по ГРС (подобовий)" />
        <Text size="sm" mt="xs">
          Споживання підприємств:
        </Text>
        <Path>
          Звіти → Фактичне споживання природного газу → Споживання (використання) природного газу →
          Фактичне споживання газу подобове
        </Path>
        <Screenshot src={enterpriseReport} alt="Меню 1С: Фактичне споживання газу подобове" />
        <Text size="sm" mt="xs">
          У кожному звіті:
        </Text>
        <List size="sm" type="ordered" spacing={4}>
          <List.Item>
            Виберіть пункт меню <b>«Відновити налаштування»</b>.
          </List.Item>
          <List.Item>
            У списку налаштувань знайдіть за назвою: для звіту по ГРС — <b>HLV GRS</b>, для звіту по
            підприємствах — <b>HLV enterprise</b>.
          </List.Item>
          <List.Item>Задайте найдовший період, за який у 1С є актуальні добові дані.</List.Item>
          <List.Item>Сформуйте звіт і збережіть його у файл Excel.</List.Item>
        </List>
      </Step>

      <Divider />
      <Step n={2} title="Завантажте файли в програму">
        <Text size="sm">
          «Аналітика → Модель споживання ГРС» → вкладка «Дані» → «Вибрати файли», виберіть обидва
          файли.
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>Назва файлу не важлива: програма сама розпізнає звіт.</List.Item>
          <List.Item>
            Повторне завантаження нічого не дублює: нові дні додаються, виправлені в 1С значення
            замінюються.
          </List.Item>
          <List.Item>Що додано й оновлено, видно в журналі завантажень.</List.Item>
        </List>
      </Step>

      <Divider />
      <Step n={3} title="Створіть точки погоди">
        <Text size="sm">
          «Аналітика → Точки погоди» → «Створити з файлу ГРС». Програма покаже список ГРС із
          завантаженого звіту. Для кожної вставте координати:
        </Text>
        <List size="sm" type="ordered" spacing={4}>
          <List.Item>Відкрийте Google Maps на комп'ютері з інтернетом.</List.Item>
          <List.Item>
            Клацніть правою кнопкою на місці ГРС, потім клацніть на координати вгорі меню — вони
            скопіюються.
          </List.Item>
          <List.Item>Вставте їх у поле навпроти ГРС, наприклад «47.838310, 35.165560».</List.Item>
        </List>
        <Text size="sm">ГРС без координат можна заповнити пізніше.</Text>
      </Step>

      <Divider />
      <Step n={4} title="Завантажте погоду">
        <Text size="sm">
          Там само натисніть «Завантажити з інтернету». Період за замовчуванням починається з
          першого дня даних ГРС. Буде завантажено фактичну погоду й прогноз (Open-Meteo). Погоду
          завантажує браузер, тому потрібен комп'ютер з інтернетом.
        </Text>
      </Step>

      <Divider />
      <Step n={5} title="Навчіть модель">
        <Text size="sm">
          Вкладка «Модель» → «Навчити модель». Після кожного нового завантаження звітів чи погоди
          натисніть «Перенавчити модель», щоб модель урахувала нові дані.
        </Text>
      </Step>

      <Divider />
      <Title order={5}>Що на вкладках</Title>
      <List size="sm" spacing={6}>
        <List.Item>
          <b>Аналіз</b> — головна. Виберіть ГРС (або «Усі ГРС разом») і період:
          <List size="sm" withPadding spacing={2} mt={2}>
            <List.Item>
              на графіку факт, очікуване споживання за моделлю і прогноз на дні вперед;
            </List.Item>
            <List.Item>
              нижче — тижневе відхилення від моделі та межа, за якою відхилення вважається
              підозрілим;
            </List.Item>
            <List.Item>«ГРС», «Епізоди» й «Місяці» показують те саме таблицями;</List.Item>
            <List.Item>клік по епізоду відкриває його на графіку.</List.Item>
          </List>
        </List.Item>
        <List.Item>
          <b>За лініями</b> — якщо на вкладці «Дані» прив'язати ГРС до її ліній трендів, відхилення
          від моделі видно щодня до сьогодні за даними опитування, не чекаючи звіту 1С.
        </List.Item>
        <List.Item>
          <b>Модель</b> — наскільки точна модель для кожної ГРС, тренд рівня (наприклад, поступовий
          відтік споживачів) і з яких ознак погоди складається прогноз.
        </List.Item>
        <List.Item>
          <b>Дані</b> — завантаження звітів, журнал, список ГРС, точка погоди й лінії трендів для
          кожної ГРС, можливість виключити ГРС з моделі.
        </List.Item>
      </List>
    </Stack>
  )
}
