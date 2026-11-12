/**
 * Sign-up sheet for Joyce's 25th.
 *
 * Lives inside a Google Sheet (Extensions > Apps Script) and is deployed as a
 * web app. The invitation page POSTs each RSVP here and GETs the guest list.
 * Setup steps are in ../README.md.
 */
var SHEET_NAME = 'RSVPs';
var HEADERS = ['Updated', 'Name', 'Answer', 'Karaoke song', 'Message', 'ID'];
var ANSWERS = ['yes', 'maybe', 'no'];
var MAX_ROWS = 300; // a public form: cap how much anyone can write

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Trim, cap the length, and stop a cell ever being read as a formula.
function clean_(value, max) {
  var s = String(value == null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// "Britney Jean Spears" -> "Britney S." for the list everyone can see.
function publicName_(name) {
  var parts = String(name).replace(/^'/, '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || '';
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var name = clean_(d.name, 60);
    var answer = ANSWERS.indexOf(d.status) >= 0 ? d.status : '';
    if (!name || !answer) return json_({ ok: false, error: 'Name and answer are needed.' });

    var id = String(d.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    var row = [new Date(), name, answer, clean_(d.song, 120), clean_(d.note, 500), id];
    var sh = sheet_();
    var last = sh.getLastRow();

    // the same guest changing their answer updates their row
    var target = 0;
    if (id && last > 1) {
      var ids = sh.getRange(2, 6, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0] === id) { target = i + 2; break; }
      }
    }
    if (target) {
      sh.getRange(target, 1, 1, row.length).setValues([row]);
    } else if (last - 1 >= MAX_ROWS) {
      return json_({ ok: false, error: 'The list is full.' });
    } else {
      sh.appendRow(row);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'Could not save. Try again.' });
  } finally {
    try { lock.releaseLock(); } catch (err2) { /* never held */ }
  }
}

function doGet() {
  var sh = sheet_();
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 2, last - 1, 3).getValues() : [];
  var guests = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    guests.push({ name: publicName_(rows[i][0]), status: String(rows[i][1]), song: String(rows[i][2] || '').replace(/^'/, '') });
  }
  return json_({ ok: true, guests: guests });
}
