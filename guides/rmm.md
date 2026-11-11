# Remote Management (RMM) demo guide

## What it is
Remote monitoring and management for IT providers and in-house IT: watch devices, respond to alerts, patch systems, run scripts, handle support tickets and bill customers, from one console.

The real product manages computers running Windows, macOS and Linux through an agent installed on each one, and phones and tablets (iOS and Android) and IoT devices without an agent. It watches CPU, memory and disk health, and patches the operating system (and some software). In this demo none of that is live: the devices are made up.

## Signing in and what is simulated
The demo has one account, a demo admin, so every menu item is visible. All devices, customers, alerts and tickets are sample (simulated) data, and the demo is reset from time to time, so anything added may disappear. No real computer can be connected to the demo. Scheduled jobs, backups and email do not run in the demo, so things that depend on them will not really happen.

## Menu (left side)
The menu is grouped. Monitoring: Overview, Devices, Alerts. Management: Tickets, Customers, Automation. Patching: OS Patches, Software Patches. Tools: Scripts, Remote Terminal, Disk Management, Maintenance, Network Discovery, IoT Sensors, Mobile Enrollment. Business: Reports, Billing. Usage: Usage Monitoring. Account: My Profile, and Sign Out at the bottom. An "Admin Panel" button at the top of the menu opens user and account administration.

## What each part does
- Overview: the dashboard for the whole fleet, with a Refresh button. It also has an AI assistant for questions about what is on screen.
- Devices: the list of devices; opening one shows its details and actions such as Edit and Ping. Mobile devices also have actions such as Lock, Reboot and Wipe.
- Alerts: two tabs, "Active Alerts" and "Alert Rules". Active alerts can be Acknowledged or Resolved; rules define what raises an alert.
- Tickets: a helpdesk with tabs "All Tickets", "My Tickets" and "Unassigned". A ticket can be given a status, assigned to someone ("Assign", "Assign to Me") or forwarded.
- Customers: the businesses being managed, with "+ Add Customer".
- Automation: automation profiles. The tabs are "Profile List" and "Create / Edit Profile"; "Run Now" runs a profile.
- OS Patches: tabs "Pending Patches", "Patch History" and "Policies". Software Patches has a "Check for Updates" button.
- Scripts: tabs "Library", "Upload" and "Run History"; "Run" runs a script.
- Remote Terminal: "Connect" and "Disconnect" to a device and send commands.
- Disk Management: Defragment, Check Disk and Clean Temp Files. Maintenance: Reboot, Shutdown, Create Restore Point, Delete Temp Files, Clear Browser History and Check Disk.
- Network Discovery: "Scan Network" finds devices, and "Save All to Devices" adds them.
- Mobile Enrollment: tabs "Android" and "iOS", with a "Generate enrollment QR" button. In the demo no mobile device management service is connected.
- Reports: tabs "Generate Report" and "Report History", with downloads.
- Billing: invoices per customer. Opening an invoice offers PDF, Mark Sent, Mark Paid and Overdue.
- Usage Monitoring: usage of the console's own services. Admin Panel and My Profile cover users, sign-in security (the profile page has "Enable MFA") and the profile photo.

## Tours
Tour 1, find an unhealthy device: 1. Open Devices. 2. Choose a device to see its details. 3. Use Ping to check it responds.

Tour 2, respond to an alert: 1. Open Alerts. 2. On "Active Alerts" choose an alert and use Acknowledge, then Resolve once it is dealt with. 3. Open "Alert Rules" to see what raises alerts.

Tour 3, handle a support ticket: 1. Open Tickets. 2. Use the "Unassigned" tab and open a ticket. 3. Choose "Assign to Me", then change its status.

Tour 4, patch devices: 1. Open OS Patches. 2. Look at "Pending Patches", then "Patch History" and "Policies". 3. Open Software Patches and choose "Check for Updates".

Tour 5, run a script: 1. Open Scripts. 2. Pick one from the "Library" tab and choose "Run". 3. See the result on "Run History".

Tour 6, bill a customer: 1. Open Billing and open an invoice. 2. Use PDF to download it, or Mark Sent and Mark Paid to move it along. 3. Open Reports and choose "Generate Report".

## What to refer to the owner
Pricing, plans, contracts, hosting and where data is stored, security or legal promises, which devices and operating systems are supported, connecting real computers or phones, email or Slack notifications, custom features, onboarding and migration of real data, and anything not described above.
