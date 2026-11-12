# Joyce's 25th Birthday invitation

A one-page invitation with an RSVP form, built to match Joyce's Y2K scrapbook
poster. Plain HTML, CSS and JavaScript: no build step.

Live at https://joycesqlee.com/25th/

## Files

| File | What it holds |
| --- | --- |
| `index.html` | All the words on the page: date, venue, dress code, RSVP form. |
| `style.css` | The scrapbook look. |
| `app.js` | Cut-out letters, countdown, calendar links, RSVP, sparkles. |
| `config.js` | Start and end time, venue, and where RSVPs go. |
| `img/` | Stickers cut out of the poster, the poster itself, and the link-preview image. |
| `backend/Code.gs` | Optional Google Sheet sign-up list (see below). |

To change a detail, edit the text in `index.html`. If the date or time changes,
update `start` and `end` in `config.js` too (they drive the countdown and the
calendar links), and the `og:` tags at the top of `index.html`.

## Where RSVPs go

**As shipped:** the form opens WhatsApp with the RSVP written out, and the guest
sends it to Joyce. Nothing is stored anywhere. Set `rsvp.whatsapp` in
`config.js` to a number (international format, digits only) to open that chat
directly; note the number is then readable in the page source.

**With a sign-up sheet:** RSVPs land in a Google Sheet and the page shows a
"who's coming" list with each guest's karaoke song.

1. Create a Google Sheet (sheets.new).
2. Extensions > Apps Script. Replace the sample code with `backend/Code.gs`.
3. Deploy > New deployment > type **Web app**. Execute as **Me**, who has
   access **Anyone**. Approve the permission prompt.
4. Copy the web app URL (it ends in `/exec`) into `rsvp.endpoint` in `config.js`
   and publish again.

The sheet keeps each guest's full answer. The public list shows first name and
last initial, their answer and their song; messages for Joyce stay in the sheet.
A guest who changes their answer updates their own row.
