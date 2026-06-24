# Code signing

Console ships **unsigned** today. That's a deliberate, fine state for launch:

- **Windows** installs + **auto-updates** fine unsigned. Users click through one
  SmartScreen "Windows protected your PC -> More info -> Run anyway" on first run.
  The interactive installer also shows an FSL-1.1-Apache-2.0 license to accept
  before installing.
- **Linux** AppImage / deb have no Gatekeeper equivalent.
- **macOS** is the exception: an unsigned `.dmg` shows "damaged" on Apple Silicon
  and can't auto-update, so the macOS leg is **excluded from `release.yml`** until
  signing is set up (see below). The config is staged and ready.

Signing only removes the OS "unrecognized app" warning. It is **optional** and
costs money; distribution itself (Releases, winget, the install scripts) is free.

## Windows - Azure Artifact Signing (~$9.99/month)

> Not SignPath: its free OSS program requires an OSI-approved license without
> commercial restriction, which FSL-1.1 is not. Azure is the cheapest credible
> path and (since 2026) accepts self-employed individuals in the US / Canada.

1. Create an Azure pay-as-you-go subscription, register the `Microsoft.CodeSigning`
   resource provider, and onboard **Artifact Signing** (Basic, $9.99/mo). Complete
   the individual identity validation (government ID, ~1-2 weeks).
2. Create a Trusted Signing account + a **Public Trust** certificate profile. The
   certificate subject CN = your validated legal name (permanent - see note).
3. Create an app registration (service principal) and grant it the
   **Trusted Signing Certificate Profile Signer** role on the signing resource.
4. Add the signing block to `console-electron/package.json` `build.win`:

   ```jsonc
   "azureSignOptions": {
     "publisherName": "<your validated name>",
     "endpoint": "https://eus.codesigning.azure.net/",
     "codeSigningAccountName": "<account>",
     "certificateProfileName": "<profile>"
   }
   ```
5. Add GitHub repo secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET`, expose them on the Windows leg of `release.yml`, and drop
   `CSC_IDENTITY_AUTO_DISCOVERY: false` there.

**One-way door:** the first *signed* release pins `publisherName` into installed
clients. Every later update must be signed with a matching name or auto-update
breaks. Treat the validated name as immutable; to change it, ship a
`publisherName: ["Old", "New"]` array to bridge.

## macOS - Apple Developer Program ($99/year)

1. Enroll as an **Individual** (no company / D-U-N-S needed; ~24-48h).
2. On a Mac: create a CSR in Keychain Access -> create a **Developer ID Application**
   certificate at developer.apple.com -> import -> export as `.p12` with a password.
3. The signing config is already staged in `console-electron/package.json`
   (`build.mac`: `hardenedRuntime`, `entitlements`, dmg + zip targets) and
   `resources/entitlements.mac.plist`. Add the notarize step:

   ```jsonc
   "mac": { "notarize": { "teamId": "<TEAMID>" } }
   ```
4. Add GitHub repo secrets: `CSC_LINK` (base64 of the `.p12`), `CSC_KEY_PASSWORD`,
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com), `APPLE_TEAM_ID`.
5. Re-add `macos-latest` to the `release.yml` matrix; do **not** set
   `CSC_IDENTITY_AUTO_DISCOVERY: false` on the mac leg.

The dmg + zip targets are both required - Squirrel.Mac auto-update needs the zip
even though users install from the dmg.

## Why not EV / paid OV certs

Since 2024, Microsoft removed EV's instant-SmartScreen bypass, so EV (~$400+/yr +
a hardware token) buys nothing over OV for a solo maintainer. Azure's OV-class
cert gives the same SmartScreen behaviour for far less, with no token logistics.
