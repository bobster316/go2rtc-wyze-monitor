# Development and release checks

## Repository layout

Windows and Pi share src/ and scripts/generate-go2rtc-config.js.
Platform-specific deployment lives in raspberry-pi/. Public guides live in docs/.
Research is optional historical material and not needed to run the monitor.

Use Node.js 22 and install locked dependencies:

```bash
npm ci
npm test
```

Tests use dummy configuration and never connect to cameras.
On a system with Bash, check scripts without executing them:

```bash
bash -n raspberry-pi/install.sh
bash -n raspberry-pi/configure.sh
bash -n raspberry-pi/setup.sh
bash -n raspberry-pi/wyze-monitor
bash -n raspberry-pi/publish-friendly-url.sh
```

Do not infer live Pi compatibility from syntax or unit tests.

## Build the Pi ZIP on Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-pi-installer.ps1
```

Output: output/wyze-monitor-rpi-installer.zip.
The build prints its SHA-256 and includes docs, examples, license, locked package
metadata and required application files. It does not bundle Electron, Docker images,
private camera files or local footage. It still requires internet for installation.

Extract the archive into a fresh directory and verify the documented layout.
Run the dummy-config tests from a full source checkout. Validate Compose using
placeholder environment values; never print real generated config in CI.

## Before publishing

1. Review the exact staged file list and diff. Never use git add . on an
   operational camera installation.
2. Scan staged files and history for credentials; inspect any included images.
3. Verify documentation links and clean ZIP contents.
4. Run tests, JS/shell syntax checks and Compose validation.
5. Describe physical-device test limitations accurately in release notes.
6. Attach only the clean installer ZIP and its checksum. GitHub supplies source
   archives for the full tagged project.

Use a stable tag to recreate a release. npm dependencies use package-lock.json;
go2rtc is pinned. Docker OS packages and container base tags still depend on
upstream repositories, so this is a reproducible source workflow, not a bit-for-bit
offline appliance image.

## Deployment changes

Never alter unrelated Compose projects. Keep actual credentials out of tests,
screenshots, fixtures and command output. Keep original camera packets separate
from synthetic presentation and do not claim new captured detail from Smooth30.
