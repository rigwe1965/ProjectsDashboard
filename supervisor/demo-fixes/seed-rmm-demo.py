"""Seeds SIMULATED customers, devices, metrics, alerts and tickets into the RMM DEMO database.
Run from data/demo-src/rmm/api with data/rmm-demo.env loaded. Refuses to run unless DATABASE_URL points at the demo container (port 5433, db rmm_demo).
Nothing here enrols a real agent: every device is fictional."""
import os, sys, random
from datetime import datetime, timedelta, timezone

url = os.environ.get("DATABASE_URL", "")
if "@127.0.0.1:5433/rmm_demo" not in url and "@rmm-demo-db:5432/rmm_demo" not in url:   # the local demo container, or the hosted one
    sys.exit("Refusing to seed: DATABASE_URL is not the demo database.")

sys.path.insert(0, os.getcwd())
from app import create_app
from extensions import db
from models.customer import Customer
from models.device import Device, DeviceMetrics, InstalledSoftware
from models.alert import Alert, AlertRule
from models.ticket import Ticket

random.seed(7)
now = datetime.now(timezone.utc)
app = create_app()

CUSTOMERS = [("Northwind Dental", "northwind-dental", "premium"), ("Harbor Logistics", "harbor-logistics", "standard")]
DEVICES = [
    # customer idx, hostname, platform, os, type, cpu, cores, ram, online, status
    (0, "ND-FRONTDESK-01", "windows", "Windows 11 Pro", "desktop", "Intel Core i5-12400", 6, 16, True, "healthy"),
    (0, "ND-OPERATORY-02", "windows", "Windows 11 Pro", "desktop", "Intel Core i5-12400", 6, 16, True, "warning"),
    (0, "ND-XRAY-PC", "windows", "Windows 10 Pro", "desktop", "Intel Core i7-10700", 8, 32, True, "healthy"),
    (0, "ND-OFFICE-LAPTOP", "windows", "Windows 11 Pro", "laptop", "Intel Core i7-1255U", 10, 16, False, "offline"),
    (1, "HL-DISPATCH-01", "windows", "Windows 11 Pro", "desktop", "AMD Ryzen 5 5600", 6, 16, True, "healthy"),
    (1, "HL-WAREHOUSE-KIOSK", "linux", "Ubuntu 24.04 LTS", "desktop", "Intel Celeron N5105", 4, 8, True, "critical"),
    (1, "HL-FILESERVER", "linux", "Ubuntu Server 22.04", "server", "Intel Xeon E-2336", 6, 64, True, "healthy"),
    (1, "HL-MANAGER-MAC", "mac", "macOS 14 Sonoma", "laptop", "Apple M2", 8, 16, True, "healthy"),
]


# Installed software shown on the Software Patches page. Fictional role apps (ImagingWorks, PracticeDesk, RouteLine) stand in for real
# line-of-business products; the rest are common packages. Versions are plausible, not a live feed.
_WIN_COMMON = [
    ("Microsoft 365 Apps for business", "16.0.19029.20136", "Microsoft Corporation", "registry"),
    ("Microsoft Edge", "142.0.3595.80", "Microsoft Corporation", "registry"),
    ("Microsoft Edge WebView2 Runtime", "142.0.3595.80", "Microsoft Corporation", "registry"),
    ("Microsoft OneDrive", "25.209.1112.0001", "Microsoft Corporation", "registry"),
    ("Microsoft Teams", "26001.1.0.0", "Microsoft Corporation", "winget"),
    ("Microsoft Visual C++ 2015-2022 Redistributable (x64)", "14.44.35211.0", "Microsoft Corporation", "registry"),
    ("Google Chrome", "142.0.7444.176", "Google LLC", "winget"),
    ("Mozilla Firefox", "144.0.2", "Mozilla", "winget"),
    ("Adobe Acrobat Reader", "25.001.20531", "Adobe Inc.", "winget"),
    ("7-Zip", "25.01", "Igor Pavlov", "winget"),
    ("Zoom Workplace", "6.6.10", "Zoom Communications, Inc.", "winget"),
    ("VLC media player", "3.0.21", "VideoLAN", "winget"),
    ("Notepad++", "8.8.1", "Notepad++ Team", "winget"),
]
_UBUNTU_COMMON = [
    ("openssh-server", "1:9.6p1-3ubuntu13.5", "Ubuntu", "apt"), ("ufw", "0.36.2-6", "Ubuntu", "apt"),
    ("unattended-upgrades", "2.9.1+nmu4ubuntu1", "Ubuntu", "apt"), ("curl", "8.5.0-2ubuntu10.6", "Ubuntu", "apt"),
    ("ca-certificates", "20240203", "Ubuntu", "apt"), ("python3", "3.12.3-0ubuntu2", "Ubuntu", "apt"),
    ("cron", "3.0pl1-184ubuntu2", "Ubuntu", "apt"), ("rsync", "3.2.7-1ubuntu1.2", "Ubuntu", "apt"),
]
_SOFTWARE_BY_HOST = {
    "ND-FRONTDESK-01": _WIN_COMMON + [("PracticeDesk Suite", "12.4.1", "PracticeDesk Inc.", "registry"), ("Laser Printer Driver", "2.4.0", "PrintLine", "registry")],
    "ND-OPERATORY-02": _WIN_COMMON + [("PracticeDesk Suite", "12.4.1", "PracticeDesk Inc.", "registry"), ("ImagingWorks Chairside Viewer", "4.2.7", "ImagingWorks Ltd", "registry")],
    "ND-XRAY-PC": _WIN_COMMON + [("ImagingWorks Chairside Viewer", "4.2.7", "ImagingWorks Ltd", "registry"), ("Digital Sensor Driver", "3.1.0", "SensorTech GmbH", "registry"), ("DICOM Export Tool", "1.9.2", "ImagingWorks Ltd", "registry")],
    "ND-OFFICE-LAPTOP": _WIN_COMMON + [("PracticeDesk Suite", "12.4.1", "PracticeDesk Inc.", "registry"), ("Cisco AnyConnect Secure Mobility Client", "5.1.8.105", "Cisco Systems, Inc.", "registry")],
    "HL-DISPATCH-01": _WIN_COMMON + [("RouteLine Dispatch Console", "7.1.3", "RouteLine Systems", "registry"), ("RouteLine Fleet Maps Client", "3.9.0", "RouteLine Systems", "registry")],
    "HL-WAREHOUSE-KIOSK": _UBUNTU_COMMON + [("chromium-browser", "142.0.7444.162-0ubuntu0.24.04.1", "Ubuntu", "apt"), ("xorg", "1:7.7+23ubuntu3", "Ubuntu", "apt"),
        ("network-manager", "1.46.0-1ubuntu2.2", "Ubuntu", "apt"), ("cups", "2.4.7-1.2ubuntu7.4", "Ubuntu", "apt"), ("kiosk-scanner-app", "2.0.4", "RouteLine Systems", "apt")],
    "HL-FILESERVER": _UBUNTU_COMMON + [("samba", "2:4.15.13+dfsg-0ubuntu1.8", "Ubuntu", "apt"), ("nginx", "1.18.0-6ubuntu14.6", "Ubuntu", "apt"),
        ("postgresql-14", "14.19-0ubuntu0.22.04.1", "Ubuntu", "apt"), ("fail2ban", "0.11.2-6", "Ubuntu", "apt"), ("borgbackup", "1.2.0-1", "Ubuntu", "apt"), ("smartmontools", "7.2-1build2", "Ubuntu", "apt")],
    "HL-MANAGER-MAC": [("Safari", "18.6", "Apple Inc.", "registry"), ("Google Chrome", "142.0.7444.176", "Google LLC", "registry"), ("Microsoft Excel", "16.101", "Microsoft Corporation", "registry"),
        ("Microsoft Word", "16.101", "Microsoft Corporation", "registry"), ("Microsoft Outlook", "16.101", "Microsoft Corporation", "registry"), ("Slack", "4.46.99", "Slack Technologies", "registry"),
        ("Zoom", "6.6.10", "Zoom Communications, Inc.", "registry"), ("1Password", "8.11.8", "AgileBits Inc.", "registry"), ("RouteLine Fleet Maps Client", "3.9.0", "RouteLine Systems", "registry")],
}


def seed_software(devices):
    """Give each simulated device its installed-software list. Devices that already have rows are left alone, so this is safe to re-run."""
    rng = random.Random(11)    # its own generator: leaves the main seed's random sequence (and so every other demo number) unchanged
    added = 0
    for d in devices:
        rows = _SOFTWARE_BY_HOST.get(d.hostname)
        if not rows or InstalledSoftware.query.filter_by(device_id=d.id).first():
            continue
        for name, version, publisher, source in rows:
            db.session.add(InstalledSoftware(device_id=d.id, name=name, version=version, publisher=publisher, source=source,
                                             install_date=(now - timedelta(days=rng.randint(20, 400))).strftime("%Y-%m-%d"), last_seen=now))
            added += 1
    return added

with app.app_context():
    if Device.query.filter(Device.hostname.like("ND-%")).first():
        # Already seeded (by an earlier version that had no software): only add what is missing. DRY_RUN=1 shows the count and changes nothing.
        n = seed_software(Device.query.filter(Device.hostname.in_(list(_SOFTWARE_BY_HOST))).all())
        if os.environ.get("DRY_RUN") == "1":
            db.session.rollback(); print("DRY RUN: would add", n, "software rows; nothing written.")
        else:
            db.session.commit(); print("Demo data already seeded; added", n, "software rows.")
        sys.exit(0)
    custs = []
    for name, slug, tier in CUSTOMERS:
        c = Customer.query.filter_by(slug=slug).first() or Customer(name=name, slug=slug, tier=tier, email=f"it@{slug}.example")
        db.session.add(c); custs.append(c)
    db.session.flush()

    devs = []
    for ci, host, plat, osn, dtype, cpu, cores, ram, online, status in DEVICES:
        d = Device(customer_id=custs[ci].id, hostname=host, display_name=host, platform=plat, os_name=osn, device_type=dtype,
                   cpu_model=cpu, cpu_cores=cores, ram_gb=ram, architecture="x86_64" if plat != "mac" else "arm64",
                   ip_address=f"10.{20 + ci}.0.{10 + len(devs)}", agent_version="demo-simulated", is_online=online, status=status,
                   last_seen=now if online else now - timedelta(days=2), metadata_={"simulated": True})
        db.session.add(d); devs.append(d)
    db.session.flush()

    for d in devs:
        base_cpu = {"healthy": 18, "warning": 62, "critical": 91, "offline": 10}[d.status]
        base_ram = {"healthy": 45, "warning": 72, "critical": 88, "offline": 30}[d.status]
        for i in range(48):  # 48 half-hour samples = last 24 hours
            t = now - timedelta(minutes=30 * i)
            if not d.is_online and i < 8: continue
            db.session.add(DeviceMetrics(device_id=d.id, collected_at=t,
                cpu_pct=max(2, min(99, base_cpu + random.uniform(-12, 12))), ram_pct=max(10, min(98, base_ram + random.uniform(-6, 6))),
                ram_used_gb=round(d.ram_gb * base_ram / 100, 1), disk_pct=55 + (len(d.hostname) % 25), disk_used_gb=200, disk_total_gb=512,
                uptime_seconds=86400 * 6 + i * 1800))

    rule = AlertRule(name="High CPU (demo)", metric="cpu", operator="gt", threshold=85, severity="critical")
    db.session.add(rule); db.session.flush()
    kiosk = next(d for d in devs if d.hostname == "HL-WAREHOUSE-KIOSK")
    op2 = next(d for d in devs if d.hostname == "ND-OPERATORY-02")
    laptop = next(d for d in devs if d.hostname == "ND-OFFICE-LAPTOP")
    a1 = Alert(rule_id=rule.id, device_id=kiosk.id, severity="critical", message="CPU above 85% for 15 minutes", status="open", triggered_at=now - timedelta(minutes=40))
    a2 = Alert(device_id=op2.id, severity="warning", message="Memory above 70%", status="open", triggered_at=now - timedelta(hours=3))
    a3 = Alert(device_id=laptop.id, severity="warning", message="Device offline for more than 24 hours", status="open", triggered_at=now - timedelta(days=1))
    db.session.add_all([a1, a2, a3]); db.session.flush()
    db.session.add_all([
        Ticket(title="Warehouse kiosk is very slow", description="Screen freezes during scanning.", customer_id=custs[1].id, device_id=kiosk.id, priority="high", status="open", source="alert", alert_id=a1.id),
        Ticket(title="Install printer driver on operatory PC", customer_id=custs[0].id, device_id=op2.id, priority="medium", status="in_progress", source="manual"),
        Ticket(title="New hire: set up laptop", customer_id=custs[0].id, priority="low", status="open", source="manual"),
    ])
    n_sw = seed_software(devs)
    db.session.commit()
    print("Seeded", len(custs), "customers,", len(devs), "devices, 3 alerts, 3 tickets,", n_sw, "software rows (all simulated).")
