# Software Bill of Materials

`console-sbom.cdx.json` lists every npm dependency that ships in the
Console desktop app: the two workspaces `console-shell` (React renderer)
and `console-electron` (Electron main process), merged into one
[CycloneDX](https://cyclonedx.org/) 1.5 document.

The file checked in today is a placeholder stub (`components: []`,
`refringence:sbom:status = placeholder`). It exists so the path is real
before the first generated run and so tooling that reads the SBOM has a
valid document to parse. Running the generator below overwrites it with
the resolved dependency tree.

## Regenerate

The generator does not install anything over the network. Install both
workspaces first, then run it:

```bash
npm ci --prefix console-shell
npm ci --prefix console-electron

# cyclonedx-npm resolves the installed tree, so it must be present in
# each workspace's devDependencies (or run once via npx with install).
npm install --no-save --prefix console-shell @cyclonedx/cyclonedx-npm
npm install --no-save --prefix console-electron @cyclonedx/cyclonedx-npm

bash scripts/generate-sbom.sh
```

The script writes `docs/sbom/console-sbom.cdx.json`. If the optional
`@cyclonedx/cyclonedx-cli` merge tool is not installed it writes the
`console-shell` document alone and prints a note; install that CLI to get
both workspaces in one file.

## What the badge points at

The README badge links to this file. It reads two fields from the JSON:

- `specVersion`: the CycloneDX schema version (`1.5`).
- `components.length`: the dependency count.

The same two fields back the SBOM tile in the Console Metrics panel.

## Format note

CycloneDX is the input format for Dependency-Track, Grype, and GitHub
dependency review, which is why it is the committed default. If a
consumer needs SPDX, convert the CycloneDX output with the
`@cyclonedx/cyclonedx-cli` `convert` command rather than maintaining a
second generator.
