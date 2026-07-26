# HLViewer — new frontend

Современный переписанный клиент HLViewer (мониторинг газових ГРС). Логика
переносится 1:1 из действующего фронтенда (`../frontend/react-frontend`),
презентация — заново на современном стеке.

## Стек

- **Vite 8 + React 19 + TypeScript** (strict)
- **Mantine v9** — UI, тема, dates/forms/modals/notifications
- **TanStack Query** — серверное состояние/кэш
- **TanStack Table** — таблиці архівів (headless)
- **React Router v7** — маршрутизація
- **Recharts** — графіки
- **Zustand** — легкий клієнтський стан вибору (branch/lumg/line, дати)
- **xlsx** (SheetJS) — експорт у Excel
- **Vitest** — юніт-тести доменної логіки
- Шрифти self-hosted (`@fontsource-variable`) — офлайн-деплой без CDN

## Дизайн

Напрям — «control room / instrument panel»: сталеві нейтрали, петролевий
teal як основний акцент, янтар/червоний для стрілок-манометрів і аварій.
Світла + темна теми з перемикачем. Space Grotesk / Inter / JetBrains Mono
(табличні цифри для даних).

## Команди

```bash
npm run dev        # dev-сервер :3000, /api → бекенд (VITE_PROXY_TARGET, деф. :8001)
npm run build      # tsc + production build
npm run test       # Vitest
npm run typecheck  # tsc --noEmit
npm run lint       # oxlint
npm run format     # prettier
```

Dev-проксі за замовчуванням шле `/api` на `http://localhost:8001` (v2-стек).
Змінити: `VITE_PROXY_TARGET=http://host:port npm run dev`.

## Структура

```
src/
  app/        провайдери, кореневий layout, роутер
  theme/      Mantine-тема, токени, глобальний CSS
  lib/        apiClient, queryClient, i18n
  api/        типізовані обгортки ендпоінтів + query-хуки
  domain/     чиста портована логіка (commercialDay, калькулятори, flowCalc, units)
  types/      доменні TS-типи
  store/      zustand
  components/ спільний UI
  features/   екрани (auth, overview, archive, reports, flow-calc, admin, ...)
  locales/    ru.ts, uk.ts
```

## Деплой

Офлайн-сервер не має node — nginx віддає **закомічений `dist/`** просто з
репозиторію. Тому `dist/` навмисно не в `.gitignore`, і порядок такий:

```bash
npm run build      # перезбирає dist/ (хешовані ассети + index.html)
git add dist        # разом зі змінами в src
git commit
```

Комміт лише в `src/` **не доїде до серверного UI** — там побачать стару
збірку. Перенос на сервер — інкрементальними git-бандлами:

```bat
D:\Projects\HLViewer\make-bundles.bat
```

Скрипт кладе `newfrontend.bundle` у `D:\Projects\HLViewer\bundles\` разом з
`APPLY-ON-SERVER.txt` (команди для сервера). Гілка цього репозиторію — `main`
(два старих репозиторії лишились на `master`, тому `make-bundles.bat` бере
гілку окремо для кожного). Стан сервера відмічений локальним тегом
`offline/master` — назва історична, це просто маркер «що вже на сервері»;
його не пушать і не видаляють, бо перейменування скинуло б стан.

## Нотатки

- `react-router` 7.18.1: `npm audit` показує один high-флаг (RSC Mode CSRF).
  Стосується **лише RSC-режиму**, який тут не використовується (звичайний
  клієнтський SPA), тож не застосовно. Тримаємо останню пропатчену 7.x.
