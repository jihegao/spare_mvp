from __future__ import annotations

from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "initialize-case-database.py"


class DesktopDatabaseInitializerTest(unittest.TestCase):
    def test_if_missing_keeps_healthy_existing_database(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "spare_mvp.sqlite3"
            created = subprocess.run(
                [sys.executable, str(SCRIPT), "--database", str(database)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(created.returncode, 0, created.stderr)
            with sqlite3.connect(database) as connection:
                before = connection.execute("select count(*) from projects").fetchone()[0]
            repeated = subprocess.run(
                [sys.executable, str(SCRIPT), "--database", str(database), "--if-missing"],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(repeated.returncode, 0, repeated.stderr)
            self.assertIn("initialization skipped", repeated.stdout)
            with sqlite3.connect(database) as connection:
                self.assertEqual(connection.execute("PRAGMA quick_check").fetchone()[0], "ok")
                self.assertEqual(connection.execute("select count(*) from projects").fetchone()[0], before)


if __name__ == "__main__":
    unittest.main()
