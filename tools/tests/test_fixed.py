"""The engine's quotient over numbers worked by hand: stdlib only, no disc."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from oddmap.fixed import FP, by_hand, fpdiv  # noqa: E402


class Quotient(unittest.TestCase):
    def test_a_quotient_is_the_whole_part_and_two_bytes_of_the_fraction_each_cut_down(self):
        self.assertEqual([fpdiv(a * FP, 100 * FP) for a in (268, 1500, 777, 2501)], [175636, 15 * FP, 509214, 1639055])
        self.assertEqual((fpdiv(FP, 3 * FP), fpdiv(2 * FP, 3 * FP), fpdiv(64 * FP, 64 * FP)), (21845, 43690, FP))
        self.assertEqual(fpdiv(7, 2), 3 * FP + FP // 2)

    def test_the_sign_is_put_back_on_the_sizes_quotient(self):
        self.assertEqual([fpdiv(a * FP, b * FP) for a, b in ((-268, 100), (268, -100), (-268, -100))],
                         [-175636, -175636, 175636])
        self.assertEqual([fpdiv((byte - 127) * FP, 64 * FP) for byte in (126, 128, 0, 255)],
                         [-1024, 1024, -127 * 1024, 2 * FP])

    def test_a_divisor_past_24_bits_sheds_its_low_bytes_a_byte_of_the_fraction_at_a_time(self):
        self.assertEqual((fpdiv(5 * FP, 300 * FP), fpdiv(5 * FP, 0x10000FF), fpdiv(5 * FP - 1, 0xFFFFFF)),
                         (1092, 1280, 1279))

    def test_a_quotient_past_32_bits_wraps_and_nothing_is_divided_by_nothing(self):
        self.assertEqual(fpdiv(429959070, 3126), 424076160)
        with self.assertRaises(ZeroDivisionError):
            fpdiv(FP, 0)

    def test_the_pairs_set_by_hand_stand_either_side_of_a_whole_of_24_bits_and_of_32_under_each_pair_of_signs(self):
        pairs = by_hand()
        self.assertEqual((len(pairs), len(set(pairs))), (320, 320))
        self.assertEqual({(a < 0, b < 0) for a, b in pairs}, {(False, False), (False, True), (True, False),
                                                               (True, True)})
        sizes = {(abs(a), abs(b)) for a, b in pairs}
        self.assertTrue({(FP - 1, 3 * FP), (FP, 3 * FP), (268 * FP, 100 * FP), (7, 0xFFFFFF), (7, 0x1000000)} <= sizes)
        self.assertEqual(sum(abs(a) // abs(b) >= 0x8000 for a, b in pairs), 20)


if __name__ == "__main__":
    unittest.main()
