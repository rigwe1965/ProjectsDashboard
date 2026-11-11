<!-- Written 2026-11-11 from the CRM demo's source code (data/demo-src/crm): menu names, tabs, buttons and roles are from the code, not from clicking through
     the running demo. Skim it once next to the live demo, then delete the one TODO line below. Nothing is served to customers until that line is gone. -->
# CRM demo guide

TODO(owner): skim this next to the live demo (Sales sign-in), fix anything that differs, then delete this line.

## What it is
A customer relationship manager for a small sales business: contacts, companies, deals, tasks, invoices and stock in one place. The sample business in this demo is a hair-extension and wig supplier selling to salons and shops, so the companies, deals and products are about that.

## Signing in
The demo has two limited accounts: Sales (Sam Sales) and Support (Sue Support). Both see only their own records, not everyone's. The Settings page for them has only Profile and Security. Admin-only areas (Business, Billing, Team, Campaigns, Automations and so on) are not part of this demo.

## Menu (left side)
Dashboard, Contacts, Companies, Deals, Invoices, Stock, Tasks, Activities, Reports, Settings. On a phone the menu opens from the button at the top left. There is a light and dark theme switch in the top bar.

## What each part does
- Dashboard: tiles such as Open pipeline, Open tasks, Contacts, deals completed in the last 30 days with the win rate, money collected and money still owed, and stock spend.
- Contacts: a searchable, filterable list (search by name, email or phone). Opening a contact shows tabs for its Activity, Deals and Tasks.
- Companies: the same idea for businesses, with their contacts, deals and activity.
- Deals: a board with the columns Qualification, Discovery, Proposal, Negotiation, and won and lost. Drag a card to another column, or use the card's "Move to" menu. "New deal" creates one. Marking a deal lost asks for an optional reason.
- Tasks: tabs for All, Open, Overdue and Completed, with "New task".
- Activities: a log of notes, calls, emails, meetings and WhatsApp messages, added with "Log activity".
- Invoices: proforma invoices that can be downloaded as a PDF, created with "New invoice" or imported from a spreadsheet, PDF or photo.
- Stock: items on hand, what was bought and sold, and low-stock alerts.
- Reports: payments received over a chosen period.
- Settings, Security: set up two-step verification and change the password.
- "Ask AI" in the top bar: it does not answer in this demo, because no AI is connected to the demo. Say so if asked.

## Tours
Tour 1, find a customer and see what happened with them: 1. Open Contacts. 2. Type a name, email or phone number in the search box (for example Imani Carter). 3. Open the contact. 4. Use the Activity, Deals and Tasks tabs to see its history.

Tour 2, move a deal along: 1. Open Deals. 2. Drag a deal card from one column to the next, or open the card's menu and choose "Move to". 3. To close a deal as lost, move it to lost and, if you like, type the reason (for example price or timing).

Tour 3, record a call: 1. Open a contact from Contacts. 2. Choose "Log activity". 3. Pick the type (call, note, email, meeting or WhatsApp), add a note and save. 4. It appears in the contact's Activity tab and in Activities.

Tour 4, plan your work: 1. Open Tasks. 2. Choose "New task", give it a title and a due date. 3. Use the Overdue tab to see what is late and the Completed tab to see what is done.

Tour 5, see the big picture: 1. Open Dashboard. 2. Look at Open pipeline and Open tasks for what is in progress. 3. Open Reports to see payments received for a period.

## Things to know about this demo
- The data is sample data and the demo is reset from time to time, so anything added may disappear.
- Emails, payments, WhatsApp and AI are not connected in the demo, so those actions will not really send anything.
- Other tools can connect to the CRM through its open API, which is described in the OpenAPI format. For which tools work with it and how to set that up, refer to the owner.
- The CRM also has the API description, a full audit log and a Team page for admins, but those are not available to the demo's Sales and Support accounts.

## What to refer to the owner
Pricing, plans, discounts, contracts, hosting and where data is stored, data security or legal promises, custom features, integrations, the API in detail, onboarding and migration of real data, and anything not described above.
