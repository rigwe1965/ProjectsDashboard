"""Seeds SIMULATED customers, devices, metrics, alerts and tickets into the RMM DEMO database.
Run from data/demo-src/rmm/api with data/rmm-demo.env loaded. Refuses to run unless DATABASE_URL points at the demo container (port 5433, db rmm_demo).
Nothing here enrols a real agent: every device is fictional."""
import os, sys, random
from datetime import datetime, timedelta, timezone

url = os.environ.get("DATABASE_URL", "")
if "@127.0.0.1:5433/rmm_demo" not in url:
    sys.exit("Refusing to seed: DATABASE_URL is not the demo database.")

sys.path.insert(0, os.getcwd())
from app import create_app
from extensions import db
from models.customer import Customer
from models.device import Device, DeviceMetrics
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

with app.app_context():
    if Device.query.filter(Device.hostname.like("ND-%")).first():
        sys.exit("Demo data already seeded.")
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
    db.session.commit()
    print("Seeded", len(custs), "customers,", len(devs), "devices, 3 alerts, 3 tickets (all simulated).")
