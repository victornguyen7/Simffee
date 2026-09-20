import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import llm


class EnvironmentLoading(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / '.env'

    def test_loads_supported_values_without_exposing_them(self):
        self.path.write_text('GROQ_API_KEY="test-placeholder"\nSIMFFEE_MODEL=test-model\nSIMFFEE_MAX_TOKENS=900\n')
        with patch.dict(os.environ, {}, clear=True):
            llm.load_environment(self.path)
            self.assertTrue(os.environ.get('GROQ_API_KEY'))
            self.assertEqual(os.environ['SIMFFEE_MODEL'], 'test-model')
            self.assertEqual(os.environ['SIMFFEE_MAX_TOKENS'], '900')

    def test_existing_environment_takes_precedence(self):
        self.path.write_text('SIMFFEE_MODEL=file-model\n')
        with patch.dict(os.environ, {'SIMFFEE_MODEL': 'shell-model'}, clear=True):
            llm.load_environment(self.path)
            self.assertEqual(os.environ['SIMFFEE_MODEL'], 'shell-model')

    def test_empty_key_and_missing_file_are_safe(self):
        with patch.dict(os.environ, {}, clear=True):
            llm.load_environment(self.path)
            self.assertNotIn('GROQ_API_KEY', os.environ)
            self.path.write_text('GROQ_API_KEY=\n')
            llm.load_environment(self.path)
            self.assertFalse(os.environ.get('GROQ_API_KEY'))

    def test_export_comments_and_unknown_keys(self):
        self.path.write_text('# settings\nexport SIMFFEE_MIN_INTERVAL=2.2 # pacing\nUNRELATED_VALUE=ignored\n')
        with patch.dict(os.environ, {}, clear=True):
            llm.load_environment(self.path)
            self.assertEqual(os.environ['SIMFFEE_MIN_INTERVAL'], '2.2')
            self.assertNotIn('UNRELATED_VALUE', os.environ)

    def test_shell_substitution_is_never_executed(self):
        self.path.write_text('SIMFFEE_MODEL="$(printf unsafe)"\n')
        with patch.dict(os.environ, {}, clear=True):
            llm.load_environment(self.path)
            self.assertEqual(os.environ['SIMFFEE_MODEL'], '$(printf unsafe)')

    def test_malformed_value_error_does_not_include_value(self):
        self.path.write_text('GROQ_API_KEY="PRIVATE_TEST_MARKER\n')
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError) as caught:
                llm.load_environment(self.path)
        self.assertNotIn('PRIVATE_TEST_MARKER', str(caught.exception))
        self.assertIn('line 1', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
