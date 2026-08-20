# OpenHouse Desktop

OpenHouse Desktop is a small Electron shell for local web applications. It
bundles `service-manager`, a normal Windows WuxianPi, and an independent repair
WuxianPi, plus an optional Windows DeepSeek Harness. The web pages remain local
agent pages; the shell only starts processes,
opens BrowserWindows, and returns to the desktop.

## Runtime layout

```text
OpenHouse Desktop
├── service-manager (Windows host)
├── WuxianPi (Windows process, 20765)
├── 维修 WuxianPi (independent Windows process, 20766)
└── DeepSeek Harness (Windows process, 3080)
```

Other Linux-only apps can be registered with service-manager's `wsl` provider.
They are launched through `wsl.exe` inside a selected WSL2 distribution and do
not require a second service-manager.

Each app window uses independent Electron `WebContentsView` containers as tabs.
Tabs share the normal or repair web session, while keeping navigation and page
state separate. The desktop setting controls the global simultaneous container
limit (1-12, default 6); reaching the limit refuses a new tab instead of
closing an existing page.

The primary window is the workspace shell: it opens with the application
sidebar and desktop visible, without creating a web container. Selecting an app
starts it when necessary and then opens or activates its tab; Ctrl/Cmd-click
always creates another tab in the same window. An active tab can be opened in a
separate window or handed to the system browser with “用浏览器打开”; doing so
leaves the OpenHouse tab unchanged. Closing the primary window's last tab
returns to the desktop, while closing the last tab in an additional window
closes that window.
The fixed Desktop item in the sidebar returns to the desktop without closing
any tabs or stopping any services.

With an active tab, “隐藏边框” removes the OpenHouse sidebar and tab bar and
expands the page to the full content area. The same switch is available under
the Chinese “查看” menu and with `Ctrl/Cmd+Shift+F`.

Each sidebar item also has a start/stop switch. Stopping an app keeps its tabs
and shows a restart panel in place of the web page. Closing tabs does not stop
services. Managed services and service-manager continue running when OpenHouse
exits, while the independent repair WuxianPi is stopped with OpenHouse.

## Development

```bash
npm install
OPENHOUSE_SERVICE_MANAGER_BIN=/path/to/service-manager npm start -- --no-sandbox
```

For a packaged build, stage `bundled/runtime` with the service-manager binary,
the two WuxianPi directories, and a matching Node runtime before running
`npm run dist:win`.

```powershell
npm run stage:runtime -- `
  --wuxianpi C:\build\desktop-runtime `
  --service-manager C:\build\service-manager.exe `
  --node "C:\Program Files\nodejs\node.exe" `
  --deepseek-harness C:\build\deepseek-harness `
  --platform win32 --arch x64

npm run dist:win
```

Install the public DeepSeek Harness runtime for Windows before staging it. The
full source checkout is not staged: it contains development dependencies and
is roughly 1.4 GiB. The production npm runtime is about 193 MiB and is the
only Harness payload included with OpenHouse.

```powershell
New-Item -ItemType Directory -Force C:\build\deepseek-harness-runtime
pnpm --dir C:\build\deepseek-harness-runtime init
pnpm --dir C:\build\deepseek-harness-runtime add --prod --config.node-linker=hoisted @deepseek-ai/dsh@0.1.0-rc.7
```

Use that `C:\build\deepseek-harness-runtime` directory for
`--deepseek-harness`. The desktop starts it with
`dsh web --host 127.0.0.1 --port 3080 --no-open`. Its data is kept under the
OpenHouse user data directory via `DSH_HOME`; it is not installed or run in
WSL2.
