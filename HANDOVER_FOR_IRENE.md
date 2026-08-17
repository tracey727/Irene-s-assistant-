# Gigi — Secure Handover for Irene

## What Gigi is

Gigi is Irene's private executive-assistant workspace for time protection, priorities, reminders, follow-up, decisions, delegation, workload protection and day-to-day organisation.

This build is deliberately **not** an electronic health record or therapy-note system.

## First use on Irene's personal device

1. Open the production Gigi link in Irene's normal browser on her personal device.
2. Create Irene's master passphrase of at least 12 characters. Gigi does not store or recover the passphrase.
3. Open **More → Security & Encrypted Backup** and export an encrypted backup. Keep the backup and the passphrase separately.
4. Open **More → Gigi Settings** and set Irene's actual workday, protected buffer, preferred focus-energy window, water reminders and meal/snack reminder times.
5. Add Irene's real time blocks in **Calendar**. Mark important blocks protected. Blocks categorised as **Clinical** automatically suppress wellbeing reminders while the block is in progress.
6. Use the centre **+ Gigi** button for quick capture during the day.

## Working modules

- Today / Daily Command Centre
- Single Capture Inbox
- Action List
- Approval Queue
- Waiting on Someone
- Deadline Radar
- Follow-up Manager
- Decision Register
- Idea Parking Lot
- Meeting Manager
- People & Relationship Memory for staff/business contacts
- Document Finder for document names and locations
- Delegation Engine
- Business Dashboard
- Weekly CEO Review
- Monthly Business Review
- Workload & Energy Guard
- Clinical Quiet / Do Not Disturb protection
- End-of-Day Shutdown
- Food, water and quick snack reminders
- Voice navigation and voice capture when the device browser supports speech recognition
- Encrypted backup and restore
- Automatic inactivity/background lock
- Offline PWA cache after first successful load

## Privacy boundary — important

Gigi may hold Irene's personal, business and operational executive-assistant information in the encrypted local workspace.

Do **not** use Gigi to store:

- therapy or progress notes
- diagnoses
- assessments
- treatment plans
- clinical formulations
- identifiable clinical narratives
- professional reports containing clinical content
- medical/psychology records that belong in an authorised clinical record system

For client-related administration, use the minimum reference needed and avoid identifiable clinical detail.

## Security design

- Workspace data is encrypted locally in the browser using AES-GCM 256-bit encryption.
- The encryption key is derived from Irene's passphrase using PBKDF2-SHA-256.
- The passphrase is not stored by Gigi.
- Gigi auto-locks after inactivity and after being left in the background.
- Encrypted workspace data is stored in browser IndexedDB on Irene's device.
- The production website is configured not to be indexed by search engines.
- Security headers restrict framing, cross-origin access and unnecessary browser capabilities.
- Encrypted backups can be exported and restored, but still require the original backup passphrase to unlock.

## Device-loss warning

The workspace is device/browser-local. Clearing website data, changing browser profiles or losing the device can remove access to the local workspace. Export an up-to-date encrypted backup regularly.

## Professional boundary

Gigi supports Irene's executive function, organisation and workload protection. It does not replace clinical judgement, professional decision-making, authorised practice-management systems, clinical records, legal advice or privacy/compliance governance.
