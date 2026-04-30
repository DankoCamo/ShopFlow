# ShopFlow

All-in-one business management suite for freelancers and small teams.

## What it replaces

| Tool | ShopFlow module |
|------|----------------|
| Clockify / Toggl | Time tracker |
| Trello / Asana | Project management (Kanban + Gantt) |
| Lexoffice / Sevdesk | Invoicing (PDF, SEPA, PayPal) |
| HubSpot / Pipedrive | CRM |
| Apollo.io / Hunter.io | Lead prospecting |
| Instantly / Lemlist | AI email outreach |

## Tech stack

- Single HTML file, vanilla JS
- localStorage for data persistence
- jsPDF for PDF generation
- Cloudflare Workers (3x) for search, email, page fetch
- Serper.dev API for Google/Maps search
- Brevo API for email sending
- Anthropic Claude API for AI email generation

## Cloudflare Workers

- `shopflow-search` — Serper.dev proxy (Google + Maps search)
- `shopflow-email` — Brevo email sending proxy
- `shopflow-fetch` — Page content fetcher (email extraction from websites)

## Modules

1. Dashboard
2. Projects (Kanban + Gantt)
3. Time tracker (timer + manual entry)
4. Expenses
5. Invoicing (DE/EN/HR, PDF, SEPA QR, PayPal, Revolut)
6. Invoice history + recurring
7. Lead prospecting (Google + Maps + AI email)
8. CRM
9. Email templates
10. Settings (backup/restore JSON)

## Languages

Croatian (UI default), German, English

## Owner

CAMOutput — Danko Camo, Graz, Austria
