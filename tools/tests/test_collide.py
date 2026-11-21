"""The engine's test of a ray against a path's lines over rays worked by
hand, among them the ones a check asks both games' executables for and the
viewer's test holds its raycast to: stdlib only, no disc."""

import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from oddmap.collide import Hit, by_hand, raycast  # noqa: E402
from oddmap.paths import ROOT  # noqa: E402

FP = 65536
# two floors, the plane behind's above the plane in front's, a slope off the lower one's end, a floor above zero, a
# floor 64 long and a line upright from zero
LINES = [(0, 100, 200, 100, 0), (0, 80, 200, 80, 4), (200, 100, 260, 130, 0), (-40, -20, 40, -20, 0),
         (300, 100, 364, 100, 0), (50, 0, 50, 40, 0)]
FRONT, BEHIND, BOTH = 0x01, 0x10, 0x11


class Raycast(unittest.TestCase):
    def test_the_rays_set_by_hand_cross_where_the_executables_have_them_cross(self):
        (floors, rays), (past, more) = by_hand()
        self.assertEqual(floors, LINES)
        self.assertEqual([raycast(floors, *ray, kinds) for ray, kinds in rays], [
            Hit(0, 3403264, 6550784), Hit(1, 3349760, 5235456), Hit(0, 3433984, 6553088),
            Hit(0, 2228224, 100 * FP), None, Hit(0, 2228224, 100 * FP), Hit(0, 1966080, 100 * FP), None,
            Hit(2, 15023104, 7513344), Hit(0, 656128, 100 * FP), None, Hit(0, 655360, 100 * FP + 256), None,
            Hit(3, -138496, -1313280),
            Hit(0, 200 * FP, 100 * FP), Hit(0, 0, 100 * FP), Hit(0, -1024, 100 * FP), None,
            Hit(5, 50 * FP + 512, -1024), Hit(4, 300 * FP, 100 * FP), None, None, None, Hit(0, 0, 100 * FP)])
        self.assertEqual([kinds for _, kinds in rays], [BOTH, BOTH, FRONT] + [BOTH] * 21)
        self.assertEqual([kind for *_, kind in past], [32, 36, 33, 16])
        self.assertEqual([(raycast(past, *ray, kinds), kinds) for ray, kinds in more], [
            (Hit(1, 3349760, 5235456), BOTH), (Hit(0, 3433984, 6553088), FRONT), (Hit(1, 3349760, 5235456), BEHIND),
            (Hit(2, 3391744, 5894144), 0x02), (Hit(3, 3329024, 4910592), 0x10000)])

    def test_the_nearest_line_of_the_kinds_asked_for_is_the_one_crossed(self):
        ray = (3309568, 4603904, 3457024, 6914048)
        self.assertEqual(raycast(LINES, *ray, BEHIND), Hit(1, 3349760, 5235456))
        self.assertIsNone(raycast(LINES, *ray, 0x02))
        self.assertEqual(raycast(LINES[:4][::-1], *ray, BOTH), Hit(2, 3349760, 5235456))

    def test_a_ray_ending_a_512th_either_side_of_its_line_crosses_it_only_from_past_it(self):
        self.assertIsNone(raycast(LINES, 1966080, 6225920, 2228224, 100 * FP - 128, BOTH))
        self.assertEqual(raycast(LINES, 1966080, 6225920, 2228224, 100 * FP + 128, BOTH), Hit(0, 2228224, 100 * FP))

    def test_a_line_the_rays_box_does_not_reach_is_not_crossed(self):
        self.assertIsNone(raycast(LINES, 50 * FP, 70 * FP, 60 * FP, 79 * FP + 65535, BOTH))
        self.assertEqual(raycast(LINES, 50 * FP, 70 * FP, 60 * FP, 80 * FP, BOTH), Hit(1, 60 * FP, 80 * FP))


class PortLiterals(unittest.TestCase):
    """the rays the viewer's test holds its raycast to are the first group
    set by hand, which a check asks both games' executables for, each
    answered as the model answers it"""

    def test_each_ray_its_kinds_and_its_crossing_stand_in_the_ports_test(self):
        text = " ".join((ROOT / "tests" / "unit" / "collide.test.js").read_text().split())
        for old, new in (("[ ", "["), (", ]", "]"), ("{ ", "{"), (", }", "}"), (" }", "}")):
            text = text.replace(old, new)
        floors, rays = by_hand()[0]
        asked = {BOTH: "both", FRONT: "[0]"}
        self.assertEqual(text.count(f"const lines = {json.dumps([list(line) for line in floors])};"), 1)
        self.assertEqual(text.count("const both = [0, 4];"), 1)
        for ray, kinds in rays:
            hit = raycast(floors, *ray, kinds)
            answer = "null" if hit is None else f"{{line: {hit.line}, x: {hit.x}, y: {hit.y}}}"
            literal = f"[{json.dumps(list(ray))}, {asked[kinds]}, {answer}]"
            self.assertEqual(text.count(literal), 1, f"{literal} in the test's source")
        self.assertEqual(len(re.findall(r"\[\[-?\d+(?:, -?\d+){3}\], (?:both|\[0\]), ", text)), len(rays))


if __name__ == "__main__":
    unittest.main()
