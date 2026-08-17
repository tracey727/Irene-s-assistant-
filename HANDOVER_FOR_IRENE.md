# Gigi — Secure Handover for Irene

## First use on Irene's personal device

1. Open the production Gigi link in Irene's normal private browser profile.
2. Create a master passphrase of at least 12 characters. Gigi does not store or recover the passphrase.
3. Open **More → Encrypted Backup** and create an encrypted backup. Keep the backup and master passphrase separately.
4. Open **More → Workload Guard** and replace the starter limits with Irene's own realistic professional limits.
5. Use **More → Secure Vault** for real private information.

## What the Secure Vault can hold

- Client session/progress notes
- Assessments
- General letters
- NDIS letters/reports
- GP/Medicare correspondence
- Insurer/WorkCover work
- School/university correspondence
- Legal/court work
- Specialist referrals
- Progress reports
- Treatment summaries
- Supervision notes
- Business/administration
- Operations
- Personal commitments
- Other psychology-related information Irene needs to organise

Where practical, use a client reference/code instead of a full name and only record information that is genuinely needed.

## Workload Guard

Gigi tracks secure records against Irene's own limits, including:

- client sessions today
- client sessions this week
- after-hours work
- protected personal time
- supervision/professional-support time
- short daily energy/load check-ins

The limits are personal capacity settings, not a universal clinical caseload rule.

## Privacy design

- Secure records are encrypted locally in the browser using AES-GCM.
- The master passphrase is not stored by Gigi.
- The vault automatically locks after inactivity and after being left in the background.
- Sensitive vault information is not uploaded to a Gigi server by this build.
- The website is configured not to be indexed by search engines.
- Browser security headers restrict framing and cross-origin access.
- Gigi voice is for organisation, navigation and workload commands. Do not dictate identifiable clinical content using browser speech recognition.
- The encrypted backup can restore the vault after device/browser loss, but it still requires the master passphrase.

## Important professional boundary

Gigi is an organisational and administrative assistant. Clinical judgement, diagnoses, opinions, certifications, legal conclusions, treatment decisions and release of professional reports remain Irene's responsibility as the authorised psychologist.

## Device-loss warning

The secure vault is device/browser-local. Clearing website data, changing browser profiles or losing the device can remove access to local records. Maintain an up-to-date encrypted backup.
