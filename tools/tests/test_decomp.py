"""Tests for the decomp reader: the integer rows it keeps, and that a cache
regenerates from the pinned tree or not at all."""

import contextlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]

from oddmap import decomp, relive, schema  # noqa: E402


class IntRows(unittest.TestCase):
    def test_keeps_integers_in_order_and_drops_the_rest(self):
        body = """
            { 0, 1, -2, kNullThing, 0x10, 3 },
            { 4, "name", 5 },
        """
        self.assertEqual(decomp.int_rows(body), [[0, 1, -2, 3], [4, 5]])


class PinnedCheckout(unittest.TestCase):
    """a cache regenerates from the pinned tree or not at all"""

    def repo(self):
        d = Path(tempfile.mkdtemp(prefix="pin-"))
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)  # a late write into .git must not red the suite
        (d / "Source").mkdir()
        (d / "Source" / "a.hpp").write_text("x\n")
        (d / ".gitignore").write_text("build/\n*.gen.h\n")
        git = ["git", "-C", str(d)]
        subprocess.run([*git, "init", "-q"], check=True)
        # an identity to commit as, and nothing that runs a hook or a signer
        for key, value in (("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false"),
                           ("core.hooksPath", os.devnull)):
            subprocess.run([*git, "config", key, value], check=True)
        subprocess.run([*git, "add", "-A"], check=True)
        subprocess.run([*git, "commit", "-q", "-m", "one"], check=True)
        head = subprocess.run([*git, "rev-parse", "HEAD"], check=True, stdout=subprocess.PIPE, text=True).stdout.strip()
        return d, head

    def pinned(self, d, sha, ao=None):
        return mock.patch.multiple(decomp, REPO=d, DECOMP_COMMIT=sha, AO_COMMIT=ao or sha)

    def test_a_clean_checkout_at_the_pin_passes(self):
        d, head = self.repo()
        with self.pinned(d, head):
            self.assertEqual(decomp.pinned_checkout(), d)

    def test_a_checkout_off_the_pin_is_refused_naming_both_revisions(self):
        d, head = self.repo()
        with self.pinned(d, "f" * 40, ao=head), self.assertRaisesRegex(RuntimeError, f"at {head[:9]} but.*pinned to fffffffff"):
            decomp.pinned_checkout()

    def test_a_checkout_lacking_ao_commit_is_refused(self):
        d, head = self.repo()
        with self.pinned(d, head, ao="1" * 40), self.assertRaisesRegex(RuntimeError, "lacks 111111111"):
            decomp.pinned_checkout()

    def test_local_changes_under_source_are_refused(self):
        d, head = self.repo()
        (d / "Source" / "b.hpp").write_text("y\n")
        with self.pinned(d, head), self.assertRaisesRegex(RuntimeError, r"(?s)local changes under Source/.*b\.hpp"):
            decomp.pinned_checkout()

    def test_an_ignored_header_under_source_is_refused_and_an_ignored_other_file_is_not(self):
        d, head = self.repo()
        (d / "Source" / "cfg.gen.h").write_text("z\n")
        with self.pinned(d, head):
            self.assertEqual(decomp.pinned_checkout(), d)
        (d / "Source" / "build").mkdir()
        (d / "Source" / "build" / "c d.hpp").write_text("y\n")
        with self.pinned(d, head), self.assertRaisesRegex(RuntimeError, r"(?s)local changes under Source/.*c d\.hpp"):
            decomp.pinned_checkout()

    def test_a_skip_worktree_edit_is_refused(self):
        d, head = self.repo()
        subprocess.run(["git", "-C", str(d), "update-index", "--skip-worktree", "Source/a.hpp"], check=True)
        (d / "Source" / "a.hpp").write_text("y\n")
        with self.pinned(d, head), self.assertRaisesRegex(RuntimeError, r"(?s)not hold Source/ in full.*S Source/a\.hpp"):
            decomp.pinned_checkout()

    def test_a_directory_that_is_no_checkout_is_refused(self):
        d = Path(tempfile.mkdtemp(prefix="pin-"))
        self.addCleanup(shutil.rmtree, d)
        with mock.patch.object(decomp, "REPO", d), self.assertRaisesRegex(RuntimeError, "no git checkout"):
            decomp.pinned_checkout()
        inside, _ = self.repo()
        with mock.patch.object(decomp, "REPO", inside / "Source"), self.assertRaisesRegex(RuntimeError, "no git checkout"):
            decomp.pinned_checkout()

    def test_a_checkout_with_no_commit_is_refused(self):
        d = Path(tempfile.mkdtemp(prefix="pin-"))
        self.addCleanup(shutil.rmtree, d)
        subprocess.run(["git", "-C", str(d), "init", "-q"], check=True)
        with mock.patch.object(decomp, "REPO", d), self.assertRaisesRegex(RuntimeError, "no commit checked out"):
            decomp.pinned_checkout()

    def test_a_present_cache_is_read_without_asking(self):
        data = Path(tempfile.mkdtemp(prefix="data-"))
        self.addCleanup(shutil.rmtree, data)
        (data / "c.json").write_text('{"a": 1}')
        parse = mock.Mock(side_effect=AssertionError("parsed a cache that exists"))
        with mock.patch.object(decomp, "pinned_checkout", side_effect=RuntimeError("guard")):
            self.assertEqual(decomp.cached(data / "c.json", parse), {"a": 1})
        parse.assert_not_called()

    def test_every_cache_loader_asks_before_parsing(self):
        data = Path(tempfile.mkdtemp(prefix="data-"))
        self.addCleanup(shutil.rmtree, data)
        (data / "data").mkdir()
        parsed = mock.Mock(side_effect=AssertionError("parsed past the guard"))
        game = {"cache": "p.json", "schema_cache": "o.json", "enum_cache": "e.json", "relive_cache": "r.json",
                "parse_tables": parsed}
        loaders = [(decomp, None, lambda: decomp.load_cache(game)),
                   (schema, "parse_object_schema", lambda: schema.load_object_schema("AO", game)),
                   (schema, "parse_enum_labels", lambda: schema.load_enum_labels("AO", game)),
                   (relive, "parse_relive_schema", lambda: relive.load_relive_schema("AO", game))]
        for module, parser, load in loaders:
            with contextlib.ExitStack() as patched:
                patched.enter_context(mock.patch.object(module, "HERE", data))
                if parser:
                    patched.enter_context(mock.patch.object(module, parser, parsed))
                patched.enter_context(mock.patch.object(decomp, "pinned_checkout", side_effect=RuntimeError("guard")))
                with self.assertRaisesRegex(RuntimeError, "guard"):
                    load()
        parsed.assert_not_called()


if __name__ == "__main__":
    unittest.main()
