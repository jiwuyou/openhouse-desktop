# OpenHouse Desktop

OpenHouse Desktop is a small cross-platform shell for controlling OpenHouse web apps.
WuxianPi remains a web application and is opened inside the shell; it is not rewritten as a native desktop UI.

## MVP

- Desktop and sidebar navigation.
- WuxianPi and service-manager web entries from `src/apps.json`.
- Service status, start, stop, and restart through the existing local service-manager REST API.
- Windows, macOS, and Linux packaging through Electron Builder.

The shell expects WuxianPi and service-manager to be running locally. Configure the service-manager
endpoint and token with:

```bash
OPENHOUSE_SERVICE_MANAGER_URL=http://127.0.0.1:20087 \
OPENHOUSE_SERVICE_MANAGER_TOKEN='<token>' \
npm start
```

## Development

```bash
npm install
npm start
```

Build the installer for the current host with `npm run dist`. Platform-specific builds are available
as `npm run dist:win`, `npm run dist:mac`, and `npm run dist:linux`.

## Scope

The first version deliberately uses the existing service-manager protocol and a small local app
registry. Market synchronization, bundled Runtime installation, signing, and automatic updates are
separate follow-up work.
