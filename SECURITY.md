# Security policy

## Reporting a vulnerability

Please use GitHub's private security advisory feature for vulnerabilities that
could expose devices, credentials, subscription URLs, or remote-control
capabilities. Do not post secrets or exploit details in a public Issue.

When reporting, include the device model, firmware/UFI Tools version, plugin
version, and minimal reproduction steps. Redact subscription URLs, UUIDs,
passwords, API secrets, phone numbers, SIM identifiers, and complete logs.

This community project has no guaranteed response time or commercial support.

## Deployment guidance

- Do not expose Mixed, Clash API, dashboard, SSH, or UFI Tools ports to the
  public Internet.
- Use a strong Clash API secret and restrict access with device firewall rules.
- Review uploaded configurations and downloaded binaries before use.
- Keep a recovery path available before enabling TProxy or boot startup.
