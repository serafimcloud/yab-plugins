---
name: Gmail without Gemini
sites: mail.google.com
made: Yab recipe
preview: https://mail.google.com/mail/u/0/#inbox
checks:
  - on /mail/*: none of button[aria-label='Ask Gemini'], a[href$='#aiinbox'], div[aria-label='Gemini'], [role='button'][aria-label^='Help me write']
  - on /mail/*: some of input[name='q']
  - on /mail/*: some of [gh='cm']
---

In Gmail, hide Gemini: the Ask Gemini button at the top, the Gemini side panel, the AI Inbox entry in the menu, the summary cards and Summarize buttons on messages, and Help me write in the composer. Also hide upsell strips for more storage or Gemini trials. Search, the inbox, labels, compose and replies all stay.
