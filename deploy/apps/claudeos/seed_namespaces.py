"""Neutral sample namespaces for the ClaudeOS DEMO. Replaces the app's own scripts/seed_namespaces.py, which creates the owner's real
client names (RECI Transport, Ivycandy Hair, Faiyke AI): a prospect must never see those. Mounted and run by reset.sh inside the image."""
import sys

sys.path.insert(0, '/app')

from core.config import get_settings
from vault.manager import get_namespace_by_slug, create_namespace
from vault.schemas import NamespaceCreate

NAMESPACES = [
    NamespaceCreate(slug="global", display_name="Global", description="System-wide default namespace", type="system", color="#407E3C", icon=""),
    NamespaceCreate(slug="acme-logistics", display_name="Acme Logistics Ltd", description="Transport and logistics operations (sample client)", type="client", color="#1a56db", icon=""),
    NamespaceCreate(slug="bloom-beauty", display_name="Bloom Beauty Co", description="Beauty brand: products, content, client comms (sample client)", type="client", color="#7e3af2", icon=""),
    NamespaceCreate(slug="northwind-software", display_name="Northwind Software", description="SaaS product development (sample client)", type="client", color="#ff5a1f", icon=""),
    NamespaceCreate(slug="personal", display_name="Personal", description="Personal tasks, notes, and projects", type="personal", color="#0e9f6e", icon=""),
]

if __name__ == "__main__":
    get_settings()
    for ns in NAMESPACES:
        if get_namespace_by_slug(ns.slug):
            print(f"  exists  {ns.slug}")
        else:
            create_namespace(ns)
            print(f"  created {ns.slug}")
