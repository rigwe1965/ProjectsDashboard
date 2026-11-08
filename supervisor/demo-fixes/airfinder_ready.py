"""After an Airfinder demo reset: let the seeded staff account sign in with its demo password.

The app creates its super admin with "must change password", so the first customer to open the staff portal would be forced to
choose a new password, and the demo password would stop working for everyone after them. This clears that flag in the DEMO
database only (the path is given on the command line and must be inside the dashboard's data/ folder).
Usage: python airfinder_ready.py <path to airfinder.db>"""
import os, sqlite3, sys

db = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ''
data = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data')) + os.sep
if not db.startswith(data) or not os.path.isfile(db):
    sys.exit('Refusing: %r is not a database file inside %s' % (db, data))
con = sqlite3.connect(db)
tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
done = 0
for t in tables:
    cols = [r[1] for r in con.execute('pragma table_info("%s")' % t.replace('"', ''))]
    if 'must_change_password' in cols:
        done += con.execute('update "%s" set must_change_password = 0' % t.replace('"', '')).rowcount
con.commit(); con.close()
print('Cleared the forced password change on %d staff account(s).' % done)
