from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "export-aircraft-support-contract-fixtures.py"
SCENARIO_ID = "scenario-aircraft-support-contract-demo"


class AircraftSupportContractFixtureTest(unittest.TestCase):
    def test_generated_contract_fixture_identity_chain_is_current(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--check",
                "--scenario-id",
                SCENARIO_ID,
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
        )

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)


if __name__ == "__main__":
    unittest.main()
