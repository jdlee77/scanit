# No server: Kit data stays on the phone, and the Export is the only off-device copy

scanit has no server or database. Kits and Settings live in the phone's browser storage, Settings can be saved to and loaded from a Settings file, and the Excel Export is the only copy of Kit data that leaves the phone. We chose this so the app costs nothing to run, needs no accounts or credentials, keeps working with no signal, and can be hosted as static files on GitHub Pages.

## Consequences

- Clearing the browser's data, or the browser evicting storage after a long period of non-use, loses any Kit not yet exported. The app reminds the user about Kits that are unexported or changed since their last Export.
- Kits cannot move between phones in the first version: the Export cannot be loaded back in. Settings files can.
- Adding sharing or sync between phones later means adding a server, which reopens this decision.
