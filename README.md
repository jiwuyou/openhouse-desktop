# OpenHouse Desktop

OpenHouse Desktop is a small Electron shell for local web applications. It
bundles `service-manager`, a normal Windows WuxianPi, and an independent repair
WuxianPi. The web pages remain WuxianPi pages; the shell only starts processes,
opens BrowserWindows, and returns to the desktop.

## Runtime layout

```text
OpenHouse Desktop
├── service-manager (Windows host)
├── WuxianPi (Windows process, 20765)
└── 维修 WuxianPi (independent Windows process, 20766)
```

Other Linux-only apps can be registered with service-manager's `wsl` provider.
They are launched through `wsl.exe` inside a selected WSL2 distribution and do
not require a second service-manager.

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
  --platform win32 --arch x64

npm run dist:win
```
