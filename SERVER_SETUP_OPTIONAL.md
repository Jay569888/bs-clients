# Optional: Server-side scheduled email sending

By default, the CRM's scheduled emails fire **client-side** — meaning the email only sends when your CRM browser tab is open and the scheduled time has passed. If your tab is closed, scheduled emails wait until you reopen.

This guide adds a **server-side time trigger** in your Google Apps Script project so scheduled emails send automatically every minute, **even when nobody is logged into the CRM**.

## What you'll need

- Access to your Google Apps Script project (the one whose URL you pasted into the CRM during setup)
- ~5 minutes
- The same Google account that owns the Sheet must be the one authorising the trigger

## Steps

1. Open your Apps Script project: <https://script.google.com> → pick your project.
2. In the editor, add a new file (📄 + button) → name it `ScheduledSender.gs`.
3. Paste the entire block below into the new file and **save**.
4. Run the function `setupScheduledSenderTrigger` **once** (▶ button). Approve permissions when prompted.
5. Done. Scheduled emails will now be processed every minute by Google's servers — no browser needed.

## The Apps Script code

```javascript
/**
 * Server-side scheduled-email sender for BS Clients CRM.
 * Runs every minute via a time-driven trigger. Reads window.state.scheduled
 * from the Sheet's metadata, sends any pending emails whose scheduledTime
 * has passed, marks them as sent, and writes the result back.
 *
 * Reads/writes the same 'meta' Sheet your CRM already uses. No schema change.
 */

const META_SHEET_NAME = 'meta';     // change only if your Sheet uses a different name
const META_KEY_COL    = 1;          // column A holds keys
const META_VAL_COL    = 2;          // column B holds JSON values

function getMetaSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(META_SHEET_NAME);
}

function readMeta_(key) {
  const sh = getMetaSheet_(); if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][META_KEY_COL - 1] === key) return data[i][META_VAL_COL - 1];
  }
  return null;
}

function writeMeta_(key, value) {
  const sh = getMetaSheet_(); if (!sh) return;
  const data = sh.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][META_KEY_COL - 1] === key) {
      sh.getRange(i + 1, META_VAL_COL).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

/**
 * Main worker — runs every minute on the time-driven trigger.
 */
function processScheduledEmails() {
  const raw = readMeta_('scheduled');
  if (!raw) return;
  let queue;
  try { queue = JSON.parse(raw); } catch (e) { return; }
  if (!Array.isArray(queue) || !queue.length) return;

  const now = Date.now();
  let mutated = false;
  let sentCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (!item || item.status === 'sent') continue;
    const sendAt = new Date(item.scheduledTime).getTime();
    if (isNaN(sendAt) || sendAt > now) continue;

    try {
      GmailApp.sendEmail(item.leadEmail, item.subject || '(no subject)', '', {
        htmlBody: item.body || '',
        name: 'BS Clients'
      });
      item.status = 'sent';
      item.sentAt = new Date().toISOString();
      sentCount++;
      mutated = true;

      // Also append to emailHistory so it shows up in the lead's history
      try {
        const histRaw = readMeta_('emailHistory') || '{}';
        const hist = JSON.parse(histRaw);
        const entry = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          subject: item.subject || '',
          body: item.body || '',
          sentAt: item.sentAt,
          status: 'Sent',
          sentBy: 'Scheduler',
          sequence: false,
          templateName: item.template || ''
        };
        if (!hist[item.leadId]) hist[item.leadId] = [];
        hist[item.leadId].unshift(entry);
        writeMeta_('emailHistory', JSON.stringify(hist));
      } catch (e) { /* non-fatal */ }
    } catch (e) {
      // Mark as failed but keep in queue so it shows in the Scheduled page
      item.status = 'failed';
      item.error  = String(e).slice(0, 200);
      mutated = true;
    }
  }

  if (mutated) {
    // Drop sent items from the queue (matches client-side behavior)
    const remaining = queue.filter(s => s.status !== 'sent');
    writeMeta_('scheduled', JSON.stringify(remaining));
    Logger.log('Sent ' + sentCount + ' scheduled email(s); ' + remaining.length + ' remaining.');
  }
}

/**
 * Run THIS ONCE manually after pasting the script. Sets up the trigger.
 */
function setupScheduledSenderTrigger() {
  // Remove any existing duplicate triggers
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processScheduledEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processScheduledEmails')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('✓ Server-side scheduled email trigger is now active (every minute).');
}

/**
 * Optional: run this if you ever want to disable server-side sending.
 */
function removeScheduledSenderTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processScheduledEmails') ScriptApp.deleteTrigger(t);
  });
  Logger.log('✓ Server-side trigger removed.');
}
```

## Notes & gotchas

- **The `meta` sheet name and column layout** must match your existing CRM backend. The defaults at the top of the script (`META_SHEET_NAME = 'meta'`, columns A and B) match the standard setup created by Apps Script CRM templates. If your CRM stores `scheduled` somewhere else, edit the constants at the top accordingly.
- **The trigger runs as the Apps Script project owner.** Emails sent server-side will come from the Google account that owns the script, using their daily Gmail quota (Gmail: ~100/day on personal, ~1,500 on Workspace).
- The client-side scheduler still runs when your CRM is open — it's harmless, because the server marks items as `'sent'` and removes them, so the client just sees an empty queue.
- The server **does not** stamp `lead.level` with the template name (that happens client-side when you open the CRM). If you need the level stamp, just open the CRM once per day — the client will catch up on already-sent items.
- To turn it off, open the Apps Script editor and run `removeScheduledSenderTrigger`.

## Troubleshooting

- **Permission errors when first running `setupScheduledSenderTrigger`** — Apps Script will prompt you to allow Gmail and Spreadsheets access. Approve everything; the trigger needs both.
- **Trigger isn't firing** — check **Triggers** in the Apps Script sidebar (clock icon). You should see `processScheduledEmails` listed with "Every minute" and a recent last-run timestamp.
- **Emails are sent but the Scheduled page in the CRM still shows them pending** — this is a polling delay. The CRM reloads metadata on next open / manual refresh. Click the refresh button in the CRM to pull the updated `scheduled` array.
