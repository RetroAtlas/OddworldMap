"""Tests for the schema parser: brace matching, comment stripping, label
derivation, the member types a derived struct inherits, the arm types, and the
member-type parser pair over the pinned checkout, which skips where no checkout
is found beside the repo or at $ODDWORLD_DECOMP (CI points it at a clone of the
pin) and fails where the variable names a path that holds none."""

import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parent)]

from oddmap import schema  # noqa: E402
from decomp_checkout import needs_decomp  # noqa: E402


class MatchBrace(unittest.TestCase):
    def test_returns_past_the_matching_close(self):
        text = "enum E { a, b } trailing"
        self.assertEqual(text[: schema._match_brace(text, text.index("{"))], "enum E { a, b }")

    def test_skips_nested_braces(self):
        text = "struct S { enum E { a } m; } after"
        self.assertEqual(text[schema._match_brace(text, text.index("{")) :], " after")

    def test_unbalanced_ends_at_the_text(self):
        text = "struct S { enum E { a }"
        self.assertEqual(schema._match_brace(text, text.index("{")), len(text))


class StripComments(unittest.TestCase):
    def test_removes_line_and_block_comments(self):
        self.assertEqual(schema._strip_comments("a /* b */ c // d\ne"), "a  c \ne")

    def test_a_commented_enum_does_not_swallow_the_next_definition(self):
        src = "// enum Ignored {\nenum Real { a, b };"
        self.assertEqual(schema._strip_comments(src), "\nenum Real { a, b };")

    def test_a_comma_in_a_comment_mints_no_enumerator(self):
        src = "enum E { a, /* one, two */ b };"
        self.assertEqual(schema._strip_comments(src).count(","), 1)


class DeriveLabel(unittest.TestCase):
    def test_drops_the_value_suffix_and_e_prefix_and_splits_camel_case(self):
        self.assertEqual(schema._derive_label("eChaseAndDisappear_4"), "Chase And Disappear")

    def test_keeps_an_e_that_is_part_of_the_word(self):
        self.assertEqual(schema._derive_label("end_3"), "End")

    def test_leaves_an_all_caps_run_alone(self):
        self.assertEqual(schema._derive_label("eTLVSpawn_1"), "TLVSpawn")

    def test_an_underscore_is_a_word_break(self):
        self.assertEqual(schema._derive_label("eMudancheeVault_Ender_7"), "Mudanchee Vault Ender")


class InheritMemberTypes(unittest.TestCase):
    def test_a_base_members_type_reaches_the_derived_struct(self):
        flat = schema._inherit_member_types(
            {("Base", "scale"): "Scale_short"}, {"Derived": "Base"}, {("Base", "scale")})
        self.assertEqual(flat[("Derived", "scale")], "Scale_short")

    def test_the_derived_structs_own_declaration_wins(self):
        types = {("Base", "m"): "A", ("Derived", "m"): "B"}
        flat = schema._inherit_member_types(types, {"Derived": "Base"},
                                            {("Base", "m"), ("Derived", "m")})
        self.assertEqual(flat[("Derived", "m")], "B")

    def test_an_own_declaration_hides_the_base_even_where_a_filter_left_it_untyped(self):
        flat = schema._inherit_member_types({("Base", "m"): "A"}, {"Derived": "Base"},
                                            {("Base", "m"), ("Derived", "m")})
        self.assertNotIn(("Derived", "m"), flat)

    def test_a_chain_resolves_through_every_base(self):
        flat = schema._inherit_member_types({("Top", "m"): "A"}, {"Mid": "Top", "Bottom": "Mid"},
                                            {("Top", "m")})
        self.assertEqual(flat[("Bottom", "m")], "A")

    def test_an_untyped_declaration_midway_hides_the_top_of_the_chain(self):
        flat = schema._inherit_member_types({("Top", "m"): "A"}, {"Mid": "Top", "Bottom": "Mid"},
                                            {("Top", "m"), ("Mid", "m")})
        self.assertNotIn(("Mid", "m"), flat)
        self.assertNotIn(("Bottom", "m"), flat)

    def test_a_cycle_terminates(self):
        flat = schema._inherit_member_types({("A", "m"): "T"}, {"A": "B", "B": "A"},
                                            {("A", "m")})
        self.assertEqual(flat[("B", "m")], "T")


class ArmType(unittest.TestCase):
    TYPES = {("Path_Drill_Data", "field_18_behavior"): "DrillBehavior"}
    STRUCTS = {("Path_Drill", "field_10_data"): "Path_Drill_Data"}

    def arm(self, struct, segs):
        return schema._arm_type(struct, segs, self.TYPES, self.STRUCTS)

    def test_a_bare_member_takes_its_own_declaration(self):
        self.assertEqual(self.arm("Path_Drill_Data", ["field_18_behavior"]), "DrillBehavior")

    def test_a_dotted_expression_types_the_arm_it_ends_on(self):
        self.assertEqual(self.arm("Path_Drill", ["field_10_data", "field_18_behavior"]),
                         "DrillBehavior")

    def test_an_unswept_sub_struct_leaves_the_arm_untyped(self):
        self.assertIsNone(self.arm("Path_Drill", ["field_10_other", "field_18_behavior"]))


class MemberTypes(unittest.TestCase):
    @needs_decomp
    def test_a_base_structs_member_carries_its_declared_type(self):
        types, _ = schema.parse_member_types("AE")
        self.assertEqual(types[("Path_WellLocal", "field_0_scale")], "Scale_short")

    @needs_decomp
    def test_a_union_typed_member_carries_no_type(self):
        types, _ = schema.parse_member_types("AO")
        self.assertEqual(types[("Path_WellLocal", "field_18_scale")], "Scale_short")
        self.assertNotIn(("Path_WellLocal", "field_24_off_level_or_dx"), types)

    @needs_decomp
    def test_a_sub_struct_and_a_union_are_swept_for_their_arms(self):
        types, structs = schema.parse_member_types("AE")
        self.assertEqual(structs[("Path_Drill", "field_10_data")], "Path_Drill_Data")
        self.assertEqual(types[("Path_Drill_Data", "field_18_behavior")], "DrillBehavior")
        types, structs = schema.parse_member_types("AO")
        self.assertEqual(structs[("Path_WellExpress", "field_24_off_level_or_dx")], "OffLevelOrDx")
        self.assertEqual(types[("OffLevelOrDx", "level")], "LevelIds")


if __name__ == "__main__":
    unittest.main()
