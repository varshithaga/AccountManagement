"""Setup commands.

    python cli.py migrate                     apply pending database migrations (creates the tables on a new database)
    python cli.py makemigrations "message"    write a new migration from changes made in app/models.py
    python cli.py init-db                     migrate + create the default roles
    python cli.py create-admin <username>     create a superuser (asks for the password)
    python cli.py seed                        add the starter Chart of Accounts, GST rates, sample bank accounts
                                              and the standard BAI codes (only adds what is missing)
"""
import getpass
import sys

from sqlalchemy import select

from app.database import SessionLocal, make_migration, migrate
from app.models import Role, User
from app.security import hash_password, password_errors
from app.services.seed import ensure_default_roles, seed_bai_codes, seed_chart_of_accounts


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    command = argv[0]
    if command == "makemigrations":
        if len(argv) < 2:
            print('Usage: python cli.py makemigrations "what changed"')
            return 1
        make_migration(argv[1])
        print("Review the new file in migrations/versions/, then run: python cli.py migrate")
        return 0
    if command not in ("migrate", "init-db", "seed", "create-admin"):
        print(f"Unknown command: {command}\n{__doc__}")
        return 1

    migrate()
    if command == "migrate":
        print("Database is up to date.")
        return 0
    with SessionLocal() as db:
        ensure_default_roles(db)
        if command == "init-db":
            print("Tables and default roles are ready.")
        elif command == "seed":
            print("Chart of Accounts:", seed_chart_of_accounts(db))
            print("BAI codes:", seed_bai_codes(db))
        elif command == "create-admin":
            if len(argv) < 2:
                print("Usage: python cli.py create-admin <username>")
                return 1
            username = argv[1]
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
            print(f'Administrator "{username}" created.')
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
