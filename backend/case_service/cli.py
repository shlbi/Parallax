"""Administrative commands run on the backend host, never in a public signup page."""
import argparse
import getpass
import json
import time
from pathlib import Path
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from .config import Settings
from .database import Database, sessions, users
from .security import hash_password, provision_user


def main():
    parser = argparse.ArgumentParser(description="PARALLAX case-service administration")
    parser.add_argument("command", choices=["migrate", "create-user", "reset-password", "disable-user", "enable-user", "schema"])
    parser.add_argument("--username")
    parser.add_argument("--output", default="backend/openapi.json")
    args = parser.parse_args()
    settings = Settings.from_env()
    database = Database(settings.database_url)
    try:
        if args.command == "migrate":
            database.migrate()
            print("Schema version 1 ready.")
            return
        database.check_schema()
        if args.command == "schema":
            from .api import create_app
            app = create_app(settings)
            try:
                Path(args.output).write_text(json.dumps(app.openapi(), indent=2) + "\n")
            finally:
                app.state.database.close()
            print("OpenAPI contract written.")
            return
        if not args.username:
            parser.error("--username is required")
        if args.command in {"create-user", "reset-password"}:
            password = getpass.getpass("Password (12+ characters): ")
            if password != getpass.getpass("Repeat password: "):
                parser.error("Passwords differ.")
        if args.command == "create-user":
            provision_user(database, args.username, password, time.time())
        else:
            encoded = hash_password(password) if args.command == "reset-password" else None
            with database.transaction() as db:
                user = db.execute(select(users.c.id).where(users.c.username == args.username.lower())
                                  .with_for_update()).scalar_one_or_none()
                if not user:
                    parser.error("Account not found.")
                values = {"password_hash": encoded} if encoded else {"disabled": args.command == "disable-user"}
                db.execute(update(users).where(users.c.id == user).values(**values))
                # Password resets and disabling revoke all sessions, including other devices.
                db.execute(delete(sessions).where(sessions.c.user_id == user))
        print("Operator account updated.")
    except (ValueError, IntegrityError):
        parser.exit(1, "Account input is invalid or the username already exists. No changes saved.\n")
    finally:
        database.close()


if __name__ == "__main__":
    main()
