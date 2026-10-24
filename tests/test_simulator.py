
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SIMULATOR_PATH = (
    Path(__file__).resolve().parents[1] / "simulator" / "sim.py"
)


class TestSimulator(unittest.TestCase):

    def run_scenario(self, mode):
        # Mock AWS so no real cloud requests occur.
        with patch("boto3.client", return_value=MagicMock()):
            spec = importlib.util.spec_from_file_location(
                "coldchain_simulator", SIMULATOR_PATH
            )
            simulator = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(simulator)

        readings = []

        # Capture readings instead of publishing them.
        def capture_reading(shipment, sensor, seq, temp, ts=None):
            readings.append({
                "shipment": shipment,
                "sensor": sensor,
                "seq": seq,
                "temp": temp
            })

        simulator.send = capture_reading

        # Skip delays to make tests run quickly.
        with patch.object(simulator.time, "sleep"):
            simulator.run(mode, "SHP-TEST", "SNS-TEST")

        return readings

    def test_normal_scenario(self):
        readings = self.run_scenario("normal")

        self.assertEqual(len(readings), 20)
        self.assertTrue(
            all(0 <= r["temp"] <= 5 for r in readings)
        )

    def test_spike_scenario(self):
        readings = self.run_scenario("spike")

        self.assertEqual(len(readings), 20)

        high_positions = [
            i for i, r in enumerate(readings, start=1)
            if r["temp"] > 5
        ]

        self.assertEqual(high_positions, [8, 9])

    def test_sustained_scenario(self):
        readings = self.run_scenario("sustained")

        self.assertEqual(len(readings), 20)
        self.assertTrue(
            all(0 <= r["temp"] <= 5 for r in readings[:8])
        )
        self.assertTrue(
            all(r["temp"] > 5 for r in readings[8:])
        )


    def test_dropout_scenario(self):
        readings = self.run_scenario("dropout")

        # Sensor should stop after 8 readings.
        self.assertEqual(len(readings), 8)
        self.assertTrue(
            all(0 <= r["temp"] <= 5 for r in readings)
        )

    def test_invalid_scenario(self):
        readings = self.run_scenario("invalid")

        # Simulator sends 20 readings, including 4 invalid ones.
        self.assertEqual(len(readings), 20)

        invalid_positions = [
            i for i, r in enumerate(readings, start=1)
            if r["temp"] == 999
        ]

        self.assertEqual(invalid_positions, [5, 10, 15, 20])

    def test_duplicate_scenario(self):
        readings = self.run_scenario("duplicate")

        # 20 original readings plus 4 repeated transmissions.
        self.assertEqual(len(readings), 24)

        sequences = [r["seq"] for r in readings]

        self.assertEqual(len(set(sequences)), 20)

        # Exactly 4 sequence numbers appear twice.
        duplicates = [
            seq for seq in set(sequences)
            if sequences.count(seq) == 2
        ]

        self.assertEqual(len(duplicates), 4)

    def test_recover_scenario(self):
        readings = self.run_scenario("recover")

        # Recovery scenario produces 45 readings.
        self.assertEqual(len(readings), 45)

        # First 8 readings should be normal.
        self.assertTrue(
            all(0 <= r["temp"] <= 5 for r in readings[:8])
        )

        # Readings 9 through 14 should be high.
        self.assertTrue(
            all(r["temp"] > 5 for r in readings[8:14])
        )

        # Remaining readings should return to normal.
        self.assertTrue(
            all(0 <= r["temp"] <= 5 for r in readings[14:])
        )
        


if __name__ == "__main__":
    unittest.main()
