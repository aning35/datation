"""
Seed Demo Database — Generate a SQLite demo database from seed_data.sql.

Usage:
    python scripts/seed_demo_db.py [output_path]
    # Default output: ~/.datation/demo_data.db
"""

import sqlite3
import os
import sys


def seed_database(db_path: str):
    """Create and seed the demo database by executing seed_data.sql."""
    # Locate seed_data.sql (lives in the same directory as this script)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sql_file = os.path.join(script_dir, "seed_data.sql")

    if not os.path.exists(sql_file):
        print(f"[SeedDB] ❌ seed_data.sql not found at {sql_file}")
        return

    # Read the SQL
    with open(sql_file, "r", encoding="utf-8") as f:
        sql_script = f.read()

    # Ensure parent directory exists
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    # Remove existing file to start fresh
    if os.path.exists(db_path):
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(sql_script)

        # Print verification stats
        cursor = conn.cursor()
        print(f"\n✅ Demo database created: {db_path}")
        print("─" * 40)
        for table in ["customers", "categories", "products", "orders", "order_items"]:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            print(f"  {table:20s} → {count} rows")
        print("─" * 40)
    finally:
        conn.close()


if __name__ == "__main__":
    output_path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.datation/demo_data.db")
    seed_database(output_path)
