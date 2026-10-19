"""Setup commands.

    python cli.py migrate                     apply pending database migrations - to the main database and every
                                              company's (creates the tables on a new database)
    python cli.py makemigrations "message"    write a new migration from changes made in app/models.py
    python cli.py init-db                     migrate + create the default roles
    python cli.py create-admin <username>     create a superuser (asks for the password)
    python cli.py seed                        add the starter Chart of Accounts, GST rates, sample bank accounts
                                              and the standard BAI codes (only adds what is missing)
    python cli.py run-recurring               raise every recurring invoice that has fallen due, in every company
                                              (the server also does this every RECURRING_CHECK_MINUTES)
    python cli.py backup [--keep N]           back up every company's database and uploaded files to BACKUP_DIR
                                              (keep the newest N backups); each has a RESTORE.txt

Several companies (each with a database of its own - users, accounts, invoices, everything):
    python cli.py create-company <key> "<name>" [--database-url URL]
                                              add a company; its database is created and migrated (default: the
                                              main database's name + _<key>, on the same server)
    python cli.py companies                   list the companies
    seed and create-admin take --company <key> (default: the main company)
"""
import getpass
import sys

from sqlalchemy import select

from app.database import DEFAULT_COMPANY, SessionLocal, active_company_keys, company_session, make_migration, migrate_all
from app.models import Company, Role, User
from app.security import hash_password, password_errors
from app.services.seed import ensure_default_roles, seed_bai_codes, seed_chart_of_accounts


def _option(args: list[str], name: str) -> tuple[list[str], str | None]:
    """Takes `--name value` out of args."""
    if name not in args:
        return args, None
    i = args.index(name)
    if i + 1 >= len(args):
        raise SystemExit(f"{name} needs a value.")
    return args[:i] + args[i + 2:], args[i + 1]


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    command, args = argv[0], argv[1:]
    if command == "makemigrations":
        if not args:
            print('Usage: python cli.py makemigrations "what changed"')
            return 1
        make_migration(args[0])
        print("Review the new file in migrations/versions/, then run: python cli.py migrate")
        return 0
    # These never migrate first: a backup is what you take before migrating.
    if command == "backup":
        return _backup(args)
    if command == "run-recurring":
        return _run_recurring()
    if command == "companies":
        return _list_companies()
    if command == "create-company":
        return _create_company(args)
    if command not in ("migrate", "init-db", "seed", "create-admin"):
        print(f"Unknown command: {command}\n{__doc__}")
        return 1

    keys = migrate_all()
    if command == "migrate":
        print(f"Database{'s' if len(keys) > 1 else ''} up to date: {', '.join(keys)}.")
        return 0
    if command == "init-db":
        for key in keys:
            with company_session(key) as db:
                ensure_default_roles(db)
        print("Tables and default roles are ready.")
        return 0

    args, company = _option(args, "--company")
    company = (company or DEFAULT_COMPANY).lower()
    if company not in keys:
        print(f'There is no active company "{company}". See: python cli.py companies')
        return 1
    with company_session(company) as db:
        ensure_default_roles(db)
        if command == "seed":
            print("Chart of Accounts:", seed_chart_of_accounts(db))
            print("BAI codes:", seed_bai_codes(db))
        elif command == "create-admin":
            if not args:
                print("Usage: python cli.py create-admin <username> [--company <key>]")
                return 1
            username = args[0]
            if db.scalar(select(User.id).where(User.username == username)):
                print(f'User "{username}" already exists.')
                return 1
            password = getpass.getpass("Password: ")
            errors = password_errors(password, username)
            if errors:
                print("\n".join(errors))
                return 1
            admin_role = db.scalars(select(Role).where(Role.is_admin.is_(True))).first()
            db.add(User(username=username, hashed_password=hash_password(password), is_superuser=True,
                        role_id=admin_role.id if admin_role else None))
            db.commit()
            print(f'Administrator "{username}" created in company "{company}".')
    return 0


def _create_company(args: list[str]) -> int:
    from app.services.companies import CompanyError, create_company

    args, url = _option(args, "--database-url")
    if len(args) != 2:
        print('Usage: python cli.py create-company <key> "<name>" [--database-url URL]')
        return 1
    try:
        company = create_company(args[0], args[1], url)
    except CompanyError as exc:
        print(exc)
        return 1
    print(f'Company "{company.name}" ({company.key}) is ready, with its own empty database.')
    print(f"  Next: python cli.py seed --company {company.key}     (starter Chart of Accounts, GST rates)")
    print("  Then pick it on the sign-in page; the first account registered there becomes its administrator.")
    return 0


def _list_companies() -> int:
    with SessionLocal() as db:
        rows = db.scalars(select(Company).order_by(Company.id)).all()
    print(f"  {DEFAULT_COMPANY:<16} (main database, DATABASE_URL)")
    for c in rows:
        print(f"  {c.key:<16} {c.name}{'' if c.is_active else '  [inactive]'}")
    return 0


def _backup(args: list[str]) -> int:
    from app.services.backup import BackupError, backup

    keep = None
    if args:
        if len(args) != 2 or args[0] != "--keep" or not args[1].isdigit() or int(args[1]) < 1:
            print("Usage: python cli.py backup [--keep N]")
            return 1
        keep = int(args[1])
    try:
        result = backup(keep)
    except BackupError as exc:
        print(f"Backup failed: {exc}")
        return 1
    print(f"Backup written to {result['folder']} ({result['bytes'] / 1_048_576:.1f} MB)")
    for key, part in result["companies"].items():
        print(f"  {key}: {part['database']}, media.zip ({part['media_files']} files)")
    if result["removed"]:
        print(f"  Removed older backups: {', '.join(result['removed'])}")
    print("  See RESTORE.txt (and companies/<key>/RESTORE.txt) to restore.")
    return 0


def _run_recurring() -> int:
    from app.services.recurring import run_scheduled

    failed = False
    for key in active_company_keys():
        with company_session(key) as db:
            result = run_scheduled(db)
        if result is None:
            print(f"{key}: another run is in progress (the server's scheduler) - skipped.")
            continue
        print(f"{key}: {result['invoices_created']} invoice(s) created from {result['templates']} recurring template(s).")
        for err in result["errors"]:
            print(f"  Failed: {err['name']} - {err['error']}")
        failed = failed or bool(result["errors"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
